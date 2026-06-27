import React from "react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <div
        className="w-8 h-4 rounded-full transition-colors peer-checked:bg-primary"
        style={{ background: checked ? "#4F8CFF" : "rgba(255,255,255,0.1)" }}
      >
        <div
          className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
          style={{ marginTop: "1px" }}
        />
      </div>
    </label>
  );
}
