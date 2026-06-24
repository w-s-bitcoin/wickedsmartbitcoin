#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="${QUANTUM_STANDALONE_REPO:-"$script_dir/webapps-quantum-exposure"}"
remote="${QUANTUM_STANDALONE_REMOTE:-origin}"
target_branch="${QUANTUM_STANDALONE_BRANCH:-main}"
commit_message="${1:-Update Quantum Exposure standalone bundle}"

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

run_git() {
  git -C "$repo_dir" "$@"
}

has_staged_changes() {
  ! run_git diff --cached --quiet --exit-code
}

has_local_changes() {
  ! run_git diff --quiet --exit-code || ! run_git diff --cached --quiet --exit-code
}

ensure_no_git_operation_in_progress() {
  local git_dir
  git_dir="$(run_git rev-parse --git-dir)"
  case "$git_dir" in
    /*) ;;
    *) git_dir="$repo_dir/$git_dir" ;;
  esac
  [[ -e "$git_dir/MERGE_HEAD" ]] && die "merge already in progress in $repo_dir"
  [[ -d "$git_dir/rebase-merge" || -d "$git_dir/rebase-apply" ]] && die "rebase already in progress in $repo_dir"
}

commit_current_changes() {
  run_git add -A .
  if has_staged_changes; then
    run_git commit -m "$commit_message"
    run_git rev-parse --short HEAD
  else
    printf 'No Quantum Exposure standalone changes to commit.\n'
  fi
}

merge_remote_target() {
  run_git fetch "$remote"
  if ! run_git rev-parse --verify --quiet "$remote/$target_branch" >/dev/null; then
    die "remote branch not found: $remote/$target_branch"
  fi

  if ! run_git merge-base --is-ancestor "$remote/$target_branch" HEAD; then
    run_git merge --no-edit "$remote/$target_branch"
  fi
}

main() {
  [[ -d "$repo_dir" ]] || die "standalone repo directory not found: $repo_dir"
  run_git rev-parse --is-inside-work-tree >/dev/null || die "not a git worktree: $repo_dir"
  ensure_no_git_operation_in_progress

  local current_branch
  current_branch="$(run_git branch --show-current)"
  [[ -n "$current_branch" ]] || die "detached HEAD in $repo_dir"

  printf 'Quantum Exposure repo: %s\n' "$repo_dir"
  printf 'Target remote branch : %s/%s\n' "$remote" "$target_branch"
  printf 'Current branch       : %s\n' "$current_branch"

  if [[ "$current_branch" == "$target_branch" ]]; then
    commit_current_changes
    merge_remote_target
    run_git push "$remote" "HEAD:$target_branch"
    printf 'Pushed %s to %s/%s.\n' "$(run_git rev-parse --short HEAD)" "$remote" "$target_branch"
    return
  fi

  local source_commit
  commit_current_changes
  source_commit="$(run_git rev-parse HEAD)"

  has_local_changes && die "unexpected uncommitted changes remain in $repo_dir"

  run_git fetch "$remote"
  run_git switch "$target_branch"
  merge_remote_target
  run_git merge --no-edit "$source_commit"
  run_git push "$remote" "HEAD:$target_branch"
  printf 'Merged %s into %s and pushed %s/%s.\n' "${source_commit:0:9}" "$target_branch" "$remote" "$target_branch"
}

main "$@"
