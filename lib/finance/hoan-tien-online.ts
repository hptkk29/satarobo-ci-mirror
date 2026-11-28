import type { PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { thuHoiQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { chiHoanTien } from "@/lib/finance/chi-hoan-tien";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { docSoLieuTranHoanOnline, tinhTranHoanOnline } from "@/lib/finance/hoan-tien-online-tran";
import { guiThongBaoHoanOnline } from "@/lib/finance/hoan-tien-online-thong-bao";
import { LY_DO_RUT_YEU_CAU } from "@/lib/online-checkout/hoan-tien-doc";

/**
 * V8.40 — HOÀN TIỀN ONLINE (PAY-06, Owner 22/11/2026). Dịch vụ dùng chung (mobile phụ huynh + Admin API sau này). KHÔNG có đường nào để CLIENT:
 *   · gửi số tiền · tự duyệt · tự đánh dấu «đã hoàn» · tự thu hồi/cấp lại quyền học.
 * Tái dùng `RefundRequest` (kenh='ONLINE') + `chiHoanTien` (NƠI DUY NHẤT ghi dòng `Payment` âm). Chính sách hoàn v1 = XÉT TAY hoàn toàn (không công thức tự động).
 *   · yêu cầu: một yêu cầu MỞ/dòng (chỉ mục từng phần); phụ huynh KHÔNG gửi số tiền; kênh phụ huynh bật/tắt bằng tham số (người gọi truyền `choPhepPhuHuynh`);
 *   · duyệt: số tiền duyệt BẮT BUỘC, số nguyên > 0, ≤ trần HAI PHÍA (`hoan-tien-online-tran.ts`), tính lại dưới khoá đơn; nhân viên không tự duyệt yêu cầu do mình tạo;
 *   · chi: `chiHoanTien` (trần kiểm lại ở đó, dưới khoá đơn), rồi điều chỉnh quyền học: CHỈ dòng MUA hoàn HẾT và không còn lần cấp khác cho cùng (con × khoá) ⇒ `thuHoiQuyenHoc`; còn lại ⇒ `canXuLyQuyen`.
 * `now` BẮT BUỘC (luật 19). Từ chối = trả `{ ok:false }` TRƯỚC phép ghi đầu tiên; trong giao dịch dùng `throw` khi buộc phải bỏ sau khi ghi (luật 7).
 * `orderId` do client gửi ⇒ tạo/rút kiểm SỞ HỮU trước khi lấy khoá đơn (khoá này dùng chung với tiền vào), rồi vẫn kiểm LẠI dưới khoá.
 */
type Db = PrismaClient;

export const LY_DO_TOI_THIEU = 10;
export const LY_DO_TOI_DA = 500;
export type MaLoiHoanOnline = "KHONG_TIM_THAY" | "DANG_TAT" | "DONG_KHONG_HOP_LE" | "KHONG_RUT_DUOC" | "VALIDATION" | "SAI_TRANG_THAI" | "VUOT_TRAN" | "TU_DUYET" | "KHONG_DU_TIEN";
export type LoiHoanOnline = { ok: false; ma: MaLoiHoanOnline; thongBao: string };
const loi = (ma: MaLoiHoanOnline, thongBao: string): LoiHoanOnline => ({ ok: false, ma, thongBao });

/** Đếm theo code point Unicode sau trim (tiếng Việt có dấu/emoji không bị đếm đôi). */
export const demKyTu = (s: string): number => Array.from(s.trim()).length;
export function kiemLyDo(raw: unknown): { ok: true; lyDo: string } | LoiHoanOnline {
  if (typeof raw !== "string") return loi("VALIDATION", "Cần nhập lý do");
  const lyDo = raw.trim();
  const n = demKyTu(lyDo);
  if (n < LY_DO_TOI_THIEU) return loi("VALIDATION", `Lý do tối thiểu ${LY_DO_TOI_THIEU} ký tự`);
  if (n > LY_DO_TOI_DA) return loi("VALIDATION", `Lý do tối đa ${LY_DO_TOI_DA} ký tự`);
  return { ok: true, lyDo };
}

export type NguonYeuCau = { kenh: "PARENT"; parentUserId: string } | { kenh: "STAFF"; staffId: string; staffName: string };
export type YeuCauHoanDto = { id: string; orderItemId: string; trangThai: "PENDING" | "APPROVED" | "REJECTED" | "PAID" | "RUT"; lyDo: string; lyDoTuChoi: string | null; taoLuc: string; capNhatLuc: string; soTienDuocDuyet: number | null; daHoanLuc: string | null };

const dto = (r: { id: string; orderItemId: string | null; status: string; reason: string; lyDoTuChoi: string | null; createdAt: Date; updatedAt: Date; approvedAmount: number | null; paidAt: Date | null }): YeuCauHoanDto => ({
  id: r.id,
  orderItemId: r.orderItemId ?? "",
  trangThai: r.status as YeuCauHoanDto["trangThai"],
  lyDo: r.reason,
  lyDoTuChoi: r.lyDoTuChoi,
  taoLuc: r.createdAt.toISOString(),
  capNhatLuc: r.updatedAt.toISOString(),
  soTienDuocDuyet: r.status === "APPROVED" || r.status === "PAID" ? r.approvedAmount : null,
  daHoanLuc: r.paidAt ? r.paidAt.toISOString() : null,
});
const CHON = { id: true, orderItemId: true, status: true, reason: true, lyDoTuChoi: true, createdAt: true, updatedAt: true, approvedAmount: true, paidAt: true } as const;

/** Tạo yêu cầu. Đơn phải ONLINE, chưa huỷ/hoàn hết, dòng ONLINE_COURSE còn trần > 0; đã có yêu cầu MỞ cho dòng ⇒ trả lại (daCo). */
export async function taoYeuCauHoanOnline(
  db: Db,
  input: { orderId: string; orderItemId: string; lyDo: unknown; nguon: NguonYeuCau; choPhepPhuHuynh: boolean; now: Date },
): Promise<{ ok: true; daCo: boolean; yeuCau: YeuCauHoanDto } | LoiHoanOnline> {
  const kl = kiemLyDo(input.lyDo);
  if (!kl.ok) return kl;
  if (input.nguon.kenh === "PARENT" && !input.choPhepPhuHuynh) return loi("DANG_TAT", "Chưa mở tính năng gửi yêu cầu hoàn tiền từ ứng dụng");
  const donDuocPhep = { id: input.orderId, type: "ONLINE" as const, deletedAt: null, ...(input.nguon.kenh === "PARENT" ? { createdById: input.nguon.parentUserId } : {}) };
  if (!(await db.order.findFirst({ where: donDuocPhep, select: { id: true } }))) return loi("KHONG_TIM_THAY", "Không tìm thấy đơn");

  return db.$transaction(async (tx): Promise<{ ok: true; daCo: boolean; yeuCau: YeuCauHoanDto } | LoiHoanOnline> => {
    await khoaDonTrongTx(tx, input.orderId);
    const don = await tx.order.findFirst({ where: donDuocPhep, select: { id: true, status: true } });
    if (!don) return loi("KHONG_TIM_THAY", "Không tìm thấy đơn");
    if (don.status === "CANCELLED" || don.status === "DRAFT") return loi("DONG_KHONG_HOP_LE", "Đơn không còn hiệu lực để hoàn tiền");
    const dong = await tx.orderItem.findFirst({ where: { id: input.orderItemId, orderId: don.id, type: "ONLINE_COURSE" }, select: { id: true } });
    if (!dong) return loi("KHONG_TIM_THAY", "Không tìm thấy dòng đơn");

    const mo = await tx.refundRequest.findFirst({ where: { orderItemId: dong.id, kenh: "ONLINE", status: { in: ["PENDING", "APPROVED"] } }, select: CHON });
    if (mo) return { ok: true, daCo: true, yeuCau: dto(mo) };

    const so = await docSoLieuTranHoanOnline(tx, { orderId: don.id, orderItemId: dong.id });
    if (!so || tinhTranHoanOnline(so) <= 0) return loi("DONG_KHONG_HOP_LE", "Dòng này chưa có khoản thu đã xác nhận hoặc đã hoàn hết");

    const nguoi = input.nguon.kenh === "PARENT" ? input.nguon.parentUserId : input.nguon.staffId;
    const tao = await tx.refundRequest.create({
      data: {
        orderItemId: dong.id,
        trigger: "MANUAL",
        reason: kl.lyDo,
        paidConfirmed: so.daThuXacNhanDon,
        sessionsTotal: 0,
        sessionsLearned: 0,
        unitPrice: so.thucTraDong,
        proposedAmount: 0, // v1 xét tay: KHÔNG có số đề xuất tự động
        status: "PENDING",
        requestedById: nguoi,
        kenh: "ONLINE",
        kenhYeuCau: input.nguon.kenh,
        centerId: null,
        orgUnitId: null,
      },
      select: CHON,
    });
    await writeAudit({ tx, actor: { id: nguoi, name: input.nguon.kenh === "STAFF" ? input.nguon.staffName : "Phụ huynh" }, module: "finance", entityType: "RefundRequest", entityId: tao.id, action: "CREATE", newValues: { kenh: "ONLINE", kenhYeuCau: input.nguon.kenh, orderId: don.id, orderItemId: dong.id }, reason: kl.lyDo, orgUnitId: null });
    return { ok: true, daCo: false, yeuCau: dto(tao) };
  });
}

/** Phụ huynh rút yêu cầu khi còn PENDING (đã APPROVED/PAID/REJECTED ⇒ KHONG_RUT_DUOC; rút lặp ⇒ ok). Rút = xoá mềm bằng trạng thái REJECTED + lý do «Phụ huynh rút». */
export async function rutYeuCauHoanOnline(db: Db, input: { parentUserId: string; orderId: string; id: string; now: Date }): Promise<{ ok: true; daRut: true } | LoiHoanOnline> {
  const cuaMinh = { id: input.id, kenh: "ONLINE", orderItem: { orderId: input.orderId, order: { createdById: input.parentUserId, type: "ONLINE" as const } } };
  if (!(await db.refundRequest.findFirst({ where: cuaMinh, select: { id: true } }))) return loi("KHONG_TIM_THAY", "Không tìm thấy yêu cầu");
  return db.$transaction(async (tx): Promise<{ ok: true; daRut: true } | LoiHoanOnline> => {
    await khoaDonTrongTx(tx, input.orderId);
    const r = await tx.refundRequest.findFirst({ where: cuaMinh, select: { id: true, status: true, lyDoTuChoi: true, kenhYeuCau: true } });
    if (!r) return loi("KHONG_TIM_THAY", "Không tìm thấy yêu cầu");
    if (r.status === "REJECTED" && r.lyDoTuChoi === LY_DO_PHU_HUYNH_RUT) return { ok: true, daRut: true };
    if (r.status !== "PENDING") return loi("KHONG_RUT_DUOC", "Yêu cầu đã được xử lý — không thể rút");
    const x = await tx.refundRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "REJECTED", lyDoTuChoi: LY_DO_PHU_HUYNH_RUT } });
    if (x.count === 0) return loi("KHONG_RUT_DUOC", "Yêu cầu vừa được xử lý — không thể rút");
    await writeAudit({ tx, actor: { id: input.parentUserId, name: "Phụ huynh" }, module: "finance", entityType: "RefundRequest", entityId: r.id, action: "STATUS_CHANGE", oldValues: { status: "PENDING" }, newValues: { status: "REJECTED", lyDo: LY_DO_PHU_HUYNH_RUT }, orgUnitId: null });
    return { ok: true, daRut: true };
  });
}
export const LY_DO_PHU_HUYNH_RUT = LY_DO_RUT_YEU_CAU;

/** Các yêu cầu hoàn ONLINE của một đơn (cho phụ huynh — chỉ trường được phép lộ). */
export async function docYeuCauHoanOnlineCuaDon(db: Db, input: { parentUserId: string; orderId: string }): Promise<YeuCauHoanDto[] | null> {
  const don = await db.order.findFirst({ where: { id: input.orderId, type: "ONLINE", createdById: input.parentUserId, deletedAt: null }, select: { id: true } });
  if (!don) return null;
  const ds = await db.refundRequest.findMany({ where: { kenh: "ONLINE", orderItem: { orderId: don.id } }, orderBy: { createdAt: "desc" }, select: CHON });
  return ds.map(dto);
}

/** DUYỆT. `soTienDuyet` BẮT BUỘC (không mặc định). Trần hai phía tính lại DƯỚI khoá đơn; ghi có điều kiện PENDING→APPROVED. */
export async function duyetHoanOnline(db: Db, input: { id: string; approverId: string; approverName: string; soTienDuyet: unknown; now: Date }): Promise<{ ok: true; soTienDuyet: number } | LoiHoanOnline> {
  const kq = await duyetHoanOnlineLoi(db, input);
  if (kq.ok) await guiThongBaoHoanOnline(db, { yeuCauId: input.id, trangThai: "DA_DUYET" });
  return kq;
}

async function duyetHoanOnlineLoi(db: Db, input: { id: string; approverId: string; approverName: string; soTienDuyet: unknown; now: Date }): Promise<{ ok: true; soTienDuyet: number } | LoiHoanOnline> {
  const st = input.soTienDuyet;
  if (typeof st !== "number" || !Number.isInteger(st) || st <= 0) return loi("VALIDATION", "Số tiền duyệt phải là số nguyên đồng lớn hơn 0");
  return db.$transaction(async (tx): Promise<{ ok: true; soTienDuyet: number } | LoiHoanOnline> => {
    const r0 = await tx.refundRequest.findFirst({ where: { id: input.id, kenh: "ONLINE" }, select: { orderItemId: true, orderItem: { select: { orderId: true } } } });
    if (!r0?.orderItemId || !r0.orderItem) return loi("KHONG_TIM_THAY", "Không tìm thấy yêu cầu hoàn tiền");
    await khoaDonTrongTx(tx, r0.orderItem.orderId);
    const r = await tx.refundRequest.findUniqueOrThrow({ where: { id: input.id }, select: { id: true, status: true, requestedById: true, kenhYeuCau: true, orderItemId: true } });
    if (r.status !== "PENDING") return loi("SAI_TRANG_THAI", `Yêu cầu đang ${r.status} — không thể duyệt`);
    if (r.kenhYeuCau === "STAFF" && r.requestedById === input.approverId) return loi("TU_DUYET", "Người tạo yêu cầu không được tự duyệt");
    const so = await docSoLieuTranHoanOnline(tx, { orderId: r0.orderItem.orderId, orderItemId: r.orderItemId!, boQuaYeuCauId: r.id });
    if (!so) return loi("KHONG_TIM_THAY", "Không tìm thấy dòng đơn");
    const tran = tinhTranHoanOnline(so);
    if (st > tran) return loi("VUOT_TRAN", `Số tiền duyệt vượt mức tối đa có thể hoàn (${tran.toLocaleString("vi-VN")} đ)`);
    const x = await tx.refundRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "APPROVED", approvedAmount: st, approvedById: input.approverId, approvedAt: input.now } });
    if (x.count === 0) return loi("SAI_TRANG_THAI", "Yêu cầu vừa được người khác xử lý — tải lại");
    await writeAudit({ tx, actor: { id: input.approverId, name: input.approverName }, module: "finance", entityType: "RefundRequest", entityId: r.id, action: "STATUS_CHANGE", oldValues: { status: "PENDING" }, newValues: { status: "APPROVED", approvedAmount: st, tran }, changedFields: ["status", "approvedAmount"], orgUnitId: null });
    return { ok: true, soTienDuyet: st };
  });
}

export async function tuChoiHoanOnline(db: Db, input: { id: string; approverId: string; approverName: string; lyDoTuChoi: unknown; now: Date }): Promise<{ ok: true } | LoiHoanOnline> {
  const kq = await tuChoiHoanOnlineLoi(db, input);
  if (kq.ok) await guiThongBaoHoanOnline(db, { yeuCauId: input.id, trangThai: "TU_CHOI" });
  return kq;
}

async function tuChoiHoanOnlineLoi(db: Db, input: { id: string; approverId: string; approverName: string; lyDoTuChoi: unknown; now: Date }): Promise<{ ok: true } | LoiHoanOnline> {
  const kl = kiemLyDo(input.lyDoTuChoi);
  if (!kl.ok) return kl;
  return db.$transaction(async (tx): Promise<{ ok: true } | LoiHoanOnline> => {
    const r0 = await tx.refundRequest.findFirst({ where: { id: input.id, kenh: "ONLINE" }, select: { orderItem: { select: { orderId: true } } } });
    if (!r0?.orderItem) return loi("KHONG_TIM_THAY", "Không tìm thấy yêu cầu hoàn tiền");
    await khoaDonTrongTx(tx, r0.orderItem.orderId);
    const x = await tx.refundRequest.updateMany({ where: { id: input.id, status: "PENDING" }, data: { status: "REJECTED", lyDoTuChoi: kl.lyDo, approvedById: input.approverId, approvedAt: input.now } });
    if (x.count === 0) return loi("SAI_TRANG_THAI", "Yêu cầu không còn ở trạng thái chờ duyệt");
    await writeAudit({ tx, actor: { id: input.approverId, name: input.approverName }, module: "finance", entityType: "RefundRequest", entityId: input.id, action: "STATUS_CHANGE", oldValues: { status: "PENDING" }, newValues: { status: "REJECTED" }, reason: kl.lyDo, orgUnitId: null });
    return { ok: true };
  });
}

export type KetQuaChiHoanOnline = { ok: true; orderId: string; soTien: number; paymentIds: string[]; quyen: { daThuHoi: boolean; canXuLyTay: boolean } } | LoiHoanOnline;

/** CHI HOÀN (đối soát): qua `chiHoanTien` (ghi dòng Payment âm, trần kiểm lại dưới khoá đơn), rồi điều chỉnh quyền học. Gọi lại khi bước quyền lỗi ⇒ chạy lại bước quyền, không chi lần hai. */
export async function chiHoanOnline(
  db: Db,
  input: { id: string; actorId: string; actorName: string; method: string; paidDate: Date; maGiaoDichHoan?: string | null; note?: string | null; now: Date },
): Promise<KetQuaChiHoanOnline> {
  const r = await db.refundRequest.findFirst({ where: { id: input.id, kenh: "ONLINE" }, select: { id: true, status: true, approvedAmount: true, orderItemId: true, orderItem: { select: { orderId: true } } } });
  if (!r?.orderItem || !r.orderItemId) return loi("KHONG_TIM_THAY", "Không tìm thấy yêu cầu hoàn tiền");
  const orderId = r.orderItem.orderId;
  let paymentIds: string[] = [];
  const soTien = r.approvedAmount ?? 0;
  if (r.status === "APPROVED") {
    try {
      const kq = await chiHoanTien({ refundRequestId: r.id, actorId: input.actorId, actorName: input.actorName, method: input.method, paidDate: input.paidDate, note: input.note ?? null, maGiaoDichHoan: input.maGiaoDichHoan ?? null });
      paymentIds = kq.paymentIds;
    } catch (e) {
      const m = (e as { code?: string; message?: string }) ?? {};
      if (m.code === "INSUFFICIENT") return loi("KHONG_DU_TIEN", m.message ?? "Không đủ tiền đã thu để hoàn");
      if (m.code === "INVALID_STATE") {
        // hai lượt chi đua nhau: lượt sau thấy yêu cầu đã PAID ⇒ coi là phát lại (không chi lần hai), vẫn chạy bước quyền
        const nay = await db.refundRequest.findUnique({ where: { id: r.id }, select: { status: true } });
        if (nay?.status !== "PAID") return loi("SAI_TRANG_THAI", m.message ?? "Yêu cầu không còn ở trạng thái đã duyệt");
        paymentIds = (await db.payment.findMany({ where: { refundRequestId: r.id }, select: { id: true } })).map((p) => p.id);
      } else {
        throw e;
      }
    }
  } else if (r.status !== "PAID") {
    return loi("SAI_TRANG_THAI", `Yêu cầu đang ${r.status} — chỉ chi được yêu cầu ĐÃ DUYỆT`);
  }
  const quyen = await dieuChinhQuyenSauHoan(db, { id: r.id, actorId: input.actorId, now: input.now });
  await guiThongBaoHoanOnline(db, { yeuCauId: r.id, trangThai: "DA_HOAN" }); // idempotent theo (yêu cầu, trạng thái)
  return { ok: true, orderId, soTien, paymentIds, quyen };
}

/** Điều chỉnh quyền học sau chi hoàn. Idempotent. CHỈ thu hồi khi: dòng MUA, hoàn HẾT thực trả của dòng, và không còn lần cấp nào khác cho cùng (con × khoá). Còn lại ⇒ `canXuLyQuyen`. */
export async function dieuChinhQuyenSauHoan(db: Db, input: { id: string; actorId: string; now: Date }): Promise<{ daThuHoi: boolean; canXuLyTay: boolean }> {
  const rr = await db.refundRequest.findUnique({ where: { id: input.id }, select: { id: true, status: true, quyenDaThuHoiLuc: true, orderItemId: true } });
  if (!rr || rr.status !== "PAID" || !rr.orderItemId) return { daThuHoi: false, canXuLyTay: false };
  if (rr.quyenDaThuHoiLuc) return { daThuHoi: true, canXuLyTay: false };
  const dong = await db.orderItem.findUnique({ where: { id: rr.orderItemId }, select: { id: true, orderId: true, studentId: true, onlineCourseId: true, unitPrice: true, discountAmount: true, quantity: true, metadata: true, onlineGrant: { select: { status: true } } } });
  if (!dong) return { daThuHoi: false, canXuLyTay: true };
  const daHoan = (await db.refundRequest.aggregate({ where: { kenh: "ONLINE", status: "PAID", orderItemId: dong.id }, _sum: { approvedAmount: true } }))._sum.approvedAmount ?? 0;
  const hoanHet = daHoan >= dong.unitPrice * dong.quantity - dong.discountAmount;
  const loaiMua = (dong.metadata as { loaiMua?: string } | null)?.loaiMua === "GIA_HAN" ? "GIA_HAN" : "MUA";
  const khacConCap = dong.studentId && dong.onlineCourseId
    ? await db.orderOnlineGrant.count({ where: { studentId: dong.studentId, courseId: dong.onlineCourseId, status: "GRANTED", orderItemId: { not: dong.id }, orderItem: { order: { status: { notIn: ["CANCELLED", "REFUNDED"] } } } } })
    : 1;
  let daThuHoi = false;
  if (loaiMua === "MUA" && hoanHet && khacConCap === 0 && dong.studentId && dong.onlineCourseId && dong.onlineGrant?.status === "GRANTED") {
    const kq = await thuHoiQuyenHoc(db as never, { studentId: dong.studentId, courseId: dong.onlineCourseId, reason: `Hoàn tiền đơn Online (yêu cầu ${rr.id})`, idempotencyKey: `hoan-online:${rr.id}`, now: input.now, actorUserId: input.actorId });
    daThuHoi = kq.ok;
  }
  // chưa có quyền được cấp (đơn chưa cấp) ⇒ không có gì để thu hồi, cũng không cần xử lý tay
  const khongCoQuyen = dong.onlineGrant?.status !== "GRANTED";
  const canXuLyTay = !daThuHoi && !khongCoQuyen;
  await db.refundRequest.update({ where: { id: rr.id }, data: { ...(daThuHoi ? { quyenDaThuHoiLuc: input.now } : {}), canXuLyQuyen: canXuLyTay } });
  // tất cả dòng của đơn đã hoàn hết ⇒ đơn REFUNDED
  const tatCa = await db.orderItem.findMany({ where: { orderId: dong.orderId }, select: { id: true, unitPrice: true, discountAmount: true, quantity: true } });
  const sum = await db.refundRequest.groupBy({ by: ["orderItemId"], where: { kenh: "ONLINE", status: "PAID", orderItem: { orderId: dong.orderId } }, _sum: { approvedAmount: true } });
  const theoDong = new Map(sum.map((s) => [s.orderItemId, s._sum.approvedAmount ?? 0]));
  if (tatCa.length > 0 && tatCa.every((d) => (theoDong.get(d.id) ?? 0) >= d.unitPrice * d.quantity - d.discountAmount)) {
    const o = await db.order.updateMany({ where: { id: dong.orderId, status: { in: ["CONFIRMED", "COMPLETED", "PENDING_PAYMENT"] } }, data: { status: "REFUNDED" } });
    if (o.count > 0) await db.orderStatusHistory.create({ data: { orderId: dong.orderId, fromStatus: "CONFIRMED", toStatus: "REFUNDED", changedByUserId: input.actorId, changedByName: "Hoàn tiền Online", reason: `Đã hoàn hết các dòng (yêu cầu ${rr.id})` } as never });
  }
  return { daThuHoi, canXuLyTay };
}
