import type {
  Asset,
  Model,
  LatestCreation,
  Project,
  Template,
  TokenSettings,
  TryOnPage,
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
  latestCreation: () =>
    api<{ creation: LatestCreation | null }>("creations/latest"),
  project: (id: string) => api<Project>(`projects/${id}`),
  createProject: (
    body: Omit<Project, "id" | "user_id" | "created_at" | "assets">,
  ) => api<{ id: string }>("projects", { method: "POST", body }),
  createPack: (
    id: string,
    body: {
      kind: string;
      scene_template_ids: string[];
      template_id?: string;
    },
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
  tryOnJobs: (limit = 12, offset = 0) =>
    api<TryOnPage>(`try-on?limit=${limit}&offset=${offset}`),
  createTryOn: (body: {
    person_path: string;
    garment_path: string;
    instructions: string;
    ratio: string;
  }) => api<{ id: string }>("try-on", { method: "POST", body }),
  regenerateTryOn: (id: string) =>
    api(`try-on/${id}/generate`, { method: "POST" }),
  deleteTryOn: (id: string) => api(`try-on/${id}`, { method: "DELETE" }),
  analyze: (body: { mode: string; product: string; reference: string }) =>
    api<{ description: string; benefits: string[] }>("analyze-product", {
      method: "POST",
      body,
    }),
  chat: async (
    messages: { role: string; content: string }[],
    onDelta: (delta: string) => void,
  ) => {
    const response = await fetch("/api/chat", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError(payload.detail || payload.error || "对话请求失败");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        const data = event
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
        if (!data) continue;
        const payload = JSON.parse(data) as { delta?: string; error?: string };
        if (payload.error) throw new ApiError(payload.error);
        if (payload.delta) onDelta(payload.delta);
      }
      if (done) break;
    }
  },
  tokenSettings: () => api<TokenSettings>("huabot/tokens"),
  models: () => api<{ models: Model[] }>("huabot/models"),
  saveSettings: (body: {
    token_id: string;
    image_model: string;
    text_model: string;
    chat_model: string;
  }) => api("settings", { method: "POST", body }),
};
