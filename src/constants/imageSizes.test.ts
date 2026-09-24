import { describe, expect, it } from "vitest";
import {
  customImageSize,
  imageRatioLabel,
  imageSizeError,
  nativeImageRatios,
} from "./imageSizes";

describe("image sizes", () => {
  it("offers aligned presets within the supported size range", () => {
    expect(nativeImageRatios).toHaveLength(12);
    for (const { ratio, size } of nativeImageRatios) {
      const [width, height] = size.split("×").map(Number);
      expect(imageSizeError(width, height), ratio).toBe("");
      const [a, b] = ratio.split(":").map(Number);
      expect(width * b, ratio).toBe(height * a);
    }
  });

  it("parses custom dimensions and reports their reduced ratio", () => {
    expect(customImageSize("1280x1024")).toEqual([1280, 1024]);
    expect(imageRatioLabel("1280x1024")).toBe("5:4");
    expect(customImageSize("5:4")).toBeNull();
  });

  it("rejects misaligned, out-of-range, and oversized dimensions", () => {
    expect(imageSizeError(3840, 2160)).toBe("");
    for (const [width, height] of [
      [0, 1024],
      [1025, 1024],
      [4000, 1024],
      [1024, 320],
      [1024, 512],
      [3840, 3840],
    ]) {
      expect(imageSizeError(width, height)).not.toBe("");
    }
  });
});
