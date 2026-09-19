import { useEffect, useSyncExternalStore, useState } from "react";
import {
  LoaderCircle,
  LogOut,
  Database,
  FolderOpen,
  Settings,
  ShieldCheck,
  Sparkles,
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
  const [settings, setSettings] = useState<Awaited<
    ReturnType<typeof client.tokenSettings>
  > | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [values, setValues] = useState<SettingsValues | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [storage, setStorage] = useState<StorageLocation | null>(null);
  const [migratingStorage, setMigratingStorage] = useState(false);
  const themePreference = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
  );
  const imageModels = models.filter((model) =>
    model.id.startsWith("gpt-image-"),
  );
  useEffect(() => {
    if (!user) {
      setSettings(EMPTY_SETTINGS);
      setValues({
        token_id: "",
        image_model: "",
        text_model: "",
        chat_model: "",
      });
      setModels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    void Promise.allSettled([
      timeout(client.tokenSettings(), "桌面设置服务未响应"),
      timeout(client.models(), "桌面模型服务未响应"),
    ]).then(([settingsResult, modelsResult]) => {
      if (!active) return;
      const next =
        settingsResult.status === "fulfilled"
          ? settingsResult.value
          : EMPTY_SETTINGS;
      const nextModels =
        modelsResult.status === "fulfilled" ? modelsResult.value.models : [];
      const nextImageModels = nextModels.filter((model) =>
        model.id.startsWith("gpt-image-"),
      );
      setValues({
        token_id: next.active_token_id,
        image_model: nextImageModels.some(
          (model) => model.id === next.image_model,
        )
          ? next.image_model
          : nextImageModels[0]?.id || "",
        text_model: next.text_model,
        chat_model: next.chat_model,
      });
      setSettings(next);
      setModels(nextModels);
      if (
        settingsResult.status === "rejected" ||
        modelsResult.status === "rejected"
      ) {
        const error =
          settingsResult.status === "rejected"
            ? settingsResult.reason
            : modelsResult.status === "rejected"
              ? modelsResult.reason
              : undefined;
        setNotice(
          error instanceof Error ? error.message : "部分设置暂时无法读取",
        );
      }
      setLoading(false);
    });
    return () => {
      active = false;
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
  if (user && loading)
    return (
      <Shell>
        <div className="loading-page">
          <LoaderCircle className="spin" size={28} />
          加载设置...
        </div>
      </Shell>
    );
  if (user && (!settings || !values)) return null;
  const resolvedSettings = settings ?? EMPTY_SETTINGS;
  const resolvedValues = values ?? {
    token_id: "",
    image_model: "",
    text_model: "",
    chat_model: "",
  };
  const modelsReady = models.length > 0;
  return (
    <Shell>
      <div className="page settings-page">
        <header className="settings-intro">
          <span className="eyebrow">HUABOT TOKEN BASE</span>
          <h1>工作台设置</h1>
          <p>管理创作所使用的 Token 与模型配置，变更会在保存后生效。</p>
        </header>
        {user ? (
          <form
            className="settings-form"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await client.saveSettings(resolvedValues);
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
                  value={resolvedValues.token_id}
                  options={resolvedSettings.tokens.map((token) => ({
                    value: token.id,
                    label: `${token.name} · 今日 ${token.today_cost} · 累计 ${token.total_cost}${token.status === 1 ? "" : " · 不可用"}`,
                    disabled: token.status !== 1,
                  }))}
                  onChange={(token_id) =>
                    setValues((current) => current && { ...current, token_id })
                  }
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
                  ["image_model", "图像生成模型", resolvedValues.image_model],
                  ["text_model", "商品分析模型", resolvedValues.text_model],
                  ["chat_model", "创作对话模型", resolvedValues.chat_model],
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
                      disabled={!modelsReady}
                      onChange={(nextValue) =>
                        setValues((current) =>
                          current ? { ...current, [name]: nextValue } : current,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </section>
            <button
              className="create-button settings-save"
              disabled={!modelsReady}
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
