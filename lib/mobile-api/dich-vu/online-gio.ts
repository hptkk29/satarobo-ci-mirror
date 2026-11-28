import { z } from "zod";

import { db } from "@/lib/db";
import { apMaTatCaGio, datHangTuGio, docGio, suaDongGioChung, suaMaDongGio, themDongGio, xacNhanDongBiGo, xoaDongGio, xoaGio, type LoiGio } from "@/lib/online-checkout/gio-hang-luu";
import { docDonOnlineCuaPhuHuynh } from "@/lib/online-checkout/phu-huynh";

import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { batNeuTatOnline } from "./online-hoc";
import { GIOI_HAN_THANH_TOAN, HTTP_TAO_DON, huongDanChoDon } from "./online-mua";

/**
 * V8.34 — GIỎ HÀNG ĐÃ LƯU phía phụ huynh: lớp HTTP MỎNG trên `lib/online-checkout/gio-hang-luu.ts` (Commerce v2, vòng 1: ONLINE_COURSE).
 *   · `parentUserId` từ PHIÊN; mọi thân `.strict()` — KHÔNG có trường tiền/loại/đơn giá (thêm khoá lạ ⇒ 400);
 *   · lỗi: `error.code` = mã nghiệp vụ như `online-orders`; `GIO_DA_THAY_DOI`/`KHONG_CO_DONG_DE_DAT` KHÔNG mang thân giỏ — app tự GET lại;
 *   · cờ `ELEARNING_ONLINE_ENABLED` tắt ⇒ 404; Student Mode ⇒ 403 (route KHÔNG nằm trong allow-list).
 */
const HTTP_GIO: Record<string, number> = { GIO_DA_THAY_DOI: 409, DONG_KHONG_THUOC_GIO: 404, GIO_TOI_DA_DONG: 409, LOAI_SAN_PHAM_CHUA_HO_TRO: 409, KHONG_CO_DONG_DE_DAT: 409, HET_HANG: 409, SO_LUONG_VUOT_TOI_DA: 409, KHONG_BAN_ONLINE: 409, SAN_PHAM_KHONG_TON_TAI: 404, SAI_LOAI_DONG: 400, DONG_DA_CO_TRONG_GIO: 409, PHUONG_THUC_GIAO_KHONG_HOP_LE: 422, GIA_DA_TANG: 409 };

const revisionSo = z.number().int().min(0).max(2_000_000_000);
const maGiam = z.string().trim().max(40).nullable();

/** XOR strict: KHOÁ `{khoaId, studentId, maGiamGia?}` HOẶC HỌC CỤ `{productId, soLuong?}`; không có đường nào gửi giá/tổng/phí. */
export const themDongGioSchema = z
  .object({
    khoaId: z.string().min(1).max(64).optional(),
    studentId: z.string().min(1).max(64).optional(),
    maGiamGia: maGiam.optional(),
    productId: z.string().min(1).max(64).optional(),
    soLuong: z.number().int().min(1).max(100).optional(),
    revision: revisionSo.optional(),
  })
  .strict()
  .superRefine((v, c) => {
    const khoa = v.khoaId !== undefined || v.studentId !== undefined || v.maGiamGia !== undefined;
    const hocCu = v.productId !== undefined || v.soLuong !== undefined;
    if (khoa && hocCu) c.addIssue({ code: "custom", message: "Chỉ gửi khoá học HOẶC học cụ, không gửi cả hai." });
    else if (hocCu && v.productId === undefined) c.addIssue({ code: "custom", message: "Thiếu sản phẩm." });
    else if (!hocCu && (v.khoaId === undefined || v.studentId === undefined)) c.addIssue({ code: "custom", message: "Chọn khoá học và con." });
  });
export const suaMaDongGioSchema = z.object({ maGiamGia: maGiam, revision: revisionSo.optional() }).strict();
/** PATCH một dòng: đổi số lượng (học cụ) / đổi học viên hoặc mã (khoá). Ít nhất một khoá; thân strict. */
export const suaDongGioSchema = z
  .object({ soLuong: z.number().int().min(1).max(100).optional(), studentId: z.string().min(1).max(64).optional(), maGiamGia: maGiam.optional(), revision: revisionSo.optional() })
  .strict()
  .refine((v) => v.soLuong !== undefined || v.studentId !== undefined || v.maGiamGia !== undefined, { message: "Không có gì để sửa." });
/** PATCH giỏ: mã cho tất cả khoá và/hoặc phương thức giao. Ít nhất một khoá; thân strict; không có đường gửi phí/tổng. */
export const suaGioSchema = z
  .object({ maGiamGia: maGiam.optional(), phuongThucGiao: z.string().trim().min(2).max(30).nullable().optional(), revision: revisionSo.optional() })
  .strict()
  .refine((v) => v.maGiamGia !== undefined || v.phuongThucGiao !== undefined, { message: "Không có gì để sửa." });
export const xacNhanDongBiGoSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(50).optional() }).strict();
export const datHangGioSchema = z.object({ revision: revisionSo, itemIds: z.array(z.string().min(1).max(64)).min(1).max(50).optional(), xacNhanGiaMoi: z.boolean().optional() }).strict();

function nem(r: LoiGio): never {
  if (r.ma === "SAI_PHU_HUYNH") throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const status = HTTP_GIO[r.ma] ?? (HTTP_TAO_DON as Record<string, number | undefined>)[r.ma];
  if (status === undefined) throw new LoiApiMobile("SERVER", 500, "Lỗi giỏ hàng (mã chưa được ánh xạ).");
  const chiTiet = r.thieu ? { thieu: r.thieu, ...(r.cartItemIds ? { cartItemIds: r.cartItemIds } : {}) } : r.cartItemIds ? { cartItemIds: r.cartItemIds } : undefined;
  throw Object.assign(new LoiApiMobile(r.ma as never, status, r.thongBao), r.viTri !== undefined ? { viTri: r.viTri } : {}, chiTiet !== undefined ? { chiTiet } : {});
}

const gioHienTai = (parentUserId: string) => docGio(db as never, { parentUserId, now: new Date() });

export async function xemGioMobile(parentUserId: string) {
  batNeuTatOnline();
  return gioHienTai(parentUserId);
}

export async function themDongGioMobile(parentUserId: string, body: z.infer<typeof themDongGioSchema>) {
  batNeuTatOnline();
  const r = await themDongGio(db as never, body.productId !== undefined
    ? { parentUserId, loai: "PHYSICAL_GOOD", productId: body.productId, soLuong: body.soLuong, revision: body.revision, now: new Date() }
    : { parentUserId, khoaId: body.khoaId, studentId: body.studentId, maGiamGia: body.maGiamGia ?? null, revision: body.revision, now: new Date() });
  if (!r.ok) nem(r);
  return { daCo: r.daCo, itemId: r.itemId, revision: r.revision, ...("daGiamSoLuong" in r && r.daGiamSoLuong ? { daGiamSoLuong: true } : {}), gio: await gioHienTai(parentUserId) };
}

export async function suaMaDongGioMobile(parentUserId: string, itemId: string, body: z.infer<typeof suaMaDongGioSchema>) {
  batNeuTatOnline();
  const r = await suaMaDongGio(db as never, { parentUserId, itemId, maGiamGia: body.maGiamGia, revision: body.revision });
  if (!r.ok) nem(r);
  return { revision: r.revision, gio: await gioHienTai(parentUserId) };
}

export async function suaDongGioMobile(parentUserId: string, itemId: string, body: z.infer<typeof suaDongGioSchema>) {
  batNeuTatOnline();
  if (!itemId || itemId.length > 64) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const r = await suaDongGioChung(db as never, { parentUserId, itemId, soLuong: body.soLuong, studentId: body.studentId, maGiamGia: body.maGiamGia, revision: body.revision, now: new Date() });
  if (!r.ok) nem(r);
  return { revision: r.revision, gio: await gioHienTai(parentUserId) };
}

export async function xacNhanDongBiGoMobile(parentUserId: string, body: z.infer<typeof xacNhanDongBiGoSchema>) {
  batNeuTatOnline();
  const r = await xacNhanDongBiGo(db as never, { parentUserId, ids: body.ids, now: new Date() });
  return { soDaXacNhan: r.soDaXacNhan, gio: await gioHienTai(parentUserId) };
}

export async function apMaTatCaGioMobile(parentUserId: string, body: z.infer<typeof suaGioSchema>) {
  batNeuTatOnline();
  const r = await apMaTatCaGio(db as never, { parentUserId, maGiamGia: body.maGiamGia, phuongThucGiao: body.phuongThucGiao, revision: body.revision });
  if (!r.ok) nem(r);
  return { revision: r.revision, gio: await gioHienTai(parentUserId) };
}

export async function xoaDongGioMobile(parentUserId: string, itemId: string, revision?: number) {
  batNeuTatOnline();
  if (!itemId || itemId.length > 64) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const r = await xoaDongGio(db as never, { parentUserId, itemId, revision });
  if (!r.ok) nem(r);
  return { revision: r.revision, gio: await gioHienTai(parentUserId) };
}

export async function xoaGioMobile(parentUserId: string, revision?: number) {
  batNeuTatOnline();
  const r = await xoaGio(db as never, { parentUserId, revision });
  if (!r.ok) nem(r);
  return { revision: r.revision, gio: await gioHienTai(parentUserId) };
}

/** POST /parent/cart/checkout — cùng dạng phản hồi `POST /parent/online-orders` (+ `gio` còn lại). Bấm đúp cùng revision ⇒ đơn cũ (`daCo:true`). */
export async function datHangGioMobile(parentUserId: string, body: z.infer<typeof datHangGioSchema>) {
  batNeuTatOnline();
  const r = await datHangTuGio(db as never, { parentUserId, revision: body.revision, itemIds: body.itemIds, xacNhanGiaMoi: body.xacNhanGiaMoi, now: new Date() });
  if (!r.ok) nem(r);
  let don: { orderId: string; orderCode: string; tongTien: number; giamTong: number; dong: unknown[]; dongHocCu?: unknown[]; phiVanChuyen?: number; giuKho?: { hanGiuLuc: string } | null };
  if (r.tao) {
    don = { orderId: r.tao.orderId, orderCode: r.tao.orderCode, tongTien: r.tao.tongTien, giamTong: r.tao.giamTong, dong: r.tao.dong, ...(r.tao.dongHocCu ? { dongHocCu: r.tao.dongHocCu, phiVanChuyen: r.tao.phiVanChuyen ?? 0, giuKho: r.tao.giuKho ?? null } : {}) };
  } else {
    // phát lại: dựng từ chính đơn đã tạo (chỉ đơn của phụ huynh này)
    const d = await docDonOnlineCuaPhuHuynh(db as never, { parentUserId, orderId: r.orderId });
    if (!d) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    // Phát lại trỏ tới đơn ĐÃ HUỶ (revision cũ + đơn đã huỷ không khôi phục giỏ): KHÔNG báo «chờ thanh toán» cho đơn đã chết. 409 — app GET giỏ rồi đặt lại.
    if (d.trangThaiDon === "CANCELLED") throw new LoiApiMobile("DON_DA_HUY" as never, 409, "Đơn của giỏ hàng này đã huỷ — hãy tải lại giỏ hàng.");
    const giamTong = d.dong.reduce((s, x) => s + x.giam, 0);
    don = { orderId: d.orderId, orderCode: d.orderCode, tongTien: d.tongTien, giamTong, dong: d.dong.map((x) => ({ ...x, thanhTien: x.donGia - x.giam })), ...(d.dongHocCu.length ? { dongHocCu: d.dongHocCu, phiVanChuyen: d.phiVanChuyen, giuKho: d.giuKho ? { hanGiuLuc: d.giuKho.hanGiuLuc.toISOString() } : null } : {}) };
  }
  return {
    ...don,
    daCo: r.daCo,
    trangThaiThanhToan: "CHO_THANH_TOAN" as const,
    ...(await huongDanChoDon(don.orderId)),
    gioiHan: GIOI_HAN_THANH_TOAN,
    gioMayChu: new Date().toISOString(),
    // `giuKho` CHỈ có khi đơn có học cụ: DANG_GIU còn hạn · HET_HAN khi hạn đã qua (app KHÔNG tự suy từ đồng hồ máy: đếm ngược = hanGiuLuc − gioMayChu)
    ...(don.giuKho !== undefined ? { giuKho: don.giuKho ? { trangThai: new Date(don.giuKho.hanGiuLuc) > new Date() ? ("DANG_GIU" as const) : ("HET_HAN" as const), hanGiuLuc: don.giuKho.hanGiuLuc } : null } : {}),
    gio: await gioHienTai(parentUserId),
  };
}
