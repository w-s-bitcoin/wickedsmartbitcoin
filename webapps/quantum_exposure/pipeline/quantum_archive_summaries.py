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


def _read(path):
    path = Path(path)
    before = path.stat()
    if before.st_size > MAX_BYTES:
        raise RuntimeError('Archive summary evidence exceeds its bounded byte budget')
    with path.open('rb') as handle:
        payload = handle.read(MAX_BYTES + 1)
    if len(payload) > MAX_BYTES:
        raise RuntimeError('Archive summary evidence exceeds its bounded byte budget')
    after = path.stat()
    if (before.st_ino,before.st_size,before.st_mtime_ns) != (after.st_ino,after.st_size,after.st_mtime_ns):
        raise RuntimeError('Archive summary source changed while reading')
    return payload


def _rows(payload, fields):
    if len(payload)>MAX_BYTES:
        raise RuntimeError('Archive summary evidence exceeds its bounded byte budget')
    reader = csv.DictReader(io.StringIO(payload.decode('utf-8'),newline=''))
    if tuple(reader.fieldnames or ()) != tuple(fields):
        raise RuntimeError('Archive summary source has unsupported CSV columns')
    result=[]
    for row in reader:
        if len(result)>=MAX_ROWS or None in row or any(value is None for value in row.values()):
            raise RuntimeError('Archive summary source has incomplete rows or exceeds its row budget')
        result.append(row)
    return result


def history(payload):
    rows=_rows(payload,HISTORICAL_ECO_HEADERS)
    seen=set()
    for row in rows:
        key=tuple(row[field] for field in HISTORICAL_ECO_HEADERS[:4])
        if (not re.fullmatch(r'0|[1-9][0-9]*',key[0]) or key in seen
                or key[1] not in ('all','ge1','ge10','ge100','ge1000')
                or key[2] not in ('All','P2PK','P2PKH','P2SH','P2WPKH','P2WSH','P2TR','Other')
                or key[3] not in ('all','never_spent','inactive','active')):
            raise RuntimeError('Archive summary source has invalid or duplicate filter keys')
        seen.add(key)
        if any(not re.fullmatch(r'[0-9]+',row[field]) for field in HISTORICAL_ECO_HEADERS[4:10]):
            raise RuntimeError('Archive summary source has invalid integer accounting')
        try:
            value=Decimal(row['estimated_migration_blocks'])
            if not value.is_finite() or value<0:raise InvalidOperation
        except InvalidOperation as error:
            raise RuntimeError('Archive summary source has invalid migration estimate') from error
    for height in {key[0] for key in seen}:
        if (height,'all','All','all') not in seen:
            raise RuntimeError('Archive summary source lacks a historical topline')
    return rows


def catalog(payload):
    result={}
    for row in _rows(payload,ARCHIVED_INDEX_HEADERS):
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


def _serialize(rows):
    stream=io.StringIO(newline='')
    writer=csv.DictWriter(stream,fieldnames=HISTORICAL_ECO_HEADERS)
    writer.writeheader()
    writer.writerows(sorted(rows,key=lambda row:(int(row['snapshot']),row['balance_filter'],row['script_type_filter'],row['spend_activity_filter'])))
    return stream.getvalue()


def source_artifacts(metadata):
    """Validate the bounded evidence list before using its paths or hashes."""
    sources=metadata.get('sources') if isinstance(metadata,dict) else None
    if not isinstance(sources,list) or not 1<=len(sources)<=16:
        raise RuntimeError('Archive summary sources are absent or unbounded')
    result=set()
    for source in sources:
        if not isinstance(source,dict):
            raise RuntimeError('Invalid archive summary source metadata')
        for kind in ('history','index'):
            logical=_source_name(kind,source.get(kind+'_sha256'))
            if source.get(kind+'_artifact')!=logical:
                raise RuntimeError('Archive summary source path differs from its evidence hash')
            result.add(logical)
    return result


def validate(resolve, metadata, *, complete_heights=(), target_height):
    """Check declared coverage and exact row provenance against retained bytes."""
    if not isinstance(metadata,dict) or any(metadata.get(key)!=value for key,value in DESCRIPTION.items()):
        raise RuntimeError('Unsupported archive summary methodology or coverage')
    heights=metadata.get('snapshot_heights')
    if (not isinstance(heights,list) or not heights or any(type(h) is not int or not 0<=h<target_height for h in heights)
            or heights!=sorted(set(heights)) or set(heights)&set(map(int,complete_heights))):
        raise RuntimeError('Archive summary heights overlap actual snapshots or have invalid coverage')
    rows=history(_read(resolve(FILE)))
    if (type(metadata.get('rows')) is not int or metadata['rows']!=len(rows)
            or sorted({int(row['snapshot']) for row in rows})!=heights):
        raise RuntimeError('Archive summary row coverage differs from its metadata')
    sources=metadata.get('sources')
    source_artifacts(metadata)
    originals,times,seen,total={},{},set(),0
    for source in sources:
        payloads={}
        for kind in ('history','index'):
            logical=source[kind+'_artifact']
            payload=_read(resolve(logical));total+=len(payload)
            if total>MAX_BYTES or hashlib.sha256(payload).hexdigest()!=source[kind+'_sha256']:
                raise RuntimeError('Archive summary source evidence hash/budget mismatch')
            payloads[kind]=payload
        pair=(source['history_artifact'],source['index_artifact'])
        if pair in seen:raise RuntimeError('Duplicate archive summary source pair')
        seen.add(pair)
        source_times=catalog(payloads['index'])
        for row in history(payloads['history']):
            key=tuple(row[field] for field in HISTORICAL_ECO_HEADERS[:4]);height=row['snapshot']
            if height not in source_times:
                raise RuntimeError('Archive summary source history is missing its original catalog entry')
            if int(height) not in heights:continue
            if (key in originals and originals[key]!=row) or (height in times and times[height]!=source_times[height]):
                raise RuntimeError('Archive summary sources disagree')
            originals[key]=row;times[height]=source_times[height]
    if metadata.get('snapshot_times')!=times:
        raise RuntimeError('Archive summary timestamps differ from retained catalog evidence')
    if len(originals)!=len(rows) or any(originals.get(tuple(row[field] for field in HISTORICAL_ECO_HEADERS[:4]))!=row for row in rows):
        raise RuntimeError('Archive summary rows differ from retained original evidence')
    return rows


def stage(previous, output, marker, resolve, *, target_height, complete_heights):
    """Carry existing summaries, or preserve missing legacy archive histories."""
    rows,sources,times=[],[],{}
    existing=marker.get('metadata',{}).get('archive_summaries') if marker.get('format')==2 else None
    if existing:
        rows=validate(resolve,existing,target_height=marker['snapshot_blockheight'])
        sources=existing['sources'];times=existing['snapshot_times']
        for source in sources:
            for kind in ('history','index'):
                logical=source[kind+'_artifact']
                _atomic_write_text(output/logical,_read(resolve(logical)).decode('utf-8'))
    elif marker.get('format')!=2:
        history_path,index_path=resolve('historical_archived.csv'),resolve('archived_index.csv')
        if history_path.is_file()!=index_path.is_file():
            raise RuntimeError('Legacy archive summary history/catalog must both exist')
        if history_path.is_file():
            history_bytes,index_bytes=_read(history_path),_read(index_path)
            rows=history(history_bytes);times=catalog(index_bytes)
            if {row['snapshot'] for row in rows}!=set(times):
                raise RuntimeError('Legacy archive history and catalog coverage disagree')
            if rows:
                source={}
                for kind,payload in (('history',history_bytes),('index',index_bytes)):
                    checksum=hashlib.sha256(payload).hexdigest();logical=_source_name(kind,checksum)
                    source.update({kind+'_artifact':logical,kind+'_sha256':checksum})
                    _atomic_write_text(output/logical,payload.decode('utf-8'))
                sources=[source]
    complete=set(map(int,complete_heights))
    rows=[row for row in rows if int(row['snapshot'])<target_height and int(row['snapshot']) not in complete]
    heights=sorted({int(row['snapshot']) for row in rows})
    metadata={**DESCRIPTION,'snapshot_heights':heights,'snapshot_times':{str(h):times[str(h)] for h in heights},
              'rows':len(rows),'sources':sources} if rows else None
    _atomic_write_text(output/FILE,_serialize(rows))
    _atomic_write_text(output/STAGED_METADATA,json.dumps(metadata,sort_keys=True)+'\n')
    if metadata:validate(lambda logical:output/logical,metadata,complete_heights=complete,target_height=target_height)
    return metadata


def staged_metadata(root, *, include_archives, complete_heights, target_height):
    path=Path(root)/STAGED_METADATA
    if not include_archives or not path.is_file():return None
    metadata=json.loads(path.read_text())
    if metadata is not None:
        rows=validate(lambda logical:Path(root)/logical,metadata,target_height=target_height)
        # A genuine snapshot restored during historical repair takes priority.
        # Its caller has already validated the actual snapshot/catalog bundle.
        complete=set(map(int,complete_heights))
        retained=[row for row in rows if int(row['snapshot']) not in complete]
        if len(retained)!=len(rows):
            heights=sorted({int(row['snapshot']) for row in retained})
            metadata={**metadata,'snapshot_heights':heights,'rows':len(retained),
                'snapshot_times':{str(h):metadata['snapshot_times'][str(h)] for h in heights}} if heights else None
            _atomic_write_text(Path(root)/FILE,_serialize(retained))
            _atomic_write_text(path,json.dumps(metadata,sort_keys=True)+'\n')
        if metadata:
            validate(lambda logical:Path(root)/logical,metadata,complete_heights=complete,target_height=target_height)
    return metadata
