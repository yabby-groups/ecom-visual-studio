import { useEffect, useState } from "react";
import {
  LoaderCircle,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { client } from "../api";
import type { TokenSettings } from "../types";
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
  const [settings, setSettings] = useState<Awaited<
    ReturnType<typeof client.tokenSettings>
  > | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [values, setValues] = useState<SettingsValues | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const imageModels = models.filter((model) =>
    model.id.startsWith("gpt-image-"),
  );
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      timeout(client.tokenSettings(), "桌面设置服务未响应"),
      timeout(client.models(), "桌面模型服务未响应"),
    ]).then(
      ([settingsResult, modelsResult]) => {
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
        if (settingsResult.status === "rejected" || modelsResult.status === "rejected") {
          const error =
            settingsResult.status === "rejected"
              ? settingsResult.reason
              : modelsResult.status === "rejected"
                ? modelsResult.reason
                : undefined;
          setNotice(error instanceof Error ? error.message : "部分设置暂时无法读取");
        }
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (loading)
    return (
      <Shell>
        <div className="loading-page">
          <LoaderCircle className="spin" size={28} />
          加载设置...
        </div>
      </Shell>
    );
  if (!settings || !values) return null;
  const modelsReady = models.length > 0;
  return (
    <Shell>
      <div className="page settings-page">
        <header className="settings-intro">
          <span className="eyebrow">HUABOT TOKEN BASE</span>
          <h1>工作台设置</h1>
          <p>管理创作所使用的 Token 与模型配置，变更会在保存后生效。</p>
        </header>
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await client.saveSettings(values);
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
                ["image_model", "图像生成模型", values.image_model],
                ["text_model", "商品分析模型", values.text_model],
                ["chat_model", "创作对话模型", values.chat_model],
              ].map(([name, label, value]) => (
                <label key={name}>
                  {label}
                  <SettingsSelect
                    name={name}
                    value={value}
                    options={(name === "image_model" ? imageModels : models).map(
                      (model) => ({ value: model.id, label: model.name }),
                    )}
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
              <p>退出后需要重新登录才能继续使用创作台。</p>
            </div>
          </div>
          <div className="settings-logout-action">
            <LogoutButton className="settings-logout-button">
              <LogOut size={17} />
              退出登录
            </LogoutButton>
          </div>
        </section>
      </div>
      {notice && <Notice text={notice} onClose={() => setNotice("")} />}
    </Shell>
  );
}
