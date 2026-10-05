-- Independent, resumable raw-source UTXO validation. No source tables modified.
CREATE TABLE quantum_v2.validation_checkpoint (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  target_height bigint NOT NULL,
  target_hash text NOT NULL CHECK(target_hash ~ '^[0-9a-f]{64}$'),
  validation_version text NOT NULL,
  parser_version text NOT NULL,
  grouping_version text NOT NULL,
  status text NOT NULL DEFAULT 'building' CHECK(status IN ('building','comparing','ready','verified','mismatch')),
  last_height bigint NOT NULL DEFAULT -1,
  last_txid text NOT NULL DEFAULT '',
  last_vout integer NOT NULL DEFAULT -1,
  source_rows bigint NOT NULL DEFAULT 0,
  accounted_utxos bigint NOT NULL DEFAULT 0,
  compare_group_id text COLLATE "C" NOT NULL DEFAULT '',
  compare_script_type text COLLATE "C" NOT NULL DEFAULT '',
  compared_rows bigint NOT NULL DEFAULT 0,
  mismatches bigint NOT NULL DEFAULT 0,
  mismatch_examples jsonb NOT NULL DEFAULT '[]',
  source_totals jsonb NOT NULL DEFAULT '{}',
  projection_totals jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE quantum_v2.validation_group (
  group_id text COLLATE "C" NOT NULL,
  script_type text COLLATE "C" NOT NULL,
  balance_sats bigint NOT NULL CHECK(balance_sats>=0),
  utxo_count bigint NOT NULL CHECK(utxo_count>=0),
  eligible_sats bigint NOT NULL CHECK(eligible_sats BETWEEN 0 AND balance_sats),
  eligible_utxos bigint NOT NULL CHECK(eligible_utxos BETWEEN 0 AND utxo_count),
  PRIMARY KEY(group_id,script_type)
);
CREATE TABLE quantum_v2.validation_result (
  target_height bigint NOT NULL,
  target_hash text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  passed boolean NOT NULL,
  report jsonb NOT NULL,
  PRIMARY KEY(target_height,target_hash)
);
