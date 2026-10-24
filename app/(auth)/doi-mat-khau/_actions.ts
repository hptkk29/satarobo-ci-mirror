"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { passwordResetSchema } from "@/lib/validators/user";
import { logUserAudit, getAuditActor } from "@/lib/audit/log";

// BGĐ 31/07 — user tự đổi mật khẩu ở trang bắt buộc /doi-mat-khau.
// KHÔNG bump tokenVersion (giữ phiên hiện tại — user vừa login bằng MK tạm).
export async function changeOwnPasswordAction(input: {
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = passwordResetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Mật khẩu không hợp lệ" };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, password: true, isActive: true, deletedAt: true },
  });
  if (!user || user.deletedAt || !user.isActive) {
    return { ok: false, error: "Tài khoản không hợp lệ" };
  }

  // Không cho đặt lại đúng mật khẩu tạm admin vừa cấp.
  if (user.password && (await bcrypt.compare(parsed.data.newPassword, user.password))) {
    return { ok: false, error: "Mật khẩu mới phải khác mật khẩu hiện tại" };
  }

  const hashed = await bcrypt.hash(parsed.data.newPassword, 10);
  const { actorId, actorName } = getAuditActor(session);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { password: hashed, mustChangePassword: false },
    });
    await logUserAudit({
      userId: user.id,
      action: "PASSWORD_CHANGE",
      actorId,
      actorName,
      // KHÔNG log giá trị — không leak hash.
      tx,
    });
  });

  // Cờ `mustChangePassword` là thứ MỌI layout gác cửa đọc (admin · giáo viên · sale),
  // nên đổi nó là đổi kết quả của mọi cây layout — dọn cache toàn bộ, không dọn một
  // đường. Đây cũng là thứ vô hiệu hoá Router Cache phía client, xem ghi chú ở
  // change-form.tsx.
  revalidatePath("/", "layout");

  return { ok: true };
}
