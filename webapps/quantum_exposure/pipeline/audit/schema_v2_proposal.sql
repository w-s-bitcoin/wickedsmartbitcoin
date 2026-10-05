-- Quantum Exposure v2 schema proposal, PostgreSQL 14 compatible.
-- DESIGN ARTIFACT ONLY. Do not apply to the production database as a migration.
-- Owner: analysis projection, not a replacement for CoreToPSQL source tables.
-- Validate cardinalities, source completeness, disk headroom and query plans first.
-- IMPLEMENTATION ORDER: deploy checkpoint/run + request + compact group_state first
-- through an adapter over existing source facts. output_fact/script normalization is
-- a later measured replacement, not permission to clone multi-billion-row tables.
-- These CREATE statements show the target relationships; do not run them wholesale.
-- Phase 1 uses existing script-level heuristics; new verified-key metrics are versioned.
-- Default transaction wrapper makes accidental inspection sessions rollback the DDL.
BEGIN;
CREATE SCHEMA quantum_v2;

-- Block identity is retained even for orphaned blocks. A canonical height has one hash.
-- Parent linkage and height/hash agreement are verified by the writer because initial
-- backfill may begin at a checkpoint rather than store every ancestor immediately.
CREATE TABLE quantum_v2.chain_block (
    block_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    block_hash bytea NOT NULL UNIQUE CHECK (octet_length(block_hash) = 32),
    height integer NOT NULL CHECK (height >= 0),
    parent_hash bytea CHECK (octet_length(parent_hash) = 32),
    block_time bigint NOT NULL CHECK (block_time >= 0),
    canonical boolean NOT NULL
);
CREATE UNIQUE INDEX chain_block_canonical_height_uq
    ON quantum_v2.chain_block(height) WHERE canonical;

-- A run is tied to a source generation/watermark, rule version and code revision.
-- Source watermark must be committed AFTER source ingestion and STXO archival agree.
-- source_generation identifies the immutable source revision through this target,
-- not each later tip notification. Retries reuse a run; changed inputs create one.
-- The unique tuple prevents duplicate jobs for identical inputs. The application
-- keeps these input/version fields immutable and validates version identifiers.
CREATE TABLE quantum_v2.analysis_run (
    run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_block_hash bytea NOT NULL REFERENCES quantum_v2.chain_block(block_hash),
    source_generation text NOT NULL,
    methodology_version text NOT NULL,
    parser_version text NOT NULL,
    grouping_version text NOT NULL,
    label_version text NOT NULL,
    scenario_version text NOT NULL,
    export_version text NOT NULL,
    schema_version text NOT NULL,
    code_revision text NOT NULL,
    state text NOT NULL CHECK (state IN ('building','validated','published','failed','orphaned')),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    manifest_sha256 bytea CHECK (octet_length(manifest_sha256) = 32),
    UNIQUE (target_block_hash, source_generation, methodology_version,
            parser_version, grouping_version, label_version, scenario_version,
            export_version, schema_version, code_revision)
);
CREATE TABLE quantum_v2.checkpoint (
    consumer text PRIMARY KEY,
    block_hash bytea NOT NULL REFERENCES quantum_v2.chain_block(block_hash),
    run_id bigint NOT NULL REFERENCES quantum_v2.analysis_run(run_id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ingestion publishes a small readiness event only. Heavy work is owned by one
-- background worker, never executed synchronously by Bitcoin blocknotify.
-- Wakeups coalesce, but the worker chooses the earliest missing 1,000-block boundary.
-- A recovery poll derives missing targets from the committed source watermark, so a
-- lost notification or restart cannot skip a snapshot. Apply desired confirmation lag
-- before marking a target ready; preserve its actual canonical target hash.
-- One queue row references the exact target and complete version tuple in analysis_run.
-- Application verifies canonicality, interval eligibility and terminal transitions.
CREATE TABLE quantum_v2.snapshot_request (
    run_id bigint PRIMARY KEY REFERENCES quantum_v2.analysis_run(run_id),
    state text NOT NULL CHECK (state IN ('pending','running','complete','retry','orphaned')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    requested_at timestamptz NOT NULL DEFAULT now(),
    retry_after timestamptz
);
CREATE INDEX snapshot_request_pending_idx
    ON quantum_v2.snapshot_request(requested_at) WHERE state IN ('pending','retry');

-- Attempts are retained. A retry copies the latest committed cursor into a new
-- numbered attempt. Each bounded data batch commits its cursor in the SAME database
-- transaction as its projection changes; it never commits an in-memory-only cursor.
-- Partial uniqueness prevents two running or successful attempts for one step.
-- The writer enforces dependency order, increasing attempt numbers, immutable
-- terminal attempts, and cursor schema compatibility with the recorded version.
CREATE TABLE quantum_v2.run_step (
    run_id bigint NOT NULL REFERENCES quantum_v2.analysis_run(run_id),
    step_name text NOT NULL,
    attempt integer NOT NULL CHECK (attempt > 0),
    state text NOT NULL CHECK (state IN ('running','complete','retry','failed')),
    cursor_version integer NOT NULL CHECK (cursor_version > 0),
    progress_cursor jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(progress_cursor) = 'object'),
    lease_owner text,
    lease_until timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    retry_after timestamptz,
    last_error_code text,
    PRIMARY KEY (run_id, step_name, attempt),
    CHECK ((state = 'running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
        OR (state <> 'running' AND lease_owner IS NULL AND lease_until IS NULL)),
    CHECK ((state = 'running' AND finished_at IS NULL)
        OR (state <> 'running' AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX run_step_running_uq ON quantum_v2.run_step(run_id, step_name)
    WHERE state = 'running';
CREATE UNIQUE INDEX run_step_complete_uq ON quantum_v2.run_step(run_id, step_name)
    WHERE state = 'complete';
-- Lease timestamps alone do not exclude a stalled writer. One session advisory lock
-- owns the global projection writer. Every batch also checks its attempt/lease owner
-- under a row lock; losing ownership aborts the batch. Recovery marks an abandoned
-- running attempt retry/failed before inserting another. Do not steal a live lock.

-- Destinations can carry different artifact subsets and hence different manifests.
-- The application verifies each expected manifest belongs to this run and capability
-- set. Database constraints require acceptance of exactly that destination manifest.
-- Publication acceptance is destination-specific; source analysis need not rerun
-- when a destination is unavailable. The application retries delivery idempotently.
-- A destination advisory lock covers transfer and acceptance. Before retrying, the
-- writer checks the desired generation; superseded retries cannot replace a newer
-- accepted release. SQL below limits concurrent transferring rows per destination.
CREATE TABLE quantum_v2.delivery (
    run_id bigint NOT NULL REFERENCES quantum_v2.analysis_run(run_id),
    destination text NOT NULL,
    state text NOT NULL CHECK (state IN ('pending','transferring','accepted','retry','failed','superseded')),
    expected_manifest_sha256 bytea NOT NULL CHECK (octet_length(expected_manifest_sha256) = 32),
    accepted_manifest_sha256 bytea CHECK (octet_length(accepted_manifest_sha256) = 32),
    accepted_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    retry_after timestamptz,
    last_error_code text,
    PRIMARY KEY (run_id, destination),
    CHECK ((accepted_at IS NULL) = (accepted_manifest_sha256 IS NULL)),
    CHECK (accepted_manifest_sha256 IS NULL
        OR accepted_manifest_sha256 = expected_manifest_sha256),
    CHECK (state <> 'accepted'
        OR (accepted_at IS NOT NULL AND accepted_manifest_sha256 IS NOT NULL))
);
CREATE INDEX delivery_retry_idx ON quantum_v2.delivery(retry_after)
    WHERE state IN ('pending','retry');
CREATE UNIQUE INDEX delivery_transferring_uq ON quantum_v2.delivery(destination)
    WHERE state = 'transferring';

-- Preserve key serialization: HASH160(compressed(Q)) differs from HASH160(uncompressed(Q)).
-- point33 records validated EC-point normalization. A Taproot x-only key is not
-- automatically the same reporting identity as both +/-Q serializations.
CREATE TABLE quantum_v2.key_material (
    key_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encoding smallint NOT NULL CHECK (encoding IN (1,2,3)), -- 1=x-only,2=compressed,3=uncompressed
    key_bytes bytea NOT NULL,
    validated_point33 bytea CHECK (octet_length(validated_point33) = 33),
    valid_curve_point boolean,
    UNIQUE (encoding, key_bytes),
    CHECK ((encoding = 1 AND octet_length(key_bytes) = 32)
        OR (encoding = 2 AND octet_length(key_bytes) = 33)
        OR (encoding = 3 AND octet_length(key_bytes) = 65))
);
CREATE TABLE quantum_v2.key_alias (
    key_id bigint NOT NULL REFERENCES quantum_v2.key_material(key_id),
    alias_kind smallint NOT NULL CHECK (alias_kind IN (1,2)), -- 1=HASH160(serialization),2=x-only
    alias_bytes bytea NOT NULL,
    PRIMARY KEY (alias_kind, alias_bytes, key_id),
    CHECK ((alias_kind = 1 AND octet_length(alias_bytes) = 20)
        OR (alias_kind = 2 AND octet_length(alias_bytes) = 32))
);

-- Each policy row is an immutable parser result. A parser upgrade inserts a new
-- version; earlier evidence and membership retain their original policy_id.
-- SQL enforces version uniqueness; the writer enforces immutability and hash bytes.
CREATE TABLE quantum_v2.script_policy (
    policy_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    policy_sha256 bytea NOT NULL CHECK (octet_length(policy_sha256) = 32),
    policy_script bytea NOT NULL,
    policy_kind text NOT NULL,
    threshold_m smallint,
    key_count_n smallint,
    parse_status text NOT NULL CHECK (parse_status IN ('unparsed','recognized','unsupported','invalid')),
    parser_version text NOT NULL,
    UNIQUE (policy_sha256, parser_version),
    CHECK ((threshold_m IS NULL AND key_count_n IS NULL)
        OR (threshold_m IS NOT NULL AND key_count_n IS NOT NULL
            AND threshold_m > 0 AND key_count_n >= threshold_m))
);
CREATE TABLE quantum_v2.policy_key (
    policy_id bigint NOT NULL REFERENCES quantum_v2.script_policy(policy_id),
    key_position integer NOT NULL CHECK (key_position >= 0),
    key_id bigint NOT NULL REFERENCES quantum_v2.key_material(key_id),
    PRIMARY KEY (policy_id, key_position)
);
CREATE INDEX policy_key_key_idx ON quantum_v2.policy_key(key_id, policy_id);

-- Raw locking script occurs once. Classification is an immutable versioned result
-- so parser changes do not rewrite output facts or silently alter older runs.
CREATE TABLE quantum_v2.script (
    script_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    script_sha256 bytea NOT NULL UNIQUE CHECK (octet_length(script_sha256) = 32),
    script_pubkey bytea NOT NULL,
    display_address text
);
-- script_family uses a documented numeric dictionary; reserve an explicit unknown value.
CREATE TABLE quantum_v2.script_parse (
    script_id bigint NOT NULL REFERENCES quantum_v2.script(script_id),
    parser_version text NOT NULL,
    script_family smallint NOT NULL CHECK (script_family >= 0),
    program bytea,
    PRIMARY KEY (script_id, parser_version)
);
CREATE INDEX script_family_program_idx ON quantum_v2.script_parse(parser_version, script_family, program)
    WHERE program IS NOT NULL;

-- Creation block identity is part of output occurrence identity. Do not enforce global
-- UNIQUE(txid,vout): historical duplicate transactions must retain distinct occurrences.
-- One immutable narrow fact replaces repeated wide copies across active_* tables.
CREATE TABLE quantum_v2.output_fact (
    output_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_block_id bigint NOT NULL REFERENCES quantum_v2.chain_block(block_id),
    created_height integer NOT NULL CHECK (created_height >= 0),
    txid bytea NOT NULL CHECK (octet_length(txid) = 32),
    vout integer NOT NULL CHECK (vout >= 0),
    script_id bigint NOT NULL REFERENCES quantum_v2.script(script_id),
    amount_sats bigint NOT NULL CHECK (amount_sats >= 0 AND amount_sats <= 2100000000000000),
    is_coinbase boolean NOT NULL,
    spendability smallint NOT NULL DEFAULT 0 CHECK (spendability IN (0,1,2)), -- unknown,ordinary,provably-unspendable
    UNIQUE (created_block_id, txid, vout)
);
CREATE INDEX output_fact_created_height_brin ON quantum_v2.output_fact USING brin(created_height);
CREATE INDEX output_fact_script_idx ON quantum_v2.output_fact(script_id, created_height, output_id);

-- Separate immutable spend events allow range scans by spend height without rewriting
-- creation facts. Orphan events are retained and excluded via chain_block.canonical.
-- Application enforces one canonical spender per output and no spend before creation.
CREATE TABLE quantum_v2.spend_event (
    spending_block_id bigint NOT NULL REFERENCES quantum_v2.chain_block(block_id),
    spending_height integer NOT NULL CHECK (spending_height >= 0),
    output_id bigint NOT NULL REFERENCES quantum_v2.output_fact(output_id),
    spending_txid bytea CHECK (octet_length(spending_txid) = 32),
    vin integer CHECK (vin >= 0),
    PRIMARY KEY (spending_block_id, output_id)
);
CREATE INDEX spend_event_height_idx ON quantum_v2.spend_event(spending_height, output_id);
CREATE INDEX spend_event_output_idx ON quantum_v2.spend_event(output_id, spending_height);

-- Typed evidence preserves actual disclosure time, source, parsing quality and reorg
-- provenance. A legacy 'spent-script' heuristic must never become 'verified key'.
-- event_fingerprint covers source block/location and target material using specified
-- canonical serialization. Parser revisions append interpretations of the same event.
CREATE TABLE quantum_v2.exposure_event (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_fingerprint bytea NOT NULL CHECK (octet_length(event_fingerprint) = 32),
    observed_block_id bigint NOT NULL REFERENCES quantum_v2.chain_block(block_id),
    observed_height integer NOT NULL CHECK (observed_height >= 0),
    source_output_id bigint REFERENCES quantum_v2.output_fact(output_id),
    source_txid bytea CHECK (octet_length(source_txid) = 32),
    source_vin integer CHECK (source_vin >= 0),
    target_key_id bigint REFERENCES quantum_v2.key_material(key_id),
    target_script_id bigint REFERENCES quantum_v2.script(script_id),
    policy_id bigint REFERENCES quantum_v2.script_policy(policy_id),
    evidence_kind text NOT NULL CHECK (evidence_kind IN
        ('locking-key','spending-key','revealed-policy','spent-script-heuristic','unresolved')),
    quality text NOT NULL CHECK (quality IN ('verified','heuristic','unresolved','invalid')),
    parser_version text NOT NULL,
    UNIQUE (event_fingerprint, parser_version),
    CHECK (target_key_id IS NOT NULL OR target_script_id IS NOT NULL)
);
CREATE INDEX exposure_event_key_height_idx ON quantum_v2.exposure_event(target_key_id, observed_height)
    WHERE target_key_id IS NOT NULL;
CREATE INDEX exposure_event_script_height_idx ON quantum_v2.exposure_event(target_script_id, observed_height)
    WHERE target_script_id IS NOT NULL;
CREATE INDEX exposure_event_height_idx ON quantum_v2.exposure_event(observed_height);

-- Reporting identity is deliberately distinct from ownership and from exact pubkeys.
-- Grouping v1 can reproduce HASH160/address groups; later key metrics get a new version.
CREATE TABLE quantum_v2.analysis_group (
    group_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    grouping_version text NOT NULL,
    group_kind smallint NOT NULL CHECK (group_kind >= 0),
    group_bytes bytea NOT NULL,
    UNIQUE (grouping_version, group_kind, group_bytes)
);
CREATE TABLE quantum_v2.group_script (
    group_id bigint NOT NULL REFERENCES quantum_v2.analysis_group(group_id),
    script_id bigint NOT NULL REFERENCES quantum_v2.script(script_id),
    PRIMARY KEY (group_id, script_id)
);
CREATE INDEX group_script_script_idx ON quantum_v2.group_script(script_id, group_id);

-- Deliberate bounded duplication for fast current-state queries, rebuilt from facts.
-- Writer must verify all denormalized fields equal output_fact; source occurrence is
-- canonical, unspent as of checkpoint, and spendability policy is applied explicitly.
CREATE TABLE quantum_v2.current_utxo (
    output_id bigint PRIMARY KEY REFERENCES quantum_v2.output_fact(output_id),
    script_id bigint NOT NULL REFERENCES quantum_v2.script(script_id),
    created_height integer NOT NULL CHECK (created_height >= 0),
    amount_sats bigint NOT NULL CHECK (amount_sats >= 0)
);
CREATE INDEX current_utxo_script_idx ON quantum_v2.current_utxo(script_id)
    INCLUDE (amount_sats, created_height);

-- One row per reporting group and family, rather than all historical outputs for it.
-- Group-wide activity is derived across its family rows when required by methodology.
-- First funding and first disclosure are different fields. 'Exposed balance since'
-- (if desired) is a third metric, not an alias for either field.
CREATE TABLE quantum_v2.group_state (
    group_id bigint NOT NULL REFERENCES quantum_v2.analysis_group(group_id),
    script_family smallint NOT NULL CHECK (script_family >= 0),
    balance_sats bigint NOT NULL CHECK (balance_sats >= 0),
    utxo_count bigint NOT NULL CHECK (utxo_count >= 0),
    first_received_height integer CHECK (first_received_height >= 0),
    last_spend_height integer CHECK (last_spend_height >= 0),
    first_disclosure_height integer CHECK (first_disclosure_height >= 0),
    exposed_sats bigint NOT NULL CHECK (exposed_sats >= 0 AND exposed_sats <= balance_sats),
    exposed_utxo_count bigint NOT NULL CHECK (exposed_utxo_count >= 0 AND exposed_utxo_count <= utxo_count),
    last_run_id bigint NOT NULL REFERENCES quantum_v2.analysis_run(run_id),
    PRIMARY KEY (group_id, script_family)
);
CREATE INDEX group_state_positive_balance_idx ON quantum_v2.group_state(group_id)
    WHERE balance_sats > 0;

-- Reorg undo stores affected compact projection rows only, not another copy of history.
-- Row images are application-versioned; facts/events are retained as orphan evidence.
-- Never prune within configured rollback horizon; deeper reorg rebuilds a projection
-- from a verified checkpoint and fails publication closed until parity checks pass.
CREATE TABLE quantum_v2.projection_undo (
    run_id bigint NOT NULL REFERENCES quantum_v2.analysis_run(run_id),
    operation_number bigint NOT NULL CHECK (operation_number >= 0),
    projection text NOT NULL CHECK (projection IN ('current_utxo','group_state')),
    row_key jsonb NOT NULL,
    before_row jsonb,
    PRIMARY KEY (run_id, operation_number)
);

-- Deliberately omitted: broad output INCLUDE indexes, giant prebuilt cubes, a table
-- per snapshot, and partitioning every entity. Revisit after representative plans.
-- For very large facts, range-partition output_fact by creation height and spend_event
-- by spending height only after redesigning keys/FKs to meet PostgreSQL partitioned
-- uniqueness rules. Start shadow backfill in bounded batches; never duplicate the
-- existing multi-TB source blindly. Existing archive source remains available for
-- validation and backfill until exact parity is demonstrated.
--
-- Worker policy (initial conservative limits, tune from measured boundary latency):
-- one analysis writer; max_parallel_workers_per_gather=0; work_mem=32MB;
-- lock_timeout=2s; statement_timeout=5min; bounded transactions/time slices;
-- temp_file_limit chosen against free disk budget (initial proposal: 2GB per worker).
-- work_mem is per plan operation, not a total process/RAM limit. Set limits on the
-- quantum role/session only, never global PostgreSQL. Yield/retry on foreground
-- pressure or ingestion lag. Strict total RSS/I/O caps require OS-level scheduling.
-- A full historical backfill has a separate explicit budget and is never started
-- automatically by an online boundary job.
--
-- Writer protocol (one writer advisory lock):
-- 1. Verify source committed generation and parent hash; record run/building.
-- 2. Read immutable source manifest or bounded REPEATABLE READ source snapshot.
-- 3. Apply new output/spend/reveal events, recording affected projection before-images.
-- 4. Update only affected UTXOs and group states; atomically advance checkpoint.
-- 5. Validate sums, canonical hashes and complete coverage; mark run validated.
-- 6. Export existing static CSV/JSON contracts from one completed run; publish payloads
--    before generation manifest; then mark published. Retry publication idempotently.
-- Separate identity annotation provenance/validity from chain facts; annotations may
-- be retroactive, while exposure disclosure must be as-of the target block.
ROLLBACK;
