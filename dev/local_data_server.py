#!/usr/bin/env python3
"""Local static server with a dashboard-data sync endpoint.

Usage:
  python3 dev/local_data_server.py --port 8082

Endpoint:
  POST /__pull_latest_data__

This endpoint fetches origin/main and checks out dashboard data paths from that ref
without switching branches.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SYNC_PATHS = [
    "assets",
    "webapps/dca_cost_basis/webapp_data",
    "webapps/bip110_signaling/webapp_data",
    "webapps/bitcoin_dominance/webapp_data",
    "webapps/node_count/webapp_data",
    "webapps/quantum_exposure/webapp_data",
]


def run_git(repo_root: Path, args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(repo_root),
        text=True,
        capture_output=True,
        check=False,
    )


def is_local_client(address: str) -> bool:
    return address in {"127.0.0.1", "::1", "localhost"}


def get_dirty_data_paths(repo_root: Path) -> list[str]:
    proc = run_git(repo_root, ["status", "--porcelain", "--", *SYNC_PATHS])
    if proc.returncode != 0:
        return []
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    dirty = []
    for line in lines:
        if len(line) <= 3:
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        dirty.append(path)
    return dirty


def differs_from_origin_main(repo_root: Path, path: str) -> bool:
    proc = run_git(repo_root, ["diff", "--quiet", "origin/main", "--", path])
    # exit code 1 means there is a diff; 0 means no diff
    if proc.returncode in {0, 1}:
        return proc.returncode == 1
    # On unexpected git errors, be conservative and treat as conflicting.
    return True


def get_blocking_dirty_paths(repo_root: Path) -> list[str]:
    dirty_paths = get_dirty_data_paths(repo_root)
    return [path for path in dirty_paths if differs_from_origin_main(repo_root, path)]


def pull_latest_data(repo_root: Path) -> tuple[int, dict]:
    fetch_proc = run_git(repo_root, ["fetch", "origin", "main"])
    if fetch_proc.returncode != 0:
        return (
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {
                "ok": False,
                "error": "git fetch failed",
                "details": fetch_proc.stderr.strip() or fetch_proc.stdout.strip(),
            },
        )

    blocking_dirty_paths = get_blocking_dirty_paths(repo_root)

    # Always sync these generated data paths to origin/main, even when local edits exist.
    # This endpoint is intended for fast local refreshes where latest remote data is preferred.
    restore_proc = run_git(
        repo_root,
        ["restore", "--source", "origin/main", "--staged", "--worktree", "--", *SYNC_PATHS],
    )
    if restore_proc.returncode != 0:
        return (
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {
                "ok": False,
                "error": "git restore --source origin/main --worktree -- <data paths> failed",
                "details": restore_proc.stderr.strip() or restore_proc.stdout.strip(),
            },
        )

    commit_proc = run_git(repo_root, ["rev-parse", "--short", "origin/main"])
    commit = commit_proc.stdout.strip() if commit_proc.returncode == 0 else ""

    return (
        HTTPStatus.OK,
        {
            "ok": True,
            "commit": commit,
            "syncedPaths": SYNC_PATHS,
            "overwroteLocalChanges": blocking_dirty_paths,
        },
    )


class LocalDataServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str | None = None, repo_root: Path | None = None, **kwargs):
        self.repo_root = repo_root or Path.cwd()
        super().__init__(*args, directory=directory, **kwargs)

    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/__pull_latest_data__":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            return

        client_ip = self.client_address[0] if self.client_address else ""
        if not is_local_client(client_ip):
            self._write_json(
                HTTPStatus.FORBIDDEN,
                {"ok": False, "error": "Endpoint is restricted to localhost."},
            )
            return

        status, payload = pull_latest_data(self.repo_root)
        self._write_json(status, payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve local dashboards with pull-latest-data endpoint.")
    parser.add_argument("--port", type=int, default=8082)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--root", default=".", help="Directory to serve as document root")
    args = parser.parse_args()

    repo_root = Path(args.root).resolve()
    if not (repo_root / ".git").exists():
        print(f"[local_data_server] error: no .git directory at {repo_root}", file=sys.stderr)
        return 1

    handler_cls = lambda *h_args, **h_kwargs: LocalDataServerHandler(  # noqa: E731
        *h_args,
        directory=str(repo_root),
        repo_root=repo_root,
        **h_kwargs,
    )

    with ThreadingHTTPServer((args.host, args.port), handler_cls) as server:
        host, port = server.server_address[:2]
        print(f"[local_data_server] serving {repo_root} at http://{host}:{port}")
        print(f"[local_data_server] POST http://{host}:{port}/__pull_latest_data__ to sync data")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
