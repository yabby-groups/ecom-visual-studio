import { useEffect, useId, useState } from "react";
import { FolderOpen, Image, Images, LoaderCircle } from "lucide-react";
import { EventsOff, EventsOn, OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import { client } from "../api";
import type { BatchImageProgress, BatchImageResult } from "../types";
import { Shell } from "./Shell";
import "./BatchImageProcessing.css";

type SourceType = "file" | "directory";
type OutputFormat = "jpg" | "png" | "webp" | "gif";

const formatLabels: Record<OutputFormat, string> = {
  jpg: "JPG",
  png: "PNG",
  webp: "WebP",
  gif: "GIF",
};
const widthPresets = [
  { label: "480 px", value: 480 },
  { label: "720 px", value: 720 },
  { label: "1080 px", value: 1080 },
  { label: "1280 px", value: 1280 },
  { label: "1920 px", value: 1920 },
  { label: "2048 px", value: 2048 },
] as const;

function messageFor(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  return "批量转换失败，请稍后重试。";
}

function initialProgress(): BatchImageProgress {
  return { total: 0, completed: 0, converted: 0, skipped: 0, failed: 0, current: "" };
}

export function BatchImageProcessing() {
  const inputID = useId();
  const outputID = useId();
  const [sourceType, setSourceType] = useState<SourceType>("directory");
  const [sourcePath, setSourcePath] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [width, setWidth] = useState(1080);
  const [customWidth, setCustomWidth] = useState("");
  const [format, setFormat] = useState<OutputFormat>("webp");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(initialProgress);
  const [result, setResult] = useState<BatchImageResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSourcePath("");
    setResult(null);
    setError("");
  }, [sourceType]);

  useEffect(() => {
    if (busy) return;
    try {
      OnFileDrop((_x, _y, paths) => {
        if (paths.length !== 1) {
          setError("一次只能拖入一个图片文件或目录。");
          return;
        }
        void client.batchImageSourceType(paths[0]).then((source) => {
          setSourceType(source.source_type);
          setSourcePath(source.path);
          setResult(null);
          setError("");
        }).catch((reason) => setError(messageFor(reason)));
      }, true);
      return () => OnFileDropOff();
    } catch {
      // Browser previews do not have the Wails native drag-and-drop bridge.
      return undefined;
    }
  }, [busy]);

  async function chooseSource() {
    setError("");
    try {
      const selected =
        sourceType === "file"
          ? await client.chooseBatchImageFile()
          : await client.chooseBatchImageDirectory("选择输入图片目录");
      if (selected.path) setSourcePath(selected.path);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function chooseOutput() {
    setError("");
    try {
      const selected = await client.chooseBatchImageDirectory("选择输出目录");
      if (selected.path) setOutputDirectory(selected.path);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function convert() {
    if (!sourcePath) {
      setError(sourceType === "file" ? "请选择输入图片。" : "请选择输入图片目录。");
      return;
    }
    if (!outputDirectory) {
      setError("请选择输出目录。");
      return;
    }
    if (customWidthInvalid) {
      setError("自定义宽度必须在 1 到 20000 像素之间。");
      return;
    }
    const requestID = `batch-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventName = `batch-image:progress:${requestID}`;
    setBusy(true);
    setError("");
    setResult(null);
    setProgress(initialProgress());
    EventsOn(eventName, (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const value = payload as Partial<BatchImageProgress>;
      if (
        typeof value.total !== "number" ||
        typeof value.completed !== "number" ||
        typeof value.converted !== "number" ||
        typeof value.skipped !== "number" ||
        typeof value.failed !== "number"
      ) {
        return;
      }
      setProgress({
        total: value.total,
        completed: value.completed,
        converted: value.converted,
        skipped: value.skipped,
        failed: value.failed,
        current: typeof value.current === "string" ? value.current : "",
      });
    });
    try {
      const converted = await client.batchConvertImages({
        source_path: sourcePath,
        source_type: sourceType,
        output_directory: outputDirectory,
        width,
        format,
        request_id: requestID,
      });
      setResult(converted);
      setProgress((current) => ({
        ...current,
        total: converted.total,
        completed: converted.total,
        converted: converted.converted,
        skipped: converted.skipped,
        failed: converted.failed,
      }));
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      EventsOff(eventName);
      setBusy(false);
    }
  }

  const customWidthInvalid = customWidth !== "" && (!Number.isInteger(width) || width < 1 || width > 20000);
  const disabled = busy || !sourcePath || !outputDirectory || customWidthInvalid;
  const progressValue = progress.total ? (progress.completed / progress.total) * 100 : 0;
  return (
    <Shell>
      <div className="topbar">
        <strong>批量图片处理</strong>
      </div>
      <main className="batch-image-page page">
        <section className="batch-image-intro">
          <div className="batch-image-title-icon"><Images size={23} /></div>
          <div>
            <span className="eyebrow">本地图片工具</span>
            <h1>批量图片处理</h1>
            <p>按原有目录结构批量缩小图片宽度并转换格式。</p>
          </div>
        </section>

        <section className="batch-image-form" aria-label="批量图片转换设置">
          <div className="batch-path-grid">
            <section className="batch-path-panel batch-source-drop">
              <div className="batch-panel-heading">
                <label htmlFor={inputID}>输入{sourceType === "file" ? "图片" : "目录"}</label>
                <div className="batch-source-type" role="group" aria-label="输入类型">
                  <button type="button" className={sourceType === "directory" ? "selected" : ""} aria-pressed={sourceType === "directory"} disabled={busy} onClick={() => setSourceType("directory")}><FolderOpen size={16} /> 目录</button>
                  <button type="button" className={sourceType === "file" ? "selected" : ""} aria-pressed={sourceType === "file"} disabled={busy} onClick={() => setSourceType("file")}><Image size={16} /> 文件</button>
                </div>
              </div>
              <div className="batch-path-control">
                <output id={inputID} aria-live="polite">{sourcePath || "拖入图片或目录，或点击选择"}</output>
                <button className="button secondary" type="button" disabled={busy} onClick={() => void chooseSource()}><FolderOpen size={16} /> 选择</button>
              </div>
              <p className="batch-field-note">支持拖入一个 JPG、PNG、WebP 图片或图片目录。</p>
            </section>
            <section className="batch-path-panel">
              <label htmlFor={outputID}>输出目录</label>
              <div className="batch-path-control">
                <output id={outputID} aria-live="polite">{outputDirectory || "尚未选择"}</output>
                <button className="button secondary" type="button" disabled={busy} onClick={() => void chooseOutput()}><FolderOpen size={16} /> 选择</button>
              </div>
              <p className="batch-field-note">已有同名文件会跳过。</p>
            </section>
          </div>

          <div className="batch-options">
            <fieldset className="batch-width-options"><legend>输出宽度</legend><div>{widthPresets.map((preset) => <button type="button" key={preset.value} disabled={busy} className={customWidth === "" && width === preset.value ? "selected" : ""} aria-pressed={customWidth === "" && width === preset.value} onClick={() => { setCustomWidth(""); setWidth(preset.value); }}>{preset.label}</button>)}<button type="button" disabled={busy} className={customWidth !== "" ? "selected" : ""} aria-pressed={customWidth !== ""} onClick={() => setCustomWidth(String(width))}>自定义</button></div>{customWidth !== "" && <label className="batch-custom-width">自定义宽度（像素）<input type="number" min="1" max="20000" step="1" inputMode="numeric" disabled={busy} value={customWidth} onChange={(event) => { const value = event.target.value; setCustomWidth(value); setWidth(Number(value)); }} /></label>}</fieldset>
            <fieldset className="batch-format-options"><legend>输出格式</legend><div>{Object.entries(formatLabels).map(([value, label]) => <button type="button" key={value} disabled={busy} className={format === value ? "selected" : ""} aria-pressed={format === value} onClick={() => setFormat(value as OutputFormat)}>{label}</button>)}</div></fieldset>
          </div>
          <p className="batch-field-note">仅缩小超过最大宽度的图片。透明图片转换为 JPG 时使用白色背景。</p>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary batch-convert-button" type="button" disabled={disabled} onClick={() => void convert()}>
            {busy ? <><LoaderCircle className="spin" size={16} /> 正在批量转换</> : <><Images size={16} /> 批量转换</>}
          </button>
        </section>

        {busy && <section className="batch-progress" aria-live="polite">
          <div className="batch-progress-head"><strong>正在处理 {progress.completed}/{progress.total} 张图片</strong><span>{progress.converted} 成功 · {progress.skipped} 跳过 · {progress.failed} 失败</span></div>
          <progress value={progressValue} max="100" aria-label="批量转换进度" />
          <p>{progress.current || "正在准备图片…"}</p>
        </section>}

        {result && <section className="batch-result" aria-live="polite">
          <div><h2>处理完成</h2><p>共扫描 {result.total} 张图片。</p></div>
          <dl><div><dt>已转换</dt><dd>{result.converted}</dd></div><div><dt>已跳过</dt><dd>{result.skipped}</dd></div><div><dt>失败</dt><dd>{result.failed}</dd></div></dl>
          {result.failures.length > 0 && <div className="batch-failures"><strong>失败文件</strong><ul>{result.failures.map((failure) => <li key={`${failure.path}-${failure.reason}`}><span>{failure.path}</span><small>{failure.reason}</small></li>)}</ul></div>}
        </section>}
      </main>
    </Shell>
  );
}
