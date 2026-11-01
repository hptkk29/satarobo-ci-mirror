"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";
import type { RoboticsSkill, SkillLevel } from "@prisma/client";
import { saveStudentSkills } from "../_actions";
import { SKILL_LABEL, SKILL_ORDER, LEVEL_LABEL } from "@/lib/lms/skills";

const LEVELS: SkillLevel[] = ["NEED_SUPPORT", "BASIC", "GOOD", "EXCELLENT"];

export function SkillEditor({
  studentId,
  initial,
  canEdit,
}: {
  studentId: string;
  initial: Record<string, { level: SkillLevel; note: string } | undefined>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Record<string, { level: SkillLevel | ""; note: string }>>(() => {
    const r: Record<string, { level: SkillLevel | ""; note: string }> = {};
    for (const s of SKILL_ORDER) r[s] = { level: initial[s]?.level ?? "", note: initial[s]?.note ?? "" };
    return r;
  });

  function set(skill: string, patch: Partial<{ level: SkillLevel | ""; note: string }>) {
    setRows((cur) => ({ ...cur, [skill]: { ...cur[skill], ...patch } }));
  }

  function save() {
    const items = SKILL_ORDER.filter((s) => rows[s].level !== "").map((s) => ({
      skill: s,
      level: rows[s].level as SkillLevel,
      note: rows[s].note.trim() || undefined,
    }));
    if (items.length === 0) {
      toast.error("Chọn ít nhất 1 mức năng lực");
      return;
    }
    startTransition(async () => {
      const res = await saveStudentSkills({ studentId, items });
      if (res.ok) {
        toast.success("Đã lưu đánh giá năng lực");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border">
        {SKILL_ORDER.map((skill) => (
          <li key={skill} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
            <span className="w-full text-sm font-medium text-foreground sm:w-48">
              {SKILL_LABEL[skill as RoboticsSkill]}
            </span>
            <select
              value={rows[skill].level}
              onChange={(e) => set(skill, { level: e.target.value as SkillLevel | "" })}
              disabled={!canEdit || pending}
              className="rounded-lg border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
            >
              <option value="">— chưa chấm —</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{LEVEL_LABEL[l]}</option>
              ))}
            </select>
            <input
              value={rows[skill].note}
              onChange={(e) => set(skill, { note: e.target.value })}
              disabled={!canEdit || pending}
              placeholder="Ghi chú (tuỳ chọn)"
              className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
            />
          </li>
        ))}
      </ul>
      {canEdit && (
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {pending ? "Đang lưu…" : "Lưu năng lực"}
        </button>
      )}
    </div>
  );
}
