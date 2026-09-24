import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { client } from "../api";
import { useRequireAiAuth } from "../auth";
import { useAiInteraction } from "../aiInteraction";
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

const NEW_PROJECT_DRAFT = "frameboard:new-project-draft";

type NewProjectDraft = {
  fields: Record<string, string>;
  kind: string;
  reference: string;
  selectedTemplates: string[];
  brandColor: string;
};

function loadDraft(): NewProjectDraft | null {
  try {
    return JSON.parse(sessionStorage.getItem(NEW_PROJECT_DRAFT) || "null");
  } catch {
    return null;
  }
}

export function NewProject() {
  const [draft] = useState(loadDraft);
  const templates = useAppStore((state) => state.templates);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const navigate = useNavigate();
  const requireAiAuth = useRequireAiAuth();
  const { registerPage } = useAiInteraction();
  const [searchParams] = useSearchParams();
  const selectedTemplate = templates.find(
    (template) => template.id === searchParams.get("template"),
  );
  const [kind, setKind] = useState(
    draft?.kind ?? (selectedTemplate ? "custom" : "amazon"),
  );
  const [reference, setReference] = useState(draft?.reference ?? "");
  const [preview, setPreview] = useState(
    draft?.reference ? fileUrl(draft.reference) : "",
  );
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>(
    draft?.selectedTemplates ?? [],
  );
  const [error, setError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisMode, setAnalysisMode] = useState<ProductAnalysisMode>(null);
  const [brandColor, setBrandColor] = useState(draft?.brandColor ?? "#137a65");
  const [pickerColor, setPickerColor] = useState(
    draft?.brandColor ?? "#137a65",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const createdProjectId = useRef("");

  useEffect(
    () =>
      registerPage({
        screen: "新建创作",
        data: () => {
          const fields = formRef.current
            ? Object.fromEntries(
                [...new FormData(formRef.current).entries()].map(
                  ([key, value]) => [key, String(value)],
                ),
              )
            : {};
          return {
            draft: fields,
            kind,
            reference: reference || undefined,
            selected_template_ids: selectedTemplates,
            available_templates: templates.map((template) => ({
              id: template.id,
              name: template.name,
              ratio: template.ratio,
            })),
          };
        },
        execute: (action) => {
          if (action.type !== "fill_draft") return false;
          const fields = action.payload.fields;
          if (fields && typeof fields === "object" && !Array.isArray(fields)) {
            for (const [name, value] of Object.entries(fields)) {
              const field = formRef.current?.elements.namedItem(name);
              if (
                (field instanceof HTMLInputElement ||
                  field instanceof HTMLTextAreaElement) &&
                typeof value === "string"
              ) {
                field.value = value;
              }
            }
          }
          if (typeof action.payload.kind === "string")
            setKind(action.payload.kind);
          if (typeof action.payload.color === "string")
            setBrandColor(action.payload.color);
          return true;
        },
      }),
    [kind, reference, registerPage, selectedTemplates, templates],
  );

  useEffect(() => {
    if (!draft || !formRef.current) return;
    for (const [name, value] of Object.entries(draft.fields)) {
      const field = formRef.current.elements.namedItem(name);
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement
      ) {
        field.value = value;
      }
    }
  }, [draft]);

  function saveDraft() {
    if (!formRef.current) return;
    const fields = Object.fromEntries(
      [...new FormData(formRef.current).entries()].map(([name, value]) => [
        name,
        String(value),
      ]),
    );
    sessionStorage.setItem(
      NEW_PROJECT_DRAFT,
      JSON.stringify({
        fields,
        kind,
        reference,
        selectedTemplates,
        brandColor,
      }),
    );
  }

  async function upload() {
    setReferenceBusy(true);
    setReferenceError("");
    setError("");
    try {
      const result = await client.pickImage();
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
    setReferenceError("");
    setError("");
    try {
      const result = await client.importUrl(url);
      setReference(result.path);
      setPreview(fileUrl(result.path));
    } catch (reason) {
      setReferenceError(reason instanceof Error ? reason.message : "导入失败");
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
    if (!requireAiAuth()) {
      saveDraft();
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
      setAnalysisStatus(
        `已生成商品描述和 ${result.benefits.length} 条卖点，可继续编辑。`,
      );
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
      if (!createdProjectId.current) {
        const project = await client.createProject({
          name: String(form.get("name")),
          product: String(form.get("product")),
          description: String(form.get("description")),
          benefits: String(form.get("benefits")),
          color: String(form.get("color")),
          reference,
        });
        createdProjectId.current = project.id;
      }
      try {
        await client.createPack(createdProjectId.current, {
          kind,
          scene_template_ids: selectedTemplates,
          template_id: kind === "custom" ? selectedTemplate?.id : undefined,
        });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "请重试";
        throw new Error(`项目已保存，但画面创建失败：${message}`);
      }
      sessionStorage.removeItem(NEW_PROJECT_DRAFT);
      await refreshProjects().catch(() => {});
      navigate(`/projects/${createdProjectId.current}`, {
        state: { justCreated: true },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
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
  const creationSummary = `将保存 ${count} 个待生成画面，暂不开始生成`;
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
          <span className="eyebrow">新建项目</span>
          <h1>从商品信息开始创作</h1>
          <p>
            填写商品信息、选择画面组合。保存后进入项目工作台，检查画面并开始生成。
          </p>
        </div>
        <form ref={formRef} onSubmit={submit} className="creation-form">
          <section className="step">
            <span className="step-index">01</span>
            <div className="step-body">
              <h2>填写商品信息</h2>
              <p>输入商品名称，可选添加参考图；图片会保存在本机。</p>
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
                error={referenceError}
                onUpload={() => void upload()}
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
            selectedTemplate={selectedTemplate}
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
              <h2>命名项目并补充卖点</h2>
              <div className="two-col">
                <label>
                  项目名称
                  <input
                    name="name"
                    required
                    placeholder="例如：北欧实木书桌主图"
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
              保存并进入项目工作台
            </button>
          </footer>
        </form>
      </div>
    </Shell>
  );
}
