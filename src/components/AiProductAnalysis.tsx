export type ProductAnalysisMode = "name" | "image" | null;

type AiProductAnalysisProps = {
  analyzing: boolean;
  mode: ProductAnalysisMode;
  status: string;
  onAnalyze: (mode: Exclude<ProductAnalysisMode, null>) => void;
};

export function AiProductAnalysis({
  analyzing,
  mode,
  status,
  onAnalyze,
}: AiProductAnalysisProps) {
  return (
    <section className="ai-analysis" aria-labelledby="ai-analysis-title">
      <div>
        <span className="analysis-kicker">AI PRODUCT INTELLIGENCE</span>
        <h3 id="ai-analysis-title">让 AI 补全商品信息</h3>
        <p>
          选择一种分析方式，生成结果将写入商品描述和核心卖点，仍可手动调整。
        </p>
      </div>
      <div className="analysis-actions">
        <button
          type="button"
          className={`analysis-button ${mode === "name" ? "is-loading" : ""}`}
          disabled={analyzing}
          onClick={() => onAnalyze("name")}
        >
          <span aria-hidden="true">{mode === "name" ? "..." : "Aa"}</span>
          <b>{mode === "name" ? "正在分析" : "根据商品名称分析"}</b>
          <small>
            {mode === "name"
              ? "请稍候，结果将自动填入"
              : "适合已有明确品类和名称"}
          </small>
        </button>
        <button
          type="button"
          className={`analysis-button ${mode === "image" ? "is-loading" : ""}`}
          disabled={analyzing}
          onClick={() => onAnalyze("image")}
        >
          <span aria-hidden="true">{mode === "image" ? "..." : "◎"}</span>
          <b>{mode === "image" ? "正在分析" : "根据上传图片分析"}</b>
          <small>
            {mode === "image"
              ? "请稍候，结果将自动填入"
              : "从外观、结构和使用场景提取信息"}
          </small>
        </button>
      </div>
      <p className="analysis-status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
