// Phần THUẦN của màn nộp bài tập: dòng "Tiến trình" 3 bước, thẻ kết quả, thẻ điểm từng tiêu chí. Không import React/DB.
//
// ⚠️ Chỉ vẽ thứ DỮ LIỆU CÓ. Chưa có cột "bắt đầu chấm" nên KHÔNG có bước "đã có người mở chấm"; chưa có phân công người chấm trước
// khi chấm nên bước "đang chờ chấm" KHÔNG ghi tên ai. Tên người chấm chỉ có SAU khi chấm (`gradedByUserId`).

export type LuotRut = {
  status: string;
  submittedAt: Date | null;
  dueGradeAt: Date | null;
  gradedAt: Date | null;
  nguoiCham: string | null;
  score: number | null;
  passed: boolean | null;
};

export type BuocTienTrinh = { id: "nop" | "cho-cham" | "co-diem"; nhan: string; chiTiet: string | null; xong: boolean; hienTai: boolean };

const ngayGio = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}, ${p.hour}:${p.minute}`;
};
const ngay = (d: Date) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

/**
 * "Đã nộp → Đang chờ chấm → Có điểm". Trạng thái lượt:
 *  · SUBMITTED ⇒ bước 2 là hiện tại (kèm hạn chấm nếu có);
 *  · GRADED / NEEDS_REVISION ⇒ cả ba xong; bước 3 ghi người chấm + lúc chấm khi biết (trả về sửa thì nhãn là "Đã chấm — trả về sửa");
 *  · DRAFT/lạ ⇒ chỉ bước 1 chưa xong (không bịa tiến trình).
 */
export function buocTienTrinh(g: LuotRut): BuocTienTrinh[] {
  const daNop = g.status === "SUBMITTED" || g.status === "GRADED" || g.status === "NEEDS_REVISION";
  const daCham = g.status === "GRADED" || g.status === "NEEDS_REVISION";
  const traVe = g.status === "NEEDS_REVISION";
  return [
    { id: "nop", nhan: "Đã nộp", chiTiet: g.submittedAt ? ngayGio(g.submittedAt) : null, xong: daNop, hienTai: !daNop },
    {
      id: "cho-cham",
      nhan: "Đang chờ chấm",
      chiTiet: g.status === "SUBMITTED" && g.dueGradeAt ? `Hạn chấm ${ngay(g.dueGradeAt)}` : null,
      xong: daCham,
      hienTai: g.status === "SUBMITTED",
    },
    {
      id: "co-diem",
      nhan: traVe ? "Đã chấm — trả về để sửa" : "Có điểm",
      chiTiet: daCham ? [g.nguoiCham ? `Người chấm: ${g.nguoiCham}` : null, g.gradedAt ? ngayGio(g.gradedAt) : null].filter(Boolean).join(" · ") || null : null,
      xong: daCham,
      hienTai: false,
    },
  ];
}

/** Dòng tóm tắt kết quả cuối: "Đạt 10/12" / "Chưa đạt 4/12". `null` khi chưa có điểm CUỐI (nộp chờ chấm, hoặc trả về sửa). */
export function tomTatKetQua(g: Pick<LuotRut, "status" | "score" | "passed">, tongDiem: number): string | null {
  if (g.status !== "GRADED" || g.score == null) return null;
  return `${g.passed ? "Đạt" : "Chưa đạt"} ${g.score}/${tongDiem}`;
}

/** Điểm một tiêu chí dạng "2/4". `toiDa` null (không đọc được các mức) ⇒ chỉ in điểm, không bịa mẫu số. */
export function diemTieuChiGon(points: number, toiDa: number | null): string {
  return toiDa == null ? String(points) : `${points}/${toiDa}`;
}
