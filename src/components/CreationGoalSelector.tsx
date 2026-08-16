import { Link } from "react-router-dom";
import type { Template } from "../types";

type CreationGoalSelectorProps = {
  kind: string;
  templates: Template[];
  selectedTemplate?: Template;
  selectedTemplates: string[];
  onKindChange: (kind: string) => void;
  onTemplateToggle: (templateId: string) => void;
};

const goals = [
  ["amazon", "商品视觉包", "主图、场景、细节和详情图", "7 张"],
  ["social", "社媒内容组图", "种草、UGC 和品牌海报", "3 张"],
  ["custom", "单张商品主图", "先从一个画面开始探索", "1 张"],
];

export function CreationGoalSelector({
  kind,
  templates,
  selectedTemplate,
  selectedTemplates,
  onKindChange,
  onTemplateToggle,
}: CreationGoalSelectorProps) {
  const customTemplates = templates.filter((template) => template.custom);

  return (
    <section className="step">
      <span className="step-index">02</span>
      <div className="step-body">
        <h2>选择创作目标</h2>
        <div className="goal-grid">
          {goals.map(([id, title, detail, amount]) => (
            <button
              type="button"
              className={`goal ${kind === id ? "active" : ""}`}
              onClick={() => onKindChange(id)}
              key={id}
            >
              <b>{title}</b>
              <span>{detail}</span>
              <i>{amount}</i>
            </button>
          ))}
        </div>
        {kind === "custom" && selectedTemplate && (
          <section className="pack-composer" aria-label="当前灵感方向">
            <div className="pack-composer-head">
              <div>
                <p className="analysis-kicker">SELECTED INSPIRATION</p>
                <h3>当前灵感方向：{selectedTemplate.name}</h3>
                <small>
                  {selectedTemplate.ratio} · {selectedTemplate.direction}
                </small>
              </div>
              <strong>1 张</strong>
            </div>
          </section>
        )}
        {kind === "amazon" && (
          <section
            className="pack-composer"
            aria-labelledby="pack-composer-title"
          >
            <div className="pack-composer-head">
              <div>
                <p className="analysis-kicker">CUSTOM SCENES</p>
                <h3 id="pack-composer-title">扩展商品视觉包</h3>
                <small>
                  默认 7
                  张核心画面；勾选的自定义场景会作为独立画面加入生成队列。
                </small>
              </div>
              <strong aria-live="polite">
                共 {7 + selectedTemplates.length} 张
              </strong>
            </div>
            {customTemplates.length ? (
              <div className="pack-scene-list">
                {customTemplates.map((template) => (
                  <label
                    className={`pack-scene-option ${selectedTemplates.includes(template.id) ? "is-selected" : ""}`}
                    key={template.id}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTemplates.includes(template.id)}
                      onChange={() => onTemplateToggle(template.id)}
                    />
                    <span className="pack-scene-check" aria-hidden="true" />
                    <span>
                      <b>{template.name}</b>
                      <small>
                        {template.ratio} · {template.direction}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="pack-composer-empty">
                <span>还没有自定义场景</span>
                <Link className="text-button" to="/templates">
                  创建场景模板
                </Link>
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
