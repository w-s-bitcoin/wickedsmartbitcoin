#!/usr/bin/env python3
"""Read-only metadata enumeration reproducing the identity-consensus input walk."""
import argparse
import json
from collections import Counter
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--data', required=True, type=Path)
args = parser.parse_args()
root = args.data.resolve()
paths = [
    item
    for directory in (root, root / 'archived')
    for item in directory.rglob('dashboard_pubkeys_ge_1btc.csv')
    if item.parent.name.isdigit()
]
counts = Counter(paths)
print(json.dumps({
    'data_directory': str(root),
    'listed_files': len(paths),
    'unique_files': len(counts),
    'duplicated_files': sum(count > 1 for count in counts.values()),
    'listed_bytes': sum(item.stat().st_size for item in paths),
    'unique_bytes': sum(item.stat().st_size for item in counts),
    'duplicate_archive_inputs_reproduced': any(count > 1 for count in counts.values()),
    'note': 'Replicates the directory walk at sync_identity_consensus_from_snapshots.py:158; reads file metadata only.'
}, indent=2))
