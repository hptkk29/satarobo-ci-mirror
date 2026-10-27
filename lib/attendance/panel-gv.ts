// Phép tính THUẦN của bảng điểm danh site giáo viên — tách khỏi component để test được
// bất biến mà không cần dựng DOM.
//
// 🔴 G-29 (08/10/2026): em CHƯA TỚI LƯỢT (`chuaToiLuot` là chuỗi — mua ít buổi hơn cả
// khoá, buổi này nằm trước `buoiBatDau`) vẫn HIỆN tên trên bảng, nhưng server
// (`getSessionRosterStudentIds`) KHÔNG cho ghi điểm danh cho em. Bản cũ của panel đếm
// "chưa đánh dấu" trên MỌI hàng và đòi `unmarked === 0` mới cho lưu ⇒ lớp có một em chưa
// tới lượt thì giáo viên đánh dấu hết những em chấm được vẫn bị chặn ở "Còn 1 em chưa
// đánh dấu", mà em đó không có nút nào để bấm. Còn nếu ép được (nút "tất cả có mặt" gán
// cả em đó) thì server từ chối cả lô. Hai cổng đòi hai điều ngược nhau ⇒ KHÔNG lưu được.
//
// Luật: mọi phép đếm/gom bản ghi của panel chỉ nhìn các hàng CHẤM ĐƯỢC (`hangChamDuoc`).

export type DongBang = { studentId: string; chuaToiLuot: string | null };
export type OTrangThai<S extends string> = { status: S | null; note: string };

/** Hàng giáo viên được phép chấm = hàng KHÔNG mang lý do "chưa tới lượt". */
export function hangChamDuoc<T extends DongBang>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.chuaToiLuot === null);
}

/** Đếm theo nhãn + số em chấm được mà chưa bấm. Hàng chưa tới lượt KHÔNG vào phép đếm. */
export function demDiemDanh<S extends string, T extends DongBang>(
  rows: readonly T[],
  state: Readonly<Record<string, OTrangThai<S> | undefined>>,
  nhan: readonly S[],
): { counts: Record<S, number>; unmarked: number } {
  const counts = Object.fromEntries(nhan.map((k) => [k, 0])) as Record<S, number>;
  let unmarked = 0;
  for (const r of hangChamDuoc(rows)) {
    const st = state[r.studentId]?.status ?? null;
    if (st) counts[st] += 1;
    else unmarked += 1;
  }
  return { counts, unmarked };
}

/** Bản ghi gửi server: chỉ em chấm được VÀ đã có nhãn. */
export function gomBanGhi<S extends string, T extends DongBang>(
  rows: readonly T[],
  state: Readonly<Record<string, OTrangThai<S> | undefined>>,
): { studentId: string; status: S; note: string | null }[] {
  return hangChamDuoc(rows).flatMap((r) => {
    const cell = state[r.studentId];
    if (!cell?.status) return [];
    return [{ studentId: r.studentId, status: cell.status, note: cell.note?.trim() || null }];
  });
}
