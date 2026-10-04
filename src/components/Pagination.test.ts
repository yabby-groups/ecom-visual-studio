import { describe, expect, it } from "vitest";
import { paginationPages } from "./Pagination";

describe("paginationPages", () => {
  it("keeps a compact window around the current page", () => {
    expect(paginationPages(6, 12)).toEqual([
      1,
      "ellipsis",
      5,
      6,
      7,
      "ellipsis",
      12,
    ]);
  });

  it("shows every page for short result sets", () => {
    expect(paginationPages(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
