import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { client } from "../api";
import { useAppStore } from "../store";
import type { LatestCreation } from "../types";
import { fileUrl } from "../utils/assets";
import { ProjectCard } from "./ProjectCard";
import { Shell } from "./Shell";
import "./Home.css";

export function Home() {
  const projects = useAppStore((state) => state.projects);
  const navigate = useNavigate();
  const [latestCreation, setLatestCreation] = useState<LatestCreation | null>(
    null,
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
    ["商品主图", "干净陈列，立即适配商城"],
    ["品牌海报", "围绕活动主题建立视觉"],
    ["社媒种草", "真实内容感与传播构图"],
    ["详情信息图", "卖点、结构与使用说明"],
  ];
  return (
    <Shell>
      <div className="topbar">
        <strong>创作台</strong>
      </div>
      <div className="page">
        <section className="studio-hero">
          <div>
            <span className="eyebrow">AI PRODUCT IMAGE STUDIO</span>
            <h1>
              把商品，做成
              <br />
              能被记住的画面。
            </h1>
            <p className="hero-copy">
              上传一张参考图，选择创作目标。主图、广告、内容图和完整商品视觉包会在同一处完成。
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
            {shortcuts.map(([title, detail], index) => (
              <button
                className="shortcut-card"
                onClick={() => navigate("/new")}
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
              <h3>还没有生成作品</h3>
              <p>创建第一个商品视觉项目，结果会在这里沉淀。</p>
              <button
                className="create-button"
                onClick={() => navigate("/new")}
              >
                创建第一个作品
              </button>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
