"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Save, X } from "lucide-react";
import {
  cancelAuditAndRedirect,
  saveAuditDraft,
  submitAuditAndRedirect,
} from "../_actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { HelpHint } from "@/components/admin/ui/help-hint";

export interface AuditRowInit {
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  category: string;
  previousQty: number;
  actualQty: number;
  reason: string;
}

interface Props {
  auditId: string;
  centerName: string;
  auditCode: string | null;
  rows: AuditRowInit[];
}

export function BulkAuditForm({
  auditId,
  centerName,
  auditCode,
  rows: initialRows,
}: Props) {
  const router = useRouter();
  // Keep actualQty as string so the input behaves naturally (empty / partial typing OK).
  const [rows, setRows] = useState(
    initialRows.map((r) => ({ ...r, actualQty: String(r.actualQty) })),
  );
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.itemCode.toLowerCase().includes(q) ||
        r.itemName.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    let changedCount = 0;
    let increases = 0;
    let decreases = 0;
    let missingReason = 0;
    for (const r of rows) {
      const actual = Number.parseInt(r.actualQty, 10);
      const validActual = Number.isFinite(actual) ? actual : r.previousQty;
      const delta = validActual - r.previousQty;
      if (delta !== 0) {
        changedCount += 1;
        if (delta > 0) increases += 1;
        else decreases += 1;
        if (!r.reason || r.reason.trim().length < 5) missingReason += 1;
      }
    }
    return { changedCount, increases, decreases, missingReason };
  }, [rows]);

  function updateRow(
    itemId: string,
    field: "actualQty" | "reason",
    value: string,
  ) {
    setRows((prev) =>
      prev.map((r) => (r.itemId === itemId ? { ...r, [field]: value } : r)),
    );
  }

  function buildLines() {
    return rows.map((r) => {
      const actual = Number.parseInt(r.actualQty, 10);
      const validActual = Number.isFinite(actual) && actual >= 0 ? actual : r.previousQty;
      return {
        itemId: r.itemId,
        previousQty: r.previousQty,
        actualQty: validActual,
        reason: r.reason.trim() || null,
      };
    });
  }

  function handleSaveDraft() {
    setError(null);
    startTransition(async () => {
      const res = await saveAuditDraft({ auditId, lines: buildLines() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(new Date());
      router.refresh();
    });
  }

  function handleSubmit() {
    setError(null);
    if (stats.changedCount === 0) {
      setError("Chưa có dòng nào thay đổi — Submit sẽ không tạo movement nào");
      return;
    }
    if (stats.missingReason > 0) {
      setError(
        `Còn ${stats.missingReason} dòng có Δ ≠ 0 chưa có lý do ≥ 5 ký tự`,
      );
      return;
    }
    if (
      !confirm(
        `Submit phiếu kiểm kê?\n\n` +
          `• ${stats.changedCount} dòng sẽ tạo movement ADJUSTMENT_*\n` +
          `• Balance sẽ update theo "Số lượng thực tế"\n` +
          `• Không thể hoàn tác (status sẽ COMPLETED).`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      // Save current draft state first to make sure server has the latest values.
      const draftRes = await saveAuditDraft({ auditId, lines: buildLines() });
      if (!draftRes.ok) {
        setError(draftRes.error);
        return;
      }
      const res = await submitAuditAndRedirect(auditId);
      if (res && !res.ok) setError(res.error);
    });
  }

  function handleCancel() {
    if (!confirm("Huỷ phiếu kiểm kê này? Không tạo movement nào.")) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelAuditAndRedirect(auditId);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
        {/* Luật "Δ ≠ 0 phải có lý do" chuyển vào icon "?" được vì màn hình vẫn nhắc
            động: cột "Lý do" ghi rõ điều kiện, thanh thống kê đếm "thiếu lý do", và
            nút Submit tự khoá — người dùng không thể bỏ sót vì không đọc dòng này. */}
        <div className="flex flex-wrap items-center gap-1">
          <span>
            <strong>Cơ sở:</strong> {centerName}
            {auditCode && (
              <>
                {" "}
                · <strong>Mã phiếu:</strong> {auditCode}
              </>
            )}
          </span>
          <HelpHint>
            Nhập số lượng thực tế đếm được. Mọi dòng có Δ ≠ 0 đều cần lý do ≥ 5 ký tự.
            Submit sẽ ghi nhận movement ADJUSTMENT và cập nhật tồn kho atomic.
          </HelpHint>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="text-sm text-foreground">
          <span className="font-bold">{stats.changedCount}</span> dòng thay đổi
          {stats.increases > 0 && (
            <span className="ml-3 text-state-success-ink">+{stats.increases} tăng</span>
          )}
          {stats.decreases > 0 && (
            <span className="ml-3 text-state-danger-ink">-{stats.decreases} giảm</span>
          )}
          {stats.missingReason > 0 && (
            <span className="ml-3 text-state-warning-ink">
              · {stats.missingReason} thiếu lý do
            </span>
          )}
          {savedAt && (
            <span className="ml-3 text-xs text-muted-foreground">
              Đã lưu nháp {savedAt.toLocaleTimeString("vi-VN")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-state-danger bg-card px-3 py-1.5 text-sm font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Huỷ phiếu
          </button>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Lưu nháp
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              pending || stats.changedCount === 0 || stats.missingReason > 0
            }
            className="inline-flex items-center gap-1 rounded-md bg-state-success-ink px-3 py-1.5 text-sm font-bold text-white hover:bg-state-success-ink-hover disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {pending ? "Đang xử lý..." : "Submit kiểm kê"}
          </button>
        </div>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Tìm theo mã / tên hàng..."
        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Mã
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tên hàng
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  ĐV
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hệ thống
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Thực tế *
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Δ
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lý do (Δ ≠ 0, ≥ 5 ký tự)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    {rows.length === 0
                      ? "Chưa có mặt hàng active nào trong hệ thống."
                      : "Không có dòng nào khớp với từ khoá tìm."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const actualNum = Number.parseInt(r.actualQty, 10);
                  const validActual = Number.isFinite(actualNum)
                    ? actualNum
                    : r.previousQty;
                  const delta = validActual - r.previousQty;
                  const rowBg =
                    delta > 0 ? "bg-state-success-soft/60" : delta < 0 ? "bg-state-danger-soft/60" : "";
                  const deltaColor =
                    delta > 0
                      ? "text-state-success-ink"
                      : delta < 0
                        ? "text-state-danger-ink"
                        : "text-muted-foreground";
                  const reasonMissing =
                    delta !== 0 && r.reason.trim().length < 5;
                  return (
                    <tr key={r.itemId} className={rowBg}>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {r.itemCode}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {r.itemName}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {r.previousQty}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={r.actualQty}
                          onChange={(e) =>
                            updateRow(r.itemId, "actualQty", e.target.value)
                          }
                          disabled={pending}
                          className="w-24 rounded-md border border-border px-2 py-1 text-right text-sm tabular-nums disabled:opacity-60"
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-bold ${deltaColor}`}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </td>
                      <td className="px-3 py-2">
                        {delta !== 0 ? (
                          <input
                            type="text"
                            value={r.reason}
                            onChange={(e) =>
                              updateRow(r.itemId, "reason", e.target.value)
                            }
                            disabled={pending}
                            placeholder={
                              delta > 0
                                ? "VD: Tìm thêm trong kho phụ"
                                : "VD: Mất 2 cái khi vận chuyển"
                            }
                            className={
                              "w-full rounded-md border px-2 py-1 text-xs " +
                              (reasonMissing
                                ? "border-state-warning bg-state-warning-soft"
                                : "border-border")
                            }
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
