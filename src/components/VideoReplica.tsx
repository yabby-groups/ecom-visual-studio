import { Film, LoaderCircle, Play, RefreshCw, Upload, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import type { VideoReplicaJob, VideoReplicaStoryboardItem } from "../types";
import { fileUrl, isPending, statusText } from "../utils/assets";
import { Shell } from "./Shell";
import { SettingsSelect } from "./SettingsSelect";
import "./VideoReplica.css";

const defaultStoryboard: VideoReplicaStoryboardItem[] = [];

export function VideoReplica() {
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

  async function load() {
    try {
      const result = await client.videoReplicaJobs();
      setJobs(result.items);
      if (selected) {
        const fresh = result.items.find((item) => item.id === selected.id);
        if (fresh) setSelected(fresh);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载视频任务");
    }
  }

  useEffect(() => { void load(); }, []);
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
      setSelected(fresh);
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
  const stepStatus = (step: number) => step === 1 && sourceReady || step === 2 && scriptReady || step === 3 && Boolean(selected) ? "done" : "";

  return <Shell>
    <header className="workspace-header video-replica-header">
      <div className="video-replica-title"><span className="eyebrow">AI VIDEO STUDIO / VIDEO REPLICA</span><h1>视频复刻工作台</h1><p>拆解原视频的节奏、镜头和动作，快速生成可继续编辑的复刻版本。</p></div>
      <div className="video-replica-meta"><span className="workflow-badge">{selected ? statusText(selected.status) : "未开始"}</span><span>最多 5 分钟 · 200MB</span></div>
    </header>
    <main className="video-replica">
      <section className="video-replica-editor">
        <div className={`video-replica-panel workflow-panel ${stepStatus(1)}`}>
          <div className="workflow-step-head"><div className="step-number">1</div><div><span className="step-kicker">素材</span><h2>选择原视频</h2><p>从本机选择一段要复刻的视频。</p></div><span className="step-state">{busy === "upload" ? "正在添加" : sourceReady ? "已添加" : "待选择"}</span></div>
          <label className={`video-upload-box ${sourceReady && busy !== "upload" ? "has-video" : ""}`}>
            {busy === "upload" ? (
              <div className="video-upload-status" role="status" aria-live="polite">
                <LoaderCircle className="spin" size={30} aria-hidden="true" />
                <strong>{videoReadProgress === null ? "正在保存并校验视频…" : `正在读取视频 ${videoReadProgress}%`}</strong>
                {videoReadProgress !== null && <progress value={videoReadProgress} max={100} aria-label="读取视频进度" />}
              </div>
            ) : sourcePreview ? <video src={sourcePreview} controls /> : <><Film size={30} /><strong>点击选择本机视频</strong><span>MP4 / WebM / MOV · 最长 5 分钟</span></>}
            <input type="file" accept="video/mp4,video/webm,video/quicktime" disabled={busy === "upload"} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadVideo(file); }} />
          </label>
          <div className="reference-row"><div><strong>参考素材</strong><span>可选，最多 4 张人物或商品图</span></div><div className="reference-thumbs">{referencePaths.map((path) => <button type="button" key={path} aria-label="移除参考图" onClick={() => setReferencePaths((items) => items.filter((item) => item !== path))}><img src={fileUrl(path)} alt="" /></button>)}<label className="reference-add"><Upload size={17} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); }} />添加图片</label></div></div>
          <button className="button secondary workflow-action" type="button" disabled={!sourcePath || !!busy} onClick={() => void analyze()}>{busy === "analyze" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}分析视频并生成分镜</button>
        </div>
        <div className={`video-replica-panel workflow-panel ${stepStatus(2)}`}><div className="workflow-step-head"><div className="step-number">2</div><div><span className="step-kicker">分镜</span><h2>编辑复刻脚本</h2><p>分析结果会自动填充，你也可以直接修改。</p></div><span className="step-state">{storyboard.length} 个镜头</span></div><textarea className="video-script" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="先分析原视频，或直接输入你想生成的镜头脚本。" />{storyboard.length > 0 && <div className="storyboard-list">{storyboard.map((item, index) => <div className="storyboard-item" key={`${item.start}-${index}`}><b>{item.start}-{item.end}s</b><span>{item.shot}</span><small>{item.action}</small></div>)}</div>}</div>
        <div className={`video-replica-panel workflow-panel ${stepStatus(3)}`}><div className="workflow-step-head"><div className="step-number">3</div><div><span className="step-kicker">输出</span><h2>设置生成参数</h2><p>选择模型和画幅，然后开始生成。</p></div><span className="step-state">Seedance</span></div><div className="video-controls"><label>模型<SettingsSelect name="video-model" value={model} options={[{ value: "seedance-2.5", label: "Seedance 2.5" }, { value: "seedance-2.0", label: "Seedance 2.0" }]} onChange={setModel} /></label><label>任务类型<SettingsSelect name="video-task-type" value={taskType} options={[{ value: "reference", label: "参考复刻" }, { value: "extend", label: "延长上一段" }, { value: "auto", label: "自动判断" }]} onChange={(value) => setTaskType(value as typeof taskType)} /></label><label>比例<SettingsSelect name="video-ratio" value={ratio} options={["16:9", "9:16", "1:1", "adaptive"].map((value) => ({ value, label: value }))} onChange={setRatio} /></label><label>时长<SettingsSelect name="video-duration" value={String(duration)} options={[5, 10, 30, 60].map((value) => ({ value: String(value), label: `${value} 秒` }))} onChange={(value) => setDuration(Number(value))} /></label><label>清晰度<SettingsSelect name="video-resolution" value={resolution} options={["480p", "720p"].map((value) => ({ value, label: value }))} onChange={setResolution} /></label></div><button className="button primary workflow-action" type="button" disabled={!!busy || !sourcePath || !prompt.trim()} onClick={() => void create()}>{busy === "create" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}确认脚本并生成视频</button></div>
      </section>
      <section className="video-replica-preview"><div className="video-replica-panel-head"><div><span className="step-kicker">OUTPUT PREVIEW</span><h2>生成预览</h2></div><span className="preview-status">{selectedLabel}</span></div><div className="video-stage">{displayed ? <video src={displayed} controls /> : <><Film size={38} /><strong>{selected?.status.startsWith("failed") ? "生成失败" : "等待生成结果"}</strong><p>{selected?.status.startsWith("failed") ? selected.status : "确认脚本后，视频会在这里出现"}</p></>}</div>{selected && <div className="video-result-actions"><button className="button secondary" type="button" onClick={() => void regenerate(selected.id)} disabled={!!busy || isPending(selected.status)}><RefreshCw size={16} />重新生成</button>{selected.file_path && <button className="button secondary" type="button" onClick={() => void exportVideo(selected.file_path!)}><Download size={16} />导出视频</button>}</div>}</section>
      <section className="video-replica-history"><div className="video-replica-panel-head"><h2>历史任务</h2><span>{jobs.length} 条</span></div>{jobs.map((job) => <div className={`video-history-item ${selected?.id === job.id ? "active" : ""}`} key={job.id}><button type="button" className="video-history-select" onClick={() => { setSelected(job); setStoryboard(job.storyboard); setPrompt(job.prompt); setModel(job.model === "doubao-seedance-2.0-mini" ? "seedance-2.0" : "seedance-2.5"); }}><span>{job.task_type === "extend" ? "延长" : "复刻"}</span><strong>{job.model}</strong><small>{statusText(job.status)}</small><time>{new Date(job.created_at * 1000).toLocaleString()}</time></button>{job.file_path && <button type="button" className="button secondary video-use-result" onClick={() => { setTaskType("extend"); setSourcePath(job.file_path!); setSourcePreview(fileUrl(job.file_path)); setSelected(job); setPrompt(job.prompt); }}>继续延长</button>}</div>)}</section>
      {error && <p className="notice error" role="alert">{error}</p>}
    </main>
  </Shell>;
}
