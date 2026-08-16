import { useEffect } from "react";
import { X } from "lucide-react";
import "./Notice.css";

export function Notice({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3500);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="notice" role="status">
      <span>{text}</span>
      <button onClick={onClose} aria-label="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}
