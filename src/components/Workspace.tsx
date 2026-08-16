import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Eye,
  ImagePlus,
  LoaderCircle,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { client } from "../api";
import { Notice } from "./Notice";
import { Shell } from "./Shell";
import { useAppStore } from "../store";
import type { Asset, Project } from "../types";
import { fileUrl, isPending, statusText } from "../utils/assets";
import "./Workspace.css";

const GENERATION_ESTIMATE_SECONDS = 60;

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function Workspace() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const templates = useAppStore((state) => state.templates);
  const [project, setProject] = useState<Project | null>(null);
  const [assetId, setAssetId] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [originalOpen, setOriginalOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const promptRef = useRef<HTMLTextAreaElement>(null);
  async function load() {
    try {
      const next = await client.project(id);
      setProject(next);
      setAssetId((current) =>
        next.assets?.some((asset) => asset.id === current)
          ? current
          : next.assets?.[0]?.id || "",
      );
    } catch {
      navigate("/");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  useEffect(() => {
    if (!project?.assets?.some((asset) => isPending(asset.status))) return;
    const timer = window.setInterval(() => void load(), 2400);
    return () => window.clearInterval(timer);
  }, [project?.assets?.map((asset) => asset.status).join("|")]);
  const generatingAsset = project?.assets?.find(
    (item) => item.id === assetId && item.status === "generating",
  );
  useEffect(() => {
    if (!generatingAsset?.generation_started_at) return;
    const updateNow = () => setNow(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, [generatingAsset?.generation_started_at]);
  useEffect(() => {
    setOriginalOpen(false);
  }, [assetId]);
  useEffect(() => {
    if (!originalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOriginalOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [originalOpen]);
  if (loading || !project)
    return (
      <Shell>
        <div className="loading-page">
          <LoaderCircle className="spin" size={28} />
          加载项目...
        </div>
      </Shell>
    );
  const currentProject = project;
  const asset = currentProject.assets?.find((item) => item.id === assetId);
  const elapsedSeconds =
    asset?.status === "generating" && asset.generation_started_at
      ? Math.max(0, Math.floor(now / 1000 - asset.generation_started_at))
      : null;
  const remainingSeconds =
    elapsedSeconds === null
      ? null
      : GENERATION_ESTIMATE_SECONDS -
        (elapsedSeconds % GENERATION_ESTIMATE_SECONDS);
  const cycleProgress =
    elapsedSeconds === null
      ? 0
      : (elapsedSeconds % GENERATION_ESTIMATE_SECONDS) /
        GENERATION_ESTIMATE_SECONDS;
  async function updateAsset(patch: Partial<Asset>) {
    if (!asset) return;
    await client.updateAsset(asset.id, patch);
    await load();
  }
  async function generate(one = true) {
    try {
      if (one && asset) await client.generateAsset(asset.id);
      else await client.generatePack(currentProject.id);
      await load();
      setNotice(one ? "已加入生成队列" : "全部画面已加入生成队列");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "生成失败");
    }
  }
  async function rebuildPrompt() {
    if (!asset) return;
    try {
      const result = await client.resetPrompt(asset.id);
      await updateAsset({ prompt: result.prompt });
      setNotice("已生成提示词");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "生成提示词失败");
    }
  }
  return (
    <Shell>
      <div className="workspace-header">
        <button className="back-link" onClick={() => navigate("/")}>
          <ArrowLeft size={17} />
          创作台
        </button>
        <div>
          <span className="eyebrow">E-commerce visuals</span>
          <h1>{project.name}</h1>
        </div>
        <button
          className="button primary"
          disabled={project.assets?.some((item) => isPending(item.status))}
          onClick={() => void generate(false)}
        >
          <Sparkles size={18} />
          生成全部
        </button>
      </div>
      <div className="workspace">
        <aside className="sequence">
          <div className="sequence-head">
            <span>画面序列</span>
            <small>{project.assets?.length || 0} 张</small>
          </div>
          {project.assets?.map((item, index) => (
            <button
              className={`sequence-item ${item.id === assetId ? "active" : ""}`}
              onClick={() => setAssetId(item.id)}
              key={item.id}
            >
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span>
                <strong>{item.title.replace(/^\w+\s·\s/, "")}</strong>
                <small>
                  {item.ratio} · {statusText(item.status)}
                </small>
              </span>
              {item.file_path ? (
                <img src={fileUrl(item.file_path)} alt="" />
              ) : (
                <i />
              )}
            </button>
          ))}
        </aside>
        {asset ? (
          <>
            <section className="stage">
              <header>
                <div>
                  <h2>{asset.title}</h2>
                </div>
                <div>
                  <button
                    className="button secondary"
                    onClick={() => void rebuildPrompt()}
                  >
                    <WandSparkles size={16} />
                    生成提示词
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      setNotice(
                        asset.prompt.trim().length >= 20
                          ? "Prompt 检查完成"
                          : "Prompt 内容过短，请先生成提示词",
                      )
                    }
                  >
                    Prompt 检查
                  </button>
                  <button
                    className="button primary"
                    disabled={isPending(asset.status)}
                    onClick={() => void generate()}
                  >
                    {isPending(asset.status) && (
                      <LoaderCircle className="spin" size={16} />
                    )}
                    {asset.status === "ready" ? "创建新版本" : "生成画面"}
                  </button>
                  <button
                    className="icon-button original-preview-button"
                    type="button"
                    disabled={!asset.file_path}
                    onClick={() => setOriginalOpen(true)}
                    aria-label="查看原图"
                    title="查看原图"
                  >
                    <Eye size={17} />
                  </button>
                </div>
              </header>
              <div
                className={`artboard ${asset.file_path ? "with-image" : ""}`}
              >
                {asset.file_path ? (
                  <img src={fileUrl(asset.file_path)} alt={asset.title} />
                ) : (
                  <div className="artboard-empty">
                    {asset.status === "generating" &&
                    elapsedSeconds !== null &&
                    remainingSeconds !== null ? (
                      <>
                        <Sparkles className="generation-sparkle" size={38} />
                        <h3>正在构建画面</h3>
                        <div
                          className="generation-progress"
                          role="progressbar"
                          aria-label="生成预计进度"
                          aria-valuemin={0}
                          aria-valuemax={GENERATION_ESTIMATE_SECONDS}
                          aria-valuenow={Math.floor(
                            cycleProgress * GENERATION_ESTIMATE_SECONDS,
                          )}
                        >
                          <i
                            style={{ transform: `scaleX(${cycleProgress})` }}
                          />
                        </div>
                        <p className="generation-timing">
                          生成中 · 预计剩余 {formatDuration(remainingSeconds)} · 已用时 {elapsedSeconds} 秒
                        </p>
                        <p>确认右侧的创作方向后，开始生成第一版。</p>
                      </>
                    ) : (
                      <>
                        {isPending(asset.status) ? (
                          <LoaderCircle className="spin" size={36} />
                        ) : (
                          <ImagePlus size={38} />
                        )}
                        <h3>
                          {isPending(asset.status)
                            ? statusText(asset.status)
                            : "这个画面还未生成"}
                        </h3>
                        <p>
                          {asset.status.startsWith("failed")
                            ? asset.status
                            : "确认右侧的创作方向后，开始生成第一版。"}
                        </p>
                        {!isPending(asset.status) && (
                          <button
                            className="button primary"
                            onClick={() => void generate()}
                          >
                            生成第一版
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="variant-strip" aria-label="画面版本">
                <span>版本</span>
                {asset.file_path ? (
                  <>
                    <span className="variant active">
                    <img src={fileUrl(asset.file_path)} alt="当前版本" />
                    <b>当前</b>
                    </span>
                    <button
                      className="add-variant"
                      type="button"
                      onClick={() => void generate()}
                      aria-label="创建新版本"
                    >
                      +
                    </button>
                  </>
                ) : (
                  <span className="variant empty">
                    {isPending(asset.status)
                      ? statusText(asset.status)
                      : "等待第一版"}
                  </span>
                )}
              </div>
            </section>
            <aside className="controls">
              <div className="controls-head">
                <b>创作控制</b>
                <span>自动保存</span>
              </div>
              <label>
                场景模板
                <select
                  value={asset.template}
                  onChange={(event) =>
                    void updateAsset({ template: event.target.value })
                  }
                >
                  {templates.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>画面比例</legend>
                <div className="ratio-row">
                  {["1:1", "4:5", "2:3", "16:9"].map((ratio) => (
                    <button
                      key={ratio}
                      className={asset.ratio === ratio ? "active" : ""}
                      onClick={() => void updateAsset({ ratio })}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="style-lock">
                <i style={{ background: project.color }} />
                <div>
                  <b>品牌风格已锁定</b>
                  <span>柔和棚拍光 · 干净留白</span>
                </div>
              </div>
              <label>
                高级 Prompt
                <textarea
                  defaultValue={asset.prompt}
                  key={asset.id}
                  ref={promptRef}
                  onBlur={(event) =>
                    void updateAsset({ prompt: event.target.value })
                  }
                  rows={10}
                />
              </label>
              <button
                className="button secondary"
                onClick={() => {
                  void updateAsset({ prompt: promptRef.current?.value ?? asset.prompt });
                  setNotice("创作控制已保存");
                }}
              >
                <Copy size={16} />
                保存创作控制
              </button>
            </aside>
          </>
        ) : null}
      </div>
      {originalOpen && asset?.file_path && (
        <div
          className="original-preview-backdrop"
          role="presentation"
          onClick={() => setOriginalOpen(false)}
        >
          <section
            className="original-preview"
            role="dialog"
            aria-modal="true"
            aria-label={`${asset.title} 原图预览`}
            onClick={(event) => event.stopPropagation()}
          >
            <img src={fileUrl(asset.file_path)} alt={asset.title} />
            <button
              className="icon-button original-preview-close"
              type="button"
              onClick={() => setOriginalOpen(false)}
              aria-label="关闭原图预览"
              title="关闭"
            >
              <X size={20} />
            </button>
          </section>
        </div>
      )}
      {notice && <Notice text={notice} onClose={() => setNotice("")} />}
    </Shell>
  );
}
