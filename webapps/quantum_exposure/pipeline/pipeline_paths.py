#!/usr/bin/env python3
"""Shared path helpers for quantum exposure pipeline scripts."""

from __future__ import annotations

import os
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parent
QUANTUM_DIR = PIPELINE_DIR.parent
REPO_ROOT = QUANTUM_DIR.parent.parent
STANDALONE_DEFAULT_DIR = REPO_ROOT / "webapps-quantum-exposure"


def resolve_env_file() -> Path:
    """Resolve .env path with explicit override and safe repo/worktree fallbacks."""
    explicit = os.getenv("QUANTUM_PIPELINE_ENV_FILE")
    if explicit:
        return Path(explicit)

    candidates = [
        REPO_ROOT / ".env",
        Path("/Users/wicked/Projects/repos/animations/.env"),
        Path("/Users/wicked/Projects/animations/.env"),
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return candidates[0]


def resolve_standalone_repo_dir() -> Path:
    """Resolve standalone webapps-quantum-exposure repo location."""
    explicit = os.getenv("QUANTUM_STANDALONE_REPO")
    if explicit:
        return Path(explicit)
    return STANDALONE_DEFAULT_DIR
