import { Download, Film, LoaderCircle, Play, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import type { VideoReplicaJob, VideoReplicaStoryboardItem, VideoReplicaSegment } from "../types";
import { fileUrl, isPending, statusText } from "../utils/assets";
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
  const [jobs, setJobs] = useState<VideoReplicaJob[]>([]);
  const [selected, setSelected] = useState<VideoReplicaJob | null>(null);
  const [storyboard, setStoryboard] = useState<VideoReplicaStoryboardItem[]>(defaultStoryboard);
  const [model, setModel] = useState("seedance-2.5");
  const [taskType, setTaskType] = useState<"auto" | "reference" | "extend">("reference");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(30);
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("480p");
  const [busy, setBusy] = useState("");
  const [videoReadProgress, setVideoReadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const templatePresentation = [
    ["hero-image", "产品种草", "/template-previews/hero-image.jpg", "用清晰的产品镜头制作一条有质感的种草短片。"],
    ["lifestyle-scene", "旅行片段", "/template-previews/lifestyle-scene.jpg", "制作一条自然、有呼吸感的旅行生活方式短片。"],
    ["ugc-style", "人物故事", "/template-previews/ugc-style.jpg", "制作一条真实自然的人物故事短片，突出情绪和细节。"],
  ] as const;

  function selectJob(job: VideoReplicaJob) {
    setSelected(job);
    setSourcePath(job.source_video_path);
    setSourcePreview(fileUrl(job.source_video_path));
    setReferencePaths(job.reference_paths);
    setStoryboard(job.storyboard);
    setPrompt(job.prompt);
    setModel(job.model === "doubao-seedance-2.0-mini" ? "seedance-2.0" : "seedance-2.5");
    setTaskType(job.task_type);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载视频任务");
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const jobID = (location.state as { jobId?: string } | null)?.jobId;
    if (!jobID) return;
    void client.videoReplicaJob(jobID).then((job) => {
      selectJob(job);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "无法打开视频作品"));
  }, [location.state]);
  useEffect(() => {
    if (!jobs.some((job) => isPending(job.status))) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [jobs.map((job) => `${job.id}:${job.status}`).join("|")]);

  async function uploadVideo(file: File) {
    setBusy("upload"); setVideoReadProgress(0); setError("");
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : "添加视频失败"); }
    finally { setBusy(""); setVideoReadProgress(null); }
  }

  async function uploadReference(file: File) {
    if (referencePaths.length >= 4) return;
    setBusy("reference"); setError("");
    try {
      const result = await client.upload(file);
      setReferencePaths((paths) => [...paths, result.path]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "添加图片失败"); }
    finally { setBusy(""); }
  }

  async function analyze() {
    if (!sourcePath) { setError("请先选择原视频"); return; }
    setBusy("analyze"); setError("");
    try {
      const result = await client.analyzeVideoReplica(sourcePath);
      setStoryboard(result.storyboard || []);
      setPrompt(result.storyboard.map((item) => `${item.start}-${item.end}秒：${item.shot}。${item.action}${item.dialogue ? ` 对白：${item.dialogue}` : ""}`).join("\n"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "视频分析失败"); }
    finally { setBusy(""); }
  }

  async function create() {
    if (!requireAiAuth()) return;
    if (!sourcePath || !prompt.trim()) { setError("请先选择原视频并确认复刻脚本"); return; }
    setBusy("create"); setError("");
    try {
      const result = await client.createVideoReplica({ source_video_path: sourcePath, reference_paths: referencePaths, task_type: taskType, model, prompt, storyboard, duration, resolution, ratio });
      await load();
      const fresh = await client.videoReplicaJob(result.id);
      selectJob(fresh);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建视频任务失败"); }
    finally { setBusy(""); }
  }

  async function regenerate(id: string) {
    setBusy(id); setError("");
    try { await client.regenerateVideoReplica(id); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "重新生成失败"); }
    finally { setBusy(""); }
  }

  async function exportVideo(path: string) {
    setError("");
    try { await client.downloadAsset(path); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "导出视频失败"); }
  }

  const displayed = selected?.file_path ? fileUrl(selected.file_path) : "";
  const selectedLabel = useMemo(() => selected ? `${selected.model} · ${statusText(selected.status)}` : "等待生成结果", [selected]);
  const sourceReady = Boolean(sourcePath);
  const scriptReady = Boolean(prompt.trim());
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

  return <Shell>
    <header className="workspace-header video-replica-header">
      <div className="video-replica-title"><span className="eyebrow">AI VIDEO STUDIO</span><h1>视频复刻</h1><p>选择一条本机视频，复刻它的节奏、镜头和动作，生成属于你的新版本。</p></div>
      <div className="video-replica-meta"><span className="workflow-badge">{selected ? statusText(selected.status) : "未开始"}</span><span>最多 5 分钟 · 200MB</span></div>
    </header>
    <main className="video-replica">
      <div className="video-replica-workbench">
        <section className="video-replica-editor">
        <div className={`video-replica-panel workflow-panel ${stepStatus(1)}`}>
          <div className="workflow-step-head"><div className="step-number">1</div><div><span className="step-kicker">素材</span><h2>选择原视频</h2><p>从本机选择一段要复刻的视频。</p></div><span className="step-state">{busy === "upload" ? "正在添加" : sourceReady ? "已添加" : "待选择"}</span></div>
          <div className={`video-upload-box ${sourceReady && busy !== "upload" ? "has-video" : ""}`}>
            {busy === "upload" ? (
              <div className="video-upload-status" role="status" aria-live="polite">
                <LoaderCircle className="spin" size={30} aria-hidden="true" />
                <strong>{videoReadProgress === null ? "正在保存并校验视频…" : `正在读取视频 ${videoReadProgress}%`}</strong>
                {videoReadProgress !== null && <progress value={videoReadProgress} max={100} aria-label="读取视频进度" />}
              </div>
            ) : sourcePreview ? <><video src={sourcePreview} controls /><label className="video-replace-action"><Upload size={15} />重新选择<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} /></label></> : <label className="video-upload-prompt"><Film size={30} /><strong>点击选择本机视频</strong><span>MP4 / WebM / MOV · 最长 5 分钟</span><input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} /></label>}
          </div>
          <div className="reference-row"><div><strong>参考素材</strong><span>可选，最多 4 张人物或商品图</span></div><div className="reference-thumbs">{referencePaths.map((path) => <button type="button" key={path} aria-label="移除参考图" onClick={() => setReferencePaths((items) => items.filter((item) => item !== path))}><img src={fileUrl(path)} alt="" /></button>)}<label className="reference-add"><Upload size={17} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); }} />添加图片</label></div></div>
          <button className="button secondary workflow-action" type="button" disabled={!sourcePath || !!busy} onClick={() => void analyze()}>{busy === "analyze" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}AI 分析并生成分镜</button>
        </div>
        <div className={`video-replica-panel workflow-panel ${stepStatus(2)}`}><div className="workflow-step-head"><div className="step-number">2</div><div><span className="step-kicker">内容</span><h2>描述你要复刻的内容</h2><p>写下主题、产品或人物，AI 会匹配参考视频的结构。</p></div><span className="step-state">{prompt.length}/500</span></div><textarea className="video-script" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：为一款轻便的随行咖啡杯制作 15 秒种草短片，强调通勤、保温和极简设计。" />{storyboard.length > 0 && <div className="storyboard-list">{storyboard.map((item, index) => <div className="storyboard-item" key={`${item.start}-${index}`}><b>{item.start}-{item.end}s</b><span>{item.shot}</span><small>{item.action}</small></div>)}</div>}</div>
        <div className={`video-replica-panel workflow-panel ${stepStatus(3)}`}><div className="workflow-step-head"><div className="step-number">3</div><div><span className="step-kicker">设置</span><h2>选择视频参数</h2><p>选择画幅、时长、模型和清晰度。</p></div><span className="step-state">单段上限 {maxSegmentDuration} 秒</span></div><div className="video-controls"><label>模型<SettingsSelect name="video-model" value={model} options={[{ value: "seedance-2.5", label: "Seedance 2.5" }, { value: "seedance-2.0", label: "Seedance 2.0" }]} onChange={setModel} /></label><label>任务类型<SettingsSelect name="video-task-type" value={taskType} options={[{ value: "reference", label: "参考重制" }, { value: "extend", label: "延长上一段" }, { value: "auto", label: "自动判断" }]} onChange={(value) => setTaskType(value as typeof taskType)} /></label><label>画面比例<SettingsSelect name="video-ratio" value={ratio} options={["16:9", "9:16", "1:1", "adaptive"].map((value) => ({ value, label: value }))} onChange={setRatio} /></label><label>视频时长<SettingsSelect name="video-duration" value={String(duration)} options={durationOptions.map((value) => ({ value: String(value), label: `${value} 秒 · ${Math.ceil(value / maxSegmentDuration)} 段` }))} onChange={(value) => setDuration(Number(value))} /></label><label>清晰度<SettingsSelect name="video-resolution" value={resolution} options={["480p", "720p"].map((value) => ({ value, label: value }))} onChange={setResolution} /></label></div><button className="button primary workflow-action" type="button" disabled={!!busy || !sourcePath || !prompt.trim()} onClick={() => void create()}>{busy === "create" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}生成复刻视频</button></div>
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
        <div className="video-stage">{displayed ? <video src={displayed} controls /> : <><Film size={38} /><strong>{selected?.status.startsWith("failed") ? "生成失败" : "等待生成结果"}</strong><p>{selected?.status.startsWith("failed") ? selected.status.replace(/^failed:?\s*/, "") : "确认脚本后，视频会在这里出现"}</p></>}</div>
        <div className="preview-meta"><span><small>参考风格</small><b>{selected ? "已选参考视频" : "等待开始"}</b></span><span><small>预计时长</small><b>{duration} 秒</b></span></div>
        <p className="privacy-note"><ShieldCheck size={16} />选择的本机内容仅用于本次生成，不会公开展示。</p>
        {selected && <div className="video-result-actions"><button className="button secondary" type="button" onClick={() => void regenerate(selected.id)} disabled={!!busy || isPending(selected.status)}><RefreshCw size={16} />重新生成</button>{selected.file_path && <button className="button secondary" type="button" onClick={() => void exportVideo(selected.file_path!)}><Download size={16} />导出视频</button>}</div>}
        </section>
      </div>
      <section className="video-template-section"><div className="template-section-heading"><div><span className="eyebrow">START EASIER</span><h2>从精选模板开始</h2></div><a href="/templates" className="text-link">查看全部 <span aria-hidden="true">→</span></a></div><div className="video-template-grid">{templatePresentation.map(([id, name, image, description]) => <article className="video-template-card" key={id}><img src={image} alt="" /><span className="video-template-card-copy"><strong>{name}</strong><small>{description}</small></span></article>)}</div></section>
      <section className="video-replica-history"><div className="video-replica-panel-head"><h2>历史任务</h2><span>{jobs.length} 条</span></div>{jobs.length ? jobs.map((job) => <div className={`video-history-item ${selected?.id === job.id ? "active" : ""}`} key={job.id}><button type="button" className="video-history-select" onClick={() => selectJob(job)}><span>{job.task_type === "extend" ? "延长" : "重制"}</span><strong>{job.model}</strong><small>{statusText(job.status)} · {job.progress?.completed_segments ?? 0}/{job.progress?.total_segments ?? 0} 段 · {job.versions.length} 个版本</small><time>{new Date(job.created_at * 1000).toLocaleString()}</time></button>{job.file_path && <button type="button" className="button secondary video-use-result" onClick={() => { setTaskType("extend"); setSourcePath(job.file_path!); setSourcePreview(fileUrl(job.file_path)); setSelected(job); setPrompt(job.prompt); }}>继续延长</button>}</div>) : <div className="video-history-empty">还没有视频作品，完成一次重制后会自动保存在这里。</div>}</section>
      {error && <p className="notice error" role="alert">{error}</p>}
    </main>
  </Shell>;
}
