import { z } from "zod";

import { db } from "@/lib/db";
import { dangKyBaoCoHang, docDanhMucHocCu, docMotHocCu, guiThongBaoCoHangLai, huyBaoCoHang } from "@/lib/online-checkout/danh-muc-hoc-cu";

import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { batNeuTatOnline } from "./online-hoc";

/**
 * V8.42 — CỬA HÀNG HỌC CỤ ONLINE phía phụ huynh (Commerce v2 · P0-A): lớp HTTP MỎNG trên `lib/online-checkout/danh-muc-hoc-cu.ts`.
 *   · chỉ ĐỌC danh mục (sản phẩm bán Online, đang bán) + đăng ký/huỷ «báo khi có hàng»; KHÔNG có đường nào gửi giá;
 *   · cờ `ELEARNING_ONLINE_ENABLED` tắt ⇒ 404; Student Mode ⇒ 403 (route KHÔNG nằm trong allow-list); mọi thân `.strict()`.
 */
const SO = (max: number) => z.coerce.number().int().min(1).max(max);
export const truyVanShopSchema = z
  .object({ danhMuc: z.enum(["KIT_ROBOT", "SENSOR", "MISSION_BLOCK", "ACCESSORY", "BOOK", "CONSUMABLE", "OTHER"]).optional(), q: z.string().trim().max(80).optional(), trang: SO(1000).default(1), soLuong: SO(50).default(20) })
  .strict();
export const thanRongSchema = z.object({}).strict();
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
const idHopLe = (id: string): string => {
  if (!id || id.length > 64) throw khongThay();
  return id;
};

export async function danhMucShopMobile(parentUserId: string, query: Record<string, string>) {
  batNeuTatOnline();
  const p = truyVanShopSchema.safeParse(query);
  if (!p.success) throw new LoiApiMobile("VALIDATION", 400, p.error.issues[0]?.message ?? "Tham số không hợp lệ.");
  return docDanhMucHocCu(db as never, { ...p.data, parentUserId, now: new Date() });
}

export async function motSanPhamShopMobile(parentUserId: string, id: string) {
  batNeuTatOnline();
  const r = await docMotHocCu(db as never, { id: idHopLe(id), parentUserId, now: new Date() });
  if (!r) throw khongThay();
  return r;
}

export async function dangKyBaoCoHangMobile(parentUserId: string, id: string) {
  batNeuTatOnline();
  const ok = await dangKyBaoCoHang(db as never, { productId: idHopLe(id), parentUserId, now: new Date() });
  if (!ok) throw khongThay();
  return { daDangKy: true as const };
}

export async function huyBaoCoHangMobile(parentUserId: string, id: string) {
  batNeuTatOnline();
  await huyBaoCoHang(db as never, { productId: idHopLe(id), parentUserId });
  return { daDangKy: false as const };
}

/** Dùng cho tác vụ nội bộ/Admin khi hàng về — không phải route mobile. */
export const baoCoHangLai = (productId: string, now: Date) => guiThongBaoCoHangLai(db as never, { productId, now });
