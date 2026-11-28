// Gom bài tập về TỪNG BUỔI của cổng học viên — phần THUẦN, không DB.
//
// Vì sao tách ra: lỗi "giao 2 bài mà học viên chỉ thấy 1" nằm ở đúng phép gom này (bản cũ dùng
// `Map<buổi, MỘT bài>` và bỏ qua mọi bài sau bài đầu), mà nó nằm lẫn trong hàm đọc DB nên không có ca
// test nào chạm tới. Tách ra thì ghim được bằng test thuần.

export type BaiGomDuoc = { classSessionId: string | null; lessonId: string | null };

export type BaiTheoNoi<T extends BaiGomDuoc> = {
  theoBuoi: Map<string, T[]>;
  theoBai: Map<string, T[]>;
  /** Bài giáo viên giao mà không gắn buổi lẫn bài giáo trình — vẫn phải hiện, đừng nuốt. */
  khongGanBuoi: T[];
};

const them = <T>(m: Map<string, T[]>, k: string, a: T) => {
  const ds = m.get(k);
  if (ds) ds.push(a);
  else m.set(k, [a]);
};

/**
 * Ba đường nối bài ↔ buổi, chắc chắn giảm dần: gắn thẳng buổi (`classSessionId`) › gắn bài giáo trình
 * (`lessonId`) › không gắn. Mỗi đường giữ MẢNG bài theo thứ tự đầu vào.
 */
export function gomBaiTheoNoi<T extends BaiGomDuoc>(assignments: readonly T[]): BaiTheoNoi<T> {
  const theoBuoi = new Map<string, T[]>();
  const theoBai = new Map<string, T[]>();
  const khongGanBuoi: T[] = [];
  for (const a of assignments) {
    if (a.classSessionId) them(theoBuoi, a.classSessionId, a);
    else if (a.lessonId) them(theoBai, a.lessonId, a);
    else khongGanBuoi.push(a);
  }
  return { theoBuoi, theoBai, khongGanBuoi };
}

/** TẤT CẢ bài của một buổi: bài gắn thẳng buổi trước, rồi bài theo giáo trình của buổi đó. */
export function baiCuaMotBuoi<T extends BaiGomDuoc>(
  g: BaiTheoNoi<T>,
  buoiId: string,
  lessonId: string | null,
): T[] {
  return [...(g.theoBuoi.get(buoiId) ?? []), ...(lessonId ? (g.theoBai.get(lessonId) ?? []) : [])];
}
