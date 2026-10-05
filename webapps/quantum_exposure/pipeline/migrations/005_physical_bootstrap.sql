-- Optional one-time scan of immutable legacy heaps. No public table is changed.
-- Cursor/group relationships are application enforced so reset can truncate the
-- projection and these helpers atomically without changing existing migrations.
CREATE TABLE quantum_v2.bootstrap_heap_cursor (
    source_table text PRIMARY KEY,
    relation_oid oid NOT NULL, relation_filenode oid NOT NULL,
    heap_bytes bigint NOT NULL CHECK(heap_bytes>=0), block_size integer NOT NULL CHECK(block_size>0),
    anchor_height bigint NOT NULL, anchor_hash text NOT NULL,
    cutoff_height bigint NOT NULL, cutoff_txid text NOT NULL, cutoff_vout integer NOT NULL,
    next_tid tid NOT NULL DEFAULT '(0,0)',
    blocks_per_page integer NOT NULL CHECK(blocks_per_page BETWEEN 1 AND 4096),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Only groups first created during physical scanning get an origin. An existing
-- prefix group's display is already earlier than every unprocessed occurrence.
-- This helper is disposable at reset, never disclosure evidence or export data.
CREATE TABLE quantum_v2.bootstrap_display_origin (
    group_id text COLLATE "C" NOT NULL, script_type text COLLATE "C" NOT NULL,
    blockheight bigint NOT NULL, transactionid text NOT NULL, vout integer NOT NULL,
    display_group_id text NOT NULL,
    PRIMARY KEY(group_id,script_type)
);
