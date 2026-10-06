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
migrations 001–006, covering the projection, coordinator, enrichment,
independent validation state, optional physical bootstrap cursors, and the
live-group export index. Never edit an already applied migration to bypass
its recorded checksum.

Migration 006 creates `group_state_live_group_id` on `group_id` where
`utxo_count > 0`, together with validated checks requiring zero balance when
the corresponding total or eligible UTXO count is zero. Positive UTXO counts
may still have zero satoshis. Apply it to the empty canonical projection before seeding. The
normal migration refuses a populated projection; a separately reviewed,
measured build can explicitly call `store.migrate_live_export` with
`allow_populated=True`. That transaction sets maintenance memory to 64 MiB,
disables parallel maintenance workers, and caps temporary files at 2 GiB while
retaining the shared writer lock and five-minute statement timeout. These are
local settings. A failed or absent index blocks export.

Canonical state retains fully retired groups for historical provenance. Routine
export pages enumerate distinct live group IDs through the partial index, then
use the existing primary key to fetch all families of those groups before
timestamp lookups. Each valid group has at most seven supported families;
`fetch_size` bounds groups, so a page contains at most seven times that many
rows. An eighth family is checked only as a corruption sentinel and fails the
export. Retired siblings still supply first-disclosure, first-funding and
last-spend history; only wholly retired groups are skipped. Zero-satoshi groups
with positive UTXO counts remain included. All pages share one caller-owned
repeatable-read snapshot and never split a group across SQL pages.

The worker reduces each bounded live-group page into additive aggregate rows
and a histogram of exact exposed-input counts. Python applies the existing
migration scenario and script-subset corrections once per distinct signature,
using a cache capped at 8,192 signatures. Only qualifying detail groups cross
as complete family rows for the canonical detail reducer and attribution.
Both export paths share detail/top-100 and final CSV/metadata serialization;
the original family-row exporter remains the equivalence oracle and replay API.
This reduces repeated Python work and transferred rows without creating new
persistent tables. It still reads every live group and must pass the actual
900-second export and complete-boundary resource checks.

Each SQL page validates accounting and every referenced spend timestamp,
including retired families whose spend height is below the group's latest.
Whole-group balance tiers and the timestamp at the maximum spend height govern
all family selections. Pages bind the calculation versions and snapshot time;
Python verifies histogram, aggregate and detail coverage before accepting them.
Pause/deadline checks run for every page and processing chunk even when no group
qualifies for detail output. A scoped timer also cancels the owned export query
at the export deadline and is joined before the connection can be reused.
The same deadline starts before previous-generation preparation and validation;
it also covers sealed-receipt reuse, CSV generation, and sealing. Hashing,
copying, and writing check the same pause/resource/deadline guard in MiB chunks,
and CSV validation checks every 256 rows. Exact duplicate display identifiers
use a disposable SQLite UNIQUE index beside the staged detail CSV, with a 2 MiB
cache and memory mapping disabled. The index is removed on success or
interruption; only up to 100 requested membership matches remain in Python.
Marker writes check the guard after flushing and immediately before atomic
replacement. A sealed receipt remains reusable after a database acknowledgement
failure. Guard timings never enter artifact bytes or generation identities.
The count-only histogram is explicitly restricted
to the current named migration scenario; a future policy-sensitive scenario
must update that contract rather than silently reuse it.

Pause sets both database control and a `PAUSED` file. A running invocation yields
at a checked batch boundary; export checks the file at each page and bounded
processing chunk, together with the worker/backend resource monitor.
It does not forcibly terminate an in-flight SQL statement. Resume clears the
pause state; it does not install or load a scheduler. `bootstrap` deliberately
allows an explicitly requested bootstrap while normal scheduled work is paused.
The administrative `validate` command likewise runs while paused. Automatic
validation observes pause requests between its committed pages.

Defaults are a 45-second processing slice checked between batches, ten blocks per
incremental batch, 10,000 bootstrap rows, a 250,000-row batch ceiling, and a
0.25-second inter-batch pause. Undo retains at least 2,016 blocks, rounded out to
complete batches. The optional `undo_blocks` setting accepts integers from 1,000
through 10,000; it uses processed block height, not wall-clock age. These are not
a hard 45-second process deadline:
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
above are accepted. Legacy sources and the fallback accept integers from 1 through
100,000. The explicit `canonical_blocks` override accepts up to 1,000,000 for the
administrative `bootstrap` command; ordinary `once` processing, including reorg
re-seeding, resolves that override to at most 100,000. Omitted
sources use `bootstrap_rows`. Before each page, the worker selects the next
incomplete cursor in source-name order while holding the global writer lock.
The installer preserves and validates these overrides. They affect initialization
only; incremental and validation batch settings remain separate. Select values using
bounded source-specific measurements; this example does not enable a scheduler
or establish full-run performance acceptance.

One-time canonical rebuilds can use separate, measured resource settings:

```json
{
  "bootstrap_work_seconds": 180,
  "bootstrap_temp_buffers_mb": 128,
  "bootstrap_work_mem_mb": 32,
  "bootstrap_wal_compression": false,
  "bootstrap_memory_limit_bytes": 8589934592,
  "bootstrap_rows_by_source": {"canonical_blocks": 500000}
}
```

This is a candidate configuration to measure, not an established throughput or
memory guarantee. `bootstrap_work_seconds` accepts whole seconds from 5 through
300; omission inherits `work_seconds` (45 by default). `bootstrap_temp_buffers_mb`
accepts integers from 8 through 1,024 MiB, defaulting to the measured 8 MiB session
setting. `bootstrap_work_mem_mb` accepts 32 through 256 MiB, default 32.
`bootstrap_memory_limit_bytes` accepts 1 through 16 GiB, defaulting to the normal
memory guard (4 GiB). `bootstrap_wal_compression` accepts a boolean, default
`false`. `true` enables WAL full-page-image compression within each canonical
seed transaction; `false` leaves the server/session setting unchanged. This can
reduce WAL writes at a CPU cost and needs a measured trial. PostgreSQL 14 requires
superuser permission to change this setting; explicit enablement fails the page
if the connection lacks permission. Commit or rollback restores the previous
setting. These settings apply only to explicitly requested
canonical bootstrap work. Routine snapshots, validation, legacy bootstrap and
normal reorg recovery retain their existing resource settings. Parallel SQL
workers remain disabled; one coordinator still owns all heavy work.

The resource monitor starts before setting session `temp_buffers` or touching
temporary tables. Each canonical seed transaction overrides its own `work_mem`
after installing the normal transaction defaults; commit/rollback restores the
normal setting. Use a fresh worker connection for an administrative bootstrap:
PostgreSQL cannot change `temp_buffers` after that session first uses temporary
tables. Do not reuse that connection for ordinary processing. The command-line
worker and supervised children already open separate connections. Larger local
buffers and sort/hash budgets can multiply within a page; the private-memory and
free-disk guards remain active throughout. Record backend/worker CPU, private
memory, local-buffer and temporary I/O, WAL and desktop responsiveness before
increasing any value further.

The installer preserves and validates these knobs. Their resolved values and
canonical page caps are included in configuration fingerprints and bootstrap run
metrics. Changing them requires a reviewed new finite session; an existing
journal cannot silently inherit a new budget or resource policy. Retain its
already charged time and original absolute deadline during any reviewed transfer.

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

### Addressless bare-multisig history

In an unverified legacy diagnostic import, an unseen `script:<sha256>` group requires exact funding and spend history from
every source partition, including both NULL and empty addresses. Before querying
that history, the worker checks for a valid hash lookup index on `outputs` and
every spend archive. Missing coverage
stops the batch without advancing its checkpoint or substituting dates. A generic
address index or a P2PK-only script index does not satisfy this prerequisite.

Inspect one explicit source with the optional dry run:

```sh
"$Q_PYTHON" scripts/ensure_quantum_source_indexes.py \
  --table outputs --kind null_bare_script \
  --output "/absolute/private/quantum-state/null-bare-script-plan.json"
```

The proposed index is `(md5(lower(scripthex)),blockheight)` with included spend
height and script type, restricted to `(address IS NULL OR address='') AND
scripttype LIKE 'Multisig %'`. The fixed-size hash is only an access path: every
lookup also requires exact normalized script equality, including when hashes collide.
`--apply` builds only the named source after review; it does not build indexes
across all archives. Even an empty partial index requires reading its source
heap during construction. Measure incidence, build cost, free space and desktop
impact before scheduling that maintenance. No absence of addressless policies
has been proved by the current ingester's usual DSMS address fallback.

Future-archive policy is explicit: provision the same partial hash index on a
new archive while it is empty, or use this helper for that one archive before
null-script hydration resumes. The current source hook does not silently add
this index to existing archives. Until every relevant source has coverage, the
worker continues to reject this history lookup; it never falls back to a full
source scan. Ordinary source ingestion can continue independently.
Canonical-source initialization and its incremental successor do not use this
legacy-history hydration path; these optional indexes are not a prerequisite
for the canonical baseline.

## Bootstrap and independent validation

Initialize using an exact canonical height/hash and explicit starting boundary:

```sh
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" initialize \
  --height CANONICAL_HEIGHT --hash CANONICAL_BLOCK_HASH --start-after LAST_ACCEPTED_HEIGHT
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" bootstrap
```

Replace the capitalized arguments with verified values; these are placeholders.
Initialization leaves scheduling paused. The default seed reconstructs the full
history from canonical raw source in bounded pages, accumulating compact funding,
disclosure and last-spend metadata without copying the occurrence ledger.
Each source query covers at most 1,000 creation heights and returns one global
page plus a lookahead row. Ordered source streams collapse exact duplicate rows
before that global limit; raw branches have no separate row cap. Conflicting
copies of an occurrence stop the page before its state or cursor can commit.
When a historical page cannot change a saved family's balances, counts, dates,
disclosure hash or display value, its conflict update keeps the existing tuple.
The page cursor still commits normally. Zero-value UTXO additions and improved
metadata still update state; conflict locking can still generate WAL. This
avoids redundant replacement tuples without discarding historical evidence.
Canonical pages read prior disclosure evidence once per distinct group into a
bounded temporary result. New families inherit that result even when the page
contains no disclosure candidate. Only new or earlier evidence writes the
registry and propagates to retained sibling families. Incoming evidence still
requires a canonical header, and equal-height ties retain the saved hash.
Registry, family state and cursor commit together. This relies on the canonical
seed's existing family/registry invariant; it is not a repair of arbitrary
pre-existing metadata corruption. The independent UTXO accounting proof does
not certify historical disclosure dates, which require separate reconciliation.
`--canonical` remains a compatibility alias for this default. The explicit
`--legacy-unverified` option imports legacy tables for diagnostics only; that
projection cannot be exported or accepted for scheduling. Matching freeze heights
and balances cannot authenticate imported historical dates or disclosures.
Repeat bounded `bootstrap` invocations until
the projection reports ready, recording time, row counts, memory, and resumability.
Do not interpret a completed first page as a completed bootstrap.

For sustained initialization, explicitly launch the finite administrative
supervisor from the configured production checkout after reviewing its source
and resource settings:

```sh
"$Q_PYTHON" scripts/run_quantum_bootstrap.py --config "$Q_CONFIG" \
  --max-active-seconds 86400 --max-elapsed-seconds 172800 --rest-seconds 15
```

Both budgets are required for a new session: at most 24 hours of child work and
48 hours of elapsed time, including rests and source-readiness waits. Each child
uses the same resolved `bootstrap_work_seconds` as the worker, together with its
canonical page caps, bootstrap memory and free-space
guards. After reserving cleanup time, a remaining slice shorter than five seconds
(or the explicitly configured slice, if shorter) ends the session as
`budget_exhausted` without starting another child.
The supervisor stops at its finite budget or a ready projection; it does
not validate, export, deliver, enable a scheduler, or advance beyond the original
anchor. Completion of this command alone does not satisfy rollout acceptance.
The normal control row must remain paused throughout. An explicit new session
can work past that initial scheduling pause, without deleting the `PAUSED` file.

If its hard slice deadline interrupts the worker, the failed run and all measured
costs remain recorded. The supervisor may continue only after verifying its own
nonce-bound deadline signal, the exact finished failed run, complete resource
measurements without a breach, child/process-group cleanup, disappearance of
the identified backend, and the unchanged checkpoint, configuration and pause
state. Its journal records `verified_controlled_deadline` alongside the original
failure. This does not relabel a failed attempt as successful or permit it in
steady-boundary acceptance. External signals, unknown failures, missing evidence
and resource violations stop initialization for review. Old unclassified failures
cannot acquire this proof retroactively.

The first output line names a private `bootstrap_sessions/SESSION/session.json`
under `state_dir`. Resume that exact journal to retain its original deadline,
charged active time, anchor and pause token:

```sh
"$Q_PYTHON" scripts/run_quantum_bootstrap.py --config "$Q_CONFIG" \
  --resume "/absolute/private/quantum-state/bootstrap_sessions/SESSION/session.json"
```

A subsequent operator pause stops the session, including while its child is
working. Plain resume preserves that pause. After review, adding
`--acknowledge-pause` explicitly authorizes continuing the same finite session;
it still leaves normal scheduling paused. A changed implementation, driver,
configuration file, environment file, effective configuration, database endpoint
or initialization anchor stops continuation.
Review such changes before starting a new finite session. Source ingestion can
temporarily defer work; those waits consume elapsed time, and committed cursors
remain authoritative. Optional `--estimated-source-rows N` adds clearly labeled
catalog-based extrapolations to progress events; changing workload or group
reuse can make those estimates inaccurate.

A private administrative lock covers work and rest periods, while the worker's
database writer lock excludes other projection writers. Every child owns a
process group and identifies its PostgreSQL backend by database, start time and
a random handoff nonce. The child inherits the administrative lock before its
first database connection, closing the supervisor-crash gap before handoff. Its
absolute deadline also bounds connection startup and cleanup. Cancellation targets only that verified statement and
owned process group, never terminates a PostgreSQL backend, and allows a short
cleanup reserve before the overall budget. Each successful page commits its
state and cursor atomically. After a killed supervisor, resume conservatively
charges the entire unfinished slice reservation plus its two-second cleanup
allowance once and refuses to overlap a still-live child. Recovered active time
is conservative reservation accounting, rather than exact observed wall time.
Interrupted or failed attempts remain evidence requiring
review; an incomplete child result is never converted into successful run
accounting. The driver writes mode-0600 progress journals and child logs, without
duplicating the worker's database run records or printing credential values.

Portable driver checks run with `python3 scripts/test_quantum_bootstrap_driver.py`.
Setting `QUANTUM_BOOTSTRAP_TEST_DSN` to an explicit temporary-socket
`*_fixture` database additionally exercises real child completion, supervisor
kill/resume, pause acknowledgement and transactional deadline cancellation.

Stop any already running legacy Quantum builders before initialization. The seven
legacy table-builder entry points now call `guard_legacy_mutation` before DDL or
writes. Session advisory locks `(811947, 2)` then `(811947, 1)` span their batch
commits and exclude racing v2 migration/initialization. Once a projection row exists, every legacy
builder refuses to mutate the imported seed tables, including while v2 is paused
or seeding. There is no bypass flag. Original legacy tables remain available as
unverified historical evidence; no current header hash retroactively certifies
their height-only claims.
The current and historical legacy analyzers separately hold session lock
`(811947, 2)` from their first query until connection close. Explicit isolated
legacy analyses remain available after initialization, but cannot overlap a v2
worker or another legacy analyzer. The source readiness hook does not acquire
either Quantum lock.

For an already running, unpublished legacy diagnostic import, the explicit
`quantum_v2_store.transition_legacy_seed(conn, expected_height=H,
expected_hash=HASH)` API replaces only its compact seed/progress under both
writer locks. It requires `status=seeding`, the exact anchor and frontier, a
certified source, no accepted/generated/delivered requests and no incremental
batches. It preserves original legacy tables and existing orphan evidence,
discards derived seed/validation scratch, creates the canonical cursor, and
records the previous cursors and source checkpoint in a durable run audit within
the same transaction. Only the discarded anchor's exact height/hash validation
report is invalidated, and its complete original record is preserved in that
audit; unrelated historical reports remain untouched. Diagnostic legacy resets
and rollbacks retain source-derived disclosure events but do not relabel imported
group-state claims as orphan observations.
The API refuses completed imports; it is not a general published-state reset.

After bootstrap, complete both bounded validation phases while paused:

```sh
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" validate
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" status
```

Repeat `validate` until the persisted report passes; a successful process exit can
mean only that its bounded processing slice completed. The first phase reduces
raw source occurrences into separate compact validation groups. The second
compares every source/projection group and family through indexed keyset pages.
With migration 006's validated constraints and live index, projection keys come
only from live groups; retired rows are guaranteed to have zero accounting
values. Independent source keys are always included, so missing projection
groups and zero-value UTXOs still fail or reconcile correctly. Older sidecars
without 006 retain the full-history comparison. If 006 is recorded but its
index or validated constraints are missing or altered, comparison and final
verification fail closed. Reports identify which comparison scope was used.
Phases, cursors, cumulative totals, and mismatch examples survive interruption.
No unbounded final join is required to seal the report. The projection must stay
at the exact target height/hash during comparison. Each page certifies source
readiness and canonical identity. Validation/parser/grouping versions are bound
to the checkpoint; a changed version requires a fresh source pass.

Normal `once` invocations automatically complete a missing anchor proof before
advancing the projection or exporting. `export_request` independently requires a
canonical-source initialization and a passing anchor result with matching
validation/parser/grouping versions. This is
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

For diagnostic imports only, frozen legacy tables can use an optional physical scan after deploying all legacy
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

Read-only catalog estimates observed on 2026-10-05 put the five legacy diagnostic seed tables
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

### Sustained canonical initialization observations

The closed 2026-10-05 session `33554131d3234e0bb632dd5a5ccfcb3d`
advanced from 56,892,306 to 149,692,306 source occurrences in 152 bounded
invocations. Supervised child time was 5,897.43 seconds over 8,165.91 elapsed
seconds. The source advanced from 970,063 to 970,080; 15 invocations yielded to
ingestion. The operator reported that the computer remained responsive.
Normal scheduling stayed paused, with one worker/backend, 100,000-row source
pages, 45-second slices and 15-second rests between slices.

Sampled peak combined worker/backend private memory was 223.94 MB. Their
measured CPU totals were 792.32 and 3,274.74 seconds, respectively. Backend
process counters recorded 165.47 GB read and 251.12 GB written. Shared cluster
WAL increased by 317.85 GB across the available measured intervals; database
temporary-file counters increased by 435.22 MB. These shared counters include
other database activity and do not establish exclusive Quantum attribution or
retained disk growth. Minimum observed free space was 2.713 TB. No resource
measurement error or configured resource breach was recorded.

The deployment pause interrupted the final invocation after one committed page;
its durable run correctly remains failed (`SliceInterrupted`), with its resource
measurements retained. The other 151 runs succeeded. The interrupted invocation
has no end-of-run database counter sample, so the shared counter totals cover
151 intervals, not all 152. The resumable checkpoint is preserved; this session
is initialization evidence, not successful full-boundary acceptance.

The exact private evidence manifest is
`evidence/supervised-initialization-33554131d3234e0bb632dd5a5ccfcb3d/manifest.json`
under `state_dir`, SHA-256
`80c7c9bf3c49c12c9707ced0d4f42db98ab1ea4d08b039a4ab4a7e465fc989e5`.
It includes all persisted runs and the original session artifacts. A subsequent
read-only catalog observation measured 18.85 GB for group state and its indexes,
and 13.41 GB for disclosures and their indexes. These are incomplete-prefix
sizes, not final cardinality or total migration-storage estimates. Recent
throughput implies several more days of initialization; later script mix and
index growth can change that estimate substantially. Keep the disk reserve and
responsiveness gates in force.

The subsequent one-time profile used 500,000-row pages, 300-second slices,
512 MiB temporary buffers, 128 MiB work memory and an 8 GiB private-memory
guard. A PostgreSQL 14 WAL-compression trial processed 8.5 million occurrences
in 790.64 active seconds, peaking at 1.03 GiB combined private memory. Its two
completed slices achieved about 10,149 and 11,829 occurrences/second, versus
about 13,500 in the preceding uncompressed completed slice. These were different
historical ranges, not a controlled comparison. Compression was disabled after
this trial; normal scheduled limits remain unchanged.

A separate bounded, four-arm fixture compared the effective-disclosure cache
with source revision `7974f4a869726230af3bc27b89ea37cbf0f60fee` using one million
existing registry groups and a 100,000-occurrence page. All complete state and
checkpoint streams matched, including rollback cases. Counting the additional
temporary materialization, reducer shared reads fell from 520,370 to 220,019
blocks and backend CPU from 2.856 to 2.518 seconds. Warm page timings improved
by 7.5–29.4%; cache order and checkpoint timing prevent a production speedup
claim. Peak combined private memory was 267 MiB. The complete report SHA-256 is
`b65d59482b64d05150266f2b65f774a6a256c85bdc946e5cb28879c6a7a41748`;
this fixture does not establish full-bootstrap or unattended-operation acceptance.

## Export, publication and destination APIs

Local/archive-capable generations preserve legacy chart rows whose snapshot
folders are absent in `historical_archive_summaries.csv`. The manifest labels
them `legacy-v1-unreconciled` and `historical-summary-only`, declares their exact
heights, row count and retained catalog timestamps, and binds each row to the
original `historical_archived.csv` and `archived_index.csv` bytes saved under
`archive_summary_sources/`. This preserves evidence without certifying its
accounting or inventing missing detailed snapshots. A validated real snapshot
at the same height supersedes its summary. The conventional archive index still
advertises only actual retained snapshot folders.

The 2026-10-05 pre-rollout inventory found 4,274 such rows at 50 heights from
10,000 through 960,000 in both distributions. An isolated two-generation replay
preserved those rows and source bytes exactly. The private evidence manifest is
`evidence/archive-summary-preservation-20261005-final/manifest.json`, SHA-256
`e18b947a07b837255bda35a9b762a5d8296a617650e774c1cb9d7d923f8d3a59`.
This is retention evidence, not historical reconciliation or production
publication. Browser archive history validates the summary artifact lazily;
summary points cannot be selected as detailed snapshots. Failed requests retain
the installed generation and require an explicit retry instead of an immediate
fetch loop. Public Pages removes summary artifacts, source evidence, metadata
and capabilities along with its other intentional archive omissions.

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

Quantum Git commands use one pack thread, compression level 1, 64 MiB pack-window
and delta-cache budgets, and disable opportunistic auto-GC/maintenance for that
invocation. These are scoped command settings, not repository/global changes or
a total process-memory guarantee. Git transfers new reachable objects rather
than retransmitting every retained archive. Immutable validation still reads the
retained manifest payloads, so destination I/O must be measured separately.

Each Git command owns a process group. Timeout or cancellation terminates that
group before its supervisor releases the deploy lock. The outer 900-second
website timeout requests cooperative deployer cleanup; if the supervisor does
not acknowledge cancellation within 10 seconds, its live PID, lock, and staged
output remain intact and remaining destinations are deferred. Inspect that PID
and its children before recovery; do not remove its lock to force a retry.
SIGKILL or machine failure cannot run cooperative cleanup and requires the same
owner/process inspection.

The worker writes every destination attempt to private
`state_dir/delivery-attempts/<request>-<destination>-<id>.json`, initially as
running, then complete/failed with the accepted receipt or error, wall time,
worker CPU, and waited-child CPU deltas. Source/config fingerprints identify the
attempt. An unresponsive supervisor is recorded with its PID and explicitly
incomplete child CPU measurements. These records do not assert delivery peak
private memory or include delivery time in the analysis/export acceptance
budget. Interrupted running records and failed attempts remain evidence for
operator review; they are not discarded when a later attempt succeeds.

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

The worker also reserves 512 GiB of free disk by default (`disk_reserve_bytes`).
It checks the actual local PostgreSQL data, WAL and Quantum tablespace volumes,
plus the output-state volume, before processing and during resource sampling.
Crossing the reserve cancels the owned backend; loss of disk measurement also
stops work. Previously committed pages remain resumable. Do not delete source
or legacy evidence to bypass this guard. The reserve is configurable and bound
to acceptance evidence; disabling it is not accepted for scheduled operation.

Canonical initialization has a different capacity bound from the legacy seed.
Catalog estimates on 2026-10-05 put live outputs plus ten archives at 3.682 billion
occurrences, with 1.527 TB heap and 284.46 GB indexes. Those estimates include
post-anchor data and possible archive-movement overlap. Approximately 2.766 TB
was free. Canonical reconstruction retains compact facts for spent groups as well
as funded groups; the older 734-million-row legacy sizing exercise does not bound
this work. It does not create a second raw source copy.

A rollback-only source benchmark sampled three bounded creation windows with
26,583 distinct selected occurrences (69,749 selected rows across repeated
comparison passes). It used 32 MB work memory, no parallel query workers, a
512 MB private-memory guard, 30-second statement and 90-second overall deadlines,
and the global Quantum writer lock while the worker was paused. All source and
projection access was read-only except transaction-local temporary tables. The
old Python reducer and SQL reducer produced identical group state, disclosures,
and durable cursor coordinates in every comparison.

| Creation-window start | Outputs selected | Group/family rows | Live families at anchor 962000 | Temporary state heap+indexes | Temporary disclosure heap+indexes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100000 | 6,583 | 4,626 | 278 | 1.597 MB | 1.073 MB |
| 900000 | 10,000 | 6,243 | 576 | 2.204 MB | 1.507 MB |

The combined measured state/disclosure allocation was about 577–594 bytes per
local group/family. As an intentionally pessimistic all-unique scenario,
3.682 billion occurrences at 600 bytes would use about 2.21 TB before validation,
undo, additional WAL, future ingestion, and mature table/index bloat. The free
space observed above would leave only about 557 GB in that scenario, close to
the default 512 GiB reserve. Neither these small nonrandom windows nor their
within-window reuse ratios establish global distinct cardinality. Re-estimate
from sustained committed initialization pages and stop at the reserve; do not
lower the reserve based on this sample.

Warm comparisons were SQL 0.119s versus Python 0.172s in the early window and
SQL 0.173s versus Python 0.184s in the latest window. The early window contained
1,002 P2PK rows; the latest contained 1,966 Taproot rows and 102 Other rows. Early
main-thread Python CPU fell from 0.0613s to 0.0082s; this excludes the resource
monitor's sampling thread. Source I/O and cold curve caches inflated first-pass
comparisons substantially, so the much larger cold-versus-warm ratios are not
speedup estimates. Peak combined private memory stayed below 121 MB in these
samples. The latest SQL stages took 0.056s to load the bounded page, 0.068s to
classify, and 0.049s to reduce it. Ordinary script rows stayed in PostgreSQL;
P2PK, Taproot and bare-policy curve/policy checks remained in Python. Exceptional
rows use one temporary staging join rather than repeated page scans per insert
chunk. Repeated equal/later disclosures do not rewrite existing evidence.

These timings use initially empty temporary destination tables and warmed reads,
not the production projection's growing indexes, persistent WAL cost, or a full
1,000-block export. They do not certify the 30-minute boundary target, justify a
100,000-row production batch, or justify rewriting Python in another language.
Start canonical production work with the bounded 5,000-row budget, then measure
actual committed pages and adjust only within the resource gates.


`--enable` requires a `quantum-acceptance-v2` record in
`state_dir/acceptance.json`. A JSON declaration alone cannot enable scheduling.
Before writing the config or plist, the installer uses the configured production
Python to run `quantum_acceptance.py` against a read-only, repeatable-read database
snapshot while holding the shared Quantum writer lock. It requires a ready,
fully initialized canonical-source-seeded projection at the named 1,000-block
checkpoint, a completed request, completed projection/export steps, and exact completed delivery
and accepted-generation receipts for both destinations. The retained immutable
output and the accepted Git markers must match; both repositories must be on
`main`, and the standalone runtime must match the tested source.

The record includes `code_revision`, `implementation_sha256`, `config_sha256`,
`control_sha256`, `database`, `request_id`, `checkpoint_height`, `checkpoint_hash`,
`generation_id`, `website_commit`, `standalone_commit`,
`validation_report_sha256`, ordered `run_ids`, `active_seconds_per_boundary`,
`peak_private_memory_bytes`, and `reviews`. Source, effective nonsecret worker
settings, persisted boundary/confirmation settings, and both checkpoint hashes
are checked against actual evidence. The reviewed acceptance code revision must remain an ancestor of the clean
production runtime with no relevant source differences. The sealed generation
retains its original actual Git revision as provenance; it may differ after an
automation data amendment. Its implementation digest must match the tested
source. Data-only Git advances are allowed.
Environment contents and database credentials are never copied into run metrics.

Legacy freeze heights and matching balances do not prove canonical disclosure
or activity dates. Enablement requires `projection.seed_mode=canonical`; a legacy
seed cannot qualify through balance reconciliation alone. There is currently no
alternative full historical-provenance certificate.

The full accounting proof must pass the current parser/grouping/validation
versions and have positive source, UTXO and compared-group counts. A proof at the
candidate checkpoint is accepted directly. A proof at the unchanged canonical
anchor can instead cover the immediately following measured 1,000-block interval
when its retained batch journal is contiguous and canonical. An older anchor or
pruned journal requires explicit reconciliation at the candidate checkpoint for
this one-time acceptance gate; routine boundary processing does not acquire a
new full raw-source validation requirement.

Every persisted attempt for the chosen boundary must be listed, completed, and
carry matching code/config/control provenance plus contiguous ready start/end
checkpoints covering all 1,000 blocks. Every endpoint must still be canonical.
A measured `source_not_ready` ingestion yield may qualify: after rollback, the
worker records its actual durable endpoint and checks that its implementation
has not changed. This includes no-progress yields at an unchanged checkpoint
and yields after committed pages or an aborted export. Every such attempt's
time and memory still count. Bootstrap, validation-only, paused, unknown-deferral,
failed, incomplete-recovery or unmeasured attempts cannot qualify: measure a
fresh complete boundary rather than omit them. Older attempts missing their
durable endpoint are not inferred from a later run. The gate derives active
seconds by summing all those run wall times (including export) and private memory
by taking their maximum. Both
measurements must be positive, with valid worker/backend private-memory samples,
no measurement failures, and no resource breach. They must exactly match the
record and remain at most 1,800 seconds and 4 GiB. Delivery receipts are checked
separately; delivery time is outside the worker's measured analysis interval.
These gates are evidence checks, not performance promises.

Every measured run must also record the configured positive disk reserve and a
nonempty map of observed minimum free bytes on the production data, WAL,
tablespace and state volumes. All recorded minima must meet the reserve, with
no disk measurement failure or reserve breach. The installer preserves
`disk_reserve_bytes` (default 512 GiB) and refuses enablement with a zero reserve;
zero remains available only for explicit diagnostic/fixture configuration.

`reviews` maps each of `browser`, `recovery`, and `rollback` to a local report
`path` relative to state_dir and its exact `sha256`. Each JSON report must state
its `kind`, `passed: true`, a nonempty reviewed `summary`, and the accepted
`implementation_sha256`, `config_sha256`, `request_id`, `generation_id`,
`checkpoint_height`, and `checkpoint_hash`. These are explicit operator reviews
of retained test/results evidence; hashing binds the reviewed report to this
rollout and does not automate or replace the review. No acceptance record or
review report is synthesized by the installer.

Only after these checks does the installer load
`com.wickedsmartbitcoin.quantum` for the current GUI user. Its LaunchAgent invokes
`once` every 60 seconds at background priority. It does not run Quantum inside
the ingestion callback or hourly producer, and enabling does not clear an
existing pause. Logs live under `~/Library/Logs/WickedSmartBitcoin/quantum/`.

To stop automatic invocations, first pause the worker, then unload its plist with
`launchctl bootout` for the owning user. Loading/unloading launchd and changing
database pause state are separate actions. Reload only after inspecting retained
state and confirming acceptance still covers the runtime. Never remove active
locks or staged output merely to force the next run.

## Recovery and rollback

For controlled catch-up or acceptance, limit analysis to an explicit target:

```sh
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" once --through 963000
"$Q_PYTHON" "$Q_WORKER" --config "$Q_CONFIG" deliver
```

Replace the example height with the reviewed target. The ceiling is checked
after request discovery under the writer lock. A future request is deferred
without creating an analysis attempt; an unfinished request at the ceiling
still resumes normally. `deliver` retries the durable website and standalone
destinations without discovery, initialization, validation, projection changes,
or export. It uses the same writer lock, pause state, canonical checks and
deployment guards. Delivery failure remains retryable independently for each
destination. Inspect receipts rather than interpreting a successful invocation
as proof that every destination accepted the generation. Scheduled `once`
invocations have no ceiling unless explicitly configured by a caller.

Ordinary retry resumes committed cursors and retries retained destination output.
A source reorg invalidates readiness/requests; the projection uses retained batch
before-images to roll back to a canonical boundary. Recovery verifies the entire
required batch suffix against the current projection's height and hash before
restoring any row, then restores one complete newest batch per transaction. Pause,
resource limits and the worker deadline apply between batches; the deadline also
cancels an in-flight undo query. An interrupted rollback may retain an orphaned
intermediate frontier. The next invocation resumes recovery before permitting
deltas, exports or delivery from that frontier.

Undo maintenance deletes one oldest complete batch per action, only when its end
height is at least `undo_blocks` behind the processed frontier. The parent row and
both undo tables disappear through atomic foreign-key cascades; child rows are
never pruned independently. A batch crossing the retention cutoff remains intact.
Caught-up ticks perform this bounded housekeeping when needed and return to cheap
indexed checks once no expired batch remains. Metrics record deleted batch ranges,
the retained rollback floor and whether more cleanup is pending. The seed anchor,
current state/disclosure, orphan evidence and source data remain unchanged.

If the required history predates the retained rollback floor, or a missing batch
or hash gap breaks the suffix, recovery marks the projection for reseeding before
applying any before-image. This floor can be newer than the original verified seed
anchor. Bounded canonical reconstruction preserves observed disclosure evidence
and prior immutable publications. Increasing `undo_blocks` later cannot restore
already pruned history. Cancellation or failure during one prune/undo transaction
retains its complete prior checkpoint; repeatedly oversized batches need diagnosis,
not independently committed partial undo deletion. Measure undo/index bytes and WAL
across real incremental boundaries before claiming a production storage bound.
Exercise shallow, interrupted and beyond-window recovery in a disposable database
before claiming production rollback acceptance.

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
- [x] Apply checked migrations 001–006 (2026-10-05); this alone is not rollout acceptance.
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

Canonical creation pages and source delta batches also use the durable
`policy_parse_cache` from migration 003 for bare multisig policies. Requests are
deduplicated by exact locking-script bytes and looked up/inserted in batches of
at most 1,024 unique scripts. Records are immutable and keyed by locking-script
SHA-256, parser version, and evidence SHA-256. Bare policies use a separate
evidence domain from committed redeem/witness-script parsing. Recognized and
unresolved results survive worker restarts; a new parser version or different
spending evidence gets a new key. Cache provenance records where parsing was
first observed and never supplies a funding or disclosure date. Those dates
still come from actual canonical output/spend rows. P2SH/P2WSH coverage remains
the documented script-address heuristic; this cache does not expand it.

Store-only fixtures without migration 003 retain the pure parser path. If that
migration is recorded but its cache table is missing, processing fails before
advancing the checkpoint. Cache writes, projection changes and cursor advances
share the same transaction; failures roll all three back. Cache hits verify the
exact bare-policy serialization and parser/evidence binding before use.

A disposable fixture profile used four SQL statements cold and three warm for
5,000 outputs sharing two scripts (including relation and writer-lock checks).
With 2,050 unique unresolved scripts, three batches used ten statements cold
and seven warm, taking about 35 ms and 19 ms respectively; the table and index
occupied 1.155 MB in that small fixture. This measures bounded cache overhead,
not production reuse, long-run storage or a full-boundary speedup. Run
`QUANTUM_ANALYSIS_TEST_DSN=... python scripts/test_quantum_policy_cache.py` against
an explicit temporary `*_fixture` database for cold/warm state parity,
version/evidence invalidation, transaction rollback and date-provenance tests.

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
`test_quantum_subprocess.py`,
`test_quantum_resources.py`, `test_quantum_scheduler.py`, and
`test_quantum_browser_contract.mjs`. `test_quantum_v2_validation.py` covers bounded
accounting, source movement, version changes, legacy write guards, and metadata
samples; `test_quantum_v2_analysis.py` covers script commitments, curve validity,
calendar activity, group membership, and migration serialization weights.
`test_measure_quantum_seed.py` checks bounded sampling, cursor continuation,
read-only operation, and cleanup of its optional temporary sizing model.
`test_quantum_null_script_indexes.py` checks narrowly scoped index planning,
missing-index guards before source reads, NULL/empty policy history, and exact
script matching when a hash prefilter admits an unrelated candidate.
`test_quantum_canonical_seed.py` reproduces a stale orphan-only disclosure that
passes balance validation, verifies publication rejection, and checks the atomic
transition and corrected canonical dates. Its database fixtures use
`QUANTUM_CANONICAL_SEED_TEST_DSN`.
`test_quantum_sql_export.py` compares all six export files and all 127 script
selections against the family-row exporter, including group-wide tiers, retired
family activity, zero-value outputs and corrupt source state. Its PostgreSQL
tests require `QUANTUM_SQL_EXPORT_TEST_DSN` on an isolated temporary fixture.
PostgreSQL suites require their explicit
temporary-socket, `*_fixture` database DSNs; never point them at production.
The addressless-policy suite uses `QUANTUM_NULL_SCRIPT_TEST_DSN`.
For UI changes run `test_quantum_v2_browser.py`,
`test_quantum_v2_preview_browser.py`, and the Quantum target of
`test_stage2_refresh_atomicity.py`. The preview fixture uses temporary immutable
publications to check corrupt/stale response rejection, hidden data installation,
visible rendering, and unchanged iframe and homepage state. The existing
`test_homepage_preview_refresh.py quantum_exposure` command also checks the
currently published data format. Packaging requires `test_pages_build.py` and
`build_pages_dist.sh`; inspect the copied artifact after runtime dependency changes.
