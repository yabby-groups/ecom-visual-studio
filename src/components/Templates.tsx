import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import {
  customImageSize,
  imageRatioLabel,
  imageSizeError,
  nativeImageRatios,
} from "../constants/imageSizes";
import { Shell } from "./Shell";
import { useAppStore } from "../store";
import { useAiInteraction } from "../aiInteraction";
import type { Template } from "../types";
import { fileUrl } from "../utils/assets";
import "./Templates.css";
import "./ImageRatioPicker.css";

export function Templates() {
  const templates = useAppStore((state) => state.templates);
  const refresh = useAppStore((state) => state.refreshTemplates);
  const navigate = useNavigate();
  const { registerPage } = useAiInteraction();
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imagePath, setImagePath] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [templateRatio, setTemplateRatio] = useState("1:1");
  const [customWidth, setCustomWidth] = useState("1024");
  const [customHeight, setCustomHeight] = useState("1024");
  const savingRef = useRef(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const wallRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const [masonry, setMasonry] = useState({
    height: 0,
    positions: {} as Record<string, { left: number; top: number }>,
  });
  useEffect(
    () =>
      registerPage({
        screen: "灵感模板",
        data: () => ({
          templates: templates.map((template) => ({
            id: template.id,
            name: template.name,
            ratio: template.ratio,
            direction: template.direction,
            custom: template.custom,
          })),
        }),
      }),
    [registerPage, templates],
  );
  const guide: Record<string, [string, string, string]> = {
    "hero-image": [
      "/template-previews/hero-image.jpg",
      "为商品建立清晰、可信的第一印象。",
      "白底或纯色背景，突出外观、材质与完整轮廓。",
    ],
    "lifestyle-scene": [
      "/template-previews/lifestyle-scene.jpg",
      "让商品进入真实的生活与使用场景。",
      "空间氛围、人物行为或使用瞬间，适合讲述使用价值。",
    ],
    "detail-macro": [
      "/template-previews/detail-macro.jpg",
      "放大材质、做工和关键功能细节。",
      "近景构图与质感光线，帮助用户确认产品品质。",
    ],
    "poster-banner": [
      "/template-previews/poster-banner.jpg",
      "用于促销节点、投放和品牌活动传播。",
      "商品焦点、活动氛围、标题留白和明确的行动区域。",
    ],
    "social-media": [
      "/template-previews/social-media.jpg",
      "构建适合社交平台停留与转发的画面。",
      "强视觉中心、自然构图与可承载短文案的留白。",
    ],
    "ugc-style": [
      "/template-previews/ugc-style.jpg",
      "营造真实用户记录和日常分享感。",
      "自然光、轻微不完美感与生活化视角，降低广告感。",
    ],
    infographic: [
      "/template-previews/infographic.jpg",
      "把卖点、参数和购买理由组织成详情图。",
      "产品主体配合图标、标签、短文案与结构化信息区。",
    ],
    "size-spec": [
      "/template-previews/size-spec.jpg",
      "清楚表达尺寸、结构和适配空间。",
      "产品正侧视角、尺寸线和规格说明区域。",
    ],
    livestream: [
      "/template-previews/livestream.jpg",
      "搭建直播讲解与带货展示场景。",
      "产品陈列、镜头景别、互动区域和直播氛围。",
    ],
    packaging: [
      "/template-previews/packaging.jpg",
      "呈现包装、开箱和礼赠体验。",
      "包装正面、内衬、配件和品牌细节的组合展示。",
    ],
    "multi-angle-grid": [
      "/template-previews/multi-angle-grid.jpg",
      "在一张图中交代多角度与完整结构。",
      "正面、侧面、细节与局部特写的有序网格。",
    ],
    "seasonal-campaign": [
      "/template-previews/seasonal-campaign.jpg",
      "围绕节日、季节和主题活动建立统一视觉。",
      "季节元素、品牌色与商品陈列，共同传达活动氛围。",
    ],
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const form = new FormData(event.currentTarget);
    setError("");
    let ratio = templateRatio;
    if (ratio === "custom") {
      const width = Number(customWidth);
      const height = Number(customHeight);
      const sizeError = imageSizeError(width, height);
      if (sizeError) {
        setError(sizeError);
        return;
      }
      ratio = `${width}x${height}`;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const body = {
        name: String(form.get("name")),
        ratio,
        direction: String(form.get("direction")),
        image_path: imagePath,
      };
      if (editTemplate) {
        await client.updateTemplate(editTemplate.id, body);
      } else {
        await client.addTemplate(body);
      }
      await refresh();
      setCreateOpen(false);
      setEditTemplate(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function confirmDelete() {
    if (!deleteTemplate || deleting) return;
    setError("");
    setDeleting(true);
    try {
      await client.deleteTemplate(deleteTemplate.id);
      await refresh();
      setDeleteTemplate(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }
  async function chooseTemplateImage() {
    setError("");
    setImageBusy(true);
    try {
      const { path } = await client.pickImage();
      setImagePath(path);
    } catch (reason) {
      if (!(reason instanceof Error && reason.message === "未选择图片")) {
        setError(reason instanceof Error ? reason.message : "选择图片失败");
      }
    } finally {
      setImageBusy(false);
    }
  }
  useEffect(() => {
    if (!createOpen) return;
    nameRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) {
        setCreateOpen(false);
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      createButtonRef.current?.focus();
    };
  }, [createOpen]);
  useLayoutEffect(() => {
    const wall = wallRef.current;
    if (!wall) return;

    let frame = 0;
    const arrange = () => {
      const columns = window.matchMedia("(max-width: 640px)").matches ? 1 : 3;
      const gap = 16;
      const heights = Array.from({ length: columns }, () => 0);
      const positions: Record<string, { left: number; top: number }> = {};
      const columnWidth = (wall.clientWidth - gap * (columns - 1)) / columns;

      for (const item of templates) {
        const tile = tileRefs.current.get(item.id);
        if (!tile) continue;
        const column = heights.reduce(
          (shortest, height, index) =>
            height < heights[shortest] ? index : shortest,
          0,
        );
        positions[item.id] = {
          left: column * (columnWidth + gap),
          top: heights[column],
        };
        heights[column] += tile.offsetHeight + gap;
      }

      const height = Math.max(0, ...heights) - (templates.length ? gap : 0);
      setMasonry((current) => {
        const unchanged =
          current.height === height &&
          templates.every(
            (item) =>
              current.positions[item.id]?.left === positions[item.id]?.left &&
              current.positions[item.id]?.top === positions[item.id]?.top,
          );
        return unchanged ? current : { height, positions };
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(arrange);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(wall);
    tileRefs.current.forEach((tile) => observer.observe(tile));
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [templates]);

  return (
    <Shell>
      <div className="topbar">
        <strong>灵感模板</strong>
      </div>
      <div className="page template-page">
        <div className="template-page-heading">
          <div className="library-heading">
            <span className="eyebrow">画面模板</span>
            <h1>从一个画面方向开始</h1>
            <p>选择模板创建画面，进入项目后可调整提示词和比例。</p>
          </div>
          <button
            className="create-button template-create-trigger"
            type="button"
            ref={createButtonRef}
            onClick={() => {
              setError("");
              setEditTemplate(null);
              setImagePath("");
              setTemplateRatio("1:1");
              setCustomWidth("1024");
              setCustomHeight("1024");
              setCreateOpen(true);
            }}
          >
            <Plus size={18} aria-hidden="true" />
            新建场景模板
          </button>
        </div>
        <div
          className="template-wall"
          ref={wallRef}
          style={{ height: masonry.height }}
        >
          {templates.map((item) => {
            const direction = guide[item.id];
            const preview = item.custom
              ? fileUrl(item.image_path)
              : direction?.[0];
            const position = masonry.positions[item.id];
            return (
              <article
                className="template-tile-card"
                key={item.id}
                ref={(tile) => {
                  if (tile) tileRefs.current.set(item.id, tile);
                  else tileRefs.current.delete(item.id);
                }}
                style={
                  position
                    ? { left: position.left, top: position.top }
                    : undefined
                }
              >
                <button
                  className="template-tile"
                  onClick={() =>
                    navigate(`/new?template=${encodeURIComponent(item.id)}`)
                  }
                >
                  {preview ? (
                    <img
                      className="template-photo"
                      src={preview}
                      alt={`${item.name} 模板示例`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="template-custom-preview" aria-hidden="true">
                      <Sparkles size={28} />
                    </div>
                  )}
                  <div>
                    <small>
                      {item.group} · {item.ratio}
                    </small>
                    <b>{item.name}</b>
                    <p>{direction?.[1] || item.direction}</p>
                    {direction && <span>{direction[2]}</span>}
                    <i>使用此模板</i>
                  </div>
                </button>
                {item.custom && (
                  <div className="template-tile-actions">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => {
                        setError("");
                        setEditTemplate(item);
                        setImagePath(item.image_path ?? "");
                        const size = customImageSize(item.ratio);
                        setTemplateRatio(size ? "custom" : item.ratio);
                        if (size) {
                          setCustomWidth(String(size[0]));
                          setCustomHeight(String(size[1]));
                        }
                        setCreateOpen(true);
                      }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      编辑
                    </button>
                    <button
                      className="button secondary template-delete-button"
                      type="button"
                      onClick={() => {
                        setError("");
                        setDeleteTemplate(item);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      删除
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
      {createOpen && (
        <div
          className="template-create-backdrop"
          role="presentation"
          onClick={() => !saving && !imageBusy && setCreateOpen(false)}
        >
          <section
            className="template-create-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-create-title"
            aria-describedby="template-create-description"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="template-create-head">
              <div>
                <h2 id="template-create-title">
                  {editTemplate ? "编辑场景模板" : "新建场景模板"}
                </h2>
                <p id="template-create-description">
                  保存后可在新建项目或项目工作区中使用
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                title="关闭"
                onClick={() => setCreateOpen(false)}
                disabled={saving || imageBusy}
              >
                <X size={18} />
              </button>
            </div>
            <form className="template-create-form" onSubmit={submit}>
              <label>
                模板名称
                <input
                  ref={nameRef}
                  name="name"
                  maxLength={80}
                  placeholder="例如：户外跑步场景"
                  defaultValue={editTemplate?.name ?? ""}
                  required
                />
              </label>
              <label>
                画面比例
                <span className="template-ratio-select">
                  <select
                    name="ratio"
                    value={templateRatio}
                    onChange={(event) => setTemplateRatio(event.target.value)}
                  >
                    {nativeImageRatios.map(({ ratio, label, size }) => (
                      <option value={ratio} key={ratio}>
                        {ratio} {label} · {size}
                      </option>
                    ))}
                    <option value="custom">自定义尺寸</option>
                  </select>
                  <ChevronDown aria-hidden="true" size={18} strokeWidth={2.5} />
                </span>
              </label>
              {templateRatio === "custom" && (
                <div className="template-custom-size custom-image-size">
                  <label>
                    宽度
                    <input
                      type="number"
                      min="16"
                      max="3840"
                      step="16"
                      value={customWidth}
                      onChange={(event) => setCustomWidth(event.target.value)}
                      required
                    />
                  </label>
                  <span aria-hidden="true">×</span>
                  <label>
                    高度
                    <input
                      type="number"
                      min="16"
                      max="3840"
                      step="16"
                      value={customHeight}
                      onChange={(event) => setCustomHeight(event.target.value)}
                      required
                    />
                  </label>
                  {!imageSizeError(
                    Number(customWidth),
                    Number(customHeight),
                  ) && (
                    <small className="custom-size-ratio">
                      {imageRatioLabel(`${customWidth}x${customHeight}`)}
                    </small>
                  )}
                </div>
              )}
              <div className="template-image-field">
                <span>模板图片</span>
                <div className="template-image-picker">
                  {imagePath ? (
                    <img src={fileUrl(imagePath)} alt="模板图片预览" />
                  ) : (
                    <div className="template-image-empty">
                      <ImagePlus size={24} aria-hidden="true" />
                      <span>添加一张模板示例图片</span>
                    </div>
                  )}
                  <div className="template-image-picker-actions">
                    <small>JPG、PNG 或 WebP，最大 15MB</small>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => void chooseTemplateImage()}
                      disabled={imageBusy || saving}
                    >
                      {imageBusy ? (
                        <LoaderCircle
                          className="spin"
                          size={15}
                          aria-hidden="true"
                        />
                      ) : (
                        <ImagePlus size={15} aria-hidden="true" />
                      )}
                      {imagePath ? "替换图片" : "选择图片"}
                    </button>
                    {imagePath && (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => setImagePath("")}
                        disabled={imageBusy || saving}
                      >
                        移除图片
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <label>
                场景描述
                <textarea
                  name="direction"
                  maxLength={1800}
                  placeholder="描述背景、光线、构图和商品如何出现"
                  defaultValue={editTemplate?.direction ?? ""}
                  required
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="template-create-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={saving || imageBusy}
                >
                  取消
                </button>
                <button
                  className="create-button"
                  type="submit"
                  disabled={saving || imageBusy}
                >
                  {saving && (
                    <LoaderCircle
                      className="spin"
                      size={16}
                      aria-hidden="true"
                    />
                  )}
                  {editTemplate ? "保存修改" : "保存模板"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {deleteTemplate && (
        <div
          className="template-create-backdrop"
          role="presentation"
          onClick={() => !deleting && setDeleteTemplate(null)}
        >
          <section
            className="template-create-dialog template-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="template-delete-title"
            aria-describedby="template-delete-description"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="template-create-head">
              <div>
                <h2 id="template-delete-title">删除自定义模板？</h2>
                <p id="template-delete-description">
                  “{deleteTemplate.name}
                  ”将从模板列表中移除。已有画面和生成结果会保留。
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                title="关闭"
                onClick={() => setDeleteTemplate(null)}
                disabled={deleting}
              >
                <X size={18} />
              </button>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="template-create-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setDeleteTemplate(null)}
                disabled={deleting}
              >
                取消
              </button>
              <button
                className="create-button template-delete-confirm"
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
              >
                {deleting && (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                )}
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}
