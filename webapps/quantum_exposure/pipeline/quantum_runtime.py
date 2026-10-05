"""Explicit-root Quantum runtime synchronization; no database or Git side effects."""
from pathlib import Path
import os
import re
import shutil
from pipeline_paths import QUANTUM_DIR


def implementation_fingerprint(repo: Path) -> str:
    """Hash producer/publication/runtime source, independent of data-only commits.

    The original Git revision remains generation provenance. This content identity
    permits a sealed export receipt to resume after unrelated automation commits,
    while rejecting a retry under changed producer or publication code.
    """
    import hashlib
    repo = Path(repo).resolve()
    runtime = repo / 'webapps/quantum_exposure'
    pipeline = runtime / 'pipeline'
    paths = set(pipeline.glob('*.py')) | set((pipeline / 'migrations').glob('*.sql'))
    paths.update(source for source, _ in runtime_dependency_copies(runtime, repo))
    paths.update((runtime / 'preview_app.js', repo / 'scripts/automation/_git_deploy.py',
                  repo / 'scripts/build_pages_dist.sh'))
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda value: value.relative_to(repo).as_posix()):
        relative = path.relative_to(repo).as_posix()
        if not path.is_file():
            raise RuntimeError(f'Missing implementation dependency: {relative}')
        digest.update(relative.encode('utf-8') + b'\0')
        with path.open('rb') as stream:
            digest.update(hashlib.file_digest(stream, 'sha256').digest())
    return digest.hexdigest()

def copy_file_if_changed(source: Path, target: Path) -> bool:
    from immutable_generation import file_sha256
    if target.is_file() and source.stat().st_size == target.stat().st_size and file_sha256(source) == file_sha256(target):
        return False
    import tempfile
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
        temp = Path(handle.name)
    try:
        shutil.copyfile(source, temp)
        os.chmod(temp, 0o644)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)
    return True


def runtime_dependency_copies(runtime_dir: Path, target_repo: Path) -> list[tuple[Path, Path]]:
    """Resolve local HTML/CSS runtime dependencies, rejecting missing sources."""
    runtime_dir = Path(runtime_dir).resolve()
    source_repo = runtime_dir.parent.parent
    pending = [runtime_dir / "dashboard.html", runtime_dir / "dashboard_app.js",
               runtime_dir.parent / "shared" / "webapp_data_auto_refresh.js"]
    seen = set()
    copies = []
    while pending:
        source = pending.pop().resolve()
        if source in seen:
            continue
        seen.add(source)
        try:
            relative = source.relative_to(source_repo)
        except ValueError as exc:
            raise RuntimeError("Runtime dependency escapes source checkout") from exc
        if not source.is_file():
            raise RuntimeError(f"Missing standalone runtime dependency: {relative}")
        copies.append((source, Path(target_repo) / relative))
        if source.suffix not in (".html", ".css"):
            continue
        contents = source.read_text(encoding="utf-8")
        refs = re.findall(r'''(?:src|href)\s*=\s*["']([^"']+)["']''', contents) if source.suffix == ".html" else re.findall(r'''url\(\s*["']?([^\s)'";]+)''', contents)
        for ref in refs:
            if ref.startswith(("http:", "https:", "//", "data:", "#", "mailto:", "javascript:")):
                continue
            path = ref.split("?", 1)[0].split("#", 1)[0]
            if not path or path.startswith("/"):
                continue
            dependency = source.parent / path
            # Navigation links are not runtime dependencies. Script, stylesheet,
            # image and font references are copied transitively.
            if dependency.suffix.lower() in {".js", ".css", ".png", ".svg", ".ico", ".woff", ".woff2"}:
                pending.append(dependency)
    return copies


def sync_generation_to_standalone(source_data_dir: Path, target_repo: Path, *, runtime_dir: Path = QUANTUM_DIR) -> str:
    """Independent format-2 delivery; no mutable module globals or Git actions.

    The caller owns destination sequencing/lease. Payloads and complete runtime
    dependencies precede the destination marker; retries reuse matching hashes.
    """
    from immutable_generation import copy_immutable_generation
    target_repo = Path(target_repo).resolve()
    copies = runtime_dependency_copies(runtime_dir, target_repo)
    for source, target in copies:
        copy_file_if_changed(source, target)
    target_data = target_repo / "webapps" / "quantum_exposure" / "webapp_data"
    return copy_immutable_generation(Path(source_data_dir), target_data)
