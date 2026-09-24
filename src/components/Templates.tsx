import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import { nativeImageRatios } from "../constants/imageSizes";
import { Shell } from "./Shell";
import { useAppStore } from "../store";
import { useAiInteraction } from "../aiInteraction";
import "./Templates.css";

export function Templates() {
  const templates = useAppStore((state) => state.templates);
  const refresh = useAppStore((state) => state.refreshTemplates);
  const navigate = useNavigate();
  const { registerPage } = useAiInteraction();
  const [error, setError] = useState("");
  const wallRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
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
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await client.addTemplate({
        name: String(form.get("name")),
        ratio: String(form.get("ratio")),
        direction: String(form.get("direction")),
      });
      await refresh();
      event.currentTarget.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    }
  }
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
        <div className="library-heading">
          <span className="eyebrow">画面模板</span>
          <h1>从一个画面方向开始</h1>
          <p>选择模板创建画面，进入项目后可调整提示词和比例。</p>
        </div>
        <form className="custom-template-form" onSubmit={submit}>
          <div>
            <span>自定义场景模板</span>
            <small>保存后可在新建项目或项目工作区中使用</small>
          </div>
          <input
            name="name"
            maxLength={80}
            placeholder="模板名称，例如：户外跑步场景"
            required
          />
          <div className="template-ratio-select">
            <select name="ratio" defaultValue="1:1" aria-label="画面比例">
              {nativeImageRatios.map(({ ratio, label, size }) => (
                <option value={ratio} key={ratio}>
                  {ratio} {label} · {size}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" size={18} strokeWidth={2.5} />
          </div>
          <textarea
            name="direction"
            maxLength={1800}
            placeholder="描述背景、光线、构图和商品如何出现"
            required
          />
          <button className="create-button">保存模板</button>
        </form>
        {error && <p className="form-error">{error}</p>}
        <div
          className="template-wall"
          ref={wallRef}
          style={{ height: masonry.height }}
        >
          {templates.map((item) => {
            const direction = guide[item.id];
            const position = masonry.positions[item.id];
            return (
              <button
                className="template-tile"
                onClick={() =>
                  navigate(`/new?template=${encodeURIComponent(item.id)}`)
                }
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
                {direction ? (
                  <img
                    className="template-photo"
                    src={direction[0]}
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
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
