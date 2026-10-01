import { Check, Download, Film, LoaderCircle, Play, RefreshCw, ShieldCheck, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import type { VideoReplicaJob, VideoReplicaStoryboardItem, VideoReplicaSegment } from "../types";
import { failureReason, fileUrl, isPending, statusText, userFacingError } from "../utils/assets";
import { Shell } from "./Shell";
import { SettingsSelect } from "./SettingsSelect";
import "./VideoReplica.css";

const defaultStoryboard: VideoReplicaStoryboardItem[] = [];

export function VideoReplica() {
  const location = useLocation();
  const requireAiAuth = useRequireAiAuth();
  const [sourcePath, setSourcePath] = useState("");
  const [sourcePreview, setSourcePreview] = useState("");
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  const [productReferencePath, setProductReferencePath] = useState("");
  const [mode, setMode] = useState<"replica" | "replace" | "ai_replica">("replica");
  const [personPrompt, setPersonPrompt] = useState("公开的虚拟人像");
  const [budget, setBudget] = useState(2);
  const [aiModel, setAiModel] = useState("qwen3.8-flash");
  const [jobs, setJobs] = useState<VideoReplicaJob[]>([]);
  const [selected, setSelected] = useState<VideoReplicaJob | null>(null);
  const [storyboard, setStoryboard] = useState<VideoReplicaStoryboardItem[]>(defaultStoryboard);
  const [model, setModel] = useState("seedance-2.5");
  const [taskType, setTaskType] = useState<"auto" | "reference" | "extend" | "replace">("reference");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(30);
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("480p");
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [videoReadProgress, setVideoReadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ score: number; issues: string[]; optimized_prompt: string; source: string } | null>(null);
  const templatePresentation = [
    ["hero-image", "产品种草", "/template-previews/hero-image.jpg", "用清晰的产品镜头制作一条有质感的种草短片。"],
    ["lifestyle-scene", "旅行片段", "/template-previews/lifestyle-scene.jpg", "制作一条自然、有呼吸感的旅行生活方式短片。"],
    ["ugc-style", "人物故事", "/template-previews/ugc-style.jpg", "制作一条真实自然的人物故事短片，突出情绪和细节。"],
  ] as const;

  const operationError = (reason: unknown, fallback: string) =>
    userFacingError(reason instanceof Error ? reason.message : "", fallback);

  function selectJob(job: VideoReplicaJob) {
    setSelected(job);
    setSourcePath(job.source_video_path);
	setSourcePreview(fileUrl(job.source_video_path));
	setReferencePaths(job.reference_paths);
	setProductReferencePath(job.product_reference_path);
    setStoryboard(job.storyboard);
    setPrompt(job.prompt);
    setReview(null);
    setModel(job.model === "doubao-seedance-2.0-mini" ? "seedance-2.0" : "seedance-2.5");
    if (job.task_type !== "ai_replica") setTaskType(job.task_type);
    setMode(job.task_type === "ai_replica" ? "ai_replica" : "replica");
    setDuration(job.duration);
    setRatio(job.ratio);
    setResolution(job.resolution);
  }

  async function load() {
    try {
      const result = await client.videoReplicaJobs();
      setJobs(result.items);
      if (selected) {
        const fresh = result.items.find((item) => item.id === selected.id);
        if (fresh) selectJob(fresh);
      }
    } catch (reason) { setError(operationError(reason, "无法加载视频任务")); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const jobID = (location.state as { jobId?: string } | null)?.jobId;
    if (!jobID) return;
    void client.videoReplicaJob(jobID).then((job) => {
      selectJob(job);
    }).catch((reason) => setError(operationError(reason, "无法打开视频作品")));
  }, [location.state]);
  useEffect(() => {
    if (!jobs.some((job) => isPending(job.status))) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [jobs.map((job) => `${job.id}:${job.status}`).join("|")]);

  async function uploadVideo(file: File) {
    setBusy("upload"); setVideoReadProgress(0); setSourceDuration(null); setError("");
    try {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (event) => {
          if (event.lengthComputable) setVideoReadProgress(Math.round(event.loaded / event.total * 100));
        };
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) resolve(reader.result);
          else reject(new Error("无法读取视频文件"));
        };
        reader.onerror = () => reject(reader.error || new Error("无法读取视频文件"));
        reader.readAsArrayBuffer(file);
      });
      setVideoReadProgress(null);
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const data = Array.from(new Uint8Array(buffer));
      const result = await client.uploadVideoReplicaVideo(file.name, file.type, data);
      setSourcePath(result.path); setSourcePreview(fileUrl(result.path));
    } catch (reason) { setError(operationError(reason, "添加视频失败")); }
    finally { setBusy(""); setVideoReadProgress(null); }
  }

  async function uploadReference(file: File) {
    if (mode === "ai_replica") setReferencePaths([]);
    if (mode !== "replace" && referencePaths.length >= 4) return;
    setBusy("reference"); setError("");
    try {
      const result = await client.upload(file);
		setReferencePaths((paths) => [...paths, result.path]);
		setProductReferencePath((path) => mode === "ai_replica" || !path ? result.path : path);
    } catch (reason) { setError(operationError(reason, "添加图片失败")); }
    finally { setBusy(""); }
  }

  async function analyze() {
    if (!sourcePath) { setError("请先选择原视频"); return; }
    setBusy("analyze"); setError("");
    try {
		const result = await client.analyzeVideoReplica(sourcePath, referencePaths, productReferencePath);
      setStoryboard(result.storyboard || []);
      setPrompt(result.storyboard.map((item) => `${item.start}-${item.end}秒：${item.shot}。${item.action}${item.dialogue ? ` 对白：${item.dialogue}` : ""}`).join("\n"));
    } catch (reason) { setError(operationError(reason, "视频分析失败")); }
    finally { setBusy(""); }
  }

  async function reviewPrompt() {
    if (!prompt.trim()) { setError("请先填写要审核的描述"); return; }
    if (!requireAiAuth()) return;
    setBusy("review"); setError("");
    try {
      const result = await client.reviewVideoReplicaPrompt(mode === "ai_replica" ? "replica" : mode, prompt);
      setReview({ ...result, source: prompt });
    } catch (reason) { setError(operationError(reason, "AI 审核失败")); }
    finally { setBusy(""); }
  }

  function adoptReview() {
    if (!review || review.source !== prompt) return;
    setPrompt(review.optimized_prompt);
    setReview(null);
  }

  async function create() {
    if (!requireAiAuth()) return;
    if (!sourcePath || !prompt.trim()) { setError(mode === "ai_replica" ? "请先选择视频并填写复刻说明" : "请先选择原视频并确认复刻脚本"); return; }
    if (mode === "ai_replica" && referencePaths.length !== 1) { setError("请添加一张商品图片"); return; }
    setBusy("create"); setError("");
    try {
      const result = mode === "ai_replica" ? await client.createAIVideoReplica({ source_video_path: sourcePath, product_path: productReferencePath || referencePaths[0], prompt, person_prompt: personPrompt, model: aiModel, resolution, ratio, budget }) : await client.createVideoReplica({ source_video_path: sourcePath, reference_paths: referencePaths, product_reference_path: productReferencePath, task_type: taskType, model, prompt, storyboard, duration, resolution, ratio });
      await load();
      const fresh = await client.videoReplicaJob(result.id);
      selectJob(fresh);
    } catch (reason) { setError(operationError(reason, "创建视频任务失败")); }
    finally { setBusy(""); }
  }

  function updateStoryboardItem(index: number, field: "audio", value: string) {
    setStoryboard((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  function removeReference(path: string) {
    setReferencePaths((items) => {
      const next = items.filter((item) => item !== path);
      setProductReferencePath((current) => current === path ? (next[0] || "") : current);
      return next;
    });
  }

  async function regenerate(id: string) {
    setBusy(id); setError("");
    try { await client.regenerateVideoReplica(id); await load(); }
    catch (reason) { setError(operationError(reason, "重新生成失败")); }
    finally { setBusy(""); }
  }

  async function exportVideo(path: string) {
    setError("");
    try { await client.downloadAsset(path); }
    catch (reason) { setError(operationError(reason, "导出视频失败")); }
  }

  const displayed = selected?.file_path ? fileUrl(selected.file_path) : "";
  const selectedLabel = useMemo(() => selected ? `${selected.model} · ${statusText(selected.status)}` : "等待生成结果", [selected]);
  const selectedFailure = selected?.status.startsWith("failed") ? failureReason(selected.status) : "";
  const sourceReady = Boolean(sourcePath);
  const scriptReady = Boolean(prompt.trim());
  const replaceReady = mode === "ai_replica" && referencePaths.length === 1;
  const maxSegmentDuration = model === "seedance-2.0" ? 15 : 30;
  const durationOptions = [5, 10, 15, 30, 60, 120, 180, 300];
  const stepStatus = (step: number) => step === 1 && sourceReady || step === 2 && scriptReady || step === 3 && Boolean(selected) ? "done" : "";
  const progress = selected?.progress;
  const segmentStatus = (segment: VideoReplicaSegment) => {
    if (segment.status.startsWith("failed")) return "失败";
    return ({ queued: "排队中", submitting: "提交中", generating: "生成中", downloading: "保存中", ready: "已完成" } as Record<string, string>)[segment.status] || segment.status;
  };
  const phaseSteps = [
    ["preparing", "准备素材"], ["generating", "生成片段"], ["downloading", "保存片段"], ["merging", "合并视频"], ["ready", "完成"],
  ] as const;
  const phaseIndex = selected ? phaseSteps.findIndex(([phase]) => phase === selected.status) : -1;
  const aiControls = mode === "ai_replica" ? <div className="video-controls ai-replica-controls"><label>人物替换说明<input value={personPrompt} onChange={(event) => setPersonPrompt(event.target.value)} /></label><label>预算（美元）<input type="number" min="0.01" step="0.01" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></label><label>执行模型<input value={aiModel} onChange={(event) => setAiModel(event.target.value)} /></label></div> : null;

  if (mode === "ai_replica") {
    const aiPhases = [["queued", "等待提交"], ["preparing", "准备素材"], ["submitting", "提交任务"], ["generating", "模型生成"], ["retrieving", "获取结果"], ["ready", "完成"]] as const;
    const aiPhaseIndex = selected ? aiPhases.findIndex(([phase]) => phase === selected.status) : -1;
    const aiFailure = selected?.status.startsWith("failed") ? failureReason(selected.status) : "";
    return <Shell>
      <header className="workspace-header video-replica-header">
        <div className="video-replica-title"><span className="eyebrow">AI VIDEO STUDIO / QUICK REPLACE</span><h1>AI 复刻</h1><p>用原视频的节奏和镜头，替换为你的商品并生成新版本。</p></div>
        <div className="video-replica-meta"><span className="workflow-badge">{selected ? statusText(selected.status) : "未开始"}</span><button className="button secondary" type="button" onClick={() => setMode("replica")}><RefreshCw size={15} />分镜复刻</button></div>
      </header>
      <main className="video-replica">
        <div className="video-replica-workbench">
          <section className="video-replica-editor">
            <div className="video-replica-panel ai-workflow-intro"><span className="step-kicker">QUICK WORKFLOW</span><h2>三步完成一次 AI 复刻</h2><p>选择视频、添加商品图、描述你要替换的内容，然后开始生成。</p></div>
            <div className={`video-replica-panel workflow-panel ${sourceReady ? "done" : ""}`}><div className="workflow-step-head"><div className="step-number">1</div><div><span className="step-kicker">素材 01</span><h2>选择原视频</h2><p>添加要保留镜头节奏和动作的本机视频。</p></div><span className="step-state">{busy === "upload" ? "正在添加" : sourceReady ? "已添加" : "待选择"}</span></div><div className={`video-upload-box ${sourceReady && busy !== "upload" ? "has-video" : ""}`}>{busy === "upload" ? <div className="video-upload-status" role="status"><LoaderCircle className="spin" size={30} /><strong>{videoReadProgress === null ? "正在保存并校验视频…" : `正在读取视频 ${videoReadProgress}%`}</strong>{videoReadProgress !== null && <progress value={videoReadProgress} max={100} aria-label="读取视频进度" />}</div> : sourcePreview ? <><video src={sourcePreview} controls /><label className="video-replace-action"><Upload size={15} />重新选择<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} /></label></> : <label className="video-upload-prompt"><Film size={30} /><strong>点击选择本机视频</strong><span>支持 MP4 / WebM / MOV，具体限制由所选模型决定</span><input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} /></label>}</div></div>
            <div className={`video-replica-panel workflow-panel ${replaceReady ? "done" : ""}`}><div className="workflow-step-head"><div className="step-number">2</div><div><span className="step-kicker">素材 02</span><h2>添加商品图片</h2><p>这张图片会作为生成视频中的目标商品外观依据。</p></div><span className="step-state">{replaceReady ? "已添加" : "待添加"}</span></div><div className="reference-thumbs ai-product-thumb">{productReferencePath ? <div className="reference-thumb"><div className="product-reference active"><img src={fileUrl(productReferencePath)} alt="商品参考图" /></div><button type="button" className="reference-remove" aria-label="移除商品图片" onClick={() => { setReferencePaths([]); setProductReferencePath(""); }}><X size={13} /></button></div> : <label className="reference-add"><Upload size={17} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); }} />添加商品图</label>}</div></div>
            <div className={`video-replica-panel workflow-panel ${scriptReady ? "done" : ""}`}><div className="workflow-step-head"><div className="step-number">3</div><div><span className="step-kicker">描述与生成</span><h2>描述替换目标</h2><p>写清楚替换对象，以及需要保留的动作、镜头、光线和背景。</p></div><span className="step-state">{prompt.length}/2000</span></div><textarea className="video-script" value={prompt} onChange={(event) => { setPrompt(event.target.value); setReview(null); }} placeholder="例如：将视频中的旧款水杯替换为商品图中的保温杯，保留原视频的手部动作、镜头运动、背景和光线。" /><div className="prompt-review-actions"><button className="button secondary" type="button" disabled={!!busy || !prompt.trim()} onClick={() => void reviewPrompt()}>{busy === "review" ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}检查描述</button><span>可选：让 AI 检查描述是否完整</span></div>{review && <div className="prompt-review" role="status"><div className="prompt-review-head"><strong>描述评分 {review.score}/100</strong><span>请确认是否采用优化稿</span></div>{review.issues.length > 0 && <ul>{review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}<div className="prompt-review-copy"><small>优化稿</small><p>{review.optimized_prompt}</p></div><div className="prompt-review-actions"><button className="button primary" type="button" disabled={review.source !== prompt} onClick={adoptReview}><Check size={16} />采用优化稿</button><button className="button secondary" type="button" onClick={() => setReview(null)}>保留当前内容</button></div></div>}<details className="ai-advanced-settings"><summary>高级设置</summary><div className="video-controls"><label>模型<SettingsSelect name="ai-video-model" value={aiModel} options={[{ value: "qwen3.8-flash", label: "Qwen 3.8 Flash" }, { value: "qwen3.8", label: "Qwen 3.8" }]} onChange={setAiModel} /></label><label>画面比例<SettingsSelect name="ai-video-ratio" value={ratio} options={["16:9", "9:16", "1:1"].map((value) => ({ value, label: value }))} onChange={setRatio} /></label><label>清晰度<SettingsSelect name="ai-video-resolution" value={resolution} options={["480p", "720p"].map((value) => ({ value, label: value }))} onChange={setResolution} /></label><label>人物说明<input value={personPrompt} onChange={(event) => setPersonPrompt(event.target.value)} placeholder="可选" /></label><label>预算（美元）<input type="number" min="0.01" step="0.01" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></label></div></details><button className="button primary workflow-action" type="button" disabled={!!busy || !sourceReady || !replaceReady || !scriptReady} onClick={() => void create()}>{busy === "create" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}开始 AI 复刻</button></div>
          </section>
          <section className="video-replica-preview"><div className="video-replica-panel-head"><div><span className="step-kicker">RESULT</span><h2>生成结果</h2></div><span className="preview-status">{selected ? statusText(selected.status) : "等待生成"}</span></div>{selected && <div className="video-generation-progress ai-progress" aria-live="polite"><div className="generation-progress-head"><strong>{statusText(selected.status)}</strong><span>{selected.progress?.completed_segments ?? 0}/{selected.progress?.total_segments ?? 1} 完成</span></div><div className="generation-phase-list ai-generation-phase-list">{aiPhases.map(([phase, label], index) => <div className={`generation-phase ${selected.status === "ready" || (aiPhaseIndex >= 0 && index < aiPhaseIndex) ? "done" : ""} ${selected.status === phase ? "active" : ""}`} key={phase}><span className="generation-phase-dot" /><span>{label}</span></div>)}</div>{isPending(selected.status) && <div className="generation-indeterminate" role="progressbar" aria-label="AI 复刻生成进行中" />}{selected.status === "interrupted" && <p className="generation-progress-detail">应用退出后任务被中断，可以重新生成。</p>}</div>}<div className="video-stage">{displayed ? <video src={displayed} controls /> : <><Film size={38} /><strong>{aiFailure ? "生成失败" : "等待生成结果"}</strong><p>{aiFailure || "提交任务后，生成视频会显示在这里"}</p></>}</div>{aiFailure && <p className="notice notice-error video-generation-error" role="alert">{aiFailure}</p>}<div className="preview-meta"><span><small>原视频</small><b>{sourceReady ? "已选择" : "未选择"}</b></span><span><small>商品参考图</small><b>{replaceReady ? "已添加" : "未添加"}</b></span></div>{selected && <div className="video-result-actions"><button className="button secondary" type="button" onClick={() => void regenerate(selected.id)} disabled={!!busy || isPending(selected.status)}><RefreshCw size={16} />再次生成</button>{selected.file_path && <button className="button secondary" type="button" onClick={() => void exportVideo(selected.file_path!)}><Download size={16} />导出视频</button>}</div>}</section>
        </div>
        <section className="video-replica-history"><div className="video-replica-panel-head"><h2>AI 复刻历史</h2><span>{jobs.filter((job) => job.task_type === "ai_replica").length} 条</span></div>{jobs.filter((job) => job.task_type === "ai_replica").map((job) => <div className={`video-history-item ${selected?.id === job.id ? "active" : ""}`} key={job.id}><button type="button" className="video-history-select" onClick={() => selectJob(job)}><span>AI 复刻</span><strong>{job.model}</strong><small>{statusText(job.status)} · {job.versions.length} 个版本</small><time>{new Date(job.created_at * 1000).toLocaleString()}</time></button></div>)}</section>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
      </main>
    </Shell>;
  }

  return <Shell>
    <header className="workspace-header video-replica-header">
      <div className="video-replica-title"><span className="eyebrow">AI VIDEO STUDIO</span><h1>视频复刻</h1><p>选择一条本机视频，复刻它的节奏、镜头和动作，生成属于你的新版本。</p></div>
      <div className="video-replica-meta"><span className="workflow-badge">{selected ? statusText(selected.status) : "未开始"}</span><span>最多 5 分钟 · 200MB</span></div>
    </header>
    <main className="video-replica">
      <div className="video-replica-workbench">
        <section className="video-replica-editor">
        {aiControls}
        <div className="video-mode-switch" role="tablist" aria-label="视频工作模式"><button type="button" className={mode === "replica" ? "active" : ""} onClick={() => { setMode("replica"); setTaskType("reference"); setReview(null); }}>视频复刻</button><button type="button" className={(mode as string) === "ai_replica" ? "active" : ""} onClick={() => { setMode("ai_replica"); setStoryboard([]); setReview(null); }}>AI 复刻</button></div>
        <div className={`video-replica-panel workflow-panel ${stepStatus(1)}`}>
          <div className="workflow-step-head"><div className="step-number">1</div><div><span className="step-kicker">素材</span><h2>选择原视频</h2><p>从本机选择一段要复刻的视频。</p></div><span className="step-state">{busy === "upload" ? "正在添加" : sourceReady ? "已添加" : "待选择"}</span></div>
          <div className={`video-upload-box ${sourceReady && busy !== "upload" ? "has-video" : ""}`}>
            {busy === "upload" ? (
              <div className="video-upload-status" role="status" aria-live="polite">
                <LoaderCircle className="spin" size={30} aria-hidden="true" />
                <strong>{videoReadProgress === null ? "正在保存并校验视频…" : `正在读取视频 ${videoReadProgress}%`}</strong>
                {videoReadProgress !== null && <progress value={videoReadProgress} max={100} aria-label="读取视频进度" />}
              </div>
            ) : sourcePreview ? <><video src={sourcePreview} controls onLoadedMetadata={(event) => { if (!Number.isFinite(event.currentTarget.duration)) return; const seconds = event.currentTarget.duration; setSourceDuration(seconds); if (mode === "replace") { setDuration(Math.min(maxSegmentDuration, Math.max(4, Math.ceil(seconds)))); setError(seconds > maxSegmentDuration + 0.5 ? `视频将自动截取前 ${maxSegmentDuration} 秒并压缩` : ""); } }} /><label className="video-replace-action"><Upload size={15} />重新选择<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} /></label></> : <label className="video-upload-prompt"><Film size={30} /><strong>点击选择本机视频</strong><span>MP4 / WebM / MOV · {mode === "replace" ? `当前模型最长 ${maxSegmentDuration} 秒，超出会自动剪切压缩` : "最长 5 分钟"}</span><input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} /></label>}
          </div>
		  <div className="reference-row"><div><strong>{mode === "replace" ? "商品图片" : "参考素材"}</strong><span>{mode === "replace" ? "添加要替换进视频的商品图片" : "选择主产品图；其余图片只补充人物、场景或风格"}</span></div><div className="reference-thumbs">{referencePaths.map((path) => { const isProductReference = productReferencePath === path; return <div className="reference-thumb" key={path}><button type="button" className={isProductReference ? "product-reference active" : "product-reference"} aria-pressed={isProductReference} aria-label={isProductReference ? "当前主产品参考图" : "设为主产品参考图"} onClick={() => setProductReferencePath(path)}><img src={fileUrl(path)} alt="" /><span>{isProductReference ? "主产品" : "设为主图"}</span></button><button type="button" className="reference-remove" aria-label="移除参考图" onClick={() => removeReference(path)}><X size={13} /></button></div>})}{(mode === "replace" ? referencePaths.length < 1 : referencePaths.length < 4) && <label className="reference-add"><Upload size={17} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); }} />添加图片</label>}</div></div>
          {mode === "replica" && <button className="button secondary workflow-action" type="button" disabled={!sourcePath || !!busy} onClick={() => void analyze()}>{busy === "analyze" ? <LoaderCircle className="spin" /> : <RefreshCw size={16} />}AI 分析并生成分镜</button>}
        </div>
        <div className={`video-replica-panel workflow-panel ${stepStatus(2)}`}><div className="workflow-step-head"><div className="step-number">2</div><div><span className="step-kicker">内容</span><h2>{mode === "replace" ? "描述替换内容" : "描述你要复刻的内容"}</h2><p>{mode === "replace" ? "例如：把视频中的苹果替换成香蕉，保持镜头运动和光线一致。" : "写下主题、产品或人物，AI 会匹配参考视频的结构。"}</p></div><span className="step-state">{prompt.length}/2000</span></div><textarea className="video-script" value={prompt} onChange={(event) => { setPrompt(event.target.value); setReview(null); }} placeholder={mode === "replace" ? "例如：把视频中的苹果替换成香蕉，保持原视频的动作、光线和背景。" : "例如：为一款轻便的随行咖啡杯制作 15 秒种草短片，强调通勤、保温和极简设计。"} /><div className="prompt-review-actions"><button className="button secondary" type="button" disabled={!!busy || !prompt.trim()} onClick={() => void reviewPrompt()}>{busy === "review" ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}AI审核</button><span>检查描述完整性并生成优化稿</span></div>{review && <div className="prompt-review" role="status"><div className="prompt-review-head"><strong>审核评分 {review.score}/100</strong><span>{review.source === prompt ? "审核结果" : "内容已变化，请重新审核"}</span></div>{review.issues.length > 0 && <ul>{review.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}<div className="prompt-review-copy"><small>优化稿</small><p>{review.optimized_prompt}</p></div><div className="prompt-review-actions"><button className="button primary" type="button" disabled={review.source !== prompt} onClick={adoptReview}><Check size={16} />采用优化稿</button><button className="button secondary" type="button" onClick={() => setReview(null)}>保留当前内容</button></div></div>}{mode === "replica" && storyboard.length > 0 && <div className="storyboard-list">{storyboard.map((item, index) => <div className="storyboard-item" key={`${item.start}-${index}`}><b>{item.start}-{Number.isFinite(item.end) ? item.end : "?"}s</b><span>{item.shot}</span><small>{item.action}</small><label>音频<textarea value={item.audio || ""} onChange={(event) => updateStoryboardItem(index, "audio", event.target.value)} placeholder="对白、环境声、音效或配乐意图" /></label></div>)}</div>}</div>
        <div className={`video-replica-panel workflow-panel ${stepStatus(3)}`}><div className="workflow-step-head"><div className="step-number">3</div><div><span className="step-kicker">设置</span><h2>{mode === "replace" ? "生成替换视频" : "选择视频参数"}</h2><p>{mode === "replace" ? "使用商品图片和提示词生成新视频。" : "选择画幅、时长、模型和清晰度。"}</p></div><span className="step-state">{mode === "replace" ? `${duration} 秒` : `单段上限 ${maxSegmentDuration} 秒`}</span></div><div className="video-controls"><label>模型<SettingsSelect name="video-model" value={model} options={[{ value: "seedance-2.5", label: "Seedance 2.5" }, { value: "seedance-2.0", label: "Seedance 2.0" }]} onChange={(value) => { setModel(value); if (mode === "replace" && sourceDuration !== null) { const nextMax = value === "seedance-2.0" ? 15 : 30; setDuration(Math.min(nextMax, Math.max(4, Math.ceil(sourceDuration)))); setError(sourceDuration > nextMax + 0.5 ? `视频将自动截取前 ${nextMax} 秒并压缩` : ""); } }} /></label>{mode === "replica" && <label>任务类型<SettingsSelect name="video-task-type" value={taskType} options={[{ value: "reference", label: "参考重制" }, { value: "extend", label: "延长上一段" }, { value: "auto", label: "自动判断" }]} onChange={(value) => setTaskType(value as typeof taskType)} /></label>}<label>画面比例<SettingsSelect name="video-ratio" value={ratio} options={["16:9", "9:16", "1:1", "adaptive"].map((value) => ({ value, label: value }))} onChange={setRatio} /></label>{mode === "replica" && <label>视频时长<SettingsSelect name="video-duration" value={String(duration)} options={durationOptions.map((value) => ({ value: String(value), label: `${value} 秒 · ${Math.ceil(value / maxSegmentDuration)} 段` }))} onChange={(value) => setDuration(Number(value))} /></label>}<label>清晰度<SettingsSelect name="video-resolution" value={resolution} options={["480p", "720p"].map((value) => ({ value, label: value }))} onChange={setResolution} /></label></div><p className="video-audio-note">Seedance 原生音频已启用，将根据每段分镜生成同步对白、环境声、音效和配乐。</p><button className="button primary workflow-action" type="button" disabled={!!busy || !sourcePath || !prompt.trim() || (mode === "replace" && !replaceReady)} onClick={() => void create()}>{busy === "create" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{mode === "replace" ? "生成替换视频" : "生成复刻视频"}</button></div>
        </section>
        <section className="video-replica-preview">
        <div className="video-replica-panel-head"><div><span className="step-kicker">OUTPUT PREVIEW</span><h2>生成预览</h2></div><span className="preview-status">{selectedLabel}</span></div>
        {selected && <div className="video-generation-progress" aria-live="polite">
          <div className="generation-progress-head"><strong>{statusText(selected.status)}</strong><span>{progress?.completed_segments ?? 0}/{progress?.total_segments ?? 0} 段完成</span></div>
          <div className="generation-phase-list">{phaseSteps.map(([phase, label], index) => {
            const activeIndex = selected.status === "queued" ? 0 : phaseIndex;
            const done = selected.status === "ready" || (activeIndex >= 0 && index < activeIndex);
            const active = selected.status === phase || (selected.status === "queued" && index === 0);
            return <div className={`generation-phase ${done ? "done" : ""} ${active ? "active" : ""}`} key={phase}><span className="generation-phase-dot" /><span>{label}</span></div>;
          })}</div>
          {isPending(selected.status) && <div className="generation-indeterminate" role="progressbar" aria-label="视频生成进行中" />}
          {progress?.current_segment !== undefined && progress.current_segment >= 0 && progress.total_segments > 0 && <p className="generation-progress-detail">当前第 {progress.current_segment + 1} / {progress.total_segments} 段 · {selected.segments[progress.current_segment] ? segmentStatus(selected.segments[progress.current_segment]) : "处理中"}</p>}
          {selected.segments.length > 0 && <div className="generation-segments">{selected.segments.map((segment) => <div className={`generation-segment ${segment.status.startsWith("failed") ? "failed" : ""}`} key={segment.id}><span>第 {segment.index + 1} 段</span><small>{segmentStatus(segment)}</small></div>)}</div>}
          {selected.status === "interrupted" && <p className="generation-progress-detail">应用曾在生成期间退出，已保留片段进度，可重新生成。</p>}
        </div>}
        <div className="video-stage">{displayed ? <video src={displayed} controls /> : <><Film size={38} /><strong>{selectedFailure ? "生成失败" : "等待生成结果"}</strong><p>{selectedFailure || "确认脚本后，视频会在这里出现"}</p></>}</div>
        {selectedFailure && <p className="notice notice-error video-generation-error" role="alert">{selectedFailure}</p>}
        <div className="preview-meta"><span><small>参考风格</small><b>{selected ? "已选参考视频" : "等待开始"}</b></span><span><small>预计时长</small><b>{duration} 秒</b></span></div>
        <p className="privacy-note"><ShieldCheck size={16} />选择的本机内容仅用于本次生成，不会公开展示。</p>
        {selected && <div className="video-result-actions"><button className="button secondary" type="button" onClick={() => void regenerate(selected.id)} disabled={!!busy || isPending(selected.status)}><RefreshCw size={16} />重新生成</button>{selected.file_path && <button className="button secondary" type="button" onClick={() => void exportVideo(selected.file_path!)}><Download size={16} />导出视频</button>}</div>}
        </section>
      </div>
      <section className="video-template-section"><div className="template-section-heading"><div><span className="eyebrow">START EASIER</span><h2>从精选模板开始</h2></div><a href="/templates" className="text-link">查看全部 <span aria-hidden="true">→</span></a></div><div className="video-template-grid">{templatePresentation.map(([id, name, image, description]) => <article className="video-template-card" key={id}><img src={image} alt="" /><span className="video-template-card-copy"><strong>{name}</strong><small>{description}</small></span></article>)}</div></section>
      <section className="video-replica-history"><div className="video-replica-panel-head"><h2>历史任务</h2><span>{jobs.length} 条</span></div>{jobs.length ? jobs.map((job) => <div className={`video-history-item ${selected?.id === job.id ? "active" : ""}`} key={job.id}><button type="button" className="video-history-select" onClick={() => selectJob(job)}><span>{job.task_type === "extend" ? "延长" : job.task_type === "replace" ? "AI 替换" : "复刻"}</span><strong>{job.model}</strong><small>{statusText(job.status)} · {job.progress?.completed_segments ?? 0}/{job.progress?.total_segments ?? 0} 段 · {job.versions.length} 个版本</small><time>{new Date(job.created_at * 1000).toLocaleString()}</time></button>{job.file_path && <button type="button" className="button secondary video-use-result" onClick={() => { setMode("replica"); setTaskType("extend"); setSourcePath(job.file_path!); setSourcePreview(fileUrl(job.file_path)); setSelected(job); setPrompt(job.prompt); }}>继续延长</button>}</div>) : <div className="video-history-empty">还没有视频作品，完成一次生成后会自动保存在这里。</div>}</section>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </main>
  </Shell>;
}
