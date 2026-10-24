"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { UserPlus, X, Search, Users } from "lucide-react";
import {
  searchStudentsForGroup,
  addStudentToGroup,
  removeStudentFromGroup,
} from "../_actions";

type Member = { id: string; name: string; studentCode: string | null };

// P2 — quản lý THÀNH VIÊN cố định của nhóm (cohort).
export function GroupMembers({
  groupId,
  members,
  canManage,
}: {
  groupId: string;
  members: Member[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Member[]>([]);

  function search() {
    start(async () => {
      const res = await searchStudentsForGroup(groupId, q);
      if (res.ok) setResults(res.items ?? []);
      else toast.error(res.error ?? "Lỗi");
    });
  }
  function add(id: string) {
    start(async () => {
      const res = await addStudentToGroup({ groupId, studentId: id });
      if (res.ok) {
        toast.success("Đã thêm vào nhóm");
        setResults((r) => r.filter((x) => x.id !== id));
        setQ("");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }
  function remove(id: string) {
    start(async () => {
      const res = await removeStudentFromGroup({ groupId, studentId: id });
      if (res.ok) {
        toast.success("Đã gỡ khỏi nhóm");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
        <Users className="h-5 w-5 text-primary" /> Thành viên nhóm ({members.length})
      </h2>
      {members.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">Chưa có học viên. Thêm HV để cả nhóm cùng lên lớp/khoá.</p>
      ) : (
        <ul className="mb-3 grid gap-1.5 sm:grid-cols-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <Link href={`/students/${m.id}/edit`} className="font-medium text-foreground hover:underline">
                {m.name}
                {m.studentCode ? <span className="ml-1 text-xs text-muted-foreground">({m.studentCode})</span> : null}
              </Link>
              {canManage && (
                <button onClick={() => remove(m.id)} disabled={pending} className="inline-flex items-center gap-1 text-xs text-state-danger-ink hover:underline disabled:opacity-50">
                  <X className="h-3.5 w-3.5" /> Gỡ
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
                placeholder="Tìm HV chưa thuộc nhóm (cùng cơ sở)…"
                className="w-full rounded-lg border border-border py-2 pl-8 pr-3 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <button onClick={search} disabled={pending} className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              Tìm
            </button>
          </div>
          {results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <span>{r.name}{r.studentCode ? <span className="ml-1 text-xs text-muted-foreground">({r.studentCode})</span> : null}</span>
                  <button onClick={() => add(r.id)} disabled={pending} className="inline-flex items-center gap-1 rounded-md bg-state-success-ink px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                    <UserPlus className="h-3.5 w-3.5" /> Thêm
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
