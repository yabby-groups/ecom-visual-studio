import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { client } from "../api";
import { useAppStore } from "../store";
import { useAiInteraction } from "../aiInteraction";
import type { LatestCreation } from "../types";
import { fileUrl } from "../utils/assets";
import { ProjectCard } from "./ProjectCard";
import { Shell } from "./Shell";
import "./Home.css";

export function Home() {
  const projects = useAppStore((state) => state.projects);
  const navigate = useNavigate();
  const { registerPage } = useAiInteraction();
  const [latestCreation, setLatestCreation] = useState<LatestCreation | null>(
    null,
  );
  useEffect(
    () =>
      registerPage({
        screen: "创作台",
        data: () => ({
          projects: projects.map((project) => ({
            id: project.id,
            name: project.name,
            product: project.product,
          })),
          latest_creation: latestCreation
            ? {
                project_id: latestCreation.project_id,
                title: latestCreation.title,
              }
            : null,
        }),
      }),
    [latestCreation, projects, registerPage],
  );
  useEffect(() => {
    let active = true;
    void client
      .latestCreation()
      .then(({ creation }) => {
        if (active) setLatestCreation(creation);
      })
      .catch(() => {
        if (active) setLatestCreation(null);
      });
    return () => {
      active = false;
    };
  }, []);
  const shortcuts = [
    ["商品主图", "突出商品外观", "hero-image"],
    ["品牌海报", "展示活动主题", "poster-banner"],
    ["社媒内容", "适合社交平台分享", "social-media"],
    ["详情信息图", "说明卖点与规格", "infographic"],
  ];
  return (
    <Shell>
      <div className="topbar">
        <strong>创作台</strong>
      </div>
      <div className="page">
        <section className="studio-hero">
          <div>
            <span className="eyebrow">商品图片创作</span>
            <h1>
              创建商品图片，
              <br />
              从这里开始。
            </h1>
            <p className="hero-copy">
              添加商品参考图，选择画面模板，创建后可逐张编辑和生成。
            </p>
            <div className="hero-actions">
              <button
                className="create-button large"
                onClick={() => navigate("/new")}
              >
                开始创作
              </button>
              <Link className="text-link" to="/templates">
                浏览全部模板
              </Link>
            </div>
          </div>
          <div className="hero-visual">
            {latestCreation ? (
              <button
                className="hero-art"
                type="button"
                onClick={() =>
                  navigate(`/projects/${latestCreation.project_id}`)
                }
                aria-label={`继续编辑 ${latestCreation.title}`}
              >
                <img
                  src={fileUrl(latestCreation.file_path)}
                  alt={latestCreation.title}
                />
              </button>
            ) : (
              <div className="visual-empty">
                <span>商品视觉</span>
                <b>从一张参考图开始</b>
              </div>
            )}
          </div>
        </section>
        <section className="shortcut-section">
          <div className="section-heading section-header">
            <div>
              <span className="eyebrow">快速开始</span>
              <h2>你想做什么？</h2>
            </div>
            <Link className="text-link" to="/templates">
              全部场景
            </Link>
          </div>
          <div className="shortcut-grid">
            {shortcuts.map(([title, detail, templateId], index) => (
              <button
                className="shortcut-card"
                onClick={() => navigate(`/new?template=${templateId}`)}
                key={title}
              >
                <span className="shortcut-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>{title}</strong>
                <small>{detail}</small>
                <i>开始创作</i>
              </button>
            ))}
          </div>
        </section>
        <section className="gallery-section content-section">
          <div className="section-heading section-header">
            <div>
              <span className="eyebrow">最近作品</span>
              <h2>继续上次的创作</h2>
            </div>
            {projects.length > 0 && (
              <Link className="text-link" to="/library">
                查看作品库
              </Link>
            )}
          </div>
          {projects.length ? (
            <div className="project-grid">
              {projects.slice(0, 6).map((project) => (
                <ProjectCard project={project} key={project.id} />
              ))}
            </div>
          ) : (
            <div className="first-empty empty-state">
              <div>+</div>
              <h3>还没有项目</h3>
              <p>创建项目后，可在这里继续编辑和生成画面。</p>
              <button
                className="create-button"
                onClick={() => navigate("/new")}
              >
                创建项目
              </button>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
