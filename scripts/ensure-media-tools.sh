#!/bin/sh
set -eu

TARGET=${1:?target is required}
OUTPUT_DIR=${2:-}
CACHE_ROOT=${FFMPEG_CACHE_DIR:-/tmp/ecom-visual-studio-media-tools}

case "$TARGET" in
  macos-arm64)
    URL=${FFMPEG_MACOS_ARM64_URL:-https://www.osxexperts.net/ffmpeg80arm.zip}
    PROBE_URL=${FFPROBE_MACOS_ARM64_URL:-https://www.osxexperts.net/ffprobe80arm.zip}
    TARGET_ARCH=arm64
    TOOL_EXT=""
    ;;
  macos-x86_64)
    URL=${FFMPEG_MACOS_X86_64_URL:-https://evermeet.cx/ffmpeg/getrelease/zip}
    PROBE_URL=${FFPROBE_MACOS_X86_64_URL:-https://evermeet.cx/ffprobe/getrelease/zip}
    TARGET_ARCH=x86_64
    TOOL_EXT=""
    ;;
  windows-amd64)
    URL=${FFMPEG_WINDOWS_AMD64_URL:-https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip}
    PROBE_URL=""
    TARGET_ARCH=""
    TOOL_EXT=".exe"
    ;;
  windows-x86)
    URL=${FFMPEG_WINDOWS_X86_URL:-https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win32-gpl.zip}
    PROBE_URL=""
    TARGET_ARCH=""
    TOOL_EXT=".exe"
    ;;
  *) echo "Unsupported FFmpeg target: $TARGET" >&2; exit 2 ;;
esac

has_tools() {
	if [ -n "$TOOL_EXT" ]; then
		[ -f "$1/ffmpeg$TOOL_EXT" ] && [ -f "$1/ffprobe$TOOL_EXT" ]
	else
		[ -x "$1/ffmpeg$TOOL_EXT" ] && [ -x "$1/ffprobe$TOOL_EXT" ] \
			&& [ "$(lipo -archs "$1/ffmpeg$TOOL_EXT" 2>/dev/null)" = "$TARGET_ARCH" ] \
			&& [ "$(lipo -archs "$1/ffprobe$TOOL_EXT" 2>/dev/null)" = "$TARGET_ARCH" ]
	fi
}

find_tool() {
  ROOT=$1
  NAME=$2
  MATCH=$(find "$ROOT" \( -type f -o -type l \) -name "$NAME*" | head -1)
  if [ -n "$MATCH" ]; then
    printf '%s\n' "$MATCH"
    return 0
  fi
  if [ -z "$TOOL_EXT" ] && command -v file >/dev/null 2>&1; then
    find "$ROOT" \( -type f -o -type l \) -print | while IFS= read -r CANDIDATE; do
      file "$CANDIDATE" | grep -q 'Mach-O' && {
        printf '%s\n' "$CANDIDATE"
        break
      }
    done
  fi
}

if [ -n "$OUTPUT_DIR" ] && has_tools "$OUTPUT_DIR"; then
  printf '%s\n' "$OUTPUT_DIR"
  exit 0
fi

DEST="$CACHE_ROOT/$TARGET"
if has_tools "$DEST"; then
  printf '%s\n' "$DEST"
  exit 0
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required to download FFmpeg." >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "unzip is required to unpack FFmpeg." >&2; exit 1; }
WORK="$CACHE_ROOT/.download-$TARGET-$$"
ARCHIVE="$WORK/archive.zip"
rm -rf "$WORK"
mkdir -p "$WORK" "$DEST"
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
echo "Downloading FFmpeg tools for $TARGET from $URL" >&2
curl -L --fail --retry 3 --connect-timeout 20 --output "$ARCHIVE" "$URL"
unzip -q "$ARCHIVE" -d "$WORK/unpacked"
FFMPEG=$(find_tool "$WORK/unpacked" "ffmpeg$TOOL_EXT")
if [ -n "$PROBE_URL" ]; then
  PROBE_ARCHIVE="$WORK/ffprobe.zip"
  echo "Downloading FFprobe tools for $TARGET from $PROBE_URL" >&2
  curl -L --fail --retry 3 --connect-timeout 20 --output "$PROBE_ARCHIVE" "$PROBE_URL"
  unzip -q "$PROBE_ARCHIVE" -d "$WORK/unpacked-ffprobe"
  FFPROBE=$(find_tool "$WORK/unpacked-ffprobe" "ffprobe$TOOL_EXT")
else
  FFPROBE=$(find_tool "$WORK/unpacked" "ffprobe$TOOL_EXT")
fi
if [ -z "$FFMPEG" ] || [ -z "$FFPROBE" ]; then
  echo "Downloaded archive(s) do not contain ffmpeg$TOOL_EXT and ffprobe$TOOL_EXT." >&2
  echo "FFmpeg archive members:" >&2
  unzip -Z1 "$ARCHIVE" >&2 || true
  if [ -n "$PROBE_URL" ]; then
    echo "FFprobe archive members:" >&2
    unzip -Z1 "$PROBE_ARCHIVE" >&2 || true
  fi
  exit 1
fi
cp "$FFMPEG" "$DEST/ffmpeg$TOOL_EXT"
cp "$FFPROBE" "$DEST/ffprobe$TOOL_EXT"
chmod 755 "$DEST/ffmpeg$TOOL_EXT" "$DEST/ffprobe$TOOL_EXT"
printf '%s\n' "$DEST"
