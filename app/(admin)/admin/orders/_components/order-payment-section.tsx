"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { QrCode, BadgeCheck, CalendarClock } from "lucide-react";
import { QrZoom } from "./qr-zoom";
import type { PaymentRequestRow } from "./payment-requests-section";
import { recordOrderInstallmentsAction, markOrderInstallmentPaidAction } from "../_actions";
import { formatDateVN } from "@/lib/format/date";
import { HelpHint } from "@/components/admin/ui/help-hint";
// KHỐI NHẬP KẾ HOẠCH dùng chung với TRANG TẠO ĐƠN [15/09/2026]. Luật chia đợt (chia đều ·
// chèn cọc · giữ đợt đã khoá · kiểm Σ) nằm hết trong `useKeHoachDot` — tệp này chỉ còn
// phần RIÊNG của trang chi tiết: bảng đọc, nút đánh dấu đã đóng, và đường GHI.
import {
  KeHoachDotEditor,
  useKeHoachDot,
  type DotForm,
} from "./ke-hoach-dot-editor";
// Mặc định ô "đã thu" SUY TỪ TIỀN THẬT — thuần, dùng chung luật với cổng ở đường ghi.
import { dotsBanDauTuTien } from "@/lib/payments/khai-da-thu";
import { NGAY_NHAC_MAC_DINH } from "@/lib/payments/ke-hoach-don-moi";
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

/**
 * Dựng trạng thái ban đầu của form từ kế hoạch ĐÃ LƯU.
 *
 * ⚠️ ĐÃ SỬA [14/09/2026] — chưa có kế hoạch thì KHÔNG còn mặc định "đã thu cả đơn".
 *
 * Chú thích cũ ở đây nói mặc định đó "khiến bấm Lưu mà không đổi gì thì không sinh ra
 * khoản nợ ma". Nó sinh ra thứ NGƯỢC LẠI và tệ hơn: TIỀN MA. Đo trên `satarobo_local`,
 * đơn `ORD-260913-000001` (8.000.000đ, sổ có đúng 1.000.000đ): mở đơn, không đổi gì,
 * bấm "Lưu" ⇒ một `Payment` 7.000.000đ khống + đơn lật `CONFIRMED` + màn in "còn thiếu
 * 0đ". 193/496 đơn đang ở đúng hình dạng đó.
 *
 * Nay hỏi `dotsBanDauTuTien` (thuần, `lib/payments/khai-da-thu.ts` — có test + có phần
 * giải thích vì sao chọn TRỤC B). Ba ô UI thuần (`dueDate`/`reminderDays`/`laCoc`) gắn ở
 * đây chứ không ở hàm thuần: hàm đó cố ý không biết "hôm nay" là ngày nào (luật 19), và
 * bịa một cái hạn cũng là bịa, chỉ khó thấy hơn bịa tiền.
 */
function dotsBanDau(
  installments: Installment[],
  totalAmount: number,
  daThuTheoSo: number,
): DotForm[] {
  if (installments.length === 0) {
    return dotsBanDauTuTien({ totalAmount, daThuTheoSo }).map((d) => ({
      amount: d.amount,
      daThu: d.daThu,
      dueDate: "",
      reminderDays: NGAY_NHAC_MAC_DINH,
      laCoc: false,
    }));
  }
  return [...installments]
    .sort((a, b) => a.soDot - b.soDot)
    .map((i) => ({
      amount: i.amount,
      daThu: i.status === "PAID",
      dueDate: i.dueDate?.slice(0, 10) ?? "",
      reminderDays: i.reminderDays ?? NGAY_NHAC_MAC_DINH,
      // Kế hoạch đã lưu: đợt 1 mang số tiền nhỏ hơn phần chia đều là dấu hiệu có cọc,
      // nhưng ĐOÁN ở đây là sai. Giữ false; người dùng tích lại nếu muốn đổi.
      laCoc: false,
    }));
}

// G4 — Kế hoạch thanh toán 2 đợt. ĐẶT NGAY SAU section "Phương thức thanh toán"
// (tách khỏi khối QR để bố cục theo yêu cầu). Gồm: hiển thị các đợt + nút đánh dấu
// đã đóng đợt 2, và form thiết lập tối đa 2 đợt (gate orders:manage qua action).
export function OrderInstallmentPlan({
  orderId,
  totalAmount,
  canManage,
  installments,
  accounting,
  daThuTheoSo,
  paymentRequests,
}: {
  orderId: string;
  totalAmount: number;
  canManage: boolean;
  installments: Installment[];
  // (b) PA-A 22/07 — tổng theo sổ kế toán (Payment): tiền chỉ "xong" khi kế toán
  // CONFIRMED ở /payments. Đợt PAID nghĩa là SALE đã thu, không phải kế toán đã ✓.
  accounting: { confirmed: number; pending: number };
  /**
   * TRỤC B — Σ `Payment` còn sống `saleStatus = RECORDED` của đơn (`congNo.daThu` ở
   * trang cha). Nguồn của mặc định ô "đã thu".
   *
   * ⚠️ BẮT BUỘC, KHÔNG CÓ MẶC ĐỊNH (luật 7: tham số có mặc định nguy hiểm thì bỏ mặc
   * định — để `tsc` liệt kê call site thay vì để một chỗ gọi quên rồi im lặng bịa tiền).
   *
   * ⚠️ ĐỪNG suy nó từ `accounting.confirmed + accounting.pending`. Hai bộ lọc KHÁC NHAU
   * (`accountantStatus` ∈ {CONFIRMED, PENDING} vs `saleStatus = RECORDED`) và chênh lệch
   * KHÔNG lý thuyết: đo 14/09 trên `satarobo_local` có 379/380 khoản mang
   * `saleStatus = COLLECT_CONFIRMED` ⇒ trục B ≈ 0 trong khi tổng `accounting` là toàn bộ
   * số tiền. Dựng mặc định bằng một trục rồi để đường ghi (`recordInstallmentPlan` đo
   * `KHOAN_DA_GHI_NHAN`) gác bằng trục kia là hai con số không bao giờ gặp nhau — đúng
   * con bug đang vá, chỉ nhỏ hơn.
   */
  daThuTheoSo: number;
  /**
   * Phiếu thu theo đợt kèm TIỀN THẬT đã rót (`allocated`) — nguồn để KHOÁ đợt đã thu.
   *
   * ⚠️ KHÔNG suy từ `OrderInstallment.status`: cột đó là KẾ HOẠCH (sale tự đánh dấu),
   * còn `PaymentAllocation` là SỔ TIỀN. Tiền về qua QR làm phiếu thành PAID mà cột kế
   * hoạch vẫn PENDING — khoá theo cột kế hoạch là để sale sửa được một đợt đã có tiền,
   * đúng thứ cổng A6 vừa chặn ở server (`doiTienDotDaThu`).
   */
  paymentRequests: PaymentRequestRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  /**
   * Đợt nào đã có TIỀN THẬT rót vào ⇒ số tiền của nó BẤT BIẾN (A6).
   *
   * `installmentNo > 0` loại phiếu thu toàn đơn (số 0) — nó không phải một đợt.
   */
  const daRotTheoDot = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of paymentRequests) {
      if (r.installmentNo > 0 && r.allocated > 0) m.set(r.installmentNo, r.allocated);
    }
    return m;
  }, [paymentRequests]);

  // ── TRẠNG THÁI: MỘT MẢNG ĐỢT, không phải dot1/dot2 ────────────────────────────
  // Trần "2 đợt" cũ nằm ở đây chứ không ở DB: hai biến `dot1`/`dot2`, đợt 2 tự tính,
  // một ô ngày. Nay là mảng — thêm đợt là thêm phần tử.
  //
  // ⚠️ TRẠNG THÁI + LUẬT CHIA ĐỢT nay ở `useKeHoachDot`, DÙNG CHUNG với trang tạo đơn
  // (15/09/2026). Đừng dựng lại ở đây: chia đợt là phép chia TIỀN, và hai bản cài đặt sẽ
  // lệch nhau ở lần sửa thứ nhất mà KHÔNG test nào đỏ — cả `lech` lẫn `thieuHan` chỉ
  // CHẶN LƯU, nên bản lệch chỉ hiện ra thành "không lưu được đơn, không rõ vì sao".
  const kh = useKeHoachDot({
    totalAmount,
    dots0: () => dotsBanDau(installments, totalAmount, daThuTheoSo),
    daRotTheoDot,
    // `theoTong` để MẶC ĐỊNH (false) — `Order.totalAmount` của đơn ĐÃ TẠO là bất động, và
    // một effect "tổng đổi thì chia lại" chạy ở đây sẽ ghi đè kế hoạch kế toán vừa đặt.
  });
  const { dots, soDotHocPhi, lech, thieuHan } = kh;

  /**
   * THU GỌN khối sửa kế hoạch khi kế hoạch ĐÃ CÓ (15/09/2026).
   *
   * Chủ dự án: *"thu gọn lại và có nút sửa nếu có nhu cầu sửa"*. Từ đợt này kế hoạch
   * được lập NGAY ở trang tạo đơn, nên trên trang đơn nó gần như luôn chỉ để ĐỌC —
   * bày cả form nhập ra mặc định là mời người ta sửa một thứ đang đúng.
   *
   * Chưa có kế hoạch ⇒ MỞ SẴN: lúc đó lập kế hoạch đúng là việc cần làm.
   */
  const [moSua, setMoSua] = useState(installments.length === 0);

  function save() {
    if (lech !== 0) {
      toast.error(
        `Tổng các phiếu phải bằng ${vnd(totalAmount)} — đang lệch ${vnd(Math.abs(lech))}`,
      );
      return;
    }
    if (thieuHan >= 0) {
      toast.error(`Đợt ${thieuHan + 1} chưa thu — chọn ngày hẹn đóng`);
      return;
    }
    start(async () => {
      // ⚠️ HẠN CHẾ ĐÃ BIẾT: cờ `laCoc` KHÔNG được lưu xuống DB — `OrderInstallment` không
      // có cột cho nó, và thêm cột chỉ để hiện một cái nhãn là không đáng một migration
      // trên bảng có dữ liệu prod. Hệ quả: sau khi lưu, bảng phía trên hiện "Đợt 1" thay
      // vì "Cọc". Tiền và QR thì ĐÚNG — cọc là một phiếu thu riêng, có QR riêng, và đã
      // được trừ khỏi đợt sau.
      const res = await recordOrderInstallmentsAction({
        orderId,
        dots: dots.map((d) => ({
          amount: d.amount,
          daThu: d.daThu,
          // Đợt đã thu không cần hạn — gửi null để cron nhắc nợ không ôm nhầm.
          dueDate: d.daThu ? null : d.dueDate || null,
          reminderDays: d.daThu ? null : d.reminderDays,
        })),
      });
      if (res.ok) {
        toast.success(`Đã lưu kế hoạch ${dots[0]?.laCoc ? "cọc + " : ""}${soDotHocPhi} đợt`);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

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
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
        <CalendarClock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        Kế hoạch thanh toán
        <HelpHint>
          Đóng một lần hoặc chia thành nhiều đợt theo học phần (48 buổi = 4 học phần × 12 buổi). Công văn
          SR.QD.223 nêu mốc các đợt cách 30 ngày; SR.QD.219 Điều 2 cho phép chia đều tối đa
          12 kỳ theo tháng.
        </HelpHint>
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
        {installments.length === 0 && (
          <p className="text-sm text-muted-foreground">Chưa thiết lập kế hoạch.</p>
        )}

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

      {/* ── THU GỌN KHỐI SỬA [15/09/2026] ───────────────────────────────────────
          Chủ dự án: *"thu gọn lại và có nút sửa nếu có nhu cầu sửa"*. Từ đợt này kế
          hoạch được lập NGAY ở trang tạo đơn, nên trên trang đơn nó gần như luôn chỉ
          để ĐỌC — bày cả form nhập ra mặc định là mời người ta sửa một thứ đang đúng.

          Nút nói rõ trạng thái hai chiều, KHÔNG dùng một mũi tên trơ: người bán phải
          biết bấm vào sẽ được gì (luật 12). */}
      {canManage && !moSua && (
        <button
          type="button"
          onClick={() => setMoSua(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
        >
          <CalendarClock className="h-4 w-4" aria-hidden />
          {installments.length === 0 ? "Thiết lập kế hoạch" : "Sửa kế hoạch thanh toán"}
        </button>
      )}

      {canManage && moSua && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          {installments.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sửa kế hoạch
              </span>
              <button
                type="button"
                onClick={() => setMoSua(false)}
                className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
              >
                Thu gọn
              </button>
            </div>
          )}

          {/* `choKhaiDaThu` = true: đơn ở đây ĐÃ TỒN TẠI, và "cọc đã đóng trước khi lên
              hệ thống" là ca thật. Đây là chỗ DUY NHẤT còn khai được đã-thu — trang tạo
              đơn đã tắt. */}
          <KeHoachDotEditor kh={kh} totalAmount={totalAmount} choKhaiDaThu />

          <button
            onClick={save}
            disabled={pending || lech !== 0 || thieuHan >= 0}
            className="min-h-11 w-full rounded-md bg-primary-dark px-3 py-2 text-sm font-semibold text-white transition-opacity duration-150 disabled:opacity-50"
          >
            {pending
              ? "Đang lưu…"
              : `Lưu kế hoạch ${dots[0]?.laCoc ? "cọc + " : ""}${soDotHocPhi} đợt`}
          </button>
        </div>
      )}
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
