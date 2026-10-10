"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";

// B3 — quản lý khảo sát. Gate parent-feedback:view (CSKH/quản lý).
// Cách ly cơ sở: Survey ∈ SCOPED_MODELS → đọc qua scopedDb (auto null-filter)
// + passesScope trước khi ghi; create chỉ cho gán centerId trong tầm nhìn actor.
//
// @deprecated FL4-03 — Survey/NPS đang được hợp nhất về EvalForm scope CENTER_SURVEY
// (engine 4 loại câu hỏi, quản lý ở /admin/evaluations). KHÔNG drop model/route (2-phase):
// các action dưới vẫn chạy để đọc + tắt khảo sát NPS cũ; ưu tiên tạo khảo sát mới qua EvalForm.

const MILESTONES = ["AFTER_TRIAL", "AFTER_3_SESSIONS", "MID_COURSE", "END_COURSE", "AFTER_COMPLAINT", "GENERAL"] as const;

const DEFAULT_NPS_QUESTION = "Anh/chị có sẵn sàng giới thiệu Sata Robo cho phụ huynh khác?";

const createSchema = z.object({
  title: z.string().trim().min(3, "Tiêu đề quá ngắn").max(200),
  milestone: z.enum(MILESTONES),
  centerId: z.string().trim().optional().or(z.literal("")),
  // P1-h — câu hỏi NPS (0-10) có thể tuỳ biến.
  questionText: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function createSurvey(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("parent-feedback:view"))) return { ok: false, error: "Không có quyền" };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  // Cách ly cơ sở: nếu gán Survey cho 1 cơ sở, cơ sở đó phải nằm trong tầm nhìn actor.
  const actor = await resolveActor(session.user.id);
  const centerId = d.centerId || null;
  if (centerId) {
    // GHI đối xứng ĐỌC (vá 24/07): scope per-model — role HO không có quyền
    // parent-feedback:/khao-sat: không được gán khảo sát cho cơ sở ngoài scope.
    if (!passesScope("Survey", { centerId }, actor)) {
      return { ok: false, error: "Không có quyền với cơ sở này" };
    }
  }

  // Write không bị scopedDb can thiệp (chỉ đọc bị scope) — sdb để sạch import db trần.
  await scopedDb(actor).survey.create({
    data: {
      title: d.title,
      milestone: d.milestone,
      centerId,
      createdById: session.user.id,
      questions: {
        create: {
          text: d.questionText?.trim() || DEFAULT_NPS_QUESTION,
          type: "NPS",
          order: 0,
        },
      },
    },
  });
  revalidatePath("/khao-sat");
  return { ok: true };
}

export async function toggleSurvey(id: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user || !(await checkPermission("parent-feedback:view"))) return { ok: false };
  // Cách ly cơ sở: chỉ thấy/sửa Survey thuộc tầm nhìn cơ sở của actor.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const s = await sdb.survey.findUnique({ where: { id }, select: { isActive: true, centerId: true } });
  if (!s || !passesScope("Survey", s, actor)) return { ok: false };
  await sdb.survey.update({ where: { id }, data: { isActive: !s.isActive } });
  revalidatePath("/khao-sat");
  return { ok: true };
}
