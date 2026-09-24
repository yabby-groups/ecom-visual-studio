import { useEffect, useState } from "react";
import {
  customImageSize,
  imageRatioLabel,
  imageSizeError,
  nativeImageRatios,
} from "../constants/imageSizes";
import "./ImageRatioPicker.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function ImageRatioPicker({ value, onChange }: Props) {
  const selectedSize = customImageSize(value);
  const [customOpen, setCustomOpen] = useState(Boolean(selectedSize));
  const [width, setWidth] = useState(String(selectedSize?.[0] ?? 1024));
  const [height, setHeight] = useState(String(selectedSize?.[1] ?? 1024));
  const [error, setError] = useState("");
  const draftError = imageSizeError(Number(width), Number(height));
  const draftRatio = draftError ? "" : imageRatioLabel(`${width}x${height}`);

  useEffect(() => {
    const size = customImageSize(value);
    setCustomOpen(Boolean(size));
    if (size) {
      setWidth(String(size[0]));
      setHeight(String(size[1]));
    }
    setError("");
  }, [value]);

  function applyCustom() {
    const w = Number(width);
    const h = Number(height);
    const validationError = imageSizeError(w, h);
    setError(validationError);
    if (!validationError) onChange(`${w}x${h}`);
  }

  return (
    <>
      <div className="ratio-row">
        {nativeImageRatios.map(({ ratio, size }) => (
          <button
            type="button"
            key={ratio}
            className={value === ratio ? "active" : ""}
            aria-pressed={value === ratio}
            onClick={() => {
              setCustomOpen(false);
              onChange(ratio);
            }}
            title={`${ratio} · ${size}`}
          >
            <b>{ratio}</b>
            <small>{size}</small>
          </button>
        ))}
        <button
          type="button"
          className={selectedSize ? "active" : ""}
          aria-pressed={Boolean(selectedSize)}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
        >
          <b>自定义</b>
          <small>{selectedSize ? imageRatioLabel(value) : "宽 × 高"}</small>
        </button>
      </div>
      {customOpen && (
        <div className="custom-image-size">
          <label>
            宽度
            <input
              type="number"
              min="16"
              max="3840"
              step="16"
              value={width}
              onChange={(event) => {
                setWidth(event.target.value);
                setError("");
              }}
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
              value={height}
              onChange={(event) => {
                setHeight(event.target.value);
                setError("");
              }}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            onClick={applyCustom}
          >
            应用
          </button>
          {draftRatio && (
            <small className="custom-size-ratio">{draftRatio}</small>
          )}
          {error && <small role="alert">{error}</small>}
        </div>
      )}
    </>
  );
}
