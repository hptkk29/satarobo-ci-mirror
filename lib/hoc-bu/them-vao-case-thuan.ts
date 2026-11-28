// lib/hoc-bu/them-vao-case-thuan.ts — THUẦN (không DB): phép đếm bài khi THÊM học viên vào case đã tạo (20/10/2026).
//
// Hộp "Thêm học viên" cho chọn nhiều dòng cùng lúc; mỗi dòng vắng một bài. Dòng vắng bài case ĐÃ dạy thì không đổi bộ bài; dòng vắng bài MỚI thì kéo bài đó vào (hai dòng cùng bài mới chỉ
// kéo MỘT bài). Trần `TOI_DA_BAI_MOI_CASE` là phép tính TỔ HỢP nên không thể gắn vào từng dòng ở máy chủ — giao diện dùng đúng hai hàm này để khoá dòng sắp làm case vượt trần;
// máy chủ (`xepVaoCaseCoSan`) vẫn chặn lần cuối bằng `kiemBoBai`.
export type DongThem = { id: string; lessonId: string; trongBoBai: boolean };

/** Bài MỚI (case chưa dạy) mà các dòng đã chọn kéo vào, và tổng số bài của case sau khi thêm. */
export function tongBaiSauKhiThem(soBaiCase: number, dsChon: readonly DongThem[]): { baiMoi: string[]; tong: number } {
  const baiMoi = [...new Set(dsChon.filter((r) => !r.trongBoBai).map((r) => r.lessonId))];
  return { baiMoi, tong: soBaiCase + baiMoi.length };
}

/** Chọn THÊM dòng `r` (đang chưa chọn) có làm case vượt trần bài không. Dòng đã chọn luôn gỡ được; dòng vắng bài case đã dạy / bài mới đã được chọn thì không thêm bài nào. */
export function vuotTranNeuChon(p: { soBaiCase: number; tran: number; dsChon: readonly DongThem[]; r: DongThem }): boolean {
  if (p.dsChon.some((x) => x.id === p.r.id)) return false;
  if (p.r.trongBoBai) return false;
  const { baiMoi, tong } = tongBaiSauKhiThem(p.soBaiCase, p.dsChon);
  if (baiMoi.includes(p.r.lessonId)) return false;
  return tong + 1 > p.tran;
}
