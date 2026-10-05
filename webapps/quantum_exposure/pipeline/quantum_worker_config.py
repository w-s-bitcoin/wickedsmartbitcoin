"""Pure configuration validation shared by the worker and scheduler installer."""
from __future__ import annotations


LEGACY_BOOTSTRAP_SOURCES = (
    'active_key_outputs', 'active_p2sh_outputs', 'active_p2wsh_outputs',
    'active_p2tr_outputs', 'active_bare_ms_outputs',
)


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
