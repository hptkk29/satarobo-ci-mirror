// Hàm thuần của trang Giới thiệu — tách khỏi component để test không cần dựng React.

/** "Cơ sở 1 - Nguyễn Hữu Thọ" → "Nguyễn Hữu Thọ" (artifact in "Sata Robo Nguyễn Hữu Thọ"). */
export function tenCoSoNgan(name: string): string {
  return name.replace(/^\s*Cơ sở\s*\d+\s*[-–—]\s*/i, "").trim();
}

/** Liên kết "Chỉ đường Google Maps" dựng từ địa chỉ THẬT của cơ sở (không gõ cứng URL). */
export function duongDanBanDo(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * "T2 - T7: 8:00 - 20:00" giữ nguyên; hàm chỉ chuẩn hoá khoảng trắng quanh dấu gạch để dòng giờ
 * đọc đều với artifact ("8:00 – 20:00"). Giờ lấy từ `lib/locations` — repo thắng artifact.
 */
export function gioMoCua(workingHours: string): string {
  return workingHours.replace(/\s*-\s*/g, " – ").replace(/\s+/g, " ").trim();
}

/** Mã cơ sở "CS1" → nhãn thẻ "Cơ sở 1". */
export function nhanCoSo(code: string): string {
  const so = /\d+/.exec(code)?.[0];
  return so ? `Cơ sở ${so}` : code;
}

/**
 * Ảnh + câu mô tả riêng của từng cơ sở trên trang Về chúng tôi / Liên hệ (artifact gắn cứng theo thứ tự).
 * Khoá = `Center.code`; cơ sở mới thêm vào `lib/locations` mà chưa khai ở đây thì không vẽ khung ảnh
 * (test `[PUB-D-04]` canh để không mất ảnh âm thầm).
 */
export const THONG_TIN_THEM_CO_SO: Readonly<Record<string, { anh: string; moTa?: string }>> = {
  CS1: { anh: "13da897c33250d37f7f5ee9047ef2b1b" },
  CS2: { anh: "c677879211312a5ef81bc9af29c69e92", moTa: "Ngay trung tâm quận Hải Châu, thuận tiện đưa đón." },
};
