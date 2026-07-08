import React, { useState, useRef, useMemo, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";

export interface ComboboxOption {
  id: string;
  label: string;
}

type BaseProps = {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

type TextProps = BaseProps & { variant: "text" };
type SecretProps = BaseProps & { variant: "secret" };
type SelectProps = BaseProps & { variant: "select"; options: ComboboxOption[] };
type InputProps = TextProps | SecretProps | SelectProps;

const inputBaseClass =
  "w-full bg-background border border-outline rounded-[8px] px-2.5 py-1.5 text-[11px] font-code-base text-on-background outline-none cursor-text select-text";

export function Input(props: InputProps) {
  const { variant, value, onChange, placeholder, className = "", disabled } = props;

  if (variant === "secret") {
    return (
      <SecretInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />
    );
  }

  if (variant === "select") {
    const { options } = props as SelectProps;
    return (
      <SelectInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        options={options}
        disabled={disabled}
        className={className}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`${inputBaseClass} ${disabled ? "opacity-50 cursor-default" : ""} ${className}`}
    />
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
  disabled,
  className = "",
}: BaseProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="relative">
      <input
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`${inputBaseClass} pr-9 ${disabled ? "opacity-50 cursor-default" : ""} ${className}`}
      />
      <button
        type="button"
        onClick={() => setRevealed(!revealed)}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/[0.06] transition-all cursor-pointer border-none bg-transparent text-on-background/40 hover:text-on-background/70"
        tabIndex={-1}
      >
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function SelectInput({
  value,
  onChange,
  placeholder,
  options,
  disabled,
  className = "",
}: BaseProps & { options: ComboboxOption[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingChange, setPendingChange] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const displayValue = pendingChange ? search : value;

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) => o.id.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [options, search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={displayValue}
        onChange={(e) => {
          setSearch(e.target.value);
          setPendingChange(true);
          onChange(e.target.value);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          setPendingChange(false);
          setSearch("");
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={`${inputBaseClass} ${disabled ? "opacity-50 cursor-default" : ""} ${className}`}
      />
      {isOpen && (
        <div
          className="absolute z-[99999] left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-surface border border-outline rounded-[8px] p-1"
          style={{
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.03), 0 16px 40px rgba(0,0,0,0.5)",
          }}
        >
          {filtered.length > 0 ? (
            filtered.map((o) => (
              <button
                key={o.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSearch(o.id);
                  setPendingChange(true);
                  onChange(o.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center px-2.5 py-1.5 text-xs text-left cursor-pointer border-none rounded-[6px] font-[inherit] transition-colors ${o.id === value
                  ? "bg-primary-container text-primary"
                  : "hover:bg-white/[0.06] text-on-background"
                  }`}
              >
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {o.label}
                </span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-2 text-xs text-on-surface-variant">
              No matches
            </div>
          )}
        </div>
      )}
    </div>
  );
}
