export type User = { id: string; username: string };
export type AssetStatus =
  "draft" | "queued" | "prompting" | "generating" | "ready" | string;
export type AssetVersion = {
  id: string;
  asset_id: string;
  file_path: string;
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
