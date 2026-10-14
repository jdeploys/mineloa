#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Apple processing helper requires macOS.' >&2
  exit 1
fi
case "${1:-$(uname -m)}" in
  arm64|aarch64) arch='arm64' ;;
  x64|x86_64) arch='x64' ;;
  *) echo 'Unsupported architecture.' >&2; exit 1 ;;
esac
output="$repo_root/build/apple-processing/$arch"
mkdir -p -- "$output"
target='arm64-apple-macosx26.0'
if [[ "$arch" == x64 ]]; then target='x86_64-apple-macosx26.0'; fi
swiftc -O -swift-version 6 -parse-as-library -target "$target" \
  -o "$output/apple-processing-helper" "$repo_root/native/apple-processing/main.swift"
chmod 0755 "$output/apple-processing-helper"
