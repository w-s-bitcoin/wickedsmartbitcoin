"""Independent raw-source balance proof, bounded and resumable across restarts.

The source pass never reads active_* tables or the projection's state reducer.
Only exact current UTXO accounting and script eligibility are proved here;
historical disclosure/activity metadata requires separate evidence checks.
No database connections or work occur at import time.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
from pathlib import Path
import re

from psycopg2 import sql
from psycopg2.extras import Json, RealDictCursor, execute_values

from quantum_v2_analysis import GROUPING_VERSION, PARSER_VERSION, parse_multisig, valid_pubkey
from quantum_v2_store import SourceNotReady

MIGRATION = Path(__file__).with_name('migrations') / '004_validation.sql'
VERSION = 'raw-source-utxo-accounting-v1'
ARCHIVE = re.compile(r'^stxos_(\d+)_(\d+)_archive$')
FAMILIES = {'pubkey': 'P2PK', 'pubkeyhash': 'P2PKH', 'witness_v0_keyhash': 'P2WPKH',
            'scripthash': 'P2SH', 'witness_v0_scripthash': 'P2WSH', 'witness_v1_taproot': 'P2TR'}
METRICS = ('balance_sats', 'utxo_count', 'eligible_sats', 'eligible_utxos')
# Independently applied Bitcoin Core BIP30 occurrence exceptions. Block hashes
# are checked before excluding an occurrence; no fictional spend is introduced.
BIP30 = (
    (91722, 'e3bf3d07d4b0375638d5f1db5255fe07ba2c4cb067cd81b84ee974b6585fb468', 0, 91880,
     '00000000000271a2dc26e7667f8419f2e15416dc6955e5a6c6cdf3f2574dd08e',
     '00000000000743f190a18c5577a3c2d2a1f610ae9601ac046a38084ccb7cd721'),
    (91812, 'd5d27987d2a3dfc724e359870c6644b40e497bdc0589a033220fe15429d88599', 0, 91842,
     '00000000000af0aed4792b1acee3d966af36cf5def14935db8de83d6f9306f2f',
     '00000000000a4d0a398161ffc163c503763b1f4360639393e0e4c8e300e0caec'),
)


@contextmanager
def _transaction(conn):
    if conn.get_transaction_status() != 0:
        raise ValueError('Validation APIs require an idle connection')
    conn.set_session(isolation_level='REPEATABLE READ', readonly=False, autocommit=False)
    with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SET LOCAL work_mem='32MB'")
        cur.execute("SET LOCAL max_parallel_workers_per_gather=0")
        cur.execute("SET LOCAL lock_timeout='2s'")
        cur.execute("SET LOCAL statement_timeout='60s'")
        cur.execute('SELECT pg_try_advisory_xact_lock(811947,2) AS owned')
        if not cur.fetchone()['owned']:
            raise RuntimeError('Another Quantum worker or maintenance session is running')
        cur.execute('SELECT pg_try_advisory_xact_lock(811947,3) AS owned')
        if not cur.fetchone()['owned']:
            raise RuntimeError('Another Quantum validation transaction is running')
        yield cur


def migrate(conn):
    body = MIGRATION.read_text(encoding='utf-8')
    digest = hashlib.sha256(body.encode()).hexdigest()
    with _transaction(conn) as cur:
        cur.execute('SELECT sha256 FROM quantum_v2.schema_migration WHERE version=4')
        row = cur.fetchone()
        if row:
            if row['sha256'] != digest:
                raise ValueError('Applied validation migration has changed')
            return
        cur.execute(body)
        cur.execute('INSERT INTO quantum_v2.schema_migration(version,sha256) VALUES(4,%s)', (digest,))


def _certify(cur, height, expected_hash):
    cur.execute('''SELECT s.ready,s.committed_height,s.committed_hash,b.blockhash AS target_hash,
        tip.blockhash AS tip_hash FROM quantum_v2.source_state s
        LEFT JOIN public.blockheader b ON b.blockheight=%s
        LEFT JOIN public.blockheader tip ON tip.blockheight=s.committed_height WHERE s.singleton''', (height,))
    row = cur.fetchone()
    if row and row['target_hash'] != expected_hash:
        raise RuntimeError('Validation canonical target changed')
    if (not row or not row['ready'] or row['committed_height'] is None or row['committed_height'] < height
            or not row['tip_hash'] or not row['committed_hash']
            or row['tip_hash'] != row['committed_hash']):
        raise SourceNotReady('Validation source is unready or its certified tip changed')


def _versions_match(checkpoint):
    return (checkpoint['validation_version'], checkpoint['parser_version'], checkpoint['grouping_version']) == (
        VERSION, PARSER_VERSION, GROUPING_VERSION)


def initialize(conn, height, block_hash, *, recompare=False):
    """Start/resume one explicit target; a different target clears scratch groups.

    Prior final reports remain in validation_result. ``recompare=True`` explicitly
    repeats a finished target's comparison after a projection repair, reusing the
    unchanged raw-source reduction. It never changes source or projection data.
    """
    if height < 0 or not re.fullmatch(r'[0-9a-f]{64}', block_hash):
        raise ValueError('An exact nonnegative height and canonical hash are required')
    with _transaction(conn) as cur:
        _certify(cur, height, block_hash)
        cur.execute('SELECT * FROM quantum_v2.validation_checkpoint WHERE singleton FOR UPDATE')
        row = cur.fetchone()
        if row and (row['target_height'], row['target_hash']) == (height, block_hash) and _versions_match(row):
            if recompare:
                if row['status'] in ('building', 'comparing'):
                    raise ValueError('Finish the current validation pass before restarting comparison')
                cur.execute('''UPDATE quantum_v2.validation_checkpoint SET status='comparing',
                    compare_group_id='',compare_script_type='',compared_rows=0,mismatches=0,
                    mismatch_examples='[]',source_totals='{}',projection_totals='{}',
                    updated_at=clock_timestamp() WHERE singleton RETURNING *''')
                return dict(cur.fetchone())
            return dict(row)
        cur.execute('TRUNCATE quantum_v2.validation_group,quantum_v2.validation_checkpoint')
        cur.execute('''INSERT INTO quantum_v2.validation_checkpoint
            (target_height,target_hash,validation_version,parser_version,grouping_version)
            VALUES(%s,%s,%s,%s,%s) RETURNING *''', (height, block_hash, VERSION, PARSER_VERSION, GROUPING_VERSION))
        return dict(cur.fetchone())


def _removed_occurrences(cur, height):
    candidates = [entry for entry in BIP30 if entry[3] <= height]
    if not candidates:
        return set()
    cur.execute('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',
                ([h for entry in candidates for h in (entry[0], entry[3])],))
    headers = {row['blockheight']: row['blockhash'] for row in cur.fetchall()}
    return {(h, tx, vout) for h, tx, vout, removal, first_hash, last_hash in candidates
            if headers.get(h) == first_hash and headers.get(removal) == last_hash}


def classify_source(row):
    """Independent raw locking-script grouping; no projection calculation calls."""
    kind = row['scripttype'] or ''
    raw = (row['scripthex'] or '').lower()
    address = row['address'] or ''
    try:
        script = bytes.fromhex(raw)
    except ValueError as exc:
        raise ValueError('Source contains malformed locking-script hex') from exc
    family = FAMILIES.get(kind, 'Other')
    if kind == 'pubkey':
        if not re.fullmatch(r'(21[0-9a-f]{66}|41[0-9a-f]{130})ac', raw):
            raise ValueError('Declared P2PK source lacks the exact locking script')
        key = script[1:-1]
        group = hashlib.new('ripemd160', hashlib.sha256(key).digest()).hexdigest()
        eligible = valid_pubkey(key)
    elif kind in ('pubkeyhash', 'witness_v0_keyhash'):
        pattern = r'76a914[0-9a-f]{40}88ac' if kind == 'pubkeyhash' else r'0014[0-9a-f]{40}'
        if not re.fullmatch(pattern, raw):
            raise ValueError('Declared key-hash source lacks the exact locking script')
        group = raw[6:46] if kind == 'pubkeyhash' else raw[4:]
        eligible = True
    else:
        if address:
            group = address
        elif kind.startswith('Multisig ') and raw:
            group = 'script:' + hashlib.sha256(script).hexdigest()
        else:
            group = f"out:{row['blockheight']}:{row['transactionid']}:{row['vout']}"
        eligible = False
        if family in ('P2SH', 'P2WSH'):
            pattern = r'a914[0-9a-f]{40}87' if family == 'P2SH' else r'0020[0-9a-f]{64}'
            if not re.fullmatch(pattern, raw):
                raise ValueError('Declared script-hash source lacks the exact locking script')
            eligible = True
        elif family == 'P2TR':
            if not re.fullmatch(r'5120[0-9a-f]{64}', raw):
                raise ValueError('Declared Taproot source lacks the exact locking script')
            eligible = valid_pubkey(b'\x02' + script[2:])
        elif kind.startswith('Multisig '):
            eligible = parse_multisig(script) is not None
    return group, family, eligible, row['blockheight'] == 0 or script.startswith(b'\x6a') or len(script) > 10000


def _page(cur, checkpoint, limit, window_blocks):
    height = checkpoint['target_height']
    cur.execute("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename ~ '^stxos_[0-9]+_[0-9]+_archive$'")
    names = ['outputs'] + sorted(row['tablename'] for row in cur.fetchall()
                                if int(ARCHIVE.fullmatch(row['tablename'])[2]) > height)
    cursor = (checkpoint['last_height'], checkpoint['last_txid'], checkpoint['last_vout'])
    # A spent archive can contain very few outputs surviving at the target.
    # Bound creation-height reads as well as returned rows; otherwise each
    # early live-output page can rescan most of a later spent archive.
    window_end = min(height, max(0, cursor[0]) + window_blocks - 1)
    pieces, params = [], []
    for name in names:
        pieces.append(sql.SQL('''(SELECT blockheight,transactionid,vout,amount,address,scripttype,scripthex,spendingblock
            FROM {} WHERE (blockheight,transactionid,vout)>(%s,%s,%s) AND blockheight<=%s
            AND (spendingblock IS NULL OR spendingblock>%s)
            ORDER BY blockheight,transactionid,vout LIMIT %s)''').format(sql.Identifier('public', name)))
        params.extend((*cursor, window_end, height, limit + 1))
    cur.execute(sql.SQL('SELECT * FROM (') + sql.SQL(' UNION ').join(pieces)
                + sql.SQL(') source ORDER BY blockheight,transactionid,vout LIMIT %s'), (*params, limit + 1))
    rows = cur.fetchall()
    keys = [(row['blockheight'], row['transactionid'], row['vout']) for row in rows]
    if len(set(keys)) != len(keys):
        raise ValueError('Conflicting source rows for one occurrence, including page-boundary lookahead')
    window_complete = len(rows) <= limit
    page = rows[:limit]
    # vout is nonnegative: this cursor includes every occurrence at the next
    # height, even an empty transaction ID, without a collation-dependent
    # synthetic maximum transaction ID.
    next_cursor = ((window_end + 1, '', -1) if window_complete else
                   (page[-1]['blockheight'], page[-1]['transactionid'], page[-1]['vout']))
    return page, window_complete and window_end == height, next_cursor


def step(conn, limit=10000, window_blocks=1000):
    """Process one source or comparison page. True means both passes finished."""
    if not 1 <= limit <= 100000:
        raise ValueError('Validation page size must be 1..100000')
    if not 1 <= window_blocks <= 10000:
        raise ValueError('Validation creation window must be 1..10000 blocks')
    with _transaction(conn) as cur:
        cur.execute('SELECT * FROM quantum_v2.validation_checkpoint WHERE singleton FOR UPDATE')
        checkpoint = cur.fetchone()
        if not checkpoint:
            raise ValueError('Initialize validation first')
        if not _versions_match(checkpoint):
            raise ValueError('Validation versions changed; explicitly initialize a fresh source pass')
        _certify(cur, checkpoint['target_height'], checkpoint['target_hash'])
        if checkpoint['status'] == 'comparing':
            return _compare_step(cur, checkpoint, limit)
        if checkpoint['status'] != 'building':
            return True
        rows, done, key = _page(cur, checkpoint, limit, window_blocks)
        removed = _removed_occurrences(cur, checkpoint['target_height'])
        groups, accounted = {}, 0
        for row in rows:
            group, family, eligible, excluded = classify_source(row)
            if excluded or (row['blockheight'], row['transactionid'], row['vout']) in removed:
                continue
            amount = int(row['amount'])
            if amount < 0:
                raise ValueError('Source output amount is negative')
            values = groups.setdefault((group, family), [0, 0, 0, 0])
            values[0] += amount
            values[1] += 1
            values[2] += amount if eligible else 0
            values[3] += int(eligible)
            accounted += 1
        if groups:
            execute_values(cur, '''INSERT INTO quantum_v2.validation_group
                (group_id,script_type,balance_sats,utxo_count,eligible_sats,eligible_utxos) VALUES %s
                ON CONFLICT(group_id,script_type) DO UPDATE SET
                balance_sats=validation_group.balance_sats+excluded.balance_sats,
                utxo_count=validation_group.utxo_count+excluded.utxo_count,
                eligible_sats=validation_group.eligible_sats+excluded.eligible_sats,
                eligible_utxos=validation_group.eligible_utxos+excluded.eligible_utxos''',
                [(group, family, *values) for (group, family), values in groups.items()], page_size=1000)
        cur.execute('''UPDATE quantum_v2.validation_checkpoint SET last_height=%s,last_txid=%s,last_vout=%s,
            source_rows=source_rows+%s,accounted_utxos=accounted_utxos+%s,status=%s,updated_at=clock_timestamp()
            WHERE singleton''', (*key, len(rows), accounted, 'comparing' if done else 'building'))
        return False


def _projection_matches(cur, height, target_hash):
    cur.execute('SELECT height,block_hash,status FROM quantum_v2.projection WHERE singleton FOR SHARE')
    projection = cur.fetchone()
    if not projection or (projection['height'], projection['block_hash'], projection['status']) != (height, target_hash, 'ready'):
        raise ValueError('Projection checkpoint must match the completed validation target')


_COMPARISON_PAGE_SQL = '''WITH keys AS MATERIALIZED (
        (SELECT group_id,script_type FROM quantum_v2.validation_group
         WHERE (group_id,script_type)>(%s,%s) ORDER BY group_id,script_type LIMIT %s)
        UNION
        (SELECT group_id,script_type FROM quantum_v2.group_state
         WHERE (group_id,script_type)>(%s,%s) ORDER BY group_id,script_type LIMIT %s)
    ), page AS MATERIALIZED (SELECT * FROM keys ORDER BY group_id,script_type LIMIT %s)
    SELECT p.group_id,p.script_type,
        ARRAY[COALESCE(v.balance_sats,0),COALESCE(v.utxo_count,0),COALESCE(v.eligible_sats,0),COALESCE(v.eligible_utxos,0)] AS expected,
        ARRAY[COALESCE(s.balance_sats,0),COALESCE(s.utxo_count,0),COALESCE(s.eligible_sats,0),COALESCE(s.eligible_utxos,0)] AS actual
    FROM page p
    LEFT JOIN LATERAL (SELECT balance_sats,utxo_count,eligible_sats,eligible_utxos
        FROM quantum_v2.validation_group v
        WHERE v.group_id=p.group_id AND v.script_type=p.script_type LIMIT 1) v ON true
    LEFT JOIN LATERAL (SELECT balance_sats,utxo_count,eligible_sats,eligible_utxos
        FROM quantum_v2.group_state s
        WHERE s.group_id=p.group_id AND s.script_type=p.script_type LIMIT 1) s ON true
    ORDER BY p.group_id,p.script_type'''


def _compare_step(cur, checkpoint, limit):
    _projection_matches(cur, checkpoint['target_height'], checkpoint['target_hash'])
    position = (checkpoint['compare_group_id'], checkpoint['compare_script_type'])
    # Materialize only the union's bounded key page before per-key lookups.
    # An ordinary join can hash every projected group for each comparison page.
    cur.execute(_COMPARISON_PAGE_SQL, (*position, limit + 1, *position, limit + 1, limit + 1))
    result = cur.fetchall()
    done, rows = len(result) <= limit, result[:limit]
    examples = list(checkpoint['mismatch_examples'])
    mismatches = checkpoint['mismatches']
    source_totals, projection_totals = checkpoint['source_totals'], checkpoint['projection_totals']
    for row in rows:
        if row['expected'] != row['actual']:
            mismatches += 1
            if len(examples) < 25:
                examples.append({'group_id': row['group_id'], 'script_type': row['script_type'],
                                 'expected': dict(zip(METRICS, row['expected'])), 'actual': dict(zip(METRICS, row['actual']))})
        for totals, values in ((source_totals, row['expected']), (projection_totals, row['actual'])):
            family = totals.setdefault(row['script_type'], {metric: 0 for metric in METRICS})
            for metric, value in zip(METRICS, values):
                family[metric] += value
    key = (rows[-1]['group_id'], rows[-1]['script_type']) if rows else position
    cur.execute('''UPDATE quantum_v2.validation_checkpoint SET compare_group_id=%s,compare_script_type=%s,
        compared_rows=compared_rows+%s,mismatches=%s,mismatch_examples=%s,source_totals=%s,projection_totals=%s,
        status=%s,updated_at=clock_timestamp() WHERE singleton''',
                (*key, len(rows), mismatches, Json(examples), Json(source_totals), Json(projection_totals),
                 'ready' if done else 'comparing'))
    return done


def verify(conn):
    """Compare every current group/family and persist an explicit final report."""
    with _transaction(conn) as cur:
        cur.execute('SELECT * FROM quantum_v2.validation_checkpoint WHERE singleton FOR UPDATE')
        checkpoint = cur.fetchone()
        if not checkpoint or checkpoint['status'] in ('building', 'comparing'):
            raise ValueError('Validation source/comparison passes have not completed')
        if not _versions_match(checkpoint):
            raise ValueError('Validation versions changed; explicitly initialize a fresh source pass')
        height, target_hash = checkpoint['target_height'], checkpoint['target_hash']
        _certify(cur, height, target_hash)
        _projection_matches(cur, height, target_hash)
        mismatches = checkpoint['mismatches']
        examples = checkpoint['mismatch_examples']
        totals = {'validation_group': checkpoint['source_totals'], 'group_state': checkpoint['projection_totals']}
        report = {'version': VERSION, 'target_height': height, 'target_hash': target_hash, 'passed': mismatches == 0,
                  'parser_version': PARSER_VERSION, 'grouping_version': GROUPING_VERSION,
                  'mismatched_group_families': mismatches, 'examples': examples, 'totals': totals,
                  'source_rows': checkpoint['source_rows'], 'accounted_utxos': checkpoint['accounted_utxos'],
                  'compared_group_families': checkpoint['compared_rows'],
                  'scope': 'All current group/family balances, counts and script eligibility; historical dates/disclosure not certified'}
        cur.execute('''INSERT INTO quantum_v2.validation_result(target_height,target_hash,passed,report)
            VALUES(%s,%s,%s,%s) ON CONFLICT(target_height,target_hash) DO UPDATE
            SET verified_at=clock_timestamp(),passed=excluded.passed,report=excluded.report''',
                    (height, target_hash, report['passed'], Json(report)))
        cur.execute('UPDATE quantum_v2.validation_checkpoint SET status=%s,updated_at=clock_timestamp() WHERE singleton',
                    ('verified' if report['passed'] else 'mismatch',))
        return report
