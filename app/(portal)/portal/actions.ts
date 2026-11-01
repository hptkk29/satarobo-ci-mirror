"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import {
  assertOwnsStudent,
  makeActiveSiteToken,
  ACTIVE_SITE_COOKIE,
} from "@/lib/portal/session";

// Server Action endpoint nhận payload bất kỳ từ client → validate runtime
// (không tin type tĩnh) trước khi đưa vào Prisma.
const studentIdSchema = z.string().min(1).max(64);

// Phase T2.2 — đổi "site con" đang xem. Verify ownership server-side trước khi
// ghi cookie đã ký.
export async function setActiveSite(
  studentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = studentIdSchema.safeParse(studentId);
  if (!parsed.success) {
    return { ok: false, error: "Học viên không hợp lệ" };
  }
  if (!(await assertOwnsStudent(parsed.data))) {
    return { ok: false, error: "Không có quyền chọn học viên này" };
  }

  (await cookies()).set(ACTIVE_SITE_COOKIE, makeActiveSiteToken(parsed.data), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return { ok: true };
}
