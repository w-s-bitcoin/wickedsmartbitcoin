#!/usr/bin/env python3
"""Increment the homepage patch version once per merged PR, using GitHub's API.

Remote writes require --publish. Tests inject an in-memory API; this script never
touches the maintainer's checkout or invokes the production data producers.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import urllib.request


LEDGER = ".github/versioned-prs.json"
VERSION = re.compile(r'(<span\s+id="version-info">\(v)(\d+)\.(\d+)\.(\d+)(\)</span>)')


def plan_bump(html: str, ledger_text: str, pr: int) -> tuple[str, dict[str, str]]:
    if type(pr) is not int or pr <= 0:
        raise ValueError("PR number must be a positive integer")
    ledger = json.loads(ledger_text)
    counted = ledger.get("pull_requests")
    if (ledger.get("schema_version") != 1 or not isinstance(counted, list)
            or any(type(item) is not int or item <= 0 for item in counted)
            or len(set(counted)) != len(counted)):
        raise ValueError("Invalid versioned-PR ledger")
    matches = list(VERSION.finditer(html))
    if len(matches) != 1:
        raise ValueError("Expected exactly one homepage version")
    match = matches[0]
    major, minor, patch = (int(match[i]) for i in (2, 3, 4))
    if pr in counted:
        return f"{major}.{minor}.{patch}", {}
    version = f"{major}.{minor}.{patch + 1}"
    updated = html[:match.start()] + match[1] + version + match[5] + html[match.end():]
    ledger["pull_requests"] = sorted([*counted, pr])
    return version, {"index.html": updated, LEDGER: json.dumps(ledger, indent=2) + "\n"}


class GitHub:
    def __init__(self, repository: str, token: str):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            raise ValueError("Expected an owner/repository name")
        self.base = f"https://api.github.com/repos/{repository}/"
        self.token = token

    def request(self, method: str, path: str, data=None):
        request = urllib.request.Request(self.base + path, method=method,
            data=None if data is None else json.dumps(data).encode(), headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "Content-Type": "application/json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "wickedsmartbitcoin-version-workflow",
            })
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)


def publish_bump(api, pr: int, attempts: int = 5) -> str:
    if type(pr) is not int or pr <= 0:
        raise ValueError("PR number must be a positive integer")
    pull = api.request("GET", f"pulls/{pr}")
    if not pull.get("merged") or pull.get("base", {}).get("ref") != "main":
        raise ValueError("Only merged PRs targeting main can increment the version")
    for _ in range(attempts):
        head = api.request("GET", "git/ref/heads/main")["object"]["sha"]
        commit = api.request("GET", f"git/commits/{head}")
        files = {}
        for path in ("index.html", LEDGER):
            blob = api.request("GET", f"contents/{path}?ref={head}")
            if blob.get("encoding") != "base64" or blob.get("type") != "file":
                raise ValueError(f"Cannot read version file: {path}")
            files[path] = base64.b64decode(blob["content"]).decode("utf-8")
        version, updates = plan_bump(files["index.html"], files[LEDGER], pr)
        if not updates:
            print(f"PR #{pr} already counted; current version is v{version}")
            return version
        tree = api.request("POST", "git/trees", {
            "base_tree": commit["tree"]["sha"],
            "tree": [{"path": path, "mode": "100644", "type": "blob", "content": content}
                     for path, content in updates.items()],
        })
        candidate = api.request("POST", "git/commits", {
            "message": f"Bump site version to v{version} after PR #{pr}",
            "tree": tree["sha"], "parents": [head],
        })
        try:
            # Fast-forward only: concurrent merges/data amendments must never be lost.
            api.request("PATCH", "git/refs/heads/main", {"sha": candidate["sha"], "force": False})
        except Exception:
            if api.request("GET", "git/ref/heads/main")["object"]["sha"] == head:
                raise  # Permission/protection failures cannot be fixed by retrying.
            continue  # Recompute against the new head, including its ledger.
        print(f"Published v{version} for PR #{pr}")
        return version
    raise RuntimeError("Main kept changing; rerun this workflow to retry safely")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--publish", action="store_true", help="Authorize the remote version commit")
    args = parser.parse_args()
    if not args.publish:
        parser.error("Remote writes require --publish")
    token = os.environ.get("GH_TOKEN")
    if not token:
        parser.error("GH_TOKEN is required")
    publish_bump(GitHub(args.repository, token), args.pr)


if __name__ == "__main__":
    main()
