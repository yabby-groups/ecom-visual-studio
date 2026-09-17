#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACT_DIR="$ROOT/build/bin"

cd "$ROOT"
command -v wails >/dev/null 2>&1 || {
  echo "Wails v2 is required on the build host." >&2
  exit 1
}

npm run build:desktop
test -f desktop_assets/index.html || {
  echo "The embedded frontend build did not produce desktop_assets/index.html" >&2
  exit 1
}

wails build -s -clean -m -nosyncgomod -skipembedcreate -trimpath -platform windows/amd64 -nsis -webview2 browser

APP_COUNT=$(find "$ARTIFACT_DIR" -maxdepth 1 -type f -name 'EcomVisualStudio*.exe' ! -name '*installer*.exe' | wc -l | tr -d ' ')
INSTALLER_COUNT=$(find "$ARTIFACT_DIR" -maxdepth 1 -type f -name 'EcomVisualStudio*installer*.exe' | wc -l | tr -d ' ')
test "$APP_COUNT" -ge 1 && test "$INSTALLER_COUNT" -ge 1 || {
  echo "Windows application EXE and NSIS installer were not both created in $ARTIFACT_DIR" >&2
  exit 1
}

echo "Windows artifacts: $ARTIFACT_DIR"
