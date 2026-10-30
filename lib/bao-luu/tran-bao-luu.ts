// lib/bao-luu/tran-bao-luu.ts — TRẦN thời hạn một lượt bảo lưu. THUẦN. PHIÊN 1.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ (đo ở Phiên 0)
//
// `enrollment.suspendMaxMonths` (mặc định 6) chỉ được kiểm ở đường duyệt yêu cầu phụ huynh
// (`validateReserveDuration` trong `lib/students/reserve-service.ts`) — mà đường đó KHÔNG có
// nơi gọi ngoài test. Đường thật là `reserveStudentAction` (màn quản trị) thì KHÔNG kiểm gì,
// trong khi màn Cấu hình vận hành lại hứa *"Xin bảo lưu dài hơn mức này sẽ bị từ chối khi nhập"*.
// Lời hứa suông (luật 12). Hàm này là phép kiểm CHO ĐƯỜNG THẬT.
//
// ⚠️ ĐẾM THEO THÁNG LỊCH, không theo "30 ngày": người dùng chọn "22/03" cho một lượt bắt đầu
// 22/09 và gọi đó là 6 tháng. Đếm 30 ngày/tháng (như `monthsBetween` của đường cũ) cho ra
// 181 ngày > 180 và từ chối đúng cái ngày hợp lệ nhất. BR-10 cũng nói "ngày bắt đầu + maxMonths".
// `validateReserveDuration` của đường cũ GIỮ NGUYÊN (còn test R6 ghim nó, và đường đó sẽ được
// viết lại ở Phiên 3) — đừng sửa nó ở đây.
//
// ⚠️ Ngày quay lại KHÔNG BẮT BUỘC (BR-12): `null` là hợp lệ. Hạn tiêu chuẩn khi đó là
// `hanToiDaBaoLuu` — nhưng việc ghi nó xuống hồ sơ thuộc Phiên 2/3, không phải phiên này.
//
// ⚠️ Mọi phép so là NGÀY LỊCH VN (`vnParts`/`vnStartOfDay`), không giờ máy: Vercel/VPS chạy UTC.
import { vnDateAt, vnParts, vnStartOfDay } from "@/lib/time/vn";

export type KetQuaTran =
  | { ok: true }
  | { ok: false; code: "VALIDATION" | "RESERVE_TOO_LONG"; message: string };

/**
 * Ngày cuối cùng được phép quay lại: ngày bắt đầu (lịch VN) + `maxMonths` THÁNG LỊCH, trả về
 * 00:00 giờ VN. Ngày không tồn tại ở tháng đích thì kẹp về ngày cuối tháng (31/08 + 6 tháng ⇒ 28/02).
 */
export function hanToiDaBaoLuu(startedAt: Date, maxMonths: number): Date {
  const p = vnParts(startedAt);
  const chiSo = p.month + maxMonths;
  const nam = p.year + Math.floor(chiSo / 12);
  const thang = ((chiSo % 12) + 12) % 12;
  const ngayCuoiThang = new Date(Date.UTC(nam, thang + 1, 0)).getUTCDate();
  return vnDateAt(nam, thang, Math.min(p.day, ngayCuoiThang));
}

/**
 * Form lập hồ sơ: ngày quay lại dự kiến (`yyyy-MM-dd`) có VƯỢT hạn tối đa (`yyyy-MM-dd`) không — cùng phép so với `kiemTranBaoLuu`
 * (`ngày quay lại > hạn`, chạm trần đúng ngày vẫn hợp lệ). Chuỗi `yyyy-MM-dd` so đúng theo thứ tự chữ. Chỉ để form biết lúc nào
 * hiện ô "lý do vượt trần"; server vẫn kiểm bằng `kiemTranBaoLuu`.
 */
export function ngayQuayLaiVuotTran(quayLaiYmd: string, hanToiDaYmd: string): boolean {
  return quayLaiYmd !== "" && quayLaiYmd > hanToiDaYmd;
}

function dinhDangNgay(d: Date): string {
  const p = vnParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}/${p.year}`;
}

export function kiemTranBaoLuu(input: {
  startedAt: Date;
  expectedEndAt: Date | null;
  maxMonths: number;
}): KetQuaTran {
  if (input.expectedEndAt === null) return { ok: true };
  if (Number.isNaN(input.expectedEndAt.getTime())) {
    return { ok: false, code: "VALIDATION", message: "Ngày quay lại không hợp lệ" };
  }
  const ngayQuayLai = vnStartOfDay(input.expectedEndAt).getTime();
  if (ngayQuayLai <= vnStartOfDay(input.startedAt).getTime()) {
    return { ok: false, code: "VALIDATION", message: "Ngày quay lại phải sau ngày bắt đầu" };
  }
  const han = hanToiDaBaoLuu(input.startedAt, input.maxMonths);
  if (ngayQuayLai > han.getTime()) {
    return {
      ok: false,
      code: "RESERVE_TOO_LONG",
      message: `Bảo lưu tối đa ${input.maxMonths} tháng (đến ${dinhDangNgay(han)}).`,
    };
  }
  return { ok: true };
}
