import type {
  Asset,
  AiChatContext,
  AiChatResult,
  DeviceAuthorization,
  DeviceAuthorizationPoll,
  LatestCreation,
  Model,
  Project,
  StorageLocation,
  Template,
  TokenSettings,
  TryOnJob,
  TryOnPage,
  User,
} from "./types";
import { studio, uploadFile } from "./desktop";
import { EventsOff, EventsOn } from "../wailsjs/runtime/runtime";

export class ApiError extends Error {}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason.trim();
  if (reason && typeof reason === "object" && "message" in reason) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "请求失败";
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  try {
    const fn = studio()[method];
    if (!fn) throw new Error(`桌面服务尚未实现 ${method}`);
    return (await fn(...args)) as T;
  } catch (reason) {
    throw new ApiError(errorMessage(reason));
  }
}

let chatRequestSequence = 0;

function nextChatRequestID() {
  chatRequestSequence += 1;
  return `chat-${Date.now()}-${chatRequestSequence}`;
}

export const client = {
  me: () => call<{ user: User | null }>("Me"),
  login: (body: { name: string; password: string; totp_code: string }) =>
    call<{ user: User }>("Login", body.name, body.password, body.totp_code),
  startHuabotAuthorization: () =>
    call<DeviceAuthorization>("StartHuabotAuthorization"),
  pollHuabotAuthorization: (deviceCode: string) =>
    call<DeviceAuthorizationPoll>("PollHuabotAuthorization", deviceCode),
  logout: () => call("Logout"),
  projects: () => call<Project[]>("Projects"),
  latestCreation: () =>
    call<{ creation: LatestCreation | null }>("LatestCreation"),
  project: (id: string) => call<Project>("Project", id),
  createProject: (
    body: Omit<Project, "id" | "user_id" | "created_at" | "assets">,
  ) => call<{ id: string }>("CreateProject", body),
  createPack: (
    id: string,
    body: { kind: string; scene_template_ids: string[]; template_id?: string },
  ) => call("CreatePack", id, body),
  addAsset: (projectId: string, templateId: string) =>
    call<{ id: string }>("AddAsset", projectId, templateId),
  deleteProject: (id: string) => call("DeleteProject", id),
  updateAsset: (id: string, body: Partial<Asset>) =>
    call("UpdateAsset", id, body),
  changeAssetTemplate: (id: string, templateId: string, overwrite: boolean) =>
    call<{ requires_confirmation: boolean; prompt?: string }>(
      "ChangeAssetTemplate",
      id,
      templateId,
      overwrite,
    ),
  resetPrompt: (id: string) => call<{ prompt: string }>("ResetPrompt", id),
  downloadAsset: (path: string) => call<boolean>("DownloadAsset", path),
  generateAsset: (id: string) => call("GenerateAsset", id),
  generatePack: (id: string) => call("GeneratePack", id),
  templates: () => call<Template[]>("Templates"),
  addTemplate: (body: {
    name: string;
    ratio: string;
    direction: string;
    image_path?: string;
  }) => call("AddTemplate", body),
  updateTemplate: (
    id: string,
    body: {
      name: string;
      ratio: string;
      direction: string;
      image_path?: string;
    },
  ) => call("UpdateTemplate", id, body),
  deleteTemplate: (id: string) => call("DeleteTemplate", id),
  upload: uploadFile,
  pickImage: () => call<{ path: string }>("PickImage"),
  importUrl: (url: string) => call<{ path: string }>("ImportURL", url),
  tryOnJobs: (limit = 12, offset = 0) =>
    call<TryOnPage>("TryOnJobs", limit, offset),
  tryOnJob: (id: string) => call<TryOnJob>("TryOnJob", id),
  createTryOn: (body: {
    person_paths: string[];
    garment_paths: string[];
    generation_mode: "combined" | "combinations";
    instructions: string;
    ratio: string;
  }) => call<{ id: string; ids: string[] }>("CreateTryOn", body),
  regenerateTryOn: (id: string) => call("RegenerateTryOn", id),
  deleteTryOn: (id: string) => call("DeleteTryOn", id),
  analyze: (body: { mode: string; product: string; reference: string }) =>
    call<{ description: string; benefits: string[] }>("Analyze", body),
  chat: async (
    messages: { role: string; content: string }[],
    context: AiChatContext,
    onDelta: (delta: string) => void,
  ): Promise<AiChatResult> => {
    const requestID = nextChatRequestID();
    const eventName = `chat:delta:${requestID}`;
    let receivedDelta = false;
    EventsOn(eventName, (delta: unknown) => {
      if (typeof delta === "string" && delta) {
        receivedDelta = true;
        onDelta(delta);
      }
    });
    try {
      const result = await call<AiChatResult>(
        "Chat",
        requestID,
        messages,
        context,
      );
      if (!receivedDelta && result.text) onDelta(result.text);
      return result;
    } finally {
      EventsOff(eventName);
    }
  },
  tokenSettings: () => call<TokenSettings>("TokenSettings"),
  models: () => call<{ models: Model[] }>("Models"),
  refreshTokenSettings: () => call<TokenSettings>("RefreshTokenSettings"),
  refreshModels: () => call<{ models: Model[] }>("RefreshModels"),
  saveSettings: (body: {
    token_id: string;
    image_model: string;
    text_model: string;
    chat_model: string;
  }) => call("SaveSettings", body),
  storageLocation: () => call<StorageLocation>("StorageLocation"),
  chooseStorageDirectory: () => call<StorageLocation>("ChooseStorageDirectory"),
};
