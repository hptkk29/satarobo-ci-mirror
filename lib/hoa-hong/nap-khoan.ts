// lib/hoa-hong/nap-khoan.ts — NẠP dữ liệu của MỘT khoản thu (CHỈ ĐỌC). Hàm quyết định nằm ở các tệp thuần.
//
// Nguồn: docs/source-commission/04 L11 (hàm DB chỉ nạp + ghi), §4 (cơ sở tính). Client KHÔNG scope — engine hoa hồng là việc toàn
// hệ, không theo tầm nhìn cơ sở của người bấm (cùng lý do `lib/crm/commission-run.ts`).
import type { Prisma, PrismaClient } from "@prisma/client";

import { TRANG_THAI_THUC_THU, WHERE_THUC_THU } from "@/lib/finance/thuc-thu";

import type { HangButToan } from "./but-toan";
import type { DongDonPhanBo } from "./phan-bo-khoan";
import { tinhConNoTheoDongTruocKhoan } from "./phan-bo-khoan";

export type Khach = PrismaClient | Prisma.TransactionClient;

export const SELECT_KHOAN = {
  id: true,
  orderId: true,
  orderItemId: true,
  enrollmentId: true,
  amount: true,
  method: true,
  note: true,
  paidDate: true,
  confirmedAt: true,
  accountantStatus: true,
  paymentType: true,
  adjustmentOfId: true,
  centerId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  adjustmentOf: { select: { id: true, paidDate: true, confirmedAt: true, centerId: true, orderItemId: true, enrollmentId: true } },
  enrollment: { select: { studentId: true } },
  order: {
    select: {
      id: true,
      type: true,
      status: true,
      leadId: true,
      leadChildId: true,
      centerId: true,
      orgUnitId: true,
      createdAt: true,
      lead: { select: { centerId: true } },
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          type: true,
          status: true,
          enrollmentId: true,
          studentId: true,
          totalPrice: true,
          discountAmount: true,
          usedValue: true,
          enrollment: { select: { studentId: true } },
        },
      },
    },
  },
} satisfies Prisma.PaymentSelect;

export type KhoanNap = Prisma.PaymentGetPayload<{ select: typeof SELECT_KHOAN }>;

/** `Payment` → hình dạng `HangButToan` mà các hàm thuần dùng. */
export function hangButToanCua(p: KhoanNap): HangButToan {
  return {
    id: p.id,
    amount: p.amount,
    method: p.method,
    note: p.note,
    paidDate: p.paidDate,
    confirmedAt: p.confirmedAt,
    accountantStatus: p.accountantStatus,
    paymentType: p.paymentType,
    adjustmentOfId: p.adjustmentOfId,
    orderId: p.orderId,
    orderItemId: p.orderItemId,
    enrollmentId: p.enrollmentId,
    centerId: p.centerId,
    adjustmentOf: p.adjustmentOf
      ? { id: p.adjustmentOf.id, paidDate: p.adjustmentOf.paidDate, confirmedAt: p.adjustmentOf.confirmedAt, centerId: p.adjustmentOf.centerId }
      : null,
    order: p.order ? { centerId: p.order.centerId, lead: p.order.lead } : null,
  };
}

export async function docKhoan(client: Khach, paymentId: string): Promise<KhoanNap | null> {
  return client.payment.findUnique({ where: { id: paymentId }, select: SELECT_KHOAN });
}

/** Khoản có còn thuộc `WHERE_THUC_THU` không — bản bộ nhớ của ĐÚNG hằng đó (không viết bộ lọc thứ hai). */
export function conThucThu(p: Pick<KhoanNap, "deletedAt" | "accountantStatus">): boolean {
  return p.deletedAt === null && (TRANG_THAI_THUC_THU as readonly string[]).includes(p.accountantStatus);
}

/** Phải thu của một dòng đơn (04 §4.3 bước 3): dừng học ⇒ giá trị quyết toán; còn lại giá − giảm. */
export function phaiThuCuaDong(d: { status: string; totalPrice: number; discountAmount: number; usedValue: number | null }): number {
  return d.status === "STOPPED" ? Math.max(0, d.usedValue ?? 0) : Math.max(0, d.totalPrice - d.discountAmount);
}

/** Dòng đơn → hình dạng của `phanBoKhoan`. */
export function dongPhanBoCua(o: NonNullable<KhoanNap["order"]>): DongDonPhanBo[] {
  return o.items.map((d) => ({
    orderItemId: d.id,
    loai: d.type,
    enrollmentId: d.enrollmentId,
    studentId: d.studentId,
    enrollmentStudentId: d.enrollment?.studentId ?? null,
  }));
}

/** `Student.id` khi `Order.leadChildId` khớp ĐÚNG MỘT học viên; ngược lại `null` (mơ hồ ⇒ không đoán). */
export async function docHocVienTheoLeadChild(client: Khach, leadChildId: string | null): Promise<string | null> {
  if (!leadChildId) return null;
  const khop = await client.student.findMany({ where: { leadChildId, deletedAt: null }, select: { id: true }, take: 2 });
  return khop.length === 1 ? khop[0]!.id : null;
}

/**
 * Còn nợ từng dòng TRƯỚC khoản `p` (04 §4.3 bước 3). Chỉ khoản THU dương đứng TRƯỚC `(paidDate, id)` của `p` tham gia;
 * khoản không gắn dòng được quy cho thành phần bằng chính `phanBoKhoan` (tuần tự) — xem `tinhConNoTheoDongTruocKhoan`.
 */
export async function docConNoTheoDong(client: Khach, p: KhoanNap, hocVienTheoLeadChild: string | null): Promise<ReadonlyMap<string, number>> {
  const o = p.order;
  if (!o || o.items.length === 0) return new Map();
  const truoc = await client.payment.findMany({
    where: {
      ...WHERE_THUC_THU,
      orderId: o.id,
      id: { not: p.id },
      amount: { gt: 0 },
      OR: [{ paidDate: { lt: p.paidDate } }, { paidDate: p.paidDate, id: { lt: p.id } }],
    },
    orderBy: [{ paidDate: "asc" }, { id: "asc" }],
    select: { id: true, amount: true, orderItemId: true, enrollmentId: true, enrollment: { select: { studentId: true } } },
  });
  return tinhConNoTheoDongTruocKhoan({
    dong: o.items.map((d) => ({
      ...dongPhanBoCua(o).find((x) => x.orderItemId === d.id)!,
      phaiThu: phaiThuCuaDong(d),
    })),
    khoanTruoc: truoc.map((t) => ({
      amount: t.amount,
      orderItemId: t.orderItemId,
      enrollmentId: t.enrollmentId,
      enrollmentStudentId: t.enrollment?.studentId ?? null,
    })),
    orderType: o.type,
    hocVienTheoLeadChild,
  });
}

/** Ngày thu ĐẦU TIÊN của lần mua (04 §7.3): mốc so với cửa sổ ghi công. Lùi về chính `p` khi không có khoản nào sớm hơn. */
export async function docNgayThuDau(client: Khach, p: KhoanNap, orderItemId: string | null): Promise<Date> {
  const r = await client.payment.aggregate({
    where: { ...WHERE_THUC_THU, orderId: p.orderId, amount: { gt: 0 }, ...(orderItemId ? { orderItemId } : {}) },
    _min: { paidDate: true },
  });
  const min = r._min.paidDate;
  return min !== null && min.getTime() < p.paidDate.getTime() ? min : p.paidDate;
}

/** OrgUnit (CENTER) của một cơ sở — `null` nếu cơ sở chưa có đơn vị tương ứng (⇒ hàng chờ NO_ORG_UNIT). */
export async function docDonViCuaCoSo(client: Khach, centerId: string): Promise<{ orgUnitId: string; path: string } | null> {
  const ou = await client.orgUnit.findFirst({ where: { centerId, deletedAt: null }, select: { id: true, path: true } });
  return ou && ou.path ? { orgUnitId: ou.id, path: ou.path } : null;
}
