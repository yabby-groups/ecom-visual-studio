import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { filterProjects } from "./projectFilters";

const projects = [
  { id: "hero", template_ids: ["hero-image", "infographic"] },
  { id: "social", template_ids: ["social-media", "ugc-style"] },
  { id: "empty", template_ids: [] },
] as Project[];

describe("filterProjects", () => {
  it("matches projects by their frame templates and allows multiple categories", () => {
    expect(filterProjects(projects, "商品主图").map((item) => item.id)).toEqual(
      ["hero"],
    );
    expect(
      filterProjects(projects, "详情信息图").map((item) => item.id),
    ).toEqual(["hero"]);
    expect(filterProjects(projects, "社媒内容").map((item) => item.id)).toEqual(
      ["social"],
    );
    expect(filterProjects(projects, "全部作品")).toEqual(projects);
  });
});
