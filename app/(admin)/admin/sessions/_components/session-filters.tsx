"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Scope = "upcoming" | "past" | "all";

const SCOPES: { key: Scope; label: string }[] = [
  { key: "upcoming", label: "Sắp tới" },
  { key: "past", label: "Đã diễn ra" },
  { key: "all", label: "Tất cả" },
];

/**
 * P1 #5 — Bộ lọc buổi học ÁP DỤNG TỨC THÌ (onChange → điều hướng ngay), bỏ nút
 * "Lọc". Giữ scope + lớp trên query string để server đọc.
 */
export function SessionFilters({
  scope,
  classId,
  classes,
}: {
  scope: Scope;
  classId: string;
  classes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function apply(next: { scope?: Scope; classId?: string }) {
    const params = new URLSearchParams();
    const s = next.scope ?? scope;
    const c = next.classId ?? classId;
    if (s !== "upcoming") params.set("scope", s);
    if (c) params.set("classId", c);
    const qs = params.toString();
    startTransition(() => {
      // scroll: false — đổi bộ lọc là GIỮ NGUYÊN TRANG, không cuộn về đầu.
      router.push(qs ? `/sessions?${qs}` : "/sessions", { scroll: false });
    });
  }

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => apply({ scope: s.key })}
            disabled={pending}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${ scope === s.key ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted" }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <select
        value={classId}
        onChange={(e) => apply({ classId: e.target.value })}
        disabled={pending}
        className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
      >
        <option value="">Tất cả lớp</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-muted-foreground">Đang lọc…</span>}
    </div>
  );
}
