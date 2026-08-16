import { LoaderCircle } from "lucide-react";
import "./ConfirmDialog.css";

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  error: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  error,
  loading,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onClick={() => !loading && onCancel()}
    >
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h2 id="confirm-dialog-title">{title}</h2>
          <p id="confirm-dialog-message">{message}</p>
        </div>
        {error && <p className="confirm-dialog-error">{error}</p>}
        <div className="confirm-dialog-actions">
          <button className="text-button" type="button" onClick={onCancel} disabled={loading}>
            取消
          </button>
          <button className="confirm-dialog-confirm" type="button" onClick={onConfirm} disabled={loading}>
            {loading && <LoaderCircle className="spin" size={16} />}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
