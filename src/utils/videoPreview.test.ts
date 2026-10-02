import { describe, expect, it } from "vitest";
import { defaultVideoPreviewRatio, videoPreviewRatio } from "./videoPreview";

describe("videoPreviewRatio", () => {
  it.each([
    [1920, 1080, "1920 / 1080"],
    [1080, 1920, "1080 / 1920"],
    [1080, 1080, "1080 / 1080"],
  ])("returns the intrinsic ratio for %ix%i video", (width, height, expected) => {
    expect(videoPreviewRatio(width, height)).toBe(expected);
  });

  it.each([
    [0, 1080],
    [1920, 0],
    [Number.NaN, 1080],
    [1920, Number.POSITIVE_INFINITY],
  ])("falls back for unavailable metadata", (width, height) => {
    expect(videoPreviewRatio(width, height)).toBe(defaultVideoPreviewRatio);
  });
});
