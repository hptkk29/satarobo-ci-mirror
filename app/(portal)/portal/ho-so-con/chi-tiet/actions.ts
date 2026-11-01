"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireActiveStudent, assertOwnsStudent } from "@/lib/portal/session";
import { updateChildDetail } from "@/lib/portal/child-detail";
import { setMediaConsent } from "@/lib/lms/media-consent";

// Portal v2 — phụ huynh sửa hồ sơ CON ĐANG CHỌN (requireActiveStudent đã verify quyền
// sở hữu). Chỉ cho sửa trường "mềm" — mã HV / lớp / khoá do admin quản lý (chỉ xem).
const schema = z.object({
  dateOfBirth: z.string().trim().optional().default(""),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).nullish(),
  currentGrade: z.coerce.number().int().min(1).max(12).nullish(),
  school: z.string().trim().max(160).optional().default(""),
  healthNotes: z.string().trim().max(1000).optional().default(""),
  allergies: z.array(z.string().trim()).optional().default([]),
  // `notes` (Student.notes) CỐ Ý không nhận từ portal — xem khối chú thích đầu
  // lib/portal/child-detail.ts. Zod mặc định bỏ khoá lạ nên client cũ gửi kèm cũng vô hại.
});

export async function updateChildProfile(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { studentId } = await requireActiveStudent();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const d = parsed.data;
  const nz = (s: string) => (s.length ? s : null);

  let dob: Date | null = null;
  if (d.dateOfBirth) {
    const t = new Date(d.dateOfBirth);
    if (Number.isNaN(t.getTime()))
      return { ok: false, error: "Ngày sinh không hợp lệ" };
    dob = t;
  }

  await updateChildDetail(studentId, {
    dateOfBirth: dob,
    gender: d.gender ?? null,
    currentGrade: d.currentGrade ?? null,
    school: nz(d.school),
    healthNotes: nz(d.healthNotes),
    allergies: d.allergies.filter((a) => a.length > 0),
  });

  revalidatePath("/portal/ho-so-con/chi-tiet");
  revalidatePath("/portal/ho-so-con");
  return { ok: true };
}

// #08 (L7) — PH tự bật/thu hồi đồng ý dùng hình ảnh cho TỪNG con. studentId đi qua
// body Server Action (KHÔNG lộ trên URL — PHƯƠNG ÁN A) + assertOwnsStudent chống set
// nhầm con nhà khác. setMediaConsent tự ghi AuditLog (ai – lúc nào – GRANTED/REVOKED).
const consentSchema = z.object({
  studentId: z.string().min(1),
  grant: z.boolean(),
});

export async function setMediaConsentAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") {
    return { ok: false, error: "Chưa đăng nhập" };
  }

  const parsed = consentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const { studentId, grant } = parsed.data;

  // Ownership: chỉ cho PH đổi consent con CỦA MÌNH (chống IDOR).
  if (!(await assertOwnsStudent(studentId))) {
    return { ok: false, error: "Không có quyền" };
  }

  await setMediaConsent(studentId, grant, {
    actor: {
      id: session.user.id,
      name: session.user.name ?? session.user.email ?? "Phụ huynh",
    },
    source: "PORTAL_SELF_SERVICE",
  });

  revalidatePath("/portal/ho-so-con/chi-tiet");
  revalidatePath("/portal/ho-so-con");
  revalidatePath("/portal/hinh-anh");
  return { ok: true };
}
