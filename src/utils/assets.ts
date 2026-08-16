export const statusText = (status: string) =>
  ({
    draft: "未生成",
    queued: "等待队列",
    prompting: "生成提示词",
    generating: "正在生成",
    ready: "已完成",
  })[status] || (status.startsWith("failed") ? "生成失败" : status);

export const isPending = (status: string) =>
  ["queued", "prompting", "generating"].includes(status);

export const fileUrl = (path?: string | null) => (path ? `/files/${path}` : "");
