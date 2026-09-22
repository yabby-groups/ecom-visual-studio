export type User = {
  id: string;
  username: string;
  profile: { nick_name: string; avatar_url: string };
};
export type DeviceAuthorization = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};
export type DeviceAuthorizationPoll = {
  status:
    "authorization_pending" | "slow_down" | "authorized" | "denied" | "expired";
  user?: User;
};
export type AssetStatus =
  "draft" | "queued" | "prompting" | "generating" | "ready" | string;
export type AssetVersion = {
  id: string;
  asset_id: string;
  file_path: string;
  generation_started_at: number | null;
  created_at: number;
};
export type LatestCreation = {
  project_id: string;
  title: string;
  file_path: string;
  created_at: number;
};
export type Asset = {
  id: string;
  project_id: string;
  title: string;
  template: string;
  ratio: string;
  prompt: string;
  status: AssetStatus;
  file_path: string | null;
  generation_started_at: number | null;
  versions: AssetVersion[];
  created_at: number;
};
export type Project = {
  id: string;
  user_id: string;
  name: string;
  product: string;
  description: string;
  benefits: string;
  color: string;
  reference: string;
  created_at: number;
  asset_count?: number;
  assets?: Asset[];
};
export type Template = {
  id: string;
  name: string;
  group: string;
  ratio: string;
  direction: string;
  custom: boolean;
};
export type Token = {
  id: string;
  name: string;
  masked: string;
  status: number;
  today_cost: string;
  total_cost: string;
};
export type Model = { id: string; name: string };
export type TokenSettings = {
  tokens: Token[];
  active_token_id: string;
  image_model: string;
  text_model: string;
  chat_model: string;
};
export type StorageLocation = {
  current_path: string;
  pending_path?: string;
  restart_required: boolean;
  cancelled?: boolean;
};
export type TryOnJob = {
  id: string;
  user_id: string;
  person_path: string;
  garment_path: string;
  person_paths: string[];
  garment_paths: string[];
  generation_mode: "combined" | "combinations";
  instructions: string;
  ratio: string;
  status: AssetStatus;
  file_path: string | null;
  generation_started_at: number | null;
  versions: TryOnVersion[];
  created_at: number;
};
export type TryOnVersion = {
  id: string;
  job_id: string;
  file_path: string;
  created_at: number;
};
export type TryOnPage = {
  items: TryOnJob[];
  total: number;
  has_more: boolean;
};

export type AiAction = {
  type:
    | "navigate"
    | "fill_draft"
    | "update_asset"
    | "add_asset"
    | "generate_asset"
    | "generate_pack"
    | "create_project"
    | "create_template"
    | "create_try_on"
    | "regenerate_try_on";
  summary: string;
  payload: Record<string, unknown>;
};

export type AiChatContext = {
  route: string;
  screen: string;
  data: Record<string, unknown>;
};

export type AiChatResult = {
  text: string;
  actions: AiAction[];
};
