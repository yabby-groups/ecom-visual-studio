import {
  ArrowLeft,
  Download,
  Eye,
  ImagePlus,
  Link2,
  LoaderCircle,
  RefreshCw,
  Shirt,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import type { TryOnJob } from "../types";
import { fileUrl, isPending, statusText } from "../utils/assets";
import { Shell } from "./Shell";
import "./TryOn.css";
import "./Workspace.css";

const HISTORY_PAGE_SIZE = 12;
const GENERATION_ESTIMATE_SECONDS = 300;

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

type ReferenceSlotProps = {
  title: string;
  hint: string;
  paths: string[];
  loading: boolean;
  onUpload: (file: File) => void;
  onImport: (url: string) => void;
  onRemove: (path: string) => void;
};

function ReferenceSlot({
  title,
  hint,
  paths,
  loading,
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
        role="tablist"
        aria-label={`${title}来源`}
      >
        <button
          type="button"
          className={source === "upload" ? "active" : ""}
          aria-selected={source === "upload"}
          onClick={() => setSource("upload")}
        >
          <Upload size={13} /> 本地上传
        </button>
        <button
          type="button"
          className={source === "url" ? "active" : ""}
          aria-selected={source === "url"}
          onClick={() => setSource("url")}
        >
          <Link2 size={13} /> 链接导入
        </button>
      </div>
      <div className="try-on-reference-images" aria-label={`${title}图片列表`}>
        {paths.map((path, index) => (
          <div className="try-on-reference-thumbnail" key={path}>
            <img src={fileUrl(path)} alt={`${title} ${index + 1}`} />
            {index === 0 && <span>主图</span>}
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
        <label className="try-on-upload">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={loading || paths.length >= 4}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.currentTarget.value = "";
            }}
          />
          <ImagePlus size={28} />
          <b>{paths.length ? "继续添加图片" : "上传图片"}</b>
          <span>{paths.length}/4 张 · JPG、PNG、WebP，最大 15MB</span>
          {loading && (
            <span className="try-on-upload-loading">
              <LoaderCircle className="spin" size={22} /> 上传中
            </span>
          )}
        </label>
      ) : (
        <div className="try-on-url-import">
          <Link2 size={24} />
          <b>导入公开图片链接</b>
          <span>图片会先保存到当前工作区，再用于换装。</span>
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
            导入图片（{paths.length}/4）
          </button>
        </div>
      )}
    </section>
  );
}

export function TryOn() {
  const navigate = useNavigate();
  const [personPaths, setPersonPaths] = useState<string[]>([]);
  const [garmentPaths, setGarmentPaths] = useState<string[]>([]);
  const [generationMode, setGenerationMode] = useState<"combined" | "combinations">("combined");
  const [instructions, setInstructions] = useState("");
  const [ratio, setRatio] = useState("2:3");
  const [consented, setConsented] = useState(false);
  const [uploading, setUploading] = useState<"person" | "garment" | "">("");
  const [jobs, setJobs] = useState<TryOnJob[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("new");
  const [originalsOpen, setOriginalsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [selectedVersionPath, setSelectedVersionPath] = useState<string | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());

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
  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const pendingJob = selectedJob && isPending(selectedJob.status) ? selectedJob : null;
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
    setSelectedJobId((current) =>
      current === "new" || jobs.some((job) => job.id === current)
        ? current
        : jobs[0]?.id || "new",
    );
  }, [jobs]);

  async function upload(slot: "person" | "garment", file: File) {
    setError("");
    setUploading(slot);
    try {
      const { path } = await client.upload(file);
      setSelectedJobId("new");
      if (slot === "person") setPersonPaths((paths) => [...paths, path]);
      else setGarmentPaths((paths) => [...paths, path]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片上传失败");
    } finally {
      setUploading("");
    }
  }

  async function importUrl(slot: "person" | "garment", url: string) {
    setError("");
    setUploading(slot);
    try {
      const { path } = await client.importUrl(url);
      setSelectedJobId("new");
      if (slot === "person") setPersonPaths((paths) => [...paths, path]);
      else setGarmentPaths((paths) => [...paths, path]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片链接导入失败");
    } finally {
      setUploading("");
    }
  }

  async function create() {
    setError("");
    setCreating(true);
    try {
      const { id } = await client.createTryOn({
        person_paths: personPaths,
        garment_paths: garmentPaths,
        generation_mode: generationMode,
        instructions,
        ratio,
      });
      setSelectedJobId(id);
      setInstructions("");
      setHistoryPage(1);
      await load(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "换装任务创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function regenerate(id: string) {
    setError("");
    try {
      setSelectedVersionPath(null);
      await client.regenerateTryOn(id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重新生成失败");
    }
  }

  async function deleteJob(job: TryOnJob) {
    if (!window.confirm("删除该换装记录及其生成图片？原始参考图会保留。")) return;
    setError("");
    setDeletingId(job.id);
    try {
      await client.deleteTryOn(job.id);
      if (selectedJobId === job.id) setSelectedJobId("new");
      if (jobs.length === 1 && historyPage > 1) setHistoryPage(historyPage - 1);
      else await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除换装记录失败");
    } finally {
      setDeletingId("");
    }
  }

  function removeReference(slot: "person" | "garment", path: string) {
    setSelectedJobId("new");
    if (slot === "person") setPersonPaths((paths) => paths.filter((item) => item !== path));
    else setGarmentPaths((paths) => paths.filter((item) => item !== path));
  }

  const canCreate =
    personPaths.length > 0 && garmentPaths.length > 0 && consented && !uploading && !creating;
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
  const referencePersonPaths = selectedJob?.person_paths ?? personPaths;
  const referenceGarmentPaths = selectedJob?.garment_paths ?? garmentPaths;
  const hasOriginals = referencePersonPaths.length > 0 && referenceGarmentPaths.length > 0;
  const combinationCount = personPaths.length * garmentPaths.length;
  const totalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const elapsedSeconds =
    pendingJob?.generation_started_at
      ? Math.max(0, Math.floor(now / 1000 - pendingJob.generation_started_at))
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
  const showGenerationProgress =
    pendingJob !== null && elapsedSeconds !== null && remainingSeconds !== null;
  return (
    <Shell>
      <header className="workspace-header try-on-header">
        <button className="back-link" onClick={() => navigate("/")}>
          <ArrowLeft size={17} />
          创作台
        </button>
        <div>
          <span className="eyebrow">AI TRY-ON</span>
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
          生成试穿
        </button>
      </header>
      <div className="workspace try-on-workspace">
        <aside className="sequence">
          <div className="sequence-head">
            <span>换装序列</span>
            <small>{historyTotal} 个结果</small>
          </div>
          <button
            className={`sequence-item ${selectedJobId === "new" ? "active" : ""}`}
            onClick={() => setSelectedJobId("new")}
          >
            <b>＋</b>
            <span>
              <strong>新的试穿</strong>
              <small>添加人物与服装</small>
            </span>
            <i />
          </button>
          {jobs.map((job, index) => (
            <div className="try-on-sequence-row" key={job.id}>
              <button className={`sequence-item ${job.id === selectedJobId ? "active" : ""}`} onClick={() => setSelectedJobId(job.id)}>
                <b>{String((historyPage - 1) * HISTORY_PAGE_SIZE + index + 1).padStart(2, "0")}</b>
                <span><strong>{job.ratio} 全身试穿</strong><small>{statusText(job.status)}</small></span>
                {job.file_path ? <img src={fileUrl(job.file_path)} alt="" /> : <i />}
              </button>
              <button className="try-on-delete" type="button" disabled={isPending(job.status) || deletingId === job.id} onClick={() => void deleteJob(job)} aria-label="删除换装记录" title={isPending(job.status) ? "生成中不能删除" : "删除换装记录"}><Trash2 size={14} /></button>
            </div>
          ))}
          {historyTotal > HISTORY_PAGE_SIZE && <div className="try-on-pagination"><button type="button" disabled={historyPage === 1} onClick={() => setHistoryPage((page) => page - 1)}>上一页</button><span>{historyPage} / {totalPages}</span><button type="button" disabled={historyPage >= totalPages} onClick={() => setHistoryPage((page) => page + 1)}>下一页</button></div>}
        </aside>
        <section className="stage try-on-stage">
          <header>
            <div>
              <span className="eyebrow">TRY-ON PREVIEW</span>
              <h2>
                {selectedJob ? `${selectedJob.ratio} 全身试穿` : "试穿预览"}
              </h2>
            </div>
            <div>
              {selectedJob?.file_path && (
                <>
                  <button
                    className="button secondary"
                    onClick={() => setResultOpen(true)}
                  >
                    <Eye size={16} />
                    查看大图
                  </button>
                  <a
                    className="button secondary"
                    href={fileUrl(selectedJob.file_path)}
                    download
                  >
                    <Download size={16} />
                    下载
                  </a>
                </>
              )}
              <button
                className="button secondary"
                disabled={!hasOriginals}
                onClick={() => setOriginalsOpen(true)}
              >
                <Eye size={16} />
                查看参考原图
              </button>
              {selectedJob && (
                <button
                  className="button secondary"
                  disabled={isPending(selectedJob.status)}
                  onClick={() => void regenerate(selectedJob.id)}
                >
                  <RefreshCw size={16} />
                  重新生成
                </button>
              )}
              <button
                className="button primary"
                disabled={!canCreate}
                onClick={() => void create()}
              >
                <Sparkles size={16} />
                生成画面
              </button>
            </div>
          </header>
          <div className={`artboard ${displayedPath ? "with-image" : ""}`}>
            {displayedPath && (
              <button
                className="try-on-result-preview"
                type="button"
                onClick={() => setResultOpen(true)}
                aria-label="查看生成大图"
              >
                <img src={fileUrl(displayedPath)} alt="换装结果" />
              </button>
            )}
            {showGenerationProgress ? (
              <div
                className={`artboard-empty ${displayedPath ? "generation-overlay" : ""}`}
              >
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
                  <i style={{ transform: `scaleX(${cycleProgress})` }} />
                </div>
                <p className="generation-timing">
                  生成中 · 预计剩余 {formatDuration(remainingSeconds)} · 已用时 {elapsedSeconds} 秒
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
                  {isPending(selectedJob?.status ?? "")
                    ? "正在制作试穿效果"
                    : selectedJob?.status.startsWith("failed")
                      ? "试穿生成失败"
                      : "等待第一套试穿"}
                </h3>
                <p>
                  {selectedJob?.status.startsWith("failed")
                    ? selectedJob.status
                    : "在右侧添加人物照片与主服装，调整画面比例后开始生成。"}
                </p>
                {!selectedJob && (
                  <button
                    className="button primary"
                    disabled={!canCreate}
                    onClick={() => void create()}
                  >
                    生成第一版
                  </button>
                )}
              </div>
            ) : null}
          </div>
          <div className="variant-strip" aria-label="试穿版本">
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
                      aria-label={`查看${current ? "当前" : `历史 ${selectedJob.versions.length - index}`}版本`}
                    >
                      <img src={fileUrl(version.file_path)} alt="" />
                      <b>{current ? "当前" : `v${selectedJob.versions.length - index}`}</b>
                    </button>
                  );
                })}
              </>
            ) : (
              <span className="variant empty">
                {isPending(selectedJob?.status ?? "")
                  ? statusText(selectedJob?.status ?? "")
                  : "等待第一版"}
              </span>
            )}
          </div>
        </section>
        <aside className="controls try-on-controls">
          <div className="controls-head">
            <b>换装控制</b>
            <span>自动保存</span>
          </div>
          <ReferenceSlot
            title="人物照片"
            hint="清晰、全身的人像效果最佳"
            paths={personPaths}
            loading={uploading === "person"}
            onUpload={(file) => void upload("person", file)}
            onImport={(url) => void importUrl("person", url)}
            onRemove={(path) => removeReference("person", path)}
          />
          <ReferenceSlot
            title="主服装"
            hint="平铺或挂拍的单件服装"
            paths={garmentPaths}
            loading={uploading === "garment"}
            onUpload={(file) => void upload("garment", file)}
            onImport={(url) => void importUrl("garment", url)}
            onRemove={(path) => removeReference("garment", path)}
          />
          <fieldset className="try-on-generation-mode">
            <legend>生成方式</legend>
            <div className="try-on-mode-options">
              <button
                type="button"
                className={generationMode === "combined" ? "active" : ""}
                onClick={() => setGenerationMode("combined")}
              >
                <b>合并参考</b>
                <small>全部图片共同生成 1 个结果</small>
              </button>
              <button
                type="button"
                className={generationMode === "combinations" ? "active" : ""}
                onClick={() => setGenerationMode("combinations")}
              >
                <b>全部组合</b>
                <small>将生成 {combinationCount || 0} 个独立结果</small>
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>画面比例</legend>
            <div className="ratio-row">
              {[
                ["1:1", "1024×1024"],
                ["3:2", "1536×1024"],
                ["2:3", "1024×1536"],
                ["16:9", "1536×864"],
              ].map(([value, size]) => (
                <button
                  type="button"
                  className={ratio === value ? "active" : ""}
                  onClick={() => setRatio(value)}
                  key={value}
                >
                  <b>{value}</b>
                  <small>{size}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="style-lock">
            <i style={{ background: "#e6ba73" }} />
            <div>
              <b>首图为主参考</b>
              <span>其余图片将补充人物角度与服装细节</span>
            </div>
          </div>
          <label>
            高级 Prompt
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={5}
              maxLength={1000}
              placeholder="例如：保持原有站姿，营造简洁的室内自然光效果"
            />
          </label>
          <label className="try-on-consent">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
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
            {generationMode === "combinations" ? `生成 ${combinationCount} 个组合` : "保存并生成试穿"}
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
                <span className="eyebrow">ORIGINAL REFERENCES</span>
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
                  <figcaption>人物原图 {index + 1}{index === 0 ? "（主图）" : ""}</figcaption>
                </figure>
              ))}
              {referenceGarmentPaths.map((path, index) => (
                <figure key={path}>
                  <img src={fileUrl(path)} alt={`服装原图 ${index + 1}`} />
                  <figcaption>服装原图 {index + 1}{index === 0 ? "（主图）" : ""}</figcaption>
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
              <a
                className="button secondary"
                href={fileUrl(displayedPath)}
                download
              >
                <Download size={16} />
                下载图片
              </a>
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
