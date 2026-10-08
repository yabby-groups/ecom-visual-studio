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
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useLocation, useParams } from "react-router-dom";
import type { AvatarAssetSelection, VideoReplicaJob } from "../types";
import {
  fileUrl,
  isPending,
  statusText,
  userFacingError,
} from "../utils/assets";
import { useRequireAiAuth } from "../auth";
import { Shell } from "./Shell";
import { SettingsSelect } from "./SettingsSelect";
import { client } from "../api";
import { aiVideoReplicaControls } from "../utils/aiVideoReplicaState";
import { VideoReplicaPreview } from "./VideoReplicaPreview";
import { VideoWorksList } from "./VideoWorksList";
import { Pagination } from "./Pagination";
import { ConfirmDialog } from "./ConfirmDialog";
import { AvatarPicker } from "./AvatarPicker";
import "./AIVideoReplica.css";
import "./VideoReplicaShared.css";

type Review = {
  score: number;
  issues: string[];
  optimized_prompt: string;
  source: string;
};
type PendingConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => Promise<void>;
};
type Props = {
  sourceReady: boolean;
  sourcePreview: string;
  hasProductReferences: boolean;
  scriptReady: boolean;
  busy: string;
  videoReadProgress: number | null;
  productReferencePaths: string[];
  avatarAssets: AvatarAssetSelection[];
  prompt: string;
  budget: number;
  aiModel: string;
  seedanceModel: string;
  ratio: string;
  resolution: string;
  review: Review | null;
  selected: VideoReplicaJob | null;
  error: string;
  jobs: VideoReplicaJob[];
  setPrompt: Dispatch<SetStateAction<string>>;
  setReview: Dispatch<SetStateAction<Review | null>>;
  setBudget: Dispatch<SetStateAction<number>>;
  setAiModel: Dispatch<SetStateAction<string>>;
  setSeedanceModel: Dispatch<SetStateAction<string>>;
  setRatio: Dispatch<SetStateAction<string>>;
  setResolution: Dispatch<SetStateAction<string>>;
  setReferencePaths: Dispatch<SetStateAction<string[]>>;
  setAvatarAssets: Dispatch<SetStateAction<AvatarAssetSelection[]>>;
  uploadVideo: (file: File) => void;
  uploadReference: (file: File) => void;
  reviewPrompt: () => void;
  adoptReview: () => void;
  create: () => void;
  regenerate: (id: string) => void;
  exportVideo: (path: string) => void;
  selectJob: (job: VideoReplicaJob) => void;
  resumeTask: (
    id: string,
    answer: string,
    instruction: string,
  ) => Promise<boolean>;
  terminateTask: (id: string) => Promise<void>;
  pullResult: (id: string) => Promise<boolean>;
  refreshRemoteStatus: (id: string) => Promise<void>;
  refreshJobs: () => Promise<void>;
  clearDeletedJob: (job: VideoReplicaJob) => void;
  pullingResult: boolean;
  terminating: boolean;
  resuming: boolean;
  refreshingRemoteStatus: boolean;
};

export function AIVideoReplica() {
  const location = useLocation();
  const { id: routeJobID } = useParams<{ id: string }>();
  const requireAiAuth = useRequireAiAuth();
  const [sourcePath, setSourcePath] = useState("");
  const [sourcePreview, setSourcePreview] = useState("");
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetSelection[]>([]);
  const [prompt, setPrompt] = useState("");
  const [budget, setBudget] = useState(2);
  const [aiModel, setAiModel] = useState("qwen3.8-flash");
  const [seedanceModel, setSeedanceModel] = useState(
    "doubao-seedance-2.0-mini",
  );
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("480p");
  const [jobs, setJobs] = useState<VideoReplicaJob[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [selected, setSelected] = useState<VideoReplicaJob | null>(null);
  const [busy, setBusy] = useState("");
  const [videoReadProgress, setVideoReadProgress] = useState<number | null>(
    null,
  );
  const [error, setError] = useState("");
  const [terminatingID, setTerminatingID] = useState("");
  const [resumingID, setResumingID] = useState("");
  const [pullingResultID, setPullingResultID] = useState("");
  const [mediaRefreshToken, setMediaRefreshToken] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [answer, setAnswer] = useState("");
  const [instruction, setInstruction] = useState("");
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [refreshingRemoteStatusID, setRefreshingRemoteStatusID] = useState("");
  const [logTab, setLogTab] = useState<"stdout" | "stderr" | "files">("stdout");
  const [fileBusy, setFileBusy] = useState("");
  const [fileError, setFileError] = useState("");
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const operationError = (reason: unknown, fallback: string) =>
    userFacingError(reason instanceof Error ? reason.message : "", fallback);
  function askConfirmation(confirmation: PendingConfirmation) {
    setConfirmationError("");
    setPendingConfirmation(confirmation);
  }
  async function confirmPendingAction() {
    if (!pendingConfirmation || confirmationLoading) return;
    setConfirmationLoading(true);
    setConfirmationError("");
    try {
      await pendingConfirmation.run();
      setPendingConfirmation(null);
    } catch (reason) {
      setConfirmationError(operationError(reason, "操作失败，请重试"));
    } finally {
      setConfirmationLoading(false);
    }
  }
  function selectJob(job: VideoReplicaJob) {
    if (job.task_type !== "ai_replica") {
      setError("该作品属于普通复刻，请从普通视频复刻页面打开。");
      return;
    }
    setSelected(job);
    setSourcePath(job.source_video_path);
    setSourcePreview(fileUrl(job.source_video_path));
    const productPaths =
      job.reference_paths.length > 0
        ? job.reference_paths
        : job.product_reference_path
          ? [job.product_reference_path]
          : [];
    setReferencePaths(productPaths);
    setAvatarAssets(job.avatar_assets ?? []);
    setPrompt(job.prompt);
    setBudget(job.ai_budget ?? 2);
    setAiModel(job.model);
    setSeedanceModel(job.seedance_model || "doubao-seedance-2.0-mini");
    setRatio(job.ratio);
    setResolution(job.resolution);
    setReview(null);
  }
  function clearDeletedJob(job: VideoReplicaJob) {
    if (selected?.id === job.id) setSelected(null);
  }
  async function load(requestedPage = historyPage) {
    try {
      const result = await client.videoReplicaJobs(
        20,
        (requestedPage - 1) * 20,
        "ai_replica",
      );
      if (requestedPage > 1 && result.items.length === 0) {
        setHistoryPage(Math.max(1, Math.ceil(result.total / 20)));
        return;
      }
      const aiJobs = result.items;
      setJobs(aiJobs);
      setHistoryTotal(result.total);
      if (selected) {
        const fresh = aiJobs.find((job) => job.id === selected.id);
        if (fresh) selectJob({ ...fresh, skill2api: selected.skill2api });
      }
    } catch (reason) {
      setError(operationError(reason, "无法加载 AI 复刻任务"));
    }
  }
  useEffect(() => void load(), [historyPage]);
  useEffect(() => {
    const jobID =
      routeJobID || (location.state as { jobId?: string } | null)?.jobId;
    if (!jobID) return;
    void client
      .videoReplicaJob(jobID)
      .then(selectJob)
      .catch((reason) => setError(operationError(reason, "无法打开视频作品")));
  }, [location.state, routeJobID]);
  useEffect(() => {
    if (!jobs.some((job) => isPending(job.status))) return;
    const timer = window.setInterval(() => {
      void load();
      jobs.forEach((job) => {
        if (isPending(job.status) && job.skill2api_request_id)
          void refreshTask(job.id);
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [jobs.map((job) => `${job.id}:${job.status}`).join("|")]);
  useEffect(() => {
    if (selected?.skill2api_request_id) void refreshTask(selected.id, true);
  }, [selected?.id]);
  useEffect(() => {
    if (!logsOpen) return;
    const { body, documentElement } = document;
    const bodyOverflow = body.style.overflow;
    const rootOverflow = documentElement.style.overflow;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.overflow = bodyOverflow;
      documentElement.style.overflow = rootOverflow;
    };
  }, [logsOpen]);
  async function refreshTask(id: string, silent = false) {
    try {
      const remote = await client.refreshAIVideoReplica(id);
      const update = (job: VideoReplicaJob) =>
        job.id === id
          ? {
              ...job,
              status: remote.status as VideoReplicaJob["status"],
              skill2api: remote,
            }
          : job;
      setSelected((current) => (current ? update(current) : current));
      setJobs((items) => items.map(update));
    } catch (reason) {
      if (!silent) setError(operationError(reason, "远程记录已过期或不可用"));
    }
  }
  async function uploadVideo(file: File) {
    setBusy("upload");
    setVideoReadProgress(0);
    setError("");
    try {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (event) =>
          event.lengthComputable &&
          setVideoReadProgress(Math.round((event.loaded / event.total) * 100));
        reader.onload = () =>
          reader.result instanceof ArrayBuffer
            ? resolve(reader.result)
            : reject(new Error("无法读取视频文件"));
        reader.onerror = () =>
          reject(reader.error || new Error("无法读取视频文件"));
        reader.readAsArrayBuffer(file);
      });
      const result = await client.uploadVideoReplicaVideo(
        file.name,
        file.type,
        Array.from(new Uint8Array(buffer)),
      );
      setSourcePath(result.path);
      setSourcePreview(fileUrl(result.path));
    } catch (reason) {
      setError(operationError(reason, "添加视频失败"));
    } finally {
      setBusy("");
      setVideoReadProgress(null);
    }
  }
  async function uploadReference(file: File) {
    setBusy("reference");
    setError("");
    try {
      const result = await client.upload(file);
      setReferencePaths((paths) => {
        return [...paths, result.path];
      });
    } catch (reason) {
      setError(operationError(reason, "添加图片失败"));
    } finally {
      setBusy("");
    }
  }
  async function reviewPrompt() {
    if (!prompt.trim()) return setError("请先填写要审核的描述");
    if (!requireAiAuth()) return;
    setBusy("review");
    setError("");
    try {
      const result = await client.reviewVideoReplicaPrompt("replica", prompt);
      setReview({ ...result, source: prompt });
    } catch (reason) {
      setError(operationError(reason, "AI 审核失败"));
    } finally {
      setBusy("");
    }
  }
  function adoptReview() {
    if (!review || review.source !== prompt) return;
    setPrompt(review.optimized_prompt);
    setReview(null);
  }
  async function create() {
    if (!requireAiAuth()) return;
    if (!prompt.trim()) return setError("请填写复刻说明");
    if (!Number.isFinite(budget) || budget <= 0)
      return setError("预算必须大于 0");
    setBusy("create");
    setError("");
    try {
      const result = await client.createAIVideoReplica({
        source_video_path: sourcePath,
        product_paths: referencePaths,
        prompt,
        model: aiModel,
        seedance_model: seedanceModel,
        resolution,
        ratio,
        budget,
        avatar_assets: avatarAssets,
      });
      setHistoryPage(1);
      await load(1);
      selectJob(await client.videoReplicaJob(result.id));
    } catch (reason) {
      setError(operationError(reason, "创建 AI 复刻任务失败"));
      throw reason;
    } finally {
      setBusy("");
    }
  }
  async function regenerate(id: string) {
    const job = jobs.find((item) => item.id === id);
    if (!job) return;
    setBusy(id);
    setError("");
    try {
      const result = await client.createAIVideoReplica({
        source_video_path: job.source_video_path,
        product_paths:
          job.reference_paths.length > 0
            ? job.reference_paths
            : [job.product_reference_path].filter(Boolean),
        prompt: job.prompt,
        model: job.model,
        seedance_model: job.seedance_model || "doubao-seedance-2.0-mini",
        resolution: job.resolution,
        ratio: job.ratio,
        budget: job.ai_budget ?? budget,
        avatar_assets: job.avatar_assets ?? [],
      });
      setHistoryPage(1);
      await load(1);
      selectJob(await client.videoReplicaJob(result.id));
    } catch (reason) {
      setError(operationError(reason, "重新生成失败"));
      throw reason;
    } finally {
      setBusy("");
    }
  }
  async function resumeTask(
    id: string,
    answerValue: string,
    instructionValue: string,
  ) {
    setResumingID(id);
    setError("");
    try {
      await client.resumeAIVideoReplica(id, answerValue, instructionValue);
      await load();
      return true;
    } catch (reason) {
      setError(operationError(reason, "无法继续任务"));
      throw reason;
    } finally {
      setResumingID("");
    }
  }
  async function terminateTask(id: string) {
    setTerminatingID(id);
    setError("");
    try {
      const result = await client.terminateAIVideoReplica(id);
      await load();
      if (typeof result.remote_error === "string")
        throw new Error(result.remote_error);
    } catch (reason) {
      setError(operationError(reason, "无法终止任务"));
      throw reason;
    } finally {
      setTerminatingID("");
    }
  }
  async function pullResult(id: string) {
    setPullingResultID(id);
    setError("");
    try {
      const ok = await client.pullAIVideoReplicaResult(id);
      if (!ok) throw new Error("远端结果尚未保存");
      selectJob(await client.videoReplicaJob(id));
      if (ok) setMediaRefreshToken((value) => value + 1);
      await load();
      return ok;
    } catch (reason) {
      setError(operationError(reason, "无法拉取远程结果"));
      throw reason;
    } finally {
      setPullingResultID("");
    }
  }
  async function exportVideo(path: string) {
    setBusy("export");
    setError("");
    try {
      await client.downloadAsset(path);
    } catch (reason) {
      setError(operationError(reason, "导出视频失败"));
      throw reason;
    } finally {
      setBusy("");
    }
  }
  async function downloadFile(path: string) {
    if (!selected) return;
    setFileBusy(path);
    setFileError("");
    try {
      if (!(await client.downloadAIVideoReplicaFile(selected.id, path)))
        throw new Error("文件未保存");
    } catch (reason) {
      setFileError(String(reason));
      throw reason;
    } finally {
      setFileBusy("");
    }
  }
  async function openLogs() {
    if (!selected) return;
    setLogsLoading(true);
    try {
      await refreshTask(selected.id);
      setLogsOpen(true);
    } finally {
      setLogsLoading(false);
    }
  }
  async function refreshRemoteStatus(id: string) {
    setRefreshingRemoteStatusID(id);
    setError("");
    try {
      await refreshTask(id);
    } finally {
      setRefreshingRemoteStatusID("");
    }
  }
  const p: Props = {
    sourceReady: Boolean(sourcePath),
    sourcePreview,
    hasProductReferences: referencePaths.length > 0,
    scriptReady: Boolean(prompt.trim()),
    busy,
    videoReadProgress,
    productReferencePaths: referencePaths,
    avatarAssets,
    prompt,
    budget,
    aiModel,
    seedanceModel,
    ratio,
    resolution,
    review,
    selected,
    error,
    jobs,
    setPrompt,
    setReview,
    setBudget,
    setAiModel,
    setSeedanceModel,
    setRatio,
    setResolution,
    setReferencePaths,
    setAvatarAssets,
    uploadVideo,
    uploadReference,
    reviewPrompt,
    adoptReview,
    create,
    regenerate,
    exportVideo,
    selectJob,
    resumeTask,
    terminateTask,
    pullResult,
    refreshRemoteStatus,
    refreshJobs: load,
    clearDeletedJob,
    pullingResult: pullingResultID === selected?.id,
    terminating: terminatingID === selected?.id,
    resuming: resumingID === selected?.id,
    refreshingRemoteStatus: refreshingRemoteStatusID === selected?.id,
  };
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
  const controls = aiVideoReplicaControls({
    status: p.selected?.status,
    requestID: p.selected?.skill2api_request_id,
    busy: !!p.busy,
    resuming: p.resuming,
    terminating: p.terminating,
  });
  const invalidBudget = !Number.isFinite(p.budget) || p.budget <= 0;
  const createDisabled =
    controls.draftLocked || !p.scriptReady || invalidBudget;
  const aiProgress = p.selected && (
    <div className="video-generation-progress ai-progress" aria-live="polite">
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
  );
  const aiTaskConsole = p.selected?.task_type === "ai_replica" && (
    <>
      <div className="video-replica-panel skill2api-console" aria-live="polite">
        <strong>任务控制台</strong>
        <div className="prompt-review-actions">
          {controls.waitingForInput ? (
            <>
              <input
                value={answer}
                disabled={!controls.canAnswer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={p.selected.skill2api?.question || "请输入回答"}
              />
              <button
                className="button primary"
                type="button"
                disabled={!answer.trim() || !controls.canAnswer}
                onClick={() => {
                  const answerValue = answer;
                  askConfirmation({
                    title: "确认提交回答？",
                    message: "提交后将把当前回答发送给远端 AI 复刻任务。",
                    confirmLabel: "确认提交",
                    run: async () => {
                      if (await p.resumeTask(p.selected!.id, answerValue, ""))
                        setAnswer("");
                    },
                  });
                }}
              >
                {p.resuming ? "正在提交" : "提交"}
              </button>
            </>
          ) : controls.canResume ? (
            <>
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="追加题词（可选）"
              />
              <button
                className="button secondary"
                type="button"
                disabled={!controls.canResume}
                onClick={() => {
                  const instructionValue = instruction;
                  askConfirmation({
                    title: "确认追加题词并恢复？",
                    message: instructionValue.trim()
                      ? `将追加“${instructionValue.trim()}”并继续远端任务。`
                      : "将继续执行当前远端任务。",
                    confirmLabel: "确认恢复",
                    run: async () => {
                      if (
                        await p.resumeTask(p.selected!.id, "", instructionValue)
                      )
                        setInstruction("");
                    },
                  });
                }}
              >
                {p.resuming ? "正在恢复" : "恢复任务"}
              </button>
            </>
          ) : null}
          {p.resuming && (
            <span className="generation-progress-detail" role="status">
              正在恢复远端任务…
            </span>
          )}
          {controls.canTerminate && (
            <button
              className="button secondary"
              type="button"
              disabled={!controls.canTerminate}
              onClick={() =>
                askConfirmation({
                  title: "确认终止任务？",
                  message:
                    "终止后任务将停止执行，后续只能通过恢复或再次生成继续。",
                  confirmLabel: "确认终止",
                  run: () => p.terminateTask(p.selected!.id),
                })
              }
            >
              <X size={16} />
              {p.terminating ? "正在终止" : "终止"}
            </button>
          )}
          {controls.canPullResult && (
            <button
              className="button primary"
              type="button"
              disabled={p.pullingResult}
              onClick={() =>
                askConfirmation({
                  title: "确认重新拉取结果？",
                  message: "将从远端重新获取生成结果并保存到本机。",
                  confirmLabel: "确认拉取",
                  run: async () => {
                    await p.pullResult(p.selected!.id);
                  },
                })
              }
            >
              <Download size={16} />
              {p.pullingResult
                ? "正在重新拉取"
                : p.selected.file_path
                  ? "重新拉取结果"
                  : "手动拉取结果"}
            </button>
          )}
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={p.refreshingRemoteStatus || !controls.canOpenLogs}
          onClick={() => void p.refreshRemoteStatus(p.selected!.id)}
        >
          <RefreshCw size={16} />
          {p.refreshingRemoteStatus ? "正在刷新远端状态" : "刷新远端状态"}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={logsLoading || !controls.canOpenLogs}
          onClick={() => void openLogs()}
        >
          <Terminal size={16} />
          {logsLoading ? "正在读取日志" : "查看运行日志"}
        </button>
        {!p.selected.skill2api_request_id && (
          <small>该历史任务尚未关联远程请求，请使用“再次生成”恢复。</small>
        )}
      </div>
      {logsOpen &&
        createPortal(
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
                      onClick={() =>
                        askConfirmation({
                          title: "确认下载远程文件？",
                          message: `将把“${path}”下载并保存到本机。`,
                          confirmLabel: "确认下载",
                          run: () => downloadFile(path),
                        })
                      }
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
                        ? p.selected.skill2api?.stderr || "远程错误输出不可用"
                        : p.selected.skill2api?.files?.join("\n") ||
                          "远程文件列表不可用"}
                  </pre>
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
  return (
    <Shell>
      <header className="workspace-header video-replica-header">
        <div className="video-replica-title">
          <span className="eyebrow">AI VIDEO STUDIO / QUICK REPLACE</span>
          <h1>AI 复刻</h1>
          <p>可选原视频复刻节奏和镜头，或直接按描述与素材生成新版本。</p>
        </div>
      </header>
      <main className="video-replica">
        <div className="video-replica-workbench">
          <section className="video-replica-editor">
            <div className="video-replica-panel ai-workflow-intro">
              <span className="step-kicker">QUICK WORKFLOW</span>
              <h2>三步完成一次 AI 复刻</h2>
              <p>按需添加参考视频和商品图，描述目标内容后开始生成。</p>
            </div>
            <div
              className={`video-replica-panel workflow-panel ${p.sourceReady ? "done" : ""}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">1</div>
                <div>
                  <span className="step-kicker">素材 01</span>
                  <h2>添加参考视频（可选）</h2>
                  <p>添加本机视频以保留镜头节奏和动作；不选则按描述生成。</p>
                </div>
                <span className="step-state">
                  {p.busy === "upload"
                    ? "正在添加"
                    : p.sourceReady
                      ? "已添加"
                      : "可选"}
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
                    <label
                      className={`video-replace-action ${controls.draftLocked ? "is-disabled" : ""}`}
                    >
                      <Upload size={15} />
                      重新选择
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        disabled={controls.draftLocked}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) p.uploadVideo(f);
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <label
                    className={`video-upload-prompt ${controls.draftLocked ? "is-disabled" : ""}`}
                  >
                    <Film size={30} />
                    <strong>点击选择参考视频（可选）</strong>
                    <span>支持 MP4 / WebM / MOV，具体限制由所选模型决定</span>
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      disabled={controls.draftLocked}
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
              className={`video-replica-panel workflow-panel ${p.hasProductReferences ? "done" : ""}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">2</div>
                <div>
                  <span className="step-kicker">素材 02</span>
                  <h2>添加商品图片（可选）</h2>
                  <p>可添加同一商品的多个角度或细节，第一张作为主参考图。</p>
                </div>
                <span className="step-state">
                  {p.hasProductReferences
                    ? `已添加 ${p.productReferencePaths.length} 张`
                    : "可选"}
                </span>
              </div>
              <div className="reference-thumbs ai-product-thumb">
                {p.productReferencePaths.map((path, index) => (
                  <div className="reference-thumb" key={path}>
                    <div className="product-reference active">
                      <img
                        src={fileUrl(path)}
                        alt={`商品参考图 ${index + 1}`}
                      />
                    </div>
                    <button
                      type="button"
                      className="reference-remove"
                      aria-label={`移除商品图片 ${index + 1}`}
                      disabled={controls.draftLocked}
                      onClick={() => {
                        const next = p.productReferencePaths.filter(
                          (_, itemIndex) => itemIndex !== index,
                        );
                        p.setReferencePaths(next);
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {p.productReferencePaths.length < 4 && (
                  <label
                    className={`reference-add ${controls.draftLocked ? "is-disabled" : ""}`}
                  >
                    <Upload size={17} />
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={controls.draftLocked}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) p.uploadReference(f);
                      }}
                    />
                    添加商品图
                  </label>
                )}
              </div>
            </div>
            <div
              className={`video-replica-panel workflow-panel ${p.avatarAssets.length > 0 ? "done" : ""}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">3</div>
                <div>
                  <span className="step-kicker">素材 03</span>
                  <h2>选择虚拟人</h2>
                  <p>可选，作为生成视频中的人物一致性参考。</p>
                </div>
                <span className="step-state">
                  {p.avatarAssets.length > 0
                    ? `已选择 ${p.avatarAssets.length} 张`
                    : "可选"}
                </span>
              </div>
              <AvatarPicker
                value={p.avatarAssets}
                onChange={p.setAvatarAssets}
                disabled={controls.draftLocked}
                embedded
              />
            </div>
            <div
              className={`video-replica-panel workflow-panel ${p.scriptReady ? "done" : ""}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">4</div>
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
                disabled={controls.draftLocked}
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
                  disabled={controls.draftLocked || !p.prompt.trim()}
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
                      disabled={
                        controls.draftLocked || p.review.source !== p.prompt
                      }
                      onClick={p.adoptReview}
                    >
                      <Check size={16} />
                      采用优化稿
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={controls.draftLocked}
                      onClick={() => p.setReview(null)}
                    >
                      保留当前内容
                    </button>
                  </div>
                </div>
              )}
              <details className="ai-advanced-settings" open>
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
                      disabled={controls.draftLocked}
                      onChange={p.setAiModel}
                    />
                  </label>
                  <label>
                    视频生成模型
                    <SettingsSelect
                      name="ai-video-seedance-model"
                      value={p.seedanceModel}
                      options={[
                        {
                          value: "doubao-seedance-2.0-mini",
                          label: "Seedance 2.0 Mini",
                        },
                        { value: "doubao-seedance-2.0", label: "Seedance 2.0" },
                        { value: "doubao-seedance-2.5", label: "Seedance 2.5" },
                      ]}
                      disabled={controls.draftLocked}
                      onChange={p.setSeedanceModel}
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
                      disabled={controls.draftLocked}
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
                      disabled={controls.draftLocked}
                      onChange={p.setResolution}
                    />
                  </label>
                  <label>
                    预算（美元）
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={p.budget}
                      disabled={controls.draftLocked}
                      onChange={(e) => p.setBudget(Number(e.target.value))}
                    />
                  </label>
                </div>
              </details>
              <button
                className="button primary workflow-action"
                type="button"
                disabled={createDisabled}
                onClick={() =>
                  askConfirmation({
                    title: "确认开始 AI 复刻？",
                    message: `将使用 ${p.aiModel}、${p.resolution}、${p.ratio} 和 ${p.budget} 美元预算创建远端任务。`,
                    confirmLabel: "确认开始",
                    run: async () => p.create(),
                  })
                }
              >
                {p.busy === "create" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                开始 AI 复刻
              </button>
              {invalidBudget && (
                <p className="notice notice-error" role="alert">
                  预算必须大于 0。
                </p>
              )}
            </div>
          </section>
          <VideoReplicaPreview
            selected={p.selected}
            mediaRefreshToken={mediaRefreshToken}
            progress={aiProgress}
            beforeStage={aiTaskConsole}
            statusLabel={
              p.selected ? statusText(p.selected.status) : "等待生成"
            }
            emptyState={
              controls.canPullResult
                ? {
                    title: "远端结果尚未保存到本机",
                    description: "请手动拉取结果，保存完成后会显示在这里",
                  }
                : undefined
            }
            metadata={
              <>
                <span>
                  <small>参考视频</small>
                  <b>{p.sourceReady ? "已选择" : "未使用（可选）"}</b>
                </span>
                <span>
                  <small>商品参考图</small>
                  <b>{p.hasProductReferences ? "已添加" : "未添加（可选）"}</b>
                </span>
                <span>
                  <small>视频时长</small>
                  <b>
                    {p.sourceReady
                      ? `${p.selected?.duration ?? 0} 秒`
                      : "未指定"}
                  </b>
                </span>
                {p.selected?.versions[0]?.generation_duration_seconds !==
                  null &&
                  p.selected?.versions[0]?.generation_duration_seconds !==
                    undefined && (
                    <span>
                      <small>本版本生成耗时</small>
                      <b>
                        {p.selected.versions[0].generation_duration_seconds} 秒
                      </b>
                    </span>
                  )}
              </>
            }
            actions={
              p.selected && (
                <>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() =>
                      askConfirmation({
                        title: "确认再次生成？",
                        message: "将根据当前作品设置创建一个新的 AI 复刻任务。",
                        confirmLabel: "确认生成",
                        run: async () => p.regenerate(p.selected!.id),
                      })
                    }
                    disabled={!controls.canRegenerate}
                  >
                    <RefreshCw size={16} />
                    再次生成
                  </button>
                  {p.selected.file_path && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!!p.busy || controls.draftLocked}
                      onClick={() =>
                        askConfirmation({
                          title: "确认导出视频？",
                          message: "将把生成视频下载并保存到本机。",
                          confirmLabel: "确认导出",
                          run: async () => {
                            p.exportVideo(p.selected!.file_path!);
                          },
                        })
                      }
                    >
                      <Download size={16} />
                      导出视频
                    </button>
                  )}
                  {!p.selected.file_path && controls.canPullResult && (
                    <button
                      className="button primary"
                      type="button"
                      disabled={p.pullingResult}
                      onClick={() =>
                        askConfirmation({
                          title: "确认重新拉取结果？",
                          message: "将从远端重新获取生成结果并保存到本机。",
                          confirmLabel: "确认拉取",
                          run: async () => {
                            await p.pullResult(p.selected!.id);
                          },
                        })
                      }
                    >
                      <Download size={16} />
                      {p.pullingResult ? "正在拉取结果" : "手动拉取结果"}
                    </button>
                  )}
                </>
              )
            }
          />
        </div>
        <section className="video-replica-history">
          <div className="video-replica-panel-head">
            <h2>AI 复刻历史</h2>
            <span>{historyTotal} 条</span>
          </div>
          <VideoWorksList
            jobs={p.jobs}
            tab="ai-video-replica"
            empty={
              <div className="video-history-empty">
                还没有 AI 复刻作品，完成一次生成后会自动保存在这里。
              </div>
            }
            onSelect={p.selectJob}
            management={{
              onRefresh: p.refreshJobs,
              onDeleted: p.clearDeletedJob,
            }}
          />
          <Pagination
            page={historyPage}
            total={historyTotal}
            onChange={setHistoryPage}
          />
        </section>
        {p.error && (
          <p className="notice notice-error" role="alert">
            {p.error}
          </p>
        )}
      </main>
      {pendingConfirmation && (
        <ConfirmDialog
          title={pendingConfirmation.title}
          message={pendingConfirmation.message}
          confirmLabel={pendingConfirmation.confirmLabel}
          error={confirmationError}
          loading={confirmationLoading}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => void confirmPendingAction()}
        />
      )}
    </Shell>
  );
}
