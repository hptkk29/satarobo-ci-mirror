"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { enrollGroupIntoClass } from "../_actions";

type Member = { id: string; name: string; studentCode: string | null };
type ClassOpt = { id: string; name: string };

// P2 — gán CẢ NHÓM vào 1 lớp của nhóm: gợi ý toàn bộ thành viên, tick bỏ vài
// người, tạo enrollment hàng loạt. (Chọn thêm HV ngoài nhóm: dùng flow ghi danh
// lớp riêng — ở đây tập trung cohort.)
export function GroupEnrollPanel({
  groupId,
  members,
  classes,
}: {
  groupId: string;
  members: Member[];
  classes: ClassOpt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(members.map((m) => m.id)));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function run() {
    if (!classId) {
      toast.error("Chọn lớp của nhóm");
      return;
    }
    if (selected.size === 0) {
      toast.error("Chọn ít nhất 1 học viên");
      return;
    }
    start(async () => {
      const res = await enrollGroupIntoClass({ groupId, classId, studentIds: [...selected] });
      if (res.ok) {
        toast.success(`Đã ghi danh ${res.created} HV${res.skipped ? `, bỏ qua ${res.skipped} đã có` : ""}`);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  if (members.length === 0 || classes.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
        <GraduationCap className="h-5 w-5 text-primary" /> Gán cả nhóm vào lớp
      </h2>
      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Lớp của nhóm (chọn khoá để cả nhóm vào)</span>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm">
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <p className="mb-1 text-xs text-muted-foreground">Tick bỏ HV không vào lớp này:</p>
      <ul className="mb-3 grid gap-1 sm:grid-cols-2">
        {members.map((m) => (
          <li key={m.id}>
            <label className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
              <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
              {m.name}
              {m.studentCode ? <span className="text-xs text-muted-foreground">({m.studentCode})</span> : null}
            </label>
          </li>
        ))}
      </ul>

      <button onClick={run} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Đang ghi danh…" : `Ghi danh ${selected.size} HV vào lớp`}
      </button>
    </section>
  );
}
