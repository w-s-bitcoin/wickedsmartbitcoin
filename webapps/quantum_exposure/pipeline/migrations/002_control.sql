-- Quantum v2 orchestration. Additive; no source or legacy tables are replaced.
CREATE SCHEMA IF NOT EXISTS quantum_v2;
CREATE TABLE IF NOT EXISTS quantum_v2.source_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  ready boolean NOT NULL DEFAULT false,
  committed_height bigint,
  committed_hash text,
  epoch bigint NOT NULL DEFAULT 0,
  ingestion_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((committed_height IS NULL) = (committed_hash IS NULL)),
  CHECK (committed_hash IS NULL OR committed_hash ~ '^[0-9a-f]{64}$')
);
INSERT INTO quantum_v2.source_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS quantum_v2.source_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingestion_id uuid NOT NULL,
  event text NOT NULL CHECK(event IN ('begin','complete','reorg')),
  blockheight bigint,
  blockhash text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS quantum_v2.control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  paused boolean NOT NULL DEFAULT true,
  start_height bigint,
  confirmations integer NOT NULL DEFAULT 6 CHECK(confirmations>=0),
  boundary_size integer NOT NULL DEFAULT 1000 CHECK(boundary_size>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO quantum_v2.control(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS quantum_v2.request (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_height bigint NOT NULL,
  target_hash text NOT NULL CHECK(target_hash ~ '^[0-9a-f]{64}$'),
  methodology_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','analyzed','complete','orphaned','blocked')),
  attempt integer NOT NULL DEFAULT 0,
  generation_id text UNIQUE,
  output_dir text,
  error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(target_height,target_hash,methodology_version)
);
CREATE INDEX IF NOT EXISTS request_unfinished ON quantum_v2.request(target_height,id)
  WHERE status NOT IN ('complete','orphaned');
CREATE TABLE IF NOT EXISTS quantum_v2.run (
  id uuid PRIMARY KEY,
  request_id bigint REFERENCES quantum_v2.request(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  pid integer NOT NULL,
  status text NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
  metrics jsonb NOT NULL DEFAULT '{}',
  error text
);
CREATE TABLE IF NOT EXISTS quantum_v2.step (
  request_id bigint NOT NULL REFERENCES quantum_v2.request(id),
  name text NOT NULL,
  status text NOT NULL CHECK(status IN ('running','complete','failed')),
  cursor jsonb NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(request_id,name)
);
CREATE TABLE IF NOT EXISTS quantum_v2.delivery (
  request_id bigint NOT NULL REFERENCES quantum_v2.request(id),
  destination text NOT NULL CHECK(destination IN ('website','standalone')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivering','complete','superseded','failed')),
  attempts integer NOT NULL DEFAULT 0,
  accepted_commit text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(request_id,destination)
);
CREATE TABLE IF NOT EXISTS quantum_v2.accepted_generation (
  destination text PRIMARY KEY CHECK(destination IN ('website','standalone')),
  request_id bigint NOT NULL REFERENCES quantum_v2.request(id),
  target_height bigint NOT NULL,
  target_hash text NOT NULL,
  generation_id text NOT NULL,
  accepted_commit text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
