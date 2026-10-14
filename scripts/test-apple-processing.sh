#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/mineloa-apple-contracts.XXXXXX")"
trap 'rm -rf -- "$test_directory"' EXIT
swiftc -swift-version 6 -parse-as-library -D APPLE_PROCESSING_CONTRACT_TEST \
  -target arm64-apple-macosx26.0 -o "$test_directory/contracts" \
  "$repo_root/native/apple-processing/main.swift"
"$test_directory/contracts"
