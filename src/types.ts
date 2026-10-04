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
  template_ids?: string[];
  assets?: Asset[];
};
export type Template = {
  id: string;
  name: string;
  group: string;
  ratio: string;
  direction: string;
  image_path?: string;
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
export type Model = {
  id: string;
  provider_id: string;
  name: string;
  api_modes: string[];
};
export type WalletTokenBalance = {
  model_alias: string;
  billing_mode: string;
  total_tokens: string;
};
export type SubscriptionDailyQuota = {
  model_id: string;
  billing_mode: string;
  daily_tokens: string;
  consumed_tokens: string;
  remaining_tokens: string;
};
export type TokenSettings = {
  tokens: Token[];
  token_balances: WalletTokenBalance[];
  subscription_daily_quotas: SubscriptionDailyQuota[];
  wallet_balance: string;
  total_consumed_cost: string;
  today_consumed_cost: string;
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
  title: string;
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
  generation_started_at: number | null;
  created_at: number;
};
export type TryOnPage = {
  items: TryOnJob[];
  total: number;
  has_more: boolean;
};

export type VideoReplicaStoryboardItem = {
  start: number;
  end: number;
  shot: string;
  action: string;
  dialogue: string;
  audio: string;
  continuity: string;
};
export type VideoReplicaVersion = {
  id: string;
  job_id: string;
  source_version_id?: string | null;
  file_path: string;
  generation_started_at: number | null;
  completed_at: number | null;
  generation_duration_seconds: number | null;
  created_at: number;
};
export type VideoReplicaSegment = {
  id: string;
  index: number;
  start_second: number;
  duration: number;
  prompt: string;
  status: string;
  file_path: string | null;
  remote_id: string | null;
  polling_url: string | null;
};
export type VideoReplicaProgress = {
  phase: string;
  completed_segments: number;
  total_segments: number;
  current_segment: number;
  message?: string;
};
export type AvatarAssetSelection = {
  source: "personal" | "public";
  id: string;
};
export type AvatarAsset = {
  id: string;
  name: string;
  status: string;
  preview_url: string;
  preview_url_512: string;
  preview_url_64: string;
  asset_uri?: string;
};
export type AvatarPersona = {
  id: string;
  name: string;
  tags: string;
  group_id?: string;
  description?: string;
  status: string;
  assets: AvatarAsset[];
};
export type AvatarAssetCatalog = {
  personas: AvatarPersona[];
  assets: AvatarAsset[];
};
export type VideoReplicaJob = {
  id: string;
  title: string;
  source_video_path: string;
  reference_paths: string[];
  product_reference_path: string;
  task_type: "auto" | "reference" | "extend" | "replace" | "ai_replica";
  model: string;
  prompt: string;
  storyboard: VideoReplicaStoryboardItem[];
  storyboard_confirmed: boolean;
  duration: number;
  resolution: string;
  ratio: string;
  status: AssetStatus;
  file_path: string | null;
  preview_path: string | null;
  generation_started_at: number | null;
  completed_at: number | null;
  created_at: number;
  versions: VideoReplicaVersion[];
  segments: VideoReplicaSegment[];
  progress: VideoReplicaProgress;
  workflow_kind?: "storyboard" | "ai_replace";
  ai_budget?: number;
  avatar_assets?: AvatarAssetSelection[];
  skill2api_request_id?: string;
  skill2api_delivery_id?: string;
  skill2api?: Skill2APIStatus;
};
export type VideoReplicaPage = {
  items: VideoReplicaJob[];
  total: number;
  has_more: boolean;
};
export type Skill2APIStatus = {
  request_id: string;
  status: string;
  remote_status?: string;
  remote_error?: string;
  started_at?: string;
  finished_at?: string;
  phase?: string;
  question?: string;
  options?: string[];
  stdout?: string;
  stderr?: string;
  files?: string[];
  error?: string;
  delivery_id?: string;
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
