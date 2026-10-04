import type { VideoReplicaJob } from "../types";

export const libraryTabs = [
  { id: "images", label: "图片", createPath: "/new" },
  { id: "try-on", label: "换装", createPath: "/try-on" },
  {
    id: "video-replica",
    label: "普通复刻",
    createPath: "/video-replica",
  },
  {
    id: "ai-video-replica",
    label: "AI 复刻",
    createPath: "/ai-video-replica",
  },
] as const;

export type LibraryTabID = (typeof libraryTabs)[number]["id"];

export function isAIVideoReplica(job: VideoReplicaJob) {
  return job.task_type === "ai_replica";
}

export function filterVideoWorks(
  jobs: VideoReplicaJob[],
  tab: "video-replica" | "ai-video-replica",
) {
  return jobs.filter((job) =>
    tab === "ai-video-replica" ? isAIVideoReplica(job) : !isAIVideoReplica(job),
  );
}

export function videoReplicaPath(job: VideoReplicaJob) {
  return `${isAIVideoReplica(job) ? "/ai-video-replica" : "/video-replica"}/${job.id}`;
}
