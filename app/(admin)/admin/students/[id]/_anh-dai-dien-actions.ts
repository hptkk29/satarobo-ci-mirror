"use server";

// Ảnh đại diện học viên — LƯU/XOÁ đường dẫn ảnh trên hồ sơ (25/09/2026).
// Ảnh lên kho qua `POST /api/admin/students/anh-dai-dien` (trả `{ url }`); action này chỉ
// ghi `Student.avatarUrl`.
//
// ⚠️ 'use server' ⇒ CHỈ export hàm async.
//
// CỔNG ĐƯỜNG DẪN: chỉ nhận URL do CHÍNH route upload sinh ra — gốc công khai của kho R2 +
// `/uploads/students/<yyyy-mm>/<uuid>.<jpg|png|webp>`. Không nhận URL ngoài: ảnh đại diện
// hiện ở màn admin + portal phụ huynh, một URL tuỳ ý là ảnh theo dõi (tracking pixel) đọc
// được IP người xem, hoặc một ảnh không ai duyệt. Khuôn khoá ở đây phải khớp khoá đối
// tượng mà route dựng (`app/api/admin/students/anh-dai-dien/route.ts`) — đổi một bên thì
// đổi bên kia.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { getAuditActor, logStudentAudit } from "@/lib/audit/log";
import { getR2PublicUrl } from "@/lib/storage/r2-client";
// Luật URL dùng CHUNG với `createStudent` (form tạo gửi `avatarUrl` qua ô ẩn).
import { laUrlAnhHocVien } from "@/lib/students/anh-dai-dien-url";

export async function datAnhDaiDienHocVien(input: {
  studentId: string;
  url: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) {
    return { ok: false, error: "Bạn không có quyền sửa hồ sơ học viên" };
  }

  const parsed = z
    .object({
      studentId: z.string().trim().min(1).max(64),
      url: z.string().trim().max(500).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const { studentId } = parsed.data;
  const url = parsed.data.url || null;

  if (url) {
    let goc: string;
    try {
      goc = getR2PublicUrl();
    } catch {
      return {
        ok: false,
        error: "Kho ảnh (R2) chưa được cấu hình trên môi trường này — liên hệ quản trị.",
      };
    }
    if (!laUrlAnhHocVien(url, goc)) {
      return { ok: false, error: "Ảnh không hợp lệ — hãy tải ảnh lên bằng nút chọn ảnh." };
    }
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const hv = await sdb.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: { id: true, centerId: true, avatarUrl: true },
  });
  // `scopedDb` KHÔNG che đường GHI — tự hỏi tầm nhìn cơ sở trước khi ghi.
  if (!hv || !passesScope("Student", hv, actor)) {
    return { ok: false, error: "Không tìm thấy học viên" };
  }
  if (hv.avatarUrl === url) return { ok: true };

  const { actorId, actorName } = getAuditActor(session);
  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await tx.student.update({ where: { id: studentId }, data: { avatarUrl: url } });
      await logStudentAudit({
        studentId,
        action: "UPDATE",
        actorId,
        actorName,
        oldValues: { avatarUrl: hv.avatarUrl },
        newValues: { avatarUrl: url },
        changedFields: ["avatarUrl"],
        reason: url ? "Đổi ảnh đại diện" : "Xoá ảnh đại diện",
        tx,
      });
    });
  } catch {
    return { ok: false, error: "Không lưu được ảnh đại diện — lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}/edit`);
  return { ok: true };
}
