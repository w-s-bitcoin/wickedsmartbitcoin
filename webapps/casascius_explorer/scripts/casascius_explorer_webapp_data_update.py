#!/usr/bin/env python3
import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "casascius_explorer.csv"
STATE_PATH = ROOT / "data" / "casascius_explorer_update_state.json"
ENV_PATH = ROOT.parent.parent / ".env"
RIGHT_PANEL_SCRIPT = ROOT / "scripts" / "generate_right_panel_data.py"
ASSETS_DIR = ROOT / "assets"
DATA_JS = ASSETS_DIR / "casascius_data.js"
DATA_BASE_JS = ASSETS_DIR / "casascius_data_base.js"
DATA_CHUNK_GLOB = "casascius_data_chunk_*.js"
SATOSHIS_PER_BTC = Decimal("100000000")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Incrementally update data/casascius_explorer.csv from Postgres UTXO tables."
    )
    parser.add_argument("--csv", type=Path, default=CSV_PATH)
    parser.add_argument("--state", type=Path, default=STATE_PATH)
    parser.add_argument("--from-height", type=int, help="Override the state's last checked height.")
    parser.add_argument("--to-height", type=int, help="Override the Postgres tip height.")
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing files.")
    parser.add_argument(
        "--skip-right-panel",
        action="store_true",
        help="Do not regenerate assets/right_panel_data.js after CSV changes.",
    )
    return parser.parse_args()


def read_env(path):
    values = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip("\"'")
        values[key.strip()] = value
    return values


def psql_command(env_values):
    missing = [key for key in ("POSTGRES_HOST", "POSTGRES_DB", "POSTGRES_USER") if not env_values.get(key)]
    if missing:
        raise RuntimeError(f"Missing required .env keys: {', '.join(missing)}")
    return [
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        env_values["POSTGRES_HOST"],
        "-U",
        env_values["POSTGRES_USER"],
        "-d",
        env_values["POSTGRES_DB"],
    ]


def run_psql(env_values, sql):
    env = os.environ.copy()
    if env_values.get("POSTGRES_PASSWORD"):
        env["PGPASSWORD"] = env_values["POSTGRES_PASSWORD"]
    result = subprocess.run(
        psql_command(env_values) + ["-At", "-c", sql],
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def run_psql_file(env_values, sql_text):
    env = os.environ.copy()
    if env_values.get("POSTGRES_PASSWORD"):
        env["PGPASSWORD"] = env_values["POSTGRES_PASSWORD"]
    with tempfile.TemporaryDirectory(prefix="casascius_pg_") as tmpdir:
        sql_path = Path(tmpdir) / "query.sql"
        sql_path.write_text(sql_text)
        result = subprocess.run(
            psql_command(env_values) + ["-q", "-f", str(sql_path)],
            cwd=ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def sql_path(path):
    return sql_literal(path)


def read_csv_rows(path):
    with path.open(newline="") as csvfile:
        reader = csv.DictReader(csvfile)
        return list(reader), list(reader.fieldnames or [])


def write_csv_rows(path, fieldnames, rows):
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    tmp_path.replace(path)


def read_state(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def write_state(path, state):
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    tmp_path.replace(path)


def int_or_none(value):
    try:
        text = str(value or "").strip()
        return int(text) if text else None
    except ValueError:
        return None


def initial_checked_height(rows):
    heights = []
    for row in rows:
        for key in ("Create Block", "Redeem Block"):
            value = int_or_none(row.get(key))
            if value is not None:
                heights.append(value)
    return max(heights) if heights else 0


def archive_tables_for_range(start_height, end_height):
    if end_height < start_height:
        return []
    start_bucket = (start_height // 100000) * 100000
    end_bucket = (end_height // 100000) * 100000
    return [f"stxos_{height}_{height + 99999}_archive" for height in range(start_bucket, end_bucket + 1, 100000)]


def existing_archive_tables(env_values, table_names):
    if not table_names:
        return set()
    names_sql = ", ".join(sql_literal(name) for name in sorted(set(table_names)))
    output = run_psql(
        env_values,
        "select table_name from information_schema.tables "
        f"where table_schema = 'public' and table_name in ({names_sql}) order by table_name;",
    )
    return set(output.splitlines()) if output else set()


def copy_query_to_csv(env_values, setup_sql, query_sql, output_path):
    sql_text = (
        setup_sql
        + "\ncreate temp table copy_result as\n"
        + query_sql
        + ";\n"
        + f"\\copy copy_result to {sql_path(output_path)} with (format csv, header true)\n"
    )
    run_psql_file(env_values, sql_text)


def load_addresses_temp_sql(address_path):
    return f"""
create temp table target_addresses (address text primary key);
\\copy target_addresses(address) from {sql_path(address_path)} with (format csv)
analyze target_addresses;
"""


def write_addresses_file(rows, tmpdir):
    path = Path(tmpdir) / "addresses.csv"
    with path.open("w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        for row in rows:
            address = (row.get("Address") or "").strip()
            if address:
                writer.writerow([address])
    return path


def fetch_tip(env_values, override_height):
    if override_height is not None:
        return override_height
    value = run_psql(env_values, "select max(blockheight) from blockheader;")
    if not value:
        raise RuntimeError("Could not determine chain tip from blockheader.")
    return int(value)


def fetch_tip_time(env_values, height):
    value = run_psql(env_values, f"select time from blockheader where blockheight = {int(height)};")
    return int(value) if value else None


def fetch_affected_addresses(env_values, rows, from_height, to_height, tmpdir):
    address_path = write_addresses_file(rows, tmpdir)
    output_path = Path(tmpdir) / "affected.csv"
    archive_names = archive_tables_for_range(from_height + 1, to_height)
    existing_archives = existing_archive_tables(env_values, archive_names)
    missing_archives = [name for name in archive_names if name not in existing_archives]
    archive_queries = [
        f"""
select distinct s.address
from (
  select address
  from {table_name}
  where spendingblock > {int(from_height)}
    and spendingblock <= {int(to_height)}
) s
join target_addresses ta on ta.address = s.address
"""
        for table_name in sorted(existing_archives)
    ]
    query_parts = [
        f"""
select ta.address
from target_addresses ta
join lateral (
  select 1
  from outputs o
  where o.address = ta.address
    and o.blockheight > {int(from_height)}
    and o.blockheight <= {int(to_height)}
  limit 1
) changed_output on true
"""
    ] + archive_queries
    query = "\nunion\n".join(query_parts) + "\norder by address"
    copy_query_to_csv(env_values, load_addresses_temp_sql(address_path), query, output_path)
    with output_path.open(newline="") as csvfile:
        affected = [row["address"] for row in csv.DictReader(csvfile)]
    return affected, missing_archives


def fetch_recomputed_rows(env_values, affected_addresses, from_height, to_height, tmpdir):
    if not affected_addresses:
        return {}
    affected_path = Path(tmpdir) / "affected_addresses.csv"
    with affected_path.open("w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        for address in affected_addresses:
            writer.writerow([address])

    archive_candidates = archive_tables_for_range(from_height + 1, to_height)
    existing_archives = existing_archive_tables(env_values, archive_candidates)
    archive_parts = [
        f"""
select blockheight, transactionnum, transactionid, vout, address, amount, spendingblock, 'spent' as output_state
from (
  select blockheight, transactionnum, transactionid, vout, address, amount, spendingblock
  from {table_name}
  where spendingblock > {int(from_height)}
    and spendingblock <= {int(to_height)}
) spent_outputs
join affected_addresses using (address)
"""
        for table_name in sorted(existing_archives)
    ]
    recent_spends_sql = "\nunion all\n".join(archive_parts) if archive_parts else """
select null::bigint as blockheight, null::integer as transactionnum, null::text as transactionid,
  null::integer as vout, null::text as address, null::bigint as amount,
  null::bigint as spendingblock, null::text as output_state
where false
"""
    query = f"""
with recent_spends as (
  {recent_spends_sql}
),
ranked_recent_spends as (
  select
    recent_spends.*,
    row_number() over (
      partition by address
      order by blockheight nulls last, transactionnum nulls last, transactionid, vout
    ) as rn
  from recent_spends
),
new_redeems as (
  select *
  from ranked_recent_spends
  where rn = 1
),
balances as (
  select aa.address, coalesce(sum(o.amount), 0) as current_balance_sats
  from affected_addresses aa
  left join lateral (
    select amount
    from outputs
    where address = aa.address
  ) o on true
  group by aa.address
)
select
  aa.address,
  coalesce(b.current_balance_sats, 0) as current_balance_sats,
  nr.blockheight as create_block,
  create_header.time as create_time,
  nr.spendingblock as redeem_block,
  redeem_header.time as redeem_time
from affected_addresses aa
left join new_redeems nr using (address)
left join balances b using (address)
left join blockheader create_header on create_header.blockheight = nr.blockheight
left join blockheader redeem_header on redeem_header.blockheight = nr.spendingblock
order by aa.address
"""
    output_path = Path(tmpdir) / "recomputed.csv"
    setup_sql = f"""
create temp table affected_addresses (address text primary key);
\\copy affected_addresses(address) from {sql_path(affected_path)} with (format csv)
analyze affected_addresses;
"""
    copy_query_to_csv(env_values, setup_sql, query, output_path)
    with output_path.open(newline="") as csvfile:
        return {row["address"]: row for row in csv.DictReader(csvfile)}


def format_btc(sats):
    return str((Decimal(int(sats)) / SATOSHIS_PER_BTC).quantize(Decimal("0.00000001")))


def apply_updates(rows, recomputed, tip_time):
    changed = []
    for row in rows:
        address = row.get("Address")
        update = recomputed.get(address)
        if not update:
            continue
        before = dict(row)
        balance_sats = int(update.get("current_balance_sats") or 0)
        redeem_block = update.get("redeem_block") or ""
        row["Balance"] = format_btc(balance_sats)
        if redeem_block and (row.get("Status") != "Redeemed" or not row.get("Redeem Block")):
            row["Status"] = "Redeemed"
            if update.get("create_block") and not row.get("Create Block"):
                row["Create Block"] = update["create_block"]
            if update.get("create_time") and not row.get("Create Time"):
                row["Create Time"] = update["create_time"]
            row["Redeem Block"] = redeem_block
            row["Redeem Time"] = update.get("redeem_time") or ""
        # if tip_time is not None:
        #     row["Update Time"] = str(tip_time)
        if row != before:
            changed.append((address, before, dict(row)))
    return changed


def rebuild_casascius_data_js():
    """Rebuild assets/casascius_data.js from the split base + chunk files."""
    if not DATA_BASE_JS.exists():
        raise RuntimeError(f"Missing required data base file: {DATA_BASE_JS}")

    chunk_paths = sorted(ASSETS_DIR.glob(DATA_CHUNK_GLOB))
    if not chunk_paths:
        raise RuntimeError(f"No Casascius data chunk files found in {ASSETS_DIR}")

    tmp_path = DATA_JS.with_suffix(DATA_JS.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as outfile:
        outfile.write(DATA_BASE_JS.read_text(encoding="utf-8").rstrip())
        outfile.write("\n")
        for chunk_path in chunk_paths:
            outfile.write("\n")
            outfile.write(f"// {chunk_path.name}\n")
            outfile.write(chunk_path.read_text(encoding="utf-8").rstrip())
            outfile.write("\n")
    tmp_path.replace(DATA_JS)
    return DATA_JS


def regenerate_right_panel():
    rebuild_casascius_data_js()
    result = subprocess.run(
        [sys.executable, str(RIGHT_PANEL_SCRIPT)],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def main():
    args = parse_args()
    rows, fieldnames = read_csv_rows(args.csv)
    state = read_state(args.state)
    env_values = read_env(ENV_PATH)
    from_height = args.from_height
    if from_height is None:
        from_height = int(state.get("last_checked_height", initial_checked_height(rows)))
    to_height = fetch_tip(env_values, args.to_height)
    if to_height < from_height:
        raise RuntimeError(f"Tip height {to_height} is behind last checked height {from_height}.")
    if to_height == from_height:
        tip_time = fetch_tip_time(env_values, to_height)
        new_state = {
            "last_checked_height": to_height,
            "last_checked_block_time": tip_time,
            "previous_checked_height": from_height,
            "affected_address_count": 0,
            "changed_row_count": 0,
        }
        if args.dry_run:
            print(f"dry run: no new blocks after {from_height}; affected 0, changed 0")
        else:
            write_state(args.state, new_state)
            print(f"no new blocks after {from_height}")
            print("affected addresses: 0")
            print("changed CSV rows: 0")
        return

    with tempfile.TemporaryDirectory(prefix="casascius_update_") as tmpdir:
        affected, missing_archives = fetch_affected_addresses(env_values, rows, from_height, to_height, tmpdir)
        recomputed = fetch_recomputed_rows(env_values, affected, from_height, to_height, tmpdir)

    tip_time = fetch_tip_time(env_values, to_height)
    changed = apply_updates(rows, recomputed, tip_time)
    new_state = {
        "last_checked_height": to_height,
        "last_checked_block_time": tip_time,
        "previous_checked_height": from_height,
        "affected_address_count": len(affected),
        "changed_row_count": len(changed),
    }

    if missing_archives:
        new_state["missing_stxo_archive_tables"] = missing_archives

    if args.dry_run:
        print(f"dry run: checked {from_height + 1}-{to_height}, affected {len(affected)}, changed {len(changed)}")
        for address, before, after in changed[:20]:
            print(
                f"{address}: {before.get('Status')} {before.get('Balance')} -> "
                f"{after.get('Status')} {after.get('Balance')}"
            )
        if len(changed) > 20:
            print(f"... {len(changed) - 20} more changed rows")
        if missing_archives:
            print("missing stxo archive tables: " + ", ".join(missing_archives))
        return

    if changed:
        write_csv_rows(args.csv, fieldnames, rows)
    write_state(args.state, new_state)
    if changed and not args.skip_right_panel:
        regenerate_right_panel()

    print(f"checked {from_height + 1}-{to_height}")
    print(f"affected addresses: {len(affected)}")
    print(f"changed CSV rows: {len(changed)}")
    if missing_archives:
        print("missing stxo archive tables: " + ", ".join(missing_archives))
    if changed and not args.skip_right_panel:
        print("regenerated assets/right_panel_data.js")


if __name__ == "__main__":
    main()
