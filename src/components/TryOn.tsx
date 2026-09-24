import {
  Download,
  Eye,
  FolderOpen,
  ImagePlus,
  Link2,
  LoaderCircle,
  RefreshCw,
  Shirt,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import { useAiInteraction } from "../aiInteraction";
import { imageRatioLabel } from "../constants/imageSizes";
import type { TryOnJob } from "../types";
import { fileUrl, isPending, statusText } from "../utils/assets";
import { ImageRatioPicker } from "./ImageRatioPicker";
import { Shell } from "./Shell";
import "./TryOn.css";
import "./Workspace.css";

const HISTORY_PAGE_SIZE = 12;
const TRY_ON_DRAFT = "frameboard:try-on-draft";

type TryOnDraft = {
  personPaths: string[];
  garmentPaths: string[];
  generationMode: "combined" | "combinations";
  instructions: string;
  ratio: string;
  consented: boolean;
};

function loadDraft(): TryOnDraft | null {
  try {
    return JSON.parse(sessionStorage.getItem(TRY_ON_DRAFT) || "null");
  } catch {
    return null;
  }
}

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

function tryOnFailureReason(status: string) {
  return status.replace(/^failed(?::\s*)?/, "").trim() || "请重试。";
}

type ReferenceSlotProps = {
  title: string;
  hint: string;
  paths: string[];
  loading: boolean;
  error?: string;
  onUpload: () => void;
  onImport: (url: string) => void;
  onRemove: (path: string) => void;
};

function ReferenceSlot({
  title,
  hint,
  paths,
  loading,
  error,
  onUpload,
  onImport,
  onRemove,
}: ReferenceSlotProps) {
  const [source, setSource] = useState<"upload" | "url">("upload");
  const [url, setUrl] = useState("");
  return (
    <section className="try-on-reference">
      <div className="try-on-reference-head">
        <b>{title}</b>
        <small>{hint}</small>
      </div>
      <div
        className="try-on-source-tabs"
        role="group"
        aria-label={`${title}来源`}
      >
        <button
          type="button"
          className={source === "upload" ? "active" : ""}
          aria-pressed={source === "upload"}
          onClick={() => setSource("upload")}
        >
          <FolderOpen size={13} /> 本机图片
        </button>
        <button
          type="button"
          className={source === "url" ? "active" : ""}
          aria-pressed={source === "url"}
          onClick={() => setSource("url")}
        >
          <Link2 size={13} /> 图片链接
        </button>
      </div>
      <div className="try-on-reference-images" aria-label={`${title}图片列表`}>
        {paths.map((path, index) => (
          <div className="try-on-reference-thumbnail" key={path}>
            <img src={fileUrl(path)} alt={`${title} ${index + 1}`} />
            {index === 0 && <span>首张</span>}
            <button
              type="button"
              onClick={() => onRemove(path)}
              aria-label={`移除${title} ${index + 1}`}
              title="移除图片"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {source === "upload" ? (
        <button
          type="button"
          className="try-on-upload"
          disabled={loading || paths.length >= 4}
          onClick={onUpload}
        >
          <ImagePlus size={28} />
          <b>{paths.length ? "添加更多图片" : "选择图片"}</b>
          <span>
            已添加 {paths.length}/4 张 · JPG、PNG、WebP · 每张最多 15 MB
          </span>
          {loading && (
            <span className="try-on-upload-loading">
              <LoaderCircle className="spin" size={22} /> 上传中
            </span>
          )}
        </button>
      ) : (
        <div className="try-on-url-import">
          <Link2 size={24} />
          <b>导入图片链接</b>
          <span>请使用无需登录的图片链接，图片将保存到本机。</span>
          <span>已添加 {paths.length}/4 张 · 每张不超过 15 MB</span>
          <input
            type="url"
            value={url}
            disabled={loading || paths.length >= 4}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/image.jpg"
          />
          <button
            type="button"
            className="button secondary"
            disabled={loading || paths.length >= 4 || !url.trim()}
            onClick={() => onImport(url.trim())}
          >
            {loading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Link2 size={16} />
            )}
            {error ? "重试导入" : "导入图片"}
          </button>
          {error && (
            <p className="try-on-url-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function TryOn() {
  const [draft] = useState(loadDraft);
  const navigate = useNavigate();
  const requireAiAuth = useRequireAiAuth();
  const { registerPage } = useAiInteraction();
  const { id: selectedJobId } = useParams<{ id: string }>();
  const [personPaths, setPersonPaths] = useState<string[]>(
    draft?.personPaths ?? [],
  );
  const [garmentPaths, setGarmentPaths] = useState<string[]>(
    draft?.garmentPaths ?? [],
  );
  const [generationMode, setGenerationMode] = useState<
    "combined" | "combinations"
  >(draft?.generationMode ?? "combined");
  const [instructions, setInstructions] = useState(draft?.instructions ?? "");
  const [ratio, setRatio] = useState(draft?.ratio ?? "2:3");
  const [consented, setConsented] = useState(draft?.consented ?? false);
  const [uploading, setUploading] = useState<"person" | "garment" | "">("");
  const [importErrors, setImportErrors] = useState({ person: "", garment: "" });
  const [jobs, setJobs] = useState<TryOnJob[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [originalsOpen, setOriginalsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [selectedVersionPath, setSelectedVersionPath] = useState<string | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(
    () =>
      registerPage({
        screen: "AI 换装",
        data: () => ({
          selected_job_id: selectedJobId || undefined,
          draft: {
            person_paths: personPaths,
            garment_paths: garmentPaths,
            generation_mode: generationMode,
            instructions,
            ratio,
            consented,
          },
          recent_jobs: jobs.map((job) => ({
            id: job.id,
            status: job.status,
            ratio: job.ratio,
          })),
        }),
        refresh: () => load(),
        execute: (action) => {
          if (action.type !== "fill_draft") return false;
          const payload = action.payload;
          if (Array.isArray(payload.person_paths)) {
            setPersonPaths(
              payload.person_paths.filter(
                (path): path is string => typeof path === "string",
              ),
            );
          }
          if (Array.isArray(payload.garment_paths)) {
            setGarmentPaths(
              payload.garment_paths.filter(
                (path): path is string => typeof path === "string",
              ),
            );
          }
          if (
            payload.generation_mode === "combined" ||
            payload.generation_mode === "combinations"
          ) {
            setGenerationMode(payload.generation_mode);
          }
          if (typeof payload.instructions === "string")
            setInstructions(payload.instructions);
          if (typeof payload.ratio === "string") setRatio(payload.ratio);
          return true;
        },
      }),
    [
      consented,
      garmentPaths,
      generationMode,
      instructions,
      jobs,
      personPaths,
      ratio,
      registerPage,
      selectedJobId,
    ],
  );

  async function load(page = historyPage) {
    try {
      const history = await client.tryOnJobs(
        HISTORY_PAGE_SIZE,
        (page - 1) * HISTORY_PAGE_SIZE,
      );
      setJobs(history.items);
      setHistoryTotal(history.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载换装记录");
    }
  }
  const selectedJob = selectedJobId
    ? jobs.find((job) => job.id === selectedJobId)
    : undefined;
  const pendingJob =
    selectedJob && isPending(selectedJob.status) ? selectedJob : null;
  useEffect(() => {
    void load();
  }, [historyPage]);
  useEffect(() => {
    if (!selectedJob || !isPending(selectedJob.status)) return;
    const refreshSelectedJob = async () => {
      try {
        const job = await client.tryOnJob(selectedJob.id);
        setJobs((current) =>
          current.map((item) => (item.id === job.id ? job : item)),
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法刷新换装任务");
      }
    };
    const timer = window.setInterval(() => void refreshSelectedJob(), 2400);
    return () => window.clearInterval(timer);
  }, [selectedJob]);
  useEffect(() => {
    if (!selectedJobId || selectedJob) return;
    let active = true;
    void client
      .tryOnJob(selectedJobId)
      .then((job) => {
        if (!active) return;
        setJobs((current) => [
          job,
          ...current.filter((item) => item.id !== job.id),
        ]);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "无法加载换装任务");
        navigate("/try-on", { replace: true });
      });
    return () => {
      active = false;
    };
  }, [navigate, selectedJob, selectedJobId]);
  useEffect(() => {
    if (!selectedJob) return;
    setSelectedVersionPath(null);
    setPersonPaths(selectedJob.person_paths);
    setGarmentPaths(selectedJob.garment_paths);
    setGenerationMode(selectedJob.generation_mode);
    setInstructions(selectedJob.instructions);
    setRatio(selectedJob.ratio);
  }, [selectedJob?.id]);

  function beginDraft() {
    if (selectedJobId) navigate("/try-on");
  }

  function startNewDraft() {
    navigate("/try-on");
    setPersonPaths([]);
    setGarmentPaths([]);
    setImportErrors({ person: "", garment: "" });
    setGenerationMode("combined");
    setInstructions("");
    setRatio("2:3");
    setConsented(false);
  }

  async function upload(slot: "person" | "garment") {
    beginDraft();
    setImportErrors((errors) => ({ ...errors, [slot]: "" }));
    setError("");
    setUploading(slot);
    try {
      const { path } = await client.pickImage();
      if (slot === "person") setPersonPaths((paths) => [...paths, path]);
      else setGarmentPaths((paths) => [...paths, path]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "选择图片失败");
    } finally {
      setUploading("");
    }
  }

  async function importUrl(slot: "person" | "garment", url: string) {
    beginDraft();
    setImportErrors((errors) => ({ ...errors, [slot]: "" }));
    setError("");
    setUploading(slot);
    try {
      const { path } = await client.importUrl(url);
      if (slot === "person") setPersonPaths((paths) => [...paths, path]);
      else setGarmentPaths((paths) => [...paths, path]);
    } catch (reason) {
      setImportErrors((errors) => ({
        ...errors,
        [slot]: reason instanceof Error ? reason.message : "图片链接导入失败",
      }));
    } finally {
      setUploading("");
    }
  }

  async function create() {
    setError("");
    if (!requireAiAuth()) {
      sessionStorage.setItem(
        TRY_ON_DRAFT,
        JSON.stringify({
          personPaths,
          garmentPaths,
          generationMode,
          instructions,
          ratio,
          consented,
        }),
      );
      return;
    }
    setCreating(true);
    try {
      const { id } = await client.createTryOn({
        person_paths: personPaths,
        garment_paths: garmentPaths,
        generation_mode: generationMode,
        instructions,
        ratio,
      });
      setInstructions("");
      sessionStorage.removeItem(TRY_ON_DRAFT);
      setHistoryPage(1);
      await load(1);
      navigate(`/try-on/${id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建换装任务失败");
    } finally {
      setCreating(false);
    }
  }

  async function regenerate(id: string) {
    setError("");
    if (!requireAiAuth()) return;
    try {
      setSelectedVersionPath(null);
      await client.regenerateTryOn(id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重新生成失败");
    }
  }

  async function exportImage() {
    if (!displayedPath) return;
    try {
      await client.downloadAsset(displayedPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出失败");
    }
  }

  async function deleteJob(job: TryOnJob) {
    if (
      !window.confirm(
        "删除这条换装记录及其所有生成图片？人物和服装参考图会保留。",
      )
    )
      return;
    setError("");
    setDeletingId(job.id);
    try {
      await client.deleteTryOn(job.id);
      if (selectedJobId === job.id) navigate("/try-on");
      if (jobs.length === 1 && historyPage > 1) setHistoryPage(historyPage - 1);
      else await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除换装记录失败");
    } finally {
      setDeletingId("");
    }
  }

  function removeReference(slot: "person" | "garment", path: string) {
    beginDraft();
    if (slot === "person")
      setPersonPaths((paths) => paths.filter((item) => item !== path));
    else setGarmentPaths((paths) => paths.filter((item) => item !== path));
  }

  const canCreate =
    personPaths.length > 0 &&
    garmentPaths.length > 0 &&
    consented &&
    !uploading &&
    !creating;
  useEffect(() => {
    setSelectedVersionPath(null);
  }, [selectedJobId]);
  useEffect(() => {
    if (!pendingJob?.generation_started_at) return;
    const updateNow = () => setNow(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, [pendingJob?.generation_started_at]);
  const displayedPath = selectedVersionPath ?? selectedJob?.file_path ?? null;
  const displayedVersion = selectedJob?.versions.find(
    (version) => version.file_path === displayedPath,
  );
  const displayedGenerationStartedAt =
    displayedVersion?.generation_started_at ??
    selectedJob?.generation_started_at ??
    null;
  const generationDuration =
    selectedJob?.status === "ready" &&
    displayedVersion &&
    displayedGenerationStartedAt !== null
      ? Math.max(0, displayedVersion.created_at - displayedGenerationStartedAt)
      : null;
  const referencePersonPaths = selectedJob?.person_paths ?? personPaths;
  const referenceGarmentPaths = selectedJob?.garment_paths ?? garmentPaths;
  const hasOriginals =
    referencePersonPaths.length > 0 && referenceGarmentPaths.length > 0;
  const combinationCount = personPaths.length * garmentPaths.length;
  const createLabel =
    generationMode === "combinations"
      ? combinationCount > 0
        ? `新建并生成 ${combinationCount} 组`
        : "新建并生成组合"
      : "新建并生成换装";
  const totalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const elapsedSeconds = pendingJob?.generation_started_at
    ? Math.max(0, Math.floor(now / 1000 - pendingJob.generation_started_at))
    : null;
  const showGenerationProgress = pendingJob !== null && elapsedSeconds !== null;
  return (
    <Shell>
      <header className="workspace-header try-on-header">
        <div>
          <span className="eyebrow">AI 换装</span>
          <h1>换装工作台</h1>
        </div>
        <button
          className="button primary"
          disabled={!canCreate}
          onClick={() => void create()}
        >
          {creating ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Sparkles size={17} />
          )}
          {createLabel}
        </button>
      </header>
      <div className="workspace try-on-workspace">
        <aside className="sequence">
          <div className="sequence-head">
            <span>换装记录</span>
            <small>{historyTotal} 条记录</small>
          </div>
          <button
            className={`sequence-item ${!selectedJobId ? "active" : ""}`}
            onClick={startNewDraft}
          >
            <b>＋</b>
            <span>
              <strong>新建换装</strong>
              <small>添加人物和服装图片</small>
            </span>
            <i />
          </button>
          {jobs.map((job, index) => (
            <div className="try-on-sequence-row" key={job.id}>
              <button
                className={`sequence-item ${job.id === selectedJobId ? "active" : ""}`}
                onClick={() => navigate(`/try-on/${job.id}`)}
              >
                <b>
                  {String(
                    (historyPage - 1) * HISTORY_PAGE_SIZE + index + 1,
                  ).padStart(2, "0")}
                </b>
                <span>
                  <strong>换装任务 · {imageRatioLabel(job.ratio)}</strong>
                  <small>{statusText(job.status)}</small>
                </span>
                {job.file_path ? (
                  <img src={fileUrl(job.file_path)} alt="" />
                ) : (
                  <i />
                )}
              </button>
              <button
                className="try-on-delete"
                type="button"
                disabled={isPending(job.status) || deletingId === job.id}
                onClick={() => void deleteJob(job)}
                aria-label="删除换装记录"
                title={
                  job.status === "queued"
                    ? "排队中，暂不能删除"
                    : isPending(job.status)
                      ? "生成中，暂不能删除"
                      : "删除换装记录"
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {historyTotal > HISTORY_PAGE_SIZE && (
            <div className="try-on-pagination">
              <button
                type="button"
                disabled={historyPage === 1}
                onClick={() => setHistoryPage((page) => page - 1)}
              >
                上一页
              </button>
              <span>
                {historyPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={historyPage >= totalPages}
                onClick={() => setHistoryPage((page) => page + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </aside>
        <section className="stage try-on-stage">
          <header>
            <div>
              <span className="eyebrow">生成结果</span>
              <h2>
                {selectedJob
                  ? `换装预览 · ${imageRatioLabel(selectedJob.ratio)}`
                  : "换装预览"}
              </h2>
            </div>
          </header>
          <div className={`artboard ${displayedPath ? "with-image" : ""}`}>
            {displayedPath && (
              <button
                className="try-on-result-preview"
                type="button"
                onClick={() => setResultOpen(true)}
                aria-label="查看换装大图"
              >
                <img src={fileUrl(displayedPath)} alt="已生成的换装图片" />
              </button>
            )}
            {showGenerationProgress ? (
              <div
                className={`artboard-empty ${displayedPath ? "generation-overlay" : ""}`}
              >
                <Sparkles className="generation-sparkle" size={38} />
                <h3>{displayedPath ? "正在生成新版本" : "正在生成换装效果"}</h3>
                <div className="generation-progress" aria-hidden="true">
                  <i />
                </div>
                <p className="generation-timing">
                  已用时 {formatDuration(elapsedSeconds)}
                </p>
              </div>
            ) : !displayedPath ? (
              <div className="artboard-empty">
                {isPending(selectedJob?.status ?? "") ? (
                  <LoaderCircle className="spin" size={36} />
                ) : (
                  <Shirt size={38} />
                )}
                <h3>
                  {selectedJob?.status === "queued"
                    ? "已加入生成队列"
                    : isPending(selectedJob?.status ?? "")
                      ? "正在生成换装效果"
                      : selectedJob?.status.startsWith("failed")
                        ? "换装生成失败"
                        : "尚无换装效果"}
                </h3>
                <p>
                  {selectedJob?.status.startsWith("failed")
                    ? tryOnFailureReason(selectedJob.status)
                    : selectedJob?.status === "queued"
                      ? "轮到此任务后会自动开始生成。"
                      : isPending(selectedJob?.status ?? "")
                        ? "正在处理图片，请稍候。"
                        : "添加人物和服装图片并确认授权后，可以开始生成。"}
                </p>
                {!selectedJob && (
                  <button
                    className="button primary"
                    disabled={!canCreate}
                    onClick={() => void create()}
                  >
                    {createLabel}
                  </button>
                )}
              </div>
            ) : null}
          </div>
          {displayedVersion && (
            <p className="generation-completed-at">
              {selectedJob?.status === "queued" &&
                "新版本排队中，当前显示已有版本。"}
              {selectedJob?.status === "generating" &&
                "新版本生成中，当前显示已有版本。"}
              {selectedJob?.status.startsWith("failed") &&
                `最近一次生成失败：${tryOnFailureReason(selectedJob.status)} 当前显示已有版本。`}
              {isPending(selectedJob?.status ?? "") ||
              selectedJob?.status.startsWith("failed")
                ? "所显示版本生成于 "
                : "生成于 "}
              {formatGeneratedAt(displayedVersion.created_at)}
              {generationDuration !== null &&
                ` · 耗时 ${formatDuration(generationDuration)}`}
            </p>
          )}
          <div className="variant-strip" aria-label="换装版本">
            <span>版本</span>
            {selectedJob?.versions.length ? (
              <>
                {selectedJob.versions.map((version, index) => {
                  const active = version.file_path === displayedPath;
                  const current = version.file_path === selectedJob.file_path;
                  return (
                    <button
                      className={`variant ${active ? "active" : ""}`}
                      type="button"
                      onClick={() => setSelectedVersionPath(version.file_path)}
                      key={version.id}
                      aria-pressed={active}
                      aria-label={
                        current
                          ? "查看当前版本"
                          : `查看历史版本 ${selectedJob.versions.length - index}`
                      }
                    >
                      <img src={fileUrl(version.file_path)} alt="" />
                      <b>
                        {current
                          ? "当前"
                          : `v${selectedJob.versions.length - index}`}
                      </b>
                    </button>
                  );
                })}
              </>
            ) : (
              <span className="variant empty">
                {isPending(selectedJob?.status ?? "")
                  ? statusText(selectedJob?.status ?? "")
                  : "暂无版本"}
              </span>
            )}
          </div>
        </section>
        <aside className="controls try-on-controls">
          <div className="workspace-actions" aria-label="换装操作">
            {displayedPath && (
              <button
                className="button secondary"
                type="button"
                onClick={() => void exportImage()}
              >
                <Download size={16} />
                导出图片
              </button>
            )}
            <button
              className="button secondary"
              type="button"
              disabled={!hasOriginals}
              onClick={() => setOriginalsOpen(true)}
            >
              <Eye size={16} />
              参考图
            </button>
            {selectedJob && (
              <button
                className="button secondary"
                type="button"
                disabled={isPending(selectedJob.status)}
                onClick={() => void regenerate(selectedJob.id)}
                title="沿用这条记录的参考图和设置，生成新版本"
              >
                <RefreshCw size={16} />
                按原设置再生成
              </button>
            )}
            <button
              className="button primary workspace-generate-button"
              type="button"
              disabled={!canCreate}
              onClick={() => void create()}
            >
              <Sparkles size={16} />
              {createLabel}
            </button>
          </div>
          <div className="controls-head">
            <b>换装设置</b>
            <span>当前设置</span>
          </div>
          <ReferenceSlot
            title="人物照片"
            hint="建议使用清晰的全身照片"
            paths={personPaths}
            loading={uploading === "person"}
            error={importErrors.person}
            onUpload={() => void upload("person")}
            onImport={(url) => void importUrl("person", url)}
            onRemove={(path) => removeReference("person", path)}
          />
          <ReferenceSlot
            title="服装图片"
            hint="建议使用清晰的单件服装照片"
            paths={garmentPaths}
            loading={uploading === "garment"}
            error={importErrors.garment}
            onUpload={() => void upload("garment")}
            onImport={(url) => void importUrl("garment", url)}
            onRemove={(path) => removeReference("garment", path)}
          />
          <fieldset className="try-on-generation-mode">
            <legend>生成方式</legend>
            <div className="try-on-mode-options">
              <button
                type="button"
                className={generationMode === "combined" ? "active" : ""}
                aria-pressed={generationMode === "combined"}
                onClick={() => {
                  beginDraft();
                  setGenerationMode("combined");
                }}
              >
                <b>合并参考</b>
                <small>全部图片生成 1 个结果</small>
              </button>
              <button
                type="button"
                className={generationMode === "combinations" ? "active" : ""}
                aria-pressed={generationMode === "combinations"}
                onClick={() => {
                  beginDraft();
                  setGenerationMode("combinations");
                }}
              >
                <b>全部组合</b>
                <small>每张人物与每张服装配对，共 {combinationCount} 组</small>
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>目标画面比例</legend>
            <ImageRatioPicker
              value={ratio}
              onChange={(value) => {
                beginDraft();
                setRatio(value);
              }}
            />
          </fieldset>
          <label>
            补充要求（选填）
            <textarea
              value={instructions}
              onChange={(event) => {
                beginDraft();
                setInstructions(event.target.value);
              }}
              rows={5}
              maxLength={1000}
              placeholder="例如：保持原有站姿，营造简洁的室内自然光效果"
            />
          </label>
          <label className="try-on-consent">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => {
                beginDraft();
                setConsented(event.target.checked);
              }}
            />
            我确认已获得图片中人物的使用授权
          </label>
          {error && <p className="form-error">{error}</p>}
          <button
            className="button secondary try-on-generate"
            disabled={!canCreate}
            onClick={() => void create()}
          >
            {creating ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Sparkles size={17} />
            )}
            {createLabel}
          </button>
        </aside>
      </div>
      {originalsOpen && hasOriginals && (
        <div
          className="try-on-originals-backdrop"
          role="presentation"
          onClick={() => setOriginalsOpen(false)}
        >
          <section
            className="try-on-originals"
            role="dialog"
            aria-modal="true"
            aria-label="换装参考原图"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">参考原图</span>
                <h2>人物与服装原图</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setOriginalsOpen(false)}
                aria-label="关闭原图预览"
              >
                <X size={20} />
              </button>
            </header>
            <div className="try-on-original-grid">
              {referencePersonPaths.map((path, index) => (
                <figure key={path}>
                  <img src={fileUrl(path)} alt={`人物原图 ${index + 1}`} />
                  <figcaption>
                    人物原图 {index + 1}
                    {index === 0 ? "（首张）" : ""}
                  </figcaption>
                </figure>
              ))}
              {referenceGarmentPaths.map((path, index) => (
                <figure key={path}>
                  <img src={fileUrl(path)} alt={`服装原图 ${index + 1}`} />
                  <figcaption>
                    服装原图 {index + 1}
                    {index === 0 ? "（首张）" : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        </div>
      )}
      {resultOpen && displayedPath && (
        <div
          className="try-on-result-backdrop"
          role="presentation"
          onClick={() => setResultOpen(false)}
        >
          <section
            className="try-on-result-modal"
            role="dialog"
            aria-modal="true"
            aria-label="换装生成大图"
            onClick={(event) => event.stopPropagation()}
          >
            <img src={fileUrl(displayedPath)} alt="换装生成大图" />
            <div className="try-on-result-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void exportImage()}
              >
                <Download size={16} />
                导出图片
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => setResultOpen(false)}
                aria-label="关闭大图预览"
              >
                <X size={20} />
              </button>
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}
