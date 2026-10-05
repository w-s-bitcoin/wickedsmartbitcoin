"""Pure configuration validation shared by the worker and scheduler installer."""
from __future__ import annotations

PROJECTION_ACCOUNTING_VERSION = 'group-accounting-v2'


LEGACY_BOOTSTRAP_SOURCES = (
    'active_key_outputs', 'active_p2sh_outputs', 'active_p2wsh_outputs',
    'active_p2tr_outputs', 'active_bare_ms_outputs',
)
DEFAULT_DISK_RESERVE_BYTES = 512 * 1024**3


def effective_config(config):
    """Nonsecret settings that affect measured work or its destinations.

    Never persist environment contents or a DSN. Database identity is checked
    separately from the live connection during scheduler acceptance.
    """
    from pathlib import Path
    defaults = {'work_seconds':45, 'export_seconds':900, 'batch_blocks':10,
                'bootstrap_rows':10000, 'bootstrap_rows_by_source':{},
                'max_batch_rows':250000, 'batch_pause_seconds':0.25,
                'memory_limit_bytes':4*1024**3, 'label_version':'unattributed-v2',
                'validation_blocks':1000, 'undo_blocks':2016,
                'disk_reserve_bytes':DEFAULT_DISK_RESERVE_BYTES}
    result = {key:config.get(key,value) for key,value in defaults.items()}
    for key in ('validation_rows','reset_rows'):
        result[key] = config.get(key,result['bootstrap_rows'])
    for key in ('production_repo','standalone_repo','state_dir','env_file'):
        result[key] = str(Path(config[key]).expanduser().resolve()) if config.get(key) else None
    return result


def config_fingerprint(config):
    import hashlib
    import json
    return hashlib.sha256(json.dumps(effective_config(config),sort_keys=True,
                                    separators=(',',':')).encode()).hexdigest()


def control_settings(control):
    return {key:control.get(key) for key in ('start_height','confirmations','boundary_size')}


def undo_retention_blocks(config):
    """Retain at least this many recent blocks, rounded out to whole batches."""
    value = config.get('undo_blocks', 2016)
    if type(value) is not int or not 1000 <= value <= 10000:
        raise ValueError('undo_blocks must be an integer from 1000 to 10000')
    return value


def bootstrap_row_limits(config, *, legacy_sources=LEGACY_BOOTSTRAP_SOURCES):
    """Return the fallback row cap and validated optional per-source overrides.

    The worker supplies store.LEGACY; the installer stays dependency-free using
    the same source names without importing PostgreSQL or producer modules.
    """
    fallback = config.get('bootstrap_rows', 10000)
    if type(fallback) is not int or not 1 <= fallback <= 100000:
        raise ValueError('bootstrap_rows must be an integer from 1 to 100000')
    overrides = config.get('bootstrap_rows_by_source', {})
    if not isinstance(overrides, dict):
        raise ValueError('bootstrap_rows_by_source must be an object')
    allowed = set(legacy_sources) | {'other:source', 'canonical_blocks'}
    for source, value in overrides.items():
        if source not in allowed:
            raise ValueError(f'Unknown bootstrap_rows_by_source source: {source!r}')
        if type(value) is not int or not 1 <= value <= 100000:
            raise ValueError(f'bootstrap_rows_by_source[{source!r}] must be an integer from 1 to 100000')
    return fallback, dict(overrides)
