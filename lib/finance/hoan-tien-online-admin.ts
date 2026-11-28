import type { PrismaClient } from "@prisma/client";

import { resolveActor, type Actor } from "@/lib/auth/actor";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { coQuyenToanHeThong } from "@/lib/auth/quyen-tai-co-so";
import type { LoiHoanOnline } from "@/lib/finance/hoan-tien-online";

/**
 * V8.40 — ADMIN API HOÀN TIỀN ONLINE (PAY-06). Online KHÔNG thuộc cơ sở ⇒ chỉ ai giữ CHÍNH `payments:confirm` ở TẦM TOÀN HỆ và ở cấp HỘI SỞ (hoặc Quản trị tối cao) mới thấy/làm.
 * «Có MỘT vai nào đó neo ở Hội sở» KHÔNG đủ: kế toán cơ sở kiêm một vai Hội sở khác từng lọt cổng bằng `payments:confirm` của cơ sở + `isHoLevel` của vai kia.
 * Không so chuỗi vai: Quản trị tối cao đọc từ `actor.isSuperAdmin` (dựng từ `UserOrgRole` SUPER_ADMIN neo Hội sở).
 */
type Db = PrismaClient;

export type NguoiQuanLyHoan = { id: string; ten: string };

const KHOA_HOAN_ONLINE = "payments:confirm";

/**
 * THUẦN — "người này có thẩm quyền trên tiền hoàn đơn Online không" (phạm vi, KHÔNG thay `checkPermission`: nơi gọi vẫn phải hỏi cửa quyền trước).
 * `coQuyenToanHeThong`: Quản trị tối cao · grant ALLOW per-user (toàn hệ theo thiết kế) · dòng quyền của CHÍNH khoá này có `centerScope === "ALL"` (vai neo Hội sở).
 * Vế `isHoLevel` giữ cho đường grant per-user: người không neo ở Hội sở vẫn không vào dù được cấp riêng khoá.
 * MỘT chỗ duy nhất — Admin API, màn `/admin/hoan-tien` và `refundPaymentAction` cùng hỏi hàm này.
 */
export function duocQuanLyHoanOnline(actor: Pick<Actor, "isSuperAdmin" | "isHoLevel" | "grantsAllow" | "permissions">): boolean {
  return actor.isSuperAdmin || (actor.isHoLevel && coQuyenToanHeThong(actor, KHOA_HOAN_ONLINE));
}

export async function nguoiQuanLyHoanOnline(): Promise<{ ok: true; nguoi: NguoiQuanLyHoan } | { ok: false; status: 401 | 403; ma: "UNAUTHENTICATED" | "FORBIDDEN" }> {
  const s = await auth();
  const u = s?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  if (!u?.id) return { ok: false, status: 401, ma: "UNAUTHENTICATED" };
  if (!(await checkPermission(KHOA_HOAN_ONLINE))) return { ok: false, status: 403, ma: "FORBIDDEN" };
  if (!duocQuanLyHoanOnline(await resolveActor(u.id))) return { ok: false, status: 403, ma: "FORBIDDEN" };
  return { ok: true, nguoi: { id: u.id, ten: u.name ?? u.email ?? u.id } };
}

export const HTTP_LOI_HOAN: Record<LoiHoanOnline["ma"], number> = {
  KHONG_TIM_THAY: 404,
  DANG_TAT: 409,
  DONG_KHONG_HOP_LE: 422,
  KHONG_RUT_DUOC: 409,
  VALIDATION: 400,
  SAI_TRANG_THAI: 409,
  VUOT_TRAN: 422,
  TU_DUYET: 403,
  KHONG_DU_TIEN: 422,
};

const TRANG_THAI = ["PENDING", "APPROVED", "PAID", "REJECTED"] as const;
export type LocTrangThaiHoan = (typeof TRANG_THAI)[number];
export const laTrangThaiHoan = (v: string): v is LocTrangThaiHoan => (TRANG_THAI as readonly string[]).includes(v);

const CHON = {
  id: true,
  status: true,
  kenhYeuCau: true,
  reason: true,
  lyDoTuChoi: true,
  proposedAmount: true,
  approvedAmount: true,
  maGiaoDichHoan: true,
  quyenDaThuHoiLuc: true,
  canXuLyQuyen: true,
  approvedAt: true,
  paidAt: true,
  paidMethod: true,
  createdAt: true,
  orderItem: { select: { id: true, unitPrice: true, quantity: true, discountAmount: true, order: { select: { id: true, code: true, status: true } }, student: { select: { id: true, name: true } } } },
} as const;

type Dong = {
  id: string;
  status: string;
  kenhYeuCau: string | null;
  reason: string;
  lyDoTuChoi: string | null;
  proposedAmount: number;
  approvedAmount: number | null;
  maGiaoDichHoan: string | null;
  quyenDaThuHoiLuc: Date | null;
  canXuLyQuyen: boolean;
  approvedAt: Date | null;
  paidAt: Date | null;
  paidMethod: string | null;
  createdAt: Date;
  orderItem: { id: string; unitPrice: number; quantity: number; discountAmount: number; order: { id: string; code: string; status: string }; student: { id: string; name: string } | null } | null;
};

function dto(r: Dong) {
  const d = r.orderItem;
  return {
    id: r.id,
    trangThai: r.status,
    kenhYeuCau: r.kenhYeuCau,
    lyDoPhuHuynh: r.reason,
    lyDoTuChoi: r.lyDoTuChoi,
    soTienDuyet: r.approvedAmount,
    maGiaoDichHoan: r.maGiaoDichHoan,
    phuongThucChi: r.paidMethod,
    quyenDaThuHoi: r.quyenDaThuHoiLuc !== null,
    canXuLyQuyen: r.canXuLyQuyen,
    duyetLuc: r.approvedAt?.toISOString() ?? null,
    chiLuc: r.paidAt?.toISOString() ?? null,
    taoLuc: r.createdAt.toISOString(),
    don: d ? { id: d.order.id, ma: d.order.code, trangThai: d.order.status } : null,
    dong: d ? { id: d.id, thucTra: d.unitPrice * d.quantity - d.discountAmount, hocVien: d.student ? { id: d.student.id, ten: d.student.name } : null } : null,
  };
}

export type HoanOnlineAdminDto = ReturnType<typeof dto>;

export async function docDanhSachHoanOnline(db: Db, input: { trangThai?: LocTrangThaiHoan; trang: number; soLuong: number }): Promise<{ muc: HoanOnlineAdminDto[]; tong: number }> {
  const where = { kenh: "ONLINE", ...(input.trangThai ? { status: input.trangThai } : {}) } as const;
  const [rows, tong] = await Promise.all([
    db.refundRequest.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.trang - 1) * input.soLuong, take: input.soLuong, select: CHON }),
    db.refundRequest.count({ where }),
  ]);
  return { muc: (rows as unknown as Dong[]).map(dto), tong };
}

export async function docChiTietHoanOnline(db: Db, id: string): Promise<HoanOnlineAdminDto | null> {
  const r = await db.refundRequest.findFirst({ where: { id, kenh: "ONLINE" }, select: CHON });
  return r ? dto(r as unknown as Dong) : null;
}
