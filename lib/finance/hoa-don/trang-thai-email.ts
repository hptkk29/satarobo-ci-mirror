// lib/finance/hoa-don/trang-thai-email.ts — TRẠNG THÁI EMAIL của một hoá đơn đã xác nhận. THUẦN.
//
// Tách khỏi `khoi-hoa-don-don.ts` (GĐ 8 bước 11): màn kế toán (`dong-hang-cho.ts`) nay cũng cần đọc
// trạng thái email để vẽ nút "Gửi lại email", mà `khoi-hoa-don-don.ts` đã import `dong-hang-cho.ts` —
// để nguyên chỗ cũ là vòng import (depcruise `no-circular` bắt cả vòng CHỈ-KIỂU). Hai tệp cũ re-export.
//
// MỘT định nghĩa "lượt gửi còn đang chạy" (`luotDangChay`) cho cả nhãn trạng thái lẫn cổng gửi lại —
// lưới `[TTE-02]` ghim hai bên nói cùng một điều: nhãn in "đang gửi" mà nút lại cho gửi lại (hoặc
// ngược lại) là lời hứa suông của một trong hai (luật 12).

import { maskEmail } from "@/lib/utils";

export type ToneDong = "success" | "warning" | "danger" | "info" | "muted";

export type LuotGuiVao = {
  lanGui: number;
  toi: string;
  trangThai: "CHO" | "DANG_GUI" | "DA_GUI" | "LOI";
  loi: string | null;
  emailQueueId: string | null;
  updatedAt: Date;
};

export type HangDoiVao = {
  id: string;
  status: string;
  sentAt: Date | null;
  attempts: number;
  maxAttempts: number;
};

export type EmailKhoi = {
  loai: "BO_TICK" | "KHONG_CO_EMAIL" | "CHUA_GUI" | "CHO_GUI" | "DANG_GUI" | "DA_GUI" | "LOI";
  nhan: string;
  tone: ToneDong;
  /** Văn bản lỗi của nhà cung cấp — CHỈ khi có quyền xem PII (có thể chứa địa chỉ email). */
  chiTiet: string | null;
};

/** So email không phân biệt hoa/thường + khoảng trắng; rỗng ⇒ `null`. */
export const chuanEmail = (s: string | null | undefined): string | null => (s ?? "").trim().toLowerCase() || null;

const ddmmyyyy = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

/** Giờ VN (UTC+7, không giờ mùa hè) — tính ở server, không đọc múi giờ máy. */
export function lucVn(d: Date): string {
  const v = new Date(d.getTime() + 7 * 3600_000);
  const hh = String(v.getUTCHours()).padStart(2, "0");
  const mm = String(v.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} ${ddmmyyyy(v)}`;
}

/**
 * Lượt gửi còn ĐANG CHẠY không — gửi lại lúc này là gửi đôi. Đọc CẢ lượt gửi lẫn dòng hàng đợi (cùng
 * luật `trangThaiEmailHoaDon`): hàng đợi đã kết thúc (SENT / FAILED) thì lượt coi như xong, kể cả khi
 * lượt gửi chưa kịp ghi kết quả (đường "thiếu nội dung" cũ để hai bảng lệch nhau).
 */
export function luotDangChay(luot: Pick<LuotGuiVao, "trangThai">, hangDoi: Pick<HangDoiVao, "status"> | null): boolean {
  if (hangDoi?.status === "SENT" || hangDoi?.status === "FAILED") return false;
  return luot.trangThai === "CHO" || luot.trangThai === "DANG_GUI";
}

/**
 * Trạng thái email của MỘT hoá đơn — chỉ bản ĐÃ XÁC NHẬN mới có. Đọc CẢ lượt gửi lẫn dòng hàng đợi:
 * có đường làm hai bảng lệch nhau (worker đặt FAILED vì thiếu nội dung mà không cập nhật lượt gửi),
 * nên "đã gửi" / "lỗi" lấy bên nào nói trước.
 *
 * @param coNutTai dòng này CÓ nút tải không. Không có thì câu dặn KHÔNG được bảo "tải về" (luật 12) —
 *   bắt buộc truyền, không mặc định: mặc định `true` là hứa một nút không tồn tại.
 */
export function trangThaiEmailHoaDon(
  hd: { trangThai: string; guiEmailKhach: boolean; emailNhan: string | null },
  luot: LuotGuiVao | null,
  hangDoi: HangDoiVao | null,
  xemPii: boolean,
  coNutTai: boolean,
): EmailKhoi | null {
  if (hd.trangThai !== "DA_XAC_NHAN") return null;
  const dan = coNutTai ? "tải về gửi qua Zalo" : "nhờ kế toán gửi bản cho khách";
  if (!luot) {
    if (!hd.guiEmailKhach) {
      return { loai: "BO_TICK", nhan: "Không gửi email — kế toán ghi khách đã nhận hoá đơn ngoài hệ thống", tone: "muted", chiTiet: null };
    }
    if (!hd.emailNhan) {
      return { loai: "KHONG_CO_EMAIL", nhan: `Khách không có email — ${dan}`, tone: "warning", chiTiet: null };
    }
    return { loai: "CHUA_GUI", nhan: `Chưa có lượt gửi email — ${dan}`, tone: "warning", chiTiet: null };
  }
  const toi = xemPii ? luot.toi : maskEmail(luot.toi);
  if (hangDoi?.status === "SENT" || luot.trangThai === "DA_GUI") {
    const luc = hangDoi?.sentAt ?? luot.updatedAt;
    return { loai: "DA_GUI", nhan: `Đã gửi tới ${toi} lúc ${lucVn(luc)}`, tone: "success", chiTiet: null };
  }
  if (hangDoi?.status === "FAILED" || luot.trangThai === "LOI") {
    return {
      loai: "LOI",
      nhan: `Gửi email tới ${toi} không được — ${dan}`,
      tone: "danger",
      chiTiet: xemPii ? luot.loi : null,
    };
  }
  if (luot.trangThai === "CHO") {
    return { loai: "CHO_GUI", nhan: `Đang chờ gửi tới ${toi}`, tone: "info", chiTiet: null };
  }
  const thuLai = hangDoi && hangDoi.attempts > 0 ? ` (đang thử lại lần ${hangDoi.attempts + 1}/${hangDoi.maxAttempts})` : "";
  return { loai: "DANG_GUI", nhan: `Đang gửi tới ${toi}${thuLai}`, tone: "info", chiTiet: null };
}
