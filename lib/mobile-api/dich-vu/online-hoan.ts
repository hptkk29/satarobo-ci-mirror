import { z } from "zod";

import { db } from "@/lib/db";
import { rutYeuCauHoanOnline, taoYeuCauHoanOnline, docYeuCauHoanOnlineCuaDon, type LoiHoanOnline } from "@/lib/finance/hoan-tien-online";
import { getSetting } from "@/lib/settings/service";

import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { batNeuTatOnline } from "./online-hoc";

/**
 * V8.40 — HOÀN TIỀN ONLINE phía phụ huynh (PAY-06): lớp HTTP MỎNG trên `lib/finance/hoan-tien-online.ts`. KHÔNG có đường nào để client gửi SỐ TIỀN, tự duyệt, đánh dấu đã hoàn hay thu hồi quyền.
 *   · `parentUserId` từ PHIÊN; đơn phải của chính phụ huynh (khác ⇒ 404); Student Mode ⇒ 403 (route không nằm trong allow-list); cờ Online tắt ⇒ 404;
 *   · thân `.strict()` = { orderItemId, lyDo } (không `bangChung`, không số tiền);
 *   · GET LUÔN 200 (xem yêu cầu cũ kể cả khi kênh gửi đang tắt); chỉ POST bị `HOAN_TIEN_DANG_TAT`;
 *   · chỉ trả trường được phép lộ: trạng thái, lý do của CHÍNH họ, lý do từ chối, số tiền được duyệt, thời điểm — không người duyệt/ghi chú nội bộ/mã giao dịch hoàn.
 */
export const guiYeuCauHoanSchema = z.object({ orderItemId: z.string().min(1).max(64), lyDo: z.string().max(2000) }).strict();
export const rutYeuCauHoanSchema = z.object({}).strict();

const HTTP_HOAN: Record<LoiHoanOnline["ma"], { status: number; code: string }> = {
  KHONG_TIM_THAY: { status: 404, code: "NOT_FOUND" },
  DANG_TAT: { status: 409, code: "HOAN_TIEN_DANG_TAT" },
  DONG_KHONG_HOP_LE: { status: 409, code: "HOAN_TIEN_DONG_KHONG_HOP_LE" },
  KHONG_RUT_DUOC: { status: 409, code: "HOAN_TIEN_KHONG_RUT_DUOC" },
  VALIDATION: { status: 400, code: "VALIDATION" },
  SAI_TRANG_THAI: { status: 409, code: "HOAN_TIEN_SAI_TRANG_THAI" },
  VUOT_TRAN: { status: 409, code: "HOAN_TIEN_VUOT_TRAN" },
  TU_DUYET: { status: 403, code: "HOAN_TIEN_TU_DUYET" },
  KHONG_DU_TIEN: { status: 409, code: "HOAN_TIEN_KHONG_DU_TIEN" },
};

function nem(r: LoiHoanOnline): never {
  const m = HTTP_HOAN[r.ma];
  if (r.ma === "KHONG_TIM_THAY") throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  throw new LoiApiMobile(m.code as never, m.status, r.thongBao);
}

export const choPhepGuiYeuCauHoan = async (): Promise<boolean> => (await getSetting("onlineRefund.parentRequestEnabled")) === true;

export async function guiYeuCauHoanMobile(parentUserId: string, orderId: string, body: z.infer<typeof guiYeuCauHoanSchema>) {
  batNeuTatOnline();
  if (!orderId || orderId.length > 64) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const r = await taoYeuCauHoanOnline(db as never, { orderId, orderItemId: body.orderItemId, lyDo: body.lyDo, nguon: { kenh: "PARENT", parentUserId }, choPhepPhuHuynh: await choPhepGuiYeuCauHoan(), now: new Date() });
  if (!r.ok) nem(r);
  return { daCo: r.daCo, yeuCau: r.yeuCau };
}

export async function xemYeuCauHoanMobile(parentUserId: string, orderId: string) {
  batNeuTatOnline();
  if (!orderId || orderId.length > 64) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const ds = await docYeuCauHoanOnlineCuaDon(db as never, { parentUserId, orderId });
  if (!ds) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  return { muc: ds.map((y) => ({ ...y, trangThai: y.trangThai === "REJECTED" && y.lyDoTuChoi === "Phụ huynh đã rút yêu cầu" ? ("RUT" as const) : y.trangThai })) };
}

export async function rutYeuCauHoanMobile(parentUserId: string, orderId: string, id: string) {
  batNeuTatOnline();
  if (!orderId || orderId.length > 64 || !id || id.length > 64) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const r = await rutYeuCauHoanOnline(db as never, { parentUserId, orderId, id, now: new Date() });
  if (!r.ok) nem(r);
  return { daRut: true as const };
}
