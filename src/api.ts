import type {
  Asset,
  Model,
  Project,
  Template,
  TokenSettings,
  User,
} from "./types";

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

export class ApiError extends Error {}

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    credentials: "include",
    headers:
      options.body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    ...options,
    body:
      options.body instanceof FormData
        ? options.body
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
  });
  const payload = await response
    .json()
    .catch(() => ({ detail: "服务返回无效响应" }));
  if (!response.ok)
    throw new ApiError(payload.detail || payload.error || "请求失败");
  return payload as T;
}

export const client = {
  me: () => api<{ user: User | null }>("auth/me"),
  login: (body: { name: string; password: string; totp_code: string }) =>
    api<{ user: User }>("auth/login", { method: "POST", body }),
  logout: () => api("auth/logout", { method: "POST" }),
  projects: () => api<Project[]>("projects"),
  project: (id: string) => api<Project>(`projects/${id}`),
  createProject: (
    body: Omit<Project, "id" | "user_id" | "created_at" | "assets">,
  ) => api<{ id: string }>("projects", { method: "POST", body }),
  createPack: (
    id: string,
    body: { kind: string; scene_template_ids: string[] },
  ) => api(`projects/${id}/pack`, { method: "POST", body }),
  deleteProject: (id: string) => api(`projects/${id}`, { method: "DELETE" }),
  updateAsset: (id: string, body: Partial<Asset>) =>
    api(`assets/${id}`, { method: "PATCH", body }),
  resetPrompt: (id: string) =>
    api<{ prompt: string }>(`assets/${id}/prompt`, { method: "POST" }),
  generateAsset: (id: string) =>
    api(`assets/${id}/generate`, { method: "POST" }),
  generatePack: (id: string) =>
    api(`projects/${id}/generate-pack`, { method: "POST" }),
  templates: () => api<Template[]>("templates"),
  addTemplate: (body: { name: string; ratio: string; direction: string }) =>
    api("templates", { method: "POST", body }),
  deleteTemplate: (id: string) => api(`templates/${id}`, { method: "DELETE" }),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return api<{ path: string }>("reference-upload", { method: "POST", body });
  },
  importUrl: (url: string) =>
    api<{ path: string }>("reference-url", { method: "POST", body: { url } }),
  analyze: (body: { mode: string; product: string; reference: string }) =>
    api<{ description: string; benefits: string[] }>("analyze-product", {
      method: "POST",
      body,
    }),
  chat: (messages: { role: string; content: string }[]) =>
    api<{ reply: string }>("chat", { method: "POST", body: { messages } }),
  tokenSettings: () => api<TokenSettings>("huabot/tokens"),
  models: () => api<{ models: Model[] }>("huabot/models"),
  saveSettings: (body: {
    token_id: string;
    image_model: string;
    text_model: string;
    chat_model: string;
  }) => api("settings", { method: "POST", body }),
};
