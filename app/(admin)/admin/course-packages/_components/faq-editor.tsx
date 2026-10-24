"use client";

import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type FaqItem = { question: string; answer: string };

type Props = {
  value: FaqItem[];
  onChange: (next: FaqItem[]) => void;
};

export function FaqEditor({ value, onChange }: Props) {
  const updateItem = (idx: number, field: keyof FaqItem, fieldValue: string) => {
    const next = [...value];
    next[idx] = { ...next[idx], [field]: fieldValue };
    onChange(next);
  };

  const addItem = () => {
    onChange([...value, { question: "", answer: "" }]);
  };

  const removeItem = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...value];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm italic text-muted-foreground">Chưa có FAQ nào.</p>
      )}

      {value.map((item, idx) => (
        <div
          key={idx}
          className="space-y-2 rounded-lg border border-border bg-muted p-3"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => moveUp(idx)}
              disabled={idx === 0}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="Move up"
            >
              <GripVertical size={16} />
            </button>
            <span className="text-xs font-bold text-muted-foreground">
              FAQ #{idx + 1}
            </span>
            <button
              type="button"
              onClick={() => removeItem(idx)}
              className="ml-auto rounded p-1 text-state-danger-ink hover:bg-state-danger-soft"
              title="Xóa"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <Input
            value={item.question}
            onChange={(e) => updateItem(idx, "question", e.target.value)}
            placeholder="Câu hỏi của phụ huynh"
            className="font-semibold"
          />
          <Textarea
            value={item.answer}
            onChange={(e) => updateItem(idx, "answer", e.target.value)}
            placeholder="Câu trả lời..."
            rows={3}
          />
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addItem}>
        <Plus size={14} className="mr-1" /> Thêm FAQ
      </Button>
    </div>
  );
}
