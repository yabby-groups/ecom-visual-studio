#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACT_DIR="$ROOT/build/bin"
ENTITLEMENTS="$ROOT/build/darwin/entitlements.plist"
APP="$ARTIFACT_DIR/Ecom Visual Studio.app"
ARCH=${1:-arm64}

case "$ARCH" in
  arm64) TARGET_ARCH=arm64; MEDIA_DIR=${FFMPEG_MACOS_ARM64_DIR:-${FFMPEG_BIN_DIR:-}} ;;
  x86_64) TARGET_ARCH=amd64; MEDIA_DIR=${FFMPEG_MACOS_X86_64_DIR:-${FFMPEG_BIN_DIR:-}} ;;
  *)
    echo "Usage: $0 [arm64|x86_64]" >&2
    exit 2
    ;;
esac

MEDIA_DIR=${MEDIA_DIR:-$("$ROOT/scripts/ensure-media-tools.sh" "macos-$ARCH")}
for TOOL in ffmpeg ffprobe; do
  TOOL_PATH="$MEDIA_DIR/$TOOL"
  test -x "$TOOL_PATH" || {
    echo "Missing executable: $TOOL_PATH" >&2
    exit 1
  }
  test "$(lipo -archs "$TOOL_PATH")" = "$ARCH" || {
    echo "$TOOL_PATH must be a $ARCH macOS binary." >&2
    exit 1
  }
  if otool -L "$TOOL_PATH" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/System/Library/|/usr/lib/)' >/dev/null; then
    echo "$TOOL_PATH depends on libraries outside macOS; provide a standalone build." >&2
    exit 1
  fi
done

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
MEDIA_TARGET="$APP/Contents/Resources/media-tools"
mkdir -p "$MEDIA_TARGET"
for TOOL in ffmpeg ffprobe; do
  cp "$MEDIA_DIR/$TOOL" "$MEDIA_TARGET/$TOOL"
  chmod 755 "$MEDIA_TARGET/$TOOL"
  codesign --force --sign - "$MEDIA_TARGET/$TOOL"
done
codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "macOS $ARCH artifact: $APP"
