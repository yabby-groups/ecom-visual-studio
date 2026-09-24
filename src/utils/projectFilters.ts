import type { Project } from "../types";

export const projectFilters = [
  { label: "全部作品", templates: [] },
  { label: "商品主图", templates: ["hero-image"] },
  {
    label: "社媒内容",
    templates: ["social-media", "ugc-style", "poster-banner"],
  },
  { label: "详情信息图", templates: ["infographic", "size-spec"] },
] as const;

export function filterProjects(projects: Project[], filter: string): Project[] {
  const templateIDs = projectFilters.find(
    (item) => item.label === filter,
  )?.templates;
  if (!templateIDs?.length) return projects;
  return projects.filter((project) =>
    project.template_ids?.some((id) =>
      (templateIDs as readonly string[]).includes(id),
    ),
  );
}
