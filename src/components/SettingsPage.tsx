import { useEffect, useRef, useSyncExternalStore, useState } from "react";
import {
  LoaderCircle,
  LogOut,
  Database,
  FolderOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import { useAppStore } from "../store";
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
} from "../theme";
import type { StorageLocation, TokenSettings } from "../types";
import { LogoutButton } from "./LogoutButton";
import { Notice } from "./Notice";
import { Shell } from "./Shell";
import { SettingsSelect } from "./SettingsSelect";
import "./SettingsPage.css";

type SettingsValues = {
  token_id: string;
  image_model: string;
  text_model: string;
  chat_model: string;
};

const EMPTY_SETTINGS: TokenSettings = {
  tokens: [],
  active_token_id: "",
  image_model: "",
  text_model: "",
  chat_model: "",
};

const EMPTY_VALUES: SettingsValues = {
  token_id: "",
  image_model: "",
  text_model: "",
  chat_model: "",
};

const tokenCostFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

function formatTokenCost(value: string): string {
  if (!value.trim()) return "0";
  const number = Number(value);
  return Number.isFinite(number) ? tokenCostFormatter.format(number) : value;
}

function timeout<T>(request: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), 6000);
    request.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function SettingsPage() {
  const user = useAppStore((state) => state.user);
  const requireAiAuth = useRequireAiAuth();
  const [settings, setSettings] = useState<TokenSettings>(EMPTY_SETTINGS);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [values, setValues] = useState<SettingsValues>(EMPTY_VALUES);
  const [notice, setNotice] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [refreshingSettings, setRefreshingSettings] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [storage, setStorage] = useState<StorageLocation | null>(null);
  const [migratingStorage, setMigratingStorage] = useState(false);
  const dirtyFields = useRef(new Set<keyof SettingsValues>());
  const retryRefresh = useRef<(() => void) | null>(null);
  const themePreference = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
  );
  const imageModels = models.filter((model) =>
    model.id.startsWith("gpt-image-"),
  );
  useEffect(() => {
    let active = true;
    dirtyFields.current.clear();
    setRefreshError("");
    setSettingsReady(false);
    setModelsReady(false);
    setRefreshingSettings(false);
    setRefreshingModels(false);
    setSettings(EMPTY_SETTINGS);
    setModels([]);
    setValues(EMPTY_VALUES);

    if (!user) {
      retryRefresh.current = null;
      return;
    }

    const applySettings = (next: TokenSettings, preserveEdits: boolean) => {
      setSettings(next);
      setSettingsReady(true);
      setValues((current) => {
        const nextValues: SettingsValues = {
          token_id: next.active_token_id,
          image_model: next.image_model,
          text_model: next.text_model,
          chat_model: next.chat_model,
        };
        if (!preserveEdits) return nextValues;
        for (const field of dirtyFields.current) nextValues[field] = current[field];
        return nextValues;
      });
    };
    const applyModels = (
      next: { id: string; name: string }[],
      preserveEdits: boolean,
    ) => {
      setModels(next);
      setModelsReady(true);
      const nextImageModels = next.filter((model) =>
        model.id.startsWith("gpt-image-"),
      );
      setValues((current) => {
        if (
          preserveEdits &&
          dirtyFields.current.has("image_model")
        ) {
          return current;
        }
        if (
          !current.image_model ||
          !nextImageModels.some((model) => model.id === current.image_model)
        ) {
          return { ...current, image_model: nextImageModels[0]?.id || "" };
        }
        return current;
      });
    };
    const refreshSettings = () => {
      setRefreshingSettings(true);
      void timeout(client.refreshTokenSettings(), "Token 刷新服务未响应")
        .then((next) => {
          if (!active) return;
          applySettings(next, true);
          setRefreshError("");
        })
        .catch((error: unknown) => {
          if (!active) return;
          setRefreshError(
            error instanceof Error
              ? `Token 刷新失败，正在使用已保存配置：${error.message}`
              : "Token 刷新失败，正在使用已保存配置",
          );
        })
        .finally(() => {
          if (active) setRefreshingSettings(false);
        });
    };
    const refreshModels = () => {
      setRefreshingModels(true);
      void timeout(client.refreshModels(), "模型刷新服务未响应")
        .then((result) => {
          if (!active) return;
          applyModels(result.models, true);
          setRefreshError("");
        })
        .catch((error: unknown) => {
          if (!active) return;
          setRefreshError(
            error instanceof Error
              ? `模型刷新失败，正在使用已保存配置：${error.message}`
              : "模型刷新失败，正在使用已保存配置",
          );
        })
        .finally(() => {
          if (active) setRefreshingModels(false);
        });
    };
    retryRefresh.current = () => {
      if (!active) return;
      setRefreshError("");
      refreshSettings();
      refreshModels();
    };

    void timeout(client.tokenSettings(), "本地 Token 设置未响应")
      .then((next) => {
        if (active) applySettings(next, false);
      })
      .catch((error: unknown) => {
        if (active) {
          setRefreshError(
            error instanceof Error ? error.message : "无法读取已保存的 Token 设置",
          );
        }
      })
      .finally(() => {
        if (active) refreshSettings();
      });
    void timeout(client.models(), "本地模型设置未响应")
      .then((result) => {
        if (active) applyModels(result.models, false);
      })
      .catch((error: unknown) => {
        if (active) {
          setRefreshError(
            error instanceof Error ? error.message : "无法读取已保存的模型设置",
          );
        }
      })
      .finally(() => {
        if (active) refreshModels();
      });
    return () => {
      active = false;
      retryRefresh.current = null;
    };
  }, [user]);
  useEffect(() => {
    void client
      .storageLocation()
      .then(setStorage)
      .catch(() => {
        // Storage selection is supplementary; do not block account settings if its bridge is unavailable.
      });
  }, []);
  const canSave = settingsReady && modelsReady && models.length > 0;
  const refreshing = refreshingSettings || refreshingModels;
  return (
    <Shell>
      <div className="page settings-page">
        <header className="settings-intro">
          <span className="eyebrow">HUABOT TOKEN BASE</span>
          <h1>工作台设置</h1>
          <p>管理创作所使用的 Token 与模型配置，变更会在保存后生效。</p>
        </header>
        {user && (refreshing || refreshError) && (
          <div className="settings-sync-status" role="status">
            {refreshing && <LoaderCircle className="spin" size={16} />}
            <span>
              {refreshError || "正在后台刷新 Token 用量和可用模型..."}
            </span>
            {refreshError && retryRefresh.current && (
              <button
                type="button"
                className="settings-sync-retry"
                onClick={() => retryRefresh.current?.()}
              >
                <RefreshCw size={15} />
                重试
              </button>
            )}
          </div>
        )}
        {user ? (
          <form
            className="settings-form"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await client.saveSettings(values);
                dirtyFields.current.clear();
                setNotice("配置已保存");
              } catch (error) {
                setNotice(error instanceof Error ? error.message : "保存失败");
              }
            }}
          >
            <section className="settings-card">
              <div className="settings-card-heading">
                <span className="settings-card-icon" aria-hidden="true">
                  <ShieldCheck size={19} />
                </span>
                <div>
                  <h2>Huabot Token</h2>
                  <p>
                    Token
                    只加密保存于服务端。图像生成、商品分析和对话都会使用当前选择。
                  </p>
                </div>
              </div>
              <label>
                当前 Token
                <SettingsSelect
                  name="token_id"
                  value={values.token_id}
                  options={settings.tokens.map((token) => ({
                    value: token.id,
                    label: `${token.name} · 今日 ${formatTokenCost(token.today_cost)} · 累计 ${formatTokenCost(token.total_cost)}${token.status === 1 ? "" : " · 不可用"}`,
                    disabled: token.status !== 1,
                  }))}
                  disabled={!settingsReady}
                  onChange={(token_id) => {
                    dirtyFields.current.add("token_id");
                    setValues((current) => ({ ...current, token_id }));
                  }}
                />
              </label>
            </section>
            <section className="settings-card">
              <div className="settings-card-heading">
                <span
                  className="settings-card-icon settings-card-icon-violet"
                  aria-hidden="true"
                >
                  <Sparkles size={19} />
                </span>
                <div>
                  <h2>模型分配</h2>
                  <p>为每种创作任务指定可用模型，未加载完成时不会提交配置。</p>
                </div>
              </div>
              <div className="form-grid">
                {[
                  ["image_model", "图像生成模型", values.image_model],
                  ["text_model", "商品分析模型", values.text_model],
                  ["chat_model", "创作对话模型", values.chat_model],
                ].map(([name, label, value]) => (
                  <label key={name}>
                    {label}
                    <SettingsSelect
                      name={name}
                      value={value}
                      options={(name === "image_model"
                        ? imageModels
                        : models
                      ).map((model) => ({
                        value: model.id,
                        label: model.name,
                      }))}
                      disabled={!modelsReady || models.length === 0}
                      onChange={(nextValue) => {
                        const field = name as keyof SettingsValues;
                        dirtyFields.current.add(field);
                        setValues((current) => ({
                          ...current,
                          [field]: nextValue,
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </section>
            <button
              className="create-button settings-save"
              disabled={!canSave}
            >
              <Settings size={18} />
              保存配置
            </button>
          </form>
        ) : (
          <section className="settings-card">
            <div className="settings-card-heading">
              <span className="settings-card-icon" aria-hidden="true">
                <ShieldCheck size={19} />
              </span>
              <div>
                <h2>Huabot AI 授权</h2>
                <p>
                  本地功能无需登录。使用图片生成、商品分析、AI
                  换装或对话时才需要获取 Token。
                </p>
              </div>
            </div>
            <button
              className="button primary"
              type="button"
              onClick={() => requireAiAuth()}
            >
              登录并获取 Token
            </button>
          </section>
        )}
        <section className="settings-card settings-appearance">
          <div className="settings-card-heading">
            <span
              className="settings-card-icon settings-card-icon-violet"
              aria-hidden="true"
            >
              <Settings size={19} />
            </span>
            <div>
              <h2>外观主题</h2>
              <p>选择界面配色。跟随系统时，会随设备的浅色或深色模式自动切换。</p>
            </div>
          </div>
          <label>
            主题
            <SettingsSelect
              name="theme"
              value={themePreference}
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
              onChange={(value) =>
                setThemePreference(
                  value as "system" | "light" | "dark",
                )
              }
            />
          </label>
        </section>
        <section className="settings-storage settings-card">
          <div className="settings-card-heading">
            <span
              className="settings-card-icon settings-card-icon-storage"
              aria-hidden="true"
            >
              <Database size={19} />
            </span>
            <div>
              <h2>本地存储</h2>
              <p>
                项目、登录信息、上传参考图和生成图片均保存在此目录。切换时会自动迁移全部数据。
              </p>
            </div>
          </div>
          <div className="settings-storage-action">
            <code className="settings-storage-path">
              {storage?.pending_path ??
                storage?.current_path ??
                "正在读取存储位置..."}
            </code>
            <button
              className="settings-storage-button"
              type="button"
              disabled={migratingStorage || storage?.restart_required}
              onClick={async () => {
                setMigratingStorage(true);
                try {
                  const result = await client.chooseStorageDirectory();
                  if (result.cancelled) return;
                  setStorage(result);
                  setNotice("数据已迁移完成，请重启应用后使用新目录。");
                } catch (error) {
                  setNotice(
                    error instanceof Error ? error.message : "迁移存储目录失败",
                  );
                } finally {
                  setMigratingStorage(false);
                }
              }}
            >
              {migratingStorage ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <FolderOpen size={17} />
              )}
              {migratingStorage ? "正在迁移..." : "选择目录并迁移"}
            </button>
          </div>
          {storage?.restart_required && (
            <p className="settings-storage-restart">
              迁移完成，请重启应用后生效。
            </p>
          )}
        </section>
        {user && (
          <section className="settings-logout settings-card">
            <div className="settings-card-heading">
              <span
                className="settings-card-icon settings-card-icon-warm"
                aria-hidden="true"
              >
                <LogOut size={19} />
              </span>
              <div>
                <h2>账户</h2>
                <p>退出只会停用 AI 能力，本地项目和素材仍可继续使用。</p>
              </div>
            </div>
            <div className="settings-logout-action">
              <LogoutButton className="settings-logout-button">
                <LogOut size={17} />
                退出登录
              </LogoutButton>
            </div>
          </section>
        )}
      </div>
      {notice && <Notice text={notice} onClose={() => setNotice("")} />}
    </Shell>
  );
}
