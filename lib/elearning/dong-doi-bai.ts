/**
 * B-11 — DÒNG DÕI BÀI GỐC / BẢN TÁCH trong các màn quản trị liệt kê bài (báo cáo xem video…).
 *
 * Sao chép-khi-ghi sinh ra MỘT dòng `TrnLesson` mới cho mỗi lần tách bản, cùng chương, cùng tên với bài gốc. Liệt kê chúng theo tên thuần thì người xem thấy
 * hai nút trùng tên mà không biết cái nào là bài người học đang xem, cái nào là bản nháp. Hàm này CHỈ nhóm + gắn nhãn (đưa bản tách ngay dưới bài gốc);
 * KHÔNG cộng gộp dữ liệu giữa hai bài — tiến độ/phiên xem gắn với từng `lessonId` và hai nội dung là hai thứ khác nhau (xem DECISIONS D-18b).
 */
export type BaiDeNhomDongDoi = {
  id: string;
  title: string;
  forkedFromLessonId: string | null;
  /** Trạng thái các PHIÊN BẢN đang chứa bài này (`DRAFT`, `PENDING_REVIEW`, `APPROVED`, `PUBLISHED`, `ARCHIVED`…). Rỗng = chưa nằm trong bản nào. */
  trangThaiBan: readonly string[];
};

export type BaiDaGanNhan = { id: string; nhan: string; laBanTach: boolean };

function moTaBanTach(trangThai: readonly string[]): string {
  if (trangThai.includes("PUBLISHED")) return "đang phát hành";
  if (trangThai.length > 0 && trangThai.every((t) => t === "DRAFT")) return "bản nháp";
  if (trangThai.length > 0) return "đã khoá, chưa phát hành";
  return "chưa vào bản nào";
}

export function nhomDongDoiBai(bai: readonly BaiDeNhomDongDoi[]): BaiDaGanNhan[] {
  const trongDs = new Set(bai.map((b) => b.id));
  const conCua = new Map<string, BaiDeNhomDongDoi[]>();
  const goc: BaiDeNhomDongDoi[] = [];
  for (const b of bai) {
    if (b.forkedFromLessonId && trongDs.has(b.forkedFromLessonId) && b.forkedFromLessonId !== b.id) {
      conCua.set(b.forkedFromLessonId, [...(conCua.get(b.forkedFromLessonId) ?? []), b]);
    } else goc.push(b);
  }
  const theoTen = (x: BaiDeNhomDongDoi, y: BaiDeNhomDongDoi) => x.title.localeCompare(y.title, "vi") || x.id.localeCompare(y.id);
  const ra: BaiDaGanNhan[] = [];
  const di = (b: BaiDeNhomDongDoi, laBanTach: boolean, daDi: Set<string>) => {
    if (daDi.has(b.id)) return; // phòng vòng dõi hỏng (dữ liệu bẩn) — không lặp vô hạn
    daDi.add(b.id);
    const con = (conCua.get(b.id) ?? []).sort(theoTen);
    const nhan = laBanTach ? `${b.title} — bản tách (${moTaBanTach(b.trangThaiBan)})` : con.length > 0 ? `${b.title} — bài gốc` : b.title;
    ra.push({ id: b.id, nhan, laBanTach });
    for (const c of con) di(c, true, daDi);
  };
  const daDi = new Set<string>();
  for (const b of [...goc].sort(theoTen)) di(b, b.forkedFromLessonId !== null, daDi);
  // Bài nằm trong vòng dõi hỏng (không ai là gốc) vẫn phải hiện ra, không biến mất khỏi danh sách.
  for (const b of bai) if (!daDi.has(b.id)) di(b, true, daDi);
  return ra;
}
