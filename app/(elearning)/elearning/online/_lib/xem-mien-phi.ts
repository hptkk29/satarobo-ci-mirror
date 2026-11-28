/**
 * QoChuong — "Xem miễn phí: N bài đầu tiên". Hàm THUẦN: nhận bố cục hiện tại + N, trả danh sách bài cần đổi cờ `freePreview`
 * (chỉ bài đang lệch — không ghi lại bài đã đúng). Màn gọi `suaBaiAction` cho từng bài trả về; không có đường ghi nào khác.
 *
 * Luật:
 * - Chỉ bài ĐỦ ĐIỀU KIỆN mới tính vào N: không phải bài kiểm tra / thi cuối khoá, không ẩn, nằm trong chương không ẩn.
 *   (Cờ miễn phí chỉ có nghĩa với nội dung học; đề kiểm tra và thi cuối khoá không bao giờ cho xem thử.)
 * - N bài đủ điều kiện đầu tiên (theo thứ tự chương, rồi bài) ⇒ miễn phí; MỌI bài đủ điều kiện còn lại ⇒ không miễn phí.
 * - Bài không đủ điều kiện KHÔNG bị chạm tới (người soạn có thể đã đặt tay).
 */
export type BaiXemMienPhi = { id: string; kind: string; hidden: boolean; freePreview: boolean };
export type ChuongXemMienPhi = { hidden: boolean; lessons: BaiXemMienPhi[] };

const LOAI_KHONG_XEM_THU: readonly string[] = ["QUIZ", "FINAL_EXAM"];

export const duDieuKienXemMienPhi = (c: ChuongXemMienPhi, b: BaiXemMienPhi) => !c.hidden && !b.hidden && !LOAI_KHONG_XEM_THU.includes(b.kind);

export function soBaiDuDieuKienXemMienPhi(chuong: ChuongXemMienPhi[]): number {
  return chuong.reduce((n, c) => n + c.lessons.filter((b) => duDieuKienXemMienPhi(c, b)).length, 0);
}

export function keHoachXemMienPhi(chuong: ChuongXemMienPhi[], n: number): { lessonId: string; freePreview: boolean }[] {
  const dem = Math.max(0, Math.floor(n));
  const doi: { lessonId: string; freePreview: boolean }[] = [];
  let k = 0;
  for (const c of chuong) {
    for (const b of c.lessons) {
      if (!duDieuKienXemMienPhi(c, b)) continue;
      const muon = k < dem;
      k += 1;
      if (b.freePreview !== muon) doi.push({ lessonId: b.id, freePreview: muon });
    }
  }
  return doi;
}

/** Nhãn "1.1, 1.2, 2.1" của các bài đang miễn phí (vị trí = chương.bài, đếm cả bài ẩn/đề cho khớp số hiển thị ở danh sách). */
export function nhanBaiDangMienPhi(chuong: ChuongXemMienPhi[]): string[] {
  const ra: string[] = [];
  chuong.forEach((c, ci) => c.lessons.forEach((b, bi) => b.freePreview && ra.push(`${ci + 1}.${bi + 1}`)));
  return ra;
}

/**
 * Giá trị mặc định của ô "N bài đầu tiên": số bài đủ điều kiện miễn phí LIÊN TIẾP từ đầu. Miễn phí rời rạc (ví dụ chỉ bài 2.2) ⇒ 0 —
 * ô không được nói "1 bài đầu tiên" khi bài đầu tiên thật sự chưa miễn phí.
 */
export function soBaiDauDangMienPhi(chuong: ChuongXemMienPhi[]): number {
  let n = 0;
  for (const c of chuong) {
    for (const b of c.lessons) {
      if (!duDieuKienXemMienPhi(c, b)) continue;
      if (!b.freePreview) return n;
      n += 1;
    }
  }
  return n;
}
