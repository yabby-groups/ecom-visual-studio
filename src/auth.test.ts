import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./auth";

describe("safeReturnTo", () => {
  it("keeps internal application routes", () => {
    expect(safeReturnTo("/projects/local-1?tab=assets")).toBe(
      "/projects/local-1?tab=assets",
    );
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(safeReturnTo("https://example.com")).toBe("/");
    expect(safeReturnTo("//example.com")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });
});
