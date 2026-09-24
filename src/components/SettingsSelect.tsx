import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type SettingsSelectOption = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

type SettingsSelectProps = {
  name: string;
  value: string;
  options: SettingsSelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function SettingsSelect({
  name,
  value,
  options,
  disabled = false,
  onChange,
}: SettingsSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    function closeWhenOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div className="settings-select" ref={rootRef}>
      <input name={name} type="hidden" value={value} />
      <button
        type="button"
        className="settings-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((isOpen) => !isOpen)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="settings-select-content">
          <span className="settings-select-label">
            {selected?.label || "暂无可选项"}
          </span>
          {selected?.detail && (
            <span className="settings-select-detail">{selected.detail}</span>
          )}
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {open && (
        <div className="settings-select-menu" id={listId} role="listbox">
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "is-selected" : ""}
              disabled={option.disabled}
              key={option.value}
              onPointerDown={(event) => {
                // Wails can repaint during a theme switch before a click event
                // is delivered. Commit selection on pointerdown so the menu
                // always closes as part of the same interaction.
                event.preventDefault();
                setOpen(false);
                onChange(option.value);
              }}
              onClick={(event) => {
                // Keyboard activation does not produce a pointer event. Pointer
                // clicks have a positive detail and were already handled above.
                if (event.detail !== 0) return;
                setOpen(false);
                onChange(option.value);
              }}
            >
              <span className="settings-select-content">
                <span className="settings-select-label">{option.label}</span>
                {option.detail && (
                  <span className="settings-select-detail">{option.detail}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
