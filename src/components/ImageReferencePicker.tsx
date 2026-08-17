import { ImagePlus, Link2, LoaderCircle, Upload } from "lucide-react";
import { useState } from "react";

type ImageReferencePickerProps = {
  preview: string;
  loading: boolean;
  onUpload: (file: File) => void;
  onImport: (url: string) => void;
};

type Source = "upload" | "url";

export function ImageReferencePicker({
  preview,
  loading,
  onUpload,
  onImport,
}: ImageReferencePickerProps) {
  const [source, setSource] = useState<Source>("upload");
  const [url, setUrl] = useState("");

  return (
    <div className="reference-picker">
      <div className="reference-preview">
        {preview ? (
          <img src={preview} alt="参考商品" />
        ) : (
          <div className="reference-empty">
            <span className="reference-empty-icon" aria-hidden="true">
              <ImagePlus size={24} />
            </span>
            <b>添加商品主图</b>
            <span>清晰的正面或主体图将帮助生成更准确的视觉内容</span>
          </div>
        )}
        {preview && <span className="reference-ready">已添加</span>}
      </div>

      <div className="reference-input-panel">
        <div className="reference-panel-heading">
          <span>图片来源</span>
          <small>支持 JPG、PNG、WebP，最大 15MB</small>
        </div>
        <div
          className="reference-source-tabs"
          role="tablist"
          aria-label="选择图片来源"
        >
          <button
            type="button"
            role="tab"
            aria-selected={source === "upload"}
            className={source === "upload" ? "active" : ""}
            onClick={() => setSource("upload")}
          >
            <Upload size={15} />
            本地上传
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === "url"}
            className={source === "url" ? "active" : ""}
            onClick={() => setSource("url")}
          >
            <Link2 size={15} />
            网络链接
          </button>
        </div>

        {source === "upload" ? (
          <label className="reference-upload-zone">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={loading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.currentTarget.value = "";
              }}
            />
            {loading ? (
              <LoaderCircle className="spin" size={22} />
            ) : (
              <Upload size={22} />
            )}
            <b>
              {loading
                ? "正在上传图片"
                : preview
                  ? "选择一张新图片"
                  : "选择本地图片"}
            </b>
            <small>{loading ? "请稍候..." : "点击选择文件"}</small>
          </label>
        ) : (
          <div className="reference-url-form">
            <label htmlFor="reference-url">公开图片链接</label>
            <div>
              <input
                id="reference-url"
                type="url"
                value={url}
                disabled={loading}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/product.jpg"
              />
              <button
                type="button"
                disabled={loading || !url.trim()}
                onClick={() => onImport(url.trim())}
              >
                {loading ? <LoaderCircle className="spin" size={17} /> : "导入"}
              </button>
            </div>
            <small>请输入可公开访问的图片地址</small>
          </div>
        )}
      </div>
    </div>
  );
}
