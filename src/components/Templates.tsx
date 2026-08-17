import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { client } from "../api";
import { nativeImageRatios } from "../constants/imageSizes";
import { Shell } from "./Shell";
import { useAppStore } from "../store";
import "./Templates.css";

export function Templates() {
  const templates = useAppStore((state) => state.templates);
  const refresh = useAppStore((state) => state.refreshTemplates);
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const wallRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const [masonry, setMasonry] = useState({
    height: 0,
    positions: {} as Record<string, { left: number; top: number }>,
  });
  const guide: Record<string, [string, string, string]> = {
    "hero-image": [
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=900&q=80",
      "为商品建立清晰、可信的第一印象。",
      "白底或纯色背景，突出外观、材质与完整轮廓。",
    ],
    "lifestyle-scene": [
      "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=80",
      "让商品进入真实的生活与使用场景。",
      "空间氛围、人物行为或使用瞬间，适合讲述使用价值。",
    ],
    "detail-macro": [
      "https://images.unsplash.com/photo-1618220179428-22790b461013?auto=format&fit=crop&w=900&q=80",
      "放大材质、做工和关键功能细节。",
      "近景构图与质感光线，帮助用户确认产品品质。",
    ],
    "poster-banner": [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
      "用于促销节点、投放和品牌活动传播。",
      "商品焦点、活动氛围、标题留白和明确的行动区域。",
    ],
    "social-media": [
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80",
      "构建适合社交平台停留与转发的画面。",
      "强视觉中心、自然构图与可承载短文案的留白。",
    ],
    "ugc-style": [
      "https://images.unsplash.com/photo-1604014237800-1c9102c219da?auto=format&fit=crop&w=900&q=80",
      "营造真实用户记录和日常分享感。",
      "自然光、轻微不完美感与生活化视角，降低广告感。",
    ],
    infographic: [
      "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=80",
      "把卖点、参数和购买理由组织成详情图。",
      "产品主体配合图标、标签、短文案与结构化信息区。",
    ],
    "size-spec": [
      "https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?auto=format&fit=crop&w=900&q=80",
      "清楚表达尺寸、结构和适配空间。",
      "产品正侧视角、尺寸线和规格说明区域。",
    ],
    livestream: [
      "https://images.unsplash.com/photo-1581368135153-a506cf13b1e1?auto=format&fit=crop&w=900&q=80",
      "搭建直播讲解与带货展示场景。",
      "产品陈列、镜头景别、互动区域和直播氛围。",
    ],
    packaging: [
      "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=900&q=80",
      "呈现包装、开箱和礼赠体验。",
      "包装正面、内衬、配件和品牌细节的组合展示。",
    ],
    "multi-angle-grid": [
      "https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?auto=format&fit=crop&w=900&q=80",
      "在一张图中交代多角度与完整结构。",
      "正面、侧面、细节与局部特写的有序网格。",
    ],
    "seasonal-campaign": [
      "https://images.unsplash.com/photo-1512389142860-9c449e58a543?auto=format&fit=crop&w=900&q=80",
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
          <span className="eyebrow">CREATIVE STARTING POINTS</span>
          <h1>从一个画面方向开始</h1>
          <p>
            每个方向都定义了画面的商业目的、构图重点和主要内容。选择后可继续调整风格与细节。
          </p>
        </div>
        <form className="custom-template-form" onSubmit={submit}>
          <div>
            <span>自定义场景模板</span>
            <small>保存后可在画布右侧的场景模板中选择</small>
          </div>
          <input
            name="name"
            maxLength={80}
            placeholder="模板名称，例如：户外跑步场景"
            required
          />
          <select name="ratio" defaultValue="1:1">
            {nativeImageRatios.map(({ ratio, label, size }) => (
              <option value={ratio} key={ratio}>
                {ratio} {label} · {size}
              </option>
            ))}
          </select>
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
            const direction = guide[item.id] || guide["hero-image"];
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
                <img
                  className="template-photo"
                  src={direction[0]}
                  alt={`${item.name} 模板示例`}
                  loading="lazy"
                />
                <div>
                  <small>
                    {item.group} · {item.ratio}
                  </small>
                  <b>{item.name}</b>
                  <p>{direction[1]}</p>
                  <span>{direction[2]}</span>
                  <i>使用此方向</i>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
