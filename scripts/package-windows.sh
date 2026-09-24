#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACT_DIR="$ROOT/build/bin"

cd "$ROOT"
command -v wails >/dev/null 2>&1 || {
  echo "Wails v2 is required on the build host." >&2
  exit 1
}
command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 || {
  echo "The Windows x64 MinGW compiler is required on the build host." >&2
  exit 1
}
export CC=x86_64-w64-mingw32-gcc

npm run build:desktop
test -f desktop_assets/index.html || {
  echo "The embedded frontend build did not produce desktop_assets/index.html" >&2
  exit 1
}

wails build -s -clean -m -nosyncgomod -skipembedcreate -trimpath -platform windows/amd64 -nsis -webview2 browser

test -f "$ARTIFACT_DIR/EcomVisualStudio.exe" &&
  test -f "$ARTIFACT_DIR/Ecom Visual Studio-amd64-installer.exe" || {
  echo "Windows application EXE and NSIS installer were not both created in $ARTIFACT_DIR" >&2
  exit 1
}

echo "Windows artifacts: $ARTIFACT_DIR"
