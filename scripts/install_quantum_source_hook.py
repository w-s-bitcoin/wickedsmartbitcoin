#!/usr/bin/env python3
"""Install the reviewed, reversible Quantum watermark hook without running ingest.

Default is a dry run. Backups are local to the external ingestion checkout and
never committed. Exact insertion points fail closed when CoreToPSQL changes.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "webapps/quantum_exposure/pipeline/quantum_source_boundary.py"


REPLACEMENTS = [
        ("def main():\n", "def main():\n    import quantum_source_boundary\n"),
        ("    rpc_connection, latestHeight = initialize_rpc_connection()\n",
         "    rpc_connection, latestHeight = initialize_rpc_connection()\n    quantum_ingestion_id = quantum_source_boundary.begin(connection)\n"),
        ('        print("[Ingest] Up to date.")\n',
         '        quantum_source_boundary.finish(connection, rpc_connection, quantum_ingestion_id)\n        print("[Ingest] Up to date.")\n'),
        ("    insert_sql_commands(startingHeight, maxHeight)\n    connection.commit()\n",
         "    insert_sql_commands(startingHeight, maxHeight)\n    connection.commit()\n    quantum_source_boundary.finish(connection, rpc_connection, quantum_ingestion_id)\n"),
        ('    cursor.execute("DELETE FROM blockheader WHERE blockheight >= %s;", (reorg_height,))\n\n    connection.commit()',
         '    cursor.execute("DELETE FROM blockheader WHERE blockheight >= %s;", (reorg_height,))\n\n    import quantum_source_boundary\n    quantum_source_boundary.reorg(connection, reorg_height)\n    connection.commit()'),
]
REORG_TAIL = (
    '            return reorg_start if reorg_start <= last_processed_height else None\n'
    '    return None\n',
    '            return reorg_start if reorg_start <= last_processed_height else None\n'
    '    raise RuntimeError("No common ancestor in the bounded reorg search; source recovery is required before ingest")\n',
)


def _node(source: str):
    return ast.parse(source).body[0]


def _same(left, right):
    return ast.dump(left, include_attributes=False) == ast.dump(right, include_attributes=False)


def _position(body, statement):
    wanted = _node(statement)
    positions = [i for i, node in enumerate(body) if _same(node, wanted)]
    if len(positions) != 1:
        raise ValueError(f'Installed Quantum hook placement changed: {statement}')
    return positions[0]


def verify_installed_source(source: str, *, require_reorg_guard: bool = True) -> None:
    """Verify all hook blocks and their control-flow placement without imports.

    A matching import alone cannot certify installation. Reversing every exact
    insertion also rejects duplicate, partial, aliased, or extra hook references.
    AST checks prevent the same text in another scope from passing that check.
    """
    original = source
    for before, after in REPLACEMENTS:
        if original.count(after) != 1:
            raise ValueError(f'Incomplete or changed Quantum hook block: {before.splitlines()[0]}')
        original = original.replace(after, before)
    if 'quantum_source_boundary' in original or 'quantum_ingestion_id' in original:
        raise ValueError('Unexpected Quantum hook reference outside installed blocks')
    tree = ast.parse(source)
    functions = {}
    for name in ('main', 'rollback_reorg'):
        found = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
        if len(found) != 1:
            raise ValueError(f'Installed Quantum hook requires one top-level {name} function')
        functions[name] = found[0]
    main = functions['main'].body
    if _position(main, 'import quantum_source_boundary') != 0:
        raise ValueError('Installed Quantum hook import must begin main')
    begin = _position(main, 'quantum_ingestion_id = quantum_source_boundary.begin(connection)')
    rpc = _position(main, 'rpc_connection, latestHeight = initialize_rpc_connection()')
    if begin != rpc + 1:
        raise ValueError('Installed Quantum begin must follow RPC initialization')
    mutation_calls = {'detect_reorg', 'rollback_reorg', 'update_nexthash', 'export_data', 'insert_sql_commands'}
    if any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
           and node.func.id in mutation_calls and node.lineno < main[begin].lineno
           for node in ast.walk(functions['main'])):
        raise ValueError('Installed Quantum begin must precede chain mutation/reorg checks')
    finish = 'quantum_source_boundary.finish(connection, rpc_connection, quantum_ingestion_id)'
    up_to_date = [node for node in main if isinstance(node, ast.If)
                  and _same(node.test, _node('currentHeight > latestHeight').value)]
    if (len(up_to_date) != 1 or _position(up_to_date[0].body, finish) != 0
            or _position(up_to_date[0].body, 'print("[Ingest] Up to date.")') != 1):
        raise ValueError('Installed Quantum finish must begin the up-to-date branch')
    done = _position(main, finish)
    insert = _position(main, 'insert_sql_commands(startingHeight, maxHeight)')
    if done != insert + 2 or not _same(main[insert + 1], _node('connection.commit()')):
        raise ValueError('Installed Quantum finish must follow the final source commit')
    if not begin < main.index(up_to_date[0]) < insert:
        raise ValueError('Installed Quantum readiness branches are out of order')
    if any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
           and node.func.id in mutation_calls and node.lineno > main[done].lineno
           for node in ast.walk(functions['main'])):
        raise ValueError('Installed Quantum finish must follow chain mutation/reorg checks')
    rollback = functions['rollback_reorg'].body
    deleted = _position(rollback, 'cursor.execute("DELETE FROM blockheader WHERE blockheight >= %s;", (reorg_height,))')
    hook = _position(rollback, 'quantum_source_boundary.reorg(connection, reorg_height)')
    if (hook != deleted + 2 or not _same(rollback[deleted + 1], _node('import quantum_source_boundary'))
            or hook + 1 >= len(rollback) or not _same(rollback[hook + 1], _node('connection.commit()'))):
        raise ValueError('Installed Quantum reorg must follow header deletion and precede its commit')
    if require_reorg_guard:
        if source.count(REORG_TAIL[1]) != 1:
            raise ValueError('Installed source must fail closed after an exhausted reorg search')
        searches = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'detect_reorg']
        if len(searches) != 1 or not _same(searches[0].body[-1], _node(REORG_TAIL[1].splitlines()[-1].strip())):
            raise ValueError('Reorg exhaustion guard must terminate detect_reorg')


def patch_source(source: str) -> str:
    ast.parse(source)
    if 'quantum_source_boundary' in source or 'quantum_ingestion_id' in source:
        verify_installed_source(source, require_reorg_guard=False)
    else:
        for before, after in REPLACEMENTS:
            if source.count(before) != 1:
                raise ValueError(f"CoreToPSQL insertion point changed: {before.splitlines()[0]}")
            source = source.replace(before, after)
    before, after = REORG_TAIL
    if after not in source:
        if source.count(before) != 1:
            raise ValueError('CoreToPSQL insertion point changed: detect_reorg exhaustion')
        source = source.replace(before, after)
    verify_installed_source(source)
    return source


def install_source(source_path: Path, original: str, updated: str, *, expected_sha256: str,
                   lock: Path = Path('/tmp/onchain_update_bitcoin_data.lock')) -> None:
    """Install only reviewed source bytes while holding the real caller lock."""
    digest = hashlib.sha256(original.encode()).hexdigest()
    if expected_sha256 != digest:
        raise ValueError('Expected source SHA256 is missing or differs; review a new dry run before applying')
    verify_installed_source(updated)
    try:
        lock.mkdir()
    except FileExistsError:
        raise SystemExit('Ingestion lock exists; defer installation until ingestion is idle')
    try:
        (lock / 'pid').write_text(str(os.getpid()))
        if source_path.read_bytes() != original.encode():
            raise RuntimeError('Source changed after review; installation aborted without source writes')
        if original != updated:
            suffix = '.pre-quantum-reorg-guard' if 'import quantum_source_boundary' in original else '.pre-quantum-v2'
            backup = source_path.with_name(source_path.name + suffix)
            if backup.exists():
                raise SystemExit('Existing backup would be overwritten; inspect before installation')
            shutil.copy2(source_path, backup)
        shutil.copy2(MODULE, source_path.parent / MODULE.name)
        if original != updated:
            temporary = source_path.with_name(source_path.name + '.quantum-tmp')
            temporary.write_bytes(updated.encode())
            shutil.copymode(source_path, temporary)
            temporary.replace(source_path)
    finally:
        (lock / 'pid').unlink(missing_ok=True)
        lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument('--expected-source-sha256', help='Reviewed dry-run source hash; required with --apply')
    args = parser.parse_args()
    original = args.source.read_bytes().decode()
    updated = patch_source(original)
    print(f"Hook {'already installed' if original == updated else 'ready'}; source SHA256 {hashlib.sha256(original.encode()).hexdigest()}")
    if args.apply:
        install_source(args.source, original, updated, expected_sha256=args.expected_source_sha256)
        print('Installed source watermark/reorg guards; no ingestion job was invoked')


if __name__ == "__main__":
    main()
