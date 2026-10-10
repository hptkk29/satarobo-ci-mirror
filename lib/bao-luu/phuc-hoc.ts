// lib/bao-luu/phuc-hoc.ts — CHỌN LỚP PHỤC HỌC (BR-21, BR-22, BR-24). THUẦN, không DB. PHIÊN 6.
//
//   · Bé dừng ở bài `dungOBai` ⇒ bài kế tiếp bé cần học là `dungOBai + 1`.
//   · Lớp ứng viên đang ở bài `baiHienTai` (bài của buổi sắp tới). Độ lệch = `baiHienTai − (dungOBai + 1)`.
//   · |lệch| ≤ `dungSai` (`pause.resumeLessonTolerance`, mặc định 2) mới phù hợp.
//   · Lớp ĐI SAU bé (lệch < 0)  ⇒ bé HỌC LẠI các bài `baiHienTai … dungOBai` (BR-22): KHÔNG sinh buổi bù.
//   · Lớp ĐI TRƯỚC bé (lệch > 0) ⇒ sinh buổi bù `nguon = PHUC_HOC` cho các bài `dungOBai+1 … baiHienTai−1`, KHÔNG trừ hạn mức học bù (BR-22).
//   · Lớp ĐỦ SĨ SỐ vẫn nhận (BR-21) — chỉ gắn cờ `daDay` để người xếp biết.
//
// Không có lớp nào phù hợp trong thời hạn ⇒ `PARENT` chuyển loại `CENTER` (BR-24) — quyết định "trong thời hạn" nằm ở cron/dịch vụ, không ở đây.

export type LopUngVien = {
  classId: string;
  ten: string;
  /** Bài của buổi SẮP TỚI của lớp (số thứ tự theo LỘ TRÌNH, không theo lịch). `null` = lớp chưa có buổi sắp tới hoặc không biết bài. */
  baiHienTai: number | null;
  siSo: number;
  toiDa: number;
};

export type HuongPhucHoc = "KHOP" | "HOC_LAI" | "BU";

export type LopPhucHoc = LopUngVien & {
  lech: number;
  huong: HuongPhucHoc;
  /** Bài bé phải học lại (huong = HOC_LAI): từ `baiHienTai` đến `dungOBai`. */
  hocLaiTu: number | null;
  hocLaiDen: number | null;
  /** Số buổi bù PHUC_HOC sẽ sinh (huong = BU). */
  soBuoiBu: number;
  daDay: boolean;
};

export function xepLopPhucHoc(p: { dungOBai: number; dungSai: number; lop: readonly LopUngVien[] }): LopPhucHoc[] {
  const baiKeTiep = p.dungOBai + 1;
  const ra: LopPhucHoc[] = [];
  for (const l of p.lop) {
    if (l.baiHienTai === null) continue; // không biết lớp đang ở bài nào ⇒ không đề xuất (không đoán)
    const lech = l.baiHienTai - baiKeTiep;
    if (Math.abs(lech) > p.dungSai) continue;
    const huong: HuongPhucHoc = lech === 0 ? "KHOP" : lech < 0 ? "HOC_LAI" : "BU";
    ra.push({
      ...l,
      lech,
      huong,
      hocLaiTu: huong === "HOC_LAI" ? l.baiHienTai : null,
      hocLaiDen: huong === "HOC_LAI" ? p.dungOBai : null,
      soBuoiBu: huong === "BU" ? lech : 0,
      daDay: l.siSo >= l.toiDa,
    });
  }
  // Khớp trước, rồi lệch ít trước, rồi lớp còn chỗ trước (đủ sĩ số vẫn nhận nhưng không ưu tiên).
  return ra.sort((a, b) => Math.abs(a.lech) - Math.abs(b.lech) || Number(a.daDay) - Number(b.daDay) || a.ten.localeCompare(b.ten, "vi"));
}
