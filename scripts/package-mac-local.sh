#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$repo_root"

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'A local signed macOS build requires macOS.' >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) arch='arm64'; app_dir='dist/mac-arm64/Mineloa.app' ;;
  x86_64) arch='x64'; app_dir='dist/mac/Mineloa.app' ;;
  *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
esac

identity="${MAC_SIGNING_IDENTITY:-}"
if [[ -z "$identity" ]]; then
  echo 'Set MAC_SIGNING_IDENTITY to a valid codesigning identity name or SHA-1 hash.' >&2
  security find-identity -v -p codesigning >&2 || true
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -Fq "$identity"; then
  echo "Codesigning identity is not available: $identity" >&2
  exit 1
fi

bash ./scripts/build-local-runtime.sh "$arch"
npm run build

CSC_NAME=- CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
  --mac dir --"$arch" --publish never \
  --config.mac.hardenedRuntime=false --config.mac.notarize=false

node scripts/sign-mac-local.mjs "$app_dir" "$identity"
node scripts/verify-package.mjs "$app_dir"

if [[ "${1:-}" == '--install' ]]; then
  destination='/Applications/Mineloa.app'
  if [[ -e "$destination" ]]; then
    echo "Refusing to overwrite existing app: $destination" >&2
    exit 1
  fi
  ditto "$app_dir" "$destination"
  codesign --verify --deep --strict --verbose=2 "$destination"
  echo "Installed $destination"
else
  echo "Built $repo_root/$app_dir"
fi
