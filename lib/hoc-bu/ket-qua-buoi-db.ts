// lib/hoc-bu/ket-qua-buoi-db.ts — ĐỌC kết quả học bù của các buổi gốc (T08). Vỏ DB mỏng của `ket-qua-buoi.ts`; mọi luật ở hàm thuần.
//
// MỘT lượt truy vấn cho cả lô cặp (buổi, học viên) — không N+1 (màn điểm danh cả lớp / hồ sơ cả khoá gọi một lần). Đọc đi từ DÒNG CẦN BÙ
// (`MakeupNeed`, unique (học viên, buổi gốc)) chứ không từ bản ghi điểm danh: dòng từ chuyển đổi đơn / tạo tay không có điểm danh gốc mà vẫn phải đọc được.
//
// `nguon` là `db` trần HOẶC `scopedDb(actor)`: `MakeupNeed` thuộc `SCOPED_MODELS` nên người cấp cơ sở chỉ thấy dòng của cơ sở mình; mục + case của dòng
// đi theo quan hệ (include lồng không bị scope lại — dòng đã qua cổng). Site GV đọc trần (cùng lý do site GV điểm danh ở case cơ sở khác — bản vá 68f9b0c5).
import "server-only";
import type { Prisma } from "@prisma/client";
import { dungKetQuaBuoi, khoaCapBuoi, type DongDoc, type KetQuaBuoi } from "@/lib/hoc-bu/ket-qua-buoi";

type Nguon = { makeupNeed: Pick<Prisma.TransactionClient["makeupNeed"], "findMany"> };

const CHON = {
  id: true,
  studentId: true,
  missedSessionId: true,
  status: true,
  waivedAt: true,
  makeupSessionId: true,
  caseStudents: {
    select: {
      id: true,
      result: true,
      status: true,
      lessonId: true,
      teacherEvaluation: true,
      evaluationRubric: true,
      completedAt: true,
      createdAt: true,
      case: { select: { id: true, status: true, date: true, startTime: true, endTime: true, teacherId: true, roomId: true, centerId: true } },
    },
  },
} satisfies Prisma.MakeupNeedSelect;

/**
 * Kết quả học bù của từng cặp (buổi gốc, học viên). Map có ĐỦ khoá cho mọi cặp được hỏi (cặp không có dòng cần bù ⇒ `KHONG_CAN_BU`), nên chỗ gọi
 * không phải phân biệt "thiếu khoá" với "không cần bù".
 */
export async function docKetQuaBuoi(
  nguon: Nguon,
  cap: readonly { sessionId: string; studentId: string }[],
): Promise<Map<string, KetQuaBuoi>> {
  const ra = new Map<string, KetQuaBuoi>();
  const duy = [...new Map(cap.map((c) => [khoaCapBuoi(c.sessionId, c.studentId), c])).values()];
  if (duy.length === 0) return ra;

  const dong = await nguon.makeupNeed.findMany({
    where: { missedSessionId: { in: [...new Set(duy.map((c) => c.sessionId))] }, studentId: { in: [...new Set(duy.map((c) => c.studentId))] } },
    select: CHON,
  });
  const theoCap = new Map<string, DongDoc>();
  for (const d of dong) {
    theoCap.set(khoaCapBuoi(d.missedSessionId, d.studentId), {
      id: d.id,
      studentId: d.studentId,
      missedSessionId: d.missedSessionId,
      status: d.status,
      waivedAt: d.waivedAt,
      makeupSessionId: d.makeupSessionId,
      muc: d.caseStudents.map((m) => ({
        id: m.id,
        result: m.result,
        status: m.status,
        lessonId: m.lessonId,
        teacherEvaluation: m.teacherEvaluation,
        evaluationRubric: m.evaluationRubric,
        completedAt: m.completedAt,
        createdAt: m.createdAt,
        case: m.case,
      })),
    });
  }
  for (const c of duy) {
    const k = khoaCapBuoi(c.sessionId, c.studentId);
    ra.set(k, dungKetQuaBuoi({ sessionId: c.sessionId, studentId: c.studentId, dong: theoCap.get(k) ?? null }));
  }
  return ra;
}
