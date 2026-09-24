import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Eye,
  ImagePlus,
  LoaderCircle,
  Plus,
  Save,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import { useAiInteraction } from "../aiInteraction";
import { imageRatioLabel } from "../constants/imageSizes";
import { ImageRatioPicker } from "./ImageRatioPicker";
import { Notice } from "./Notice";
import { Shell } from "./Shell";
import { useAppStore } from "../store";
import type { Asset, Project } from "../types";
import { failureReason, fileUrl, isPending, statusText } from "../utils/assets";
import "./Workspace.css";

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatGeneratedAt(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const datePart = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  const timePart = [date.getHours(), date.getMinutes()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return `${datePart} ${timePart}`;
}

export function Workspace() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const requireAiAuth = useRequireAiAuth();
  const { registerPage } = useAiInteraction();
  const templates = useAppStore((state) => state.templates);
  const [project, setProject] = useState<Project | null>(null);
  const [assetId, setAssetId] = useState("");
  const [notice, setNotice] = useState<{
    text: string;
    autoCloseMs?: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [originalOpen, setOriginalOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [addingAsset, setAddingAsset] = useState(false);
  const [selectedVersionPath, setSelectedVersionPath] = useState<string | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const shownFailureRef = useRef("");
  function showNotice(text: string, autoCloseMs?: number | null) {
    setNotice({ text, autoCloseMs });
  }
  async function load(selectedAssetId?: string) {
    try {
      const next = await client.project(id);
      setProject(next);
      setLoadError("");
      setAssetId((current) =>
        selectedAssetId &&
        next.assets?.some((asset) => asset.id === selectedAssetId)
          ? selectedAssetId
          : next.assets?.some((asset) => asset.id === current)
            ? current
            : next.assets?.[0]?.id || "",
      );
    } catch (reason) {
      setLoadError(
        reason instanceof Error ? reason.message : "无法读取项目，请重试",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(
    () =>
      registerPage({
        screen: "项目工作区",
        data: () => ({
          project: project
            ? {
                id: project.id,
                name: project.name,
                product: project.product,
                description: project.description,
                benefits: project.benefits,
                assets: project.assets?.map((item) => ({
                  id: item.id,
                  title: item.title,
                  template: item.template,
                  ratio: item.ratio,
                  prompt: item.prompt,
                  status: item.status,
                })),
              }
            : null,
          selected_asset_id: assetId,
        }),
        refresh: () => load(),
      }),
    [assetId, project, registerPage],
  );
  useEffect(() => {
    void load();
  }, [id]);
  useEffect(() => {
    if (!project?.assets?.some((asset) => isPending(asset.status))) return;
    const timer = window.setInterval(() => void load(), 2400);
    return () => window.clearInterval(timer);
  }, [project?.assets?.map((asset) => asset.status).join("|")]);
  useEffect(() => {
    const failures = project?.assets?.filter((item) =>
      item.status.startsWith("failed"),
    );
    const failureKey =
      failures?.map((item) => `${item.id}:${item.status}`).join("|") ?? "";
    if (!failureKey) {
      shownFailureRef.current = "";
      return;
    }
    if (failureKey === shownFailureRef.current) return;
    shownFailureRef.current = failureKey;
    const message = failureReason(failures?.[0]?.status ?? "failed");
    showNotice(`图片生成失败：${message}`, null);
  }, [
    project?.assets?.map((asset) => `${asset.id}:${asset.status}`).join("|"),
  ]);
  const pendingAsset = project?.assets?.find(
    (item) => item.id === assetId && isPending(item.status),
  );
  useEffect(() => {
    if (!pendingAsset?.generation_started_at) return;
    const updateNow = () => setNow(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, [pendingAsset?.generation_started_at]);
  useEffect(() => {
    setOriginalOpen(false);
    setReferenceOpen(false);
    setSelectedVersionPath(null);
  }, [assetId]);
  useEffect(() => {
    if (!originalOpen && !referenceOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOriginalOpen(false);
        setReferenceOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [originalOpen, referenceOpen]);
  if (loading)
    return (
      <Shell>
        <div className="loading-page">
          <LoaderCircle className="spin" size={28} />
          加载项目...
        </div>
      </Shell>
    );
  if (!project)
    return (
      <Shell>
        <div className="loading-page">
          <p>{loadError || "无法读取项目"}</p>
          <button
            className="button primary"
            type="button"
            onClick={() => void load()}
          >
            重试
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => navigate("/")}
          >
            返回创作台
          </button>
        </div>
      </Shell>
    );
  const currentProject = project;
  const asset = currentProject.assets?.find((item) => item.id === assetId);
  const versions = asset?.versions ?? [];
  const displayedPath = selectedVersionPath ?? asset?.file_path ?? null;
  const displayedVersion = versions.find(
    (version) => version.file_path === displayedPath,
  );
  const displayedGenerationDuration =
    displayedVersion?.generation_started_at === null || !displayedVersion
      ? null
      : Math.max(
          0,
          displayedVersion.created_at - displayedVersion.generation_started_at,
        );
  const elapsedSeconds =
    asset && isPending(asset.status) && asset.generation_started_at
      ? Math.max(0, Math.floor(now / 1000 - asset.generation_started_at))
      : null;
  const showGenerationProgress =
    isPending(asset?.status ?? "") && elapsedSeconds !== null;
  async function updateAsset(patch: Partial<Asset>) {
    if (!asset) return;
    await client.updateAsset(asset.id, patch);
    await load();
  }
  async function savePrompt() {
    try {
      await updateAsset({
        prompt: promptRef.current?.value ?? asset?.prompt ?? "",
      });
      showNotice("提示词已保存");
    } catch (reason) {
      showNotice(
        reason instanceof Error ? reason.message : "保存提示词失败",
        null,
      );
    }
  }
  async function generate(one = true) {
    if (!requireAiAuth()) return;
    try {
      if (one) setSelectedVersionPath(null);
      if (one && asset) await client.generateAsset(asset.id);
      else await client.generatePack(currentProject.id);
      await load();
      showNotice(one ? "已加入生成队列" : "全部画面已加入生成队列", 2000);
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : "生成失败", null);
    }
  }
  async function rebuildPrompt() {
    if (!asset) return;
    try {
      const result = await client.resetPrompt(asset.id);
      await updateAsset({ prompt: result.prompt });
      showNotice("已生成提示词");
    } catch (reason) {
      showNotice(
        reason instanceof Error ? reason.message : "生成提示词失败",
        null,
      );
    }
  }
  async function downloadAsset() {
    if (!displayedPath) return;
    try {
      if (await client.downloadAsset(displayedPath)) {
        showNotice("图片已导出");
      }
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : "导出失败", null);
    }
  }
  function openAddAsset() {
    setTemplateId(templates[0]?.id ?? "");
    setAddAssetOpen(true);
  }
  async function addAsset() {
    if (!templateId) return;
    setAddingAsset(true);
    try {
      const result = await client.addAsset(currentProject.id, templateId);
      await load(result.id);
      setAddAssetOpen(false);
      showNotice("已添加画面", 2000);
    } catch (reason) {
      showNotice(
        reason instanceof Error ? reason.message : "添加画面失败",
        null,
      );
    } finally {
      setAddingAsset(false);
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
          <span className="eyebrow">项目工作区</span>
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
            <div>
              <small>{project.assets?.length || 0} 张</small>
              <button
                className="sequence-add"
                type="button"
                onClick={openAddAsset}
                aria-label="添加画面"
                title="添加画面"
              >
                <Plus size={14} />
              </button>
            </div>
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
                  {imageRatioLabel(item.ratio)} · {statusText(item.status)}
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
              </header>
              <div className={`artboard ${displayedPath ? "with-image" : ""}`}>
                {displayedPath && (
                  <button
                    className="workspace-result-preview"
                    type="button"
                    onClick={() => setOriginalOpen(true)}
                    aria-label="查看生成大图"
                  >
                    <img src={fileUrl(displayedPath)} alt={asset.title} />
                  </button>
                )}
                {showGenerationProgress ? (
                  <div
                    className={`artboard-empty ${displayedPath ? "generation-overlay" : ""}`}
                  >
                    <Sparkles className="generation-sparkle" size={38} />
                    <h3>正在构建画面</h3>
                    <div className="generation-progress" aria-hidden="true">
                      <i />
                    </div>
                    <p className="generation-timing">
                      生成中 · 已用时 {formatDuration(elapsedSeconds!)}
                    </p>
                  </div>
                ) : !displayedPath ? (
                  <div className="artboard-empty">
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
                    {asset.status.startsWith("failed") && (
                      <p>{failureReason(asset.status)}</p>
                    )}
                    {!isPending(asset.status) && (
                      <button
                        className="button primary"
                        onClick={() => void generate()}
                      >
                        生成第一版
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              {displayedVersion && (
                <p className="generation-completed-at">
                  生成于 {formatGeneratedAt(displayedVersion.created_at)}
                  {displayedGenerationDuration !== null &&
                    ` · 耗时 ${formatDuration(displayedGenerationDuration)}`}
                </p>
              )}
              <div className="variant-strip" aria-label="画面版本">
                <span>版本</span>
                {versions.length ? (
                  <>
                    {versions.map((version, index) => {
                      const active = version.file_path === displayedPath;
                      const current = version.file_path === asset.file_path;
                      return (
                        <button
                          className={`variant ${active ? "active" : ""}`}
                          type="button"
                          onClick={() =>
                            setSelectedVersionPath(version.file_path)
                          }
                          key={version.id}
                          aria-label={`查看${current ? "当前" : `历史 ${versions.length - index}`}版本`}
                          title={`生成于 ${formatGeneratedAt(version.created_at)}`}
                        >
                          <img src={fileUrl(version.file_path)} alt="" />
                          <span className="variant-meta">
                            <b>
                              {current ? "当前" : `v${versions.length - index}`}
                            </b>
                          </span>
                        </button>
                      );
                    })}
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
              <div className="workspace-actions" aria-label="画面操作">
                {displayedPath && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void downloadAsset()}
                  >
                    <Download size={16} />
                    导出
                  </button>
                )}
                <button
                  className="button secondary"
                  type="button"
                  disabled={!project.reference}
                  onClick={() => setReferenceOpen(true)}
                >
                  <Eye size={16} />
                  参考图
                </button>
                <button
                  className="button secondary"
                  onClick={() => void rebuildPrompt()}
                >
                  <WandSparkles size={16} />
                  根据模板重写提示词
                </button>
                <button
                  className="button primary workspace-generate-button"
                  type="button"
                  disabled={isPending(asset.status)}
                  onClick={() => void generate()}
                >
                  {isPending(asset.status) && (
                    <LoaderCircle className="spin" size={16} />
                  )}
                  {asset.status === "ready" ? "创建新版本" : "生成画面"}
                </button>
              </div>
              <div className="controls-head">
                <b>画面设置</b>
                <span>模板与比例自动保存</span>
              </div>
              <label>
                场景模板
                <span className="workspace-template-select">
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
                  <ChevronDown size={16} aria-hidden="true" />
                </span>
                <small>
                  更换模板后，可点击“根据模板重写提示词”应用模板说明。
                </small>
              </label>
              <fieldset>
                <legend>画面比例</legend>
                <ImageRatioPicker
                  key={asset.id}
                  value={asset.ratio}
                  onChange={(ratio) =>
                    void updateAsset({ ratio }).catch((reason) =>
                      showNotice(
                        reason instanceof Error
                          ? reason.message
                          : "保存画面比例失败",
                        null,
                      ),
                    )
                  }
                />
              </fieldset>
              <div className="style-lock">
                <i style={{ background: project.color }} />
                <div>
                  <b>项目品牌色</b>
                  <span>{project.color || "未设置"} · 生成时作为配色参考</span>
                </div>
              </div>
              <label>
                画面提示词
                <textarea
                  defaultValue={asset.prompt}
                  key={asset.id}
                  ref={promptRef}
                  rows={10}
                />
              </label>
              <button
                className="button secondary"
                onClick={() => void savePrompt()}
              >
                <Save size={16} />
                保存提示词
              </button>
            </aside>
          </>
        ) : null}
      </div>
      {addAssetOpen && (
        <div
          className="add-asset-backdrop"
          role="presentation"
          onClick={() => !addingAsset && setAddAssetOpen(false)}
        >
          <section
            className="add-asset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-asset-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="add-asset-dialog-head">
              <div>
                <span className="eyebrow">新画面</span>
                <h2 id="add-asset-title">添加画面</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setAddAssetOpen(false)}
                disabled={addingAsset}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <label>
              选择场景模板
              <span className="add-asset-select">
                <select
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  {templates.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.ratio}
                    </option>
                  ))}
                </select>
                <ChevronDown size={18} aria-hidden="true" />
              </span>
            </label>
            <p>画面将追加到序列末尾，随后可编辑提示词并单独生成。</p>
            <div className="add-asset-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setAddAssetOpen(false)}
                disabled={addingAsset}
              >
                取消
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() => void addAsset()}
                disabled={!templateId || addingAsset}
              >
                {addingAsset && <LoaderCircle className="spin" size={16} />}
                确认添加
              </button>
            </div>
          </section>
        </div>
      )}
      {originalOpen && asset && displayedPath && (
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
            <img src={fileUrl(displayedPath)} alt={asset.title} />
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
      {referenceOpen && project.reference && (
        <div
          className="original-preview-backdrop"
          role="presentation"
          onClick={() => setReferenceOpen(false)}
        >
          <section
            className="original-preview"
            role="dialog"
            aria-modal="true"
            aria-label={`${project.name} 参考原图预览`}
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={fileUrl(project.reference)}
              alt={`${project.name} 参考原图`}
            />
            <button
              className="icon-button original-preview-close"
              type="button"
              onClick={() => setReferenceOpen(false)}
              aria-label="关闭参考原图预览"
              title="关闭"
            >
              <X size={20} />
            </button>
          </section>
        </div>
      )}
      {notice && (
        <Notice
          text={notice.text}
          autoCloseMs={notice.autoCloseMs}
          onClose={() => setNotice(null)}
        />
      )}
    </Shell>
  );
}
