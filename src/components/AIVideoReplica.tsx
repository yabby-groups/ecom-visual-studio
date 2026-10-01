import {
  Check,
  Download,
  Film,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
  Terminal,
} from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { VideoReplicaJob } from "../types";
import { failureReason, fileUrl, isPending, statusText } from "../utils/assets";
import { Shell } from "./Shell";
import { SettingsSelect } from "./SettingsSelect";
import { client } from "../api";

type Review = {
  score: number;
  issues: string[];
  optimized_prompt: string;
  source: string;
};
type Props = {
  sourceReady: boolean;
  sourcePreview: string;
  replaceReady: boolean;
  scriptReady: boolean;
  busy: string;
  videoReadProgress: number | null;
  productReferencePath: string;
  prompt: string;
  personPrompt: string;
  budget: number;
  aiModel: string;
  ratio: string;
  resolution: string;
  review: Review | null;
  selected: VideoReplicaJob | null;
  displayed: string;
  error: string;
  jobs: VideoReplicaJob[];
  setMode: (mode: "replica") => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  setReview: Dispatch<SetStateAction<Review | null>>;
  setPersonPrompt: Dispatch<SetStateAction<string>>;
  setBudget: Dispatch<SetStateAction<number>>;
  setAiModel: Dispatch<SetStateAction<string>>;
  setRatio: Dispatch<SetStateAction<string>>;
  setResolution: Dispatch<SetStateAction<string>>;
  setReferencePaths: Dispatch<SetStateAction<string[]>>;
  setProductReferencePath: Dispatch<SetStateAction<string>>;
  uploadVideo: (file: File) => void;
  uploadReference: (file: File) => void;
  reviewPrompt: () => void;
  adoptReview: () => void;
  create: () => void;
  regenerate: (id: string) => void;
  exportVideo: (path: string) => void;
  selectJob: (job: VideoReplicaJob) => void;
  refreshTask: (id: string) => Promise<void>;
  resumeTask: (id: string, answer: string, instruction: string) => void;
  terminateTask: (id: string) => void;
  terminating: boolean;
};

export function AIVideoReplica(props: Props) {
  const p = props;
  const [answer, setAnswer] = useState("");
  const [instruction, setInstruction] = useState("");
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logTab, setLogTab] = useState<"stdout" | "stderr" | "files">("stdout");
  const [fileBusy, setFileBusy] = useState("");
  const [fileError, setFileError] = useState("");
  async function downloadFile(path: string) {
    if (!p.selected) return;
    setFileBusy(path);
    setFileError("");
    try {
      const id = p.selected.id;
      if (!(await client.downloadAIVideoReplicaFile(id, path)))
        throw new Error("文件未保存");
    } catch (reason) {
      setFileError(String(reason));
    } finally {
      setFileBusy("");
    }
  }
  async function openLogs() {
    if (!p.selected) return;
    setLogsLoading(true);
    try {
      await p.refreshTask(p.selected.id);
      setLogsOpen(true);
    } finally {
      setLogsLoading(false);
    }
  }
  const phases = [
    ["queued", "等待提交"],
    ["preparing", "准备素材"],
    ["submitting", "提交任务"],
    ["generating", "模型生成"],
    ["retrieving", "获取结果"],
    ["ready", "完成"],
  ] as const;
  const phaseIndex = p.selected
    ? phases.findIndex(([phase]) => phase === p.selected?.status)
    : -1;
  const failed = p.selected?.status.startsWith("failed")
    ? failureReason(p.selected.status)
    : "";
  return (
    <Shell>
      <header className="workspace-header video-replica-header">
        <div className="video-replica-title">
          <span className="eyebrow">AI VIDEO STUDIO / QUICK REPLACE</span>
          <h1>AI 复刻</h1>
          <p>用原视频的节奏和镜头，替换为你的商品并生成新版本。</p>
        </div>
        <div className="video-replica-meta">
          <span className="workflow-badge">
            {p.selected ? statusText(p.selected.status) : "未开始"}
          </span>
          <button
            className="button secondary"
            type="button"
            onClick={() => p.setMode("replica")}
          >
            <RefreshCw size={15} />
            分镜复刻
          </button>
        </div>
      </header>
      <main className="video-replica">
        <div className="video-replica-workbench">
          <section className="video-replica-editor">
            <div className="video-replica-panel ai-workflow-intro">
              <span className="step-kicker">QUICK WORKFLOW</span>
              <h2>三步完成一次 AI 复刻</h2>
              <p>选择视频、添加商品图、描述你要替换的内容，然后开始生成。</p>
            </div>
            <div
              className={`video-replica-panel workflow-panel ${p.sourceReady ? "done" : ""}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">1</div>
                <div>
                  <span className="step-kicker">素材 01</span>
                  <h2>选择原视频</h2>
                  <p>添加要保留镜头节奏和动作的本机视频。</p>
                </div>
                <span className="step-state">
                  {p.busy === "upload"
                    ? "正在添加"
                    : p.sourceReady
                      ? "已添加"
                      : "待选择"}
                </span>
              </div>
              <div
                className={`video-upload-box ${p.sourceReady && p.busy !== "upload" ? "has-video" : ""}`}
              >
                {p.busy === "upload" ? (
                  <div className="video-upload-status" role="status">
                    <LoaderCircle className="spin" size={30} />
                    <strong>
                      {p.videoReadProgress === null
                        ? "正在保存并校验视频…"
                        : `正在读取视频 ${p.videoReadProgress}%`}
                    </strong>
                    {p.videoReadProgress !== null && (
                      <progress
                        value={p.videoReadProgress}
                        max={100}
                        aria-label="读取视频进度"
                      />
                    )}
                  </div>
                ) : p.sourcePreview ? (
                  <>
                    <video src={p.sourcePreview} controls />
                    <label className="video-replace-action">
                      <Upload size={15} />
                      重新选择
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) p.uploadVideo(f);
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <label className="video-upload-prompt">
                    <Film size={30} />
                    <strong>点击选择本机视频</strong>
                    <span>支持 MP4 / WebM / MOV，具体限制由所选模型决定</span>
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) p.uploadVideo(f);
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            <div
              className={`video-replica-panel workflow-panel ${p.replaceReady ? "done" : ""}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">2</div>
                <div>
                  <span className="step-kicker">素材 02</span>
                  <h2>添加商品图片</h2>
                  <p>这张图片会作为生成视频中的目标商品外观依据。</p>
                </div>
                <span className="step-state">
                  {p.replaceReady ? "已添加" : "待添加"}
                </span>
              </div>
              <div className="reference-thumbs ai-product-thumb">
                {p.productReferencePath ? (
                  <div className="reference-thumb">
                    <div className="product-reference active">
                      <img
                        src={fileUrl(p.productReferencePath)}
                        alt="商品参考图"
                      />
                    </div>
                    <button
                      type="button"
                      className="reference-remove"
                      aria-label="移除商品图片"
                      onClick={() => {
                        p.setReferencePaths([]);
                        p.setProductReferencePath("");
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <label className="reference-add">
                    <Upload size={17} />
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) p.uploadReference(f);
                      }}
                    />
                    添加商品图
                  </label>
                )}
              </div>
            </div>
            <div
              className={`video-replica-panel workflow-panel ${p.scriptReady ? "done" : ""}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">3</div>
                <div>
                  <span className="step-kicker">描述与生成</span>
                  <h2>描述替换目标</h2>
                  <p>写清楚替换对象，以及需要保留的动作、镜头、光线和背景。</p>
                </div>
                <span className="step-state">{p.prompt.length}/2000</span>
              </div>
              <textarea
                className="video-script"
                value={p.prompt}
                onChange={(e) => {
                  p.setPrompt(e.target.value);
                  p.setReview(null);
                }}
                placeholder="例如：将视频中的旧款水杯替换为商品图中的保温杯，保留原视频的手部动作、镜头运动、背景和光线。"
              />
              <div className="prompt-review-actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={!!p.busy || !p.prompt.trim()}
                  onClick={p.reviewPrompt}
                >
                  {p.busy === "review" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  检查描述
                </button>
                <span>可选：让 AI 检查描述是否完整</span>
              </div>
              {p.review && (
                <div className="prompt-review" role="status">
                  <div className="prompt-review-head">
                    <strong>描述评分 {p.review.score}/100</strong>
                    <span>请确认是否采用优化稿</span>
                  </div>
                  {p.review.issues.length > 0 && (
                    <ul>
                      {p.review.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  <div className="prompt-review-copy">
                    <small>优化稿</small>
                    <p>{p.review.optimized_prompt}</p>
                  </div>
                  <div className="prompt-review-actions">
                    <button
                      className="button primary"
                      type="button"
                      disabled={p.review.source !== p.prompt}
                      onClick={p.adoptReview}
                    >
                      <Check size={16} />
                      采用优化稿
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => p.setReview(null)}
                    >
                      保留当前内容
                    </button>
                  </div>
                </div>
              )}
              <details className="ai-advanced-settings">
                <summary>高级设置</summary>
                <div className="video-controls">
                  <label>
                    模型
                    <SettingsSelect
                      name="ai-video-model"
                      value={p.aiModel}
                      options={[
                        { value: "qwen3.8-flash", label: "Qwen 3.8 Flash" },
                        { value: "qwen3.8-max", label: "Qwen 3.8 Max" },
                        { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
                        { value: "gpt-6-luna", label: "GPT 6 Luna" },
                      ]}
                      onChange={p.setAiModel}
                    />
                  </label>
                  <label>
                    画面比例
                    <SettingsSelect
                      name="ai-video-ratio"
                      value={p.ratio}
                      options={["16:9", "9:16", "1:1"].map((value) => ({
                        value,
                        label: value,
                      }))}
                      onChange={p.setRatio}
                    />
                  </label>
                  <label>
                    清晰度
                    <SettingsSelect
                      name="ai-video-resolution"
                      value={p.resolution}
                      options={["480p", "720p"].map((value) => ({
                        value,
                        label: value,
                      }))}
                      onChange={p.setResolution}
                    />
                  </label>
                  <label>
                    人物说明
                    <input
                      value={p.personPrompt}
                      onChange={(e) => p.setPersonPrompt(e.target.value)}
                      placeholder="可选"
                    />
                  </label>
                  <label>
                    预算（美元）
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={p.budget}
                      onChange={(e) => p.setBudget(Number(e.target.value))}
                    />
                  </label>
                </div>
              </details>
              <button
                className="button primary workflow-action"
                type="button"
                disabled={
                  !!p.busy ||
                  !p.sourceReady ||
                  !p.replaceReady ||
                  !p.scriptReady
                }
                onClick={p.create}
              >
                {p.busy === "create" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                开始 AI 复刻
              </button>
            </div>
          </section>
          <section className="video-replica-preview">
            <div className="video-replica-panel-head">
              <div>
                <span className="step-kicker">RESULT</span>
                <h2>生成结果</h2>
              </div>
              <span className="preview-status">
                {p.selected ? statusText(p.selected.status) : "等待生成"}
              </span>
            </div>
            {p.selected && (
              <div
                className="video-generation-progress ai-progress"
                aria-live="polite"
              >
                <div className="generation-progress-head">
                  <strong>{statusText(p.selected.status)}</strong>
                  <span>
                    {p.selected.status === "generating"
                      ? "远端进度不可量化"
                      : phases.find(([phase]) => phase === p.selected?.status)?.[1]}
                  </span>
                </div>
                <div className="generation-phase-list ai-generation-phase-list">
                  {phases.map(([phase, label], index) => (
                    <div
                      className={`generation-phase ${p.selected?.status === "ready" || (phaseIndex >= 0 && index < phaseIndex) ? "done" : ""} ${p.selected?.status === phase ? "active" : ""}`}
                      key={phase}
                    >
                      <span className="generation-phase-dot" />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                {isPending(p.selected.status) && (
                  <>
                    <div
                      className="generation-indeterminate"
                      role="progressbar"
                      aria-label="AI 复刻生成进行中"
                    />
                    {p.selected.status === "generating" && (
                      <p className="generation-progress-detail">远端进度不可量化</p>
                    )}
                  </>
                )}
              </div>
            )}
            {p.selected?.task_type === "ai_replica" && (
              <div
                className="video-replica-panel skill2api-console"
                aria-live="polite"
              >
                <strong>任务控制台</strong>
                <div className="prompt-review-actions">
                  {p.selected.status === "waiting_for_input" ? (
                    <>
                      <input
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder={
                          p.selected.skill2api?.question || "请输入回答"
                        }
                      />
                      <button
                        className="button primary"
                        type="button"
                        disabled={!answer.trim()}
                        onClick={() => {
                          p.resumeTask(p.selected!.id, answer, "");
                          setAnswer("");
                        }}
                      >
                        提交
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="追加题词（可选）"
                      />
                      <button
                        className="button secondary"
                        type="button"
                        disabled={p.selected.status === "running"}
                        onClick={() => {
                          p.resumeTask(p.selected!.id, "", instruction);
                          setInstruction("");
                        }}
                      >
                        恢复任务
                      </button>
                    </>
                  )}
                  {isPending(p.selected.status) && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={p.terminating}
                      onClick={() => p.terminateTask(p.selected!.id)}
                    >
                      <X size={16} />
                      {p.terminating ? "正在终止" : "终止"}
                    </button>
                  )}
                </div>
                <button
                  className="button secondary"
                  type="button"
                  disabled={logsLoading}
                  onClick={() => void openLogs()}
                >
                  <Terminal size={16} />
                  {logsLoading ? "正在读取日志" : "查看运行日志"}
                </button>
                {!p.selected.skill2api_request_id && (
                  <small>
                    该历史任务尚未关联远程请求，请使用“再次生成”恢复。
                  </small>
                )}
              </div>
            )}
            {logsOpen && p.selected?.task_type === "ai_replica" && (
              <div
                className="skill2api-log-backdrop"
                role="presentation"
                onClick={() => setLogsOpen(false)}
              >
                <section
                  className="skill2api-log-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="skill2api-log-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="skill2api-log-header">
                    <div>
                      <span className="step-kicker">SKILL2API</span>
                      <h2 id="skill2api-log-title">运行日志</h2>
                    </div>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="关闭日志"
                      onClick={() => setLogsOpen(false)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div
                    className="skill2api-log-tabs"
                    role="tablist"
                    aria-label="远程任务记录"
                  >
                    {(["stdout", "stderr", "files"] as const).map((tab) => (
                      <button
                        key={tab}
                        className="button secondary"
                        type="button"
                        role="tab"
                        aria-selected={logTab === tab}
                        onClick={() => setLogTab(tab)}
                      >
                        {tab === "files" ? "文件" : tab}
                      </button>
                    ))}
                  </div>
                  {p.selected.skill2api?.remote_error && (
                    <p className="generation-progress-detail" role="status">
                      远端记录不可用，正在显示本地日志快照。
                    </p>
                  )}
                  {logTab === "files" && (
                    <div className="skill2api-file-list">
                      {p.selected.skill2api?.files?.map((path) => (
                        <button
                          className="button secondary"
                          key={path}
                          type="button"
                          disabled={!!fileBusy}
                          onClick={() => void downloadFile(path)}
                        >
                          <Download size={16} />
                          <span>
                            {fileBusy === path ? "正在获取：" : ""}
                            {path}
                          </span>
                        </button>
                      ))}
                      {fileError && <p role="alert">{fileError}</p>}
                    </div>
                  )}
                  <div className="skill2api-log-grid" role="tabpanel">
                    <div>
                      <pre className={logTab === "stderr" ? "error" : ""}>
                        {logTab === "stdout"
                          ? p.selected.skill2api?.stdout || "暂无标准输出"
                          : logTab === "stderr"
                            ? p.selected.skill2api?.stderr ||
                              "远程错误输出不可用"
                            : p.selected.skill2api?.files?.join("\n") ||
                              "远程文件列表不可用"}
                      </pre>
                    </div>
                  </div>
                </section>
              </div>
            )}
            <div className="video-stage">
              {p.displayed ? (
                <video src={p.displayed} controls />
              ) : (
                <>
                  <Film size={38} />
                  <strong>{failed ? "生成失败" : "等待生成结果"}</strong>
                  <p>{failed || "提交任务后，生成视频会显示在这里"}</p>
                </>
              )}
            </div>
            {failed && (
              <p
                className="notice notice-error video-generation-error"
                role="alert"
              >
                {failed}
              </p>
            )}
            <div className="preview-meta">
              <span>
                <small>原视频</small>
                <b>{p.sourceReady ? "已选择" : "未选择"}</b>
              </span>
              <span>
                <small>商品参考图</small>
                <b>{p.replaceReady ? "已添加" : "未添加"}</b>
              </span>
            </div>
            {p.selected && (
              <div className="video-result-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => p.regenerate(p.selected!.id)}
                  disabled={!!p.busy || isPending(p.selected!.status)}
                >
                  <RefreshCw size={16} />
                  再次生成
                </button>
                {p.selected.file_path && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => p.exportVideo(p.selected!.file_path!)}
                  >
                    <Download size={16} />
                    导出视频
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
        <section className="video-replica-history">
          <div className="video-replica-panel-head">
            <h2>AI 复刻历史</h2>
            <span>
              {p.jobs.filter((job) => job.task_type === "ai_replica").length} 条
            </span>
          </div>
          {p.jobs
            .filter((job) => job.task_type === "ai_replica")
            .map((job) => (
              <div
                className={`video-history-item ${p.selected?.id === job.id ? "active" : ""}`}
                key={job.id}
              >
                <button
                  type="button"
                  className="video-history-select"
                  onClick={() => p.selectJob(job)}
                >
                  <span>AI 复刻</span>
                  <strong>{job.model}</strong>
                  <small>
                    {statusText(job.status)} · {job.versions.length} 个版本
                  </small>
                  <time>
                    {new Date(job.created_at * 1000).toLocaleString()}
                  </time>
                </button>
              </div>
            ))}
        </section>
        {p.error && (
          <p className="notice notice-error" role="alert">
            {p.error}
          </p>
        )}
      </main>
    </Shell>
  );
}
