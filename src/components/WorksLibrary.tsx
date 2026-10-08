import {
  Film,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { client } from "../api";
import { fileUrl, userFacingError } from "../utils/assets";
import type { VideoReplicaVersion } from "../types";
import {
  defaultVideoPreviewRatio,
  videoPreviewRatio,
} from "../utils/videoPreview";
import "./Library.css";
import "./ProjectCard.css";

export type LibraryPreview = {
  kind: "image" | "video";
  title: string;
  detail: string;
  path: string | null;
  editPath: string;
  duration?: number;
  versions?: VideoReplicaVersion[];
};

function formatHumanDuration(seconds: number | null) {
  if (seconds === null) {
    return "未知";
  }
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded} 秒`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

function versionGenerationDuration(version?: VideoReplicaVersion) {
  if (!version) {
    return null;
  }
  if (version.generation_duration_seconds != null) {
    return version.generation_duration_seconds;
  }
  if (version.generation_started_at != null && version.completed_at != null) {
    return Math.max(0, version.completed_at - version.generation_started_at);
  }
  return null;
}

export type LibraryRename = {
  kind: "project" | "try-on" | "video";
  id: string;
  title: string;
};

export function LibraryWorkCard({
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
  children?: ReactElement | null;
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
          <span>{formatDetailDuration(detail)}</span>
          <h3>{title}</h3>
          <p>{type}</p>
        </div>
        <MoreHorizontal size={18} />
      </button>
      {children}
    </article>
  );
}

export function WorkActions({
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

export function WorkRenameDialog({
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

function formatDetailDuration(detail: string) {
  return detail.replace(/(\d+) 秒/g, (_match, seconds) =>
    formatHumanDuration(Number(seconds)),
  );
}

function getDisplayedDetail(
  preview: LibraryPreview,
  version?: VideoReplicaVersion,
) {
  version =
    version ??
    preview.versions?.find((version) => version.file_path === preview.path);

  if (!version) {
    return formatDetailDuration(preview.detail);
  }

  const generationDuration = versionGenerationDuration(version);

  const detail = preview.detail.replace(
    /生成耗时 \d+ 秒$/,
    `生成耗时 ${formatHumanDuration(generationDuration)}`,
  );

  return formatDetailDuration(detail);
}

export function LibraryPreview({
  preview,
  onClose,
  onEdit,
}: {
  preview: LibraryPreview;
  onClose: () => void;
  onEdit: () => void;
}) {
  const playable = preview.kind === "video" && Boolean(preview.path);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [previewRatio, setPreviewRatio] = useState(defaultVideoPreviewRatio);
  const displayedVersion =
    preview.versions?.find((version) => version.id === selectedVersionId) ??
    preview.versions?.find((version) => version.file_path === preview.path);
  const versions = preview.versions?.filter(
    (version, index, all) =>
      all.findIndex(
        (candidate) => candidate.file_path === version.file_path,
      ) === index,
  );
  const displayedPath = displayedVersion?.file_path ?? preview.path;
  const displayedDetail = getDisplayedDetail(preview, displayedVersion);

  useEffect(() => {
    setSelectedVersionId(null);
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
            <p>{displayedDetail}</p>
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
          {displayedPath ? (
            playable ? (
              <video
                key={displayedPath}
                controls
                playsInline
                preload="metadata"
                src={fileUrl(displayedPath)}
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
              <img src={fileUrl(displayedPath)} alt={preview.title} />
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
        {preview.kind === "video" && versions?.length ? (
          <div className="library-preview-version-area">
            <div className="library-preview-versions" aria-label="视频版本">
              <span>版本</span>
              {versions.map((version, index) => {
                const active = version.id === displayedVersion?.id;
                const current = index === 0;
                return (
                  <button
                    className={`video-version ${active ? "active" : ""}`}
                    key={version.id}
                    type="button"
                    onClick={() => setSelectedVersionId(version.id)}
                    aria-label={`查看${current ? "当前" : `历史 ${versions.length - index}`}版本`}
                  >
                    {current ? "当前" : `v${versions.length - index}`}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
