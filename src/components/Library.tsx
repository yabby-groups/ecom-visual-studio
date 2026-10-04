import { useEffect } from "react";
import { useAiInteraction } from "../aiInteraction";
import { useAppStore } from "../store";
import { Shell } from "./Shell";
import { WorksLibraryView } from "./WorksLibraryView";
import "./Library.css";

export function Library() {
  const projects = useAppStore((state) => state.projects);
  const { registerPage } = useAiInteraction();

  useEffect(
    () =>
      registerPage({
        screen: "作品库",
        data: () => ({
          projects: projects.map((project) => ({
            id: project.id,
            name: project.name,
            product: project.product,
            asset_count: project.asset_count,
          })),
        }),
      }),
    [projects, registerPage],
  );

  return (
    <Shell>
      <div className="topbar">
        <strong>作品库</strong>
      </div>
      <div className="page library-page">
        <div className="library-heading">
          <span className="eyebrow">本地作品</span>
          <h1>作品库</h1>
          <p>按创作类型查看作品，并继续编辑对应工作台。</p>
        </div>
        <WorksLibraryView />
      </div>
    </Shell>
  );
}
