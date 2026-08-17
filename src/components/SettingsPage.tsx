import { useEffect, useState } from "react";
import {
  LoaderCircle,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { client } from "../api";
import { LogoutButton } from "./LogoutButton";
import { Notice } from "./Notice";
import { Shell } from "./Shell";
import "./SettingsPage.css";

export function SettingsPage() {
  const [settings, setSettings] = useState<Awaited<
    ReturnType<typeof client.tokenSettings>
  > | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState("");
  const imageModels = models.filter((model) =>
    model.id.startsWith("gpt-image-"),
  );
  useEffect(() => {
    void client.models()
      .then(async (items) => {
        const next = await client.tokenSettings();
        setSettings(next);
        setModels(items.models);
      })
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : "无法读取设置"),
      );
  }, []);
  if (!settings)
    return (
      <Shell>
        <div className="loading-page">
          <LoaderCircle className="spin" size={28} />
          加载设置...
        </div>
      </Shell>
    );
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
            const data = new FormData(event.currentTarget);
            try {
              await client.saveSettings({
                token_id: String(data.get("token_id")),
                image_model: String(data.get("image_model")),
                text_model: String(data.get("text_model")),
                chat_model: String(data.get("chat_model")),
              });
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
                  Token 只加密保存于服务端。图像生成、商品分析和对话都会使用当前选择。
                </p>
              </div>
            </div>
            <label>
              当前 Token
              <select name="token_id" defaultValue={settings.active_token_id}>
                {settings.tokens.map((token) => (
                  <option
                    key={token.id}
                    value={token.id}
                    disabled={token.status !== 1}
                  >
                    {token.name} · 今日 {token.today_cost} · 累计{" "}
                    {token.total_cost}
                    {token.status === 1 ? "" : " · 不可用"}
                  </option>
                ))}
              </select>
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
                ["image_model", "图像生成模型", settings.image_model],
                ["text_model", "商品分析模型", settings.text_model],
                ["chat_model", "创作对话模型", settings.chat_model],
              ].map(([name, label, value]) => (
                <label key={name}>
                  {label}
                  <select
                    name={name}
                    defaultValue={
                      name === "image_model" &&
                      !imageModels.some((model) => model.id === value)
                        ? imageModels[0]?.id || ""
                        : value
                    }
                    disabled={!modelsReady}
                  >
                    {!modelsReady && <option value="">暂无可用模型</option>}
                    {(name === "image_model" ? imageModels : models).map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
          <button className="create-button settings-save" disabled={!modelsReady}>
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
