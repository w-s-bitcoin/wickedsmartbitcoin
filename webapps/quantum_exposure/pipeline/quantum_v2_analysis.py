#!/usr/bin/env python3
"""Canonical Quantum aggregation, bounded CSV export and verified policy parsing.

No database connections or producer work occurs on import. ``export_snapshot``
consumes group-family mappings ordered by group_id; its memory is bounded by one
reporting group, the small aggregate cube and a top-100 heap. Public-key counts
retain the legacy reporting-group interpretation, explicitly versioned in metadata.
"""
from __future__ import annotations

import csv
import hashlib
import heapq
import itertools
import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Mapping

METHODOLOGY_VERSION = "canonical-disclosure-group-consistent-v2"
PARSER_VERSION = "committed-canonical-multisig-v2"
GROUPING_VERSION = "legacy-keyhash-address-group-v2"
SCENARIO_VERSION = "current-signature-compressed-keys-34byte-destination-v2"
EXPORT_VERSION = "quantum-csv-v2"
SUBSET_CORRECTION_VERSION = "script-mask-mobius-wu-v1"
SUBSET_CORRECTION_FILE = "dashboard_script_corrections.csv"
SCRIPT_TYPES = ("P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR", "Other")
SCRIPT_MASKS = {family: 1 << index for index, family in enumerate(SCRIPT_TYPES)}
_MODELED_INPUT_WEIGHTS = {"P2PK": 460, "P2PKH": 596, "P2SH": 1680, "P2WPKH": 273,
                          "P2WSH": 920, "P2TR": 231, "Other": 1532}
TIERS = (("all", 0), ("ge1", 100_000_000), ("ge10", 1_000_000_000), ("ge100", 10_000_000_000), ("ge1000", 100_000_000_000))
ACTIVITIES = ("never_spent", "inactive", "active")
SECP256K1_P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
GENESIS_KEYHASH = "62e907b15cbf27d5425399ebf6f0fb50ebb88f18"
DETAIL_FIELDS = (
    "group_id", "display_group_ids", "script_types", "current_supply_sats",
    "current_utxo_count", "current_supply_sats_by_script_type", "current_utxo_count_by_script_type",
    "exposed_supply_sats_by_script_type", "exposed_utxo_count_by_script_type", "spend_activity",
    "exposed_utxo_count", "exposed_supply_sats", "first_received_blockheight",
    "first_exposed_blockheight", "first_exposed_time", "first_disclosure_blockheight", "first_disclosure_time",
    "first_exposed_balance_blockheight", "last_spend_blockheight", "last_spend_time",
    "first_exposed_unix_time", "last_spend_unix_time", "details", "details_quality", "identity",
    "exposure_evidence_by_script_type",
)
AGGREGATE_FIELDS = (
    "balance_filter", "script_type_filter", "spend_activity_filter", "pubkey_count", "utxo_count",
    "supply_sats", "exposed_pubkey_count", "exposed_utxo_count", "exposed_supply_sats",
    "estimated_migration_blocks", "migration_weight_wu",
)
SUBSET_CORRECTION_FIELDS = (
    "balance_filter", "script_mask", "spend_activity_filter", "pubkey_count_correction",
    "exposed_pubkey_count_correction", "migration_weight_wu_correction",
)


def valid_pubkey(key: bytes) -> bool:
    """Validate SEC encoding and membership in secp256k1 (not ownership)."""
    if len(key) == 33 and key[0] in (2, 3):
        x = int.from_bytes(key[1:], "big")
        if x >= SECP256K1_P:
            return False
        y2 = (pow(x, 3, SECP256K1_P) + 7) % SECP256K1_P
        y = pow(y2, (SECP256K1_P + 1) // 4, SECP256K1_P)
        return pow(y, 2, SECP256K1_P) == y2 and (y != 0 or key[0] == 2)
    if len(key) == 65 and key[0] == 4:
        x, y = int.from_bytes(key[1:33], "big"), int.from_bytes(key[33:], "big")
        return x < SECP256K1_P and y < SECP256K1_P and (y*y - x*x*x - 7) % SECP256K1_P == 0
    return False


@lru_cache(maxsize=32768)
def _valid_multisig_pubkey(key: bytes) -> bool:
    """Cache curve membership of the parser's fixed-size SEC key operands.

    Keys recur across distinct policies. Cache only their 33/65-byte operands,
    not whole scripts or transaction data; answers depend solely on key bytes.
    """
    return valid_pubkey(key)


def parse_multisig(script: bytes | str) -> tuple[int, tuple[bytes, ...]] | None:
    """Recognize exact OP_m <valid SEC keys> OP_n CHECKMULTISIG[/VERIFY]."""
    try:
        raw = bytes.fromhex(script) if isinstance(script, str) else script
    except (ValueError, TypeError):
        return None
    if len(raw) < 3 or not 0x51 <= raw[0] <= 0x60 or not 0x51 <= raw[-2] <= 0x60 or raw[-1] not in (0xAE, 0xAF):
        return None
    m, n = raw[0] - 0x50, raw[-2] - 0x50
    if not 1 <= m <= n <= 16:
        return None
    keys, position = [], 1
    while position < len(raw) - 2:
        length = raw[position]
        position += 1
        if length not in (33, 65) or position + length > len(raw) - 2:
            return None
        key = raw[position:position + length]
        if not _valid_multisig_pubkey(bytes(key)):
            return None
        keys.append(key)
        position += length
    if position != len(raw) - 2 or len(keys) != n:
        return None
    return m, tuple(keys)


def script_pushes(script: bytes) -> list[bytes] | None:
    """Decode a push-only scriptSig, rejecting malformed/truncated operands."""
    pushes, position = [], 0
    while position < len(script):
        opcode = script[position]
        position += 1
        if opcode <= 75:
            length = opcode
        elif opcode in (76, 77, 78):
            width = {76: 1, 77: 2, 78: 4}[opcode]
            if position + width > len(script):
                return None
            length = int.from_bytes(script[position:position + width], "little")
            position += width
        elif opcode == 0x4F or 0x51 <= opcode <= 0x60:
            pushes.append(bytes([0x81 if opcode == 0x4F else opcode - 0x50]))
            continue
        else:
            return None
        if position + length > len(script):
            return None
        pushes.append(script[position:position + length])
        position += length
    return pushes


def hash160(value: bytes) -> bytes:
    return hashlib.new("ripemd160", hashlib.sha256(value).digest()).digest()


def committed_multisig(spending_script: str, spending_witness: str, locking_script: str) -> tuple[int, tuple[bytes, ...]] | None:
    """Resolve only the script actually committed by P2SH/P2WSH/nested P2WSH.

    Witness input follows the source CSV convention: comma-separated hexadecimal
    stack items, with <empty> denoting an empty element. Other script families and
    malformed/missing evidence remain unresolved. This is policy recognition, not
    a full script satisfiability or signature validation engine.
    """
    try:
        locking = bytes.fromhex(locking_script or "")
        sig = bytes.fromhex(spending_script or "")
        witness = [b"" if part.strip() in ("", "<empty>") else bytes.fromhex(part.strip())
                   for part in (spending_witness or "").split(",")] if spending_witness else []
    except (ValueError, TypeError):
        return None
    candidate = None
    if len(locking) == 23 and locking[:2] == b"\xa9\x14" and locking[-1:] == b"\x87":
        pushes = script_pushes(sig)
        if not pushes or hash160(pushes[-1]) != locking[2:22]:
            return None
        candidate = pushes[-1]
        if len(candidate) == 34 and candidate[:2] == b"\x00\x20":
            if len(pushes) != 1 or not witness or hashlib.sha256(witness[-1]).digest() != candidate[2:]:
                return None
            candidate = witness[-1]
    elif len(locking) == 34 and locking[:2] == b"\x00\x20":
        if sig or not witness or hashlib.sha256(witness[-1]).digest() != locking[2:]:
            return None
        candidate = witness[-1]
    return parse_multisig(candidate) if candidate is not None else None


def calendar_cutoff(snapshot_time: int, years: int = 1) -> int:
    stamp = datetime.fromtimestamp(snapshot_time, timezone.utc)
    try:
        cutoff = stamp.replace(year=stamp.year - years)
    except ValueError:  # February 29 -> February 28, same convention as PostgreSQL.
        cutoff = stamp.replace(year=stamp.year - years, day=28)
    return int(cutoff.timestamp())


def classify_activity(last_spend_time: int | None, snapshot_time: int, *, last_spend_height: int | None = None) -> str:
    if last_spend_time is None:
        if last_spend_height is not None:
            raise ValueError("Known last spend requires its actual timestamp; no sentinel inference")
        return "never_spent"
    return "inactive" if last_spend_time <= calendar_cutoff(snapshot_time) else "active"


def _optional_int(value):
    return None if value is None or value == "" else int(value)


def _minimum(values):
    return min((value for value in values if value is not None), default=None)


def canonical_groups(rows: Iterable[Mapping], snapshot_time: int) -> Iterable[dict]:
    """Reduce ordered per-family state rows; retain zero-balance history slices.

    Required row keys: group_id, script_type, current_supply_sats,
    current_utxo_count, exposed_supply_sats, exposed_utxo_count. Historical values
    are optional but last_spend_blockheight requires last_spend_time. Each family
    occurs once per group. Group ordering is checked to prevent double counting.
    """
    previous_group = None
    for group_id, grouped in itertools.groupby(rows, key=lambda row: str(row["group_id"])):
        if previous_group is not None and group_id <= previous_group:
            raise ValueError("State rows must be strictly grouped and ordered by group_id")
        previous_group = group_id
        slices, displays, details, identities, detail_qualities = {}, set(), set(), set(), set()
        first_received, disclosures, spends = [], [], []
        for raw in grouped:
            family = raw["script_type"]
            if family not in SCRIPT_TYPES or family in slices:
                raise ValueError(f"Invalid or duplicate script family for group {group_id}: {family}")
            values = {key: int(raw.get(key, 0)) for key in (
                "current_supply_sats", "current_utxo_count", "exposed_supply_sats", "exposed_utxo_count")}
            if (min(values.values()) < 0 or values["exposed_supply_sats"] > values["current_supply_sats"]
                    or values["exposed_utxo_count"] > values["current_utxo_count"]
                    or (values["current_utxo_count"] == 0 and values["current_supply_sats"] != 0)
                    or (values["exposed_utxo_count"] == 0 and values["exposed_supply_sats"] != 0)):
                raise ValueError(f"Invalid accounting values for {group_id}/{family}")
            slices[family] = values
            display = raw.get("display_group_ids") or raw.get("display_group_id") or group_id
            displays.update(str(display).split("|"))
            if raw.get("details"):
                details.add(str(raw["details"]))
                detail_qualities.add(str(raw.get("details_quality") or "legacy-annotation"))
            if raw.get("identity"):
                identities.add(str(raw["identity"]))
            first_received.append(_optional_int(raw.get("first_received_blockheight")))
            disclosure_height = _optional_int(raw.get("first_exposed_blockheight"))
            if disclosure_height is not None:
                disclosures.append((disclosure_height, _optional_int(raw.get("first_exposed_time"))))
            spend_height, spend_time = _optional_int(raw.get("last_spend_blockheight")), _optional_int(raw.get("last_spend_time"))
            if spend_height is not None:
                if spend_time is None:
                    raise ValueError(f"Missing exact last-spend timestamp for {group_id}")
                spends.append((spend_height, spend_time))
        current_supply = sum(row["current_supply_sats"] for row in slices.values())
        current_count = sum(row["current_utxo_count"] for row in slices.values())
        if current_count <= 0:
            continue
        last_height, last_time = max(spends, default=(None, None))
        exposed_height, exposed_time = min(disclosures, default=(None, None))
        live_slices = {family: row for family, row in slices.items() if row["current_utxo_count"] > 0}
        yield {
            "group_id": group_id, "display_group_ids": "|".join(sorted(displays)),
            "script_types": "|".join(sorted(live_slices)), "slices": live_slices,
            "current_supply_sats": current_supply,
            "current_utxo_count": current_count,
            "exposed_supply_sats": sum(row["exposed_supply_sats"] for row in slices.values()),
            "exposed_utxo_count": sum(row["exposed_utxo_count"] for row in slices.values()),
            "first_received_blockheight": _minimum(first_received),
            "first_exposed_blockheight": exposed_height, "first_exposed_time": exposed_time,
            "last_spend_blockheight": last_height, "last_spend_time": last_time,
            "spend_activity": classify_activity(last_time, snapshot_time, last_spend_height=last_height),
            "details": "|".join(sorted(details)), "details_quality": "|".join(sorted(detail_qualities)) or "unresolved",
            "identity": "|".join(sorted(identities)),
        }


def compact_size_length(size: int) -> int:
    return 1 if size < 253 else 3 if size <= 65535 else 5 if size <= 0xffffffff else 9


def modeled_input_weight(family: str, details: str = "") -> int:
    """Named scenario, 73-byte DER+hashtype / 65-byte Schnorr / compressed keys.

    Unknown P2SH/P2WSH/Other use disclosed legacy scenario defaults; they are
    estimates, not validated lower bounds. Exact policy bytes can replace these
    defaults in a later independently versioned scenario.
    """
    return _MODELED_INPUT_WEIGHTS[family]


def migration_weight(slices: Mapping[str, Mapping], details: str = "") -> int:
    """Deterministic feasible packing per group, <=400k weight per transaction.

    Each transaction has one 34-byte destination output, no change, and spends
    families in fixed order. Bulk identical transactions are counted arithmetically.
    Block count is capacity-equivalent weight/4M, not an exact block bin packing.
    """
    total, filled, witness, inputs, legacy_inputs = 0, 0, False, 0, 0
    for family in SCRIPT_TYPES:
        values = slices.get(family)
        if values is None:
            continue
        count = int(values.get("exposed_utxo_count", 0))
        if not count:
            continue
        weight = modeled_input_weight(family, details)
        family_witness = family in ("P2WPKH", "P2WSH", "P2TR")
        while count:
            # Upper-bound CompactSize overhead at the transaction's maximum count.
            overhead = 176 + 8 + (2 if witness or family_witness else 0)
            # Every legacy input also serializes an empty witness stack when a
            # transaction contains any witness input. Charge earlier inputs at
            # the first witness family, and later legacy inputs individually.
            witness_transition = legacy_inputs if family_witness and not witness else 0
            input_weight = weight + int(witness and not family_witness)
            fit = (400_000 - overhead - filled - witness_transition) // input_weight
            if fit <= 0:
                total += filled + 176 + 4 * (compact_size_length(inputs) - 1) + (2 if witness else 0)
                filled, witness, inputs, legacy_inputs = 0, False, 0, 0
                continue
            if inputs == 0 and count >= fit:
                batches, remainder = divmod(count, fit)
                total += batches * (fit * weight + 176 + 4 * (compact_size_length(fit) - 1) + (2 if family_witness else 0))
                count = remainder
                continue
            take = min(count, fit)
            filled += take * input_weight + witness_transition
            inputs += take
            if not family_witness:
                legacy_inputs += take
            witness = witness or family_witness
            count -= take
    if inputs:
        total += filled + 176 + 4 * (compact_size_length(inputs) - 1) + (2 if witness else 0)
    return total


def detail_record(group: Mapping) -> dict:
    row = {key: group.get(key, "") for key in DETAIL_FIELDS}
    for metric in ("current_supply_sats", "current_utxo_count", "exposed_supply_sats", "exposed_utxo_count"):
        row[metric + "_by_script_type"] = json.dumps({family: values[metric] for family, values in group["slices"].items()}, sort_keys=True, separators=(",", ":"))
    evidence = {"P2PK": "curve-validated-p2pk-output", "P2PKH": "canonical-key-script-disclosure",
                "P2WPKH": "canonical-key-script-disclosure", "P2TR": "curve-validated-taproot-output-key",
                "P2SH": "spent-script-address-heuristic", "P2WSH": "spent-script-address-heuristic",
                "Other": "validated-canonical-bare-multisig"}
    row["exposure_evidence_by_script_type"] = json.dumps({
        family: evidence[family] if values["exposed_utxo_count"] else "no-supported-disclosure-evidence"
        for family, values in group["slices"].items()
    }, sort_keys=True, separators=(",", ":"))
    row["first_disclosure_blockheight"] = group["first_exposed_blockheight"]
    row["first_disclosure_time"] = group["first_exposed_time"]
    row["first_exposed_balance_blockheight"] = group.get("first_exposed_balance_blockheight", "")
    row["first_exposed_unix_time"] = group["first_exposed_time"]
    row["last_spend_unix_time"] = group["last_spend_time"]
    return row


def script_subset_corrections(slices: Mapping, *, singleton_weights: Mapping,
                              all_weight: int, details: str = "") -> dict[int, list[int]]:
    """Return signed overlap coefficients for this group's current families.

    A selection adds each coefficient whose mask is contained in that selection
    to its singleton cube totals. Group membership is inclusion/exclusion; the
    nonadditive packing weight uses a subset Möbius transform. Work depends only
    on this group's live families, not all global script-family combinations.
    Zero-value live outputs count as members; families without exposed outputs
    contribute membership but cannot affect exposed counts or packing weight.
    """
    families = tuple(family for family in SCRIPT_TYPES if family in slices)
    if len(families) < 2:
        return {}
    exposed = tuple(family for family in families if slices[family]["exposed_utxo_count"] > 0)
    exposed_mask = sum(SCRIPT_MASKS[family] for family in exposed)
    corrections = {}
    for size in range(2, len(families) + 1):
        sign = -1 if size % 2 == 0 else 1
        for subset in itertools.combinations(families, size):
            mask = sum(SCRIPT_MASKS[family] for family in subset)
            corrections[mask] = [sign, sign if mask & exposed_mask == mask else 0, 0]
    if len(exposed) < 2:
        return corrections

    weights = [0] * (1 << len(exposed))
    global_masks = [0] * len(weights)
    for mask in range(1, len(weights)):
        subset = tuple(family for bit, family in enumerate(exposed) if mask & (1 << bit))
        global_masks[mask] = sum(SCRIPT_MASKS[family] for family in subset)
        if len(subset) == 1:
            weights[mask] = singleton_weights[subset[0]]
        elif mask == len(weights) - 1:
            weights[mask] = all_weight
        else:
            weights[mask] = migration_weight({family: slices[family] for family in subset}, details)
    for bit in range(len(exposed)):
        for mask in range(1, len(weights)):
            if mask & (1 << bit):
                weights[mask] -= weights[mask ^ (1 << bit)]
    for mask, weight in enumerate(weights):
        if mask.bit_count() >= 2:
            corrections[global_masks[mask]][2] = weight
    return corrections


def _empty_cubes():
    return {(tier, family, activity): [0] * 7 for tier, _ in TIERS
            for family in ("All",) + SCRIPT_TYPES for activity in ("all",) + ACTIVITIES}


def _detail_eligible(group):
    return group["current_supply_sats"] >= 100_000_000 and group["exposed_utxo_count"] > 0


class _SnapshotWriter:
    """One serialization path for the full oracle and bounded SQL aggregates."""
    def __init__(self, output_dir, snapshot_height):
        self.directory = Path(output_dir) / str(snapshot_height)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.snapshot_height = snapshot_height
        self.detail_count = 0
        self.detail_exposed_count = 0
        self.detail_exposed_sats = 0
        self.top = []
        self.last_detail_group = None

    def __enter__(self):
        self.stream = (self.directory / "dashboard_pubkeys_ge_1btc.csv").open("w", newline="", encoding="utf-8")
        self.writer = csv.DictWriter(self.stream, fieldnames=DETAIL_FIELDS)
        self.writer.writeheader()
        return self

    def __exit__(self, *args):
        self.stream.close()

    def add_detail(self, group):
        group_id = group["group_id"]
        if not _detail_eligible(group):
            raise ValueError("Detail group does not meet whole-group balance/exposure coverage")
        if self.last_detail_group is not None and group_id <= self.last_detail_group:
            raise ValueError("Detail groups must be strictly ordered without duplicates")
        self.last_detail_group = group_id
        record = detail_record(group)
        self.writer.writerow(record)
        self.detail_count += 1
        self.detail_exposed_count += group["exposed_utxo_count"]
        self.detail_exposed_sats += group["exposed_supply_sats"]
        key = (group["exposed_supply_sats"], tuple(-ord(char) for char in group_id) + (0,))
        item = (key, record)
        if len(self.top) < 100:
            heapq.heappush(self.top, item)
        elif key > self.top[0][0]:
            heapq.heapreplace(self.top, item)

    def finish(self, cubes, correction_cubes, *, snapshot_time, block_hash,
               source_generation, label_version, group_count):
        self.stream.close()
        with (self.directory / "dashboard_pubkeys_ge_1btc_top100.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=DETAIL_FIELDS)
            writer.writeheader()
            writer.writerows(item[1] for item in sorted(self.top, key=lambda item: (-item[0][0], item[1]["group_id"])))
        with (self.directory / "dashboard_pubkeys_aggregates.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow(AGGREGATE_FIELDS)
            for key, values in sorted(cubes.items()):
                writer.writerow((*key, *values[:6], f"{values[6] / 4_000_000:.2f}", values[6]))
        with (self.directory / SUBSET_CORRECTION_FILE).open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow(SUBSET_CORRECTION_FIELDS)
            for key, values in sorted(correction_cubes.items()):
                if any(values):
                    writer.writerow((*key, *values))
        return _write_snapshot_metadata(self.directory, snapshot_height=self.snapshot_height,
            snapshot_time=snapshot_time, block_hash=block_hash, source_generation=source_generation,
            label_version=label_version, group_count=group_count, detail_count=self.detail_count)


def _write_snapshot_metadata(directory, *, snapshot_height, snapshot_time, block_hash,
                             source_generation, label_version, group_count, detail_count):
    metadata = {
        "snapshot_blockheight": snapshot_height, "snapshot_time": snapshot_time,
        "snapshot_block_hash": block_hash, "block_hash": block_hash, "source_generation": source_generation,
        "one_year_ago_blockheight": "", "one_year_ago_block_time": calendar_cutoff(snapshot_time),
        "methodology_version": METHODOLOGY_VERSION, "parser_version": PARSER_VERSION,
        "grouping_version": GROUPING_VERSION, "scenario_version": SCENARIO_VERSION,
        "export_version": EXPORT_VERSION, "subset_correction_version": SUBSET_CORRECTION_VERSION,
        "label_version": label_version,
        "pubkey_count_semantics": "distinct-reporting-groups; not unique curve points",
        "migration_semantics": "capacity-equivalent block weight; unknown-policy defaults; not lower bound",
        "date_semantics": "first_exposed compatibility alias means first disclosure; first exposed balance unavailable unless tracked",
        "exposure_coverage": "curve-validated P2PK/Taproot output keys and canonical bare multisig; P2PKH/P2WPKH canonical key-script creation/spend disclosures; P2SH/P2WSH canonical prior-spend heuristic; other policies unresolved",
        "history_evidence": "funding, disclosure and activity reconstructed from canonical source occurrences; height-only legacy registries are not proof",
        "exposure_limitations": "no complete cross-context public-key extraction/deduplication or script satisfiability proof; imported details are annotations",
        "supply_semantics": "source output accounting excluding genesis and BIP30 overwrites; unrecognized burns not globally proven",
        "detail_coverage": "current group balance >=1 BTC and exposed UTXO count >0; includes zero-value exposed outputs",
        "detail_rows": detail_count, "reporting_groups": group_count,
    }
    with (directory / "dashboard_snapshot_meta.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(metadata))
        writer.writeheader()
        writer.writerow(metadata)
    (directory / "analysis_versions.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return metadata


def export_snapshot(rows: Iterable[Mapping], *, snapshot_height: int, snapshot_time: int, output_dir: Path,
                    block_hash: str = "", source_generation: str = "", label_version: str = "legacy-import-v1",
                    group_enricher=None) -> dict:
    """Full per-group oracle/replay exporter; caller owns its stable snapshot."""
    cubes = _empty_cubes()
    correction_cubes = {}
    group_count = 0
    groups = canonical_groups(rows, snapshot_time)
    if group_enricher is not None:
        groups = group_enricher(groups)
    with _SnapshotWriter(output_dir, snapshot_height) as writer:
        for group in groups:
            group_count += 1
            if _detail_eligible(group):
                writer.add_detail(group)
            tiers = tuple(tier for tier, minimum in TIERS if group["current_supply_sats"] >= minimum)
            activities = ("all", group["spend_activity"])
            singleton_weights = {family: migration_weight({family: values}, group["details"])
                                 for family, values in group["slices"].items()}
            all_weight = (next(iter(singleton_weights.values())) if len(singleton_weights) == 1
                          else migration_weight(group["slices"], group["details"]))
            selections = [("All", group["slices"])] + [(family, {family: values}) for family, values in group["slices"].items()]
            for family, slices in selections:
                count = sum(row["current_utxo_count"] for row in slices.values())
                amount = sum(row["current_supply_sats"] for row in slices.values())
                exposed_count = sum(row["exposed_utxo_count"] for row in slices.values())
                exposed_amount = sum(row["exposed_supply_sats"] for row in slices.values())
                metrics = [1, count, amount, int(exposed_count > 0), exposed_count, exposed_amount,
                           all_weight if family == "All" else singleton_weights[family]]
                for tier in tiers:
                    for activity in activities:
                        bucket = cubes[(tier, family, activity)]
                        for index, value in enumerate(metrics):
                            bucket[index] += value
            if len(singleton_weights) > 1:
                corrections = script_subset_corrections(group["slices"], singleton_weights=singleton_weights,
                                                        all_weight=all_weight, details=group["details"])
                for mask, values in corrections.items():
                    for tier in tiers:
                        for activity in activities:
                            bucket = correction_cubes.setdefault((tier, mask, activity), [0, 0, 0])
                            for index, value in enumerate(values):
                                bucket[index] += value
        return writer.finish(cubes, correction_cubes, snapshot_time=snapshot_time, block_hash=block_hash,
            source_generation=source_generation, label_version=label_version, group_count=group_count)


def _exact_nonnegative_integer(value, name):
    if type(value) is not int or value < 0:
        raise ValueError(f"{name} must be an exact nonnegative integer")
    return value


def _preaggregated_context(snapshot_time):
    # Histogram weights cannot support a future policy/details-dependent model
    # merely because both provider and exporter imported its new version name.
    if (SCENARIO_VERSION != "current-signature-compressed-keys-34byte-destination-v2"
            or SCRIPT_TYPES != ("P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR", "Other")
            or SCRIPT_MASKS != {family: 1 << index for index, family in enumerate(SCRIPT_TYPES)}):
        raise ValueError("Preaggregated export requires the supported count-only migration scenario")
    _exact_nonnegative_integer(snapshot_time, "snapshot_time")
    calendar_cutoff(snapshot_time)
    return dict(snapshot_time=snapshot_time, methodology_version=METHODOLOGY_VERSION,
                parser_version=PARSER_VERSION, grouping_version=GROUPING_VERSION,
                scenario_version=SCENARIO_VERSION, subset_correction_version=SUBSET_CORRECTION_VERSION)


def _read_base_cubes(records, group_count):
    if not isinstance(records, list) or len(records) > len(TIERS) * 8 * 4:
        raise ValueError("Invalid bounded base cube rows")
    cubes = _empty_cubes()
    seen = set()
    for row in records:
        if not isinstance(row, Mapping):
            raise ValueError("Invalid base cube row")
        key = (row.get("tier"), row.get("family"), row.get("activity"))
        if any(not isinstance(value, str) for value in key) or key not in cubes or key in seen:
            raise ValueError("Unknown or duplicate base cube key")
        seen.add(key)
        values = row.get("metrics")
        if not isinstance(values, list) or len(values) != 6:
            raise ValueError("Base cube requires six integer metrics")
        for value in values:
            _exact_nonnegative_integer(value, "base cube metric")
        groups, count, amount, exposed_groups, exposed_count, exposed_amount = values
        if (groups > group_count or count < groups or exposed_groups > groups
                or exposed_count < exposed_groups or exposed_count > count or exposed_amount > amount
                or (groups == 0 and any(values)) or (exposed_count == 0 and exposed_amount != 0)
                or (exposed_groups == 0) != (exposed_count == 0)):
            raise ValueError("Invalid base cube accounting")
        cubes[key][:6] = values
    if cubes[("all", "All", "all")][0] != group_count:
        raise ValueError("Base cube group total differs from page frontier")
    for tier_index, (tier, minimum) in enumerate(TIERS):
        for family in ("All",) + SCRIPT_TYPES:
            whole = cubes[(tier, family, "all")]
            if any(whole[i] != sum(cubes[(tier, family, activity)][i] for activity in ACTIVITIES)
                   for i in range(6)):
                raise ValueError("Base cube activity partitions do not reconcile")
        for activity in ("all",) + ACTIVITIES:
            whole = cubes[(tier, "All", activity)]
            if whole[2] < whole[0] * minimum:
                raise ValueError("Base cube group balances are below their tier")
            if any(whole[i] != sum(cubes[(tier, family, activity)][i] for family in SCRIPT_TYPES)
                   for i in (1, 2, 4, 5)):
                raise ValueError("Base cube family amounts/counts do not reconcile")
            if tier_index:
                for family in ("All",) + SCRIPT_TYPES:
                    lower = cubes[(TIERS[tier_index - 1][0], family, activity)]
                    if any(value > lower[i] for i, value in enumerate(cubes[(tier, family, activity)][:6])):
                        raise ValueError("Base cube balance tiers are not nested")
    return cubes


def export_preaggregated_snapshot(pages: Iterable[Mapping], *, snapshot_height: int, snapshot_time: int,
                                  output_dir: Path, block_hash: str = "", source_generation: str = "",
                                  label_version: str = "legacy-import-v1", group_enricher=None, guard=None) -> dict:
    """Export bounded SQL cubes and count signatures through the ordinary writer.

    Each page contains context versions/time, a monotone live-group frontier,
    additive base cubes, packing histograms, and complete family rows only for
    detail-eligible groups. The provider owns SQL/source validation and a stable
    snapshot. This consumer independently reconciles integer counts, coverage,
    page order and versions before producing a complete isolated snapshot.
    """
    context = _preaggregated_context(snapshot_time)
    check = guard if guard is not None else lambda: None
    cubes, correction_cubes = _empty_cubes(), {}
    previous, finished, group_count = None, False, 0

    @lru_cache(maxsize=8192)
    def packing_weights(present_mask, exposed_counts):
        slices = {family: {"current_utxo_count": 1, "exposed_utxo_count": exposed_counts[index]}
                  for index, family in enumerate(SCRIPT_TYPES) if present_mask & SCRIPT_MASKS[family]}
        singleton = {family: migration_weight({family: values}) for family, values in slices.items()}
        all_weight = next(iter(singleton.values())) if len(singleton) == 1 else migration_weight(slices)
        corrections = script_subset_corrections(slices, singleton_weights=singleton, all_weight=all_weight)
        return singleton, all_weight, corrections

    with _SnapshotWriter(output_dir, snapshot_height) as writer:
        iterator = iter(pages)
        while True:
            check()  # Includes pages with no details and the next bounded SQL fetch.
            try:
                page = next(iterator)
            except StopIteration:
                break
            if finished or not isinstance(page, Mapping):
                raise ValueError("Invalid page after terminal frontier")
            _exact_nonnegative_integer(page.get("snapshot_time"), "page snapshot_time")
            if any(page.get(key) != value for key, value in context.items()):
                raise ValueError("Preaggregated page context/version differs from requested snapshot")
            count = _exact_nonnegative_integer(page.get("group_count"), "page group count")
            last, done = page.get("last_group_id"), page.get("done")
            if (count > 100000 or type(done) is not bool
                    or (count == 0 and (last is not None or not done))
                    or (count > 0 and (not isinstance(last, str) or not last or (previous is not None and last <= previous)))):
                raise ValueError("Invalid or nonmonotone preaggregated page frontier")
            base = _read_base_cubes(page.get("base_cubes"), count)
            signatures = page.get("packing")
            if not isinstance(signatures, list) or len(signatures) > count:
                raise ValueError("Invalid bounded packing histogram")
            expected = {key: [0, 0, 0] for key in cubes}
            seen, frequency = set(), 0
            for index, signature in enumerate(signatures):
                if index % 256 == 0:
                    check()
                if not isinstance(signature, Mapping):
                    raise ValueError("Invalid packing signature")
                mask, counts = signature.get("present_mask"), signature.get("exposed_counts")
                level, activity = signature.get("tier_level"), signature.get("activity")
                n = _exact_nonnegative_integer(signature.get("groups"), "signature group frequency")
                if (type(mask) is not int or not 1 <= mask < 128 or type(level) is not int
                        or not 0 <= level < len(TIERS) or activity not in ACTIVITIES or not 1 <= n <= count
                        or not isinstance(counts, list) or len(counts) != len(SCRIPT_TYPES)):
                    raise ValueError("Invalid packing signature bounds")
                for bit, value in enumerate(counts):
                    _exact_nonnegative_integer(value, "exposed input count")
                    if value and not mask & (1 << bit):
                        raise ValueError("Absent script family has exposed inputs")
                key = (mask, tuple(counts), level, activity)
                if key in seen:
                    raise ValueError("Duplicate packing signature")
                seen.add(key)
                frequency += n
                singleton, weight, corrections = packing_weights(mask, tuple(counts))
                selected = [("All", weight, sum(counts))] + [
                    (family, singleton[family], counts[bit]) for bit, family in enumerate(SCRIPT_TYPES)
                    if family in singleton]
                for tier, _ in TIERS[:level + 1]:
                    for act in ("all", activity):
                        for family, family_weight, exposed_count in selected:
                            cube_key = (tier, family, act)
                            base[cube_key][6] += n * family_weight
                            target = expected[cube_key]
                            target[0] += n
                            target[1] += n * int(exposed_count > 0)
                            target[2] += n * exposed_count
                        for correction_mask, values in corrections.items():
                            target = correction_cubes.setdefault((tier, correction_mask, act), [0, 0, 0])
                            for offset, value in enumerate(values):
                                target[offset] += n * value
            if frequency != count:
                raise ValueError("Packing histogram frequency differs from page frontier")
            for key, values in base.items():
                if [values[0], values[3], values[4]] != expected[key]:
                    raise ValueError("Packing histogram and base cube membership/counts differ")
                for index, value in enumerate(values):
                    cubes[key][index] += value
            detail_rows = page.get("detail_rows")
            if not isinstance(detail_rows, list) or len(detail_rows) > count * len(SCRIPT_TYPES):
                raise ValueError("Invalid bounded detail rows")
            prior_row = None
            for index, row in enumerate(detail_rows):
                if index % 256 == 0:
                    check()
                if not isinstance(row, Mapping):
                    raise ValueError("Invalid detail family row")
                group_id, family = row.get("group_id"), row.get("script_type")
                if (not isinstance(group_id, str) or not group_id or family not in SCRIPT_TYPES
                        or last is None or group_id > last or (previous is not None and group_id <= previous)):
                    raise ValueError("Detail family lies outside its page frontier")
                order = (group_id, family)
                if prior_row is not None and order <= prior_row:
                    raise ValueError("Detail families must be strictly ordered without duplicates")
                prior_row = order
                for field in ("current_supply_sats", "current_utxo_count", "exposed_supply_sats", "exposed_utxo_count"):
                    _exact_nonnegative_integer(row.get(field), field)
                for field in ("first_received_blockheight", "first_exposed_blockheight", "first_exposed_time",
                              "last_spend_blockheight", "last_spend_time"):
                    if row.get(field) is not None:
                        _exact_nonnegative_integer(row[field], field)
            groups = canonical_groups(detail_rows, snapshot_time)
            if group_enricher is not None:
                groups = group_enricher(groups)
            detail_exposure = {(family, activity): [0, 0, 0] for family in ("All",) + SCRIPT_TYPES
                               for activity in ("all",) + ACTIVITIES}
            for index, group in enumerate(groups):
                if index % 256 == 0:
                    check()
                writer.add_detail(group)
                for family, values in [("All", group), *group["slices"].items()]:
                    exposure = [int(values["exposed_utxo_count"] > 0), values["exposed_utxo_count"],
                                values["exposed_supply_sats"]]
                    for activity in ("all", group["spend_activity"]):
                        target = detail_exposure[(family, activity)]
                        for offset, value in enumerate(exposure):
                            target[offset] += value
            if any(coverage != base[("ge1", family, activity)][3:6]
                   for (family, activity), coverage in detail_exposure.items()):
                raise ValueError("Detail coverage differs from preaggregated GE1 family/activity exposure totals")
            group_count += count
            if count:
                previous = last
            finished = done
        if not finished:
            raise ValueError("Preaggregated pages ended without a terminal frontier")
        check()
        return writer.finish(cubes, correction_cubes, snapshot_time=snapshot_time, block_hash=block_hash,
            source_generation=source_generation, label_version=label_version, group_count=group_count)
