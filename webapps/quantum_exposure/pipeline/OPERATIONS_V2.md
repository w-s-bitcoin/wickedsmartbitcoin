# Quantum v2 operations

This is the operating contract for the implemented v2 pipeline. It is **not a
record that production rollout or automatic scheduling has passed acceptance**.
Full bootstrap, independent accounting validation, representative boundary
performance, destination publication, and rollback evidence must be recorded
before enabling the LaunchAgent. Update the rollout checklist below with actual
results; a passing fixture suite does not supply production evidence.

Read the [audit](audit/README.md), [redesign](audit/REDESIGN.md),
[retention contract](RETENTION.md), and
[automation guide](../../../scripts/automation/README.md) together with this
document. The source database and legacy tables remain separate from the additive
`quantum_v2` schema. Python coordinates bounded SQL and streams exports; replacing
the language is not required to eliminate full-history rebuilds.

## Durable state and boundaries

`quantum_v2.source_state` identifies the completed ingestion height/hash, readiness,
and source epoch. A height seen in `blockheader` alone does not certify readiness.
`control` starts paused, uses 1,000-block boundaries and six confirmations by
default, and records an explicit `start_height`. Discovery inserts every eligible
missing boundary after that starting point. It does not invent snapshots in
earlier intentional history gaps.

The coordinator selects the earliest unfinished request. The projection,
bootstrap cursors, batch journal, runs, steps, and destination deliveries are
durable database state. A directory's existence never proves successful analysis.
Requests progress through pending/running, analyzed, and complete; canonical hash
changes orphan incompatible requests. A crash retains committed batch cursors and
isolated output for retry. The next session owning advisory lock `(811947, 2)`
marks an abandoned running attempt interrupted.

Website and standalone deliveries retry independently after analysis. A failed
push does not require another projection or export. A request completes only when
both destinations are complete or superseded. Accepted destination generation,
height, request ID, and remote commit are recorded. Older retries cannot roll a
destination back over a newer accepted height/request.

## Configuration and worker commands

Use the project's Python environment containing `psycopg2`, `python-dotenv`, and
the Bitcoin RPC client. Configure explicit, separate production and standalone
repository paths; the old nested standalone default is not a reliable location.
Keep the state directory outside both published repositories. The configuration
contains a path to the existing environment file, not copied credential values.

The installer defaults to printing its intended paths. With `--install` it writes
a mode-0600 configuration and a per-user plist, without loading the job:

```sh
python3 scripts/install_quantum_scheduler.py \
  --production-repo "/absolute/production/repository" \
  --standalone-repo "/absolute/standalone/repository" \
  --python "/absolute/project/python" \
  --env-file "/absolute/existing/environment/file" \
  --state-dir "/absolute/private/quantum-state" \
  --install
```

The installer refuses to replace an already loaded job, including in install-only
mode. It preserves existing measured tuning and label revision when rewriting an
unloaded configuration. Paths remain separate argv values, including spaces; no
shell command is assembled from them. Symlinked config/plist files are refused.

The following commands are real database/worker operations, not smoke tests.
Set these three variables to the installed paths before using them:

```sh
Q_PYTHON="/absolute/project/python"
Q_WORKER="/absolute/production/repository/webapps/quantum_exposure/pipeline/run_quantum_worker.py"
Q_CONFIG="/absolute/private/quantum-state/config.json"

"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" status
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" migrate
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" pause
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" validate
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" resume
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" once
```

`status` is also the default subcommand. `migrate` applies checked, additive
migrations 001–005, covering the projection, coordinator, enrichment,
independent validation state, and optional physical bootstrap cursors. Never edit an already applied migration to bypass
its recorded checksum.

Pause sets both database control and a `PAUSED` file. A running invocation yields
at a checked batch boundary; export checks the file every 1,000 streamed groups.
It does not forcibly terminate an in-flight SQL statement. Resume clears the
pause state; it does not install or load a scheduler. `bootstrap` deliberately
allows an explicitly requested bootstrap while normal scheduled work is paused.
The administrative `validate` command likewise runs while paused. Automatic
validation observes pause requests between its committed pages.

Defaults are a 45-second processing slice checked between batches, ten blocks per
incremental batch, 10,000 bootstrap rows, a 250,000-row batch ceiling, and a
0.25-second inter-batch pause. These are not a hard 45-second process deadline:
an in-flight statement can run to its separate timeout, export has its own
900-second budget, and Git delivery has separate timeouts. Sessions use 32 MiB
`work_mem`, no parallel query workers, a 2 GiB temporary-file limit, and short
lock waits. Worker and backend are lowered in process priority where permitted.

Optional `bootstrap_rows_by_source` settings in the private configuration tune
initialization separately for each source. For example:

```json
{
  "bootstrap_rows": 10000,
  "bootstrap_rows_by_source": {
    "active_key_outputs": 100000,
    "active_p2sh_outputs": 100000,
    "active_p2wsh_outputs": 100000,
    "active_p2tr_outputs": 25000,
    "active_bare_ms_outputs": 5000,
    "other:source": 5000,
    "canonical_blocks": 5000
  }
}
```

These are row caps, including for `canonical_blocks`. Only the seven source names
above are accepted; every cap must be an integer from 1 through 100,000. Omitted
sources use `bootstrap_rows`. Before each page, the worker selects the next
incomplete cursor in source-name order while holding the global writer lock.
The installer preserves and validates these overrides. They affect initialization
only; incremental and validation batch settings remain separate. Select values using
bounded source-specific measurements; this example does not enable a scheduler
or establish full-run performance acceptance.

## Source readiness hook

`scripts/install_quantum_source_hook.py --source /absolute/CoreToPSQL.py` checks
the exact insertion points without running ingestion and reports the source hash.
After review, `--apply --expected-source-sha256 REVIEWED_SHA256` acquires the
existing `/tmp/onchain_update_bitcoin_data.lock`, rechecks the reviewed bytes, keeps a
`CoreToPSQL.py.pre-quantum-v2` backup, copies the small hook module beside the
source, and installs the reviewed changes. Changed insertion points or an active
ingestion lock stop installation. An existing backup is not overwritten.
An idempotent run verifies every installed begin/finish/reorg block and its AST
placement; an import-only, incomplete, duplicated, or misplaced hook is rejected.
Upgrading the original hook installation adds a fail-closed reorg-search tail and
keeps a separate `CoreToPSQL.py.pre-quantum-reorg-guard` backup. If no common
ancestor is found within the source's 20-header search, ingestion stops with
readiness false. Source recovery is required before retrying; the Quantum worker
cannot repair orphan rows in the ingestion database. This prevents a canonical
new tip from being appended to an unrepaired deeper source fork.

The hook calls `begin` before chain mutations to invalidate readiness and advance
the epoch. `reorg` records the canonical rollback boundary in the ingestion
transaction. `finish` checks the database tip against Bitcoin RPC and verifies
that no unapplied input rows remain before certifying completion. It performs no
Quantum analysis, export, Git operation, or HTTP publication.

`scripts/certify_quantum_source.py --env-file /absolute/existing/environment/file`
is the one-time readiness initializer for an already completed ingest. It holds
the real ingestion lock, checks the tip coinbase and RPC identity, and writes only
small readiness records. It never runs an ingest to make the check pass. A failed
certification leaves readiness false until the source is repaired/certified.
Certification also refuses the caller's `.storage-maintenance` marker, checking
before and after acquiring the lock. The caller directory defaults to the
environment file's parent and must contain `update_bitcoin_data.sh`; pass
`--source-dir /absolute/external/caller/directory` when the environment file lives
elsewhere. Refusing an existing maintenance/ingestion gate does not change readiness.
Do not remove an active ingestion lock or maintenance marker to force progress.

## Source indexes and interrupted builds

Use `scripts/ensure_quantum_source_indexes.py` for one explicit spent-output
archive and one access path at a time. Its default connects to describe the DDL
and writes the requested evidence JSON, but does not build an index:

```sh
"$Q_PYTHON" scripts/ensure_quantum_source_indexes.py \
  --table stxos_900000_999999_archive --kind creation \
  --output "/absolute/private/quantum-state/index-creation.json"
```

`--kind nonkey_address` selects the partial address lookup with included creation,
spend, and script-family fields. Add `--apply` only for the reviewed migration.
Builds use `CREATE INDEX CONCURRENTLY`, the same writer lock as the worker, zero
parallel maintenance/query workers, 64 MiB maintenance memory, and a 45-minute
statement timeout. This one-time migration permits 32 GiB of temporary files;
normal worker sessions retain their 2 GiB limit. Plan disk space and I/O from the
measured source sizes, not solely a sampled extrapolation.

An interrupted concurrent build can leave an invalid index. Inspect its
definition, validity, evidence file, free space, and failure cause before retrying.
The normal invocation refuses an invalid prior index. `--apply --recover-invalid`
can replace only the deterministic `qe2_<archive>_<kind>` index owned by this tool
when it is invalid; it never drops a valid existing index. Existing valid indexes
are retained and their definitions recorded for review. A failed build is not
evidence that the required access path is available.

## Bootstrap and independent validation

Initialize using an exact canonical height/hash and explicit starting boundary:

```sh
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" initialize \
  --height CANONICAL_HEIGHT --hash CANONICAL_BLOCK_HASH --start-after LAST_ACCEPTED_HEIGHT
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" bootstrap
```

Replace the capitalized arguments with verified values; these are placeholders.
Initialization leaves scheduling paused. The default seed uses the compatible
legacy freeze with canonical source checks. `--canonical` selects the more
expensive raw-source reconstruction. Repeat bounded `bootstrap` invocations until
the projection reports ready, recording time, row counts, memory, and resumability.
Do not interpret a completed first page as a completed bootstrap.

Stop any already running legacy Quantum builders before initialization. The seven
legacy table-builder entry points now call `guard_legacy_mutation` before DDL or
writes. Session advisory locks `(811947, 2)` then `(811947, 1)` span their batch
commits and exclude racing v2 migration/initialization. Once a projection row exists, every legacy
builder refuses to mutate the imported seed tables, including while v2 is paused
or seeding. There is no bypass flag. Common legacy freeze heights contain no block
hash, so the seed's canonical identity still requires independent validation.
The current and historical legacy analyzers separately hold session lock
`(811947, 2)` from their first query until connection close. Explicit isolated
legacy analyses remain available after initialization, but cannot overlap a v2
worker or another legacy analyzer. The source readiness hook does not acquire
either Quantum lock.

After bootstrap, complete both bounded validation phases while paused:

```sh
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" validate
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" status
```

Repeat `validate` until the persisted report passes; a successful process exit can
mean only that its bounded processing slice completed. The first phase reduces
raw source occurrences into separate compact validation groups. The second
compares every source/projection group and family through indexed keyset pages.
Phases, cursors, cumulative totals, and mismatch examples survive interruption.
No unbounded final join is required to seal the report. The projection must stay
at the exact target height/hash during comparison. Each page certifies source
readiness and canonical identity. Validation/parser/grouping versions are bound
to the checkpoint; a changed version requires a fresh source pass.

Normal `once` invocations automatically complete a missing anchor proof before
advancing the projection or exporting. `export_request` independently requires a
passing anchor result with matching validation/parser/grouping versions. This is
a full per-group baseline proof, not a sample or a fresh full-chain scan at every
later boundary. Periodic explicit `validate` runs can check the current checkpoint.
`validation_result` retains reports keyed by exact target height/hash. Validation
uses advisory lock `(811947, 3)` and its own scratch tables, without changing
source or projection rows. Programmatic APIs remain available on an idle
connection: `migrate`, `initialize`, bounded `step`, and `verify`.

The source pass reads raw outputs/archives, independently accounts for BIP30
occurrence exceptions, and builds current group/family balances, UTXO counts,
eligible balances, and eligible counts. The comparison covers all group/family
keys, records totals and mismatch examples, and persists a final validation
result. It does **not** certify historical disclosure/activity dates or identity
labels; those require their separate evidence/fixtures. Legacy imported label and
policy annotations remain explicitly versioned annotations, not newly verified
key evidence. Do not set `accounting_passed` while the pass is incomplete or has
mismatches.

A mismatch blocks publication; the worker does not alter state to make it pass.
After an independently reviewed projection repair, explicitly restart comparison
against the retained, canonical raw-source reduction:

```sh
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" validate --recompare
# Resume subsequent bounded slices without restarting the comparison:
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" validate
```

`quantum_v2_metadata_validation.sample_metadata(conn, group_ids,
max_occurrences=5000, seconds=30)` supplies a separate bounded metadata report for
explicit, repeatable group selections. It checks group-wide earliest funding,
earliest disclosure, and latest actual spend. Key-group occurrence enumeration
uses `key_outputs_all`, then re-reads each occurrence from raw outputs/archives;
it cannot prove that this historical ledger omitted no occurrence. Non-key address
histories use raw source address indexes. Missing raw history, missing enumeration
indexes, unsupported null-address script lookup, or an exhausted row budget is
reported as unresolved and does not pass. Timeouts fail the sample operation.
Save the returned JSON outside the repositories and retain the exact selected IDs.
This operation neither resets the full accounting proof nor changes its status.

Genesis contributes public-key disclosure at height zero but no UTXO or funding.
First funding is the first actual fundable output; BIP30 original occurrences
retain their genuine earlier funding/disclosure while their overwritten balances
are removed without inventing a spend. `first_exposed_*` remains a CSV compatibility
alias for first disclosure. The first height at which a group held an exposed
balance is not inferred from either date and remains unavailable unless tracked.

### Bootstrap capacity planning

Frozen legacy tables can use an optional physical scan after deploying all legacy
mutation guards. Enable each selected family explicitly while the worker is paused:

```sh
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" bootstrap-physical \
  --source active_key_outputs --blocks 1024
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" bootstrap
```

The allowed sources are the five legacy active families. Canonical reconstruction
and `other:source` retain logical occurrence cursors. The physical cursor freezes
the source relation identity, heap extent, checkpoint, and prior logical cutoff;
it excludes that already reduced prefix permanently. Each transaction consumes
at most the configured row cap within the bounded heap range, committing exact
CTID progress and reductions together. A dense page resumes after its last
consumed tuple. Earliest display selection follows logical occurrence order even
when physical order differs. A temporary durable origin table supports that
selection and is truncated atomically when initialization becomes ready.

At the usual 8 KiB PostgreSQL block size, 1,024 blocks bound an 8 MiB source heap
range. This does not bound TOAST, index, metadata lookup, or projection-write I/O;
the row cap and resource monitor still apply. Relation replacement, rewrite,
growth/truncation, loss of unique occurrence identity, or freeze drift fails closed
and requires reseeding. Ordinary VACUUM may truncate an empty tail and therefore
also trigger that conservative check. Same-page manual DML cannot be detected
through relation metadata; the deployed mutation guards and immutable-source
operating contract are required. Never fall back to a logical cursor after
physical contributions have begun.

Read-only catalog estimates observed on 2026-10-05 put the five legacy seed tables
at roughly 734 million rows: 471 million key-history rows, 69 million P2SH,
177 million P2TR, 15 million P2WSH, and 2.5 million bare-multisig rows. Their last
recorded statistics were from August 14, so these are planning estimates, not
counts or acceptance evidence. The source `outputs` estimate was approximately
165 million rows, with October 4 statistics.

At 10,000 rows per page, 734 million seed rows imply at least 73,415 pages; the
default 0.25-second pause alone adds about 5.1 hours before SQL and I/O. Budget
bootstrap separately from the 30-minute steady-boundary acceptance target.
Larger explicit bootstrap pages or shorter pauses require measured private-memory
and responsiveness evidence. Catalog `n_distinct` estimates for these skewed
history tables are not a reliable forecast of compact group cardinality; use the
completed reducer and validation totals before making storage/performance claims.

Use `scripts/measure_quantum_seed.py` for explicitly bounded planning samples,
one invocation at a time while the normal worker is paused:

```sh
"$Q_PYTHON" scripts/measure_quantum_seed.py \
  --dsn "dbname=bitcoin_data" --table active_key_outputs \
  --height VERIFIED_FREEZE_HEIGHT --start-height 900000 --end-height 901000 \
  --rows 10000 --temp-state \
  --output "/absolute/private/quantum-state/seed-key-900000.json"
```

Replace the freeze placeholder and choose a creation window at or below it.
The sampler requires the named family's recorded freeze to match that target.
Allowed tables are the five legacy active families. The query returns at most
100,000 rows through an occurrence keyset, and records its plan, first/last cursor,
partial balances/counts, distinct groups, source tuple widths, catalog estimates,
query/reduction time, private memory, CPU, process I/O, and shared database/WAL
counters. To continue within a full page's ending block, pass that height as
`--start-height` and its transaction/output as `--after-txid`/`--after-vout`.
`row_limit_reached` is not proof that the window has been exhausted.

Without `--temp-state`, the connection is read-only. With the flag, the only
writes create a transaction-local compact row/index size model that is dropped
on commit; no source or projection rows are changed. Populated eligibility/hash
columns in this model are sizing assumptions, not verified analysis. Missing
raw-script hydration and key/policy verification costs are explicitly excluded
from the measured producer cost. The sampler holds the coordinator lock to avoid
overlapping a worker, uses the resource guard, and saves failed as well as completed
measurement reports.

Sample each family across early, middle, and recent creation windows, rather than
using the first bare-multisig page to forecast the full seed. For this late-chain
target, useful candidate starts are 1,000/400,000/900,000 for keys,
300,000/600,000/900,000 for P2SH, 500,000/700,000/900,000 for P2WSH,
710,000/850,000/950,000 for P2TR, and 100,000/500,000/900,000 for bare multisig.
Use narrow windows, record empty samples, and adjust to the actual retained freeze.
These are repeatable stratified planning samples, not an unbiased cardinality
estimate or evidence that an entire boundary meets acceptance.

On 2026-10-05, five completed samples at freeze height 962,000 requested the
creation window 900,000–901,000, a 25,000-row cap, and the temporary sizing model.
The reports are `quantum-v2-seed-{key,p2sh,p2wsh,p2tr,bare_ms}-900000.json` in the
operator's private evidence directory (`/private/tmp` for this run). Sizes below
include the temporary table's heap and primary-key index; elapsed time covers
the complete invocation, including measurement overhead. MB and GB are decimal.

| Family | Source rows sampled | Distinct group-family rows | Last creation height | Heap + index bytes / group-family | Elapsed seconds | Sampled peak private MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Keys | 25,000 | 11,821 | 900,019 | 349 | 4.22 | 91.2 |
| P2SH | 25,000 | 10,383 | 900,372 | 314 | 3.39 | 78.1 |
| P2WSH | 25,000 | 6,101 | 900,648 | 435 | 2.25 | 71.7 |
| P2TR | 25,000 | 6,526 | 900,036 | 438 | 3.26 | 76.6 |
| Bare multisig | 21,542 | 21,524 | 901,000 | 345 | 1.28 | 75.7 |

Keys contain 11,811 distinct reporting groups split into 11,821 group-family
rows. Four samples reached their row cap before the end of the requested window;
only the bare-multisig sample exhausted that window. The model's mean tuple width
ranged from 226 to 287 bytes before heap/index overhead. All five resource reports
completed without measurement errors or a memory-limit violation. The 2-second
memory sampling interval can miss brief peaks, and these small samples do not
certify the full producer's memory use or runtime.

For conservative capacity planning, round the measured heap/index footprint up
to 500 bytes per group-family and provision the conditional all-unique case:
734 million estimated history rows × 500 bytes ≈ 367 GB of compact state.
This is an upper scenario for this row-count/row-width model, not an estimate of
actual unique groups or a hard storage bound: the source row estimate is stale,
real display identifiers and labels can be larger, and future state can grow.
Repeated groups should reduce cardinality, but these bounded pages cannot quantify
that reduction across the full history.

Reserve additional space for independent validation groups/indexes, retained undo
and journal records, parser/attribution records, WAL and replication retention,
temporary sort/index work, table/index bloat, and staged exports. Do not treat the
367 GB figure as the migration's total disk requirement. The operator observed
approximately 2.5 TB free during this run; recheck available space and actual
relation/WAL growth throughout bootstrap and validation. Measure the production
SQL reducer separately: this sampler transfers bounded history rows to Python,
and its timings omit raw script hydration, cryptographic eligibility checks, and
persistent projection writes.

## Export, publication and destination APIs

The canonical exporter emits aggregate cubes and detail from the same grouped
facts, including exact per-script exposed counts and amounts. Group balance
determines threshold eligibility. Activity uses canonical spend time, and
multisig groups are counted as distinct reporting groups. Do not run the legacy
multisig count-correction pass over these exports.

Snapshots declaring `subset_correction_version=script-mask-mobius-wu-v1` also
publish `dashboard_script_corrections.csv` and exact integer
`migration_weight_wu` in their aggregates. The compact signed corrections remove
double counting when a reporting group spans selected script families and
preserve the migration scenario's mixed-input transaction packing. The browser
verifies this artifact before installing the snapshot; `All` uses its direct
rollup. Corrections remain with compact active/archive history. Historical supply
charts already sum disjoint amounts and do not fetch these files for every point.

The delivery module exposes these explicit-root operations:

| API | Contract |
| --- | --- |
| `prepare_output(previous_data_dir, new_output_dir, target_height)` | Copy compact history into isolated staging, preserving gaps, the latest 21 snapshots including the target, genesis, and 50,000-block anchors. Move aged compact snapshots to archives. |
| `finish_output(new_output_dir, metadata, generation)` | Rebuild catalogs/history from staged aggregates, validate exact current values, and seal the immutable generation. |
| `deliver_website(data_dir, production_repo, request_id)` | Write scoped `quantum-<request>` staging under `/tmp/animations_deploy_staging`, write `.complete` last, invoke the existing deployer, and verify the remote generation/commit receipt. |
| `deliver_standalone(data_dir, standalone_repo, request_id=None)` | Copy the runtime dependency closure and changed verified objects, protect unrelated edits, use ordinary fetch/merge/commit/push, and verify the remote receipt. |

Website delivery retains onchain priority, main-branch checks, complete-stage
requirements, and dirty-worktree protection. Standalone interrupted copies can
resume only when their recorded owned paths still match expected bytes. Git
conflicts and unrelated changes require inspection; delivery never force-pushes,
resets, or sweeps unrelated edits into its commit.

The shared Git deploy lock publishes a fully written PID inode atomically and
holds its exclusive `flock` descriptor through the deployment. Lock age never
overrides a live PID, including older deployments that do not use `flock`.
Dead-owner recovery requires the inode lock and PID/inode rechecks; malformed
locks are retained for inspection. Release removes only its own unchanged
PID/inode, so an earlier owner cannot delete a replacement lock.

`published_generation.json` format 2 contains provenance versions, source/target
identity, destination capabilities, and a mapping from logical names to
`generations/objects/<prefix>/<sha256>.<extension>`. Every artifact has an exact
byte length/hash and CSV row count where applicable. Payload objects and the
generation manifest precede the root marker. Validation checks required mappings,
safe paths, actual byte hashes, current detail/aggregate conservation, top-100
values/ranking, and historical values. Reusing a generation ID requires identical
provenance and already verified immutable output.

`metadata.methodology_by_snapshot` distinguishes each retained snapshot's actual
versions. Older exports lacking v2 provenance are labeled
`legacy-v1-unreconciled`; sealing a new generation does not certify their numbers
or activity labels retroactively. Snapshot/chart tooltips expose that distinction.
Legacy spend-height `1` placeholders display an unknown date, not a fabricated
January 2009 spend. An explicitly versioned v2 record may still represent a real
spend at height 1. Existing raw historical files are not rewritten for this UI fix.

Browsers retain format-1 compatibility. For format 2, the current compact view
resolves immutable URLs and verifies bytes before installation; explicit detail
loads verify their own object lazily. Refresh preserves the last complete visible
generation on failure and rechecks the marker before commit. A selected older
full dataset may remain in verified session memory only while advertised compact
hashes agree, or after the whole snapshot ages out of retention. Changed compact
data cannot be paired with a stale full table. Full-row expansion no longer
downloads the entire block-height/date lookup.

Local manifests retain compact archive capability across generations. Initial
legacy migration can import existing local archive folders even if the old public
catalog was empty. Delivery stores compact archive payloads as immutable objects
without overwriting the ignored legacy `archived/` directories. Full raw archive
tables are not copied. Pages explicitly prunes archive capability, older full-row
exports, and unreferenced immutable objects **in the copied build only**. This
preserves the intentional public/local difference. Source/standalone object
garbage collection remains deferred until a reader-retention and rollback policy
is defined; delivery currently does not delete old immutable reader URLs.

## Resource evidence and scheduler enablement

The runtime memory gate is combined worker/backend **private resident bytes plus
non-shared swapped bytes**, reported as
`peak_combined_private_memory_bytes`. The acceptance record calls that measured
value `peak_private_memory_bytes`. Darwin raw physical footprint can attribute
PostgreSQL shared buffers to each backend and is retained only as a diagnostic.
Shared VM-object resident counts are not process-private RSS. Kernel page tables
are excluded from the private metric and must not be claimed as measured there.
The default sampling interval is two seconds; this is a sampled cancellation guard,
not a kernel-enforced allocation cap. Lost mid-query measurements cancel the
backend rather than silently disabling the guard.

Use `scripts/test_quantum_resources.py` for the private-allocation and guard
fixtures. Cluster WAL and database temporary-file counters are labeled shared
database/cluster measurements, not exclusively Quantum I/O. Record complete
boundary active time, CPU, private memory, temporary I/O, index size, and exported
bytes; a small source probe or one bootstrap page is not a full-boundary benchmark.

`--enable` additionally requires `state_dir/acceptance.json`. It must record actual
`code_revision`, checkpoint height/hash, generation ID, both accepted destination
commits, `active_seconds_per_boundary`, `peak_private_memory_bytes`, and true
`accounting_passed`, `recovery_passed`, `rollback_passed`, and `browser_passed`
results. Measurements must be finite/nonnegative, at most 1,800 active seconds per
boundary and 4 GiB private memory. Commit/hash identities must be valid. These are
rollout gates, not performance promises.

Enablement also requires clean relevant production runtime files and a tested
code revision that remains an ancestor with no relevant source changes. The
installer then loads `com.wickedsmartbitcoin.quantum` for the current GUI user.
Its LaunchAgent invokes `once` every 60 seconds, at background priority; it does
not run Quantum inside the ingestion callback or hourly producer. Logs live under
`~/Library/Logs/WickedSmartBitcoin/quantum/`.

To stop automatic invocations, first pause the worker, then unload its plist with
`launchctl bootout` for the owning user. Loading/unloading launchd and changing
database pause state are separate actions. Reload only after inspecting retained
state and confirming acceptance still covers the runtime. Never remove active
locks or staged output merely to force the next run.

## Recovery and rollback

Ordinary retry resumes committed cursors and retries retained destination output.
A source reorg invalidates readiness/requests; the projection uses retained batch
before-images to roll back to a canonical boundary. If the required history
predates the retained anchor, it enters reseed recovery and needs bounded canonical
reconstruction. Preserve orphan evidence and prior immutable publications during
that recovery. Exercise both shallow and deep paths in a disposable database before
claiming production rollback acceptance.

Operational rollback starts by pausing/unloading the new worker. Keep legacy
tables, source data, prior accepted artifacts, and schema migration records.
Restoring a website generation requires its complete coherent marker/payload set
and compatible runtime through an ordinary reviewed Git commit; merely replacing
a legacy marker can point at newer mutable root files. Do not reset production
history or drop the v2 schema as a routine rollback. If reverting the external
source hook, verify the saved source backup against intervening ingestion changes
and use the same real ingestion lock; do not overwrite unrelated source edits.

The disposable-Git fixture
`DeliveryTests.test_ordinary_rollback_restores_coherent_data_and_runtime_without_rewriting_history`
publishes two generations with different runtime bytes, restores the previous
aliases, marker and complete runtime in a third ordinary commit, then verifies a
fresh clone of the local remote. Both immutable generations remain valid and the
newer publication remains an ancestor. This proves the commit procedure in a
fixture; it does not claim that a production rollback has been performed.

## Rollout evidence still required

- [x] Install and verify the source hook; the installed external writer SHA-256 is `645e5d2a7f60eb183dc49076f9a8b26cd49f57362034dc008557315c5075e7fd` (2026-10-05). Real ingestion certified height 970,041, hash `00000000000000000001e1452ec8e3d10a961115d48a15aa0547f897174ad216`. Recheck live readiness before work.
- [x] Build the two missing indexes on `stxos_900000_999999_archive` concurrently and verify validity. The creation-height index is 3,564,666,880 bytes; the non-key address lookup index is 16,346,177,536 bytes. Neither replaces or drops a valid existing index.
- [ ] Finish bounded bootstrap at an exact canonical checkpoint and demonstrate restart.
- [x] Apply checked migrations 001–005 (2026-10-05); this alone is not rollout acceptance.
- [ ] Finish the full independent raw-source accounting proof and record the exact report.
- [ ] Validate historical date/disclosure limitations and chosen enrichment revision.
- [ ] Measure a complete representative 1,000-block boundary under the private-memory gate.
- [ ] Verify both destination commits and the Pages/standalone runtime dependency closure.
- [ ] Demonstrate interrupted export, retry, reorg recovery and operational rollback.
- [ ] Record browser acceptance and acceptance.json from that evidence, then enable scheduling.

The completed index builds took 343.07 and 482.19 seconds, with sampled combined
private memory of 241.6 and 283.1 MB respectively. Backend CPU was 271.77 and
290.19 seconds; backend read/write counters were 391.48/19.76 GB and
408.24/37.64 GB. These are one-time index-build measurements, not steady-boundary
performance. Sixty concurrent `SELECT 1` samples had median 0.1693 ms, p95
0.6367 ms, and maximum 1.9576 ms; this is an observational database latency probe,
not proof of every interactive application's responsiveness.

Legacy write guards were committed as `793f30f2a6` and installed/pushed on
production as `4aba30b71f`. They prevent the old builders from changing the
initialized v2 seed. Five resource-monitored physical bootstrap pilots then
committed between 5,000 and 30,102 rows per source in 1.84–5.74 seconds, with
sampled combined private memory of 65.6–166.6 MB. These pages differ in density,
script work, and cache state; they do not establish a full-bootstrap speedup or
the 1,000-block acceptance target. A later 60-sample latency probe during bare
multisig seeding measured median 0.1940 ms, p95 0.5264 ms, and maximum 5.4155 ms.

Multisig parsing caches at most 32,768 validated-length SEC-key results. A
12,000-row CPU-only equivalence profile measured 1.430 to 0.013 seconds for
repeated policies, 1.435 to 0.162 seconds for a mixed-policy fixture, and about
0.5% overhead for all-unique keys. Maximum cache allocation was approximately
8.1 MB in that isolated profile. Actual source-key reuse must be measured before
claiming that speedup for production initialization or boundary processing.

The installed ingestion writer commits headers, all output insert pages, spend
updates, and pending-input deletion together. A crash before that commit rolls
back the entire batch. Each archival range inserts and deletes rows in one
transaction; a crash between ranges can leave committed spent rows in `outputs`.
Both the projection and independent validator read live plus archived rows.
The source hook therefore permits deferred physical archival but never certifies
a partially committed block from this writer. Its reorg detector now fails closed
when no common ancestor exists in its 20-block search window; source recovery is
required before certification and Quantum reconstruction can proceed.

Portable fixtures: `bash scripts/check_project.sh`. Focused tests include
`test_quantum_immutable_generation.py`, `test_quantum_v2_delivery.py`,
`test_quantum_resources.py`, `test_quantum_scheduler.py`, and
`test_quantum_browser_contract.mjs`. `test_quantum_v2_validation.py` covers bounded
accounting, source movement, version changes, legacy write guards, and metadata
samples; `test_quantum_v2_analysis.py` covers script commitments, curve validity,
calendar activity, group membership, and migration serialization weights.
`test_measure_quantum_seed.py` checks bounded sampling, cursor continuation,
read-only operation, and cleanup of its optional temporary sizing model.
PostgreSQL suites require their explicit
temporary-socket, `*_fixture` database DSNs; never point them at production.
For UI changes run `test_quantum_v2_browser.py` and the Quantum target of
`test_stage2_refresh_atomicity.py`. Packaging requires `test_pages_build.py` and
`build_pages_dist.sh`; inspect the copied artifact after runtime dependency changes.
