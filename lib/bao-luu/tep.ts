// lib/bao-luu/tep.ts — phần THUẦN của kho tệp bảo lưu: loại tệp, khoá, vân tay byte. Không R2, không DB.
// Phần chạm R2 ở `lib/bao-luu/kho-tep.ts`. Tách ra để test không cần R2 và để client import được kiểu.

export type LoaiTepBaoLuu = "pdf" | "jpg" | "png" | "webp";

/** Đơn quét (PDF/ảnh chụp) và minh chứng ốm đau (đơn thuốc, giấy ra viện: PDF/ảnh). */
export const LOAI_TEP_BAO_LUU: readonly LoaiTepBaoLuu[] = ["pdf", "jpg", "png", "webp"];

export const MIME_TEP_BAO_LUU: Record<LoaiTepBaoLuu, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Trần cỡ tệp: 10 MB — đơn quét một-hai trang. Lớn hơn thường là ảnh chụp chưa nén, bảo người dùng nén lại. */
export const TRAN_CO_TEP_BAO_LUU = 10 * 1024 * 1024;

/** Số minh chứng tối đa một hồ sơ — chặn đẩy cả album vào hồ sơ. */
export const TRAN_SO_MINH_CHUNG = 5;

/**
 * Hình dạng khoá DUY NHẤT hợp lệ: `bao-luu/<yyyy-mm>/<uuid-hex 8-32>.<loại>`. Khoá đi qua trình duyệt
 * (form gửi lại sau khi tải lên), nên mọi nơi NHẬN hoặc KÝ khoá đều phải hỏi regex này — không thì người
 * dùng nhét khoá của object khác (ảnh chat, hoá đơn…) vào hồ sơ rồi xin URL ký cho nó.
 */
export const KHOA_TEP_BAO_LUU_RE = /^bao-luu\/\d{4}-(0[1-9]|1[0-2])\/[a-f0-9]{8,32}\.(pdf|jpg|png|webp)$/;

export function laKhoaTepBaoLuu(khoa: unknown): khoa is string {
  return typeof khoa === "string" && khoa.length <= 80 && !khoa.includes("..") && KHOA_TEP_BAO_LUU_RE.test(khoa);
}

/** `bao-luu/2026-10/ab12cd34….pdf` — `thang` 1–12, `uuid` là hex (bỏ gạch). NÉM nếu thành phần sai. */
export function khoaTepBaoLuu(input: { nam: number; thang: number; uuid: string; loai: LoaiTepBaoLuu }): string {
  const { nam, thang, uuid, loai } = input;
  if (!Number.isInteger(nam) || nam < 2000 || nam > 2999) throw new Error("Khoá tệp bảo lưu: năm không hợp lệ");
  if (!Number.isInteger(thang) || thang < 1 || thang > 12) throw new Error("Khoá tệp bảo lưu: tháng không hợp lệ");
  const hex = uuid.replace(/-/g, "").toLowerCase();
  const khoa = `bao-luu/${nam}-${String(thang).padStart(2, "0")}/${hex.slice(0, 32)}.${loai}`;
  if (!laKhoaTepBaoLuu(khoa)) throw new Error("Khoá tệp bảo lưu: uuid không hợp lệ");
  return khoa;
}

/** Đuôi tên tệp → loại; `null` nếu không phải loại cho phép. Đuôi chỉ là GỢI Ý — vân tay mới là bằng chứng. */
export function loaiTuTenTep(tenTep: string, mime: string): LoaiTepBaoLuu | null {
  const duoi = /\.([a-z0-9]+)$/i.exec(tenTep.trim())?.[1]?.toLowerCase();
  const loai: LoaiTepBaoLuu | null =
    duoi === "pdf" ? "pdf" : duoi === "jpg" || duoi === "jpeg" ? "jpg" : duoi === "png" ? "png" : duoi === "webp" ? "webp" : null;
  if (!loai) return null;
  return MIME_TEP_BAO_LUU[loai] === mime.toLowerCase() ? loai : null;
}

/** Vân tay theo BYTE — tin nội dung, không tin đuôi hay mime trình duyệt khai. */
export function vanTayBaoLuu(loai: LoaiTepBaoLuu, dau: Uint8Array): boolean {
  const khop = (mau: readonly number[], lech = 0) => mau.every((b, i) => dau[lech + i] === b);
  switch (loai) {
    case "pdf":
      return khop([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "jpg":
      return khop([0xff, 0xd8, 0xff]);
    case "png":
      return khop([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "webp":
      return khop([0x52, 0x49, 0x46, 0x46]) && khop([0x57, 0x45, 0x42, 0x50], 8); // RIFF....WEBP
  }
}
