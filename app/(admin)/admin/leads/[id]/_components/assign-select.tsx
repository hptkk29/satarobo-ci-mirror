"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { assignLeadToSaleAction } from "../../actions";

export function AssignSelect({
  leadId,
  sales,
  current,
}: {
  leadId: string;
  sales: { id: string; name: string | null }[];
  current: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [pending, startTransition] = useTransition();

  function onChange(saleId: string) {
    setValue(saleId);
    if (!saleId) return;
    startTransition(async () => {
      const res = await assignLeadToSaleAction(leadId, saleId);
      if (res.ok) {
        toast.success("Đã gán lead");
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi gán");
        setValue(current ?? "");
      }
    });
  }

  if (sales.length === 0) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
      className="rounded-lg border border-border px-2 py-2 text-sm disabled:opacity-50"
      title="Gán tay cho sale"
    >
      <option value="">Gán cho…</option>
      {sales.map((s) => (
        <option key={s.id} value={s.id}>{s.name ?? s.id}</option>
      ))}
    </select>
  );
}
