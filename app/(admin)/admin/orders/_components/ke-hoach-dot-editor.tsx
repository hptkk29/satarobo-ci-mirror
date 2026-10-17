"use client";

/**
 * KHỐI SỬA KẾ HOẠCH THANH TOÁN — dùng chung cho TRANG TẠO ĐƠN và TRANG CHI TIẾT ĐƠN.
 *
 * Chủ dự án 15/09/2026: *"đưa phần kế hoạch thanh toán ra trang tạo đơn hàng luôn đi, đặt
 * ở dưới session khoá học và lấy số tiền cần thanh toán ở phần khoá học sau khi hoàn thành
 * các tuỳ chọn của đơn hàng khoá học luôn"*.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TÁCH RA CHỨ KHÔNG CHÉP SANG
 *
 * Khối này là nơi NGƯỜI BÁN CHIA TIỀN của một đơn. Chép nó sang trang tạo đơn thì có hai
 * bản luật chia đợt, hai bản kiểm Σ, hai bản kẹp trần — và chúng sẽ lệch nhau ở lần sửa
 * thứ nhất, theo cái kiểu không lỗi nào báo: đơn lập ở trang tạo hiện một con số, mở lại
 * trang chi tiết hiện con khác. Cả `lech !== 0` lẫn `thieuHan` đều là cổng CHẶN LƯU, nên
 * một bản lệch không làm test đỏ — nó chỉ làm người bán không lưu được đơn và không hiểu
 * vì sao.
 *
 * Khác biệt DUY NHẤT giữa hai trang là ĐƯỜNG GHI (`createOrderManualAction` gửi kèm payload
 * tạo đơn · `recordOrderInstallmentsAction` gọi trên đơn đã có), nên nút Lưu KHÔNG nằm ở
 * đây — mỗi trang tự dựng nút của mình. Trạng thái thì nằm ở `useKeHoachDot` để trang tạo
 * đơn đọc được `dots` lúc bấm "Tạo đơn".
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from "react";
import { MoneyInput } from "@/components/ui/money-input";
import { HelpHint } from "@/components/admin/ui/help-hint";
import {
  chenCoc,
  chiaDotHocPhi,
  chiaDotGiuDotDaKhoa,
  hanChoDot,
  TRAN_SO_DOT,
} from "@/lib/payments/ke-hoach-dot";
import { NGAY_NHAC_MAC_DINH } from "@/lib/payments/ke-hoach-don-moi";

function vnd(n: number) {
  return n.toLocaleString("vi-VN") + "đ";
}

/** Một dòng đợt trên form. `dueDate` là chuỗi `yyyy-mm-dd` vì `<input type="date">`. */
export type DotForm = {
  amount: number;
  daThu: boolean;
  dueDate: string;
  reminderDays: number;
  /** Phiếu CỌC — đóng trước, và là phần ĐẦU của học phí chứ không phải khoản thu thêm. */
  laCoc: boolean;
};

export type KeHoachDotState = ReturnType<typeof useKeHoachDot>;

/**
 * Trạng thái + luật của khối chia đợt.
 *
 * @param totalAmount Số tiền phải chia. Trang chi tiết: `Order.totalAmount` (bất động).
 *   Trang tạo đơn: TỔNG ĐƠN SAU GIẢM GIÁ, và nó ĐỔI trong lúc người bán còn đang nhập.
 * @param dots0 Trạng thái mở đầu. Trang chi tiết dựng từ kế hoạch đã lưu; trang tạo đơn
 *   dựng từ `dotsChoDonMoi`.
 * @param daRotTheoDot đợt → TIỀN THẬT đã rót (`PaymentAllocation`). Trang tạo đơn truyền
 *   Map rỗng: đơn chưa tồn tại thì không thể có đồng nào.
 * @param theoTong `true` ⇒ tổng đổi thì CHIA LẠI theo số đợt đang chọn (trang tạo đơn).
 */
export function useKeHoachDot({
  totalAmount,
  dots0,
  daRotTheoDot,
  theoTong = false,
}: {
  totalAmount: number;
  dots0: () => DotForm[];
  daRotTheoDot: Map<number, number>;
  theoTong?: boolean;
}) {
  const [dots, setDots] = useState<DotForm[]>(dots0);
  /** Có thu cọc trước không + số tiền cọc. Cọc là phần ĐẦU của học phí, không cộng thêm. */
  const [coCoc, setCoCoc] = useState(false);
  const [tienCoc, setTienCoc] = useState(0);

  // Số ĐỢT HỌC PHÍ — KHÔNG đếm phiếu cọc. Chip "2 đợt" phải sáng khi khách chia
  // 2 đợt, dù bảng đang có 3 dòng vì có thêm phiếu cọc đứng đầu.
  const soDotHocPhi = dots.filter((d) => !d.laCoc).length;
  const tongCacDot = dots.reduce((s, d) => s + d.amount, 0);
  const lech = tongCacDot - totalAmount;
  const thieuHan = dots.findIndex((d) => !d.daThu && !d.dueDate);

  /** Số thứ tự đợt của hàng thứ `i` trên form (hàng cọc không phải một đợt học phí). */
  const soDotCuaHang = (i: number) => i + (dots[0]?.laCoc ? 0 : 1);
  const tienDaRot = (i: number) => daRotTheoDot.get(soDotCuaHang(i)) ?? 0;
  const hangBiKhoa = (i: number) => tienDaRot(i) > 0;
  /** Số hàng ĐẦU liên tiếp đang bị khoá — phần `chonSoDot` không được chia lại. */
  const soHangKhoa = dots.findIndex((_, i) => !hangBiKhoa(i));
  const demHangKhoa = soHangKhoa < 0 ? dots.length : soHangKhoa;

  /** Chọn số đợt → chia đều + sinh hạn cách 30 ngày. Người dùng sửa lại từng dòng được. */
  function chonSoDot(n: number, cocMoi?: number) {
    const coc = cocMoi ?? (coCoc ? tienCoc : 0);
    // Chia học phí thành n đợt TRƯỚC, rồi chèn cọc và trừ dần từ đợt 1 —
    // `chenCoc` giữ bất biến Σ = tổng đơn (xem lib/payments/ke-hoach-dot.ts).
    // ĐÃ CÓ ĐỢT THU TIỀN ⇒ giữ nguyên chúng, chỉ chia PHẦN CÒN THIẾU cho các đợt sau
    // (chủ dự án 15/09). Chia đều trên toàn bộ tổng rồi mới sửa mấy ô đầu về là một
    // khoảnh khắc Σ ≠ tổng đơn — vô hình trên màn, nhưng `kiemKeHoachDot` sẽ từ chối và
    // không ai hiểu vì sao. Luật ở `chiaDotGiuDotDaKhoa`.
    const tien =
      demHangKhoa > 0
        ? chiaDotGiuDotDaKhoa(
            totalAmount,
            dots.slice(0, demHangKhoa).map((d) => d.amount),
            Math.max(1, n - demHangKhoa),
          )
        : chenCoc(chiaDotHocPhi(totalAmount, n), coc).map((d) => d.amount);
    const coCocThat = coc > 0;
    // Mốc hạn = HÔM NAY. `hanChoDot` cố ý không tự đọc đồng hồ (luật 19) nên mốc truyền
    // từ đây — chỗ duy nhất thật sự có quyền biết "hôm nay".
    // +1 mốc hạn khi có cọc: phiếu cọc đứng đầu và đến hạn NGAY (khách quét trả trước).
    const han = hanChoDot(new Date(), tien.length);
    setDots(
      tien.map((amount, i) => ({
        amount,
        laCoc: coCocThat && i === 0,
        // Giữ nguyên "đã thu" của các đợt cũ còn trong tầm — đổi số đợt không được âm
        // thầm biến tiền đã thu thành chưa thu.
        //
        // ⚠️ Phiếu CỌC mặc định CHƯA THU: cả điểm của nó là sinh QR để khách trả trước.
        daThu: coCocThat && i === 0 ? false : (dots[i]?.daThu ?? false),
        dueDate: han[i]!.toISOString().slice(0, 10),
        reminderDays: dots[i]?.reminderDays ?? NGAY_NHAC_MAC_DINH,
      })),
    );
  }

  function suaDot(i: number, thayDoi: Partial<DotForm>) {
    setDots((cu) => cu.map((d, k) => (k === i ? { ...d, ...thayDoi } : d)));
  }

  /**
   * TỔNG ĐƠN ĐỔI ⇒ CHIA LẠI (chỉ trang tạo đơn — `theoTong`).
   *
   * Người bán đổi khoá học, số lượng, hay một khoản giảm giá thì tổng đơn nhảy, và kế
   * hoạch phải nhảy theo. Giữ nguyên số tiền cũ thì Σ lệch ⇒ nút "Tạo đơn" bị chặn với
   * một dòng báo lệch mà họ không gây ra.
   *
   * ⚠️ So với MỐC CŨ (`tongTruoc`), nên KHÔNG chạy ở lượt mount. Điều đó quan trọng với
   * trang chi tiết đơn: một effect chạy lúc mount sẽ ghi đè kế hoạch kế toán đã đặt bằng
   * một bản chia đều, và ghi đè im lặng. `theoTong` là cờ thứ hai cho cùng việc đó — thà
   * có hai lớp cho một đường ghi đè tiền.
   *
   * ⚠️ CỐ Ý ghi đè số tiền người bán đã tự sửa tay. Thà chia lại (họ thấy ngay và sửa
   * được) hơn là giữ số cũ rồi khoá nút Lưu — xem chú thích trên.
   */
  const tongTruoc = useRef(totalAmount);
  useEffect(() => {
    if (!theoTong) return;
    if (tongTruoc.current === totalAmount) return;
    tongTruoc.current = totalAmount;
    chonSoDot(soDotHocPhi);
    // `chonSoDot` đọc `dots`/`coCoc`/`tienCoc` hiện tại; khai đủ chúng vào deps là chạy
    // lại mỗi lần người bán gõ một chữ số trong ô đợt. Mốc canh là TỔNG, chỉ tổng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount, theoTong]);

  return {
    dots,
    setDots,
    coCoc,
    setCoCoc,
    tienCoc,
    setTienCoc,
    soDotHocPhi,
    tongCacDot,
    lech,
    thieuHan,
    tienDaRot,
    hangBiKhoa,
    demHangKhoa,
    chonSoDot,
    suaDot,
  };
}

/**
 * Khối nhập kế hoạch. KHÔNG có nút Lưu — xem chú thích đầu tệp.
 *
 * @param khoa Lý do khối đang KHOÁ, `null` là mở. Nguồn duy nhất cho cả việc khoá lẫn câu
 *   chữ hiện ra (`khoaKeHoachDonMoi`) — hai biểu thức riêng thì có hai cách lệch và cả hai
 *   đều im lặng (luật 12).
 */
export function KeHoachDotEditor({
  kh,
  totalAmount,
  khoa = null,
  choKhaiDaThu,
}: {
  kh: KeHoachDotState;
  totalAmount: number;
  khoa?: string | null;
  /**
   * CÓ cho khai "đợt này đã thu rồi" hay KHÔNG [16/09/2026].
   *
   * Chủ dự án: *"ở trang /orders/new session kế hoạch thanh toán thì bỏ nút tick đã thu
   * đi vì đây chỉ là giai đoạn tạo đơn và tạo kế hoạch thanh toán để xuất QR cho KH quét
   * thì làm gì đã thu mà tick?"*
   *
   * ⚠️ VÌ SAO LÀ PROP CHỨ KHÔNG XOÁ HẲN Ô TICK. Editor này mount ở ĐÚNG HAI chỗ và hai
   * chỗ có nghĩa nghiệp vụ KHÁC nhau:
   *   · `/orders/new` (`order-create-form.tsx`) — đơn ĐANG ĐƯỢC LẬP. Chưa có đơn thì
   *     chưa có tiền; ô tick ở đây chỉ mở đường ghi một khoản khống.
   *   · `/orders/[id]` (`order-payment-section.tsx`) — đơn ĐÃ CÓ THẬT, và ca "cọc đã đóng
   *     trước đó" là ca thật chủ dự án đã chạy qua trong vòng đời 15/09. Xoá ô tick ở đây
   *     là khoá đường khai cọc.
   * Xoá trắng ô tick vì trang A là làm hỏng trang B.
   *
   * ⚠️ Đây là bản vá UI. Đường SERVER cố ý KHÔNG đổi: `daThu` trong validator vẫn là
   * `z.boolean()` BẮT BUỘC (bỏ trường ⇒ 400), và `dotsGhiTuForm` vẫn chuẩn hoá
   * `daThu === true`. Trang tạo đơn gửi `daThu: false` cho mọi đợt — tức server vẫn là
   * bên quyết định, và một client bị sửa tay cũng không vượt qua được luật ở đó.
   */
  choKhaiDaThu: boolean;
}) {
  const {
    dots,
    setDots,
    coCoc,
    setCoCoc,
    tienCoc,
    setTienCoc,
    soDotHocPhi,
    tongCacDot,
    lech,
    thieuHan,
    tienDaRot,
    hangBiKhoa,
    demHangKhoa,
    chonSoDot,
    suaDot,
  } = kh;

  return (
    <div className="space-y-3">
      {/* KHOÁ THẬT, không chỉ mờ đi. `<fieldset disabled>` tắt MỌI ô nhập và MỌI nút bên
          trong ở tầng trình duyệt — một ô trông mờ mà vẫn gõ được là một ô nói dối, và
          `pointer-events-none` thì bàn phím vẫn đi vào được (Tab).
          `min-w-0` vì `fieldset` mặc định `min-width: min-content`, đủ để phá co giãn của
          grid bên trong ở màn 320px. */}
      <fieldset disabled={khoa != null} className="min-w-0 space-y-3 disabled:opacity-55">
        {khoa != null && (
          <p className="rounded-md border border-dashed border-border bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            {khoa}
          </p>
        )}

        {/* Đã có đợt thu tiền ⇒ nói NGAY, trước khi người bán gõ vào ô nào. */}
        {demHangKhoa > 0 && (
          <p className="rounded-md bg-state-info-soft px-2.5 py-1.5 text-xs text-state-info-ink">
            {demHangKhoa === 1 ? "Đợt đầu" : `${demHangKhoa} đợt đầu`} đã nhận tiền nên số
            tiền của các đợt đó KHOÁ lại. Chia lại số đợt chỉ phân bổ phần CÒN THIẾU cho
            các đợt sau.
          </p>
        )}

        {/* ── TIỀN CỌC ──────────────────────────────────────────────────────
            Cọc là phần ĐẦU của học phí, đóng sớm — KHÔNG phải khoản thu thêm.
            Nó thành một phiếu riêng đứng đầu (có QR để khách quét trả trước), và
            số tiền đó được TRỪ DẦN từ đợt 1. Tổng vẫn đúng bằng học phí. */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-2.5">
          <label className="flex items-center gap-2 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={coCoc}
              onChange={(e) => {
                const bat = e.target.checked;
                setCoCoc(bat);
                if (!bat) {
                  setTienCoc(0);
                  chonSoDot(soDotHocPhi, 0);
                }
              }}
              className="h-4 w-4"
            />
            <span className="font-medium">Thu cọc trước</span>
          </label>

          {coCoc && (
            <>
              <label className="flex items-center gap-1.5 text-sm">
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  Số tiền cọc (đ)
                </span>
                <MoneyInput
                  name="tien-coc"
                  min={0}
                  max={totalAmount}
                  value={tienCoc}
                  onValueChange={(v) => {
                    const c = Math.min(totalAmount, Math.max(0, v ?? 0));
                    setTienCoc(c);
                    chonSoDot(soDotHocPhi, c);
                  }}
                  suffix={null}
                  className="w-40 rounded-md px-2 py-1.5"
                />
              </label>
              <HelpHint>
                Cọc sinh một phiếu thu riêng kèm QR để khách quét trả trước. Số đã cọc
                được trừ vào đợt 1; cọc lớn hơn đợt 1 thì trừ tiếp sang đợt sau. Tổng
                các phiếu vẫn đúng bằng học phí — cọc KHÔNG cộng thêm.
              </HelpHint>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Chia thành</span>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => chonSoDot(n)}
              aria-pressed={soDotHocPhi === n}
              className={`min-h-9 whitespace-nowrap rounded-md border px-3 text-sm font-semibold transition-colors duration-150 ${
                soDotHocPhi === n
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              {n === 1 ? "1 lần" : `${n} đợt`}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            hoặc
            <input
              type="number"
              min={1}
              max={TRAN_SO_DOT}
              value={soDotHocPhi}
              onChange={(e) => {
                const n = Math.min(TRAN_SO_DOT, Math.max(1, Number(e.target.value) || 1));
                chonSoDot(n);
              }}
              aria-label="Số đợt tuỳ chọn"
              className="w-16 rounded-md border border-border px-2 py-1.5 text-sm tabular-nums"
            />
            đợt
          </label>
        </div>

        {/* ── HÀNG ĐỢT ĐO THEO KHUNG CHỨA, KHÔNG THEO MÀN [15/09/2026] ────────────
            `@container` + `@md:` (48rem khung chứa) thay cho `sm:` (40rem MÀN HÌNH).

            ⚠️ Vì sao đổi — đo thật ở màn 1024: khối này nằm trong cột trái của bố cục
            `lg:grid-cols-[minmax(0,1fr)_22rem]`, mà `lg` bật đúng ở 1024. Cột trái khi đó
            chỉ còn ~302px, trong khi `sm:` (≥640px MÀN) đã bật bố cục 4 cột từ lâu ⇒ hàng
            đợt xếp 4 cột trong một khung 302px và ô nhập SỐ TIỀN bị bóp còn **22px**:

              cols = 30,2px | 22,4px | 153px | 59,4px      ("Đợt N" | Số tiền | Hẹn | đã thu)

            Trang KHÔNG tràn ngang nên không cổng nào kêu; chỉ người bán mở ra ở laptop
            1024 mới thấy ô tiền hẹp bằng hai chữ số. Đây đúng là ca mà bề rộng MÀN không
            nói gì về bề rộng CHỖ ĐỨNG — thứ duy nhất trả lời được là khung chứa. */}
        <div className="@container space-y-2">
          {dots.map((d, i) => (
            <div
              key={i}
              // Cột cuối `auto` là ô tick "đã thu". Không cho khai đã-thu thì hàng còn BA
              // ô, và giữ nguyên bốn rãnh là chừa một khoảng trống không ai hiểu vì sao.
              className={`grid grid-cols-2 items-end gap-2 rounded-lg border border-border bg-background p-2 ${
                choKhaiDaThu
                  ? "@md:grid-cols-[auto_1fr_1fr_auto]"
                  : "@md:grid-cols-[auto_1fr_1fr]"
              }`}
            >
              <span
                className={`self-center whitespace-nowrap text-xs font-semibold ${
                  d.laCoc ? "text-accent-ink" : "text-muted-foreground"
                }`}
              >
                {d.laCoc ? "Cọc" : `Đợt ${i + (dots[0]?.laCoc ? 0 : 1)}`}
              </span>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  {hangBiKhoa(i) ? "Số tiền — đã thu, không sửa" : "Số tiền (đ)"}
                </span>
                {/* ── KHOÁ ĐỢT ĐÃ THU (A6) ────────────────────────────────────
                    Server đã TỪ CHỐI lượt lưu đổi số của đợt đã có tiền
                    (`doiTienDotDaThu`). Khoá ở đây để người bán KHÔNG gõ vào một ô
                    rồi mới bị từ chối — một ô gõ được mà lưu không được là một ô
                    nói dối (luật 12). */}
                <MoneyInput
                  name={`dot-${i}-amount`}
                  min={0}
                  value={d.amount}
                  disabled={hangBiKhoa(i)}
                  onValueChange={(v) => suaDot(i, { amount: Math.max(0, v ?? 0) })}
                  suffix={null}
                  className="mt-0.5 rounded-md px-2 py-1.5"
                />
                {hangBiKhoa(i) && (
                  <span className="mt-0.5 block text-xs text-state-success-ink">
                    Đã nhận {vnd(tienDaRot(i))}
                  </span>
                )}
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  {d.daThu ? "Đã thu — không cần hạn" : "Hẹn đóng"}
                </span>
                <input
                  type="date"
                  name={`dot-${i}-due`}
                  value={d.dueDate}
                  onChange={(e) => suaDot(i, { dueDate: e.target.value })}
                  disabled={d.daThu}
                  className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-sm disabled:bg-muted"
                />
              </label>
              {choKhaiDaThu && (
                <label className="flex items-center gap-1.5 self-center whitespace-nowrap text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={d.daThu}
                    onChange={(e) => suaDot(i, { daThu: e.target.checked })}
                    className="h-4 w-4"
                  />
                  đã thu
                </label>
              )}
            </div>
          ))}
        </div>

        {/* Tổng phải khớp — nói ra NGAY khi gõ, không đợi bấm Lưu rồi nhận toast. */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-xs ${
            lech === 0
              ? "bg-muted text-muted-foreground"
              : "bg-state-danger-soft text-state-danger-ink"
          }`}
        >
          <span className="whitespace-nowrap font-semibold tabular-nums">
            Tổng {dots[0]?.laCoc ? "cọc + " : ""}
            {soDotHocPhi} đợt: {vnd(tongCacDot)} / {vnd(totalAmount)}
          </span>
          {lech !== 0 && (
            <span className="whitespace-nowrap font-semibold tabular-nums">
              {lech > 0 ? "Thừa" : "Thiếu"} {vnd(Math.abs(lech))}
            </span>
          )}
        </div>

        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">
            Nhắc công nợ trước (ngày){" "}
            <HelpHint>
              Áp cho MỌI đợt chưa thu. Cron nhắc nợ nay quét mọi đợt chưa thu — trước đây
              nó lọc cứng đợt 2, nên kế hoạch 3-4 đợt thì đợt 3 và 4 không bao giờ được
              nhắc.
            </HelpHint>
          </span>
          <input
            type="number"
            min={0}
            value={dots.find((d) => !d.daThu)?.reminderDays ?? NGAY_NHAC_MAC_DINH}
            onChange={(e) => {
              const v = Math.max(0, Number(e.target.value) || 0);
              setDots((cu) => cu.map((d) => (d.daThu ? d : { ...d, reminderDays: v })));
            }}
            className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-sm tabular-nums"
          />
        </label>
      </fieldset>

      {/* Nút Lưu bị khoá thì PHẢI nói vì sao (luật 12 — affordance phải nói thật).
          Từ 14/09 mặc định của form không còn tự nhận "đã thu cả đơn", nên đơn chưa
          thu đồng nào mở lên là nút khoá NGAY từ đầu; trước đây `thieuHan` hầu như
          không bao giờ xảy ra lúc vừa mở nên không ai thấy khoảng lặng này. Toast
          trong `save()` không cứu được: nút disabled thì `onClick` không chạy.
          ĐẶT NGOÀI `fieldset`: lời giải thích không phải một ô nhập, và khi khối bị khoá
          thì nó là thứ duy nhất còn đáng đọc. */}
      {/* ⚠️ Câu này PHẢI đi theo `choKhaiDaThu`. Bản cũ dặn *"tích ô đã thu của đợt đó"*
          vô điều kiện; ở trang tạo đơn ô đó nay không còn, nên giữ nguyên câu là chỉ người
          dùng đi tìm một thứ không tồn tại — đúng loại lời hứa suông mà luật 12 nói tới,
          và nó không làm test nào đỏ, console vẫn sạch. */}
      {khoa == null && thieuHan >= 0 && (
        <p className="rounded-md bg-state-warning-soft px-3 py-2 text-xs font-semibold text-state-warning-ink">
          Đợt {thieuHan + 1} chưa thu — chọn ngày hẹn đóng để lưu được kế hoạch.
          {choKhaiDaThu
            ? " Nếu khách đã đóng rồi thì tích ô “đã thu” của đợt đó."
            : " Khách đã đóng trước rồi thì tạo đơn xong, mở trang đơn và khai ở đó — trang tạo đơn chỉ lập kế hoạch để xuất QR."}
        </p>
      )}
    </div>
  );
}
