import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Phiên giả lập; quyền + tầm nhìn đi ĐƯỜNG THẬT (RoleDef/UserOrgRole/UserPermissionGrant thật) — không mock `resolveActor` hay `checkPermission`.
type PhienGia = { user: { id: string; name: string; email: string; role: string; roles: string[]; grants?: { action: string; grant: "ALLOW" | "DENY" }[] } };
let phien: PhienGia | null = null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => phien), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { ganGiaoDichTheoConAction, goGanGiaoDichAction } from "@/app/(admin)/admin/bien-dong-so-du/_gan-theo-con";
import {
  boGanKhoanChoConAction,
  changeOrderStatusAction,
  chuyenTienGiuaConAction,
  dongPhieuGopAction,
  ganKhoanChoConAction,
  markOrderInstallmentPaidAction,
  mienGiamNoAction,
  taoDotChoConAction,
  themConVaoDonAction,
  updateOrderNoteAction,
  updateOrderPaymentMethodAction,
} from "@/app/(admin)/admin/orders/_actions";
import { adjustPaymentAction, confirmPaymentAction, recordPaymentAction, rejectPaymentAction, updatePendingPaymentAction } from "@/app/(admin)/admin/payments/_actions";
import { resolveActor } from "@/lib/auth/actor";
import { tamNhinCuaKhoa } from "@/lib/auth/quyen-tai-co-so";
import { db } from "@/lib/db";
import { donOnlineDaThuDu } from "@/lib/online-checkout/cap-quyen-sau-thanh-toan";
import { KHOA_CONG_TAC } from "@/lib/finance/feature";
import { setGlobalSetting } from "@/lib/settings/service";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

/**
 * [TTO-DB] THAO TÁC TIỀN / TRẠNG THÁI trên đơn ONLINE — RBAC v1 + v2.
 *   Đơn/khoản thu Online mang `centerId NULL`: người kiêm một vai neo Hội sở có `payments:*` / `orders:*` NHÌN thấy chúng, rồi dùng khoá giữ ở CƠ SỞ để ghi.
 *   Luật: trên đơn Online, CHÍNH khoá của thao tác phải được giữ ở tầm toàn hệ (`coQuyenToanHeThong`). Vai nào giữ đúng khoá đó ở Hội sở vẫn làm được. Đơn OFFLINE không đổi.
 *   [TTO-01] xác nhận · [TTO-02] từ chối · [TTO-03] sửa khoản chờ duyệt · [TTO-04] điều chỉnh khoản đã xác nhận
 *   [TTO-05] đơn → REFUNDED · [TTO-06] đơn → CONFIRMED (đường này ghi nhận ĐỦ tiền đơn ⇒ đơn Online thành «đã thu đủ»)
 *   [TTO-07] đối chứng DƯƠNG trên cùng fixture · [TTO-08] phần CÒN LẠI theo đúng luật (vai cơ sở neo Hội sở giữ chính khoá đó) · [TTO-09] grant riêng · [TTO-10] OFFLINE y nguyên
 *   [TTO-11] gỡ gắn giao dịch · [TTO-12] chuyển tiền giữa hai con · [TTO-13] bỏ gắn khoản khỏi con (ba đường: `payments:manage`) · [TTO-14] đánh dấu đợt đã đóng (`orders:manage`, đường này ghi thêm khoản thu)
 *   [TTO-15] đối chứng DƯƠNG bốn đường trên · [TTO-16] bốn đường trên với đơn OFFLINE y nguyên
 *   [TTO-17] miễn giảm nợ · [TTO-18] thêm con vào đơn · [TTO-19] tạo đợt cho con · [TTO-20] đổi phương thức thanh toán · [TTO-21] ghi chú nội bộ (năm đường: `orders:manage`)
 *   [TTO-22] đóng phiếu gộp (`payments:manage`) · [TTO-23] đối chứng DƯƠNG · [TTO-24] đơn OFFLINE y nguyên
 *   [TTO-25] nhóm `payments:record` KHÔNG đổi luật — ghim hành vi hiện tại, GỒM KHE còn lại ở v1 (chờ Owner quyết; đổi luật thì sửa ca này có chủ đích)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "ttotest-";
const GIA = 500_000;
/** Câu của cổng MỚI, viết literal: ca bị chặn phải đỏ đúng vì cổng này, không phải vì cổng khác tình cờ chặn. */
const CAU_ONLINE = "Không có quyền thao tác trên đơn Online — quyền này phải được giữ ở tầm toàn hệ thống";
const NGOAI_TAM_KHOAN = "Không tìm thấy khoản thanh toán";
const NGOAI_TAM_DON = "Không tìm thấy đơn hàng";
const CHAN_ADJUST = "Bạn không có quyền điều chỉnh khoản thu.";
const DA = "REDIRECT"; // `checkPermission` đá về trang

type NoiNeo = "HO" | "CS1";
type Nguoi = { role: string; roles?: string[]; vai: Array<[string, NoiNeo]>; grant?: string[] };
const NGUOI: Record<string, Nguoi> = {
  admin: { role: "SUPER_ADMIN", vai: [["SUPER_ADMIN", "HO"]] },
  ktHo: { role: "ACCOUNTANT", vai: [["HO_ACCOUNTANT", "HO"]] },
  ktCs: { role: "ACCOUNTANT", vai: [["CENTER_ACCOUNTANT", "CS1"]] },
  kiemCsmHo: { role: "ACCOUNTANT", roles: ["ACCOUNTANT", "SALES_CSM"], vai: [["CENTER_ACCOUNTANT", "CS1"], ["CENTER_SALES_CSM", "HO"]] },
  kiemQlHo: { role: "ACCOUNTANT", roles: ["ACCOUNTANT", "CENTER_MANAGER"], vai: [["CENTER_ACCOUNTANT", "CS1"], ["CENTER_MANAGER", "HO"]] },
  /** dạng v1: quyền đến từ ma trận v1, vai Hội sở không có khoá `payments:*` nào ⇒ tầm nhìn rơi về `isHoLevel ? ALL` */
  v1Roles: { role: "ACCOUNTANT", vai: [["HO_SALE", "HO"]] },
  qlCs: { role: "CENTER_MANAGER", vai: [["CENTER_MANAGER", "CS1"]] },
  /** `orders:manage` chỉ giữ ở CƠ SỞ; tầm nhìn đơn thành ALL nhờ `orders:view` của vai khác neo Hội sở */
  qlCsKiemCsmHo: { role: "CENTER_MANAGER", roles: ["CENTER_MANAGER", "SALES_CSM"], vai: [["CENTER_MANAGER", "CS1"], ["CENTER_SALES_CSM", "HO"]] },
  v1QlRoles: { role: "CENTER_MANAGER", vai: [["HO_SALE", "HO"]] },
  /** điều chỉnh đòi HAI khoá: mỗi người dưới đây chỉ giữ MỘT khoá ở tầm toàn hệ (grant riêng), khoá kia chỉ ở cơ sở (vai Kế toán cơ sở) */
  chiXacNhanToanHe: { role: "ACCOUNTANT", vai: [["CENTER_ACCOUNTANT", "CS1"]], grant: ["payments:confirm"] },
  chiDieuChinhToanHe: { role: "ACCOUNTANT", vai: [["CENTER_ACCOUNTANT", "CS1"]], grant: ["payments:adjust"] },
  /** grant riêng, KHÔNG neo Hội sở — hôm nay làm được; luật mới giữ nguyên */
  grantKhongHo: { role: "TEACHER", vai: [["TEACHER", "CS1"]], grant: ["payments:confirm", "orders:manage"] },
};

const ids: Record<string, string> = {};
let cs1 = "";
let nguoiGhi = "";
let dem = 0;
const dangNhapLa = (k: string) => {
  const n = NGUOI[k]!;
  phien = { user: { id: ids[k]!, name: `${NS}${k}`, email: `${NS}${k}@ci.test`, role: n.role, roles: n.roles ?? [n.role], grants: (n.grant ?? []).map((action) => ({ action, grant: "ALLOW" as const })) } };
};

async function donDon() {
  await db.bankTransaction.deleteMany({ where: { providerTxnId: { startsWith: NS }, allocations: { none: {} } } });
  const oid = (await db.order.findMany({ where: { code: { startsWith: NS } }, select: { id: true } })).map((o) => o.id);
  if (oid.length === 0) return;
  const gdIds = (await db.paymentAllocation.findMany({ where: { paymentRequest: { orderId: { in: oid } } }, select: { bankTransactionId: true } })).map((a) => a.bankTransactionId);
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: oid } } } });
  await db.creditBalance.deleteMany({ where: { bankTransactionId: { in: gdIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: gdIds } } });
  await db.bankTransaction.deleteMany({ where: { OR: [{ id: { in: gdIds } }, { providerTxnId: { startsWith: NS } }] } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: { in: oid } } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: oid } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: oid } } });
  await db.orderInstallment.deleteMany({ where: { orderId: { in: oid } } });
  const pids = (await db.payment.findMany({ where: { orderId: { in: oid } }, select: { id: true } })).map((p) => p.id);
  // Lượt xác nhận / đổi trạng thái THẬT sinh phiếu thu + sự kiện: không dọn thì bộ dispatcher chạy sau (cùng DB) đỏ giả.
  await db.domainEvent.deleteMany({ where: { OR: oid.map((id) => ({ payloadJson: { path: ["orderId"], equals: id } })) } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [...oid, ...pids] } } });
  await db.receipt.deleteMany({ where: { paymentId: { in: pids } } });
  await db.payment.deleteMany({ where: { orderId: { in: oid }, adjustmentOfId: { not: null } } });
  await db.payment.deleteMany({ where: { orderId: { in: oid } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: oid } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
  await db.order.deleteMany({ where: { id: { in: oid } } });
}
async function donDanhMuc() {
  await db.paymentMethod.deleteMany({ where: { code: { startsWith: NS } } });
  await db.course.deleteMany({ where: { slug: { startsWith: NS } } });
}
async function donNguoi() {
  const uids = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
  await db.userPermissionGrant.deleteMany({ where: { userId: { in: uids } } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

type TrangThaiDon = "PENDING_PAYMENT" | "COMPLETED" | "CONFIRMED";
/** Một đơn MỚI mỗi lần: `online` = đơn Online `centerId NULL`; ngược lại đơn offline của CS1. */
async function dung(o: { online: boolean; don?: TrangThaiDon; khoan?: "PENDING" | "CONFIRMED" | null }) {
  dem += 1;
  const centerId = o.online ? null : cs1;
  const d = await db.order.create({
    data: { code: `${NS}DH${Date.now()}-${dem}`, type: o.online ? "ONLINE" : "PRODUCT", status: o.don ?? "COMPLETED", customerName: `${NS}PH`, customerPhone: "0905000321", centerId, subtotal: GIA, totalAmount: GIA } as never,
    select: { id: true },
  });
  const khoan = o.khoan === null ? "" : (await db.payment.create({ data: { orderId: d.id, amount: GIA, method: "BANK_TRANSFER", paidDate: new Date(), accountantStatus: o.khoan ?? "PENDING", recordedById: nguoiGhi, centerId }, select: { id: true } })).id;
  return { don: d.id, khoan };
}
async function anh(don: string) {
  const [o, tien, phieu] = await Promise.all([
    db.order.findUniqueOrThrow({ where: { id: don }, select: { status: true } }),
    db.payment.findMany({ where: { orderId: don }, select: { amount: true, accountantStatus: true, rejectReason: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.receipt.count({ where: { payment: { orderId: don } } }),
  ]);
  return { trangThai: o.status, tien, phieu };
}
/** "OK" hoặc CÂU từ chối; chỉ `NEXT_REDIRECT` được coi là từ chối bằng ngoại lệ, lỗi khác NÉM RA. */
async function ketCuc(p: Promise<unknown>): Promise<string> {
  try {
    const r = (await p) as { ok: boolean; error?: string };
    return r.ok ? "OK" : (r.error ?? "");
  } catch (e) {
    const x = e as { message?: string; digest?: string };
    if (`${x.digest ?? ""} ${x.message ?? ""}`.includes("NEXT_REDIRECT")) return DA;
    throw e;
  }
}

const THAO_TAC = {
  "xac-nhan": { khoan: "PENDING" as const, lam: (k: string) => confirmPaymentAction(k) },
  "tu-choi": { khoan: "PENDING" as const, lam: (k: string) => rejectPaymentAction(k, "Từ chối thử nghiệm đủ dài") },
  "sua-cho-duyet": { khoan: "PENDING" as const, lam: (k: string) => updatePendingPaymentAction({ paymentId: k, amount: 1, reason: "Sửa thử nghiệm" }) },
  "dieu-chinh": { khoan: "CONFIRMED" as const, lam: (k: string) => adjustPaymentAction({ paymentId: k, amount: 1, reason: "Điều chỉnh thử nghiệm đủ dài" }) },
};
type TenThaoTac = keyof typeof THAO_TAC;

/** Đơn HAI CON (hai dòng) — hình dạng mà bốn đường «gắn / gỡ / chuyển / đóng đợt» chạm tới. */
async function dungHaiCon(online: boolean) {
  const x = await dung({ online, don: "CONFIRMED", khoan: null });
  await db.order.update({ where: { id: x.don }, data: { type: online ? "ONLINE" : "COURSE", subtotal: 600_000, totalAmount: 600_000 } });
  const dong = async (ten: string) =>
    (await db.orderItem.create({ data: { orderId: x.don, type: online ? "ONLINE_COURSE" : "COURSE_PACKAGE", itemName: ten, quantity: 1, unitPrice: 300_000, totalPrice: 300_000, ...(online ? { onlineCourseId: `${NS}${ten}${dem}` } : {}) } as never, select: { id: true } })).id;
  return { don: x.don, a: await dong("conA"), b: await dong("conB") };
}
const khoanCuaCon = async (don: string, orderItemId: string, o: { amount: number; xacNhan: boolean; centerOnline: boolean }) =>
  (await db.payment.create({ data: { orderId: don, orderItemId, amount: o.amount, method: "BANK_TRANSFER", paidDate: new Date(), accountantStatus: o.xacNhan ? "CONFIRMED" : "PENDING", recordedById: nguoiGhi, centerId: o.centerOnline ? null : cs1 }, select: { id: true } })).id;
async function anhTien(don: string) {
  const [tien, phanBo, dot] = await Promise.all([
    db.payment.findMany({ where: { orderId: don }, select: { amount: true, orderItemId: true, accountantStatus: true, paymentType: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.paymentAllocation.findMany({ where: { paymentRequest: { orderId: don } }, select: { amount: true, bankTransaction: { select: { status: true } } }, orderBy: { createdAt: "asc" } }),
    db.orderInstallment.findMany({ where: { orderId: don }, select: { status: true }, orderBy: { soDot: "asc" } }),
  ]);
  return { tien, phanBo, dot };
}
type DuongTien = { ma: string; khoa: "payments:manage" | "orders:manage"; chuanBi: (online: boolean) => Promise<{ don: string; lam: () => Promise<unknown> }> };
const DUONG_TIEN: Record<string, DuongTien> = {
  "go-gan": {
    ma: "[TTO-11]",
    khoa: "payments:manage",
    // Gắn bằng ĐÚNG đường thật (Quản trị tối cao) ⇒ khoản thu mang marker như dữ liệu thật, gỡ gắn phải ghi bút toán đảo.
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      const yc = await db.paymentRequest.create({ data: { orderId: x.don, installmentNo: 0, amountDue: 600_000, status: "PENDING", matchKey: `TT${Date.now()}${dem}`, centerId: online ? null : cs1 } as never, select: { id: true } });
      const gd = await db.bankTransaction.create({ data: { provider: "SEPAY", providerTxnId: `${NS}${Date.now()}-${dem}`, amount: 100_000, transferredAt: new Date(), status: "UNMATCHED", centerId: online ? null : cs1 }, select: { id: true } });
      const truocDo = phien;
      dangNhapLa("admin");
      const gan = await ganGiaoDichTheoConAction({ bankTransactionId: gd.id, orderId: x.don, dong: [{ paymentRequestId: yc.id, orderItemId: x.a, soTien: 100_000 }] as never });
      phien = truocDo;
      if (!gan.ok) throw new Error(`dựng gắn giao dịch hỏng: ${gan.error}`);
      return { don: x.don, lam: () => goGanGiaoDichAction({ bankTransactionId: gd.id, lyDo: "Gỡ thử nghiệm đủ dài" }) };
    },
  },
  "chuyen-tien": {
    ma: "[TTO-12]",
    khoa: "payments:manage",
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      await khoanCuaCon(x.don, x.a, { amount: 300_000, xacNhan: true, centerOnline: online });
      return { don: x.don, lam: () => chuyenTienGiuaConAction({ orderId: x.don, tuOrderItemId: x.a, denOrderItemId: x.b, soTien: 50_000, lyDo: "Chuyển thử nghiệm đủ dài" }) };
    },
  },
  "bo-gan": {
    ma: "[TTO-13]",
    khoa: "payments:manage",
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      const k = await khoanCuaCon(x.don, x.a, { amount: 100_000, xacNhan: false, centerOnline: online });
      return { don: x.don, lam: () => boGanKhoanChoConAction({ orderId: x.don, paymentId: k, lyDo: "Bỏ gắn thử nghiệm đủ dài" }) };
    },
  },
  "dong-dot": {
    ma: "[TTO-14]",
    khoa: "orders:manage",
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      const dot = await db.orderInstallment.create({ data: { orderId: x.don, soDot: 1, amount: 600_000, status: "PENDING" }, select: { id: true } });
      return { don: x.don, lam: () => markOrderInstallmentPaidAction(dot.id, x.don) };
    },
  },
};
const TEN_DUONG = Object.keys(DUONG_TIEN);

/** Mọi thứ sáu đường «ghi lên đơn» có thể đổi — so trước/sau. */
async function anhDon(don: string) {
  const [o, dong, phieu, gop] = await Promise.all([
    db.order.findUniqueOrThrow({ where: { id: don }, select: { totalAmount: true, subtotal: true, discountAmount: true, internalNote: true, paymentMethodId: true, status: true } }),
    db.orderItem.findMany({ where: { orderId: don }, select: { unitPrice: true, totalPrice: true, discountAmount: true, status: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.paymentRequest.findMany({ where: { orderId: don }, select: { amountDue: true, status: true, orderItemId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.paymentBill.findMany({ where: { orderId: don }, select: { status: true, amountDue: true } }),
  ]);
  return { ...o, dong, phieu, gop };
}
const phieuToanDon = async (don: string, online: boolean) =>
  (await db.paymentRequest.create({ data: { orderId: don, installmentNo: 0, amountDue: 600_000, status: "PENDING", matchKey: `TD${Date.now()}${dem}`, centerId: online ? null : cs1 } as never, select: { id: true } })).id;

type DuongGhi = {
  ma: string;
  khoa: "orders:manage" | "payments:manage";
  /** Câu mà cửa quyền CŨ của action trả khi vai Hội sở không giữ khoá (v2): `requireOrdersManage` đá trang, hai cổng kia trả câu. */
  cuaQuyen: string;
  /** Nghiệp vụ vốn từ chối đơn Online (không phải do cổng quyền) ⇒ đối chứng dương nhận đúng câu này. */
  nghiepVuTuChoiOnline?: RegExp;
  chuanBi: (online: boolean) => Promise<{ don: string; lam: () => Promise<unknown> }>;
};
const DUONG_GHI: Record<string, DuongGhi> = {
  "mien-giam": {
    ma: "[TTO-17]",
    khoa: "orders:manage",
    cuaQuyen: "Không có quyền",
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      await phieuToanDon(x.don, online);
      return { don: x.don, lam: () => mienGiamNoAction({ orderId: x.don, orderItemId: x.a, soTien: 50_000, lyDo: "Miễn giảm thử nghiệm đủ dài" }) };
    },
  },
  "them-con": {
    ma: "[TTO-18]",
    khoa: "orders:manage",
    cuaQuyen: "Không có quyền",
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      await phieuToanDon(x.don, online);
      const khoa = await db.course.create({ data: { name: `${NS}Khoá ${dem}`, slug: `${NS}${Date.now()}-${dem}`, price: 300_000 } as never, select: { id: true } });
      return { don: x.don, lam: () => themConVaoDonAction({ orderId: x.don, conMoi: { itemName: "Con C", courseId: khoa.id, quantity: 1, unitPrice: 300_000 }, lyDo: "Thêm con thử nghiệm đủ dài" }) };
    },
  },
  "tao-dot": {
    ma: "[TTO-19]",
    khoa: "orders:manage",
    cuaQuyen: DA,
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      return { don: x.don, lam: () => taoDotChoConAction({ orderId: x.don, orderItemId: x.a, soTien: 100_000 }) };
    },
  },
  "doi-phuong-thuc": {
    ma: "[TTO-20]",
    khoa: "orders:manage",
    cuaQuyen: DA,
    nghiepVuTuChoiOnline: /không hỗ trợ loại đơn "ONLINE"/,
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      await db.order.update({ where: { id: x.don }, data: { status: "PENDING_PAYMENT" } });
      const pm = await db.paymentMethod.create({ data: { code: `${NS}pm${Date.now()}-${dem}`, name: `${NS}CK ${dem}`, type: "BANK_TRANSFER", isActive: true, canBuyCourse: true } as never, select: { id: true } });
      return { don: x.don, lam: () => updateOrderPaymentMethodAction(x.don, pm.id) };
    },
  },
  "ghi-chu": {
    ma: "[TTO-21]",
    khoa: "orders:manage",
    cuaQuyen: DA,
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      return { don: x.don, lam: () => updateOrderNoteAction(x.don, "Ghi chú thử nghiệm") };
    },
  },
  "dong-phieu": {
    ma: "[TTO-22]",
    khoa: "payments:manage",
    cuaQuyen: "Không có quyền",
    // «Đóng» chỉ áp cho phiếu ĐÃ nhận tiền ⇒ phiếu gộp có phân bổ thật.
    chuanBi: async (online) => {
      const x = await dungHaiCon(online);
      const yc = await phieuToanDon(x.don, online);
      const gop = await db.paymentBill.create({ data: { orderId: x.don, amountDue: 600_000, status: "OPEN", centerId: online ? null : cs1, lines: { create: [{ paymentRequestId: yc, amount: 600_000 }] } } as never, select: { id: true } });
      const gd = await db.bankTransaction.create({ data: { provider: "SEPAY", providerTxnId: `${NS}gop-${Date.now()}-${dem}`, amount: 100_000, transferredAt: new Date(), status: "MATCHED", centerId: online ? null : cs1 }, select: { id: true } });
      await db.paymentAllocation.create({ data: { bankTransactionId: gd.id, paymentRequestId: yc, amount: 100_000, centerId: online ? null : cs1 } });
      return { don: x.don, lam: () => dongPhieuGopAction({ orderId: x.don, billId: gop.id, lyDo: "Đóng phiếu thử nghiệm đủ dài" }) };
    },
  },
};
const TEN_DUONG_GHI = Object.keys(DUONG_GHI);

describe.skipIf(!RUN)("[TTO-DB] thao tác tiền / trạng thái trên đơn Online — RBAC v1 + v2, Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDon();
    await donDanhMuc();
    await donNguoi();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const goc = (await db.orgUnit.findFirstOrThrow({ where: { type: { in: ["ROOT", "HO"] } }, orderBy: { depth: "asc" }, select: { id: true } })).id;
    const ou: Record<NoiNeo, string> = { HO: goc, CS1: (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id };
    cs1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    nguoiGhi = (await seedUser({ email: `${NS}nguoighi@ci.test`, name: `${NS}nguoighi`, role: "ACCOUNTANT" as never })).id;
    for (const [k, n] of Object.entries(NGUOI)) {
      ids[k] = (await seedUser({ email: `${NS}${k.toLowerCase()}@ci.test`, name: `${NS}${k}`, role: n.role as never, roles: (n.roles ?? [n.role]) as never, centerId: n.vai.some(([, o]) => o === "CS1") ? cs1 : null })).id;
    }
    for (const [k, n] of Object.entries(NGUOI)) {
      for (const [code, noi] of n.vai) {
        const roleId = (await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
        await db.userOrgRole.create({ data: { userId: ids[k]!, orgUnitId: ou[noi], roleId, grantedById: ids.admin! } });
      }
      for (const action of n.grant ?? []) await db.userPermissionGrant.create({ data: { userId: ids[k]!, action, grant: "ALLOW", grantedBy: ids.admin! } });
    }
  }, 180_000);
  const datCoThuLinhHoat = async (v: boolean) => {
    const r = await setGlobalSetting({ isSuperAdmin: true } as never, { key: KHOA_CONG_TAC, value: v, reason: "kiểm thử quyền trên đơn Online", actorName: "test" });
    if (!r.ok) throw new Error(`đặt cờ: ${JSON.stringify(r.error)}`);
  };
  // «chuyển tiền giữa hai con» và «bỏ gắn khoản» chỉ chạy khi cơ sở của đơn bật thu linh hoạt; đơn Online đọc mức CHUNG.
  beforeAll(async () => {
    await datCoThuLinhHoat(true);
  }, 60_000);
  afterAll(async () => {
    await datCoThuLinhHoat(false);
    phien = null;
    delete process.env.RBAC_V2_ENABLED;
    await donDon();
    await donDanhMuc();
    await donNguoi();
  });
  beforeEach(() => {
    phien = null;
  });

  describe.each([
    ["RBAC v1 (cờ tắt)", false],
    ["RBAC v2 (cờ bật)", true],
  ])("%s", (_ten, v2) => {
    beforeAll(() => {
      if (v2) process.env.RBAC_V2_ENABLED = "true";
      else delete process.env.RBAC_V2_ENABLED;
    });

    /** ĐÚNG câu của cổng phải chặn từng người ở từng cờ (không chấp nhận «bị chặn vì lý do khác»). */
    const cauChanKhoan = (tt: TenThaoTac, ai: string): string => {
      const dc = tt === "dieu-chinh";
      if (dc && !v2 && ai !== "v1Roles") return CHAN_ADJUST; // v1: `payments:adjust` chỉ SUPER_ADMIN trong ma trận
      if (ai === "ktCs") return NGOAI_TAM_KHOAN; // đối chứng: người chỉ ở cơ sở không nhìn thấy khoản Online
      if (ai === "v1Roles") return v2 ? DA : dc ? CHAN_ADJUST : CAU_ONLINE;
      return CAU_ONLINE;
    };
    const MA_THAO_TAC: Record<TenThaoTac, string> = { "xac-nhan": "[TTO-01]", "tu-choi": "[TTO-02]", "sua-cho-duyet": "[TTO-03]", "dieu-chinh": "[TTO-04]" };
    const BANG_CHAN_KHOAN = (Object.keys(MA_THAO_TAC) as TenThaoTac[]).flatMap((tt) => ["kiemCsmHo", "kiemQlHo", "v1Roles", "ktCs"].map((ai) => [MA_THAO_TAC[tt], tt, ai] as const));
    it.each(BANG_CHAN_KHOAN)("%s %s khoản đơn Online — %s bị chặn đúng cổng, không đổi gì", async (_ma, tt, ai) => {
      const x = await dung({ online: true, khoan: THAO_TAC[tt].khoan });
      const truoc = await anh(x.don);
      dangNhapLa(ai);
      expect({ ai, cau: await ketCuc(THAO_TAC[tt].lam(x.khoan)) }).toEqual({ ai, cau: cauChanKhoan(tt, ai) });
      expect(await anh(x.don)).toEqual(truoc);
    });

    it.each(["xac-nhan", "tu-choi", "sua-cho-duyet", "dieu-chinh"] as TenThaoTac[])("[TTO-07] đối chứng dương %s: Quản trị tối cao và Kế toán Hội sở vẫn làm được trên cùng trạng thái", async (tt) => {
      // v1: `payments:adjust` chỉ SUPER_ADMIN trong ma trận ⇒ Kế toán Hội sở không điều chỉnh được (có sẵn, không đổi).
      for (const ai of tt === "dieu-chinh" && !v2 ? ["admin"] : ["admin", "ktHo"]) {
        const x = await dung({ online: true, khoan: THAO_TAC[tt].khoan });
        const truoc = await anh(x.don);
        dangNhapLa(ai);
        expect({ ai, cau: await ketCuc(THAO_TAC[tt].lam(x.khoan)) }).toEqual({ ai, cau: "OK" });
        expect(await anh(x.don)).not.toEqual(truoc);
      }
    });

    it.each(["chiXacNhanToanHe", "chiDieuChinhToanHe"])("[TTO-04b] điều chỉnh đòi CẢ HAI khoá ở tầm toàn hệ — %s bị chặn, không đổi gì", async (ai) => {
      const x = await dung({ online: true, khoan: "CONFIRMED" });
      const truoc = await anh(x.don);
      dangNhapLa(ai);
      // v1: `payments:adjust` chỉ SUPER_ADMIN trong ma trận ⇒ người không có grant adjust bị chặn ở cổng cũ.
      const cau = ai === "chiXacNhanToanHe" && !v2 ? CHAN_ADJUST : CAU_ONLINE;
      expect({ ai, cau: await ketCuc(THAO_TAC["dieu-chinh"].lam(x.khoan)) }).toEqual({ ai, cau });
      expect(await anh(x.don)).toEqual(truoc);
    });

    const doiTrangThai = (don: string, toStatus: string) => changeOrderStatusAction(don, { toStatus, reason: "Đổi trạng thái thử nghiệm" });
    const cauChanDon = (ai: string): string => (ai === "qlCs" ? NGOAI_TAM_DON : ai === "v1QlRoles" && v2 ? DA : CAU_ONLINE);
    const NGUOI_CHAN_DON = ["qlCsKiemCsmHo", "v1QlRoles", "qlCs"];

    it.each(NGUOI_CHAN_DON)("[TTO-05] đơn Online → REFUNDED — %s (không giữ `orders:manage` ở tầm toàn hệ) bị chặn, không đổi gì", async (ai) => {
      const x = await dung({ online: true, don: "COMPLETED", khoan: "CONFIRMED" });
      const truoc = await anh(x.don);
      dangNhapLa(ai);
      expect({ ai, cau: await ketCuc(doiTrangThai(x.don, "REFUNDED")) }).toEqual({ ai, cau: cauChanDon(ai) });
      expect(await anh(x.don)).toEqual(truoc);
    });

    it.each(NGUOI_CHAN_DON)("[TTO-06] đơn Online chưa có đồng nào → CONFIRMED — %s bị chặn, không sinh khoản thu, đơn KHÔNG thành «đã thu đủ»", async (ai) => {
      const x = await dung({ online: true, don: "PENDING_PAYMENT", khoan: null });
      dangNhapLa(ai);
      const cau = await ketCuc(doiTrangThai(x.don, "CONFIRMED"));
      expect({ ai, sau: await anh(x.don), daThuDu: await donOnlineDaThuDu(db, x.don) }).toEqual({ ai, sau: { trangThai: "PENDING_PAYMENT", tien: [], phieu: 0 }, daThuDu: false });
      expect({ ai, cau }).toEqual({ ai, cau: cauChanDon(ai) });
    });

    it("[TTO-07b] đối chứng dương đơn → REFUNDED: Quản trị tối cao và Kế toán Hội sở", async () => {
      for (const ai of ["admin", "ktHo"]) {
        const x = await dung({ online: true, don: "COMPLETED", khoan: "CONFIRMED" });
        dangNhapLa(ai);
        expect({ ai, cau: await ketCuc(doiTrangThai(x.don, "REFUNDED")) }).toEqual({ ai, cau: "OK" });
        expect((await anh(x.don)).trangThai).toBe("REFUNDED");
      }
    });

    it("[TTO-08] PHẦN CÒN LẠI theo đúng luật: Quản lý cơ sở NEO Hội sở giữ chính `orders:manage` ở tầm toàn hệ ⇒ vẫn đổi được trạng thái đơn Online", async () => {
      expect(tamNhinCuaKhoa(await resolveActor(ids.kiemQlHo!), "orders:manage")).toBe("ALL");
      const x = await dung({ online: true, don: "COMPLETED", khoan: "CONFIRMED" });
      dangNhapLa("kiemQlHo");
      expect(await ketCuc(doiTrangThai(x.don, "REFUNDED"))).toBe("OK");
    });

    it("[TTO-09] grant riêng (không neo Hội sở) là quyền toàn hệ theo thiết kế ⇒ giữ nguyên: xác nhận khoản Online + đổi trạng thái đơn", async () => {
      const x = await dung({ online: true, khoan: "PENDING" });
      dangNhapLa("grantKhongHo");
      expect(await ketCuc(confirmPaymentAction(x.khoan))).toBe("OK");
      const y = await dung({ online: true, don: "COMPLETED", khoan: "CONFIRMED" });
      expect(await ketCuc(doiTrangThai(y.don, "REFUNDED"))).toBe("OK");
    });

    it.each(["ktCs", "kiemCsmHo"])("[TTO-10] OFFLINE y nguyên — %s xác nhận / từ chối / sửa chờ duyệt / điều chỉnh khoản thu cơ sở mình", async (ai) => {
      for (const tt of ["xac-nhan", "tu-choi", "sua-cho-duyet", "dieu-chinh"] as TenThaoTac[]) {
        if (tt === "dieu-chinh" && !v2) continue; // v1: `payments:adjust` chỉ SUPER_ADMIN (có sẵn)
        const x = await dung({ online: false, khoan: THAO_TAC[tt].khoan });
        dangNhapLa(ai);
        expect({ tt, cau: await ketCuc(THAO_TAC[tt].lam(x.khoan)) }).toEqual({ tt, cau: "OK" });
      }
    });

    it.each(["qlCs", "qlCsKiemCsmHo"])("[TTO-10b] OFFLINE y nguyên — %s đổi trạng thái đơn cơ sở mình", async (ai) => {
      const x = await dung({ online: false, don: "COMPLETED", khoan: "CONFIRMED" });
      dangNhapLa(ai);
      expect(await ketCuc(doiTrangThai(x.don, "REFUNDED"))).toBe("OK");
      expect((await anh(x.don)).trangThai).toBe("REFUNDED");
    });

    // ───────── bốn đường anh em (msg_921d79ef9bda) ─────────
    const nguoiChanDuong = (d: DuongTien) => (d.khoa === "orders:manage" ? ["qlCsKiemCsmHo", "v1QlRoles", "qlCs"] : ["kiemCsmHo", "kiemQlHo", "v1Roles", "ktCs"]);
    const cauChanDuong = (ten: string, ai: string): string => {
      if (ai === "ktCs" || ai === "qlCs") return NGOAI_TAM_DON; // đối chứng: người chỉ ở cơ sở không nhìn thấy đơn Online
      // `kiemQlHo` ở v1: phiên mang vai ACCOUNTANT nên qua ma trận v1. Dạng v1 (`v1Roles`/`v1QlRoles`) không có RoleDef nào giữ khoá ⇒ v2 chặn từ cửa quyền, mỗi action một câu.
      if (v2 && (ai === "v1Roles" || ai === "v1QlRoles")) return ten === "go-gan" ? "Chỉ kế toán mới gỡ được giao dịch đã gắn" : "Không có quyền";
      return CAU_ONLINE;
    };
    it.each(TEN_DUONG.flatMap((ten) => nguoiChanDuong(DUONG_TIEN[ten]!).map((ai) => [DUONG_TIEN[ten]!.ma, ten, ai] as const)))("%s %s trên đơn Online — %s bị chặn đúng cổng, sổ tiền không đổi", async (_ma, ten, ai) => {
      const x = await DUONG_TIEN[ten]!.chuanBi(true);
      const truoc = await anhTien(x.don);
      dangNhapLa(ai);
      const cau = await ketCuc(x.lam());
      expect({ ai, sau: await anhTien(x.don) }).toEqual({ ai, sau: truoc });
      expect({ ai, cau }).toEqual({ ai, cau: cauChanDuong(ten, ai) });
    });

    it.each(TEN_DUONG)("[TTO-15] đối chứng dương %s trên đơn Online: Quản trị tối cao và Kế toán Hội sở làm được, sổ tiền đổi", async (ten) => {
      for (const ai of ["admin", "ktHo"]) {
        const x = await DUONG_TIEN[ten]!.chuanBi(true);
        const truoc = await anhTien(x.don);
        dangNhapLa(ai);
        expect({ ai, cau: await ketCuc(x.lam()) }).toEqual({ ai, cau: "OK" });
        expect(await anhTien(x.don)).not.toEqual(truoc);
      }
    });

    it.each(TEN_DUONG)("[TTO-16] OFFLINE y nguyên — %s trên đơn cơ sở mình: người chỉ giữ khoá ở cơ sở (kể cả kiêm vai Hội sở) vẫn làm được", async (ten) => {
      for (const ai of DUONG_TIEN[ten]!.khoa === "orders:manage" ? ["qlCs", "qlCsKiemCsmHo"] : ["ktCs", "kiemCsmHo"]) {
        const x = await DUONG_TIEN[ten]!.chuanBi(false);
        const truoc = await anhTien(x.don);
        dangNhapLa(ai);
        expect({ ai, cau: await ketCuc(x.lam()) }).toEqual({ ai, cau: "OK" });
        expect(await anhTien(x.don)).not.toEqual(truoc);
      }
    });

    // ───────── sáu đường ghi lên đơn (msg_eef7cf6603c4) ─────────
    const nguoiChanGhi = (d: DuongGhi) => (d.khoa === "orders:manage" ? ["qlCsKiemCsmHo", "v1QlRoles", "qlCs"] : ["kiemCsmHo", "kiemQlHo", "v1Roles", "ktCs"]);
    const cauChanGhi = (d: DuongGhi, ai: string): string => {
      if (ai === "ktCs" || ai === "qlCs") return NGOAI_TAM_DON;
      if (v2 && (ai === "v1Roles" || ai === "v1QlRoles")) return d.cuaQuyen;
      return CAU_ONLINE;
    };
    it.each(TEN_DUONG_GHI.flatMap((ten) => nguoiChanGhi(DUONG_GHI[ten]!).map((ai) => [DUONG_GHI[ten]!.ma, ten, ai] as const)))("%s %s trên đơn Online — %s bị chặn đúng cổng, đơn không đổi", async (_ma, ten, ai) => {
      const d = DUONG_GHI[ten]!;
      const x = await d.chuanBi(true);
      const truoc = await anhDon(x.don);
      dangNhapLa(ai);
      const cau = await ketCuc(x.lam());
      expect({ ai, sau: await anhDon(x.don) }).toEqual({ ai, sau: truoc });
      expect({ ai, cau }).toEqual({ ai, cau: cauChanGhi(d, ai) });
    });

    it.each(TEN_DUONG_GHI)("[TTO-23] đối chứng dương %s trên đơn Online: Quản trị tối cao và Kế toán Hội sở qua cổng quyền", async (ten) => {
      const d = DUONG_GHI[ten]!;
      for (const ai of ["admin", "ktHo"]) {
        const x = await d.chuanBi(true);
        const truoc = await anhDon(x.don);
        dangNhapLa(ai);
        const cau = await ketCuc(x.lam());
        if (d.nghiepVuTuChoiOnline) {
          expect({ ai, cau }).toEqual({ ai, cau: expect.stringMatching(d.nghiepVuTuChoiOnline) });
          expect(await anhDon(x.don)).toEqual(truoc);
        } else {
          expect({ ai, cau }).toEqual({ ai, cau: "OK" });
          expect(await anhDon(x.don)).not.toEqual(truoc);
        }
      }
    });

    it.each(TEN_DUONG_GHI)("[TTO-24] OFFLINE y nguyên — %s trên đơn cơ sở mình", async (ten) => {
      const d = DUONG_GHI[ten]!;
      for (const ai of d.khoa === "orders:manage" ? ["qlCs", "qlCsKiemCsmHo"] : ["ktCs", "kiemCsmHo"]) {
        const x = await d.chuanBi(false);
        const truoc = await anhDon(x.don);
        dangNhapLa(ai);
        expect({ ai, cau: await ketCuc(x.lam()) }).toEqual({ ai, cau: "OK" });
        expect(await anhDon(x.don)).not.toEqual(truoc);
      }
    });

    // KHE còn lại, ghim để không ai tưởng đã gác: ở v1, người chỉ giữ `payments:record` ở cơ sở (ma trận v1) + một vai Hội sở làm đơn Online lọt tầm nhìn vẫn GHI được.
    it("[TTO-25] nhóm `payments:record` trên đơn Online giữ luật cũ: ghi khoản thu + gắn khoản cho con", async () => {
      const ghiKhoan = async (don: string) => recordPaymentAction({ orderId: don, amount: 150_000, method: "BANK_TRANSFER", paidDate: new Date().toISOString().slice(0, 10), note: "ghi thử nghiệm" });
      const mongDoi: Record<string, [ghi: string, gan: string]> = {
        v1Roles: v2 ? [DA, "Không có quyền"] : ["OK", "OK"], // v1 = KHE
        kiemCsmHo: ["OK", "OK"], // CSM neo Hội sở giữ chính `payments:record` ⇒ hợp lệ theo luật
        ktCs: [NGOAI_TAM_DON, NGOAI_TAM_DON],
      };
      const thucTe: Record<string, [string, string]> = {};
      for (const ai of Object.keys(mongDoi)) {
        const x = await dungHaiCon(true);
        const k = await khoanCuaCon(x.don, x.a, { amount: 100_000, xacNhan: false, centerOnline: true });
        await db.payment.update({ where: { id: k }, data: { orderItemId: null } });
        dangNhapLa(ai);
        const gan = await ketCuc(ganKhoanChoConAction({ orderId: x.don, paymentId: k, orderItemId: x.b }));
        const ghi = await ketCuc(ghiKhoan(x.don));
        thucTe[ai] = [ghi, gan];
      }
      expect(thucTe).toEqual(mongDoi);
    });
  });
});
