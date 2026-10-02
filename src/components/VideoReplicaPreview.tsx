import { Download, Film, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { VideoReplicaJob, VideoReplicaSegment } from "../types";
import { failureReason, fileUrl, isPending, statusText } from "../utils/assets";
import {
  defaultVideoPreviewRatio,
  videoPreviewRatio,
} from "../utils/videoPreview";

type Props = {
  selected: VideoReplicaJob | null;
  duration: number;
  busy: string;
  mediaRefreshToken: number;
  regenerate: (id: string) => void;
  exportVideo: (path: string) => void;
};

export function VideoReplicaPreview({
  selected,
  duration,
  busy,
  mediaRefreshToken,
  regenerate,
  exportVideo,
}: Props) {
  const [previewRatio, setPreviewRatio] = useState(defaultVideoPreviewRatio);
  const displayed = selected?.file_path
    ? `${fileUrl(selected.file_path)}?refresh=${mediaRefreshToken}`
    : "";
  const selectedLabel = useMemo(
    () =>
      selected
        ? `${selected.model} · ${statusText(selected.status)}`
        : "等待生成结果",
    [selected],
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

  useEffect(() => {
    setPreviewRatio(defaultVideoPreviewRatio);
  }, [displayed]);

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
    <section className="video-replica-preview">
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
      {selected && (
        <div className="video-generation-progress" aria-live="polite">
          <div className="generation-progress-head">
            <strong>{statusText(selected.status)}</strong>
            <span>
              {progress?.completed_segments ?? 0}/
              {progress?.total_segments ?? 0} 段完成
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
                当前第 {progress.current_segment + 1} / {progress.total_segments} 段 ·{" "}
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
      )}
      <div className="video-stage" style={{ aspectRatio: previewRatio }}>
        {displayed ? (
          <video
            src={displayed}
            controls
            onLoadedMetadata={(event) =>
              setPreviewRatio(
                videoPreviewRatio(
                  event.currentTarget.videoWidth,
                  event.currentTarget.videoHeight,
                ),
              )
            }
          />
        ) : (
          <>
            <Film size={38} />
            <strong>{selectedFailure ? "生成失败" : "等待生成结果"}</strong>
            <p>{selectedFailure || "确认脚本后，视频会在这里出现"}</p>
          </>
        )}
      </div>
      {selectedFailure && (
        <p className="notice notice-error video-generation-error" role="alert">
          {selectedFailure}
        </p>
      )}
      <div className="preview-meta">
        <span>
          <small>参考风格</small>
          <b>{selected ? "已选参考视频" : "等待开始"}</b>
        </span>
        <span>
          <small>预计时长</small>
          <b>{duration} 秒</b>
        </span>
      </div>
      <p className="privacy-note">
        <ShieldCheck size={16} />
        选择的本机内容仅用于本次生成，不会公开展示。
      </p>
      {selected && (
        <div className="video-result-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => void regenerate(selected.id)}
            disabled={!!busy || isPending(selected.status)}
          >
            <RefreshCw size={16} />
            重新生成
          </button>
          {selected.file_path && (
            <button
              className="button secondary"
              type="button"
              onClick={() => void exportVideo(selected.file_path!)}
            >
              <Download size={16} />
              导出视频
            </button>
          )}
        </div>
      )}
    </section>
  );
}
