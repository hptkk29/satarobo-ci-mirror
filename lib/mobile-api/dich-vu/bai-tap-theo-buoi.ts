import { db } from "@/lib/db";
import { soBuoiTheoLich } from "@/lib/lms/session-order";

import type { MaHocVienDaKiem } from "../so-huu";
import { batNeuTat, dieuKienDe, duocXemDiem, lopCuaHocVien, type NguCanhHocTap } from "./hoc-tap";

/**
 * HL-BT-Bo / HL-BT-Lam / HL-BT-Xong / PL-BT-KQ (BR-OFF-BT-01, phần ĐỌC) — «Bộ bài tập buổi N»: danh sách bài tập về nhà ĐÃ GIAO THEO BUỔI cho CHÍNH học viên này,
 * kèm số lượt đã làm, lượt tối đa, ĐIỂM CAO NHẤT và lần gần nhất. Dựng từ DỮ LIỆU CÓ SẴN của web: `HomeworkAssignment` (R7-14: tự giao khi «Hoàn tất buổi», 1 bản ghi / buổi × đề × học viên)
 * + `Exam`/`ExamAttempt` (cùng điều kiện xem đề `dieuKienDe` và cùng luật hiện điểm `duocXemDiem` như `layDanhSachBaiThi`). KHÔNG có bảng/engine/lượt thi thứ hai: «Làm bài» = route lượt thi
 * sẵn có (`learning/exams/:examId/attempts`), «Xong» = `learning/attempts/:id/result`. Lượt tối đa lấy theo `Exam.maxAttempts` (giới hạn trần 20 như danh sách đề) — «làm không giới hạn» của thiết kế
 * chỉ đạt được bằng cách Đào tạo đặt `maxAttempts` cao ở đề; mã không tự nới.
 * KHÔNG tính/cộng SataCoin theo số câu đúng ở đây: quy tắc thưởng chưa được chốt (xem docs/mobile-integration/OFFLINE-BT-THEO-BUOI-V823.md) — DTO không có trường coin.
 * Điểm cao nhất chỉ hiện khi `duocXemDiem` (phụ huynh theo setting `homework.showScoreToParent`; phiên chế độ học sinh luôn thấy) VÀ đề cho xem kết quả sau khi nộp (`showResultAfterSubmit`) VÀ lượt đã CHẤM.
 */
export type TrangThaiGiao = "DA_GIAO" | "DA_NOP" | "DA_CHAM" | "BO_LO";
export type BaiTapTheoBuoiDto = {
  giaoId: string;
  buoiId: string;
  soBuoi: number | null;
  ngayBuoi: string;
  chuDeBuoi: string | null;
  deId: string;
  tieuDe: string;
  soCau: number;
  tongDiem: number;
  hanNop: string | null;
  trangThaiGiao: TrangThaiGiao;
  soLuotToiDa: number;
  soLuotDaDung: number;
  diemCaoNhat: number | null;
  lanGanNhat: { luotId: string; trangThai: "DANG_LAM" | "CHO_CHAM" | "DA_CHAM"; diem: number | null } | null;
};

const TRANG_THAI_GIAO: Record<string, TrangThaiGiao> = { ASSIGNED: "DA_GIAO", SUBMITTED: "DA_NOP", GRADED: "DA_CHAM", MISSED: "BO_LO" };
const LUOT: Record<string, "DANG_LAM" | "CHO_CHAM" | "DA_CHAM"> = { IN_PROGRESS: "DANG_LAM", SUBMITTED: "CHO_CHAM", GRADED: "DA_CHAM", REVIEWED: "DA_CHAM" };

/** Phần THUẦN: điểm cao nhất trong các lượt ĐÃ CHẤM (null khi không được hiện hoặc chưa có lượt chấm). */
export function diemCaoNhat(luot: ReadonlyArray<{ status: string; totalScore: number | null }>, duocHien: boolean): number | null {
  if (!duocHien) return null;
  const diem = luot.filter((l) => (LUOT[l.status] ?? "DANG_LAM") === "DA_CHAM" && l.totalScore !== null).map((l) => l.totalScore as number);
  return diem.length ? Math.max(...diem) : null;
}

export async function layBaiTapTheoBuoi(hs: MaHocVienDaKiem, ctx: NguCanhHocTap): Promise<{ muc: BaiTapTheoBuoiDto[] }> {
  batNeuTat();
  const giao = await db.homeworkAssignment.findMany({
    where: { studentId: hs },
    select: { id: true, classSessionId: true, examId: true, dueAt: true, status: true, assignedAt: true },
    orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
    take: 200,
  });
  if (giao.length === 0) return { muc: [] };
  const lop = await lopCuaHocVien(hs);
  const hienDiem = await duocXemDiem(ctx.laHocSinh);
  const dieuKien = await dieuKienDe(hs, lop);
  const deIds = [...new Set(giao.map((g) => g.examId))];
  const de = await db.exam.findMany({
    where: { AND: [dieuKien, { id: { in: deIds } }] },
    select: {
      id: true,
      title: true,
      maxAttempts: true,
      showResultAfterSubmit: true,
      totalPoints: true,
      _count: { select: { examQuestions: true } },
      attempts: { where: { studentId: hs }, select: { id: true, status: true, totalScore: true }, orderBy: { attemptNo: "desc" } },
    },
  });
  const deTheoId = new Map(de.map((e) => [e.id, e]));
  const buoiIds = [...new Set(giao.map((g) => g.classSessionId))];
  const buoi = await db.classSession.findMany({ where: { id: { in: buoiIds } }, select: { id: true, classId: true, date: true, topic: true } });
  const lopIds = [...new Set(buoi.map((b) => b.classId))];
  const tatCaBuoi = lopIds.length ? await db.classSession.findMany({ where: { classId: { in: lopIds } }, select: { id: true, classId: true, date: true } }) : [];
  const soBuoi = soBuoiTheoLich(tatCaBuoi);
  const buoiTheoId = new Map(buoi.map((b) => [b.id, b]));
  const muc: BaiTapTheoBuoiDto[] = [];
  for (const g of giao) {
    const e = deTheoId.get(g.examId); // đề không còn xem được (chưa công bố / ngoài lớp) ⇒ không hiện — cùng luật với danh sách đề
    const b = buoiTheoId.get(g.classSessionId);
    if (!e || !b) continue;
    const gan = e.attempts[0];
    const ttGan = gan ? (LUOT[gan.status] ?? "DANG_LAM") : null;
    const duocHien = hienDiem && e.showResultAfterSubmit;
    muc.push({
      giaoId: g.id,
      buoiId: b.id,
      soBuoi: soBuoi.get(b.id) ?? null,
      ngayBuoi: b.date.toISOString(),
      chuDeBuoi: b.topic ?? null,
      deId: e.id,
      tieuDe: e.title,
      soCau: e._count.examQuestions,
      tongDiem: e.totalPoints,
      hanNop: g.dueAt?.toISOString() ?? null,
      trangThaiGiao: TRANG_THAI_GIAO[g.status] ?? "DA_GIAO",
      soLuotToiDa: Math.min(20, Math.max(1, e.maxAttempts ?? 1)),
      soLuotDaDung: e.attempts.length,
      diemCaoNhat: diemCaoNhat(e.attempts, duocHien),
      lanGanNhat: gan && ttGan ? { luotId: gan.id, trangThai: ttGan, diem: ttGan === "DA_CHAM" && duocHien ? gan.totalScore : null } : null,
    });
  }
  muc.sort((x, y) => (y.soBuoi ?? 0) - (x.soBuoi ?? 0) || x.giaoId.localeCompare(y.giaoId));
  return { muc };
}
