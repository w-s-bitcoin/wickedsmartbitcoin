-- Incremental analytical sidecar. No source/legacy relation is altered.
CREATE SCHEMA IF NOT EXISTS quantum_v2;
CREATE TABLE IF NOT EXISTS quantum_v2.schema_migration (
    version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quantum_v2.projection (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    status text NOT NULL CHECK(status IN ('seeding','ready','needs_reseed')),
    seed_mode text NOT NULL DEFAULT 'legacy' CHECK(seed_mode IN ('legacy','canonical')),
    anchor_height integer NOT NULL CHECK(anchor_height>=0), anchor_hash text NOT NULL,
    height integer NOT NULL CHECK(height>=0), block_hash text NOT NULL,
    methodology_version text NOT NULL DEFAULT 'group-accounting-v2',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quantum_v2.bootstrap_cursor (
    source_table text PRIMARY KEY,
    last_height bigint NOT NULL DEFAULT -1, last_txid text NOT NULL DEFAULT '', last_vout integer NOT NULL DEFAULT -1,
    complete boolean NOT NULL DEFAULT false, rows_processed bigint NOT NULL DEFAULT 0
);
CREATE TABLE quantum_v2.group_state (
    group_id text COLLATE "C" NOT NULL, script_type text COLLATE "C" NOT NULL,
    balance_sats bigint NOT NULL DEFAULT 0 CHECK(balance_sats>=0),
    utxo_count bigint NOT NULL DEFAULT 0 CHECK(utxo_count>=0),
    eligible_sats bigint NOT NULL DEFAULT 0 CHECK(eligible_sats>=0 AND eligible_sats<=balance_sats),
    eligible_utxos bigint NOT NULL DEFAULT 0 CHECK(eligible_utxos>=0 AND eligible_utxos<=utxo_count),
    first_received_height integer, first_disclosure_height integer, first_disclosure_hash text, last_spend_height integer,
    display_group_id text COLLATE "C" NOT NULL DEFAULT '', details text NOT NULL DEFAULT '', identity text NOT NULL DEFAULT '',
    PRIMARY KEY(group_id,script_type)
);
CREATE TABLE quantum_v2.disclosure (
    group_id text COLLATE "C" PRIMARY KEY, exposed_height integer NOT NULL CHECK(exposed_height>=0), exposed_hash text NOT NULL
);
-- Observation evidence survives canonical rollback and all projection resets.
-- Kept out of canonical exports; public observation and canonical disclosure differ.
CREATE TABLE quantum_v2.orphan_disclosure (
    group_id text COLLATE "C" NOT NULL, exposed_height integer NOT NULL, exposed_hash text NOT NULL,
    projection_height integer NOT NULL, projection_hash text NOT NULL, batch_id bigint,
    source text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(group_id,exposed_height,exposed_hash)
);
CREATE TABLE quantum_v2.projection_batch (
    batch_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    from_height integer NOT NULL, from_hash text NOT NULL,
    to_height integer NOT NULL, to_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(to_height>from_height), UNIQUE(to_height)
);
CREATE TABLE quantum_v2.batch_undo (
    batch_id bigint NOT NULL REFERENCES quantum_v2.projection_batch(batch_id) ON DELETE CASCADE,
    group_id text COLLATE "C" NOT NULL, script_type text COLLATE "C" NOT NULL,
    before_row jsonb,
    PRIMARY KEY(batch_id,group_id,script_type)
);
CREATE TABLE quantum_v2.disclosure_undo (
    batch_id bigint NOT NULL REFERENCES quantum_v2.projection_batch(batch_id) ON DELETE CASCADE,
    group_id text COLLATE "C" NOT NULL, before_height integer, before_hash text,
    PRIMARY KEY(batch_id,group_id)
);
