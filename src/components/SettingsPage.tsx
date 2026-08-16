import { useEffect, useState } from "react";
import { LoaderCircle, Settings } from "lucide-react";
import { client } from "../api";
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
      <div className="topbar">
        <strong>设置</strong>
      </div>
      <div className="page settings-page">
        <span className="eyebrow">HUABOT TOKEN BASE</span>
        <h1>设置</h1>
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
          <section>
            <h2>选择 huabot Token</h2>
            <p>
              Token
              只加密保存于服务端。图像生成、商品分析和对话都会使用当前选择。
            </p>
            <label>
              Token
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
          <section>
            <h2>模型分配</h2>
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
          <button className="create-button" disabled={!modelsReady}>
            <Settings size={18} />
            保存配置
          </button>
        </form>
      </div>
      {notice && <Notice text={notice} onClose={() => setNotice("")} />}
    </Shell>
  );
}
