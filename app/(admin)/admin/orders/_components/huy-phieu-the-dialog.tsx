"use client";

// Nút "HUỶ PHIẾU THẺ" + hộp xác nhận hai bước (Việc 4 · 09/10/2026) — docs/pos-hai-nut-khai-may.md §6.
//
// Cảnh dùng: sale bấm nhầm "Thẻ POS", hoặc khách đổi sang chuyển khoản. Phiếu thẻ còn mở thì phiếu gộp KHÔNG huỷ được và đơn không
// phát được mã cho đợt khác (cổng Việc 1) — đây là lối thoát. Nhưng huỷ lúc khách ĐÃ quẹt chính là điều cổng ấy canh: sale phát mã mới /
// QR cho một khoản đã trả ⇒ đòi khách trả lần hai. Vì vậy:
//   · NÚT chỉ vẽ khi hàm thuần `choPhepHuyPhieuThe` nói huỷ được (`phieu.huyPhieuThe.huyDuoc`) VÀ hộp cho phép (`nutTrongHopPhieuThe` → `NUT`: phiếu còn chờ
//     quẹt, không ở cửa sổ "vừa gửi" — ghép Việc 3; VIỆC 6 · a2: SAU KHI KẾ TOÁN TỪ CHỐI nút VẪN vẽ khi cổng thường cho huỷ). Component KHÔNG tự viết điều kiện
//     (khuôn `nutThuThe` / `kenhCuaDong`) — hai nơi cùng quyết "huỷ được không" là hai nơi có ngày cãi nhau;
//   · không vẽ nút ⇒ MỘT dòng nói vì sao (`DongKhongHuyDuoc`) — luật 12: nút chắc chắn bị máy chủ từ chối là lời hứa suông;
//   · bấm ⇒ hộp xác nhận: nói hậu quả, bắt chọn lý do, và khi `canXacNhanManh` bắt TICK "chắc khách chưa quẹt". Cổng THẬT nằm ở máy chủ
//     (`huyPhieuTheAction` đọc lại mọi thứ dưới khoá) — màn chỉ làm cho sale khỏi bấm rồi ăn một câu từ chối.
//
// ⚠️ Form của hộp xác nhận sống trong `HopXacNhanHuy`, thành phần CHỈ MOUNT KHI MỞ: đóng là mất hết. Cố ý — cái tick "tôi chắc khách chưa
// quẹt" mà sống sót sang lần mở sau là một lời cam đoan cũ gắn vào một quyết định mới.
//
// ⚠️ `router.refresh()` KHÔNG reset `useState`. Cổng trang đã gỡ một câu sai khỏi hộp thẻ ở Việc 3 bằng đúng bài này: sau khi huỷ, câu
// "Chưa thấy giao dịch…" của lượt Kiểm tra TRƯỚC (`vuaKiem` ở hộp cha) sống sót và che câu "đã huỷ". `onBoKetQuaCu` gỡ nó — gọi ở MỌI
// kết cục máy chủ đã trả lời (thành công · từ chối · rớt kết nối), vì cả ba đều kèm một lần làm mới trang có thể đã đổi trạng thái.
//
// `admin-scope` trên `DialogContent`: hộp portal ra ngoài khung admin, thiếu class là nút lấy `--primary` CAM của :root (tiền lệ
// `hop-phieu-pos.tsx`, `nhap-file-pos.tsx`). Lưới `[HN4-UW4]`.

import { useId, useState, type TransitionStartFunction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Info, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { PhieuPosView, TheDangMo } from "@/lib/payments/pos/phieu-pos-luat";
import { cauKhongHuyDuoc } from "@/lib/payments/kenh-thu";
import {
  CAU_CHUA_CHON_LY_DO_HUY,
  CAU_XAC_NHAN_MANH_HUY_PHIEU_THE,
  GHI_CHU_HUY_TOI_DA,
  GHI_CHU_KHAC_TOI_THIEU,
  MA_LY_DO_HUY_PHIEU_THE,
  NHAN_LY_DO_HUY_PHIEU_THE,
  NHAN_NUT_HUY_PHIEU_THE,
  NHAN_NUT_XAC_NHAN_HUY_PHIEU_THE,
  NHAN_TICK_XAC_NHAN_MANH,
  cauDaHuyPhieuThe,
  cauHauQuaHuyPhieuThe,
  ghepCauTuChoiHuy,
  type MaLyDoHuyPhieuThe,
} from "@/lib/payments/pos/huy-phieu-the-cau";
import type { KetQuaHuyPhieuThe } from "@/lib/payments/pos/huy-phieu-the";
import { huyPhieuTheAction } from "../_actions";

// ── Chữ chỉ của giao diện (không đi qua máy chủ, nên không nằm ở `huy-phieu-the-cau.ts`) ────────────────────────────────────
const NHAN_KHONG_HUY = "Không huỷ";
const NHAN_DANG_HUY = "Đang huỷ…";
const CAU_THIEU_GHI_CHU_KHAC = `Ghi chú lý do “Khác” (ít nhất ${GHI_CHU_KHAC_TOI_THIEU} ký tự)`;
const CAU_THIEU_TICK = "Tick xác nhận khách chưa quẹt thẻ";
/** Rớt kết nối giữa chừng: yêu cầu CÓ THỂ đã tới máy chủ — nói thẳng là chưa rõ, rồi lấy sự thật từ trang mới. */
const CAU_MAT_KET_NOI_KHI_HUY =
  "Mất kết nối khi huỷ — chưa rõ phiếu thẻ đã huỷ chưa. Đã tải lại trạng thái phiếu; xem lại rồi mới thao tác tiếp.";

type FormHuy = { lyDo: MaLyDoHuyPhieuThe; ghiChu: string; daTick: boolean };

/**
 * `title` của nhãn chữ "Thẻ đang chờ" trên dòng đợt — dành cho NGƯỜI KHÔNG CÓ `payments:pos-check`, nên không bấm được gì ở đó: câu chỉ
 * nói nhờ ai và người có quyền làm được gì. `Record<TheDangMo, …>` ⇒ thêm một kiểu thẻ mở mà quên câu là `tsc` đỏ.
 *
 * Kiểu `DANG_CHO` lấy CHÍNH câu của panel QR (`cauKhongHuyDuoc`, ngữ cảnh "không có quyền") — một nguồn, không gõ lại. Bản cũ
 * ("…Nhờ người có quyền thu thẻ kiểm tra kết quả") chỉ đúng khi CHƯA có nút này: từ Việc 4 người có quyền còn huỷ được nếu khách chưa
 * quẹt. Hai kiểu còn lại GIỮ câu riêng — `CHUA_KET_LUAN` chỉ có việc kiểm tra (không huỷ được), và dùng câu của panel cho nó là hứa
 * "mở phiếu thẻ, bấm Kiểm tra" với người không mở được hộp (luật 12).
 */
export const TITLE_THE_DANG_CHO_CHI_BAO: Record<TheDangMo, string> = {
  DANG_CHO: cauKhongHuyDuoc("DANG_CHO", { duocThuThePos: false, phieuPos: null }),
  CHO_KE_TOAN: "Giao dịch thẻ của mã này còn chờ kế toán xử lý",
  CHUA_KET_LUAN: "Mã này đang mở cho thẻ — chưa huỷ được mã. Nhờ người có quyền thu thẻ kiểm tra kết quả",
};

// ─────────────────────────────────────────────────────────────────────────────
// 1 · MỘT DÒNG "CHƯA HUỶ ĐƯỢC" — chỗ của nút khi nút không được vẽ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phiếu thẻ còn chờ quẹt mà hàm thuần nói KHÔNG huỷ được ⇒ một dòng nói đúng cặp câu (lý do · việc nên làm) mà máy chủ cũng ném.
 * Người dùng khỏi phải hỏi "sao không có nút". "Có in dòng này không" do `nutTrongHopPhieuThe` quyết (`huyPhieuThe === "DONG_LY_DO"`), KHÔNG do
 * component này: phiếu ĐÃ ĐÓNG thì hộp đã tự kể trạng thái · vừa gửi / đã bị từ chối mà không huỷ được thì hộp đã có câu riêng nói đúng hơn — in thêm một câu
 * "chưa huỷ được" ở đó là nhiễu, hoặc là lệnh "ĐỪNG cho khách quẹt lại" thứ hai ngay dưới lệnh của kế toán (ghép Việc 3 × Việc 4, docs §7.8).
 */
export function DongKhongHuyDuoc({ huy, canh }: { huy: PhieuPosView["huyPhieuThe"]; canh: boolean }) {
  if (huy.huyDuoc) return null;
  // `canh` (BẮT BUỘC, luật 7 — `nutTrongHopPhieuThe().tienDangBay`): lý do này là DẤU HIỆU TIỀN ĐANG BAY (khách có thể đã bị trừ tiền) ⇒ khung cảnh báo `role="alert"`, chữ
  // 14px, KHÔNG tiền tố "Chưa huỷ được…" (câu đã tự nói "ĐỪNG cho khách quẹt lại"). Không phải thì giữ dòng xám 12px như cũ. Rà ghép 10/10/2026.
  if (canh) {
    return (
      <div
        role="alert"
        data-tien-dang-bay=""
        className="flex gap-2.5 rounded-lg border border-state-danger/30 bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0 leading-relaxed">{ghepCauTuChoiHuy(huy)}</p>
      </div>
    );
  }
  return (
    <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{`Chưa huỷ được phiếu thẻ: ${ghepCauTuChoiHuy(huy)}`}</span>
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · NÚT Ở FOOTER HỘP THẺ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nút "Huỷ phiếu thẻ" ở footer hộp thẻ. Trả `null` khi hàm thuần không cho huỷ — và lúc đó CẢ trạng thái mở/đóng của hộp xác nhận
 * mất theo (mount lại từ đầu khi được phép lại), nên một hộp xác nhận không thể tự bật lên vì props nhấp nháy.
 * Hộp ngoài cũng chỉ MOUNT component này khi `nutTrongHopPhieuThe` nói `NUT` (thêm ngoại lệ vừa gửi; VIỆC 6 · a2: sau từ chối là `NUT` khi cổng thường cho huỷ) — bảo vệ kép, không phải hai nguồn.
 *
 * `dangBan`: hộp đang Kiểm tra / Báo admin / Tạo phiếu — hai việc chạy chồng nhau trên MỘT phiếu thì kết cục khó đoán; khoá nút.
 * `dangChay` + `batDau`: transition của CHÍNH đường huỷ, do HỘP NGOÀI giữ (xem `HopPhieuPos`) để `dongDuoc` biết "đang huỷ" — nếu nằm trong nút thì hộp
 * ngoài đóng được ở cửa sổ giữa lúc hộp xác nhận đã đóng và lúc trang mới về (rà ghép 10/10/2026, docs §7.5-B mục 6).
 */
export function NutHuyPhieuThe({
  orderId,
  phieu,
  dangBan,
  dangChay,
  batDau,
  onBoKetQuaCu,
}: {
  orderId: string;
  phieu: PhieuPosView;
  dangBan: boolean;
  /** Lượt huỷ đang chạy (bao cả `router.refresh()`). BẮT BUỘC, không mặc định (luật 11): do hộp ngoài giữ. */
  dangChay: boolean;
  /** `startTransition` của lượt huỷ — cùng transition với `dangChay`. BẮT BUỘC, không mặc định (luật 11). */
  batDau: TransitionStartFunction;
  /** Bỏ câu của lượt Kiểm tra cũ khỏi state của hộp cha — xem đầu tệp. BẮT BUỘC, không mặc định (luật 11). */
  onBoKetQuaCu: () => void;
}) {
  const huy = phieu.huyPhieuThe;
  if (!huy.huyDuoc) return null;
  // `key` theo phiếu: đổi sang một phiếu KHÁC (trang trả phiếu mới) thì form + hộp xác nhận bắt đầu lại, không mang lý do cũ sang.
  return (
    <NutVaHop
      key={phieu.intentId}
      orderId={orderId}
      intentId={phieu.intentId}
      code5={phieu.code5}
      canXacNhanManh={huy.canXacNhanManh}
      dangBan={dangBan}
      dangChay={dangChay}
      batDau={batDau}
      onBoKetQuaCu={onBoKetQuaCu}
    />
  );
}

function NutVaHop({
  orderId,
  intentId,
  code5,
  canXacNhanManh,
  dangBan,
  dangChay,
  batDau,
  onBoKetQuaCu,
}: {
  orderId: string;
  intentId: string;
  code5: string;
  canXacNhanManh: boolean;
  dangBan: boolean;
  dangChay: boolean;
  batDau: TransitionStartFunction;
  onBoKetQuaCu: () => void;
}) {
  const router = useRouter();
  const [mo, datMo] = useState(false);
  // MỘT transition cho cả đường huỷ (do hộp ngoài giữ): nó bao luôn `router.refresh()`, nên nút còn quay cho tới khi trang mới về (lúc đó phiếu đã HUY,
  // hàm thuần không cho huỷ nữa và nút tự biến mất) — không có khoảng hở nào mà sale thấy một nút huỷ còn sáng cho phiếu đã huỷ.

  function xacNhan(f: FormHuy) {
    batDau(async () => {
      let res: KetQuaHuyPhieuThe | null;
      try {
        res = await huyPhieuTheAction({
          orderId,
          intentId,
          lyDo: f.lyDo,
          // Ghi chú trống ⇒ KHÔNG gửi khoá (không gửi chuỗi rỗng); có ⇒ gửi bản đã cắt khoảng trắng.
          ...(f.ghiChu ? { ghiChu: f.ghiChu } : {}),
          // ĐÃ TICK, không phải hằng. Máy chủ quyết có cần xác nhận mạnh hay không bằng `choPhepHuyPhieuThe` đọc LẠI dưới khoá —
          // cờ này chỉ nói "người bấm đã tick", nó không phải thứ để máy chủ tin mà bỏ qua cổng.
          xacNhanKhachChuaQuet: f.daTick,
        });
      } catch {
        res = null; // rớt kết nối: CHƯA RÕ yêu cầu đã tới máy chủ chưa
      }
      onBoKetQuaCu();
      // Mọi kết cục đều đóng hộp xác nhận và lấy sự thật từ trang mới — khuôn V24 của Việc 1 (`PhieuGopQr.ketThuc`): giữ hộp mở sau một
      // lời từ chối là mời bấm lại đúng câu chắc chắn bị từ chối; trang mới sẽ nói trạng thái thật (và nếu phiếu vẫn huỷ được thì
      // nút còn đó để mở lại).
      datMo(false);
      if (res === null) {
        toast.error(CAU_MAT_KET_NOI_KHI_HUY);
      } else if (res.ok) {
        toast.success(cauDaHuyPhieuThe(res.code5));
      } else {
        toast.error(res.error);
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={dangBan || dangChay}
        onClick={() => datMo(true)}
        // Bên trái, cách xa nút chính "Kiểm tra thanh toán" (từ `sm`): việc phá hủy không đứng cạnh việc hằng ngày.
        className="min-h-11 gap-2 sm:mr-auto sm:min-h-10"
      >
        {dangChay ? <Loader2 className="animate-spin" aria-hidden /> : <Ban aria-hidden />}
        {dangChay ? NHAN_DANG_HUY : NHAN_NUT_HUY_PHIEU_THE}
      </Button>
      {mo && (
        <HopXacNhanHuy
          code5={code5}
          canXacNhanManh={canXacNhanManh}
          dangChay={dangChay}
          onDong={() => datMo(false)}
          onXacNhan={xacNhan}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · HỘP XÁC NHẬN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Còn thiếu gì để bấm được "Xác nhận" — `null` = đủ. Thứ tự = thứ tự người dùng làm: lý do → ghi chú ("Khác") → tick.
 * MỘT hàm cho cả `disabled`, `title` và dòng nhắc, nên ba thứ không thể nói ba điều khác nhau.
 */
function conThieu(f: { lyDo: MaLyDoHuyPhieuThe | null; ghiChu: string; daTick: boolean }, canXacNhanManh: boolean): string | null {
  if (f.lyDo === null) return CAU_CHUA_CHON_LY_DO_HUY;
  if (f.lyDo === "KHAC" && f.ghiChu.trim().length < GHI_CHU_KHAC_TOI_THIEU) return CAU_THIEU_GHI_CHU_KHAC;
  if (canXacNhanManh && !f.daTick) return CAU_THIEU_TICK;
  return null;
}

function HopXacNhanHuy({
  code5,
  canXacNhanManh,
  dangChay,
  onDong,
  onXacNhan,
}: {
  code5: string;
  canXacNhanManh: boolean;
  dangChay: boolean;
  onDong: () => void;
  onXacNhan: (f: FormHuy) => void;
}) {
  const idGhiChu = useId();
  const idThieu = useId();
  const [lyDo, datLyDo] = useState<MaLyDoHuyPhieuThe | null>(null);
  const [ghiChu, datGhiChu] = useState("");
  const [daTick, datDaTick] = useState(false);

  const thieu = conThieu({ lyDo, ghiChu, daTick }, canXacNhanManh);
  const choXacNhan = thieu === null && !dangChay;
  const cauGhiChu = lyDo === "KHAC" ? "bắt buộc khi chọn “Khác”" : "không bắt buộc";

  function bam() {
    // Cổng thứ hai sau `disabled`: một lượt bấm đã đi (hoặc thiếu gì đó) thì KHÔNG gửi lần nữa.
    if (lyDo === null || thieu !== null || dangChay) return;
    onXacNhan({ lyDo, ghiChu: ghiChu.trim(), daTick });
  }

  return (
    <Dialog
      open
      // Đang chạy thì không đóng được (Esc · bấm ra ngoài): đóng giữa chừng là mất dấu một việc chưa biết kết cục.
      onOpenChange={(o) => {
        if (!o && !dangChay) onDong();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="admin-scope flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
          <DialogTitle className="text-base font-semibold">
            {NHAN_NUT_HUY_PHIEU_THE} mã <span className="font-mono tracking-wider">{code5}</span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{cauHauQuaHuyPhieuThe(code5)}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <fieldset disabled={dangChay} className="min-w-0">
            <legend className="mb-2 text-sm font-medium text-foreground">
              Lý do huỷ <span className="font-normal text-muted-foreground">— bắt buộc</span>
            </legend>
            <div className="grid gap-2">
              {MA_LY_DO_HUY_PHIEU_THE.map((ma) => (
                <label
                  key={ma}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
                    lyDo === ma ? "border-primary bg-primary-soft font-medium text-foreground" : "border-border hover:bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="ly-do-huy-phieu-the"
                    value={ma}
                    checked={lyDo === ma}
                    onChange={() => datLyDo(ma)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span>{NHAN_LY_DO_HUY_PHIEU_THE[ma]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={idGhiChu} className="text-sm font-medium text-foreground">
                Ghi chú <span className="font-normal text-muted-foreground">— {cauGhiChu}</span>
              </label>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {ghiChu.length}/{GHI_CHU_HUY_TOI_DA}
              </span>
            </div>
            <Textarea
              id={idGhiChu}
              rows={2}
              maxLength={GHI_CHU_HUY_TOI_DA}
              value={ghiChu}
              disabled={dangChay}
              aria-required={lyDo === "KHAC"}
              onChange={(e) => datGhiChu(e.target.value)}
              className="mt-1.5 min-h-14"
            />
          </div>

          {/* Không chứng minh được "khách chưa quẹt" (V4.3) ⇒ người bấm phải tự nhận. Câu là NGUYÊN VĂN chủ dự án. Đứng CUỐI, ngay
              trên nút xác nhận: việc cuối cùng trước khi bấm là đọc rủi ro. */}
          {canXacNhanManh && (
            <div className="rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
              <p className="flex gap-2 leading-relaxed">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{CAU_XAC_NHAN_MANH_HUY_PHIEU_THE}</span>
              </p>
              <label className="mt-1.5 flex min-h-11 cursor-pointer items-start gap-3 py-2 font-medium text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                <input
                  type="checkbox"
                  checked={daTick}
                  disabled={dangChay}
                  onChange={(e) => datDaTick(e.target.checked)}
                  className="mt-px size-5 shrink-0 accent-primary"
                />
                <span>{NHAN_TICK_XAC_NHAN_MANH}</span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 px-5 py-3">
          <Button type="button" variant="outline" disabled={dangChay} onClick={onDong} className="min-h-11 shrink-0 sm:min-h-10">
            {NHAN_KHONG_HUY}
          </Button>
          {/* Nút phá huỷ dùng mực nguy hiểm của admin (`state-danger-ink` + chữ trắng, đúng như `ConfirmDialog` dùng chung). KHÔNG dựa vào
              `variant="destructive"` trần: token `--destructive-foreground` không được khai trong globals.css nên chữ rơi về ĐEN trên nền
              đỏ (ảnh chụp harness 375px; tương phản tính ≈ 4,4:1, dưới ngưỡng AA 4,5:1) — nút nguy hiểm nhất của màn không được khó đọc. */}
          <Button
            type="button"
            variant="destructive"
            disabled={!choXacNhan}
            title={thieu ?? undefined}
            aria-describedby={thieu !== null && !dangChay ? idThieu : undefined}
            onClick={bam}
            className="min-h-11 shrink-0 gap-2 bg-state-danger-ink text-white hover:bg-state-danger-ink-hover sm:min-h-10"
          >
            {dangChay && <Loader2 className="animate-spin" aria-hidden />}
            {dangChay ? NHAN_DANG_HUY : NHAN_NUT_XAC_NHAN_HUY_PHIEU_THE}
          </Button>
          {/* Nút khoá thì `pointer-events-none` — `title` không bao giờ hiện trên máy chạm lẫn khi rê chuột. Nên nói thiếu gì NGAY
              TRÊN nút, bằng chữ (luật 12: nút khoá phải nói vì sao). Ở màn hẹp footer xếp ngược (nút chính trên cùng) nên dòng này
              đứng sau cùng trong DOM = nằm trên cùng trên màn. */}
          {thieu !== null && !dangChay && (
            <p id={idThieu} className="text-xs text-muted-foreground sm:order-first sm:min-w-0 sm:flex-1 sm:self-center">
              {thieu}
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
