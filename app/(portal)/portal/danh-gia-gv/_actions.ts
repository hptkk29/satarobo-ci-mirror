"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { portalDb } from "@/lib/portal/db";
import { requireActiveStudent } from "@/lib/portal/session";
import { isEvalV2Enabled } from "@/lib/flags";
import { nopDanhGiaGiaoVien } from "@/lib/eval/danh-gia-gv-hoc-sinh";

const submitSchema = z.object({
  roundId: z.string().min(1),
  enrollmentId: z.string().min(1),
  teacherId: z.string().min(1),
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      valueNumber: z.number().int().nullable().optional(),
      valueOptions: z.array(z.string()).nullable().optional(),
      valueText: z.string().nullable().optional(),
    }),
  ),
});

type Res = { ok: true } | { ok: false; error: string };

export async function submitTeacherEval(input: unknown): Promise<Res> {
  if (!isEvalV2Enabled()) return { ok: false, error: "Tính năng chưa được mở" };

  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const { ctx, studentId } = await requireActiveStudent({ choHocSinh: true });
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  // V8.20: lõi dùng chung với app di động (`lib/eval/danh-gia-gv-hoc-sinh.ts`) — cùng luật, cùng thông báo.
  const kq = await nopDanhGiaGiaoVien(pdb, studentId, parsed.data);
  if (!kq.ok) return { ok: false, error: kq.error };

  revalidatePath("/portal/danh-gia-gv");
  return { ok: true };
}
