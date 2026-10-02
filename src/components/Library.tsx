import {
  Film,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Shirt,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import { useAiInteraction } from "../aiInteraction";
import { useAppStore } from "../store";
import type { TryOnJob, VideoReplicaJob } from "../types";
import { fileUrl, statusText, userFacingError } from "../utils/assets";
import {
  filterVideoWorks,
  libraryTabs,
  type LibraryTabID,
  videoReplicaPath,
} from "../utils/libraryWorks";
import {
  defaultVideoPreviewRatio,
  videoPreviewRatio,
} from "../utils/videoPreview";
import { Notice } from "./Notice";
import { ConfirmDialog } from "./ConfirmDialog";
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

type LibraryPreview = {
  kind: "image" | "video";
  title: string;
  detail: string;
  path: string | null;
  editPath: string;
};

type LibraryDeletion = {
  kind: "project" | "try-on" | "video";
  id: string;
  title: string;
  message: string;
};

type LibraryRename = {
  kind: "project" | "try-on" | "video";
  id: string;
  title: string;
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
  const [preview, setPreview] = useState<LibraryPreview | null>(null);
  const [deletingID, setDeletingID] = useState("");
  const [pendingDeletion, setPendingDeletion] =
    useState<LibraryDeletion | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [renaming, setRenaming] = useState<LibraryRename | null>(null);
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
        void Promise.all(
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
        ).then((results) => {
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
        });
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
        setTryOnJobs((jobs) => jobs.filter((job) => job.id !== id));
        setNotice({ text: "换装作品已删除", tone: "success" });
      } else {
        await client.deleteVideoReplica(id);
        setVideoJobs((jobs) => jobs.filter((job) => job.id !== id));
        setNotice({ text: "视频作品已删除", tone: "success" });
      }
      setPendingDeletion(null);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "删除作品失败");
    } finally {
      setDeletingID("");
    }
  }

  function renderVideoWorks() {
    if (!visibleVideos.length)
      return (
        <EmptyWorks tab={tab} onCreate={() => navigate(activeTab.createPath)} />
      );
    return (
      <div className="art-grid library-art-grid">
        {visibleVideos.map((job) => (
          <LibraryWorkCard
            key={job.id}
            type={tabCopy[tab].title}
            title={workTitle(job)}
            detail={`${statusText(job.status)} · ${job.duration} 秒`}
            imagePath={job.status === "ready" ? job.preview_path : null}
            icon={<Film size={28} />}
            preview={
              job.status === "ready" && job.file_path
                ? {
                    kind: "video",
                    title: workTitle(job),
                    detail: `${tabCopy[tab].title} · ${job.duration} 秒`,
                    path: job.file_path,
                    editPath: videoReplicaPath(job),
                  }
                : {
                    kind: "video",
                    title: workTitle(job),
                    detail: `${tabCopy[tab].title} · ${statusText(job.status)}`,
                    path: null,
                    editPath: videoReplicaPath(job),
                  }
            }
            onPreview={setPreview}
          >
            <WorkActions
              title={workTitle(job)}
              deleting={deletingID === job.id}
              onRename={() =>
                setRenaming({
                  kind: "video",
                  id: job.id,
                  title: workTitle(job),
                })
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
          </LibraryWorkCard>
        ))}
      </div>
    );
  }

  function renderTryOnWorks() {
    if (!tryOnJobs.length)
      return (
        <EmptyWorks tab={tab} onCreate={() => navigate(activeTab.createPath)} />
      );
    return (
      <div className="art-grid library-art-grid">
        {tryOnJobs.map((job) => (
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
            projects.length ? (
              <div className="art-grid library-art-grid">
                {projects.map((project) => (
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
              <EmptyWorks
                tab={tab}
                onCreate={() => navigate(activeTab.createPath)}
              />
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
              const [videos, tryOns] = await Promise.all([
                client.videoReplicaJobs(VIDEO_WORKS_PAGE_SIZE, 0),
                client.tryOnJobs(TRY_ON_WORKS_PAGE_SIZE, 0),
              ]);
              setVideoJobs(videos.items);
              setTryOnJobs(tryOns.items);
              setNotice({ text: "作品名称已保存", tone: "success" });
              setRenaming(null);
            }}
          />
        )}
      </div>
    </Shell>
  );
}

function LibraryWorkCard({
  type,
  title,
  detail,
  imagePath,
  icon,
  preview,
  onPreview,
  children,
}: {
  type: string;
  title: string;
  detail: string;
  imagePath?: string | null;
  icon: ReactElement;
  preview: LibraryPreview;
  onPreview: (preview: LibraryPreview) => void;
  children?: ReactElement;
}) {
  return (
    <article className="library-work-card">
      <button
        type="button"
        className="project-card library-work-card-main"
        onClick={() => onPreview(preview)}
        aria-label={`预览 ${title}`}
      >
        <div className="project-preview library-work-cover">
          {imagePath ? <img src={fileUrl(imagePath)} alt="" /> : icon}
        </div>
        <div>
          <span>{detail}</span>
          <h3>{title}</h3>
          <p>{type}</p>
        </div>
        <MoreHorizontal size={18} />
      </button>
      {children}
    </article>
  );
}

function WorkActions({
  title,
  deleting,
  onRename,
  onDelete,
}: {
  title: string;
  deleting: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="library-work-actions">
      <button
        className="icon-button"
        type="button"
        onClick={onRename}
        aria-label={`重命名 ${title}`}
      >
        <Pencil size={16} />
      </button>
      <button
        className="icon-button destructive"
        type="button"
        disabled={deleting}
        onClick={onDelete}
        aria-label={deleting ? `正在删除 ${title}` : `删除 ${title}`}
      >
        {deleting ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <Trash2 size={17} />
        )}
      </button>
    </div>
  );
}

function WorkRenameDialog({
  work,
  onClose,
  onSaved,
}: {
  work: LibraryRename;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(work.title);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function suggest() {
    setLoadingSuggestions(true);
    setError("");
    try {
      const result = await client.suggestWorkTitles(work.kind, work.id);
      setSuggestions(result.titles);
    } catch (reason) {
      setError(
        userFacingError(
          reason instanceof Error ? reason.message : "",
          "AI 名称生成失败",
        ),
      );
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await client.updateWorkTitle({ ...work, title });
      await onSaved();
    } catch (reason) {
      setError(
        userFacingError(
          reason instanceof Error ? reason.message : "",
          "作品名称保存失败",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="library-rename-backdrop"
      role="presentation"
      onClick={() => !saving && onClose()}
    >
      <section
        className="library-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-rename-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <span className="eyebrow">作品名称</span>
          <h2 id="library-rename-title">重命名作品</h2>
        </div>
        <label>
          名称
          <input
            autoFocus
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <button
          className="button secondary"
          type="button"
          disabled={loadingSuggestions || saving}
          onClick={() => void suggest()}
        >
          {loadingSuggestions ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Sparkles size={16} />
          )}{" "}
          {loadingSuggestions ? "正在生成名称" : "AI 生成名称"}
        </button>
        {suggestions.length > 0 && (
          <div className="library-title-suggestions" aria-label="AI 名称建议">
            {suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => setTitle(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="library-rename-actions">
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={saving || !title.trim()}
            onClick={() => void save()}
          >
            {saving ? <LoaderCircle className="spin" size={16} /> : null}
            {saving ? "正在保存" : "保存名称"}
          </button>
        </div>
      </section>
    </div>
  );
}

function LibraryPreview({
  preview,
  onClose,
  onEdit,
}: {
  preview: LibraryPreview;
  onClose: () => void;
  onEdit: () => void;
}) {
  const playable = preview.kind === "video" && Boolean(preview.path);
  const [previewRatio, setPreviewRatio] = useState(defaultVideoPreviewRatio);

  useEffect(() => {
    setPreviewRatio(defaultVideoPreviewRatio);
  }, [preview.path]);

  return (
    <div
      className="library-preview-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="library-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${preview.title}预览`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="library-preview-toolbar">
          <div className="library-preview-heading">
            <h2>{preview.title}</h2>
            <p>{preview.detail}</p>
          </div>
          <div className="library-preview-actions">
            <button className="button primary" type="button" onClick={onEdit}>
              继续编辑
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              aria-label="关闭作品预览"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="library-preview-media">
          {preview.path ? (
            playable ? (
              <video
                key={preview.path}
                controls
                playsInline
                preload="metadata"
                src={fileUrl(preview.path)}
                style={{ aspectRatio: previewRatio }}
                onLoadedMetadata={(event) => {
                  setPreviewRatio(
                    videoPreviewRatio(
                      event.currentTarget.videoWidth,
                      event.currentTarget.videoHeight,
                    ),
                  );
                }}
              />
            ) : (
              <img src={fileUrl(preview.path)} alt={preview.title} />
            )
          ) : (
            <div className="library-preview-unavailable">
              {preview.kind === "video" ? (
                <Film size={36} />
              ) : (
                <ImagePlus size={36} />
              )}
              <span>该作品暂时没有可预览的成品</span>
            </div>
          )}
        </div>
      </section>
    </div>
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
