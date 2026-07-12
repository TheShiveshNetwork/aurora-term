import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { ChevronDown, Check, Search } from "lucide-react";

export interface SearchableOption {
  id: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableOption[];
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  className = "",
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 150);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return options;
    const q = debouncedSearch.toLowerCase();
    return options.filter(
      (o) => o.id.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [options, debouncedSearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
        setDebouncedSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setSearch("");
        setDebouncedSearch("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setIsOpen(false);
      setSearch("");
      setDebouncedSearch("");
    },
    [onChange]
  );

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (isOpen) {
            setSearch("");
            setDebouncedSearch("");
          }
        }}
        className="w-full flex items-center justify-between gap-2 bg-background border border-outline rounded-[8px] px-2.5 py-1.5 text-[11px] font-code-base text-on-background outline-none cursor-pointer select-none hover:border-primary/40 transition-colors"
      >
        <span className={`truncate ${selected ? "" : "text-on-surface/35"}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-on-surface/40 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute z-[99999] left-0 right-0 top-full mt-1 bg-surface border border-outline rounded-[8px] overflow-hidden"
          style={{
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.03), 0 16px 40px rgba(0,0,0,0.5)",
          }}
        >
          <div className="relative px-2 pt-2 pb-1">
            <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/3 text-on-surface/30 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search themes…"
              className="w-full bg-background border border-outline rounded-[6px] pl-6 pr-2 py-1 text-[11px] font-code-base text-on-background outline-none placeholder:text-on-surface/25"
            />
          </div>

          <div className="max-h-52 overflow-y-auto p-1" style={{ scrollbarWidth: "thin" }}>
            {filtered.length > 0 ? (
              filtered.map((o) => (
                <button
                  key={o.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(o.id);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-left cursor-pointer border-none rounded-[6px] font-[inherit] transition-colors ${
                    o.id === value
                      ? "bg-primary-container text-primary"
                      : "hover:bg-white/[0.06] text-on-background"
                  }`}
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
                    {o.label}
                  </span>
                  {o.id === value && <Check size={12} className="shrink-0 text-primary" />}
                </button>
              ))
            ) : (
              <div className="px-2.5 py-3 text-[11px] text-on-surface/30 text-center">
                No themes match
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
