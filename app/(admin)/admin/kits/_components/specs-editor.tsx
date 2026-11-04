"use client";

import { Plus, X } from "lucide-react";

interface SpecsEditorProps {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** Hidden input name for form submission (JSON string) */
  name?: string;
}

type Row = { key: string; value: string };

function toRows(record: Record<string, string>): Row[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function toRecord(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (k.length === 0) continue;
    out[k] = r.value;
  }
  return out;
}

const COMMON_KEYS = ["pieces", "age", "level", "brand", "weight", "compatibility"];

export function SpecsEditor({ value, onChange, name }: SpecsEditorProps) {
  const rows = toRows(value);

  const add = (suggestedKey = "") => {
    const next = [...rows, { key: suggestedKey, value: "" }];
    onChange(toRecord(next));
  };

  const remove = (idx: number) => {
    onChange(toRecord(rows.filter((_, i) => i !== idx)));
  };

  const updateKey = (idx: number, newKey: string) => {
    onChange(toRecord(rows.map((r, i) => (i === idx ? { ...r, key: newKey } : r))));
  };

  const updateValue = (idx: number, newValue: string) => {
    onChange(toRecord(rows.map((r, i) => (i === idx ? { ...r, value: newValue } : r))));
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          Chưa có spec. Bấm "Thêm spec" hoặc dùng key gợi ý bên dưới.
        </p>
      ) : (
        rows.map((row, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2"
          >
            <input
              type="text"
              value={row.key}
              onChange={(e) => updateKey(idx, e.target.value)}
              placeholder="key (vd: pieces)"
              list={`spec-keys-${idx}`}
              className="w-32 min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <datalist id={`spec-keys-${idx}`}>
              {COMMON_KEYS.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            <input
              type="text"
              value={row.value}
              onChange={(e) => updateValue(idx, e.target.value)}
              placeholder="value (vd: 320-378 PCS)"
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="rounded-lg p-2 text-state-danger-ink hover:bg-state-danger-soft"
              aria-label="Xoá spec"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => add()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-primary hover:bg-primary-soft"
        >
          <Plus className="h-4 w-4" />
          Thêm spec
        </button>
        <span className="text-xs text-muted-foreground">| Gợi ý:</span>
        {COMMON_KEYS.filter((k) => !(k in value)).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono text-foreground hover:bg-primary-soft hover:text-primary"
          >
            +{k}
          </button>
        ))}
      </div>

      {name && <input type="hidden" name={name} value={JSON.stringify(value)} />}
    </div>
  );
}
