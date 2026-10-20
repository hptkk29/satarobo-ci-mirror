"use client";

// Bảng GIAO DỊCH TIỀN VỀ (BankTransaction) — sổ gốc của mọi phân bổ.
// Cột "Rót vào phiếu" cho thấy tiền đã đi đâu — thứ IntegrationLog cũ không trả lời
// được (log chỉ nói webhook chạy xong hay hỏng).
//
// ⚠️ 21/08 — BỎ nguyên tắc "chỉ đọc". Trước đây màn này cố tình không có thao tác
// nào, với lý do "xử lý tay làm ở trang đơn nơi có đủ ngữ cảnh". Lý do đó chỉ đúng
// khi đã BIẾT tiền của đơn nào — mà hàng chờ này tồn tại chính vì KHÔNG biết. Nay
// dòng UNMATCHED có nút gán vào đơn / bỏ qua ngay tại chỗ (xem `XuLyGiaoDich`).
// Dòng đã MATCHED vẫn không có nút: rót rồi thì sửa ở trang đơn, nơi thấy đủ đợt thu.

import Link from "next/link";
import { useMemo, useState } from "react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { XuLyGiaoDich } from "./xu-ly-giao-dich";
import { GoGanGiaoDich } from "./go-gan-giao-dich";

export type AllocationView = {
  paymentRequestId: string;
  amount: number;
  installmentNo: number;
  amountDue: number;
  requestStatus: string;
  orderId: string | null;
  orderCode: string | null;
  customerName: string | null;
};

export type BankTxnItem = {
  id: string;
  at: string;
  provider: string;
  providerTxnId: string;
  amount: number;
  content: string | null;
  referenceCode: string | null;
  accountNumber: string | null;
  status: string;
  unmatchedNote: string | null;
  allocations: AllocationView[];
};

const STATUS_UI: Record<string, { label: string; cls: string }> = {
  MATCHED: { label: "Đã khớp", cls: "bg-state-success-soft text-state-success-ink" },
  UNMATCHED: { label: "Cần xử lý", cls: "bg-state-warning-soft text-state-warning-ink" },
  IGNORED: { label: "Bỏ qua", cls: "bg-muted text-muted-foreground" },
};

const REQUEST_STATUS_UI: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "chưa thu", cls: "text-muted-foreground" },
  PARTIAL: { label: "thu một phần", cls: "text-state-warning-ink" },
  PAID: { label: "đã đủ", cls: "text-state-success-ink" },
  VOID: { label: "đã huỷ", cls: "text-muted-foreground line-through" },
};

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

function requestLabel(a: AllocationView): string {
  return a.installmentNo === 0 ? "Toàn đơn" : `Đợt ${a.installmentNo}`;
}

export function BankTxnClient({
  items,
  canManage = false,
  canGan = false,
}: {
  items: BankTxnItem[];
  /** `payments:manage` — BỎ QUA + GỠ GẮN, chỉ kế toán. Server vẫn kiểm lại. */
  canManage?: boolean;
  /** `payments:record` (hoặc hơn) — GẮN tiền vào đơn. Sale có quyền này. */
  canGan?: boolean;
}) {
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (i) =>
        (i.content ?? "").toLowerCase().includes(s) ||
        (i.referenceCode ?? "").toLowerCase().includes(s) ||
        i.provider.toLowerCase().includes(s) ||
        i.providerTxnId.toLowerCase().includes(s) ||
        String(i.amount).includes(s) ||
        i.allocations.some(
          (a) =>
            (a.orderCode ?? "").toLowerCase().includes(s) ||
            (a.customerName ?? "").toLowerCase().includes(s),
        ),
    );
  }, [items, q]);

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm theo mã đơn / nội dung CK / mã tham chiếu / số tiền / tên khách / cổng…"
        className="w-full max-w-md rounded-md border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="overflow-hidden rounded-lg border border-border">
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
              <tr>
                <th className="w-36 px-3 py-2">Thời gian</th>
                <th className="w-32 px-3 py-2 text-right">Số tiền</th>
                <th className="px-3 py-2">Nội dung CK</th>
                <th className="w-32 px-3 py-2">Cổng</th>
                <th className="w-32 px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2">Rót vào phiếu thu</th>
                {(canGan || canManage) && <th className="w-44 px-3 py-2">Xử lý</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canGan || canManage ? 7 : 6} className="px-3 py-8 text-center text-muted-foreground">
                    {items.length === 0
                      ? "Chưa có giao dịch nào — chưa bật webhook cổng thanh toán hoặc chưa có tiền về."
                      : "Không có giao dịch khớp bộ lọc."}
                  </td>
                </tr>
              )}
              {rows.map((i) => {
                const ui = STATUS_UI[i.status] ?? { label: i.status, cls: "bg-muted text-muted-foreground" };
                const allocated = i.allocations.reduce((s, a) => s + a.amount, 0);
                const leftover = i.amount - allocated;
                return (
                  <tr key={i.id} className={i.status === "UNMATCHED" ? "bg-state-warning-soft/40" : undefined}>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {i.at.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-semibold tabular-nums">
                      {fmt(i.amount)}đ
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="max-w-[300px] truncate font-mono text-xs text-foreground" title={i.content ?? ""}>
                        {i.content ?? "—"}
                      </div>
                      {i.referenceCode && <div className="text-xs text-muted-foreground">ref {i.referenceCode}</div>}
                      {i.accountNumber && <div className="text-xs text-muted-foreground">TK {i.accountNumber}</div>}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      <div className="font-medium">{i.provider}</div>
                      <div className="max-w-[120px] truncate text-muted-foreground" title={i.providerTxnId}>
                        {i.providerTxnId}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ui.cls}`}>
                        {ui.label}
                      </span>
                      {i.unmatchedNote && (
                        <div className="mt-1 max-w-[160px] text-xs text-state-warning-ink">{i.unmatchedNote}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {i.allocations.length === 0 ? (
                        <span className="text-xs text-state-warning-ink">
                          Chưa rót vào phiếu nào{canGan ? " — dùng nút bên phải" : ""}
                        </span>
                      ) : (
                        <ul className="space-y-1">
                          {i.allocations.map((a) => {
                            const rs = REQUEST_STATUS_UI[a.requestStatus] ?? {
                              label: a.requestStatus,
                              cls: "text-muted-foreground",
                            };
                            return (
                              <li key={a.paymentRequestId} className="text-xs">
                                {a.orderId ? (
                                  <Link
                                    href={`/orders/${a.orderId}`}
                                    className="font-medium text-state-info-ink hover:underline"
                                  >
                                    {a.orderCode ?? "(đơn)"}
                                  </Link>
                                ) : (
                                  <span className="font-medium text-foreground">{a.orderCode ?? "(đơn)"}</span>
                                )}
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {requestLabel(a)} · <b className="tabular-nums">{fmt(a.amount)}đ</b>
                                  {" / "}
                                  <span className="tabular-nums">{fmt(a.amountDue)}đ</span>{" "}
                                  <span className={rs.cls}>({rs.label})</span>
                                </span>
                                {a.customerName && (
                                  <span className="text-muted-foreground"> · {a.customerName}</span>
                                )}
                              </li>
                            );
                          })}
                          {leftover > 0 && (
                            <li className="text-xs text-state-warning-ink">
                              Dư {fmt(leftover)}đ chưa rót — xem mục Tiền thừa bên dưới.
                            </li>
                          )}
                        </ul>
                      )}
                    </td>
                    {(canGan || canManage) && (
                      <td className="px-3 py-2 align-top">
                        {i.status === "UNMATCHED" && canGan ? (
                          <XuLyGiaoDich
                            bankTransactionId={i.id}
                            amount={i.amount}
                            goiY={i.content}
                            laKeToan={canManage}
                          />
                        ) : i.status === "MATCHED" && canManage ? (
                          <GoGanGiaoDich bankTransactionId={i.id} amount={i.amount} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
