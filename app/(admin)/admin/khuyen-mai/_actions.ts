"use server";
// Server Action của module Chính sách khuyến mãi (26/09/2026).
//
// Khuôn mỗi action (luật cứng Nền Hệ thống #1 — kiểm quyền NGAY trong thân):
//   1. auth()  2. assertPermission("promotions:manage")  3. zod  4. gọi `lib/khuyen-mai` —
//   nơi ép luật nghiệp vụ (trùng mã, trạng thái, audit, báo Sale).
//
// Ai được làm: người giữ `promotions:manage` — Quản trị tối cao + vai `GIAM_DOC` (BLĐ, chốt 26/09/2026) VÀ Quản lý cơ sở
// (mở 01/11/2026). Xem thì `promotions:view`, không có action.
//
// ⚠️ PHẠM VI THEO CƠ SỞ (01/11/2026): quyền này không còn đủ một mình. Quản lý cơ sở chỉ ban hành / sửa / thu hồi / thêm mã
// cho chính sách mà MỌI cơ sở của nó nằm trong phạm vi vai của họ, và chính sách phải nêu rõ cơ sở (trống = toàn hệ thống =
// chỉ BLĐ). Luật ở `lib/khuyen-mai/quyen-co-so.ts`; dữ liệu cơ sở đọc từ DB (`coSoCuaChinhSach` / `coSoCuaVoucher`), không từ client.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import {
  CAU_BAN_HANH_NGOAI_PHAM_VI,
  CAU_NGOAI_PHAM_VI,
  duocLamViecVoi,
  phamViKhuyenMai,
  type PhamViKhuyenMai,
} from "@/lib/khuyen-mai/quyen-co-so";
import {
  LoiKhuyenMai,
  banHanhChinhSach,
  batTatVoucher,
  coSoCuaChinhSach,
  coSoCuaVoucher,
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
const KHONG_QUYEN = "Chỉ Ban lãnh đạo (Quản trị tối cao, Giám đốc) và Quản lý cơ sở được ban hành hoặc sửa chính sách khuyến mãi.";

/** Phạm vi OrgUnit của người đang thao tác — tính từ actor đã giải (RBAC v2), không từ client. */
async function phamViCua(userId: string): Promise<PhamViKhuyenMai> {
  return phamViKhuyenMai(await resolveActor(userId));
}

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
  // Phạm vi: cơ sở NGƯỜI GÕ phải nằm trong phạm vi của họ và không được để trống (trống = toàn hệ thống).
  if (!duocLamViecVoi(await phamViCua(session.user.id), p.data.coSo)) return { ok: false, error: CAU_BAN_HANH_NGOAI_PHAM_VI };
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
  // Phạm vi: chính sách HIỆN CÓ (đọc từ DB) lẫn cơ sở MỚI người gõ đều phải thuộc phạm vi — kiểm một vế là sửa qua cửa vế kia.
  const pv = await phamViCua(session.user.id);
  const coSoCu = await coSoCuaChinhSach(p.data.id);
  if (coSoCu && !(duocLamViecVoi(pv, coSoCu) && duocLamViecVoi(pv, p.data.coSo))) return { ok: false, error: CAU_NGOAI_PHAM_VI };
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
  const coSoCu = await coSoCuaChinhSach(p.data.id);
  if (coSoCu && !duocLamViecVoi(await phamViCua(session.user.id), coSoCu)) return { ok: false, error: CAU_NGOAI_PHAM_VI };
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
  const coSoCu = await coSoCuaChinhSach(p.data.chinhSachId);
  if (coSoCu && !duocLamViecVoi(await phamViCua(session.user.id), coSoCu)) return { ok: false, error: CAU_NGOAI_PHAM_VI };
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
  // Chính sách của mã suy ra từ CHÍNH mã (DB) — tham số `chinhSachId` thứ hai chỉ để làm mới trang, client gửi gì cũng được.
  const coSoCu = await coSoCuaVoucher(p.data.id);
  if (coSoCu && !duocLamViecVoi(await phamViCua(session.user.id), coSoCu)) return { ok: false, error: CAU_NGOAI_PHAM_VI };
  try {
    await batTatVoucher(nguoiTu(session.user), p.data, new Date());
    lamMoi(typeof chinhSachId === "string" && chinhSachId ? chinhSachId : undefined);
    return { ok: true, data: undefined };
  } catch (e) {
    return dichLoi(e);
  }
}
