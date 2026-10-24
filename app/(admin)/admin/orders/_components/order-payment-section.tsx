"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { QrCode, BadgeCheck, CalendarClock } from "lucide-react";
import { QrZoom } from "./qr-zoom";
import type { PaymentRequestRow } from "./payment-requests-section";
import { markOrderInstallmentPaidAction } from "../_actions";
import { formatDateVN } from "@/lib/format/date";
import { LY_DO_DA_BO_KE_HOACH_DOT } from "@/lib/orders/ke-hoach-da-bo";
// MỘT câu trả lời cho một đợt, suy từ CẢ HAI SỔ — xem chú thích đầu tệp đó.
import { trangThaiDot } from "@/lib/payments/trang-thai-dot";

type Installment = {
  id: string;
  soDot: number;
  amount: number;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  // OD1 — số ngày nhắc trước hạn đợt 2 đã lưu (null → chưa đặt, dùng default).
  reminderDays: number | null;
};

function vnd(n: number) {
  return n.toLocaleString("vi-VN") + "đ";
}

// ── CÁC ĐỢT CŨ CỦA ĐƠN — CHỈ XEM [20/10/2026] ───────────────────────────────────────────────────────────────
//
// Chỗ này từng là khối "Kế hoạch thanh toán" có form thiết lập/sửa (thu cọc · chia 1–4 đợt · Lưu kế hoạch). Chủ dự án
// chốt 20/10/2026: *"bỏ phần kế hoạch thanh toán luôn đi, bây giờ mỗi lần đóng là 1 lần thanh toán độc lập"* — nên KHÔNG
// còn ô/nút nào để TẠO hay SỬA kế hoạch trên bất kỳ đơn nào (máy chủ cũng từ chối: `recordOrderInstallmentsAction`).
//
// ⚠️ NHƯNG ĐỪNG XOÁ CẢ KHỐI. Đơn CŨ đang có đợt dở dang vẫn phải thu được tiền: danh sách đợt, nút "Đánh dấu đã đóng"
// (`markInstallmentPaid`) và nhãn "tiền đã về" ở đây là lối thao tác duy nhất cho các đợt đó ngoài bảng phiếu thu. Gỡ
// đi là kẹt tiền khách đang trả dở. Cũng giữ dòng "Sổ kế toán" + link /payments — thông tin này không nằm ở khối nào khác
// của trang đơn.
export function OrderInstallmentsView({
  orderId,
  canManage,
  installments,
  accounting,
  paymentRequests,
}: {
  orderId: string;
  canManage: boolean;
  installments: Installment[];
  // (b) PA-A 22/07 — tổng theo sổ kế toán (Payment): tiền chỉ "xong" khi kế toán
  // CONFIRMED ở /payments. Đợt PAID nghĩa là SALE đã thu, không phải kế toán đã ✓.
  accounting: { confirmed: number; pending: number };
  /**
   * Phiếu thu theo đợt kèm TIỀN THẬT đã rót (`allocated`) — nguồn để nói đợt nào "đã nhận".
   *
   * ⚠️ KHÔNG suy từ `OrderInstallment.status`: cột đó là KẾ HOẠCH (sale tự đánh dấu),
   * còn `PaymentAllocation` là SỔ TIỀN. Tiền về qua QR làm phiếu thành PAID mà cột kế
   * hoạch vẫn PENDING.
   */
  paymentRequests: PaymentRequestRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  /**
   * Đợt nào đã có TIỀN THẬT rót vào. `installmentNo > 0` loại phiếu thu toàn đơn (số 0) — nó không phải một đợt.
   */
  const daRotTheoDot = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of paymentRequests) {
      if (r.installmentNo > 0 && r.allocated > 0) m.set(r.installmentNo, r.allocated);
    }
    return m;
  }, [paymentRequests]);

  function markPaid(id: string) {
    start(async () => {
      const res = await markOrderInstallmentPaidAction(id, orderId);
      if (res.ok) {
        toast.success("Đã ghi nhận đóng đợt");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5" data-testid="khoi-dot-cu-chi-xem">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
        <CalendarClock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        {installments.length > 0 ? "Các đợt thanh toán (kế hoạch cũ)" : "Thanh toán"}
      </h2>

      <div className="mb-3 space-y-2">
        {installments.map((i) => (
          <div
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm"
          >
            <span className="min-w-0">
              <b className="font-semibold">Đợt {i.soDot}</b> · {vnd(i.amount)}
              {i.dueDate ? ` · hẹn ${formatDateVN(i.dueDate)}` : ""}
              {/* TIỀN THẬT đã về phiếu của đợt này (15/09/2026).

                  Nhãn bên phải đọc `OrderInstallment.status` — cột KẾ HOẠCH, do sale
                  tự đánh dấu. Tiền về qua QR thì phiếu thành PAID mà cột đó vẫn
                  PENDING, nên hàng hiện "Chờ đóng" trong lúc khối QR ngay trên hiện
                  "Đã đủ" — hai con số cho cùng một đợt. Dòng này in SỔ TIỀN
                  (`PaymentAllocation`), thứ duy nhất nói được khách đã trả bao nhiêu. */}
              {(daRotTheoDot.get(i.soDot) ?? 0) > 0 && (
                <span className="ml-1 whitespace-nowrap text-xs font-semibold text-state-success-ink">
                  · đã nhận {vnd(daRotTheoDot.get(i.soDot) ?? 0)}
                </span>
              )}
            </span>
            {/* ── NHÃN ĐỢT ĐỌC CẢ HAI SỔ [15/09/2026] ──────────────────────────
                Trước bản này nhãn chỉ đọc `OrderInstallment.status`, nên đợt mà TIỀN ĐÃ
                VỀ qua QR vẫn bày nút "Đánh dấu đã đóng" — trong khi bảng Phiếu thu ngay
                trên đã ghi "Đã đủ". Hai giọng cho một đợt, và giọng sai lại là giọng có
                nút bấm. Luật ở `trangThaiDot`. */}
            {(() => {
              const tt = trangThaiDot({
                soDot: i.soDot,
                amountDue: i.amount,
                daRot: daRotTheoDot.get(i.soDot) ?? 0,
                keHoachDaThu: i.status === "PAID",
              });
              if (tt.ma === "DA_THU") {
                // PA-A: đã thu ≠ kế toán đã ✓. Chỉ ghi "KT đã xác nhận" khi đơn không còn
                // khoản PENDING và kế toán đã ✓ (mapping đợt↔khoản là mức ĐƠN).
                const ktXong = accounting.pending === 0 && accounting.confirmed > 0;
                return (
                  <span
                    className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${
                      ktXong ? "text-state-success-ink" : "text-state-warning-ink"
                    }`}
                  >
                    <BadgeCheck className="h-4 w-4" aria-hidden />
                    {tt.nguon === "SALE_THU_TAY" ? "Sale đã thu" : "Tiền đã về"}
                    {ktXong ? " · KT đã xác nhận" : " — chờ kế toán"}
                  </span>
                );
              }
              if (!canManage) {
                return (
                  <span className="whitespace-nowrap text-xs text-state-warning-ink">
                    {tt.ma === "MOT_PHAN" ? "Thu một phần" : "Chờ đóng"}
                  </span>
                );
              }
              return (
                <button
                  onClick={() => markPaid(i.id)}
                  disabled={pending}
                  className="rounded bg-state-success-ink px-2 py-0.5 text-xs font-semibold text-white transition-opacity duration-150 disabled:opacity-50"
                >
                  {tt.ma === "MOT_PHAN" ? "Đánh dấu thu đủ" : "Đánh dấu đã đóng"}
                </button>
              );
            })()}
          </div>
        ))}

        {/* Luật 12: nói THẬT vì sao không có chỗ nhập kế hoạch. Cùng một hằng với câu máy chủ trả khi từ chối. */}
        <p className="text-sm text-muted-foreground" data-testid="da-bo-ke-hoach-dot">
          {installments.length > 0
            ? "Các đợt trên được lập trước ngày bỏ kế hoạch thanh toán — vẫn thu bình thường nhưng không sửa được kế hoạch nữa. "
            : ""}
          {LY_DO_DA_BO_KE_HOACH_DOT} Xuất QR ở bảng phiếu thu phía trên; tiền mặt hoặc chuyển khoản ngoài hệ thống thì ghi nhận ở sổ Khoản thu.
        </p>

        {/* PA-A — trạng thái sổ kế toán (read-only): nguồn sự thật tiền là /payments. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed border-border px-3 py-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
            Sổ kế toán
          </span>
          {accounting.confirmed === 0 && accounting.pending === 0 ? (
            <span className="text-muted-foreground">Chưa có khoản thu nào được ghi nhận.</span>
          ) : (
            <>
              <span className="whitespace-nowrap font-semibold text-state-success-ink">
                Đã xác nhận: {vnd(accounting.confirmed)}
              </span>
              <span
                className={`whitespace-nowrap ${
                  accounting.pending > 0
                    ? "font-semibold text-state-warning-ink"
                    : "text-muted-foreground"
                }`}
              >
                Chờ xác nhận: {vnd(accounting.pending)}
              </span>
            </>
          )}
          <a href="/payments" className="ml-auto font-semibold text-primary underline">
            Mở sổ Khoản thu →
          </a>
        </div>
      </div>
    </section>
  );
}


// "Thanh toán & QR" — QR chuyển khoản VietQR (đặt gần cuối trang, ngay trước nút đổi trạng thái).
export function OrderQrSection({
  qrUrl,
  transferContent,
  dueNow,
}: {
  /**
   * URL ảnh QR, hoặc null khi KHÔNG có mã để đưa. Từ 20/08 có HAI lý do null:
   *  1. cơ sở chưa cấu hình tài khoản nhận tiền (lý do cũ);
   *  2. người xem thiếu `orders:view-pii` — nội dung CK trên mã chứa SĐT phụ huynh
   *     nên server cố tình không dựng URL ([id]/page.tsx).
   * Ô trống bên dưới vì thế nói CẢ HAI lý do: prop không mang theo lý do cụ thể, mà
   * thêm prop thì phải sửa `order-detail-client.tsx` (ngoài phạm vi đợt vá này).
   */
  qrUrl: string | null;
  transferContent: string;
  /** Số tiền QR đang in + nhãn ("Đợt 1" / "Toàn bộ đơn" / "Còn thiếu"). */
  dueNow: { amount: number; label: string };
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
        <QrCode className="h-4 w-4 text-primary" /> Thanh toán & QR
      </h2>
      {/* `max-w-sm` cũ ép ảnh QR + toàn bộ chữ vào một cột 24rem, nên trong cột trái
          rộng ~44rem của bản dựng lại thì hơn nửa khối là khoảng trắng. Từ `sm` trở lên
          xếp NGANG: ảnh trái, số tiền + nội dung CK phải — và chữ căn trái, dễ đọc hơn
          căn giữa. Dưới `sm` giữ nguyên một cột căn giữa. */}
      <div>
        {qrUrl ? (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-5">
            {/* Ảnh QR public từ img.vietqr.io — không cần API key. Bấm để phóng to. */}
            <QrZoom
              src={qrUrl}
              alt="VietQR thanh toán"
              title={`${dueNow.label}: ${dueNow.amount.toLocaleString("vi-VN")}đ`}
              transferContent={transferContent}
              className="h-56 w-56"
            />
            {/* Nói rõ QR đang thu bao nhiêu — khách đóng 2 đợt dễ tưởng phải
                chuyển cả tổng đơn. Nội dung CK bên dưới là dạng người đọc
                (`HoTenCon_SdtPH_TenKhoa`, chốt 20/08), sale đọc thẳng cho khách. */}
            <div className="min-w-0 space-y-2 text-center sm:text-left">
              <p className="text-sm font-semibold text-foreground">
                {dueNow.label}:{" "}
                <span className="tabular-nums">
                  {dueNow.amount.toLocaleString("vi-VN")}đ
                </span>
              </p>
              <div className="text-xs text-muted-foreground">
                Nội dung CK:{" "}
                <span className="break-all font-mono font-semibold text-foreground">
                  {transferContent}
                </span>
              </div>
              <p className="max-w-prose text-xs text-muted-foreground">
                Chuyển đúng số tiền + giữ nguyên nội dung → hệ thống tự xác nhận đơn.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted p-4 text-center">
            <QrCode className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Chưa có mã QR để hiển thị.</p>
            <p className="text-xs text-muted-foreground">
              Cơ sở chưa cấu hình tài khoản nhận tiền — hoặc tài khoản của bạn không có
              quyền xem thông tin liên hệ, mà nội dung chuyển khoản trên mã QR có SĐT
              phụ huynh nên mã bị ẩn.
            </p>
            <a href="/tich-hop" className="text-xs font-semibold text-primary underline">
              Cấu hình VietQR trong Tích hợp →
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
