export const statusText = (status: string) =>
  ({
    draft: "未生成",
    queued: "排队中",
    prompting: "正在生成提示词",
    generating: "正在生成",
    ready: "已完成",
  })[status] || (status.startsWith("failed") ? "生成失败" : "未知状态");

export const isPending = (status: string) =>
  ["queued", "prompting", "generating"].includes(status);

export const failureReason = (status: string) =>
  status.replace(/^failed(?::\s*)?/, "").trim() || "请重试";

export const fileUrl = (path?: string | null) => (path ? `/files/${path}` : "");
