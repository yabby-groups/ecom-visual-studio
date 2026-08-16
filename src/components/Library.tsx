import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import { Notice } from "./Notice";
import { ProjectCard } from "./ProjectCard";
import { Shell } from "./Shell";
import { useAppStore } from "../store";
import "./Library.css";

export function Library() {
  const projects = useAppStore((state) => state.projects);
  const refresh = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const [filter, setFilter] = useState("全部作品");
  const [notice, setNotice] = useState("");
  async function remove(id: string) {
    if (!window.confirm("确定删除这个项目及其生成图片吗？")) return;
    await client.deleteProject(id);
    await refresh();
    setNotice("项目已删除");
  }
  const filters = ["全部作品", "商品主图", "社媒内容", "详情信息图"];
  return (
    <Shell>
      <div className="topbar">
        <strong>作品库</strong>
      </div>
      <div className="page library-page">
        <div className="library-heading">
          <span className="eyebrow">YOUR OUTPUT</span>
          <h1>作品库</h1>
          <p>每一次生成都保留画面、参考图、Prompt 和所属创作。</p>
        </div>
        <div className="filter-row">
          {filters.map((item) => (
            <button
              className={`filter ${filter === item ? "active" : ""}`}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        {projects.length ? (
          <div className="art-grid library-art-grid">
            {projects.map((project) => (
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
            <b>作品库正在等待第一张图</b>
            <p>创建一个商品视觉，生成结果会自动保留在这里。</p>
            <button className="create-button" onClick={() => navigate("/new")}>
              开始创作
            </button>
          </div>
        )}
        {notice && <Notice text={notice} onClose={() => setNotice("")} />}
      </div>
    </Shell>
  );
}
