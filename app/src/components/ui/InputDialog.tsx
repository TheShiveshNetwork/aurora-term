import { useState, useEffect, useRef, useCallback } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface InputDialogProps {
  open: boolean;
  title: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InputDialog({
  open, title, description, initialValue = "", placeholder,
  confirmLabel = "OK", onSubmit, onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialValue]);

  const handleSubmit = useCallback(() => {
    if (value.trim()) onSubmit(value.trim());
  }, [value, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  }, [handleSubmit]);

  return (
    <Modal open={open} onClose={onCancel} title={title} description={description}>
      <div className="flex flex-col gap-3">
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm rounded-lg border outline-none transition-colors"
          style={{
            background: "rgba(255,255,255,0.04)",
            borderColor: "rgba(255,255,255,0.1)",
            color: "#E8EAF0",
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
