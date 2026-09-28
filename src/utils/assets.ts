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

export const userFacingError = (message: string, fallback = "请重试") => {
  const reason = message.replace(/^failed(?::\s*)?/, "").trim();
  if (/\bunauthorized\b|http\s*401/i.test(reason)) {
    return "Huabot 授权已失效，请重新授权";
  }
  return reason || fallback;
};

export const failureReason = (status: string) => userFacingError(status);

export const fileUrl = (path?: string | null) => (path ? `/files/${path}` : "");
