import { Download, Film, RefreshCw, ShieldCheck } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { VideoReplicaJob, VideoReplicaSegment } from "../types";
import { failureReason, fileUrl, isPending, statusText } from "../utils/assets";
import {
  defaultVideoPreviewRatio,
  videoPreviewRatio,
} from "../utils/videoPreview";
import "./VideoReplicaPreview.css";

type Props = {
  selected: VideoReplicaJob | null;
  duration?: number;
  busy?: string;
  mediaRefreshToken: number;
  regenerate?: (id: string) => void;
  exportVideo?: (path: string) => void;
  progress?: ReactNode;
  beforeStage?: ReactNode;
  emptyState?: {
    title: string;
    description: string;
  };
  metadata?: ReactNode;
  actions?: ReactNode;
  statusLabel?: string;
};

function formatHumanDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded} 秒`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

function versionGenerationDuration(version: VideoReplicaJob["versions"][number]) {
  if (version.generation_duration_seconds != null) {
    return version.generation_duration_seconds;
  }
  if (version.generation_started_at != null && version.completed_at != null) {
    return Math.max(0, version.completed_at - version.generation_started_at);
  }
  return null;
}

export function VideoReplicaPreview({
  selected,
  duration,
  busy,
  mediaRefreshToken,
  regenerate,
  exportVideo,
  progress: customProgress,
  beforeStage,
  emptyState,
  metadata,
  actions,
  statusLabel,
}: Props) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [previewRatio, setPreviewRatio] = useState(defaultVideoPreviewRatio);
  const [previewScale, setPreviewScale] = useState(16 / 9);
  const displayedVersion =
    selected?.versions.find((version) => version.id === selectedVersionId) ??
    selected?.versions.find((version) => version.file_path === selected.file_path);
  const versions = selected?.versions.filter(
    (version, index, all) =>
      all.findIndex((candidate) => candidate.file_path === version.file_path) ===
      index,
  );
  const displayedPath = displayedVersion?.file_path ?? selected?.file_path ?? null;
  const displayed = displayedPath
    ? `${fileUrl(displayedPath)}?refresh=${mediaRefreshToken}`
    : "";
  const selectedLabel = useMemo(
    () =>
      statusLabel ||
      (selected
        ? `${selected.model} · ${statusText(selected.status)}`
        : "等待生成结果"),
    [selected, statusLabel],
  );
  const selectedFailure = selected?.status.startsWith("failed")
    ? failureReason(selected.status)
    : "";
  const progress = selected?.progress;
  const phaseSteps = [
    ["preparing", "准备素材"],
    ["generating", "生成片段"],
    ["downloading", "保存片段"],
    ["merging", "合并视频"],
    ["ready", "完成"],
  ] as const;
  const phaseIndex = selected
    ? phaseSteps.findIndex(([phase]) => phase === selected.status)
    : -1;
  const progressContent =
    customProgress ??
    (selected && (
      <div className="video-generation-progress" aria-live="polite">
        <div className="generation-progress-head">
          <strong>{statusText(selected.status)}</strong>
          <span>
            {progress?.completed_segments ?? 0}/{progress?.total_segments ?? 0}{" "}
            段完成
          </span>
        </div>
        <div className="generation-phase-list">
          {phaseSteps.map(([phase, label], index) => {
            const activeIndex = selected.status === "queued" ? 0 : phaseIndex;
            const done =
              selected.status === "ready" ||
              (activeIndex >= 0 && index < activeIndex);
            const active =
              selected.status === phase ||
              (selected.status === "queued" && index === 0);
            return (
              <div
                className={`generation-phase ${done ? "done" : ""} ${active ? "active" : ""}`}
                key={phase}
              >
                <span className="generation-phase-dot" />
                <span>{label}</span>
              </div>
            );
          })}
        </div>
        {isPending(selected.status) && (
          <div
            className="generation-indeterminate"
            role="progressbar"
            aria-label="视频生成进行中"
          />
        )}
        {progress?.current_segment !== undefined &&
          progress.current_segment >= 0 &&
          progress.total_segments > 0 && (
            <p className="generation-progress-detail">
              当前第 {progress.current_segment + 1} / {progress.total_segments}{" "}
              段 ·{" "}
              {selected.segments[progress.current_segment]
                ? segmentStatus(selected.segments[progress.current_segment])
                : "处理中"}
            </p>
          )}
        {selected.segments.length > 0 && (
          <div className="generation-segments">
            {selected.segments.map((segment) => (
              <div
                className={`generation-segment ${segment.status.startsWith("failed") ? "failed" : ""}`}
                key={segment.id}
              >
                <span>第 {segment.index + 1} 段</span>
                <small>{segmentStatus(segment)}</small>
              </div>
            ))}
          </div>
        )}
        {selected.status === "interrupted" && (
          <p className="generation-progress-detail">
            应用曾在生成期间退出，已保留片段进度，可重新生成。
          </p>
        )}
      </div>
    ));
  const defaultMetadata = (
    <>
      <span>
        <small>参考风格</small>
        <b>{selected ? "已选参考视频" : "等待开始"}</b>
      </span>
      <span>
        <small>视频时长</small>
        <b>{formatHumanDuration(duration ?? 0)}</b>
      </span>
      {displayedVersion && versionGenerationDuration(displayedVersion) != null && (
        <span>
          <small>生成耗时</small>
          <b>{formatHumanDuration(versionGenerationDuration(displayedVersion)!)}</b>
        </span>
      )}
    </>
  );
  const defaultActions = selected && regenerate && (
    <>
      <button
        className="button secondary"
        type="button"
        onClick={() => void regenerate(selected.id)}
        disabled={!!busy || isPending(selected.status)}
      >
        <RefreshCw size={16} />
        重新生成
      </button>
      {displayedPath && exportVideo && (
        <button
          className="button secondary"
          type="button"
          onClick={() => void exportVideo(displayedPath)}
        >
          <Download size={16} />
          导出视频
        </button>
      )}
    </>
  );
  const stageTitle = selectedFailure
    ? "生成失败"
    : emptyState?.title || "等待生成结果";
  const stageDescription =
    selectedFailure ||
    emptyState?.description ||
    "确认脚本后，视频会在这里出现";

  useEffect(() => {
    setSelectedVersionId(null);
    setPreviewRatio(defaultVideoPreviewRatio);
    setPreviewScale(16 / 9);
  }, [selected?.id]);

  function segmentStatus(segment: VideoReplicaSegment) {
    if (segment.status.startsWith("failed")) return "失败";
    return (
      (
        {
          queued: "排队中",
          submitting: "提交中",
          generating: "生成中",
          downloading: "保存中",
          ready: "已完成",
        } as Record<string, string>
      )[segment.status] || segment.status
    );
  }

  return (
    <section className={`video-replica-preview ${selected ? "" : "is-empty"}`}>
      <div className="video-replica-meta">
        <span className="workflow-badge">
          {selected ? statusText(selected.status) : "未开始"}
        </span>
        <span>时长不限 · 200MB</span>
      </div>
      <div className="video-replica-panel-head">
        <div>
          <span className="step-kicker">OUTPUT PREVIEW</span>
          <h2>生成预览</h2>
        </div>
        <span className="preview-status">{selectedLabel}</span>
      </div>
      <div className="video-replica-preview-container">
        {progressContent}
        {beforeStage}
        <div
          className="video-stage"
          style={
            {
              aspectRatio: previewRatio,
              "--preview-scale": previewScale,
            } as CSSProperties
          }
        >
          {displayed ? (
            <video
              src={displayed}
              controls
              playsInline
              onLoadedMetadata={(event) => {
                setPreviewRatio(
                  videoPreviewRatio(
                    event.currentTarget.videoWidth,
                    event.currentTarget.videoHeight,
                  ),
                );
                setPreviewScale(
                  event.currentTarget.videoWidth /
                    event.currentTarget.videoHeight,
                );
              }}
            />
          ) : (
            <>
              <Film size={38} />
              <strong>{stageTitle}</strong>
              <p>{stageDescription}</p>
            </>
          )}
        </div>
        {selectedFailure && (
          <p
            className="notice notice-error video-generation-error"
            role="alert"
          >
            {selectedFailure}
          </p>
        )}
        <div className="preview-meta">{metadata || defaultMetadata}</div>
        {selected && versions?.length ? (
          <div className="video-version-strip" aria-label="视频版本">
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
        ) : null}
        <p className="privacy-note">
          <ShieldCheck size={16} />
          选择的本机内容仅用于本次生成，不会公开展示。
        </p>
        {(actions || defaultActions) && (
          <div className="video-result-actions">
            {actions || defaultActions}
          </div>
        )}
      </div>
    </section>
  );
}
