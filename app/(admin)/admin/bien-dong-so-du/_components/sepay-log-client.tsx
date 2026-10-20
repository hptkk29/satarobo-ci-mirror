"use client";

// Bảng giao dịch tiền về. Chỉ ĐỌC — xác nhận tay (khi máy không tự khớp được)
// làm ở trang đơn, nơi có đủ ngữ cảnh giảm giá/đợt thu, không làm tắt ở đây.

import Link from "next/link";
import { useMemo, useState } from "react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

type Item = {
  id: string;
  at: string;
  action: string;
  status: string;
  error: string | null;
  amount: number;
  gateway: string | null;
  referenceCode: string | null;
  content: string | null;
  orderCode: string | null;
  order: { id: string; status: string; totalAmount: number; customerName: string } | null;
  /**
   * Trạng thái dòng tương ứng trong SỔ giao dịch (`BankTransaction`): MATCHED /
   * UNMATCHED / IGNORED. `null` = chưa nối được sang sổ (nhật ký cũ trước ngày dựng
   * sổ, hoặc dòng chưa từng đi tới bước ghi sổ) — không kết luận đúng/sai.
   */
  txnStatus: string | null;
  /** Lý do sổ mới KHÔNG tra ra phiếu thu — thứ kế toán cần để xử lý tay. */
  unmatchedNote: string | null;
};

const STATUS_UI: Record<string, { label: string; cls: string }> = {
  SUCCESS: { label: "Đã tự xác nhận", cls: "bg-state-success-soft text-state-success-ink" },
  SKIPPED: { label: "Bỏ qua", cls: "bg-muted text-muted-foreground" },
  FAILED: { label: "Cần xử lý", cls: "bg-state-warning-soft text-state-warning-ink" },
  PENDING: { label: "Đang xử lý", cls: "bg-state-info-soft text-state-info-ink" },
};

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

export function SepayLogClient({ items }: { items: Item[] }) {
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (i) =>
        (i.orderCode ?? "").toLowerCase().includes(s) ||
        (i.content ?? "").toLowerCase().includes(s) ||
        (i.referenceCode ?? "").toLowerCase().includes(s) ||
        (i.order?.customerName ?? "").toLowerCase().includes(s) ||
        String(i.amount).includes(s),
    );
  }, [items, q]);

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm theo mã đơn / nội dung CK / mã tham chiếu / số tiền / tên khách…"
        className="w-full max-w-md rounded-md border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="overflow-hidden rounded-lg border border-border">
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
              <tr>
                <th className="w-36 px-3 py-2">Thời gian</th>
                <th className="w-32 px-3 py-2 text-right">Số tiền</th>
                <th className="px-3 py-2">Nội dung CK</th>
                <th className="w-40 px-3 py-2">Đơn khớp</th>
                <th className="w-36 px-3 py-2">Kết quả</th>
                <th className="px-3 py-2">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    {items.length === 0
                      ? "Chưa có giao dịch nào — chưa bật webhook SePay hoặc chưa có tiền về."
                      : "Không có giao dịch khớp bộ lọc."}
                  </td>
                </tr>
              )}
              {rows.map((i) => {
                const ui = STATUS_UI[i.status] ?? { label: i.status, cls: "bg-muted text-muted-foreground" };
                // Webhook có HAI kiểu thành công khác nhau về nghiệp vụ: khớp theo mã
                // đơn trong nội dung CK (CONFIRM_ORDER) và khớp qua sổ phiếu thu
                // (MATCH_TXN — đường DUY NHẤT còn chạy từ 20/08). Gọi đúng tên để
                // người đối soát biết tiền vào bằng đường nào.
                const matchedViaLedger = i.status === "SUCCESS" && i.action === "MATCH_TXN";
                const label = matchedViaLedger ? "Đã khớp phiếu thu" : ui.label;
                return (
                  // Tô nền cảnh báo cho dòng CÒN CẦN NGƯỜI: bỏ qua dòng FAILED mà sổ
                  // giao dịch sau đó đã khớp (retry của cổng), kẻo lại đỏ oan.
                  <tr
                    key={i.id}
                    className={
                      i.status === "FAILED" && i.txnStatus !== "MATCHED"
                        ? "bg-state-warning-soft/40"
                        : undefined
                    }
                  >
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {i.at.slice(0, 16).replace("T", " ")}
                      {i.gateway && <div className="text-muted-foreground">{i.gateway}</div>}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-semibold tabular-nums">
                      {i.amount > 0 ? `${fmt(i.amount)}đ` : "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="max-w-[320px] truncate font-mono text-xs text-foreground" title={i.content ?? ""}>
                        {i.content ?? "—"}
                      </div>
                      {i.referenceCode && (
                        <div className="text-xs text-muted-foreground">ref {i.referenceCode}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {i.order ? (
                        <>
                          <Link href={`/orders/${i.order.id}`} className="font-medium text-state-info-ink hover:underline">
                            {i.orderCode}
                          </Link>
                          <div className="text-xs text-muted-foreground">{i.order.customerName}</div>
                          <div className="text-xs text-muted-foreground">
                            Tổng {fmt(i.order.totalAmount)}đ · {i.order.status}
                          </div>
                        </>
                      ) : i.orderCode ? (
                        <span className="text-xs text-muted-foreground">
                          {i.orderCode}
                          <br />
                          <span className="text-state-warning-ink">(không tìm thấy đơn)</span>
                        </span>
                      ) : i.txnStatus === "UNMATCHED" ? (
                        // 20/08 — điều kiện cảnh báo đổi từ "nội dung CK KHÔNG CÓ MÃ ĐƠN"
                        // sang "sổ giao dịch KHÔNG TRA RA ĐƠN". Nội dung CK nay không bao
                        // giờ còn mã đơn nữa nên điều kiện cũ đỏ 100% ⇒ vô nghĩa và che
                        // mất đúng những dòng cần người xử lý.
                        <span className="text-xs font-medium text-state-warning-ink">
                          Không tra ra đơn
                        </span>
                      ) : i.txnStatus === "MATCHED" ? (
                        <span className="text-xs text-muted-foreground">
                          Đã rót vào phiếu thu (xem bảng trên)
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ui.cls}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {i.error ??
                        (matchedViaLedger
                          ? "Tiền đã rót vào phiếu thu của đơn — không cần xử lý tay"
                          : i.status === "SUCCESS"
                            ? "Đơn đã xác nhận + cấp TK phụ huynh"
                            : "—")}
                      {/* Lý do sổ mới không tra ra phiếu thu (tra theo gì, vướng ở đâu).
                          In ra vì đây là chỉ dẫn xử lý tay; chỉ hiện khi khác `error`
                          để không lặp y nguyên một câu hai lần. */}
                      {i.unmatchedNote && i.unmatchedNote !== i.error && (
                        <div className="mt-1 text-state-warning-ink">{i.unmatchedNote}</div>
                      )}
                      {i.status === "FAILED" && i.order && (
                        <div className="mt-1">
                          <Link href={`/orders/${i.order.id}`} className="font-semibold text-primary hover:underline">
                            Mở đơn để xử lý →
                          </Link>
                        </div>
                      )}
                    </td>
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
