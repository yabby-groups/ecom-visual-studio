const defaultVideoPreviewRatio = "16 / 9";

export function videoPreviewRatio(width: number, height: number): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return defaultVideoPreviewRatio;
  }

  return `${width} / ${height}`;
}

export { defaultVideoPreviewRatio };
