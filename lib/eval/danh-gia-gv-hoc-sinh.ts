// lib/eval/danh-gia-gv-hoc-sinh.ts — V8.20: LÕI «học sinh đánh giá giáo viên» (một nguồn cho cổng web `/portal/danh-gia-gv` VÀ app di động `H-Danh-gia`).
// Tách NGUYÊN VĂN từ `app/(portal)/portal/danh-gia-gv/{page,_actions}.ts`: không đổi luật (đợt mở · eligibility tính lại lúc gửi · validate đáp án · chống trùng UNIQUE roundId+enrollmentId+teacherId).
// `pdb` = `portalDb({parentUserId, childIds})` (cách ly theo phụ huynh); `studentId` PHẢI đã được kiểm sở hữu bởi người gọi. OD-16: không ẩn danh (ghi `studentId`).
import { Prisma } from "@prisma/client";

import { getEligibleTeacherEvals } from "@/lib/eval/eligibility";
import { parseOptions, validateAnswers, type QuestionDef, type QuestionType } from "@/lib/eval/forms";
import { isRoundOpen } from "@/lib/eval/rounds";
import type { portalDb } from "@/lib/portal/db";

type Pdb = ReturnType<typeof portalDb>;

export type CauHoiDanhGia = { id: string; type: QuestionType; label: string; options: ReturnType<typeof parseOptions>; required: boolean };
export type KhoiDanhGia = {
  roundId: string;
  name: string;
  questions: CauHoiDanhGia[];
  pairs: Array<{ enrollmentId: string; teacherId: string; teacherName: string; className: string; role: string }>;
};

/** Các đợt ĐANG MỞ mà học sinh còn cặp (ghi danh × giáo viên) chưa đánh giá. */
export async function docCacDotDanhGia(pdb: Pdb, studentId: string): Promise<KhoiDanhGia[]> {
  const rounds = await pdb.evaluationRound.findMany({
    where: { scope: "TEACHER_EVAL", status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, opensAt: true, closesAt: true, centerId: true, courseId: true, form: { select: { questions: { orderBy: { order: "asc" } } } } },
  });
  const blocks: KhoiDanhGia[] = [];
  for (const r of rounds) {
    if (!isRoundOpen(r)) continue;
    const eligible = await getEligibleTeacherEvals(studentId, { scope: "TEACHER_EVAL", centerId: r.centerId, courseId: r.courseId });
    if (eligible.length === 0) continue;
    const existing = await pdb.evalResponse.findMany({ where: { roundId: r.id, studentId }, select: { enrollmentId: true, teacherId: true } });
    const done = new Set(existing.map((e) => `${e.enrollmentId}|${e.teacherId}`));
    const pairs = eligible.filter((e) => !done.has(`${e.enrollmentId}|${e.teacherId}`));
    if (pairs.length === 0) continue;
    const questions: CauHoiDanhGia[] = r.form.questions.map((q) => ({ id: q.id, type: q.type as QuestionType, label: q.label, options: parseOptions(q.options), required: q.required }));
    blocks.push({ roundId: r.id, name: r.name, questions, pairs });
  }
  return blocks;
}

export type DauVaoDanhGia = {
  roundId: string;
  enrollmentId: string;
  teacherId: string;
  answers: Array<{ questionId: string; valueNumber?: number | null; valueOptions?: string[] | null; valueText?: string | null }>;
};
export type KetQuaNopDanhGia =
  | { ok: true }
  | { ok: false; ma: "DOT_KHONG_HOP_LE" | "DOT_DA_DONG" | "KHONG_DUOC_DANH_GIA" | "DAP_AN_SAI" | "DA_DANH_GIA"; error: string };

export async function nopDanhGiaGiaoVien(pdb: Pdb, studentId: string, d: DauVaoDanhGia): Promise<KetQuaNopDanhGia> {
  const round = await pdb.evaluationRound.findUnique({
    where: { id: d.roundId },
    select: { scope: true, status: true, opensAt: true, closesAt: true, centerId: true, courseId: true, form: { select: { questions: { orderBy: { order: "asc" } } } } },
  });
  if (!round || round.scope !== "TEACHER_EVAL") return { ok: false, ma: "DOT_KHONG_HOP_LE", error: "Đợt không hợp lệ" };
  if (!isRoundOpen(round)) return { ok: false, ma: "DOT_DA_DONG", error: "Đợt đánh giá đã đóng hoặc chưa mở" };

  // Eligibility tính tại thời điểm submit (AC3) — phải thuộc danh sách GV đủ điều kiện.
  const eligible = await getEligibleTeacherEvals(studentId, { scope: "TEACHER_EVAL", centerId: round.centerId, courseId: round.courseId });
  if (!eligible.some((e) => e.enrollmentId === d.enrollmentId && e.teacherId === d.teacherId)) {
    return { ok: false, ma: "KHONG_DUOC_DANH_GIA", error: "Em không thể đánh giá giáo viên này trong đợt này" };
  }

  // Validate đáp án (required / sao 1–5 / checkbox-min / text ≤ 2000).
  const questions: QuestionDef[] = round.form.questions.map((q) => ({ id: q.id, type: q.type as QuestionType, label: q.label, options: parseOptions(q.options), required: q.required }));
  const v = validateAnswers(questions, d.answers);
  if (!v.ok) return { ok: false, ma: "DAP_AN_SAI", error: v.error };

  // Tạo response + answers; chống trùng qua UNIQUE (roundId, enrollmentId, teacherId).
  try {
    await pdb.evalResponse.create({
      data: {
        roundId: d.roundId,
        enrollmentId: d.enrollmentId,
        teacherId: d.teacherId,
        studentId,
        answers: { create: v.normalized.map((a) => ({ questionId: a.questionId, valueNumber: a.valueNumber, valueOptions: a.valueOptions ?? undefined, valueText: a.valueText })) },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, ma: "DA_DANH_GIA", error: "Em đã đánh giá giáo viên này trong đợt này rồi" };
    throw e;
  }
  return { ok: true };
}
