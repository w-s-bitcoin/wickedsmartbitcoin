"""Bounded read-only SQL export pages; no connections or work at import time.

PostgreSQL reduces current accounting and exact whole-group tier/activity facts.
Count vectors are sufficient only for the explicitly supported migration scenario;
all migration weights and subset corrections remain in quantum_v2_analysis.
"""
from __future__ import annotations

from collections import Counter
from typing import Callable, Iterator

import psycopg2.extensions

import quantum_v2_analysis as analysis
from quantum_v2_store import StoreError, _live_export_index_ready, _live_accounting_constraints_ready

SUPPORTED_SCENARIO = "current-signature-compressed-keys-34byte-destination-v2"
FAMILIES = ("P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR", "Other")
BITS = {family: 1 << index for index, family in enumerate(FAMILIES)}
MAX_PAGE_GROUPS = 25000
CUBE_FIELDS = ('groups', 'utxos', 'balance', 'exposed_groups', 'exposed_utxos', 'exposed_sats')
DETAIL_METRICS = ('current_supply_sats', 'current_utxo_count', 'exposed_supply_sats', 'exposed_utxo_count')


def _integer(value, name, minimum=0, maximum=None):
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        raise StoreError('Invalid SQL export ' + name)
    return value


def _context(snapshot_time):
    _integer(snapshot_time, 'snapshot time')
    if (analysis.SCENARIO_VERSION != SUPPORTED_SCENARIO or tuple(analysis.SCRIPT_TYPES) != FAMILIES
            or analysis.SCRIPT_MASKS != BITS):
        raise StoreError('SQL export requires the supported count-only scenario and family ordering')
    # Check datetime range before any query; the actual cutoff uses the shared
    # calendar helper, including leap days and exact UTC boundary semantics.
    analysis.calendar_cutoff(snapshot_time)
    return dict(snapshot_time=snapshot_time, scenario_version=SUPPORTED_SCENARIO,
                methodology_version=analysis.METHODOLOGY_VERSION, parser_version=analysis.PARSER_VERSION,
                grouping_version=analysis.GROUPING_VERSION,
                subset_correction_version=analysis.SUBSET_CORRECTION_VERSION)


def _page_query(position, limit, snapshot_time):
    lower='' if position is None else 'AND group_id>%s'
    params=() if position is None else (position,)
    mask='CASE script_type '+' '.join("WHEN '%s' THEN %s"%(f,BITS[f]) for f in FAMILIES)+' END'
    vec=','.join("sum(CASE WHEN script_type='%s' AND first_disclosure_height IS NOT NULL THEN eligible_utxos ELSE 0 END)"%f for f in FAMILIES)
    tiers=','.join("('%s',%s)"%(name,value) for name,value in analysis.TIERS)
    level='CASE '+' '.join('WHEN balance>=%s THEN %s'%(minimum,index) for index,(_,minimum) in reversed(list(enumerate(analysis.TIERS))[1:]))+' ELSE 0 END'
    sql='''WITH ids AS MATERIALIZED (
        SELECT DISTINCT group_id FROM quantum_v2.group_state WHERE utxo_count>0 '''+lower+''' ORDER BY group_id LIMIT %s
    ), p AS MATERIALIZED (
        SELECT s.* FROM ids CROSS JOIN LATERAL (
            SELECT * FROM quantum_v2.group_state WHERE group_id=ids.group_id ORDER BY script_type LIMIT 8) s
    ), spend_headers AS MATERIALIZED (
        SELECT needed.height,b.time FROM (SELECT DISTINCT last_spend_height AS height FROM p WHERE last_spend_height IS NOT NULL) needed
        LEFT JOIN LATERAL(SELECT time FROM public.blockheader WHERE blockheight=needed.height LIMIT 1) b ON true
    ), g AS MATERIALIZED (
        SELECT group_id,sum(balance_sats) AS balance,sum(utxo_count) AS utxos,
        sum(CASE WHEN first_disclosure_height IS NOT NULL THEN eligible_sats ELSE 0 END) AS exposed_sats,
        sum(CASE WHEN first_disclosure_height IS NOT NULL THEN eligible_utxos ELSE 0 END) AS exposed_utxos,
        bit_or(CASE WHEN utxo_count>0 THEN '''+mask+''' ELSE 0 END) AS present_mask,
        ARRAY['''+vec+'''] AS exposed_counts,max(last_spend_height) AS last_spend_height,
        count(*)>7 OR bool_or(group_id='' OR script_type IS NULL OR script_type NOT IN ('P2PK','P2PKH','P2SH','P2WPKH','P2WSH','P2TR','Other')) AS invalid_families,
        bool_or(p.last_spend_height IS NOT NULL AND (h.time IS NULL OR h.time<0)) AS missing_spend_time,
        bool_or(first_received_height<0 OR first_disclosure_height<0 OR p.last_spend_height<0) AS invalid_history,
        bool_or(balance_sats IS NULL OR utxo_count IS NULL OR eligible_sats IS NULL OR eligible_utxos IS NULL
            OR balance_sats<0 OR utxo_count<0 OR eligible_sats<0 OR eligible_utxos<0
            OR eligible_sats>balance_sats OR eligible_utxos>utxo_count
            OR (utxo_count=0 AND balance_sats<>0) OR (eligible_utxos=0 AND eligible_sats<>0)) AS invalid_accounting
        FROM p LEFT JOIN spend_headers h ON h.height=p.last_spend_height GROUP BY group_id
    ), summary AS MATERIALIZED (
        SELECT g.*,CASE WHEN g.last_spend_height IS NULL THEN 'never_spent'
            WHEN h.time<=%s THEN 'inactive' ELSE 'active' END AS activity,
            '''+level+''' AS tier_level
        FROM g LEFT JOIN spend_headers h ON h.height=g.last_spend_height
    ), families AS (
        SELECT group_id,script_type AS family,utxo_count AS utxos,balance_sats AS balance,
            CASE WHEN first_disclosure_height IS NOT NULL THEN eligible_utxos ELSE 0 END AS exposed_utxos,
            CASE WHEN first_disclosure_height IS NOT NULL THEN eligible_sats ELSE 0 END AS exposed_sats
            FROM p WHERE utxo_count>0
        UNION ALL SELECT group_id,'All',utxos,balance,exposed_utxos,exposed_sats FROM summary
    ), cubes AS (
        SELECT tier,family,act,count(*) AS groups,sum(f.utxos) AS utxos,sum(f.balance) AS balance,
            sum((f.exposed_utxos>0)::integer) AS exposed_groups,sum(f.exposed_utxos) AS exposed_utxos,sum(f.exposed_sats) AS exposed_sats
        FROM families f JOIN summary s USING(group_id)
        JOIN (VALUES '''+tiers+''') t(tier,minimum) ON s.balance>=minimum
        CROSS JOIN LATERAL(VALUES('all'),(s.activity)) activity(act)
        GROUP BY tier,family,act
    ), signatures AS (
        SELECT present_mask,exposed_counts,tier_level,activity,count(*) AS groups FROM summary
        GROUP BY present_mask,exposed_counts,tier_level,activity
    ), detail AS (
        SELECT p.group_id,p.script_type,p.balance_sats AS current_supply_sats,p.utxo_count AS current_utxo_count,
            CASE WHEN p.first_disclosure_height IS NOT NULL THEN p.eligible_sats ELSE 0 END AS exposed_supply_sats,
            CASE WHEN p.first_disclosure_height IS NOT NULL THEN p.eligible_utxos ELSE 0 END AS exposed_utxo_count,
            p.first_received_height AS first_received_blockheight,p.first_disclosure_height AS first_exposed_blockheight,
            be.time AS first_exposed_time,p.last_spend_height AS last_spend_blockheight,bs.time AS last_spend_time,
            p.display_group_id,p.details,p.identity
        FROM p JOIN summary s USING(group_id)
        LEFT JOIN LATERAL(SELECT time FROM public.blockheader WHERE blockheight=p.first_disclosure_height LIMIT 1) be ON true
        LEFT JOIN LATERAL(SELECT time FROM public.blockheader WHERE blockheight=p.last_spend_height LIMIT 1) bs ON true
        WHERE s.balance>=100000000 AND s.exposed_utxos>0
    ) SELECT 'cube' AS kind,to_jsonb(cubes) AS value FROM cubes
      UNION ALL SELECT 'signature',to_jsonb(signatures) FROM signatures
      UNION ALL SELECT 'detail',to_jsonb(detail) FROM detail
      UNION ALL SELECT 'frontier',jsonb_build_object('groups',count(*),'last_group',max(group_id),
          'transaction_started',transaction_timestamp()::text,'snapshot',txid_current_snapshot()::text) FROM ids
      UNION ALL SELECT 'invalid',jsonb_build_object('reason','Invalid accounting, historical metadata, or family coverage')
          FROM summary WHERE missing_spend_time OR invalid_families OR invalid_accounting OR invalid_history'''
    return sql, (*params, limit, analysis.calendar_cutoff(snapshot_time))


def _normalize_page(records, position, limit, context, transaction_identity):
    """Reject corruption before a page's aggregate or detail data is consumed."""
    if len(records) > 9 * limit + len(analysis.TIERS) * 8 * 4 + 1:
        raise StoreError('SQL export page exceeded its result bound')
    if any(kind == 'invalid' for kind, value in records):
        raise StoreError('SQL export found invalid accounting, family coverage, or an exact spend timestamp')
    frontiers = [value for kind, value in records if kind == 'frontier']
    if len(frontiers) != 1 or not isinstance(frontiers[0], dict):
        raise StoreError('SQL export requires exactly one page frontier')
    if (frontiers[0].get('transaction_started'), frontiers[0].get('snapshot')) != transaction_identity:
        raise StoreError('Caller changed the SQL export snapshot between pages')
    count = _integer(frontiers[0].get('groups'), 'group count', maximum=limit)
    last = frontiers[0].get('last_group')
    if (count == 0 and last is not None) or (count > 0 and (
            not isinstance(last, str) or not last or (position is not None and last <= position))):
        raise StoreError('SQL export frontier did not advance')
    page = dict(context, group_count=count, last_group_id=last, done=count < limit,
                base_cubes=[], packing=[], detail_rows=[])
    cube_keys, signatures = set(), set()
    frequencies = 0
    all_count = 0
    tier_names = {name for name, _ in analysis.TIERS}
    for kind, value in records:
        if not isinstance(value, dict):
            raise StoreError('Invalid SQL export payload')
        if kind == 'cube':
            key = (value.get('tier'), value.get('family'), value.get('act'))
            if (key in cube_keys or key[0] not in tier_names or key[1] not in ('All',) + FAMILIES
                    or key[2] not in ('all',) + analysis.ACTIVITIES):
                raise StoreError('Invalid or duplicate SQL export cube')
            cube_keys.add(key)
            metrics = [_integer(value.get(field), 'cube ' + field) for field in CUBE_FIELDS]
            groups, utxos, sats, exposed_groups, exposed_utxos, exposed_sats = metrics
            if (groups > count or utxos < groups or exposed_groups > groups or exposed_utxos < exposed_groups
                    or exposed_utxos > utxos or exposed_sats > sats
                    or (groups == 0 and any(metrics)) or (exposed_groups == 0) != (exposed_utxos == 0)
                    or (utxos == 0 and sats != 0) or (exposed_utxos == 0 and exposed_sats != 0)):
                raise StoreError('Invalid SQL export cube accounting')
            page['base_cubes'].append(dict(tier=key[0], family=key[1], activity=key[2], metrics=metrics))
            if key == ('all', 'All', 'all'):
                all_count = groups
        elif kind == 'signature':
            mask = _integer(value.get('present_mask'), 'family mask', minimum=1, maximum=127)
            vector = value.get('exposed_counts')
            if not isinstance(vector, list) or len(vector) != len(FAMILIES):
                raise StoreError('Invalid SQL export exposed count vector')
            vector = [_integer(number, 'exposed count') for number in vector]
            if any(number and not mask & (1 << index) for index, number in enumerate(vector)):
                raise StoreError('SQL export count belongs to an absent family')
            tier = _integer(value.get('tier_level'), 'tier level', maximum=len(analysis.TIERS) - 1)
            activity = value.get('activity')
            frequency = _integer(value.get('groups'), 'signature frequency', minimum=1, maximum=count)
            key = (mask, tuple(vector), tier, activity)
            if key in signatures or activity not in analysis.ACTIVITIES:
                raise StoreError('Invalid or duplicate SQL export signature')
            signatures.add(key)
            frequencies += frequency
            page['packing'].append(dict(present_mask=mask, exposed_counts=vector, tier_level=tier,
                                        activity=activity, groups=frequency))
        elif kind == 'detail':
            page['detail_rows'].append(value)
        elif kind != 'frontier':
            raise StoreError('Unknown SQL export record kind')
    if frequencies != count or all_count != count:
        raise StoreError('SQL export histogram/cube counts differ from the page frontier')
    if len(page['packing']) > count or len(page['detail_rows']) > 7 * count:
        raise StoreError('SQL export signature/detail cardinality exceeds the page')
    detail_keys = set()
    family_counts = Counter()
    for row in page['detail_rows']:
        group, family = row.get('group_id'), row.get('script_type')
        if (not isinstance(group, str) or family not in FAMILIES or last is None or group > last
                or (position is not None and group <= position) or (group, family) in detail_keys):
            raise StoreError('Invalid, duplicate, or out-of-page SQL export detail')
        detail_keys.add((group, family))
        family_counts[group] += 1
        sats, utxos, exposed_sats, exposed_utxos = [
            _integer(row.get(name), 'detail ' + name) for name in DETAIL_METRICS]
        if (exposed_sats > sats or exposed_utxos > utxos or (utxos == 0 and sats != 0)
                or (exposed_utxos == 0 and exposed_sats != 0)):
            raise StoreError('Invalid SQL export detail accounting')
        for field in ('first_received_blockheight', 'first_exposed_blockheight', 'last_spend_blockheight'):
            if row.get(field) is not None:
                _integer(row[field], field)
        for field in ('first_exposed_time', 'last_spend_time'):
            if row.get(field) is not None and type(row[field]) is not int:
                raise StoreError('Invalid SQL export ' + field)
        if row.get('last_spend_blockheight') is not None and row.get('last_spend_time') is None:
            raise StoreError('SQL export detail lacks its exact spend timestamp')
    if len(family_counts) > count or any(number > 7 for number in family_counts.values()):
        raise StoreError('SQL export detail family coverage exceeds the page')
    page['detail_rows'].sort(key=lambda row: (row['group_id'], row['script_type']))
    return page


def iter_export_pages(conn, *, snapshot_time: int, guard: Callable[[], None],
                      fetch_groups: int = 10000) -> Iterator[dict]:
    """Yield complete-group pages from the caller's stable read-only snapshot.

    The caller owns transaction lifetime, source/hash certification, publication
    context, and cancellation of in-flight SQL. ``guard`` is called before and
    after SQL and pages, including pages that contain no qualifying details.
    Consumers must also guard their histogram processing and serialization.
    There are no commits, connections, source-history reads, or permanent caches.
    Every source-reading page is bound to the same transaction start and MVCC
    snapshot. Once the final page is fully read, its consumer performs no more
    source reads here; final source/hash certification remains caller-owned.
    """
    _integer(fetch_groups, 'page size', minimum=1, maximum=MAX_PAGE_GROUPS)
    if not callable(guard):
        raise ValueError('SQL export requires a deadline/resource/pause guard')
    context = _context(snapshot_time)
    if conn.autocommit:
        raise StoreError('SQL export requires a caller-owned stable transaction')
    guard()
    with conn.cursor() as cur:
        cur.execute("SELECT current_setting('transaction_isolation'),current_setting('transaction_read_only'),"
                    "current_setting('max_parallel_workers_per_gather'),pg_size_bytes(current_setting('work_mem')),"
                    "transaction_timestamp()::text,txid_current_snapshot()::text")
        isolation, readonly, parallel, work_mem, started, snapshot = cur.fetchone()
        transaction_identity = (started, snapshot)
        if isolation not in ('repeatable read', 'serializable') or readonly != 'on':
            raise StoreError('SQL export requires a read-only REPEATABLE READ transaction')
        if int(parallel) != 0 or int(work_mem) > 32 * 1024**2:
            raise StoreError('SQL export requires parallel workers=0 and work_mem<=32MB')
        guard()
        if not _live_export_index_ready(cur) or not _live_accounting_constraints_ready(cur):
            raise StoreError('SQL export requires migration006 live index and validated accounting constraints')
    position = None
    while True:
        guard()
        if conn.get_transaction_status() != psycopg2.extensions.TRANSACTION_STATUS_INTRANS:
            raise StoreError('Caller ended the SQL export snapshot between pages')
        query, params = _page_query(position, fetch_groups, snapshot_time)
        with conn.cursor() as cur:
            cur.execute(query, params)
            records = cur.fetchall()
        guard()
        if conn.get_transaction_status() != psycopg2.extensions.TRANSACTION_STATUS_INTRANS:
            raise StoreError('Caller ended the SQL export snapshot while reading a page')
        page = _normalize_page(records, position, fetch_groups, context, transaction_identity)
        guard()
        yield page
        if page['done']:
            return
        position = page['last_group_id']
