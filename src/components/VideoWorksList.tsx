import { Film } from "lucide-react";
import { useState, type ReactNode } from "react";
import { client } from "../api";
import type { VideoReplicaJob } from "../types";
import { statusText, userFacingError } from "../utils/assets";
import { filterVideoWorks, type LibraryTabID } from "../utils/libraryWorks";
import { ConfirmDialog } from "./ConfirmDialog";
import { Notice } from "./Notice";
import {
  LibraryPreview,
  LibraryWorkCard,
  WorkActions,
  WorkRenameDialog,
  type LibraryRename,
} from "./WorksLibrary";

type VideoWorksTab = Extract<
  LibraryTabID,
  "video-replica" | "ai-video-replica"
>;

type Props = {
  jobs: VideoReplicaJob[];
  tab: VideoWorksTab;
  disabled?: boolean;
  empty: ReactNode;
  onSelect: (job: VideoReplicaJob) => void;
  renderActions?: (job: VideoReplicaJob) => ReactNode;
  management?: {
    onRefresh: () => Promise<void>;
    onDeleted: (job: VideoReplicaJob) => void;
  };
};

export function VideoWorksList({
  jobs,
  tab,
  disabled = false,
  empty,
  onSelect,
  renderActions,
  management,
}: Props) {
  const works = filterVideoWorks(jobs, tab);
  const type = tab === "ai-video-replica" ? "AI 复刻视频" : "普通复刻视频";
  const [preview, setPreview] = useState<VideoReplicaJob | null>(null);
  const [renaming, setRenaming] = useState<LibraryRename | null>(null);
  const [deleting, setDeleting] = useState<VideoReplicaJob | null>(null);
  const [deletingID, setDeletingID] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");

  async function deleteWork() {
    if (!deleting || !management) return;
    setDeletingID(deleting.id);
    setDeleteError("");
    try {
      await client.deleteVideoReplica(deleting.id);
      management.onDeleted(deleting);
      await management.onRefresh();
      setDeleting(null);
      setNotice("视频作品已删除");
    } catch (reason) {
      setDeleteError(
        userFacingError(
          reason instanceof Error ? reason.message : "",
          "删除视频作品失败",
        ),
      );
    } finally {
      setDeletingID("");
    }
  }

  return (
    <>
      {works.length ? (
        <div className="art-grid library-art-grid">
          {works.map((job) => {
            const title = job.title || job.model;
            const latestGenerationDuration = job.versions[0]?.generation_duration_seconds;
            const durationDetail = `${statusText(job.status)} · 视频时长 ${job.duration} 秒${latestGenerationDuration != null ? ` · 生成耗时 ${latestGenerationDuration} 秒` : ""}`;
            return (
              <LibraryWorkCard
                key={job.id}
                type={type}
                title={title}
                detail={durationDetail}
                imagePath={job.status === "ready" ? job.preview_path : null}
                icon={<Film size={28} />}
                preview={{
                  kind: "video",
                  title,
                  detail: `${type} · ${durationDetail}`,
            path: job.status === "ready" ? job.file_path : null,
            editPath: "",
            duration: job.duration,
            versions: job.versions,
                }}
                onPreview={() => !disabled && setPreview(job)}
              >
                <>
                  {management && !disabled && (
                    <WorkActions
                      title={title}
                      deleting={deletingID === job.id}
                      onRename={() =>
                        setRenaming({ kind: "video", id: job.id, title })
                      }
                      onDelete={() => {
                        setDeleteError("");
                        setDeleting(job);
                      }}
                    />
                  )}
                  {renderActions?.(job)}
                </>
              </LibraryWorkCard>
            );
          })}
        </div>
      ) : (
        empty
      )}
      {preview && (
        <LibraryPreview
          preview={{
            kind: "video",
            title: preview.title || preview.model,
            detail: `${type} · ${statusText(preview.status)} · 视频时长 ${preview.duration} 秒${preview.versions[0]?.generation_duration_seconds != null ? ` · 生成耗时 ${preview.versions[0].generation_duration_seconds} 秒` : ""}`,
            path: preview.status === "ready" ? preview.file_path : null,
            editPath: "",
            duration: preview.duration,
            versions: preview.versions,
          }}
          onClose={() => setPreview(null)}
          onEdit={() => {
            onSelect(preview);
            setPreview(null);
          }}
        />
      )}
      {notice && <Notice text={notice} onClose={() => setNotice("")} />}
      {renaming && (
        <WorkRenameDialog
          work={renaming}
          onClose={() => setRenaming(null)}
          onSaved={async () => {
            await management?.onRefresh();
            setRenaming(null);
            setNotice("作品名称已保存");
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`删除${deleting.title || deleting.model}？`}
          message="将删除这条视频记录及其所有生成文件。原始参考素材会保留，且此操作无法撤销。"
          confirmLabel="确认删除"
          error={deleteError}
          loading={deletingID === deleting.id}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void deleteWork()}
        />
      )}
    </>
  );
}
