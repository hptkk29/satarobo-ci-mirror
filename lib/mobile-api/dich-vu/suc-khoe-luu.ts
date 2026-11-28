import { db } from "@/lib/db";
import { layHomNay } from "@/lib/suc-khoe/dong-co-goc";
import { docSucKhoeMayChu, luuSucKhoeMayChu, xoaSucKhoeMayChu, type LoiSucKhoe } from "@/lib/suc-khoe/luu-may-chu-db";
import type { LuuSucKhoeBody } from "@/lib/suc-khoe/luu-may-chu";

import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { motSucKhoeTat } from "./suc-khoe";

/**
 * V8.39 — SỨC KHOẺ: LƯU CÓ CHỦ ĐÍCH (HL-01) — lớp HTTP MỎNG trên `lib/suc-khoe/luu-may-chu-db.ts`.
 *   · `parentUserId` từ PHIÊN (không có tham số chọn người khác); Student Mode ⇒ 403 (route không nằm trong allow-list); cờ `SUC_KHOE_ENABLED` tắt ⇒ 404 TRƯỚC khi đọc thân;
 *   · KHÔNG log thân/số đo/tên; lỗi dựng sẵn, không chèn giá trị người dùng gửi;
 *   · mã lỗi: `SUC_KHOE_CHUA_BAT_MA_HOA` 503 · `SUC_KHOE_DA_THAY_DOI` 409 · `VALIDATION` 400 · lỗi giải mã/hỏng dữ liệu ⇒ `SERVER` 500 (không lộ chi tiết).
 */
export { motSucKhoeTat };

function nem(r: LoiSucKhoe): never {
  switch (r.ma) {
    case "CHUA_BAT_MA_HOA":
      throw new LoiApiMobile("SUC_KHOE_CHUA_BAT_MA_HOA" as never, 503, "Chưa thể lưu dữ liệu sức khoẻ lúc này.");
    case "DA_THAY_DOI":
      throw new LoiApiMobile("SUC_KHOE_DA_THAY_DOI" as never, 409, "Dữ liệu sức khoẻ đã thay đổi ở thiết bị khác.");
    case "VALIDATION":
      throw new LoiApiMobile("VALIDATION" as never, 400, r.thongBao);
    default:
      throw new LoiApiMobile("SERVER", 500, "Có lỗi xảy ra. Vui lòng thử lại.");
  }
}

export async function luuSucKhoeMobile(parentUserId: string, body: LuuSucKhoeBody) {
  const r = await luuSucKhoeMayChu(db as never, { parentUserId, body, homNay: layHomNay(), now: new Date() });
  if (!r.ok) nem(r);
  return { capNhatLuc: r.capNhatLuc, hetHanLuc: r.hetHanLuc, soNguoi: r.soNguoi, soBan: r.soBan, dongY: r.dongY, luuTru: r.luuTru };
}

export async function docSucKhoeMobile(parentUserId: string) {
  const r = await docSucKhoeMayChu(db as never, { parentUserId, now: new Date() });
  if (!r.ok) nem(r);
  return r.coDuLieu
    ? { coDuLieu: true as const, dongY: r.dongY, capNhatLuc: r.capNhatLuc, hetHanLuc: r.hetHanLuc, nguoi: r.nguoi, luuTru: r.luuTru }
    : { coDuLieu: false as const, luuTru: r.luuTru };
}

export async function xoaSucKhoeMobile(parentUserId: string) {
  const r = await xoaSucKhoeMayChu(db as never, { parentUserId });
  return { daXoa: r.daXoa };
}
