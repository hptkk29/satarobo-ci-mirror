"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus, X, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { searchLinkableStudents, addChildToParent, unlinkChildFromParent } from "../_actions";
import { NUT_CHU, NUT_VIEN, O_NHAP } from "./ho-so/o-nhap";

type Child = { id: string; name: string; studentCode: string | null };

// Commit 3 — quản lý ĐA CON: hiển thị các con đang gắn với phụ huynh + thêm/bỏ con.
// 25/09/2026 — chỉ ĐỔI VỎ thành khung "Anh chị em" ở cột phải hồ sơ; logic + action giữ nguyên.
export function ParentChildrenManager({
  parentUserId,
  currentStudentId,
  children,
}: {
  parentUserId: string;
  currentStudentId: string;
  children: Child[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Child[]>([]);
  const [searching, setSearching] = useState(false);

  function search() {
    if (!q.trim()) return;
    setSearching(true);
    start(async () => {
      const res = await searchLinkableStudents(q);
      setSearching(false);
      if (res.ok) setResults(res.items ?? []);
      else toast.error(res.error ?? "Lỗi tìm kiếm");
    });
  }

  function add(childId: string) {
    start(async () => {
      const res = await addChildToParent({ parentUserId, childStudentId: childId });
      if (res.ok) {
        toast.success("Đã thêm con vào phụ huynh");
        setResults((r) => r.filter((x) => x.id !== childId));
        setQ("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi thêm con");
      }
    });
  }

  function unlink(childId: string) {
    start(async () => {
      const res = await unlinkChildFromParent(childId);
      if (res.ok) {
        toast.success("Đã gỡ liên kết con");
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi gỡ liên kết");
      }
    });
  }

  return (
    <section
      aria-labelledby="anh-chi-em"
      className="rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Users className="size-4 text-primary" aria-hidden />
        <h2 id="anh-chi-em" className="text-sm font-semibold text-foreground">
          Anh chị em
        </h2>
        <span className="text-xs text-muted-foreground">
          · {children.length} con cùng tài khoản phụ huynh
        </span>
      </div>

      <div className="space-y-3 p-4">
        <ul className="divide-y divide-border">
          {children.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2 first:pt-0">
              <span className="min-w-0 text-sm">
                <Link
                  href={`/students/${c.id}/edit`}
                  className="break-words font-medium text-foreground hover:text-primary-ink hover:underline"
                >
                  {c.name}
                </Link>
                {c.studentCode ? (
                  <span className="ml-1 text-xs text-muted-foreground">({c.studentCode})</span>
                ) : null}
                {c.id === currentStudentId ? (
                  <span className="ml-2 inline-flex whitespace-nowrap rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-ink">
                    đang xem
                  </span>
                ) : null}
              </span>
              {c.id !== currentStudentId && (
                <button
                  type="button"
                  onClick={() => unlink(c.id)}
                  disabled={pending}
                  aria-label={`Gỡ ${c.name} khỏi phụ huynh này`}
                  className={cn(
                    NUT_CHU,
                    "text-state-danger-ink hover:bg-state-danger-soft",
                  )}
                >
                  <X className="size-3.5" aria-hidden /> Gỡ
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="tim-con-lien-ket" className="sr-only">
              Tìm học viên chưa có phụ huynh
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              id="tim-con-lien-ket"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
              placeholder="Tìm HV chưa có phụ huynh (tên/mã/SĐT)…"
              className={cn(O_NHAP, "pl-9")}
            />
          </div>
          <button type="button" onClick={search} disabled={pending} className={NUT_VIEN}>
            Tìm
          </button>
        </div>

        {searching && (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            Đang tìm…
          </p>
        )}
        {results.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 break-words">
                  {r.name}
                  {r.studentCode ? (
                    <span className="ml-1 text-xs text-muted-foreground">({r.studentCode})</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => add(r.id)}
                  disabled={pending}
                  className={cn(NUT_CHU, "bg-primary-soft text-primary-ink hover:bg-primary-soft-hover")}
                >
                  <UserPlus className="size-3.5" aria-hidden /> Thêm con
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
