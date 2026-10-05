"""Preserve legacy historical rows whose detailed archive snapshots are absent.

These records remain unreconciled summaries, never fabricated snapshot payloads.
Every retained row is tied to preserved original CSV bytes, independently of the
new snapshot's canonical calculation. No work occurs on import.
"""
from __future__ import annotations

import csv
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
import re

from publish_generation import ARCHIVED_INDEX_HEADERS, HISTORICAL_ECO_HEADERS, _atomic_write_text

FILE = 'historical_archive_summaries.csv'
STAGED_METADATA = '.archive_summary_provenance.json'
SOURCE_PREFIX = 'archive_summary_sources/'
VERSION = 'legacy-summary-only-v1'
METHOD = 'legacy-v1-unreconciled'
MAX_BYTES = 16 * 1024**2
MAX_ROWS = 200000
DESCRIPTION = dict(version=VERSION, methodology_version=METHOD,
    artifact_coverage='historical-summary-only',
    provenance_status='retained legacy summary rows; not independently reconciled')


def _check(guard):
    if guard is not None:
        guard()


def _guarded_rows(rows, guard):
    for number, row in enumerate(rows):
        if number % 256 == 0:
            _check(guard)
        yield row
    _check(guard)


def _hash(payload, *, guard=None):
    digest = hashlib.sha256()
    view = memoryview(payload)
    _check(guard)
    for start in range(0, len(view), 1024 * 1024):
        digest.update(view[start:start + 1024 * 1024])
        _check(guard)
    return digest.hexdigest()


def _read(path, *, guard=None):
    _check(guard)
    path = Path(path)
    before = path.stat()
    if before.st_size > MAX_BYTES:
        raise RuntimeError('Archive summary evidence exceeds its bounded byte budget')
    chunks, size = [], 0
    with path.open('rb') as handle:
        while chunk := handle.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise RuntimeError('Archive summary evidence exceeds its bounded byte budget')
            chunks.append(chunk)
            _check(guard)
    payload = b''.join(chunks)
    _check(guard)
    after = path.stat()
    if (before.st_ino,before.st_size,before.st_mtime_ns) != (after.st_ino,after.st_size,after.st_mtime_ns):
        raise RuntimeError('Archive summary source changed while reading')
    return payload


def _rows(payload, fields, *, guard=None):
    _check(guard)
    if len(payload)>MAX_BYTES:
        raise RuntimeError('Archive summary evidence exceeds its bounded byte budget')
    reader = csv.DictReader(io.StringIO(payload.decode('utf-8'),newline=''))
    if tuple(reader.fieldnames or ()) != tuple(fields):
        raise RuntimeError('Archive summary source has unsupported CSV columns')
    result=[]
    for row in _guarded_rows(reader, guard):
        if len(result)>=MAX_ROWS or None in row or any(value is None for value in row.values()):
            raise RuntimeError('Archive summary source has incomplete rows or exceeds its row budget')
        result.append(row)
    return result


def history(payload, *, guard=None):
    rows=_rows(payload,HISTORICAL_ECO_HEADERS,guard=guard)
    seen=set()
    heights=set()
    for row in _guarded_rows(rows,guard):
        key=tuple(row[field] for field in HISTORICAL_ECO_HEADERS[:4])
        if (not re.fullmatch(r'0|[1-9][0-9]*',key[0]) or key in seen
                or key[1] not in ('all','ge1','ge10','ge100','ge1000')
                or key[2] not in ('All','P2PK','P2PKH','P2SH','P2WPKH','P2WSH','P2TR','Other')
                or key[3] not in ('all','never_spent','inactive','active')):
            raise RuntimeError('Archive summary source has invalid or duplicate filter keys')
        seen.add(key)
        heights.add(key[0])
        if any(not re.fullmatch(r'[0-9]+',row[field]) for field in HISTORICAL_ECO_HEADERS[4:10]):
            raise RuntimeError('Archive summary source has invalid integer accounting')
        try:
            value=Decimal(row['estimated_migration_blocks'])
            if not value.is_finite() or value<0:raise InvalidOperation
        except InvalidOperation as error:
            raise RuntimeError('Archive summary source has invalid migration estimate') from error
    for height in _guarded_rows(heights,guard):
        if (height,'all','All','all') not in seen:
            raise RuntimeError('Archive summary source lacks a historical topline')
    return rows


def catalog(payload, *, guard=None):
    result={}
    for row in _guarded_rows(_rows(payload,ARCHIVED_INDEX_HEADERS,guard=guard),guard):
        height,stamp=row['snapshot_blockheight'],row['snapshot_time']
        if (not re.fullmatch(r'0|[1-9][0-9]*',height) or height in result
                or not re.fullmatch(r'[0-9]+',stamp) or int(stamp)<=0):
            raise RuntimeError('Archive summary source has an invalid or duplicate catalog entry')
        result[height]=stamp
    return result


def _source_name(kind, checksum):
    if kind not in ('history','index') or not re.fullmatch('[a-f0-9]{64}',str(checksum)):
        raise RuntimeError('Invalid archive summary source identity')
    filename='historical_archived.csv' if kind=='history' else 'archived_index.csv'
    return SOURCE_PREFIX+checksum+'-'+filename


def _serialize(rows, *, guard=None):
    _check(guard)
    stream=io.StringIO(newline='')
    writer=csv.DictWriter(stream,fieldnames=HISTORICAL_ECO_HEADERS)
    writer.writeheader()
    ordered=sorted(_guarded_rows(rows,guard),key=lambda row:(int(row['snapshot']),row['balance_filter'],row['script_type_filter'],row['spend_activity_filter']))
    writer.writerows(_guarded_rows(ordered,guard))
    return stream.getvalue()


def source_artifacts(metadata, *, guard=None):
    """Validate the bounded evidence list before using its paths or hashes."""
    _check(guard)
    sources=metadata.get('sources') if isinstance(metadata,dict) else None
    if not isinstance(sources,list) or not 1<=len(sources)<=16:
        raise RuntimeError('Archive summary sources are absent or unbounded')
    result=set()
    for source in sources:
        _check(guard)
        if not isinstance(source,dict):
            raise RuntimeError('Invalid archive summary source metadata')
        for kind in ('history','index'):
            _check(guard)
            logical=_source_name(kind,source.get(kind+'_sha256'))
            if source.get(kind+'_artifact')!=logical:
                raise RuntimeError('Archive summary source path differs from its evidence hash')
            result.add(logical)
    return result


def validate(resolve, metadata, *, complete_heights=(), target_height, guard=None):
    """Check declared coverage and exact row provenance against retained bytes."""
    _check(guard)
    if not isinstance(metadata,dict) or any(metadata.get(key)!=value for key,value in DESCRIPTION.items()):
        raise RuntimeError('Unsupported archive summary methodology or coverage')
    heights=metadata.get('snapshot_heights')
    if (not isinstance(heights,list) or not heights or any(type(h) is not int or not 0<=h<target_height for h in heights)
            or heights!=sorted(set(heights)) or set(heights)&set(map(int,complete_heights))):
        raise RuntimeError('Archive summary heights overlap actual snapshots or have invalid coverage')
    rows=history(_read(resolve(FILE),guard=guard),guard=guard)
    if (type(metadata.get('rows')) is not int or metadata['rows']!=len(rows)
            or sorted({int(row['snapshot']) for row in _guarded_rows(rows,guard)})!=heights):
        raise RuntimeError('Archive summary row coverage differs from its metadata')
    sources=metadata.get('sources')
    source_artifacts(metadata,guard=guard)
    originals,times,seen,total={},{},set(),0
    for source in sources:
        _check(guard)
        payloads={}
        for kind in ('history','index'):
            logical=source[kind+'_artifact']
            payload=_read(resolve(logical),guard=guard);total+=len(payload)
            if total>MAX_BYTES or _hash(payload,guard=guard)!=source[kind+'_sha256']:
                raise RuntimeError('Archive summary source evidence hash/budget mismatch')
            payloads[kind]=payload
        pair=(source['history_artifact'],source['index_artifact'])
        if pair in seen:raise RuntimeError('Duplicate archive summary source pair')
        seen.add(pair)
        source_times=catalog(payloads['index'],guard=guard)
        for row in _guarded_rows(history(payloads['history'],guard=guard),guard):
            key=tuple(row[field] for field in HISTORICAL_ECO_HEADERS[:4]);height=row['snapshot']
            if height not in source_times:
                raise RuntimeError('Archive summary source history is missing its original catalog entry')
            if int(height) not in heights:continue
            if (key in originals and originals[key]!=row) or (height in times and times[height]!=source_times[height]):
                raise RuntimeError('Archive summary sources disagree')
            originals[key]=row;times[height]=source_times[height]
    if metadata.get('snapshot_times')!=times:
        raise RuntimeError('Archive summary timestamps differ from retained catalog evidence')
    if len(originals)!=len(rows) or any(originals.get(tuple(row[field] for field in HISTORICAL_ECO_HEADERS[:4]))!=row for row in _guarded_rows(rows,guard)):
        raise RuntimeError('Archive summary rows differ from retained original evidence')
    return rows


def stage(previous, output, marker, resolve, *, target_height, complete_heights, guard=None):
    """Carry existing summaries, or preserve missing legacy archive histories."""
    _check(guard)
    rows,sources,times=[],[],{}
    existing=marker.get('metadata',{}).get('archive_summaries') if marker.get('format')==2 else None
    if existing:
        rows=validate(resolve,existing,target_height=marker['snapshot_blockheight'],guard=guard)
        sources=existing['sources'];times=existing['snapshot_times']
        for source in sources:
            for kind in ('history','index'):
                logical=source[kind+'_artifact']
                _atomic_write_text(output/logical,_read(resolve(logical),guard=guard).decode('utf-8'),guard=guard)
    elif marker.get('format')!=2:
        history_path,index_path=resolve('historical_archived.csv'),resolve('archived_index.csv')
        if history_path.is_file()!=index_path.is_file():
            raise RuntimeError('Legacy archive summary history/catalog must both exist')
        if history_path.is_file():
            history_bytes,index_bytes=_read(history_path,guard=guard),_read(index_path,guard=guard)
            rows=history(history_bytes,guard=guard);times=catalog(index_bytes,guard=guard)
            if {row['snapshot'] for row in _guarded_rows(rows,guard)}!=set(times):
                raise RuntimeError('Legacy archive history and catalog coverage disagree')
            if rows:
                source={}
                for kind,payload in (('history',history_bytes),('index',index_bytes)):
                    checksum=_hash(payload,guard=guard);logical=_source_name(kind,checksum)
                    source.update({kind+'_artifact':logical,kind+'_sha256':checksum})
                    _atomic_write_text(output/logical,payload.decode('utf-8'),guard=guard)
                sources=[source]
    complete=set(map(int,_guarded_rows(complete_heights,guard)))
    rows=[row for row in _guarded_rows(rows,guard) if int(row['snapshot'])<target_height and int(row['snapshot']) not in complete]
    heights=sorted({int(row['snapshot']) for row in _guarded_rows(rows,guard)})
    metadata={**DESCRIPTION,'snapshot_heights':heights,'snapshot_times':{str(h):times[str(h)] for h in heights},
              'rows':len(rows),'sources':sources} if rows else None
    _atomic_write_text(output/FILE,_serialize(rows,guard=guard),guard=guard)
    _atomic_write_text(output/STAGED_METADATA,json.dumps(metadata,sort_keys=True)+'\n',guard=guard)
    if metadata:validate(lambda logical:output/logical,metadata,complete_heights=complete,target_height=target_height,guard=guard)
    _check(guard)
    return metadata


def staged_metadata(root, *, include_archives, complete_heights, target_height, guard=None):
    _check(guard)
    path=Path(root)/STAGED_METADATA
    if not include_archives or not path.is_file():return None
    metadata=json.loads(_read(path,guard=guard))
    if metadata is not None:
        rows=validate(lambda logical:Path(root)/logical,metadata,target_height=target_height,guard=guard)
        # A genuine snapshot restored during historical repair takes priority.
        # Its caller has already validated the actual snapshot/catalog bundle.
        complete=set(map(int,_guarded_rows(complete_heights,guard)))
        retained=[row for row in _guarded_rows(rows,guard) if int(row['snapshot']) not in complete]
        if len(retained)!=len(rows):
            heights=sorted({int(row['snapshot']) for row in _guarded_rows(retained,guard)})
            metadata={**metadata,'snapshot_heights':heights,'rows':len(retained),
                'snapshot_times':{str(h):metadata['snapshot_times'][str(h)] for h in heights}} if heights else None
            _atomic_write_text(Path(root)/FILE,_serialize(retained,guard=guard),guard=guard)
            _atomic_write_text(path,json.dumps(metadata,sort_keys=True)+'\n',guard=guard)
        if metadata:
            validate(lambda logical:Path(root)/logical,metadata,complete_heights=complete,target_height=target_height,guard=guard)
    _check(guard)
    return metadata
