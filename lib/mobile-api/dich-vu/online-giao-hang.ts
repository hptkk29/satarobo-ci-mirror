import { z } from "zod";

import { db } from "@/lib/db";
import { docDiaChiGiaoHang, ghiDiaChiGiaoHang, layPhuongThucGiao } from "@/lib/online-checkout/giao-hang";
import { docGio } from "@/lib/online-checkout/gio-hang-luu";

import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { batNeuTatOnline } from "./online-hoc";

/**
 * V8.43 — GIAO HÀNG phía phụ huynh (Commerce v2 · P0): lớp HTTP MỎNG trên `lib/online-checkout/giao-hang.ts`.
 *   · địa chỉ nhận hàng (GET luôn 200 — chưa có ⇒ `{daCo:false, goiY}`; PUT thân strict đủ 5 trường);
 *   · danh sách phương thức giao KHẢ DỤNG theo địa chỉ hiện có (phí do máy chủ tính từ cấu hình; không có đường gửi phí);
 *   · cờ Online tắt ⇒ 404; Student Mode ⇒ 403 (route KHÔNG nằm trong allow-list).
 */
export const diaChiSchema = z
  .object({ hoTen: z.string().max(200), soDienThoai: z.string().max(40), tinhThanh: z.string().max(200), phuongXa: z.string().max(200), soNhaDuong: z.string().max(300) })
  .strict();

export async function xemDiaChiMobile(parentUserId: string) {
  batNeuTatOnline();
  return docDiaChiGiaoHang(db as never, parentUserId);
}

export async function luuDiaChiMobile(parentUserId: string, body: z.infer<typeof diaChiSchema>) {
  batNeuTatOnline();
  const r = await ghiDiaChiGiaoHang(db as never, { parentUserId, diaChi: body });
  if (!r.ok) throw Object.assign(new LoiApiMobile("DIA_CHI_KHONG_HOP_LE" as never, 422, r.thongBao), { truong: r.truong });
  return r.diaChi;
}

/** Phương thức giao + phí ĐÚNG theo tạm tính hàng hiện tại của giỏ (ngưỡng miễn phí tính trên cùng con số `tamTinh` của giỏ). */
export async function phuongThucGiaoMobile(parentUserId: string) {
  batNeuTatOnline();
  const gio = await docGio(db as never, { parentUserId, now: new Date() });
  const phuongThuc = await layPhuongThucGiao(db as never, { parentUserId, tamTinhHang: gio.tamTinh });
  return { phuongThuc, dangChon: gio.giaoHang.phuongThuc, tamTinhHang: gio.tamTinh };
}
