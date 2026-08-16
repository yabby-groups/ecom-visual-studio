import { useEffect } from "react";
import { X } from "lucide-react";
import "./Notice.css";

export function Notice({
  text,
  onClose,
  autoCloseMs = 3500,
}: {
  text: string;
  onClose: () => void;
  autoCloseMs?: number | null;
}) {
  useEffect(() => {
    if (autoCloseMs === null) return;
    const timer = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [autoCloseMs, onClose]);
  return (
    <div className="notice" role="status">
      <span>{text}</span>
      <button onClick={onClose} aria-label="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}
