"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startAuditAndRedirect } from "../_actions";

interface OrgUnitOption {
  id: string;
  name: string;
}

export function StartAuditForm({ orgUnits }: { orgUnits: OrgUnitOption[] }) {
  const router = useRouter();
  const [orgUnitId, setOrgUnitId] = useState("");
  const [auditCode, setAuditCode] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!orgUnitId) {
      setError("Chọn cơ sở");
      return;
    }
    startTransition(async () => {
      const res = await startAuditAndRedirect({
        orgUnitId,
        auditCode: auditCode.trim() || null,
        notes: notes.trim() || null,
      });
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-foreground">
          Cơ sở <span className="text-state-danger-ink">*</span>
        </span>
        <select
          value={orgUnitId}
          onChange={(e) => setOrgUnitId(e.target.value)}
          required
          disabled={pending}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <option value="">— Chọn cơ sở —</option>
          {orgUnits.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-foreground">
          Mã phiếu (tuỳ chọn)
        </span>
        <input
          type="text"
          value={auditCode}
          onChange={(e) => setAuditCode(e.target.value)}
          placeholder="VD: KK-2026-05-DN"
          disabled={pending}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Tuỳ chọn — duy nhất toàn hệ thống nếu có
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-foreground">
          Ghi chú
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          disabled={pending}
          placeholder="VD: Kiểm kê cuối tháng 5/2026, đối chiếu sổ kho và thực tế."
          className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <div className="flex gap-3 border-t border-border pt-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-primary px-6 py-2.5 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang tạo..." : "Bắt đầu kiểm kê →"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/inventory/audit")}
          disabled={pending}
          className="rounded-xl border-2 border-border bg-card px-6 py-2.5 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}
