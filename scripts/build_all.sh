#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

if [[ $(uname -s) != Darwin ]]; then
  echo "Build all must run on macOS." >&2
  exit 1
fi
for TOOL in node wails ditto; do
  if ! command -v "$TOOL" >/dev/null 2>&1; then
    echo "Build all requires $TOOL in PATH." >&2
    exit 1
  fi
done

VERSION=$(node -p "require('./wails.json').info?.productVersion ?? ''")
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "wails.json info.productVersion must be a three-part version" >&2
  exit 1
fi

BIN="$ROOT/build/bin"
DIST="$ROOT/bin-dist"
APP="$BIN/Ecom Visual Studio.app"
mkdir -p "$DIST"

if [[ ${1:-} == --windows ]]; then
  if ! command -v makensis >/dev/null 2>&1; then
    echo "Windows packaging requires makensis from devenv." >&2
    exit 1
  fi

  "$ROOT/scripts/package-windows.sh"
  WIN_X64="$DIST/EcomVisualStudio-windows-x64-v$VERSION.exe"
  WIN_X64_INSTALLER="$DIST/EcomVisualStudio-windows-x64-v$VERSION-installer.exe"
  cp "$BIN/EcomVisualStudio.exe" "$WIN_X64"
  cp "$BIN/Ecom Visual Studio-amd64-installer.exe" "$WIN_X64_INSTALLER"
  ditto -c -k --keepParent "$WIN_X64" "$WIN_X64.zip"
  echo "Packaged: $WIN_X64, $WIN_X64_INSTALLER, $WIN_X64.zip"

  "$ROOT/scripts/package-windows-x86.sh"
  WIN_X86="$DIST/EcomVisualStudio-windows-x86-v$VERSION.exe"
  cp "$BIN/EcomVisualStudio-x86.exe" "$WIN_X86"
  ditto -c -k --keepParent "$WIN_X86" "$WIN_X86.zip"
  echo "Packaged: $WIN_X86, $WIN_X86.zip"
  exit 0
fi

if ! command -v devenv >/dev/null 2>&1; then
  echo "Windows packaging requires devenv in PATH." >&2
  exit 1
fi

for ARCH in arm64 x86_64; do
  "$ROOT/scripts/package-macos.sh" "$ARCH"
  ARCHIVE="$DIST/Ecom Visual Studio-macos-$ARCH-v$VERSION.zip"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE"
  echo "Packaged: $ARCHIVE"
done

devenv --no-tui shell -- bash "$ROOT/scripts/build_all.sh" --windows
