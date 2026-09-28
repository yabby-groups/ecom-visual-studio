import { describe, expect, it } from "vitest";
import { failureReason, userFacingError } from "./assets";

describe("failureReason", () => {
  it("turns stored unauthorized failures into an actionable authorization message", () => {
    expect(failureReason("failed: Unauthorized")).toBe("Huabot 授权已失效，请重新授权");
  });

  it("turns direct unauthorized errors into the same message", () => {
    expect(userFacingError("Unauthorized", "创建视频任务失败")).toBe("Huabot 授权已失效，请重新授权");
  });
});
