// app/(teacher)/teacher/hoc-bu/_actions.ts — Site GV: điểm danh buổi DẠY BÙ (docs/hoc-bu/DAC-TA.md).
//
// BẢO MẬT: (1) `makeup:attend` — GLOBAL cho vai Giáo viên. KHÔNG dùng `attendance:mark`: quyền
//     đó là phạm vi LỚP, gọi không target thì RBAC v2 trả false ⇒ không GV nào điểm danh được
//     (lưới `lib/auth/rbac-scope.test.ts` R1 bắt đúng lỗi này), mà case bù không có một lớp;
// (2) `diemDanhBu(..., { chiGiaoVien })` chốt "đúng giáo viên của case" ngay ở luật nghiệp vụ —
// GV khác, dù cùng cơ sở, không điểm danh được case không phải của mình.
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { LoiHocBu, diemDanhBu, beDeNhanXet } from "@/lib/hoc-bu/case-db";
import { guiBaiKiemTraBu } from "@/lib/hoc-bu/tai-lieu-bu";
import { saveSessionEvalChoHocBu } from "@/app/(admin)/admin/sessions/[id]/_feedback-core";
import type { PhieuNhanXetGui } from "@/app/(teacher)/teacher/lop/_components/student-eval-dialog";

const schema = z.object({
  caseId: z.string().min(1),
  caseStudentId: z.string().min(1),
  coMat: z.boolean(),
});

export async function diemDanhBuGvAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:attend"))) return { ok: false, error: "Bạn không có quyền điểm danh buổi dạy bù" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  try {
    await diemDanhBu(null, {
      caseStudentId: p.data.caseStudentId,
      coMat: p.data.coMat,
      chiGiaoVien: session.user.id,
    });
  } catch (e) {
    if (e instanceof LoiHocBu) return { ok: false, error: e.message };
    console.error("[teacher/hoc-bu]", e);
    return { ok: false, error: "Chưa lưu được — thử lại sau ít phút" };
  }
  revalidatePath(`/teacher/hoc-bu/${p.data.caseId}`);
  revalidatePath("/teacher/lich");
  return { ok: true };
}

/** GV nhận xét bé ở buổi bù của CHÍNH MÌNH — ghi vào buổi vắng gốc như nhập ở buổi chính. */
export async function nhanXetBuGvAction(
  p: PhieuNhanXetGui & { caseId: string; caseStudentId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:attend"))) return { ok: false, error: "Bạn không có quyền nhận xét buổi dạy bù" };
  try {
    const dich = await beDeNhanXet(null, { caseStudentId: p.caseStudentId, chiGiaoVien: session.user.id });
    const kq = await saveSessionEvalChoHocBu(
      { id: session.user.id, role: session.user.role, centerId: session.user.centerId },
      { sessionId: dich.missedSessionId, studentId: dich.studentId, projectName: p.projectName, notes: p.notes, rubric: p.rubric },
      { guiEmailPhuHuynh: true },
    );
    if (!kq.ok) return { ok: false, error: kq.error ?? "Không lưu được nhận xét" };
  } catch (e) {
    if (e instanceof LoiHocBu) return { ok: false, error: e.message };
    console.error("[teacher/hoc-bu] nhận xét", e);
    return { ok: false, error: "Chưa lưu được — thử lại sau ít phút" };
  }
  revalidatePath(`/teacher/hoc-bu/${p.caseId}`);
  return { ok: true };
}

/** GV gửi bài kiểm tra bù (đề của đúng bài) cho các bé có mặt ở buổi bù của CHÍNH MÌNH. */
export async function guiBaiKiemTraBuGvAction(p: {
  caseId: string;
  examId: string;
}): Promise<{ ok: true; soBe: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:attend"))) return { ok: false, error: "Bạn không có quyền gửi bài buổi dạy bù" };
  try {
    const r = await guiBaiKiemTraBu({ caseId: p.caseId, examId: p.examId, byUserId: session.user.id, chiGiaoVien: session.user.id, now: new Date() });
    revalidatePath(`/teacher/hoc-bu/${p.caseId}`);
    return { ok: true, soBe: r.soBe };
  } catch (e) {
    if (e instanceof LoiHocBu) return { ok: false, error: e.message };
    console.error("[teacher/hoc-bu] gửi bài", e);
    return { ok: false, error: "Chưa gửi được — thử lại sau ít phút" };
  }
}
