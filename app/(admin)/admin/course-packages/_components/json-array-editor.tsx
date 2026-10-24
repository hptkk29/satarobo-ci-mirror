"use client";

import { Plus, X } from "lucide-react";

type JsonPrimitive = string | number | boolean | null;
export type JsonObjectItem = Record<string, JsonPrimitive>;
export type JsonArrayItem = string | JsonObjectItem;

interface JsonArrayEditorProps {
  value: JsonArrayItem[];
  onChange: (newValue: JsonArrayItem[]) => void;
  template: JsonArrayItem;
  type?: "object" | "string";
  placeholder?: string;
}

function coerceTemplate(template: JsonArrayItem): JsonObjectItem {
  return typeof template === "string" ? {} : template;
}

function coerceObjectItem(item: JsonArrayItem): JsonObjectItem {
  return typeof item === "string" ? {} : item;
}

function parseFieldValue(currentValue: JsonPrimitive, newValue: string): JsonPrimitive {
  if (typeof currentValue === "number") {
    const parsed = Number.parseInt(newValue, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return newValue;
}

export function JsonArrayEditor({
  value,
  onChange,
  template,
  type = "object",
  placeholder,
}: JsonArrayEditorProps) {
  const objectTemplate = coerceTemplate(template);

  const add = () => {
    onChange([...value, type === "string" ? "" : { ...objectTemplate }]);
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const updateString = (idx: number, newValue: string) => {
    onChange(value.map((item, i) => (i === idx ? newValue : item)));
  };

  const updateObject = (idx: number, field: string, newValue: string) => {
    onChange(
      value.map((item, i) => {
        if (i !== idx) return item;
        const objectItem = coerceObjectItem(item);
        const currentValue = objectItem[field] ?? objectTemplate[field] ?? "";
        return {
          ...objectItem,
          [field]: parseFieldValue(currentValue, newValue),
        };
      }),
    );
  };

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">{placeholder || "Chua co item"}</p>
      ) : (
        value.map((item, idx) => (
          <div key={idx} className="flex items-start gap-2 rounded-lg bg-muted p-2">
            {type === "string" ? (
              <input
                type="text"
                value={typeof item === "string" ? item : ""}
                onChange={(event) => updateString(idx, event.target.value)}
                className="min-h-9 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            ) : (
              <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-3">
                {Object.keys(objectTemplate).map((field) => {
                  const objectItem = coerceObjectItem(item);
                  return (
                    <input
                      key={field}
                      type="text"
                      placeholder={field}
                      value={String(objectItem[field] ?? "")}
                      onChange={(event) => updateObject(idx, field, event.target.value)}
                      className="min-h-9 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(idx)}
              className="rounded-lg p-2 text-state-danger-ink hover:bg-state-danger-soft"
              aria-label="Xoa item"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))
      )}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-primary hover:bg-primary-soft"
      >
        <Plus className="h-4 w-4" />
        Them
      </button>
    </div>
  );
}
