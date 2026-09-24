import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import { Notice } from "./Notice";
import { ProjectCard } from "./ProjectCard";
import { Shell } from "./Shell";
import { useAppStore } from "../store";
import { useAiInteraction } from "../aiInteraction";
import { filterProjects, projectFilters } from "../utils/projectFilters";
import "./Library.css";

export function Library() {
  const projects = useAppStore((state) => state.projects);
  const refresh = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const { registerPage } = useAiInteraction();
  const [filter, setFilter] = useState("全部作品");
  const [notice, setNotice] = useState<{
    text: string;
    tone: "success" | "error";
  } | null>(null);
  const visibleProjects = filterProjects(projects, filter);
  useEffect(
    () =>
      registerPage({
        screen: "作品库",
        data: () => ({
          filter,
          projects: projects.map((project) => ({
            id: project.id,
            name: project.name,
            product: project.product,
            asset_count: project.asset_count,
          })),
        }),
      }),
    [filter, projects, registerPage],
  );
  async function remove(id: string) {
    if (!window.confirm("确定删除这个项目及其生成图片吗？")) return;
    try {
      await client.deleteProject(id);
      await refresh();
      setNotice({ text: "项目已删除", tone: "success" });
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "删除项目失败",
        tone: "error",
      });
    }
  }
  return (
    <Shell>
      <div className="topbar">
        <strong>作品库</strong>
      </div>
      <div className="page library-page">
        <div className="library-heading">
          <span className="eyebrow">本地项目</span>
          <h1>作品库</h1>
          <p>查看和管理已创建的项目与画面。</p>
        </div>
        <div className="filter-row">
          {projectFilters.map((item) => (
            <button
              className={`filter ${filter === item.label ? "active" : ""}`}
              aria-pressed={filter === item.label}
              onClick={() => setFilter(item.label)}
              key={item.label}
            >
              {item.label}
            </button>
          ))}
        </div>
        {visibleProjects.length ? (
          <div className="art-grid library-art-grid">
            {visibleProjects.map((project) => (
              <article className="library-item" key={project.id}>
                <ProjectCard project={project} />
                <button
                  className="icon-button destructive"
                  onClick={() => void remove(project.id)}
                  aria-label={`删除 ${project.name}`}
                >
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="first-empty library-empty">
            <div>+</div>
            <b>{projects.length ? `没有${filter}项目` : "还没有项目"}</b>
            <p>
              {projects.length
                ? "试试其他分类，或查看全部作品。"
                : "创建项目后，可在这里管理画面。"}
            </p>
            <button
              className="create-button"
              onClick={() =>
                projects.length ? setFilter("全部作品") : navigate("/new")
              }
            >
              {projects.length ? "查看全部作品" : "开始创作"}
            </button>
          </div>
        )}
        {notice && (
          <Notice
            text={notice.text}
            tone={notice.tone}
            onClose={() => setNotice(null)}
          />
        )}
      </div>
    </Shell>
  );
}
