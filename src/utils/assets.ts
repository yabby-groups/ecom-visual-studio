export const statusText = (status: string) =>
  ({
    draft: "未生成",
    queued: "排队中",
    preparing: "准备素材",
    prompting: "正在生成提示词",
    generating: "正在生成",
    downloading: "正在下载片段",
    merging: "正在合并视频",
    interrupted: "生成已中断",
    ready: "已完成",
  })[status] || (status.startsWith("failed") ? "生成失败" : "未知状态");

export const isPending = (status: string) =>
  ["queued", "preparing", "prompting", "generating", "downloading", "merging"].includes(status);

export const failureReason = (status: string) =>
  status.replace(/^failed(?::\s*)?/, "").trim() || "请重试";

export const fileUrl = (path?: string | null) => (path ? `/files/${path}` : "");
