#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$repo_root"

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'The macOS release downloader requires macOS.' >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) arch='arm64' ;;
  x86_64) arch='x64' ;;
  *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
esac

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo 'A branch is required to dispatch the release workflow.' >&2
  exit 1
fi

head_sha="$(git rev-parse HEAD)"
remote_sha="$(git ls-remote origin "refs/heads/$branch" | cut -f1)"
if [[ "$head_sha" != "$remote_sha" ]]; then
  echo "Push $branch before requesting a notarized release." >&2
  exit 1
fi

gh workflow run mac-direct-release.yml --ref "$branch" -f "arch=$arch"

run_id=''
for _ in {1..20}; do
  run_id="$(gh run list --workflow mac-direct-release.yml --branch "$branch" --event workflow_dispatch \
    --json databaseId,headSha --jq ".[] | select(.headSha == \"$head_sha\") | .databaseId" --limit 10 | head -n 1)"
  [[ -n "$run_id" ]] && break
  sleep 2
done

if [[ -z "$run_id" ]]; then
  echo 'Unable to locate the dispatched release workflow.' >&2
  exit 1
fi

gh run watch "$run_id" --exit-status
destination="dist/notarized-$arch"
mkdir -p "$destination"
gh run download "$run_id" --pattern "mineloa-macos-$arch-*" --dir "$destination"
dmg="$(find "$destination" -type f -name '*.dmg' -print -quit)"
test -n "$dmg"
hdiutil verify "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
echo "Downloaded notarized release: $repo_root/$dmg"
