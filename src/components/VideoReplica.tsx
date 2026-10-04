import {
  Check,
  Film,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import type {
  AvatarAssetSelection,
  VideoReplicaJob,
  VideoReplicaStoryboardItem,
} from "../types";
import { fileUrl, isPending, userFacingError } from "../utils/assets";
import { Shell } from "./Shell";
import { SettingsSelect } from "./SettingsSelect";
import { VideoReplicaPreview } from "./VideoReplicaPreview";
import { VideoWorksList } from "./VideoWorksList";
import { AvatarPicker } from "./AvatarPicker";
import "./VideoReplica.css";
import "./VideoReplicaShared.css";

const defaultStoryboard: VideoReplicaStoryboardItem[] = [];

export function VideoReplica() {
  const location = useLocation();
  const { id: routeJobID } = useParams<{ id: string }>();
  const requireAiAuth = useRequireAiAuth();
  const [sourcePath, setSourcePath] = useState("");
  const [sourcePreview, setSourcePreview] = useState("");
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  const [productReferencePath, setProductReferencePath] = useState("");
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetSelection[]>([]);
  const [jobs, setJobs] = useState<VideoReplicaJob[]>([]);
  const [selected, setSelected] = useState<VideoReplicaJob | null>(null);
  const [storyboard, setStoryboard] =
    useState<VideoReplicaStoryboardItem[]>(defaultStoryboard);
  const [model, setModel] = useState("seedance-2.5");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(30);
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("480p");
  const [busy, setBusy] = useState("");
  const [videoReadProgress, setVideoReadProgress] = useState<number | null>(
    null,
  );
  const [error, setError] = useState("");
  const [review, setReview] = useState<{
    score: number;
    issues: string[];
    optimized_prompt: string;
    source: string;
  } | null>(null);
  const templatePresentation = [
    [
      "hero-image",
      "产品种草",
      "/template-previews/hero-image.jpg",
      "用清晰的产品镜头制作一条有质感的种草短片。",
    ],
    [
      "lifestyle-scene",
      "旅行片段",
      "/template-previews/lifestyle-scene.jpg",
      "制作一条自然、有呼吸感的旅行生活方式短片。",
    ],
    [
      "ugc-style",
      "人物故事",
      "/template-previews/ugc-style.jpg",
      "制作一条真实自然的人物故事短片，突出情绪和细节。",
    ],
  ] as const;

  const operationError = (reason: unknown, fallback: string) =>
    userFacingError(reason instanceof Error ? reason.message : "", fallback);

  function selectJob(job: VideoReplicaJob) {
    if (job.task_type === "ai_replica") {
      setError("该作品属于 AI 复刻，请从 AI 复刻页面打开。");
      return;
    }
    setSelected(job);
    setSourcePath(job.source_video_path);
    setSourcePreview(fileUrl(job.source_video_path));
    setReferencePaths(job.reference_paths);
    setProductReferencePath(job.product_reference_path);
    setAvatarAssets(job.avatar_assets ?? []);
    setStoryboard(job.storyboard);
    setPrompt(job.prompt);
    setReview(null);
    setModel(
      job.model === "doubao-seedance-2.0-mini"
        ? "seedance-2.0"
        : "seedance-2.5",
    );
    setDuration(job.duration);
    setRatio(job.ratio);
    setResolution(job.resolution);
  }

  function clearDeletedJob(job: VideoReplicaJob) {
    if (selected?.id === job.id) setSelected(null);
  }

  async function load() {
    try {
      const result = await client.videoReplicaJobs(48, 0);
      const regularJobs = result.items.filter(
        (item) => item.task_type !== "ai_replica",
      );
      setJobs(regularJobs);
      if (selected) {
        const fresh = regularJobs.find((item) => item.id === selected.id);
        if (fresh)
          selectJob({
            ...fresh,
            // The list response is local-only; do not discard hydrated remote
            // stdout/stderr while a status refresh is in flight or after stop.
            skill2api: selected.skill2api,
          });
      }
    } catch (reason) {
      setError(operationError(reason, "无法加载视频任务"));
    }
  }

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const jobID =
      routeJobID || (location.state as { jobId?: string } | null)?.jobId;
    if (!jobID) return;
    void client
      .videoReplicaJob(jobID)
      .then((job) => {
        selectJob(job);
      })
      .catch((reason) => setError(operationError(reason, "无法打开视频作品")));
  }, [location.state, routeJobID]);
  useEffect(() => {
    if (!jobs.some((job) => isPending(job.status))) return;
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [jobs.map((job) => `${job.id}:${job.status}`).join("|")]);

  async function uploadVideo(file: File) {
    setBusy("upload");
    setVideoReadProgress(0);
    setError("");
    try {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (event) => {
          if (event.lengthComputable)
            setVideoReadProgress(
              Math.round((event.loaded / event.total) * 100),
            );
        };
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) resolve(reader.result);
          else reject(new Error("无法读取视频文件"));
        };
        reader.onerror = () =>
          reject(reader.error || new Error("无法读取视频文件"));
        reader.readAsArrayBuffer(file);
      });
      setVideoReadProgress(null);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      );
      const data = Array.from(new Uint8Array(buffer));
      const result = await client.uploadVideoReplicaVideo(
        file.name,
        file.type,
        data,
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
    if (referencePaths.length >= 4) return;
    setBusy("reference");
    setError("");
    try {
      const result = await client.upload(file);
      setReferencePaths((paths) => [...paths, result.path]);
      setProductReferencePath((path) => path || result.path);
    } catch (reason) {
      setError(operationError(reason, "添加图片失败"));
    } finally {
      setBusy("");
    }
  }

  async function analyze() {
    if (!sourcePath) {
      setError("请先选择原视频");
      return;
    }
    setBusy("analyze");
    setError("");
    try {
      const result = await client.analyzeVideoReplica(
        sourcePath,
        referencePaths,
        productReferencePath,
      );
      setStoryboard(result.storyboard || []);
      setPrompt(
        result.storyboard
          .map(
            (item) =>
              `${item.start}-${item.end}秒：${item.shot}。${item.action}${item.dialogue ? ` 对白：${item.dialogue}` : ""}`,
          )
          .join("\n"),
      );
    } catch (reason) {
      setError(operationError(reason, "视频分析失败"));
    } finally {
      setBusy("");
    }
  }

  async function reviewPrompt() {
    if (!prompt.trim()) {
      setError("请先填写要审核的描述");
      return;
    }
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
    if (!sourcePath || !prompt.trim()) {
      setError("请先选择原视频并确认复刻脚本");
      return;
    }
    setBusy("create");
    setError("");
    try {
      const result = await client.createVideoReplica({
        source_video_path: sourcePath,
        reference_paths: referencePaths,
        product_reference_path: productReferencePath,
        model,
        prompt,
        storyboard,
        duration,
        resolution,
        ratio,
        avatar_assets: avatarAssets,
      });
      await load();
      const fresh = await client.videoReplicaJob(result.id);
      selectJob(fresh);
    } catch (reason) {
      setError(operationError(reason, "创建视频任务失败"));
    } finally {
      setBusy("");
    }
  }

  function updateStoryboardItem(index: number, field: "audio", value: string) {
    setStoryboard((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  }

  function removeReference(path: string) {
    setReferencePaths((items) => {
      const next = items.filter((item) => item !== path);
      setProductReferencePath((current) =>
        current === path ? next[0] || "" : current,
      );
      return next;
    });
  }

  async function regenerate(id: string) {
    setBusy(id);
    setError("");
    try {
      await client.regenerateVideoReplica(id);
      await load();
      await load();
    } catch (reason) {
      setError(operationError(reason, "重新生成失败"));
    } finally {
      setBusy("");
    }
  }

  async function exportVideo(path: string) {
    setBusy("export");
    setError("");
    try {
      await client.downloadAsset(path);
    } catch (reason) {
      setError(operationError(reason, "导出视频失败"));
    } finally {
      setBusy("");
    }
  }

  const sourceReady = Boolean(sourcePath);
  const scriptReady = Boolean(prompt.trim());
  const maxSegmentDuration = model === "seedance-2.0" ? 15 : 30;
  const durationOptions = [5, 10, 15, 30, 60, 120, 180, 300];
  const stepStatus = (step: number) =>
    (step === 1 && sourceReady) ||
    (step === 2 && scriptReady) ||
    (step === 3 && Boolean(selected))
      ? "done"
      : "";
  return (
    <Shell>
      <header className="workspace-header video-replica-header">
        <div className="video-replica-title">
          <span className="eyebrow">AI VIDEO STUDIO</span>
          <h1>视频复刻</h1>
          <p>
            选择一条本机视频，复刻它的节奏、镜头和动作，生成属于你的新版本。
          </p>
        </div>
      </header>
      <main className="video-replica">
        <div className="video-replica-workbench">
          <section className="video-replica-editor">
            <div
              className={`video-replica-panel workflow-panel ${stepStatus(1)}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">1</div>
                <div>
                  <span className="step-kicker">素材</span>
                  <h2>选择原视频</h2>
                  <p>从本机选择一段要复刻的视频。</p>
                </div>
                <span className="step-state">
                  {busy === "upload"
                    ? "正在添加"
                    : sourceReady
                      ? "已添加"
                      : "待选择"}
                </span>
              </div>
              <div
                className={`video-upload-box ${sourceReady && busy !== "upload" ? "has-video" : ""}`}
              >
                {busy === "upload" ? (
                  <div
                    className="video-upload-status"
                    role="status"
                    aria-live="polite"
                  >
                    <LoaderCircle
                      className="spin"
                      size={30}
                      aria-hidden="true"
                    />
                    <strong>
                      {videoReadProgress === null
                        ? "正在保存并校验视频…"
                        : `正在读取视频 ${videoReadProgress}%`}
                    </strong>
                    {videoReadProgress !== null && (
                      <progress
                        value={videoReadProgress}
                        max={100}
                        aria-label="读取视频进度"
                      />
                    )}
                  </div>
                ) : sourcePreview ? (
                  <>
                    <video
                      src={sourcePreview}
                      controls
                    />
                    <label className="video-reselect-action">
                      <Upload size={15} />
                      重新选择
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void uploadVideo(file);
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <label className="video-upload-prompt">
                    <Film size={30} />
                    <strong>点击选择本机视频</strong>
                    <span>MP4 / WebM / MOV · 时长不限</span>
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadVideo(file);
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="reference-row">
                <div>
                  <strong>参考素材</strong>
                  <span>选择主产品图；其余图片只补充人物、场景或风格</span>
                </div>
                <div className="reference-thumbs">
                  {referencePaths.map((path) => {
                    const isProductReference = productReferencePath === path;
                    return (
                      <div className="reference-thumb" key={path}>
                        <button
                          type="button"
                          className={
                            isProductReference
                              ? "product-reference active"
                              : "product-reference"
                          }
                          aria-pressed={isProductReference}
                          aria-label={
                            isProductReference
                              ? "当前主产品参考图"
                              : "设为主产品参考图"
                          }
                          onClick={() => setProductReferencePath(path)}
                        >
                          <img src={fileUrl(path)} alt="" />
                          <span>
                            {isProductReference ? "主产品" : "设为主图"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="reference-remove"
                          aria-label="移除参考图"
                          onClick={() => removeReference(path)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                  {referencePaths.length < 4 && (
                    <label className="reference-add">
                      <Upload size={17} />
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadReference(file);
                        }}
                      />
                      添加图片
                    </label>
                  )}
                </div>
              </div>
              <div className="reference-row avatar-reference-row">
                <div>
                  <strong>虚拟人</strong>
                  <span>可选，作为人物一致性参考</span>
                </div>
                <AvatarPicker
                  value={avatarAssets}
                  onChange={setAvatarAssets}
                  disabled={!!busy || isPending(selected?.status || "")}
                  embedded
                />
              </div>
              <button
                className="button secondary workflow-action"
                type="button"
                disabled={!sourcePath || !!busy}
                onClick={() => void analyze()}
              >
                {busy === "analyze" ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                AI 分析并生成分镜
              </button>
            </div>
            <div
              className={`video-replica-panel workflow-panel ${stepStatus(2)}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">2</div>
                <div>
                  <span className="step-kicker">内容</span>
                  <h2>描述你要复刻的内容</h2>
                  <p>写下主题、产品或人物，AI 会匹配参考视频的结构。</p>
                </div>
                <span className="step-state">{prompt.length}/2000</span>
              </div>
              <textarea
                className="video-script"
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setReview(null);
                }}
                placeholder="例如：为一款轻便的随行咖啡杯制作 15 秒种草短片，强调通勤、保温和极简设计。"
              />
              <div className="prompt-review-actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={!!busy || !prompt.trim()}
                  onClick={() => void reviewPrompt()}
                >
                  {busy === "review" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  AI审核
                </button>
                <span>检查描述完整性并生成优化稿</span>
              </div>
              {review && (
                <div className="prompt-review" role="status">
                  <div className="prompt-review-head">
                    <strong>审核评分 {review.score}/100</strong>
                    <span>
                      {review.source === prompt
                        ? "审核结果"
                        : "内容已变化，请重新审核"}
                    </span>
                  </div>
                  {review.issues.length > 0 && (
                    <ul>
                      {review.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  <div className="prompt-review-copy">
                    <small>优化稿</small>
                    <p>{review.optimized_prompt}</p>
                  </div>
                  <div className="prompt-review-actions">
                    <button
                      className="button primary"
                      type="button"
                      disabled={review.source !== prompt}
                      onClick={adoptReview}
                    >
                      <Check size={16} />
                      采用优化稿
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => setReview(null)}
                    >
                      保留当前内容
                    </button>
                  </div>
                </div>
              )}
              {storyboard.length > 0 && (
                <div className="storyboard-list">
                  {storyboard.map((item, index) => (
                    <div
                      className="storyboard-item"
                      key={`${item.start}-${index}`}
                    >
                      <b>
                        {item.start}-
                        {Number.isFinite(item.end) ? item.end : "?"}s
                      </b>
                      <span>{item.shot}</span>
                      <small>{item.action}</small>
                      <label>
                        音频
                        <textarea
                          value={item.audio || ""}
                          onChange={(event) =>
                            updateStoryboardItem(
                              index,
                              "audio",
                              event.target.value,
                            )
                          }
                          placeholder="对白、环境声、音效或配乐意图"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div
              className={`video-replica-panel workflow-panel ${stepStatus(3)}`}
            >
              <div className="workflow-step-head">
                <div className="step-number">3</div>
                <div>
                  <span className="step-kicker">设置</span>
                  <h2>选择视频参数</h2>
                  <p>选择画幅、时长、模型和清晰度。</p>
                </div>
                <span className="step-state">单段上限 {maxSegmentDuration} 秒</span>
              </div>
              <div className="video-controls">
                <label>
                  模型
                  <SettingsSelect
                    name="video-model"
                    value={model}
                    options={[
                      { value: "seedance-2.5", label: "Seedance 2.5" },
                      { value: "seedance-2.0", label: "Seedance 2.0" },
                    ]}
                    onChange={setModel}
                  />
                </label>
                <label>
                  画面比例
                  <SettingsSelect
                    name="video-ratio"
                    value={ratio}
                    options={["16:9", "9:16", "1:1", "adaptive"].map(
                      (value) => ({ value, label: value }),
                    )}
                    onChange={setRatio}
                  />
                </label>
                <label>
                  视频时长
                  <SettingsSelect
                    name="video-duration"
                    value={String(duration)}
                    options={durationOptions.map((value) => ({
                      value: String(value),
                      label: `${value} 秒 · ${Math.ceil(value / maxSegmentDuration)} 段`,
                    }))}
                    onChange={(value) => setDuration(Number(value))}
                  />
                </label>
                <label>
                  清晰度
                  <SettingsSelect
                    name="video-resolution"
                    value={resolution}
                    options={["480p", "720p"].map((value) => ({
                      value,
                      label: value,
                    }))}
                    onChange={setResolution}
                  />
                </label>
              </div>
              <p className="video-audio-note">
                Seedance
                原生音频已启用，将根据每段分镜生成同步对白、环境声、音效和配乐。
              </p>
              <button
                className="button primary workflow-action"
                type="button"
                disabled={
                  !!busy ||
                  !sourcePath ||
                  !prompt.trim()
                }
                onClick={() => void create()}
              >
                {busy === "create" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                生成复刻视频
              </button>
            </div>
          </section>
          <VideoReplicaPreview
            selected={selected}
            duration={duration}
            busy={busy}
            mediaRefreshToken={0}
            regenerate={regenerate}
            exportVideo={exportVideo}
          />
        </div>
        <section className="video-template-section">
          <div className="template-section-heading">
            <div>
              <span className="eyebrow">START EASIER</span>
              <h2>从精选模板开始</h2>
            </div>
            <a href="/templates" className="text-link">
              查看全部 <span aria-hidden="true">→</span>
            </a>
          </div>
          <div className="video-template-grid">
            {templatePresentation.map(([id, name, image, description]) => (
              <article className="video-template-card" key={id}>
                <img src={image} alt="" />
                <span className="video-template-card-copy">
                  <strong>{name}</strong>
                  <small>{description}</small>
                </span>
              </article>
            ))}
          </div>
        </section>
        <section className="video-replica-history">
          <div className="video-replica-panel-head">
            <h2>历史任务</h2>
            <span>{jobs.length} 条</span>
          </div>
          <VideoWorksList
            jobs={jobs}
            tab="video-replica"
            selectedID={selected?.id}
            empty={
              <div className="video-history-empty">
                还没有视频作品，完成一次生成后会自动保存在这里。
              </div>
            }
            onSelect={selectJob}
            management={{ onRefresh: load, onDeleted: clearDeletedJob }}
          />
        </section>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
      </main>
    </Shell>
  );
}
