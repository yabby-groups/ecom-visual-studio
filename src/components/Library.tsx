import { Film, Shirt, Trash2, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import { useAiInteraction } from "../aiInteraction";
import { useAppStore } from "../store";
import type { TryOnJob, VideoReplicaJob } from "../types";
import { fileUrl, userFacingError } from "../utils/assets";
import {
  filterVideoWorks,
  libraryTabs,
  type LibraryTabID,
  videoReplicaPath,
} from "../utils/libraryWorks";
import { Notice } from "./Notice";
import { ProjectCard } from "./ProjectCard";
import { Shell } from "./Shell";
import "./Library.css";

const VIDEO_WORKS_PAGE_SIZE = 48;
const TRY_ON_WORKS_PAGE_SIZE = 48;

const tabCopy: Record<LibraryTabID, { title: string; empty: string }> = {
  images: { title: "图片作品", empty: "还没有图片作品" },
  "try-on": { title: "换装作品", empty: "还没有换装作品" },
  "video-replica": { title: "普通复刻视频", empty: "还没有普通复刻视频" },
  "ai-video-replica": { title: "AI 复刻视频", empty: "还没有 AI 复刻视频" },
};

export function Library() {
  const projects = useAppStore((state) => state.projects);
  const refresh = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const { registerPage } = useAiInteraction();
  const [tab, setTab] = useState<LibraryTabID>("images");
  const [notice, setNotice] = useState<{
    text: string;
    tone: "success" | "error";
  } | null>(null);
  const [videoJobs, setVideoJobs] = useState<VideoReplicaJob[]>([]);
  const [tryOnJobs, setTryOnJobs] = useState<TryOnJob[]>([]);
  const [worksError, setWorksError] = useState("");
  const activeTab = libraryTabs.find((item) => item.id === tab)!;
  const visibleVideos = useMemo(
    () =>
      tab === "video-replica" || tab === "ai-video-replica"
        ? filterVideoWorks(videoJobs, tab)
        : [],
    [tab, videoJobs],
  );

  useEffect(() => {
    void Promise.all([
      client.videoReplicaJobs(VIDEO_WORKS_PAGE_SIZE, 0),
      client.tryOnJobs(TRY_ON_WORKS_PAGE_SIZE, 0),
    ])
      .then(([videos, tryOns]) => {
        setVideoJobs(videos.items);
        setTryOnJobs(tryOns.items);
      })
      .catch((reason) => {
        setWorksError(
          userFacingError(
            reason instanceof Error ? reason.message : "",
            "无法加载作品",
          ),
        );
      });
  }, []);

  useEffect(
    () =>
      registerPage({
        screen: "作品库",
        data: () => ({
          tab,
          projects: projects.map((project) => ({
            id: project.id,
            name: project.name,
            product: project.product,
            asset_count: project.asset_count,
          })),
        }),
      }),
    [projects, registerPage, tab],
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

  function renderVideoWorks() {
    if (!visibleVideos.length)
      return <EmptyWorks tab={tab} onCreate={() => navigate(activeTab.createPath)} />;
    return (
      <div className="library-video-grid">
        {visibleVideos.map((job) => (
          <article className="library-video-item" key={job.id}>
            <button
              type="button"
              className="library-video-preview"
              onClick={() => navigate(videoReplicaPath(job))}
              aria-label={`打开 ${tabCopy[tab].title}详情`}
            >
              {job.file_path ? (
                <video src={fileUrl(job.file_path)} preload="metadata" />
              ) : (
                <Film size={28} />
              )}
            </button>
            <div className="library-video-copy">
              <strong>{job.model}</strong>
              <span>
                {job.status.startsWith("failed")
                  ? "生成失败"
                  : job.status === "ready"
                    ? "已完成"
                    : "处理中"}{" "}
                · {job.duration} 秒
              </span>
              <time>{new Date(job.created_at * 1000).toLocaleString()}</time>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderTryOnWorks() {
    if (!tryOnJobs.length)
      return <EmptyWorks tab={tab} onCreate={() => navigate(activeTab.createPath)} />;
    return (
      <div className="library-video-grid">
        {tryOnJobs.map((job) => (
          <article className="library-video-item" key={job.id}>
            <button
              type="button"
              className="library-video-preview"
              onClick={() => navigate(`/try-on/${job.id}`)}
              aria-label="打开换装详情"
            >
              {job.file_path ? (
                <img src={fileUrl(job.file_path)} alt="已生成的换装图片" />
              ) : (
                <Shirt size={28} />
              )}
            </button>
            <div className="library-video-copy">
              <strong>换装任务 · {job.ratio}</strong>
              <span>
                {job.status.startsWith("failed")
                  ? "生成失败"
                  : job.status === "ready"
                    ? "已完成"
                    : "处理中"}
              </span>
              <time>{new Date(job.created_at * 1000).toLocaleString()}</time>
            </div>
          </article>
        ))}
      </div>
    );
  }

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
        <div className="library-tabs" role="tablist" aria-label="作品类型">
          {libraryTabs.map((item) => (
            <button
              className={`library-tab ${tab === item.id ? "active" : ""}`}
              aria-selected={tab === item.id}
              role="tab"
              type="button"
              onClick={() => setTab(item.id)}
              key={item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
        <section className="library-works-section" aria-labelledby="works-heading">
          <div className="library-section-heading">
            <div>
              <span className="eyebrow">{activeTab.label}</span>
              <h2 id="works-heading">{tabCopy[tab].title}</h2>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={() => navigate(activeTab.createPath)}
            >
              新建{activeTab.label}
            </button>
          </div>
          {worksError && tab !== "images" && (
            <p className="notice notice-error" role="alert">
              {worksError}
            </p>
          )}
          {tab === "images" ? (
            projects.length ? (
              <div className="art-grid library-art-grid">
                {projects.map((project) => (
                  <article className="library-item" key={project.id}>
                    <ProjectCard project={project} />
                    <button
                      className="icon-button destructive"
                      type="button"
                      onClick={() => void remove(project.id)}
                      aria-label={`删除 ${project.name}`}
                    >
                      <Trash2 size={17} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyWorks tab={tab} onCreate={() => navigate(activeTab.createPath)} />
            )
          ) : tab === "try-on" ? (
            renderTryOnWorks()
          ) : (
            renderVideoWorks()
          )}
        </section>
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

function EmptyWorks({ tab, onCreate }: { tab: LibraryTabID; onCreate: () => void }) {
  return (
    <div className="library-video-empty">
      <Video size={20} />
      <span>{tabCopy[tab].empty}</span>
      <button className="text-button" type="button" onClick={onCreate}>
        开始创作
      </button>
    </div>
  );
}
