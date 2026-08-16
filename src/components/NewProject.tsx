import { type FormEvent, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import {
  AiProductAnalysis,
  type ProductAnalysisMode,
} from "./AiProductAnalysis";
import { CreationGoalSelector } from "./CreationGoalSelector";
import { ImageReferencePicker } from "./ImageReferencePicker";
import { Shell } from "./Shell";
import { useAppStore } from "../store";
import { fileUrl } from "../utils/assets";
import "./NewProject.css";

export function NewProject() {
  const templates = useAppStore((state) => state.templates);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const [kind, setKind] = useState("amazon");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState("");
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisMode, setAnalysisMode] = useState<ProductAnalysisMode>(null);
  const [brandColor, setBrandColor] = useState("#137a65");
  const [pickerColor, setPickerColor] = useState("#137a65");
  const formRef = useRef<HTMLFormElement>(null);

  async function upload(file: File) {
    setReferenceBusy(true);
    setError("");
    try {
      const result = await client.upload(file);
      setReference(result.path);
      setPreview(fileUrl(result.path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setReferenceBusy(false);
    }
  }
  async function importUrl(url: string) {
    setReferenceBusy(true);
    setError("");
    try {
      const result = await client.importUrl(url);
      setReference(result.path);
      setPreview(fileUrl(result.path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败");
    } finally {
      setReferenceBusy(false);
    }
  }
  async function analyze(mode: "name" | "image") {
    const form = new FormData(formRef.current!);
    const product = String(form.get("product") || "").trim();
    if (mode === "name" && !product) {
      setError("请先填写商品名称");
      return;
    }
    if (mode === "image" && !reference) {
      setError("请先上传或导入一张商品图片");
      return;
    }
    setAnalyzing(true);
    setAnalysisMode(mode);
    setError("");
    setAnalysisStatus(
      mode === "name"
        ? "正在根据商品名称整理描述和卖点..."
        : "正在读取商品图片并整理描述和卖点...",
    );
    try {
      const result = await client.analyze({
        mode,
        product,
        reference,
      });
      const description = formRef.current!.elements.namedItem(
        "description",
      ) as HTMLTextAreaElement;
      const benefits = formRef.current!.elements.namedItem(
        "benefits",
      ) as HTMLTextAreaElement;
      description.value = result.description;
      benefits.value = result.benefits.join("；");
      setAnalysisStatus("已生成商品描述和 4 条核心卖点，可以继续编辑。");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "AI 分析失败";
      setError(message);
      setAnalysisStatus(message);
    } finally {
      setAnalyzing(false);
      setAnalysisMode(null);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const project = await client.createProject({
        name: String(form.get("name")),
        product: String(form.get("product")),
        description: String(form.get("description")),
        benefits: String(form.get("benefits")),
        color: String(form.get("color")),
        reference,
      });
      await client.createPack(project.id, {
        kind,
        scene_template_ids: selectedTemplates,
      });
      await refreshProjects();
      navigate(`/projects/${project.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  const count =
    kind === "amazon"
      ? 7 + selectedTemplates.length
      : kind === "social"
        ? 3
        : 1;
  const creationSummary =
    kind === "amazon"
      ? selectedTemplates.length
        ? `将生成 ${count} 张商品视觉，含 ${selectedTemplates.length} 个自定义场景`
        : "将生成 7 张可单独编辑的商品视觉"
      : kind === "social"
        ? "将生成 3 张社媒内容图"
        : "将生成 1 张商品主图";
  return (
    <Shell>
      <header className="topbar">
        <strong>新建创作</strong>
      </header>
      <div className="page create-page">
        <div className="create-intro">
          <button className="back-link" onClick={() => navigate("/")}>
            <ArrowLeft size={15} />
            返回创作台
          </button>
          <span className="eyebrow">NEW CREATION</span>
          <h1>
            先确定你想让商品
            <br />
            被怎样看见。
          </h1>
          <p>
            信息不需要一次填完。先选择目标，生成后仍可编辑每张图的内容和风格。
          </p>
        </div>
        <form ref={formRef} onSubmit={submit} className="creation-form">
          <section className="step">
            <span className="step-index">01</span>
            <div className="step-body">
              <h2>添加商品参考</h2>
              <p>
                上传本地商品图，或粘贴公开网络图片地址。系统会将其保存到当前项目中。
              </p>
              <label className="product-name-field">
                商品名称
                <input
                  name="product"
                  required
                  placeholder="例如：实木双抽书桌"
                />
              </label>
              <ImageReferencePicker
                preview={preview}
                loading={referenceBusy}
                onUpload={(file) => void upload(file)}
                onImport={(url) => void importUrl(url)}
              />
              <AiProductAnalysis
                analyzing={analyzing}
                mode={analysisMode}
                status={analysisStatus}
                onAnalyze={(mode) => void analyze(mode)}
              />
              <label>
                商品描述
                <textarea
                  name="description"
                  rows={3}
                  placeholder="描述商品材质、结构和使用场景"
                />
              </label>
            </div>
          </section>
          <CreationGoalSelector
            kind={kind}
            templates={templates}
            selectedTemplates={selectedTemplates}
            onKindChange={setKind}
            onTemplateToggle={(templateId) =>
              setSelectedTemplates((current) =>
                current.includes(templateId)
                  ? current.filter((id) => id !== templateId)
                  : [...current, templateId],
              )
            }
          />
          <section className="step">
            <span className="step-index">03</span>
            <div className="step-body">
              <h2>给它一个方向</h2>
              <div className="two-col">
                <label>
                  项目名称
                  <input
                    name="name"
                    required
                    placeholder="例如：北欧实木书桌 Campaign"
                  />
                </label>
                <label>
                  品牌主色
                  <div className="brand-color-control">
                    <input
                      id="brand-color-picker"
                      type="color"
                      value={pickerColor}
                      onChange={(event) => {
                        setPickerColor(event.target.value);
                        setBrandColor(event.target.value.toUpperCase());
                      }}
                      aria-label="选择品牌主色"
                    />
                    <input
                      id="brand-color-hex"
                      name="color"
                      type="text"
                      value={brandColor}
                      maxLength={7}
                      spellCheck={false}
                      onChange={(event) => {
                        const value = event.target.value;
                        setBrandColor(value);
                        const normalized = value.trim();
                        if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
                          setPickerColor(normalized);
                        }
                      }}
                      onBlur={() => {
                        const normalized = brandColor.trim();
                        if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
                          setPickerColor(normalized);
                          setBrandColor(normalized.toUpperCase());
                        }
                      }}
                      aria-label="品牌主色十六进制代码"
                    />
                  </div>
                </label>
              </div>
              <label>
                核心卖点
                <textarea
                  name="benefits"
                  rows={3}
                  placeholder="实木质感；双抽收纳；稳定桌腿"
                />
              </label>
            </div>
          </section>
          {error && <p className="form-error">{error}</p>}
          <footer className="creation-footer">
            <span>{creationSummary}</span>
            <button className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={16} />}
              创建并进入画布
            </button>
          </footer>
        </form>
      </div>
    </Shell>
  );
}
