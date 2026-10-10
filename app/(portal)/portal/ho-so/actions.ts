"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { portalDb } from "@/lib/portal/db";
import { canonicalPhone } from "@/lib/phone";
import {
  requestParentPhoneChange,
  confirmParentPhoneChange,
} from "@/lib/parents/phone-change";

// =============================================================================
// PORTAL PROFILE — Phase NHÓM 3
// Phụ huynh tự sửa tên hiển thị + đổi mật khẩu. Không bump tokenVersion để
// không tự đăng xuất giữa chừng.
// =============================================================================

async function requireParent() {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") return null;
  return session.user;
}

const nameSchema = z.string().trim().min(2, "Tên quá ngắn").max(120);

export async function updateParentName(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireParent();
  if (!user) return { ok: false, error: "Chưa đăng nhập" };
  const pdb = portalDb({ parentUserId: user.id, childIds: [] });

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Tên không hợp lệ",
    };
  }

  await pdb.user.update({
    where: { id: user.id },
    data: { name: parsed.data },
  });
  revalidatePath("/portal/ho-so");
  revalidatePath("/portal");
  return { ok: true };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Nhập mật khẩu hiện tại"),
    newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Xác nhận mật khẩu không khớp",
    path: ["confirmPassword"],
  });

export async function changeParentPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireParent();
  if (!user) return { ok: false, error: "Chưa đăng nhập" };
  const pdb = portalDb({ parentUserId: user.id, childIds: [] });

  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  const row = await pdb.user.findUnique({
    where: { id: user.id },
    select: { password: true },
  });
  if (!row?.password) return { ok: false, error: "Tài khoản không hợp lệ" };

  const valid = await bcrypt.compare(parsed.data.currentPassword, row.password);
  if (!valid) return { ok: false, error: "Mật khẩu hiện tại không đúng" };

  const hashed = await bcrypt.hash(parsed.data.newPassword, 10);
  // tokenVersion++ đá MỌI phiên (kể cả phiên hiện tại — client đưa qua /dang-xuat
  // để dọn cookie sạch sẽ rồi đăng nhập lại). Thiếu dòng này thì "đổi mật khẩu để
  // đuổi kẻ đang chiếm tài khoản" là lời hứa suông: JWT cũ sống tới 30 ngày
  // (đúng bài học của /quen-mat-khau P6-A — portal layout đã kiểm liveness).
  await pdb.user.update({
    where: { id: user.id },
    data: { password: hashed, tokenVersion: { increment: 1 } },
  });
  return { ok: true };
}

// Portal v2 — lưu hồ sơ gia đình: tên + địa chỉ (User) + SĐT/PH thứ hai (denormalized
// trên tất cả Student của phụ huynh này). Email = định danh đăng nhập, KHÔNG sửa ở đây.
const profileSchema = z.object({
  name: z.string().trim().min(2, "Tên quá ngắn").max(120),
  /** @deprecated P6 — bỏ qua: SĐT đăng nhập chỉ đổi được qua OTP (xem cuối file). */
  phone: z.string().trim().max(20).optional().default(""),
  address: z.string().trim().max(255).optional().default(""),
  parent2Name: z.string().trim().max(120).optional().default(""),
  parent2Phone: z.string().trim().max(20).optional().default(""),
});

export async function updateParentProfile(input: {
  name: string;
  phone?: string;
  address?: string;
  parent2Name?: string;
  parent2Phone?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireParent();
  if (!user) return { ok: false, error: "Chưa đăng nhập" };
  const pdb = portalDb({ parentUserId: user.id, childIds: [] });

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const d = parsed.data;
  const nz = (s: string) => (s.length ? s : null);

  await pdb.user.update({
    where: { id: user.id },
    data: { name: d.name, address: nz(d.address) },
  });

  // AUTH-SĐT P6 — `Student.parentPhone` LẤY TỪ `User.phone`, KHÔNG lấy từ ô nhập.
  //
  // Trước P6 chỗ này ghi thẳng `d.phone` (max(20), không chuẩn hoá) xuống mọi
  // Student của hộ. Sau P5 `User.phone` là ĐỊNH DANH ĐĂNG NHẬP, nên để hai nguồn
  // trôi lệch nhau kéo theo hai hỏng hóc câm: gộp anh chị em so khớp theo
  // `parentPhone` sẽ trượt, và ZNS điểm danh (lib/notify/attendance.ts) gửi tới
  // số cũ. Đổi số ĐĂNG NHẬP phải đi qua OTP CHANGE_CONTACT ở dưới — không phải
  // gõ tự do vào form hồ sơ.
  const current = await pdb.user.findUnique({
    where: { id: user.id },
    select: { phone: true },
  });
  await pdb.student.updateMany({
    where: { parentUserId: user.id, deletedAt: null },
    data: {
      parentName: d.name,
      parentPhone: current?.phone ?? null,
      parent2Name: nz(d.parent2Name),
      // PH thứ hai KHÔNG phải định danh đăng nhập nên sửa tự do được, nhưng vẫn
      // canonical hoá để mọi đường đọc/gửi ZNS thấy cùng một dạng.
      parent2Phone: canonicalPhone(d.parent2Phone) ?? nz(d.parent2Phone),
    },
  });

  revalidatePath("/portal/ho-so");
  revalidatePath("/portal");
  return { ok: true };
}

// ─── AUTH-SĐT P6 — đổi SĐT đăng nhập (2 bước, OTP gửi tới SỐ MỚI) ──────────
// Phần chạm DB nằm ở lib/parents/phone-change.ts (portal không được import
// @/lib/db trần, và việc này phải tra bảng User của người khác để kiểm trùng số).

export async function requestParentPhoneChangeOtp(
  rawPhone: string,
): Promise<{ ok: boolean; error?: string; cooldownSec?: number }> {
  const user = await requireParent();
  if (!user) return { ok: false, error: "Chưa đăng nhập" };
  const res = await requestParentPhoneChange(user.id, rawPhone);
  return res.ok
    ? { ok: true, cooldownSec: res.cooldownSec }
    : { ok: false, error: res.error };
}

export async function confirmParentPhoneChangeAction(input: {
  newPhone: string;
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireParent();
  if (!user) return { ok: false, error: "Chưa đăng nhập" };
  const res = await confirmParentPhoneChange(
    user.id,
    input.newPhone,
    input.code,
  );
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/portal/ho-so");
  revalidatePath("/portal");
  return { ok: true };
}
