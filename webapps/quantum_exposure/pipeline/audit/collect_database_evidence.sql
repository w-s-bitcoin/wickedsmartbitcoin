-- Read-only catalog evidence. No producer imports, table scans, ANALYZE, or DDL.
-- Run from the repository root, selecting the intended database explicitly:
-- psql -X -w -qAt -d bitcoin_data -f webapps/quantum_exposure/pipeline/audit/collect_database_evidence.sql
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '1s';
SET LOCAL application_name = 'quantum_readonly_audit';
WITH relations AS (
    SELECT c.oid, c.relname,
           c.reltuples::bigint AS estimated_rows,
           pg_table_size(c.oid) AS table_bytes,
           pg_indexes_size(c.oid) AS index_bytes,
           s.n_dead_tup AS estimated_dead_rows,
           s.last_analyze, s.last_autoanalyze
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (c.relname ~ '^(active_|exposed_|key_outputs_all|dashboard_|analysis_freeze)'
           OR c.relname IN ('outputs', 'coinbases', 'blockheader')
           OR c.relname ~ '^stxos_[0-9]+_[0-9]+_archive$')
), settings AS (
    SELECT name, setting, unit FROM pg_settings
    WHERE name IN ('work_mem', 'hash_mem_multiplier', 'maintenance_work_mem',
                   'shared_buffers', 'max_parallel_workers_per_gather',
                   'max_parallel_workers', 'max_connections', 'track_io_timing',
                   'shared_preload_libraries', 'effective_cache_size')
), indexes AS (
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public'
      AND (tablename ~ '^(active_|exposed_|key_outputs_all|dashboard_|analysis_freeze)'
           OR tablename = 'outputs')
)
SELECT jsonb_pretty(jsonb_build_object(
    'observed_at', clock_timestamp(),
    'server_version', current_setting('server_version'),
    'database_bytes', pg_database_size(current_database()),
    'row_count_note', 'pg_class estimates, not COUNT(*); statistics can be stale',
    'source_tip', (SELECT jsonb_build_object('height', blockheight, 'hash', blockhash)
                   FROM public.blockheader ORDER BY blockheight DESC LIMIT 1),
    'freeze', (SELECT jsonb_agg(to_jsonb(f) ORDER BY name) FROM public.analysis_freeze f),
    'relations', (SELECT jsonb_agg(to_jsonb(r) - 'oid' ORDER BY table_bytes + index_bytes DESC) FROM relations r),
    'indexes', (SELECT jsonb_agg(to_jsonb(i) ORDER BY tablename, indexname) FROM indexes i),
    'settings', (SELECT jsonb_agg(to_jsonb(s) ORDER BY name) FROM settings s),
    'extensions', (SELECT jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) ORDER BY extname) FROM pg_extension)
));
ROLLBACK;
