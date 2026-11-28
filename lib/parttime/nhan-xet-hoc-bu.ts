// lib/parttime/nhan-xet-hoc-bu.ts — NHẬN XÉT của một case dạy bù, quy về từng BÉ (THUẦN). Dùng chung cho P5c (`docNhanXet`) và tuân thủ
// buổi dạy (`tuan-thu-buoi-db.ts`) để hai nơi không đọc hai nguồn.
//
// Nguồn (T07, 10/10/2026): phiếu nhận xét học bù nằm ở MỤC của case (`MakeupCaseStudent` — một mục = một bài vắng cần bù):
// `teacherEvaluation` · `evaluationRubric` · `evaluatedById` · `evaluatedAt`. KHÔNG ở `StudentSessionFeedback` của buổi gốc (bản P5c đầu
// đọc chỗ đó ⇒ case đã nhận xét đủ vẫn ra MISSING). Mục có kết quả COMPLETED / NOT_COMPLETED = bé ĐÃ CÓ MẶT ở buổi bù (điểm danh hai tầng),
// nên mục đó cần phiếu; mục PLANNED (chưa điểm danh) / RELEASED (vắng, bị gỡ) thì không.
//
// Đơn vị đếm là BÉ (khớp lớp thường: "nhận xét x/y học viên"): bé xong khi MỌI mục cần phiếu của bé có phiếu. Mốc hoàn tất của bé =
// `evaluatedAt` MUỘN NHẤT trong các mục đó. ⚠️ `evaluatedAt` bị GHI ĐÈ mỗi lần sửa phiếu ⇒ là "mốc ghi cuối", không phải "lần đầu"
// (21-TEACHING-SESSION-COMPLIANCE.md §2 / §8).
import type { Prisma } from "@prisma/client";
import { phieuCoNoiDung } from "@/lib/hoc-bu/phieu-co-noi-dung";

export const KET_QUA_MUC_CO_MAT = ["COMPLETED", "NOT_COMPLETED"] as const;
const CO_MAT = new Set<string>(KET_QUA_MUC_CO_MAT);

export type MucNhanXetBu = {
  studentId: string;
  result: string;
  teacherEvaluation: string | null;
  evaluationRubric: unknown;
  evaluatedById: string | null;
  evaluatedAt: Date | null;
};

export type NhanXetBuTheoBe = {
  /** Bé có ≥ 1 mục cần phiếu (đã có mặt). */
  coMat: string[];
  /** Bé đã có phiếu cho MỌI mục cần phiếu — `createdAt` = mốc ghi cuối muộn nhất; `tacGia` = null khi các mục do NHIỀU người ghi. */
  nhanXet: { studentId: string; createdAt: Date; tacGia: string | null }[];
};

export function nhanXetHocBuTheoBe(muc: readonly MucNhanXetBu[]): NhanXetBuTheoBe {
  const theoBe = new Map<string, MucNhanXetBu[]>();
  for (const m of muc) {
    if (!CO_MAT.has(m.result)) continue;
    const ds = theoBe.get(m.studentId) ?? [];
    ds.push(m);
    theoBe.set(m.studentId, ds);
  }
  const nhanXet: NhanXetBuTheoBe["nhanXet"] = [];
  for (const [studentId, ds] of theoBe) {
    if (!ds.every((m) => phieuCoNoiDung(m) && m.evaluatedAt != null)) continue;
    const tacGia = new Set(ds.map((m) => m.evaluatedById));
    nhanXet.push({
      studentId,
      createdAt: new Date(Math.max(...ds.map((m) => (m.evaluatedAt as Date).getTime()))),
      tacGia: tacGia.size === 1 ? [...tacGia][0] : null,
    });
  }
  return { coMat: [...theoBe.keys()], nhanXet };
}

/** Cột của mục học bù cần cho nhận xét — dùng chung cho P5c và tuân thủ buổi dạy. */
export const CHON_MUC_NHAN_XET_BU = {
  caseId: true,
  result: true,
  teacherEvaluation: true,
  evaluationRubric: true,
  evaluatedById: true,
  evaluatedAt: true,
  makeupNeed: { select: { studentId: true } },
} satisfies Prisma.MakeupCaseStudentSelect;

export const mucNhanXetBu = (m: Prisma.MakeupCaseStudentGetPayload<{ select: typeof CHON_MUC_NHAN_XET_BU }>): MucNhanXetBu => ({
  studentId: m.makeupNeed.studentId,
  result: m.result,
  teacherEvaluation: m.teacherEvaluation,
  evaluationRubric: m.evaluationRubric,
  evaluatedById: m.evaluatedById,
  evaluatedAt: m.evaluatedAt,
});
