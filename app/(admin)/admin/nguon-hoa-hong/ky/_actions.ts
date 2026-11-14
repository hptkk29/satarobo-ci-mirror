"use server";
// Server Action của tab Kỳ (PR9). MỎNG có chủ đích: auth → quyền → xác thực đầu vào → điều phối (`lib/hoa-hong/ky-hanh-dong`) → làm mới trang.
// Mọi luật nghiệp vụ (vòng đời, hai cổng khoá, kết chuyển âm, phạm vi cơ sở) nằm ở `ky-service` / `xuat-ky` — action KHÔNG viết lại.
//
// Khuôn mỗi action (luật cứng Nền Hệ thống #1 — kiểm quyền NGAY ĐẦU hàm, trước khi chạm bất cứ thứ gì):
//   1. auth()  2. assertPermission("commission_periods:manage")  3. zod  4. resolveActor  5. gọi điều phối.
// MỘT quyền cho cả bảy thao tác — ĐÚNG key mà màn Kỳ dùng để vẽ nút (`scope.has("commission_periods:manage")`, luật 12): vẽ nút bằng quyền A
// rồi để action hỏi quyền B là lời hứa suông. Phạm vi CƠ SỞ (QLCS CS1 không khoá được kỳ CS2) do service gác bằng `quyen` của người thao tác.
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { assertPermission } from "@/lib/auth/check-permission";
import {
  PHU_THUOC_THAT,
  chuyenRaSoatHanhDong,
  danhDauDaChiHanhDong,
  doiHangChoSangKyHanhDong,
  khoaHanhDong,
  traLaiHanhDong,
  tinhKyHanhDong,
  xuatHanhDong,
  type KetQua,
  type KetQuaXuatBangChi,
} from "@/lib/hoa-hong/ky-hanh-dong";
import type { NguoiThaoTacKy } from "@/lib/hoa-hong/ky-service";

const KHONG_QUYEN = "Bạn không có quyền thao tác trên kỳ hoa hồng (commission_periods:manage).";
const CHUA_DANG_NHAP = "Chưa đăng nhập.";
const DAU_VAO_SAI = "Yêu cầu không hợp lệ — tải lại trang rồi thử lại.";

const thangSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const idSchema = z.string().min(1).max(64);
const lyDoSchema = z.string().max(1000);
const soLieuSchema = z.object({
  coSoTinh: z.number().int(),
  hoaHong: z.number().int(),
  dieuChinh: z.number().int(),
  soNguoi: z.number().int().nonnegative(),
  lastCalculatedAt: z.string().max(40).nullable(),
});

type Loi = { ok: false; ma: string; loi: string };
const tuChoi = (ma: string, loi: string): Loi => ({ ok: false, ma, loi });

async function vaoViec(): Promise<{ nguoi: NguoiThaoTacKy } | Loi> {
  const session = await auth();
  if (!session?.user) return tuChoi("CHUA_DANG_NHAP", CHUA_DANG_NHAP);
  try {
    await assertPermission("commission_periods:manage");
  } catch {
    return tuChoi("KHONG_QUYEN", KHONG_QUYEN);
  }
  const quyen = await resolveActor(session.user.id);
  return { nguoi: { userId: session.user.id, ten: session.user.name ?? session.user.email ?? session.user.id, quyen } };
}

function lamMoi() {
  // Số hàng chờ trên pill các tab nằm ở khung chung ⇒ làm mới cả module, không chỉ trang Kỳ.
  revalidatePath("/nguon-hoa-hong", "layout");
}

async function chay<T>(chuaXong: () => Promise<KetQua<T>>): Promise<KetQua<T>> {
  const r = await chuaXong();
  if (r.ok) lamMoi();
  return r;
}

export async function tinhKyAction(vao: { thang: string; centerId: string }): Promise<KetQua<{ soKhoan: number }>> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ thang: thangSchema, centerId: idSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return chay(() => tinhKyHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data }));
}

export async function chuyenRaSoatAction(vao: { periodId: string }): Promise<KetQua> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ periodId: idSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return chay(() => chuyenRaSoatHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data }));
}

export async function traLaiAction(vao: { periodId: string; lyDo: string }): Promise<KetQua> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ periodId: idSchema, lyDo: lyDoSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return chay(() => traLaiHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data }));
}

/** `daThay` = bản chụp số liệu mà hộp thoại đã hiện; server chụp lại và so (lệch ⇒ từ chối). */
export async function khoaKyAction(vao: { periodId: string; lyDo: string; daThay: z.infer<typeof soLieuSchema> }): Promise<KetQua> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ periodId: idSchema, lyDo: lyDoSchema, daThay: soLieuSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return chay(() => khoaHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data }));
}

export async function xuatKyAction(vao: { thang: string; kind: "PAYROLL" | "EXTERNAL_SETTLEMENT"; lyDo: string }): Promise<KetQua<{ xuat: KetQuaXuatBangChi }>> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ thang: thangSchema, kind: z.enum(["PAYROLL", "EXTERNAL_SETTLEMENT"]), lyDo: lyDoSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return chay(() => xuatHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data }));
}

/**
 * Dời MỘT hàng chờ đang chặn khoá sang kỳ sau (nút ở dòng hàng chờ, tab Sổ). CÙNG key quyền với mọi thao tác kỳ — và cùng key mà tab Sổ dùng để vẽ nút (luật 12).
 * Hàng chờ nào dời được là việc của điều phối (`lyDoKhongDoiDuoc`); action không viết lại.
 */
export async function doiHangChoSangKySauAction(vao: { holdId: string; lyDo: string }): Promise<KetQua<{ kySau: string }>> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ holdId: idSchema, lyDo: lyDoSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return chay(() => doiHangChoSangKyHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data }));
}

export async function danhDauDaChiAction(vao: { batchId: string; lyDo: string }): Promise<KetQua<{ soDong: number; soKyPaid: number }>> {
  const v = await vaoViec();
  if ("ok" in v) return v;
  const p = z.object({ batchId: idSchema, lyDo: lyDoSchema }).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return chay(() => danhDauDaChiHanhDong(PHU_THUOC_THAT, { nguoi: v.nguoi, now: new Date(), ...p.data }));
}
