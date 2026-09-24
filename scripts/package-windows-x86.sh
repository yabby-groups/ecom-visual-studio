#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACT_DIR="$ROOT/build/bin"

cd "$ROOT"
command -v wails >/dev/null 2>&1 || {
  echo "Wails v2 is required on the build host." >&2
  exit 1
}
command -v i686-w64-mingw32-gcc >/dev/null 2>&1 || {
  echo "The Windows x86 MinGW compiler is required on the build host." >&2
  exit 1
}
export CC=i686-w64-mingw32-gcc

npm run build:desktop
test -f desktop_assets/index.html || {
  echo "The embedded frontend build did not produce desktop_assets/index.html" >&2
  exit 1
}

# 32-bit Intel Windows is GOARCH=386. Wails' NSIS template only supports
# amd64/arm64, so this target is intentionally a portable EXE.
wails build -s -clean -m -nosyncgomod -skipembedcreate -trimpath \
  -platform windows/386 -nopackage -o EcomVisualStudio-x86.exe -webview2 browser

test -f "$ARTIFACT_DIR/EcomVisualStudio-x86.exe" || {
  echo "The Windows x86 application was not created in $ARTIFACT_DIR" >&2
  exit 1
}

echo "Windows x86 artifact: $ARTIFACT_DIR/EcomVisualStudio-x86.exe"
