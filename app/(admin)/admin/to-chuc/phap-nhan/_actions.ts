"use server";

// Quản trị PHÁP NHÂN của Cây tổ chức (24/10/2026) — thêm · sửa · ngừng/mở lại · xoá mềm · gắn đơn vị.
//
// Luật cứng của module (cùng khuôn `../_actions.ts`):
//   - MỌI action: auth() → assertPermission("centers:edit") GỌI TRỰC TIẾP trong thân function (lint
//     authz/require-can-in-write-action đọc AST thân function). `centers:edit` = SUPER_ADMIN ở cả hai tầng RBAC — đúng "người có quyền
//     quản trị"; KHÔNG chế key mới.
//   - Luật nghiệp vụ + audit nằm NGUYÊN ở `lib/org/legal-entity-admin.ts` (mỗi thao tác một transaction cùng bản ghi audit). Action
//     chỉ kiểm quyền, kiểm hình dạng đầu vào, dịch OrgRuleError ⇒ { ok:false, error }.
//   - KHÔNG đụng hoá đơn / phiếu thu / cấu hình hoá đơn (xem đầu legal-entity-admin.ts).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { assertPermission } from "@/lib/auth/check-permission";
import { OrgRuleError } from "@/lib/org/types";
import { doiTrangThaiPhapNhan, ganPhapNhanChoDonVi, suaPhapNhan, taoPhapNhan, xoaPhapNhan } from "@/lib/org/legal-entity-admin";

type Result = { ok: true; id?: string } | { ok: false; error: string };

const KHONG_QUYEN = "Không có quyền quản trị cây tổ chức";

function lamMoi() {
  revalidatePath("/admin/to-chuc/phap-nhan");
  revalidatePath("/admin/to-chuc");
  // Màn Cấu hình ký hiệu hoá đơn tự chọn pháp nhân theo Cây tổ chức ⇒ làm mới luôn cho khỏi lệch.
  revalidatePath("/admin/payments/hoa-don/cau-hinh");
}

function loiNguoiDung(e: unknown, macDinh: string): string {
  if (e instanceof OrgRuleError) return e.message;
  console.error("[to-chuc/phap-nhan] thao tác thất bại:", e);
  return macDinh;
}

const idSchema = z.string().min(1).max(64);
const lyDoSchema = z.string().trim().max(300);
const diaChiSchema = z.string().trim().max(300).nullable().optional();

const taoSchema = z.object({ taxCode: z.string().trim().max(20), legalName: z.string().trim().min(1).max(250), address: diaChiSchema });
const suaSchema = z.object({ id: idSchema, taxCode: z.string().trim().max(20).optional(), legalName: z.string().trim().min(1).max(250).optional(), address: diaChiSchema, lyDo: lyDoSchema });
const trangThaiSchema = z.object({ id: idSchema, hanhDong: z.enum(["NGUNG", "MO_LAI"]), lyDo: lyDoSchema });
const xoaSchema = z.object({ id: idSchema, lyDo: lyDoSchema });
const ganSchema = z.object({ orgUnitId: idSchema, legalEntityId: idSchema.nullable(), lyDo: lyDoSchema });

export async function taoPhapNhanAction(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("centers:edit");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = taoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    const r = await taoPhapNhan({ ...p.data, nguoi: { id: session.user.id, name: session.user.name ?? session.user.email ?? "—" } });
    lamMoi();
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: loiNguoiDung(e, "Không thêm được pháp nhân, thử lại sau") };
  }
}

export async function suaPhapNhanAction(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("centers:edit");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = suaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await suaPhapNhan({ ...p.data, nguoi: { id: session.user.id, name: session.user.name ?? session.user.email ?? "—" } });
    lamMoi();
    return { ok: true, id: p.data.id };
  } catch (e) {
    return { ok: false, error: loiNguoiDung(e, "Không lưu được thay đổi, thử lại sau") };
  }
}

export async function doiTrangThaiPhapNhanAction(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("centers:edit");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = trangThaiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await doiTrangThaiPhapNhan({ ...p.data, nguoi: { id: session.user.id, name: session.user.name ?? session.user.email ?? "—" } });
    lamMoi();
    return { ok: true, id: p.data.id };
  } catch (e) {
    return { ok: false, error: loiNguoiDung(e, "Không đổi được trạng thái, thử lại sau") };
  }
}

export async function xoaPhapNhanAction(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("centers:edit");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = xoaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await xoaPhapNhan({ ...p.data, nguoi: { id: session.user.id, name: session.user.name ?? session.user.email ?? "—" } });
    lamMoi();
    return { ok: true, id: p.data.id };
  } catch (e) {
    return { ok: false, error: loiNguoiDung(e, "Không xoá được pháp nhân, thử lại sau") };
  }
}

export async function ganPhapNhanChoDonViAction(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("centers:edit");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }
  const p = ganSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await ganPhapNhanChoDonVi({ ...p.data, nguoi: { id: session.user.id, name: session.user.name ?? session.user.email ?? "—" } });
    lamMoi();
    return { ok: true, id: p.data.orgUnitId };
  } catch (e) {
    return { ok: false, error: loiNguoiDung(e, "Không gắn được pháp nhân, thử lại sau") };
  }
}
