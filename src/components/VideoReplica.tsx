import { Film, LoaderCircle, Play, RefreshCw, Upload, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import type { VideoReplicaJob, VideoReplicaStoryboardItem } from "../types";
import { fileUrl, isPending, statusText } from "../utils/assets";
import { Shell } from "./Shell";
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
    setBusy("upload"); setError("");
    try {
      const data = Array.from(new Uint8Array(await file.arrayBuffer()));
      const result = await client.uploadVideoReplicaVideo(file.name, file.type, data);
      setSourcePath(result.path); setSourcePreview(fileUrl(result.path));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "视频上传失败"); }
    finally { setBusy(""); }
  }

  async function uploadReference(file: File) {
    if (referencePaths.length >= 4) return;
    setBusy("reference"); setError("");
    try {
      const result = await client.upload(file);
      setReferencePaths((paths) => [...paths, result.path]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片上传失败"); }
    finally { setBusy(""); }
  }

  async function analyze() {
    if (!sourcePath) { setError("请先上传原视频"); return; }
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
    if (!sourcePath || !prompt.trim()) { setError("请上传原视频并确认复刻脚本"); return; }
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

  const displayed = selected?.file_path ? fileUrl(selected.file_path) : "";
  const selectedLabel = useMemo(() => selected ? `${selected.model} · ${statusText(selected.status)}` : "等待生成结果", [selected]);

  return <Shell>
    <header className="workspace-header video-replica-header">
      <div><span className="eyebrow">AI VIDEO STUDIO</span><h1>视频复刻工作台</h1><p>先分析原视频，再编辑分镜并生成 Seedance 复刻版本。</p></div>
    </header>
    <main className="video-replica">
      <section className="video-replica-editor">
        <div className="video-replica-panel">
          <div className="video-replica-panel-head"><h2>1. 原视频与参考素材</h2><span>支持 MP4 / WebM / MOV，最大 200MB</span></div>
          <label className="video-upload-box">{sourcePreview ? <video src={sourcePreview} controls /> : <><Film size={32} /><strong>上传原视频</strong><span>拖入或点击选择视频</span></>}<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVideo(file); }} /></label>
          <div className="reference-row"><span>人物 / 商品参考图</span><div className="reference-thumbs">{referencePaths.map((path) => <button type="button" key={path} onClick={() => setReferencePaths((items) => items.filter((item) => item !== path))}><img src={fileUrl(path)} alt="" /></button>)}<label className="reference-add"><Upload size={18} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); }} />添加图片</label></div></div>
          <button className="button secondary" type="button" disabled={!sourcePath || !!busy} onClick={() => void analyze()}>{busy === "analyze" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}分析原视频并生成分镜</button>
        </div>
        <div className="video-replica-panel"><div className="video-replica-panel-head"><h2>2. 编辑复刻脚本</h2><span>{storyboard.length} 个分镜</span></div><textarea className="video-script" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="分析后会在这里生成可编辑复刻脚本，也可以手动修改。" />{storyboard.length > 0 && <div className="storyboard-list">{storyboard.map((item, index) => <div className="storyboard-item" key={`${item.start}-${index}`}><b>{item.start}-{item.end}s</b><span>{item.shot}</span><small>{item.action}</small></div>)}</div>}</div>
        <div className="video-replica-panel"><div className="video-replica-panel-head"><h2>3. 生成设置</h2><span>使用现有 Huabot Token</span></div><div className="video-controls"><label>模型<select value={model} onChange={(event) => setModel(event.target.value)}><option value="seedance-2.5">Seedance 2.5</option><option value="seedance-2.0">Seedance 2.0</option></select></label><label>任务类型<select value={taskType} onChange={(event) => setTaskType(event.target.value as typeof taskType)}><option value="reference">参考复刻</option><option value="extend">延长上一段</option><option value="auto">自动判断</option></select></label><label>比例<select value={ratio} onChange={(event) => setRatio(event.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>adaptive</option></select></label><label>时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={5}>5 秒</option><option value={10}>10 秒</option><option value={30}>30 秒</option><option value={60}>60 秒</option></select></label><label>清晰度<select value={resolution} onChange={(event) => setResolution(event.target.value)}><option>480p</option><option>720p</option></select></label></div><button className="button primary" type="button" disabled={!!busy || !sourcePath || !prompt.trim()} onClick={() => void create()}>{busy === "create" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}确认脚本并生成视频</button></div>
      </section>
      <section className="video-replica-preview"><div className="video-replica-panel-head"><h2>生成预览</h2><span>{selectedLabel}</span></div><div className="video-stage">{displayed ? <video src={displayed} controls /> : <><Film size={40} /><p>{selected?.status.startsWith("failed") ? selected.status : "确认脚本后，生成结果会出现在这里"}</p></>}</div>{selected && <div className="video-result-actions"><button className="button secondary" type="button" onClick={() => void regenerate(selected.id)} disabled={!!busy || isPending(selected.status)}><RefreshCw size={16} />重新生成</button>{selected.file_path && <button className="button secondary" type="button" onClick={() => void client.downloadAsset(selected.file_path!)}><Download size={16} />下载视频</button>}</div>}</section>
      <section className="video-replica-history"><div className="video-replica-panel-head"><h2>历史任务</h2><span>{jobs.length} 条</span></div>{jobs.map((job) => <div className={`video-history-item ${selected?.id === job.id ? "active" : ""}`} key={job.id}><button type="button" className="video-history-select" onClick={() => { setSelected(job); setStoryboard(job.storyboard); setPrompt(job.prompt); setModel(job.model === "doubao-seedance-2.0-mini" ? "seedance-2.0" : "seedance-2.5"); }}><span>{job.task_type === "extend" ? "延长" : "复刻"}</span><strong>{job.model}</strong><small>{statusText(job.status)}</small><time>{new Date(job.created_at * 1000).toLocaleString()}</time></button>{job.file_path && <button type="button" className="button secondary video-use-result" onClick={() => { setTaskType("extend"); setSourcePath(job.file_path!); setSourcePreview(fileUrl(job.file_path)); setSelected(job); setPrompt(job.prompt); }}>继续延长</button>}</div>)}</section>
      {error && <p className="notice error" role="alert">{error}</p>}
    </main>
  </Shell>;
}
