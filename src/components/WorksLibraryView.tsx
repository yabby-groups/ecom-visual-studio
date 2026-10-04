import { Shirt, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import { useAppStore } from "../store";
import type { Project, TryOnJob, VideoReplicaJob } from "../types";
import { statusText, userFacingError } from "../utils/assets";
import {
  libraryTabs,
  type LibraryTabID,
  videoReplicaPath,
} from "../utils/libraryWorks";
import { ConfirmDialog } from "./ConfirmDialog";
import { Notice } from "./Notice";
import { ProjectCard } from "./ProjectCard";
import { Pagination } from "./Pagination";
import { VideoWorksList } from "./VideoWorksList";
import {
  LibraryPreview,
  LibraryWorkCard,
  WorkActions,
  WorkRenameDialog,
  type LibraryRename,
} from "./WorksLibrary";
import "./Library.css";

const WORKS_PAGE_SIZE = 20;

const tabCopy: Record<LibraryTabID, { title: string; empty: string }> = {
  images: { title: "图片作品", empty: "还没有图片作品" },
  "try-on": { title: "换装作品", empty: "还没有换装作品" },
  "video-replica": { title: "普通复刻视频", empty: "还没有普通复刻视频" },
  "ai-video-replica": { title: "AI 复刻视频", empty: "还没有 AI 复刻视频" },
};

type LibraryDeletion = {
  kind: "project" | "try-on" | "video";
  id: string;
  title: string;
  message: string;
};

export function WorksLibraryView({ limit }: { limit?: number }) {
  const refresh = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const [tab, setTab] = useState<LibraryTabID>("images");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{
    text: string;
    tone: "success" | "error";
  } | null>(null);
  const [videoJobs, setVideoJobs] = useState<VideoReplicaJob[]>([]);
  const [tryOnJobs, setTryOnJobs] = useState<TryOnJob[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [worksError, setWorksError] = useState("");
  const [preview, setPreview] = useState<LibraryPreview | null>(null);
  const [deletingID, setDeletingID] = useState("");
  const [pendingDeletion, setPendingDeletion] =
    useState<LibraryDeletion | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [renaming, setRenaming] = useState<LibraryRename | null>(null);
  const activeTab = libraryTabs.find((item) => item.id === tab)!;

  async function loadWorks(requestedPage = page, requestedTab = tab) {
    try {
      const offset = (requestedPage - 1) * WORKS_PAGE_SIZE;
      const result =
        requestedTab === "images"
          ? await client.projectsPage(WORKS_PAGE_SIZE, offset)
          : requestedTab === "try-on"
            ? await client.tryOnJobs(WORKS_PAGE_SIZE, offset)
            : await client.videoReplicaJobs(
                WORKS_PAGE_SIZE,
                offset,
                requestedTab === "ai-video-replica" ? "ai_replica" : "reference",
              );
      if (requestedPage > 1 && result.items.length === 0) {
        setPage(Math.max(1, Math.ceil(result.total / WORKS_PAGE_SIZE)));
        return;
      }
      setTotal(result.total);
      if (requestedTab === "images") setProjects(result.items as Project[]);
      else if (requestedTab === "try-on") setTryOnJobs(result.items as TryOnJob[]);
      else setVideoJobs(result.items as VideoReplicaJob[]);
      if (requestedTab !== "video-replica" && requestedTab !== "ai-video-replica")
        return;
      const videos = result as import("../types").VideoReplicaPage;
      const results = await Promise.all(
        videos.items
          .filter(
            (job) =>
              job.status === "ready" && job.file_path && !job.preview_path,
          )
          .map(async (job) => {
            try {
              const result = await client.prepareVideoReplicaPreview(job.id);
              return [job.id, result.preview_path] as const;
            } catch {
              return null;
            }
          }),
      );
      const previews = new Map(
        results.filter(
          (result): result is readonly [string, string | null] =>
            result !== null && Boolean(result[1]),
        ),
      );
      if (previews.size > 0) {
        setVideoJobs((current) =>
          current.map((job) => ({
            ...job,
            preview_path: previews.get(job.id) ?? job.preview_path,
          })),
        );
      }
    } catch (reason) {
      setWorksError(
        userFacingError(
          reason instanceof Error ? reason.message : "",
          "无法加载作品",
        ),
      );
    }
  }

  useEffect(() => {
    void loadWorks();
  }, [page, tab]);

  useEffect(() => {
    setPreview(null);
  }, [tab]);

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  function requestDelete(deletion: LibraryDeletion) {
    setDeleteError("");
    setPendingDeletion(deletion);
  }

  function workTitle(job: VideoReplicaJob) {
    return job.title || job.model;
  }

  function tryOnTitle(job: TryOnJob) {
    return job.title || `换装任务 · ${job.ratio}`;
  }

  async function confirmDelete() {
    if (!pendingDeletion) return;
    const { id, kind } = pendingDeletion;
    setDeletingID(id);
    try {
      if (kind === "project") {
        await client.deleteProject(id);
        await refresh();
        setNotice({ text: "项目已删除", tone: "success" });
      } else if (kind === "try-on") {
        await client.deleteTryOn(id);
        setNotice({ text: "换装作品已删除", tone: "success" });
      } else {
        await client.deleteVideoReplica(id);
        setNotice({ text: "视频作品已删除", tone: "success" });
      }
      await loadWorks();
      setPendingDeletion(null);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "删除作品失败");
    } finally {
      setDeletingID("");
    }
  }

  function emptyWorks() {
    return (
      <EmptyWorks tab={tab} onCreate={() => navigate(activeTab.createPath)} />
    );
  }

  function renderVideoWorks() {
    if (tab !== "video-replica" && tab !== "ai-video-replica") return null;
    return (
      <VideoWorksList
        jobs={videoJobs}
        tab={tab}
        limit={limit}
        empty={emptyWorks()}
        onSelect={(job) => navigate(videoReplicaPath(job))}
        renderActions={(job) => (
          <WorkActions
            title={workTitle(job)}
            deleting={deletingID === job.id}
            onRename={() =>
              setRenaming({ kind: "video", id: job.id, title: workTitle(job) })
            }
            onDelete={() =>
              requestDelete({
                kind: "video",
                id: job.id,
                title: workTitle(job),
                message:
                  "将删除这条视频记录及其所有生成文件。原始参考素材会保留，且此操作无法撤销。",
              })
            }
          />
        )}
      />
    );
  }

  function renderTryOnWorks() {
    const works = tryOnJobs.slice(0, limit);
    if (!works.length) return emptyWorks();
    return (
      <div className="art-grid library-art-grid">
        {works.map((job) => (
          <LibraryWorkCard
            key={job.id}
            type="换装作品"
            title={tryOnTitle(job)}
            detail={statusText(job.status)}
            imagePath={job.file_path}
            icon={<Shirt size={28} />}
            preview={{
              kind: "image",
              title: tryOnTitle(job),
              detail: statusText(job.status),
              path: job.file_path,
              editPath: `/try-on/${job.id}`,
            }}
            onPreview={setPreview}
          >
            <WorkActions
              title={tryOnTitle(job)}
              deleting={deletingID === job.id}
              onRename={() =>
                setRenaming({
                  kind: "try-on",
                  id: job.id,
                  title: tryOnTitle(job),
                })
              }
              onDelete={() =>
                requestDelete({
                  kind: "try-on",
                  id: job.id,
                  title: tryOnTitle(job),
                  message:
                    "将删除这条换装记录及其所有生成图片。人物和服装参考图会保留，且此操作无法撤销。",
                })
              }
            />
          </LibraryWorkCard>
        ))}
      </div>
    );
  }

  const visibleProjects = projects.slice(0, limit);

  return (
    <>
      <div className="library-tabs" role="tablist" aria-label="作品类型">
        {libraryTabs.map((item) => (
          <button
            className={`library-tab ${tab === item.id ? "active" : ""}`}
            aria-selected={tab === item.id}
            role="tab"
            type="button"
            onClick={() => {
              setTab(item.id);
              setPage(1);
            }}
            key={item.id}
          >
            {item.label}
          </button>
        ))}
      </div>
      <section
        className="library-works-section"
        aria-labelledby="works-heading"
      >
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
          visibleProjects.length ? (
            <div className="art-grid library-art-grid">
              {visibleProjects.map((project) => (
                <article className="library-item" key={project.id}>
                  <ProjectCard project={project} />
                  <WorkActions
                    title={project.name}
                    deleting={deletingID === project.id}
                    onRename={() =>
                      setRenaming({
                        kind: "project",
                        id: project.id,
                        title: project.name,
                      })
                    }
                    onDelete={() =>
                      requestDelete({
                        kind: "project",
                        id: project.id,
                        title: project.name,
                        message:
                          "将删除这个项目及其生成图片，且此操作无法撤销。",
                      })
                    }
                  />
                </article>
              ))}
            </div>
          ) : (
            emptyWorks()
          )
        ) : tab === "try-on" ? (
          renderTryOnWorks()
        ) : (
          renderVideoWorks()
        )}
        {!limit && <Pagination page={page} total={total} onChange={setPage} />}
      </section>
      {notice && (
        <Notice
          text={notice.text}
          tone={notice.tone}
          onClose={() => setNotice(null)}
        />
      )}
      {preview && (
        <LibraryPreview
          preview={preview}
          onClose={() => setPreview(null)}
          onEdit={() => {
            setPreview(null);
            navigate(preview.editPath);
          }}
        />
      )}
      {pendingDeletion && (
        <ConfirmDialog
          title={`删除${pendingDeletion.title}？`}
          message={pendingDeletion.message}
          confirmLabel="确认删除"
          error={deleteError}
          loading={deletingID === pendingDeletion.id}
          onCancel={() => setPendingDeletion(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {renaming && (
        <WorkRenameDialog
          work={renaming}
          onClose={() => setRenaming(null)}
          onSaved={async () => {
            await refresh();
            await loadWorks();
            setNotice({ text: "作品名称已保存", tone: "success" });
            setRenaming(null);
          }}
        />
      )}
    </>
  );
}

function EmptyWorks({
  tab,
  onCreate,
}: {
  tab: LibraryTabID;
  onCreate: () => void;
}) {
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
