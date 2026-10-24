"use server";
// Server Action của module Chính sách khuyến mãi (26/09/2026).
//
// Khuôn mỗi action (luật cứng Nền Hệ thống #1 — kiểm quyền NGAY trong thân):
//   1. auth()  2. assertPermission("promotions:manage")  3. zod  4. gọi `lib/khuyen-mai` —
//   nơi ép luật nghiệp vụ (trùng mã, trạng thái, audit, báo Sale).
//
// Ai được làm: chỉ người giữ `promotions:manage` — SUPER_ADMIN + vai `GIAM_DOC` (chủ dự án chốt
// 26/09/2026: "BLĐ" = Quản trị tối cao + Giám đốc). Xem thì `promotions:view`, không có action.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertPermission } from "@/lib/auth/check-permission";
import {
  LoiKhuyenMai,
  banHanhChinhSach,
  batTatVoucher,
  suaChinhSach,
  themVoucher,
  thuHoiChinhSach,
  type NguoiThaoTac,
} from "@/lib/khuyen-mai/chinh-sach";
import {
  chinhSachSchema,
  suaChinhSachSchema,
  tatVoucherSchema,
  thuHoiSchema,
  voucherSchema,
} from "@/lib/validators/khuyen-mai";

type KetQua<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const DUONG_DAN = "/admin/khuyen-mai";
const KHONG_QUYEN = "Chỉ Ban lãnh đạo (Quản trị tối cao, Giám đốc) được ban hành hoặc sửa chính sách khuyến mãi.";

function nguoiTu(user: { id: string; name?: string | null; email?: string | null }): NguoiThaoTac {
  return { userId: user.id, ten: user.name ?? user.email ?? user.id };
}

function loiZod(issues: readonly { message: string }[]): KetQua<never> {
  return { ok: false, error: issues[0]?.message ?? "Dữ liệu không hợp lệ." };
}

function dichLoi(e: unknown): KetQua<never> {
  if (e instanceof LoiKhuyenMai) return { ok: false, error: e.message };
  console.error("[khuyen-mai] action lỗi", e instanceof Error ? e.name : "?");
  return { ok: false, error: "Có lỗi khi lưu — thử lại, hoặc báo kỹ thuật." };
}

/** Mọi màn đọc chính sách — kể cả màn Tra cứu của Sale. */
function lamMoi(id?: string) {
  revalidatePath(DUONG_DAN);
  if (id) revalidatePath(`${DUONG_DAN}/${id}`);
  revalidatePath("/admin/tra-cuu");
}

export async function banHanhAction(input: unknown): Promise<KetQua<{ id: string; soNguoiDuocBao: number }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập." };
  try {
    await assertPermission("promotions:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = chinhSachSchema.safeParse(input);
  if (!p.success) return loiZod(p.error.issues);
  try {
    const r = await banHanhChinhSach(nguoiTu(session.user), p.data, new Date());
    lamMoi(r.id);
    return { ok: true, data: r };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function suaAction(input: unknown): Promise<KetQua> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập." };
  try {
    await assertPermission("promotions:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = suaChinhSachSchema.safeParse(input);
  if (!p.success) return loiZod(p.error.issues);
  try {
    await suaChinhSach(nguoiTu(session.user), p.data, new Date());
    lamMoi(p.data.id);
    return { ok: true, data: undefined };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function thuHoiAction(input: unknown): Promise<KetQua<{ soNguoiDuocBao: number }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập." };
  try {
    await assertPermission("promotions:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = thuHoiSchema.safeParse(input);
  if (!p.success) return loiZod(p.error.issues);
  try {
    const r = await thuHoiChinhSach(nguoiTu(session.user), p.data, new Date());
    lamMoi(p.data.id);
    return { ok: true, data: r };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function themVoucherAction(input: unknown): Promise<KetQua<{ id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập." };
  try {
    await assertPermission("promotions:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = voucherSchema.safeParse(input);
  if (!p.success) return loiZod(p.error.issues);
  try {
    const r = await themVoucher(nguoiTu(session.user), p.data, new Date());
    lamMoi(p.data.chinhSachId);
    return { ok: true, data: r };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function batTatVoucherAction(input: unknown, chinhSachId: string): Promise<KetQua> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập." };
  try {
    await assertPermission("promotions:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = tatVoucherSchema.safeParse(input);
  if (!p.success) return loiZod(p.error.issues);
  try {
    await batTatVoucher(nguoiTu(session.user), p.data, new Date());
    lamMoi(typeof chinhSachId === "string" && chinhSachId ? chinhSachId : undefined);
    return { ok: true, data: undefined };
  } catch (e) {
    return dichLoi(e);
  }
}
