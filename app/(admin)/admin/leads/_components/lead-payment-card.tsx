import Link from "next/link";
import type { LeadPaymentSummary } from "@/lib/payments/summary";

const fmt = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

/**
 * Khối thanh toán của lead (đã nộp / tổng phải thu / còn thiếu) + điều kiện chốt.
 * Ngôn ngữ nghiệp vụ — KHÔNG hiện mã kỹ thuật (PAYMENT_REQUIRED/REGISTERED/R7-04).
 */
export function LeadPaymentCard({
  leadId,
  summary,
  canCreateOrder = false,
}: {
  leadId: string;
  summary: LeadPaymentSummary;
  /**
   * G-A (21/08/2026) — trước đây nút "Tạo đơn hàng" hiện cho MỌI vai; ai không đủ
   * quyền bấm vào bị đá về dashboard không lời giải thích (đúng triệu chứng
   * "Sale kẹt" được báo). Nay trang truyền xuống kết quả `orders:create` để
   * menu ≡ cổng. Mặc định `false` — thà ẩn nhầm còn hơn hiện nút chết.
   */
  canCreateOrder?: boolean;
}) {
  const { paid, total, remaining, hasOrder, scholarshipFull, eligible, donHang } = summary;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Thanh toán</h2>

      <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground">Đã nộp</div>
          <div className="font-semibold text-state-success-ink">{fmt(paid)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Tổng phải thu</div>
          <div className="font-semibold text-foreground">
            {hasOrder ? fmt(total) : <span className="text-muted-foreground">Chưa có đơn hàng</span>}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Còn thiếu</div>
          <div className="font-semibold text-state-warning-ink">{hasOrder ? fmt(remaining) : "—"}</div>
        </div>
      </div>

      <div className="mt-3">
        {eligible ? (
          <span className="inline-flex items-center rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-medium text-state-success-ink">
            ✓ Đủ điều kiện chốt{scholarshipFull ? " (miễn phí / học bổng toàn phần)" : ""}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-state-warning-soft px-2.5 py-1 text-xs font-medium text-state-warning-ink">
            Chưa đủ điều kiện chốt — cần ghi nhận thanh toán trước
          </span>
        )}
      </div>

      {/* ── ĐƯỜNG SANG ĐƠN (15/09/2026) ───────────────────────────────────────
          Chủ dự án: khách đến đóng đợt 2 ⇒ sale vào lead rồi "bấm sang hoá đơn để
          cung cấp mã QR đóng đợt 2". Nhãn nút nói ĐÚNG việc sắp làm kèm SỐ TIỀN —
          một chữ "Xem đơn" buộc sale mở ra rồi mới biết còn nợ đợt mấy.

          Hiện ngay khi CÓ đơn, không chờ tiền về: mã QR của ĐỢT 1 cũng nằm trong
          trang đó, và đó là việc đầu tiên sale cần sau khi tạo đơn. */}
      {donHang.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {donHang.map((d) => (
            <Link
              key={d.id}
              href={`/orders/${d.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="block font-mono text-xs text-muted-foreground">{d.code}</span>
                <span className="block font-medium text-foreground">
                  {d.dotKeTiep
                    ? `Đóng đợt ${d.dotKeTiep.soDot} · ${fmt(d.dotKeTiep.conThieu)}`
                    : d.conThieu > 0
                      ? `Còn thiếu ${fmt(d.conThieu)} — mở đơn để xuất QR`
                      : "Đã thu đủ — mở đơn để xem"}
                </span>
              </span>
              <span aria-hidden className="shrink-0 text-muted-foreground">→</span>
            </Link>
          ))}
        </div>
      )}

      {canCreateOrder && (
        <Link
          href={`/orders/new?leadId=${leadId}`}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          + Tạo đơn hàng cho lead này
        </Link>
      )}
    </div>
  );
}
