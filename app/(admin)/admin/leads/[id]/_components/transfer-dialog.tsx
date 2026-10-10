"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight } from "lucide-react";
import { transferLead } from "../../actions";
import { validateTransferTarget } from "@/lib/crm/transfer-validate";

type Center = { id: string; name: string };
type Sale = { id: string; name: string | null; centerId: string | null };

export function TransferDialog({
  leadId,
  centers,
  sales,
  currentCenterId,
  currentSaleId,
}: {
  leadId: string;
  centers: Center[];
  sales: Sale[];
  currentCenterId: string | null;
  currentSaleId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [toCenterId, setToCenterId] = useState(currentCenterId ?? "");
  const [toSaleId, setToSaleId] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [reason, setReason] = useState("");

  const centerChanged = toCenterId !== (currentCenterId ?? "");
  const salesInCenter = useMemo(
    () => sales.filter((s) => !toCenterId || s.centerId === toCenterId),
    [sales, toCenterId],
  );

  function submit() {
    if (handoverNote.trim().length < 5) {
      toast.error("Bắt buộc ghi đã tư vấn gì cho khách");
      return;
    }
    // FL2-03 — chặn bàn giao "rỗng": cơ sở/sale đích trùng nguồn (kiểm tra trước khi
    // gửi để báo lỗi nhanh; server cũng validate lại bằng cùng hàm).
    const check = validateTransferTarget({
      fromCenterId: currentCenterId,
      fromSaleId: currentSaleId,
      toCenterId: toCenterId || currentCenterId || null,
      toSaleId: toSaleId || null,
    });
    if (!check.ok) {
      toast.error(check.error.message);
      return;
    }
    startTransition(async () => {
      const res = await transferLead({ leadId, toCenterId, toSaleId, handoverNote, reason });
      if (res.ok) {
        toast.success("Đã chuyển lead");
        setOpen(false);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi chuyển lead");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // `whitespace-nowrap`: ở 390px nhãn này xuống 2 dòng, nút cao gấp đôi hàng
        // nút bên cạnh và hàng hành động lệch hẳn. Nhãn nút không bao giờ được ngắt.
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
      >
        <ArrowLeftRight size={14} /> Chuyển lead
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Đóng" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 className="mb-3 text-sm font-bold text-foreground">Chuyển lead</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">Cơ sở đích</span>
                <select
                  value={toCenterId}
                  onChange={(e) => { setToCenterId(e.target.value); setToSaleId(""); }}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="">— Giữ nguyên / chưa rõ —</option>
                  {centers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">
                  Sale nhận {centerChanged && "(để trống = chia theo chế độ cơ sở mới)"}
                </span>
                <select
                  value={toSaleId}
                  onChange={(e) => setToSaleId(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="">
                    {centerChanged ? "— Chia theo chế độ cơ sở mới —" : "— Chọn sale —"}
                  </option>
                  {salesInCenter.filter((s) => s.id !== currentSaleId).map((s) => (
                    <option key={s.id} value={s.id}>{s.name ?? s.id}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-state-danger-ink">
                  Note bàn giao — đã tư vấn gì cho KH * (bắt buộc)
                </span>
                <textarea
                  value={handoverNote}
                  onChange={(e) => setHandoverNote(e.target.value)}
                  rows={3}
                  placeholder="Tóm tắt nội dung đã tư vấn để sale mới không hỏi lại…"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">Lý do chuyển (tuỳ chọn)</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Đang chuyển…" : "Chuyển lead"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Huỷ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
