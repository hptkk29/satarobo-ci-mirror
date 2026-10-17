/**
 * lib/classes/lui-bai.ts — "Nghỉ & lùi lịch" theo LỚP: LÙI NỘI DUNG BÀI một buổi (hàm THUẦN).
 *
 * Chủ dự án chốt 27/09/2026 (khi mở thao tác cho cả buổi ĐÃ QUA): các buổi sau ngày nghỉ
 * thường đã được điểm danh, và ngày điểm danh là sự thật ⇒ KHÔNG dời ngày. Thay vào đó NỘI
 * DUNG BÀI dịch lùi một buổi cho khớp thực tế lớp đã học:
 *   · buổi nghỉ → "Đã hủy" (nội dung bị gỡ ở tầng DB);
 *   · mỗi buổi sau (theo ngày, bỏ qua buổi đã huỷ) nhận nội dung của buổi trước nó;
 *   · nội dung của buổi cuối cùng sang một buổi MỚI thêm ở cuối khoá.
 * Ngày, điểm danh, nhận xét, ghi chú buổi, giáo viên/phòng thực dạy GIỮ NGUYÊN trên buổi.
 *
 * "Nội dung" = đúng năm cột mô tả BÀI: plan (lộ trình), lesson, tên, ghi chú bài, loại buổi.
 */
export type NoiDungBuoi = {
  planId: string | null;
  lessonId: string | null;
  topic: string | null;
  lessonNotes: string | null;
  sessionCategoryId: string | null;
};

export type BuoiLuiBai = {
  id: string;
  date: Date;
  /** Đã huỷ — đứng ngoài chuỗi. */
  huy: boolean;
  noiDung: NoiDungBuoi;
};

export type KeHoachLuiBai = {
  buoiNghiId: string;
  doiNoiDung: { id: string; noiDung: NoiDungBuoi }[];
  /** Nội dung cho buổi mới thêm ở cuối khoá. */
  noiDungBuoiMoi: NoiDungBuoi;
};

export function keHoachLuiBai(input: {
  /** MỌI buổi của lớp (thứ tự bất kỳ). */
  buoi: readonly BuoiLuiBai[];
  buoiNghiId: string;
}): KeHoachLuiBai {
  const song = input.buoi
    .filter((b) => !b.huy)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  const i0 = song.findIndex((b) => b.id === input.buoiNghiId);
  if (i0 < 0) throw new Error("Buổi nghỉ không có trong lớp hoặc đã huỷ.");

  const chuoi = song.slice(i0);
  const doiNoiDung = chuoi.slice(1).map((b, i) => ({ id: b.id, noiDung: chuoi[i]!.noiDung }));
  return {
    buoiNghiId: input.buoiNghiId,
    doiNoiDung,
    noiDungBuoiMoi: chuoi[chuoi.length - 1]!.noiDung,
  };
}
