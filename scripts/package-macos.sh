#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACT_DIR="$ROOT/build/bin"
ENTITLEMENTS="$ROOT/build/darwin/entitlements.plist"
APP="$ARTIFACT_DIR/Ecom Visual Studio.app"
ARCH=${1:-arm64}

case "$ARCH" in
  arm64) TARGET_ARCH=arm64 ;;
  x86_64) TARGET_ARCH=amd64 ;;
  *)
    echo "Usage: $0 [arm64|x86_64]" >&2
    exit 2
    ;;
esac

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

wails build -s -m -nosyncgomod -skipembedcreate -trimpath -platform "darwin/$TARGET_ARCH"
test -d "$APP" || {
  echo "macOS application bundle was not created at $ARTIFACT_DIR/Ecom Visual Studio.app" >&2
  exit 1
}
test -f "$APP/Contents/MacOS/EcomVisualStudio" || {
  echo "macOS executable is missing from $APP" >&2
  exit 1
}
BUILT_ARCH=$(lipo -archs "$APP/Contents/MacOS/EcomVisualStudio")
test "$BUILT_ARCH" = "$ARCH" || {
  echo "Expected $ARCH executable, got $BUILT_ARCH" >&2
  exit 1
}
test -f "$ENTITLEMENTS" || {
  echo "macOS entitlements file is missing: $ENTITLEMENTS" >&2
  exit 1
}
codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "macOS $ARCH artifact: $APP"
