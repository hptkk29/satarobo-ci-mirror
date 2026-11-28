import bcrypt from "bcryptjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({ current: null as null | { user: { id: string; name: string } }, quyen: new Set<string>(), hoi: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => SESS.current), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: vi.fn(async (a: string) => {
    SESS.hoi.push(a);
    return SESS.quyen.has(a);
  }),
}));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as taoDonPost } from "@/app/api/mobile/v1/parent/online-orders/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as byCourseGet } from "@/app/api/admin/online-revenue/by-course/route";
import { GET as reconcileGet } from "@/app/api/admin/online-revenue/reconcile/route";
import { GET as summaryGet } from "@/app/api/admin/online-revenue/summary/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { chiHoanOnline, duyetHoanOnline, taoYeuCauHoanOnline } from "@/lib/finance/hoan-tien-online";
import { LoiDoanhThu, tinhDoanhThuOnline } from "@/lib/online-revenue/doc";
import { docKhoangNgay } from "@/lib/online-revenue/thoi-gian";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [ODT] DOANH THU E-LEARNING ONLINE (Workstream A → «QoThongKe» của E) qua route + Postgres thật. DỮ LIỆU DỰNG TRONG DB SCRATCH (không phải dữ liệu thật).
 * Cô lập trên DB dùng chung: mọi ngày trong spec nằm ở NĂM 2031 (không spec nào khác dùng), đơn mang tiền tố `RV844-`.
 *   [ODT-01] quyền & tham số: 401/403 (hỏi đúng `onl:report:view`) · tham số lạ/ngày sai/ngược/quá dài/nhóm sai · khoá không có ⇒ 404 · no-store
 *   [ODT-02] THÁNG 3: tiền (thu/hoàn/điều chỉnh/ròng, đã xác nhận ↔ chờ) khớp SỐ TÍNH TAY + oracle SQL gõ tay · loại REJECTED / xoá mềm / đơn offline
 *   [ODT-03] biên giờ VN: 23:30 ngày 31 ≠ 00:10 ngày 01 · cộng các tháng = cả khoảng · tuần/tháng
 *   [ODT-04] hoàn: dòng hoàn khác tháng với khoản gốc; về ĐÚNG khoá của dòng được hoàn; hoàn một phần
 *   [ODT-05] trục đơn: trạng thái · thanh toán đủ/một phần/chưa · niêm yết/giảm/phí giao · giảm theo mã · quyền học thật
 *   [ODT-06] lọc khoá: Σ các lát = tổng · quy tiền đơn nhiều khoá/học cụ (chính xác vs ước tính)
 *   [ODT-07] đối soát: khớp trên tháng 3 · bắt được giao dịch trùng mã, hoàn không có yêu cầu, yêu cầu hoàn chi mà sổ không có
 *   [ODT-08] trần cửa sổ ⇒ 422/LoiDoanhThu, không cắt lặng lẽ
 *   [ODT-09] KHÔNG PII: không chuỗi tên/SĐT/email của fixture, không khoá nhạy cảm · [ODT-10] seed: Marketing có quyền, vai khác không
 *   [ODT-11] ĐƯỜNG THẬT: tạo đơn qua route phụ huynh → webhook ×2 cùng reference → hoàn một phần → API
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "rv844-";
const MK = "Mat-khau-test-2026";
const TEN_PH = "Nguyễn Văn Phụ-Huynh-RV";
const SDT_PH = "0966990001";
const EMAIL_PH = `${NS}pa@seed.invalid`;
const TEN_BE = ["Bé Alpha-RV", "Bé Beta-RV", "Bé Gamma-RV"];
let dem = 0;
const ip = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; meta?: any; error?: { code: string; message: string; field?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const vn = (s: string) => new Date(`${s}+07:00`);
let n = 0;

type Route = (req: Request) => Promise<Response>;
const goi = async (route: Route, loai: string, q: string) => {
  const r = await route(new Request(`http://localhost/api/admin/online-revenue/${loai}?${q}`));
  return { status: r.status, cc: r.headers.get("cache-control"), j: (await r.json()) as Tra, raw: "" };
};
const dung = async (route: Route, loai: string, q: string) => {
  const r = await goi(route, loai, q);
  expect(r.status, JSON.stringify(r.j.error)).toBe(200);
  return r.j;
};
/** `ODT_DUMP_DIR=<thư mục>` ⇒ ghi phản hồi THẬT của vài lời gọi (làm ví dụ cho tài liệu bàn giao). Không đặt biến ⇒ không ghi gì. */
const luuMau = (ten: string, j: Tra) => {
  const d = process.env.ODT_DUMP_DIR;
  if (!d) return;
  mkdirSync(d, { recursive: true });
  writeFileSync(resolve(d, `${ten}.json`), `${JSON.stringify(j, null, 2)}
`, "utf8");
};
const dangNhapQuyen = (quyen: string[]) => {
  SESS.current = { user: { id: "nv-marketing-1", name: "Marketing Test" } };
  SESS.quyen = new Set(quyen);
};
const MARKETING = ["onl:report:view"];

async function dungKhoaPhatHanh(gia: number) {
  const t = await taoKhoa(db, { code: `RV-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: true, renewalPrice: 200_000 }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B1", contentJson: { body: "nội dung" } });
  if (!b.ok) throw new Error("bai");
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: caiDatKhoiDauChoBanNhap() });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, new Date());
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, gia };
}

/** Oracle SQL GÕ TAY (không import điều kiện của mã nguồn): trạng thái viết thẳng, lọc đơn ONLINE chưa xoá + khoản chưa xoá, không bị từ chối. */
async function oracle(batDau: Date, ketThuc: Date) {
  const [r] = await db.$queryRaw<{ rong: bigint; thu: bigint; hoan: bigint; dc: bigint; khoan: bigint }[]>`
    SELECT COALESCE(SUM(p.amount), 0) AS rong,
           COALESCE(SUM(p.amount) FILTER (WHERE p."accountantStatus"::text <> 'REFUNDED' AND p."paymentType"::text <> 'ADJUSTMENT'), 0) AS thu,
           COALESCE(-SUM(p.amount) FILTER (WHERE p."accountantStatus"::text = 'REFUNDED'), 0) AS hoan,
           COALESCE(SUM(p.amount) FILTER (WHERE p."accountantStatus"::text <> 'REFUNDED' AND p."paymentType"::text = 'ADJUSTMENT'), 0) AS dc,
           COUNT(*) AS khoan
      FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
     WHERE o.type::text = 'ONLINE' AND o."deletedAt" IS NULL AND p."deletedAt" IS NULL
       AND p."accountantStatus"::text <> 'REJECTED' AND p."saleStatus"::text IN ('RECORDED', 'COLLECT_CONFIRMED')
       AND p."paidDate" >= ${batDau} AND p."paidDate" < ${ketThuc}`;
  return { rong: Number(r!.rong), thu: Number(r!.thu), hoan: Number(r!.hoan), dieuChinh: Number(r!.dc), soKhoan: Number(r!.khoan) };
}

async function don() {
  const us = (await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } })).map((u) => u.id);
  const oid = (await db.order.findMany({ where: { OR: [{ code: { startsWith: "RV844-" } }, { createdById: { in: us } }] }, select: { id: true } })).map((o) => o.id);
  if (oid.length) {
    await db.payment.updateMany({ where: { orderId: { in: oid } }, data: { refundRequestId: null } });
    await db.refundRequest.deleteMany({ where: { orderItem: { orderId: { in: oid } } } });
    await db.voucherRedemption.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderOnlineGrant.deleteMany({ where: { orderId: { in: oid } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: oid } } } });
    await db.receipt.deleteMany({ where: { payment: { orderId: { in: oid } } } });
    await db.payment.deleteMany({ where: { orderId: { in: oid }, adjustmentOfId: { not: null } } });
    await db.payment.deleteMany({ where: { orderId: { in: oid } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
    await db.order.deleteMany({ where: { id: { in: oid } } });
  }
  await db.voucher.deleteMany({ where: { code: { startsWith: "RV844-" } } });
  await db.legalEntity.deleteMany({ where: { taxCode: { startsWith: "RV844-" } } });
  await db.auditLog.deleteMany({ where: { entityType: "RefundRequest" } });
  await db.mobileSession.deleteMany({ where: { userId: { in: us } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: us } } });
  await donBangOnl(db); // TRƯỚC khi xoá học viên: OnlEntitlement.studentId là RESTRICT (đường thật ở [ODT-11] sinh quyền học)
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: us } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: us } } });
}

describe.skipIf(!RUN)("[ODT] doanh thu E-learning Online", () => {
  const ids: Record<string, string> = {};
  const P = (k: string) => ids[k]!;

  type Dong = { type?: "ONLINE_COURSE" | "PRODUCT"; khoa?: "C1" | "C2"; be?: "S1" | "S2" | "S3"; gia: number; sl?: number; giam?: number };
  const taoDonFx = async (ma: string, o: { type?: "ONLINE" | "COURSE"; status: "PENDING_PAYMENT" | "CONFIRMED" | "COMPLETED" | "CANCELLED"; tao: string; dong: Dong[]; giao?: number; pn?: "A" | "B" | null }) => {
    const sub = o.dong.reduce((s, d) => s + d.gia * (d.sl ?? 1), 0);
    const giam = o.dong.reduce((s, d) => s + (d.giam ?? 0), 0);
    const giao = o.giao ?? 0;
    const od = await db.order.create({
      data: {
        code: `RV844-${ma}`, type: o.type ?? "ONLINE", status: o.status, customerName: TEN_PH, customerPhone: SDT_PH, customerEmail: EMAIL_PH, createdById: P("PA"),
        subtotal: sub, discountAmount: giam, shippingFee: giao, totalAmount: sub - giam + giao, createdAt: vn(o.tao), centerId: null,
        ...(o.pn ? { legalEntityId: P(`LE-${o.pn}`) } : {}),
      } as never,
      select: { id: true },
    });
    const dongId: string[] = [];
    for (const d of o.dong) {
      const it = await db.orderItem.create({
        data: {
          orderId: od.id, type: d.type ?? "ONLINE_COURSE", itemName: d.type === "PRODUCT" ? "Bộ học cụ" : `Khoá ${d.khoa}`, quantity: d.sl ?? 1, unitPrice: d.gia, totalPrice: d.gia * (d.sl ?? 1), discountAmount: d.giam ?? 0,
          ...(d.type === "PRODUCT" ? {} : { onlineCourseId: P(d.khoa!), studentId: P(d.be!) }),
        } as never,
        select: { id: true },
      });
      dongId.push(it.id);
    }
    return { id: od.id, dong: dongId };
  };
  const thu = (orderId: string, soTien: number, luc: string, o: Partial<{ ttKt: string; ttSale: string; loai: string; note: string | null; goc: string; yc: string; xoa: boolean }> = {}) =>
    db.payment.create({
      data: {
        orderId, amount: soTien, method: "BANK_TRANSFER", paidDate: vn(luc), note: o.note === undefined ? null : o.note,
        saleStatus: (o.ttSale ?? "RECORDED") as never, accountantStatus: (o.ttKt ?? "PENDING") as never, paymentType: (o.loai ?? "PAYMENT") as never,
        adjustmentOfId: o.goc ?? null, refundRequestId: o.yc ?? null, deletedAt: o.xoa ? vn(luc) : null,
        ...(o.ttKt === "REJECTED" ? { rejectReason: "không khớp" } : {}),
      } as never,
      select: { id: true },
    });
  const capQuyen = (orderId: string, orderItemId: string, be: string, khoa: string, luc: string | null, status: "GRANTED" | "PENDING" = "GRANTED") =>
    db.orderOnlineGrant.create({ data: { orderItemId, orderId, studentId: P(be), courseId: P(khoa), status, entitlementId: status === "GRANTED" ? `ent-${NS}${++n}` : null, grantedAt: luc ? vn(luc) : null } as never });
  const yeuCauHoan = (orderItemId: string, soTien: number, tao: string, chi: string | null, status: "PAID" | "PENDING" | "APPROVED" | "REJECTED" = "PAID") =>
    db.refundRequest.create({
      data: { orderItemId, trigger: "MANUAL", reason: "Con không còn học khoá này", paidConfirmed: 0, sessionsTotal: 0, sessionsLearned: 0, unitPrice: 0, proposedAmount: soTien, approvedAmount: status === "PENDING" ? null : soTien, status, kenh: "ONLINE", kenhYeuCau: "STAFF", createdAt: vn(tao), ...(chi ? { paidAt: vn(chi) } : {}) } as never,
      select: { id: true },
    });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    ids.PA = (await db.user.create({ data: { email: EMAIL_PH, name: TEN_PH, phone: "84966990001", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    for (const [i, k] of (["S1", "S2", "S3"] as const).entries()) ids[k] = (await db.student.create({ data: { id: `${NS}${k}`, name: TEN_BE[i]!, parentUserId: P("PA") } as never, select: { id: true } })).id;
    for (const k of ["C1", "C2"] as const) {
      const t = await taoKhoa(db, { code: `RV-${k}-${Date.now().toString(36).toUpperCase()}`, name: `${NS}Khoá ${k}`, listPrice: k === "C1" ? 1_000_000 : 600_000, salePrice: k === "C1" ? 1_000_000 : 600_000, validityMonths: 6, renewalEnabled: false }, null);
      if (!t.ok) throw new Error(t.thongBao);
      ids[k] = t.courseId;
    }
    ids["LE-A"] = (await db.legalEntity.create({ data: { taxCode: "RV844-0001", legalName: "Pháp nhân A (RV844)" }, select: { id: true } })).id;
    ids["LE-B"] = (await db.legalEntity.create({ data: { taxCode: "RV844-0002", legalName: "Pháp nhân B (RV844)" }, select: { id: true } })).id;
    ids.V1 = (await db.voucher.create({ data: { code: "RV844-GIAM10", name: "Giảm 10% thử", type: "ALL", discountKind: "PERCENT", discountPercent: 10, validFrom: vn("2030-01-01T00:00:00"), validUntil: vn("2032-01-01T00:00:00") } as never, select: { id: true } })).id;

    // ── THÁNG 3/2031 ──
    // O1 một khoá, trả đủ một lần, kế toán đã xác nhận, trạng thái bán COLLECT_CONFIRMED; pháp nhân A
    const o1 = await taoDonFx("O1", { status: "COMPLETED", tao: "2031-03-05T09:00:00", dong: [{ khoa: "C1", be: "S1", gia: 1_000_000 }], pn: "A" });
    ids.P1 = (await thu(o1.id, 1_000_000, "2031-03-05T09:10:00", { ttKt: "CONFIRMED", ttSale: "COLLECT_CONFIRMED", note: "[auto:sepay:RV844-TX-1]" })).id;
    await capQuyen(o1.id, o1.dong[0]!, "S1", "C1", "2031-03-05T09:11:00");
    // O2 hai con cùng khoá (một dòng có mã giảm 10%), trả HAI lần: 23:30 ngày 31/03 và 00:10 ngày 01/04 giờ VN
    const o2 = await taoDonFx("O2", { status: "CONFIRMED", tao: "2031-03-10T14:00:00", dong: [{ khoa: "C1", be: "S3", gia: 1_000_000 }, { khoa: "C1", be: "S2", gia: 1_000_000, giam: 100_000 }] });
    await db.voucherRedemption.create({ data: { voucherId: P("V1"), orderId: o2.id, orderItemId: o2.dong[1]!, customerPhone: "84966990001", discountApplied: 100_000 } });
    await thu(o2.id, 1_000_000, "2031-03-31T23:30:00", { note: "[auto:sepay:RV844-TX-2a]" });
    await thu(o2.id, 900_000, "2031-04-01T00:10:00", { note: "[auto:sepay:RV844-TX-2b]" });
    await capQuyen(o2.id, o2.dong[0]!, "S3", "C1", "2031-04-01T00:15:00");
    await capQuyen(o2.id, o2.dong[1]!, "S2", "C1", "2031-04-01T00:15:00");
    // O3 đơn HỖN HỢP: C1 (giảm 200k học bổng) + C2 + học cụ ×2 + phí giao; trả đủ một lần; pháp nhân B; hoàn: C2 600k (04/04... 10/04) và C1 200k (02/05)
    const o3 = await taoDonFx("O3", { status: "COMPLETED", tao: "2031-03-12T10:00:00", dong: [{ khoa: "C1", be: "S1", gia: 1_000_000, giam: 200_000 }, { khoa: "C2", be: "S2", gia: 600_000 }, { type: "PRODUCT", gia: 150_000, sl: 2 }], giao: 30_000, pn: "B" });
    ids.P3 = (await thu(o3.id, 1_730_000, "2031-03-12T10:20:00", { ttKt: "CONFIRMED", note: "[auto:sepay:RV844-TX-3]" })).id;
    await capQuyen(o3.id, o3.dong[0]!, "S1", "C1", "2031-03-12T10:21:00");
    await capQuyen(o3.id, o3.dong[1]!, "S2", "C2", "2031-03-12T10:21:00");
    const rr1 = await yeuCauHoan(o3.dong[1]!, 600_000, "2031-04-08T09:00:00", "2031-04-10T15:00:00");
    await thu(o3.id, -600_000, "2031-04-10T15:00:00", { ttKt: "REFUNDED", goc: ids.P3, yc: rr1.id, note: "Chi hoàn tiền (yêu cầu)" });
    const rr2 = await yeuCauHoan(o3.dong[0]!, 200_000, "2031-04-30T09:00:00", "2031-05-02T15:00:00");
    await thu(o3.id, -200_000, "2031-05-02T15:00:00", { ttKt: "REFUNDED", goc: ids.P3, yc: rr2.id, note: "Chi hoàn tiền (yêu cầu)" });
    // O4 đơn hỗn hợp trả THIẾU (300k / 720k) ⇒ quy khoá bằng chia tỉ lệ (ước tính)
    const o4 = await taoDonFx("O4", { status: "PENDING_PAYMENT", tao: "2031-03-15T11:00:00", dong: [{ khoa: "C2", be: "S3", gia: 600_000 }, { type: "PRODUCT", gia: 100_000 }], giao: 20_000 });
    await thu(o4.id, 300_000, "2031-03-15T11:30:00", { note: "[auto:sepay:RV844-TX-4]" });
    // O5 đã huỷ · O6 chưa trả
    await taoDonFx("O5", { status: "CANCELLED", tao: "2031-03-18T08:00:00", dong: [{ khoa: "C1", be: "S3", gia: 1_000_000 }] });
    await taoDonFx("O6", { status: "PENDING_PAYMENT", tao: "2031-03-19T08:00:00", dong: [{ khoa: "C2", be: "S1", gia: 600_000 }] });
    // O7: một khoản BỊ KẾ TOÁN TỪ CHỐI (1.000.000) + khoản hợp lệ 400.000 + một khoản XOÁ MỀM
    const o7 = await taoDonFx("O7", { status: "PENDING_PAYMENT", tao: "2031-03-20T08:00:00", dong: [{ khoa: "C1", be: "S2", gia: 1_000_000 }] });
    await thu(o7.id, 1_000_000, "2031-03-20T09:00:00", { ttKt: "REJECTED", note: "[auto:sepay:RV844-TX-7r]" });
    await thu(o7.id, 400_000, "2031-03-21T09:00:00", { note: "[auto:sepay:RV844-TX-7]" });
    await thu(o7.id, 123_456, "2031-03-21T10:00:00", { xoa: true });
    // O8: chuyển DƯ 650k rồi điều chỉnh −50k (delta, loại ADJUSTMENT, kế toán đã xác nhận); quyền học còn PENDING (đã thu đủ mà chưa cấp)
    const o8 = await taoDonFx("O8", { status: "CONFIRMED", tao: "2031-03-22T08:00:00", dong: [{ khoa: "C2", be: "S1", gia: 600_000 }] });
    const p8 = await thu(o8.id, 650_000, "2031-03-22T09:00:00", { ttKt: "CONFIRMED", note: "[auto:sepay:RV844-TX-8]" });
    await thu(o8.id, -50_000, "2031-03-23T09:00:00", { ttKt: "CONFIRMED", loai: "ADJUSTMENT", goc: p8.id });
    await capQuyen(o8.id, o8.dong[0]!, "S1", "C2", null, "PENDING");
    // O9: đơn OFFLINE (type COURSE) cùng tháng — KHÔNG được lọt vào số Online
    const o9 = await taoDonFx("O9", { type: "COURSE", status: "CONFIRMED", tao: "2031-03-05T09:00:00", dong: [{ khoa: "C1", be: "S1", gia: 5_000_000 }] });
    await thu(o9.id, 5_000_000, "2031-03-05T09:30:00", { ttKt: "CONFIRMED" });
    // O14 (THÁNG 10): chia tỉ lệ có PHẦN DƯ — thu 500.001đ trên đơn C1 1.000.000 + học cụ 333.333 (tổng 1.333.333): C1 375.000,84 · khác 125.000,16 ⇒ phần nguyên 375.000 + 125.000, còn 1 đồng về nhóm có phần dư lớn nhất (C1) = 375.001 + 125.000
    const o14 = await taoDonFx("O14", { status: "PENDING_PAYMENT", tao: "2031-10-02T08:00:00", dong: [{ khoa: "C1", be: "S1", gia: 1_000_000 }, { type: "PRODUCT", gia: 333_333 }] });
    await thu(o14.id, 500_001, "2031-10-02T08:30:00", { note: "[auto:sepay:RV844-TX-14]" });
    // O11: tạo 28/02 (ngoài tháng 3) nhưng THU ngày 02/03 ⇒ tiền thuộc tháng 3, đơn thuộc tháng 2
    const o11 = await taoDonFx("O11", { status: "COMPLETED", tao: "2031-02-28T23:30:00", dong: [{ khoa: "C2", be: "S2", gia: 600_000 }] });
    await thu(o11.id, 600_000, "2031-03-02T09:00:00", { note: "[auto:sepay:RV844-TX-11]" });
    await capQuyen(o11.id, o11.dong[0]!, "S2", "C2", "2031-03-02T09:01:00");
  }, 300_000);

  afterAll(async () => {
    SESS.current = null;
    SESS.quyen = new Set();
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 300_000);

  const MARCH = "tu=2031-03-01&den=2031-03-31";

  it("[ODT-01] quyền & tham số", async () => {
    SESS.current = null;
    expect((await goi(summaryGet, "summary", MARCH)).status).toBe(401);
    for (const [r, l] of [[summaryGet, "summary"], [byCourseGet, "by-course"], [reconcileGet, "reconcile"]] as const) {
      dangNhapQuyen(["orders:view", "payments:confirm", "onl:student:view", "onl:course:view"]);
      SESS.hoi = [];
      const x = await goi(r, l, MARCH);
      expect([x.status, x.j.error?.code], l).toEqual([403, "FORBIDDEN"]);
      expect(SESS.hoi, "route phải hỏi ĐÚNG quyền").toEqual(["onl:report:view"]);
      dangNhapQuyen(MARKETING);
      const y = await goi(r, l, MARCH);
      expect(y.status, l).toBe(200);
      expect(y.cc).toBe("no-store");
    }
    dangNhapQuyen(MARKETING);
    const loi = async (q: string, status: number, code: string) => {
      const x = await goi(summaryGet, "summary", q);
      expect([x.status, x.j.error?.code], q).toEqual([status, code]);
    };
    await loi("tu=2031-03-01", 400, "VALIDATION"); // thiếu den
    await loi("tu=2031-03-01&den=2031-03-31&x=1", 400, "VALIDATION"); // tham số lạ
    await loi("tu=2031-02-30&den=2031-03-31", 400, "VALIDATION");
    await loi("tu=2031-03-31&den=2031-03-01", 400, "VALIDATION");
    await loi("tu=2031-01-01&den=2032-02-05", 422, "KHOANG_QUA_DAI");
    await loi(`${MARCH}&nhom=year`, 400, "VALIDATION");
    await loi(`${MARCH}&khoaId=khong-co-khoa`, 404, "NOT_FOUND");
    expect((await goi(reconcileGet, "reconcile", `${MARCH}&khoaId=${P("C1")}`)).status).toBe(400); // đối soát không nhận khoaId
    // bỏ cả hai ⇒ 30 ngày gần nhất tính tới hôm nay (200)
    expect((await goi(summaryGet, "summary", "")).status).toBe(200);
  });

  it("[ODT-02] THÁNG 3: tiền khớp số tính tay VÀ oracle SQL gõ tay", async () => {
    dangNhapQuyen(MARKETING);
    const j = await dung(summaryGet, "summary", MARCH);
    // Tính tay: thu = 1.000.000 (P1) + 1.000.000 (P2a) + 1.730.000 (P3) + 300.000 (P4) + 400.000 (O7) + 650.000 (P8) + 600.000 (O11) = 5.680.000
    // Loại: khoản bị TỪ CHỐI 1.000.000 · khoản xoá mềm 123.456 · đơn OFFLINE 5.000.000 · P2b (01/04 giờ VN) · hai khoản hoàn (tháng 4, tháng 5).
    expect(j.data.tien).toEqual({
      thu: 5_680_000, hoan: 0, dieuChinh: -50_000, rong: 5_630_000,
      soKhoan: { thu: 7, hoan: 0, dieuChinh: 1 },
      rongDaXacNhanKeToan: 3_330_000, // P1 + P3 + 650k − 50k
      rongChoXacNhanKeToan: 2_300_000, // P2a + P4 + 400k + 600k
    });
    expect(await oracle(vn("2031-03-01T00:00:00"), vn("2031-04-01T00:00:00"))).toEqual({ rong: 5_630_000, thu: 5_680_000, hoan: 0, dieuChinh: -50_000, soKhoan: 8 });
    expect(j.data.theoPhapNhan).toEqual([
      { phapNhanId: null, ten: null, thu: 2_950_000, hoan: 0, dieuChinh: -50_000, rong: 2_900_000 },
      { phapNhanId: P("LE-B"), ten: "Pháp nhân B (RV844)", thu: 1_730_000, hoan: 0, dieuChinh: 0, rong: 1_730_000 },
      { phapNhanId: P("LE-A"), ten: "Pháp nhân A (RV844)", thu: 1_000_000, hoan: 0, dieuChinh: 0, rong: 1_000_000 },
    ]);
    expect(j.data.kyBaoCao).toMatchObject({ tu: "2031-03-01", den: "2031-03-31", soNgay: 31, nhom: "day", khoaId: null });
    expect(j.data.hoaHong).toMatchObject({ hoTro: false, soButToanHoaHongCuaDonOnline: 0 });
    expect(j.meta.quyTheoTyLe).toEqual({ soTien: 300_000, soKhoan: 1 }); // chỉ P4 (đơn hỗn hợp trả thiếu) phải chia tỉ lệ
    // chuỗi theo ngày: 31 kỳ đủ (kể cả ngày không có tiền), Σ = ròng
    const ngay = j.data.theoThoiGian as Array<{ ky: string; tien: { rong: number }; soDonHieuLuc: number }>;
    expect(ngay).toHaveLength(31);
    expect(ngay.reduce((s, k) => s + k.tien.rong, 0)).toBe(5_630_000);
    const theo = Object.fromEntries(ngay.filter((k) => k.tien.rong !== 0).map((k) => [k.ky, k.tien.rong]));
    expect(theo).toEqual({ "2031-03-02": 600_000, "2031-03-05": 1_000_000, "2031-03-12": 1_730_000, "2031-03-15": 300_000, "2031-03-21": 400_000, "2031-03-22": 650_000, "2031-03-23": -50_000, "2031-03-31": 1_000_000 });
  });

  it("[ODT-03] biên giờ VN + cộng các khoảng + nhóm tuần/tháng", async () => {
    dangNhapQuyen(MARKETING);
    const rong = async (q: string) => (await dung(summaryGet, "summary", q)).data.tien.rong as number;
    expect(await rong("tu=2031-03-31&den=2031-03-31")).toBe(1_000_000); // 23:30 giờ VN ngày 31/03 (16:30Z)
    expect(await rong("tu=2031-04-01&den=2031-04-01")).toBe(900_000); // 00:10 giờ VN ngày 01/04 = 17:10Z ngày 31/03 — UTC sẽ xếp SAI sang tháng 3
    const [t3, t4, t5] = [await rong(MARCH), await rong("tu=2031-04-01&den=2031-04-30"), await rong("tu=2031-05-01&den=2031-05-31")];
    expect([t3, t4, t5]).toEqual([5_630_000, 300_000, -200_000]);
    expect(await rong("tu=2031-03-01&den=2031-05-31")).toBe(t3 + t4 + t5);
    expect(await rong("tu=2031-03-01&den=2031-05-31")).toBe((await oracle(vn("2031-03-01T00:00:00"), vn("2031-06-01T00:00:00"))).rong);
    // tuần ISO (thứ Hai): 02/03 là Chủ nhật ⇒ tuần 24/02; 31/03 là thứ Hai
    const tuan = (await dung(summaryGet, "summary", `${MARCH}&nhom=week`)).data.theoThoiGian as Array<{ ky: string; tien: { rong: number } }>;
    expect(tuan.map((k) => [k.ky, k.tien.rong])).toEqual([["2031-02-24", 600_000], ["2031-03-03", 1_000_000], ["2031-03-10", 2_030_000], ["2031-03-17", 1_000_000], ["2031-03-24", 0], ["2031-03-31", 1_000_000]]);
    const thang = (await dung(summaryGet, "summary", "tu=2031-03-01&den=2031-05-31&nhom=month")).data.theoThoiGian as Array<{ ky: string; tien: { rong: number } }>;
    expect(thang.map((k) => [k.ky, k.tien.rong])).toEqual([["2031-03", 5_630_000], ["2031-04", 300_000], ["2031-05", -200_000]]);
  });

  it("[ODT-04] hoàn: khác kỳ với khoản gốc; về ĐÚNG khoá; hoàn một phần; đếm yêu cầu", async () => {
    dangNhapQuyen(MARKETING);
    const t4 = (await dung(summaryGet, "summary", "tu=2031-04-01&den=2031-04-30")).data;
    expect(t4.tien).toMatchObject({ thu: 900_000, hoan: 600_000, dieuChinh: 0, rong: 300_000, soKhoan: { thu: 1, hoan: 1, dieuChinh: 0 } });
    expect(t4.yeuCauHoan).toEqual({ choDuyet: 0, daDuyetChuaChi: 0, daChi: 2, tuChoi: 0, tongTienDaDuyet: 800_000 }); // tạo ngày 08/04 và 30/04
    expect(t4.donHang.soDon).toBe(0);
    const ngayA = t4.theoThoiGian as Array<{ ky: string; tien: { rong: number } }>; // 00:10 giờ VN 01/04 (= 17:10Z 31/03) phải rơi vào kỳ 2031-04-01
    expect(Object.fromEntries(ngayA.filter((k) => k.tien.rong !== 0).map((k) => [k.ky, k.tien.rong]))).toEqual({ "2031-04-01": 900_000, "2031-04-10": -600_000 });
    const theoKhoa = (await dung(byCourseGet, "by-course", "tu=2031-04-01&den=2031-04-30")).data.theoKhoa as Array<{ khoaId: string | null; tien: { thu: number; hoan: number; rong: number } }>;
    const k = (id: string | null) => theoKhoa.find((x) => x.khoaId === id)!;
    expect(k(P("C1")).tien).toMatchObject({ thu: 900_000, hoan: 0, rong: 900_000 }); // P2b thuộc đơn C1
    expect(k(P("C2")).tien).toMatchObject({ thu: 0, hoan: 600_000, rong: -600_000 }); // hoàn dòng C2 của đơn hỗn hợp — về C2, không chia tỉ lệ
    const t5 = (await dung(byCourseGet, "by-course", "tu=2031-05-01&den=2031-05-31")).data.theoKhoa as Array<{ khoaId: string | null; tien: { hoan: number; rong: number } }>;
    expect(t5).toHaveLength(1);
    expect(t5[0]).toMatchObject({ khoaId: P("C1"), tien: { hoan: 200_000, rong: -200_000 } }); // hoàn MỘT PHẦN dòng C1 (200k trên 800k)
    expect((await dung(summaryGet, "summary", "tu=2031-05-01&den=2031-05-31")).meta.quyTheoTyLe).toEqual({ soTien: 0, soKhoan: 0 });
  });

  it("[ODT-05] trục đơn + giảm giá + quyền học thật", async () => {
    dangNhapQuyen(MARKETING);
    const d = (await dung(summaryGet, "summary", MARCH)).data;
    expect(d.donHang).toEqual({
      soDon: 8,
      theoTrangThai: { DRAFT: 0, PENDING_PAYMENT: 3, CONFIRMED: 2, COMPLETED: 2, CANCELLED: 1, REFUNDED: 0 },
      soDonHieuLuc: 7,
      // O1, O2 (đủ sau cả hai lần trả), O3 (đủ — hoàn không làm mất "đã thu đủ"), O8 (650k − 50k = 600k) · một phần: O4, O7 · chưa: O6
      thanhToan: { daThuDu: 4, motPhan: 2, chuaThu: 1, khongCanThanhToan: 0 },
      niemYet: 7_800_000,
      giamGia: 300_000,
      phiGiaoHang: 50_000,
      giaTriDon: 7_550_000,
    });
    const tongOrder = await db.order.aggregate({ where: { code: { startsWith: "RV844-" }, type: "ONLINE", status: { notIn: ["CANCELLED", "DRAFT"] }, createdAt: { gte: vn("2031-03-01T00:00:00"), lt: vn("2031-04-01T00:00:00") } }, _sum: { totalAmount: true } });
    expect(d.donHang.giaTriDon).toBe(tongOrder._sum.totalAmount);
    expect(d.giamGia).toEqual({ tong: 300_000, theoMa: [{ ma: "RV844-GIAM10", ten: "Giảm 10% thử", soLuot: 1, soTienGiam: 100_000 }], giamKhongQuaMa: 200_000 });
    // quyền học: chỉ GRANTED + có entitlementId, theo ngày CẤP — G2a/G2b cấp 01/04 không vào tháng 3; O8 còn PENDING không đếm
    expect(d.quyenHoc).toEqual({ soQuyenDaCap: 4, soHocVienDuocCap: 2 });
    const a = (await dung(summaryGet, "summary", "tu=2031-04-01&den=2031-04-30")).data.quyenHoc;
    expect(a).toEqual({ soQuyenDaCap: 2, soHocVienDuocCap: 2 });
    expect(d.canhBao.donDaThuDuChuaCapQuyen).toBe(1); // O8 thu đủ nhưng quyền PENDING
    // chuỗi theo ngày của trục đơn: đơn huỷ (18/03) không tính
    const ngay = d.theoThoiGian as Array<{ ky: string; soDonHieuLuc: number; giamGia: number }>;
    expect(ngay.find((x) => x.ky === "2031-03-18")!.soDonHieuLuc).toBe(0);
    expect(ngay.find((x) => x.ky === "2031-03-12")).toMatchObject({ soDonHieuLuc: 1, giamGia: 200_000 });
    expect(ngay.reduce((s, x) => s + x.soDonHieuLuc, 0)).toBe(7);
    // Một tháng KHÔNG có đơn tạo: số đơn 0 nhưng tiền vẫn có (hai trục độc lập)
    expect((await dung(summaryGet, "summary", "tu=2031-04-01&den=2031-04-30")).data.donHang).toMatchObject({ soDon: 0, niemYet: 0, giaTriDon: 0 });
  });

  it("[ODT-06] theo khoá + lọc khoá: Σ các lát = tổng", async () => {
    dangNhapQuyen(MARKETING);
    const tong = (await dung(summaryGet, "summary", MARCH)).data;
    const bk = await dung(byCourseGet, "by-course", MARCH);
    const hang = bk.data.theoKhoa as Array<{ khoaId: string | null; ma: string | null; ten: string; tien: { rong: number }; donHang: { soDonHieuLuc: number; niemYet: number; giamGia: number; phiGiaoHang: number }; quyenHoc: { soQuyenDaCap: number; soHocVienDuocCap: number } }>;
    expect(hang.map((h) => [h.khoaId, h.tien.rong])).toEqual([[P("C1"), 3_200_000], [P("C2"), 2_050_000], [null, 380_000]]);
    expect(hang.reduce((s, h) => s + h.tien.rong, 0)).toBe(tong.tien.rong);
    expect(hang[2]).toMatchObject({ ma: null, ten: "Học cụ & phí giao hàng", donHang: { soDonHieuLuc: 2, niemYet: 400_000, giamGia: 0, phiGiaoHang: 50_000 } });
    expect(hang[0]).toMatchObject({ donHang: { soDonHieuLuc: 4, niemYet: 5_000_000, giamGia: 300_000 }, quyenHoc: { soQuyenDaCap: 2, soHocVienDuocCap: 1 } });
    expect(hang[1]).toMatchObject({ donHang: { soDonHieuLuc: 4, niemYet: 2_400_000, giamGia: 0 }, quyenHoc: { soQuyenDaCap: 2, soHocVienDuocCap: 1 } });
    expect(bk.meta.quyTheoTyLe).toEqual({ soTien: 300_000, soKhoan: 1 });
    // C2: O3 600k (đơn đủ giá trị ⇒ đúng thành tiền dòng) + O4 250k (chia tỉ lệ 600/720 của 300k) + O8 650k − 50k + O11 600k = 2.050.000
    const c2 = (await dung(summaryGet, "summary", `${MARCH}&khoaId=${P("C2")}`)).data;
    expect(c2.tien).toMatchObject({ thu: 2_100_000, hoan: 0, dieuChinh: -50_000, rong: 2_050_000 });
    expect(c2.donHang).toMatchObject({ soDon: 4, soDonHieuLuc: 4, niemYet: 2_400_000, giamGia: 0, phiGiaoHang: 0, giaTriDon: 2_400_000 });
    expect(c2.quyenHoc).toEqual({ soQuyenDaCap: 2, soHocVienDuocCap: 1 });
    expect((c2.theoThoiGian as Array<{ tien: { rong: number } }>).reduce((s, k) => s + k.tien.rong, 0)).toBe(2_050_000);
    // THÁNG 10: phần dư đồng lẻ — Σ lát luôn bằng đúng số tiền thu
    const t10 = await dung(byCourseGet, "by-course", "tu=2031-10-01&den=2031-10-31");
    expect((t10.data.theoKhoa as Array<{ khoaId: string | null; tien: { rong: number } }>).map((h) => [h.khoaId, h.tien.rong])).toEqual([[P("C1"), 375_001], [null, 125_000]]);
    expect(t10.meta.quyTheoTyLe).toEqual({ soTien: 500_001, soKhoan: 1 });
    const c1 = (await dung(summaryGet, "summary", `${MARCH}&khoaId=${P("C1")}`)).data;
    expect(c1.tien.rong).toBe(3_200_000);
    expect(c1.donHang).toMatchObject({ soDon: 5, soDonHieuLuc: 4 }); // O5 đã huỷ vẫn nằm trong số đơn, không nằm trong hiệu lực
    // đơn một khoá: lọc theo C1 không bị ảnh hưởng bởi học cụ/phí giao; phần học cụ+giao của O3/O4 thuộc nhóm "khác" nên KHÔNG vào lát C1/C2
    expect(c1.tien.rong + c2.tien.rong + hang[2]!.tien.rong).toBe(tong.tien.rong);
  });

  it("[ODT-07] đối soát: khớp trên tháng 3; bắt giao dịch trùng mã, hoàn không có yêu cầu, yêu cầu hoàn chi mà sổ không có", async () => {
    dangNhapQuyen(MARKETING);
    const r3 = (await dung(reconcileGet, "reconcile", MARCH)).data;
    expect(r3.khop).toBe(true);
    expect((r3.kiemTra as Array<{ ma: string; dat: boolean }>).map((k) => [k.ma, k.dat])).toEqual([
      ["RONG_SO_CAI", true], ["DANG_THUC", true], ["TONG_THEO_KHOA", true], ["TONG_THEO_KY", true], ["TONG_THEO_PHAP_NHAN", true], ["HOAN_SO_CAI_KHOP_YEU_CAU", true], ["GIA_TRI_DON_SO_CAI", true], ["RONG_DA_XAC_NHAN", true],
    ]);
    expect(r3.tomTat).toEqual({ rong: 5_630_000, rongDaXacNhanKeToan: 3_330_000, rongChoXacNhanKeToan: 2_300_000 });
    expect(r3.canhBao).toEqual({ maGiaoDichTrung: 0, donThuThua: { soDon: 0, soTien: 0 }, hoanKhongCoYeuCau: 0, donDaThuDuChuaCapQuyen: 1 });
    // THÁNG 8: webhook gửi lại LỌT thành hai dòng cùng mã ⇒ API đếm theo sổ (2 khoản) nhưng CẢNH BÁO; cộng một khoản hoàn cũ không có yêu cầu
    const o12 = await taoDonFx("O12", { status: "COMPLETED", tao: "2031-08-03T09:00:00", dong: [{ khoa: "C1", be: "S1", gia: 1_000_000 }] });
    await thu(o12.id, 1_000_000, "2031-08-03T09:10:00", { note: "[auto:sepay:RV844-DUP]" });
    await thu(o12.id, 1_000_000, "2031-08-03T09:10:05", { note: "[auto:sepay:RV844-DUP]" });
    await thu(o12.id, -100_000, "2031-08-05T09:00:00", { ttKt: "REFUNDED" }); // refundPayment đời cũ: không có refundRequestId
    const r8 = (await dung(reconcileGet, "reconcile", "tu=2031-08-01&den=2031-08-31")).data;
    expect(r8.khop).toBe(true);
    expect(r8.tomTat.rong).toBe(1_900_000);
    expect(r8.canhBao).toEqual({ maGiaoDichTrung: 1, donThuThua: { soDon: 1, soTien: 1_000_000 }, hoanKhongCoYeuCau: 1, donDaThuDuChuaCapQuyen: 0 });
    // hoàn không có yêu cầu ⇒ chia tỉ lệ theo dòng đơn (đơn một nhóm ⇒ cả khoản về C1, KHÔNG ước tính)
    const s8 = (await dung(summaryGet, "summary", "tu=2031-08-01&den=2031-08-31")).data;
    expect(s8.tien).toMatchObject({ thu: 2_000_000, hoan: 100_000, rong: 1_900_000 });
    // THÁNG 9: yêu cầu hoàn ĐÃ CHI nhưng sổ KHÔNG có dòng âm ⇒ đối soát PHẢI lệch
    const o13 = await taoDonFx("O13", { status: "COMPLETED", tao: "2031-09-03T09:00:00", dong: [{ khoa: "C2", be: "S2", gia: 600_000 }] });
    await thu(o13.id, 600_000, "2031-09-03T09:10:00", { note: "[auto:sepay:RV844-TX-13]" });
    await yeuCauHoan(o13.dong[0]!, 300_000, "2031-09-10T09:00:00", "2031-09-12T09:00:00");
    const r9 = (await dung(reconcileGet, "reconcile", "tu=2031-09-01&den=2031-09-30")).data;
    expect(r9.khop).toBe(false);
    expect(r9.kiemTra.filter((k: { dat: boolean }) => !k.dat)).toEqual([{ ma: "HOAN_SO_CAI_KHOP_YEU_CAU", moTa: expect.any(String), api: 0, doiChieu: 300_000, lech: -300_000, dat: false }]);
  });

  it("[ODT-08] trần cửa sổ ⇒ lỗi rõ ràng, không cắt lặng lẽ", async () => {
    const k = docKhoangNgay("2031-03-01", "2031-03-31", new Date());
    if (!k.ok) throw new Error("khoảng");
    const p = { khoang: k.khoang, nhom: "day" as const, khoaId: null };
    await expect(tinhDoanhThuOnline(db, p, { khoan: 5 })).rejects.toMatchObject({ name: "LoiDoanhThu", ma: "CUA_SO_QUA_LON" });
    await expect(tinhDoanhThuOnline(db, p, { don: 3 })).rejects.toBeInstanceOf(LoiDoanhThu);
    await expect(tinhDoanhThuOnline(db, p, { quyen: 2 })).rejects.toBeInstanceOf(LoiDoanhThu);
    await expect(tinhDoanhThuOnline(db, p, { khoan: 8, don: 8, quyen: 4 })).resolves.toMatchObject({ tien: { rong: 5_630_000 } }); // đúng sát trần thì KHÔNG lỗi
  });

  it("[ODT-09] KHÔNG PII: không chuỗi định danh của fixture, không khoá nhạy cảm", async () => {
    dangNhapQuyen(MARKETING);
    const bodies = [
      await goi(summaryGet, "summary", MARCH),
      await goi(summaryGet, "summary", `${MARCH}&khoaId=${P("C2")}&nhom=week`),
      await goi(byCourseGet, "by-course", MARCH),
      await goi(reconcileGet, "reconcile", MARCH),
      await goi(byCourseGet, "by-course", "tu=2031-04-01&den=2031-05-31"),
    ];
    const cam = [TEN_PH, SDT_PH, "84966990001", EMAIL_PH, "Phụ-Huynh-RV", ...TEN_BE, "Alpha-RV", "Beta-RV", "Gamma-RV", P("PA"), P("S1"), P("S2"), P("S3"), "RV844-O1", "RV844-O3"];
    const khoaCam = /^(customer\w*|invoice\w*|studentId|student|hocVien(Id|Ten)?|phuHuynh\w*|email|phone|soDienThoai|hoTen|name|parentUserId|createdById|nguoiMua|nguoiTao)$/i;
    const khoaTrongJson = (v: unknown, ra = new Set<string>()): Set<string> => {
      if (Array.isArray(v)) v.forEach((x) => khoaTrongJson(x, ra));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
        ra.add(k);
        khoaTrongJson(x, ra);
      }
      return ra;
    };
    luuMau("summary-2031-03", bodies[0]!.j);
    luuMau("summary-2031-03-khoa-C2-tuan", bodies[1]!.j);
    luuMau("by-course-2031-03", bodies[2]!.j);
    luuMau("reconcile-2031-03", bodies[3]!.j);
    for (const b of bodies) {
      expect(b.status).toBe(200);
      const s = JSON.stringify(b.j);
      for (const c of cam) expect(s.includes(c), `lộ chuỗi "${c}"`).toBe(false);
      for (const k of khoaTrongJson(b.j)) expect(khoaCam.test(k), `khoá nhạy cảm "${k}"`).toBe(false);
    }
  });

  it("[ODT-10] seed (tĩnh): Marketing/Kế toán HO/Đào tạo/QTTC có `onl:report:view`; vai khác KHÔNG; Marketing không có quyền PII Online", () => {
    const src = readFileSync(resolve(process.cwd(), "prisma/seed-roles.ts"), "utf8");
    const khoi = (ma: string) => {
      const i = src.indexOf(`code: "${ma}"`);
      expect(i, ma).toBeGreaterThan(-1);
      const j = src.indexOf("\n    code: \"", i + 10);
      return src.slice(i, j === -1 ? undefined : j);
    };
    for (const ma of ["SUPER_ADMIN", "HO_ACCOUNTANT", "HO_MARKETING", "TRAINING"]) expect(khoi(ma), ma).toContain('action: "onl:report:view"');
    for (const ma of ["CENTER_MANAGER", "CENTER_SALES_CSM", "TEACHER", "PARENT", "HO_SALE", "CENTER_ACCOUNTANT"]) expect(khoi(ma), `đối chứng ÂM ${ma}`).not.toContain('action: "onl:report:view"');
    const mk = khoi("HO_MARKETING");
    for (const q of ["onl:student:pii", "onl:student:view", "orders:view-pii", "payments:confirm"]) expect(mk, q).not.toContain(`action: "${q}"`);
  });

  it("[ODT-11] ĐƯỜNG THẬT: tạo đơn qua route phụ huynh → webhook gửi LẠI cùng reference → hoàn một phần → API (một đồng không đếm hai lần)", async () => {
    const MKP = "Mat-khau-test-2026";
    const hash = await bcrypt.hash(MKP, 4);
    const ph = await db.user.create({ data: { email: `${NS}real-ph@seed.invalid`, name: "Phụ huynh thật-RV", phone: "84966990007", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    const nv = await db.user.create({ data: { email: `${NS}real-nv@seed.invalid`, name: "Kế toán thật-RV", phone: "84966990008", password: hash, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] } as never, select: { id: true } });
    const nv2 = await db.user.create({ data: { email: `${NS}real-nv2@seed.invalid`, name: "Kế toán 2-RV", phone: "84966990009", password: hash, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] } as never, select: { id: true } });
    const be = await db.student.create({ data: { id: `${NS}real-be`, name: "Bé thật-RV", parentUserId: ph.id } as never, select: { id: true } });
    const khoa = await dungKhoaPhatHanh(500_000);
    const dn = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966990007", matKhau: MKP, thietBi: { maThietBi: "00000000-0000-4000-9e00-000000000001", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const tk = ((await dn.json()) as Tra).data.accessToken as string;
    await quyDinhDongY(req("POST", "/x", {}, `Bearer ${tk}`));
    const tao = (await (await taoDonPost(req("POST", "/x", { dong: [{ studentId: be.id, khoaId: khoa.courseId }] }, `Bearer ${tk}`))).json()) as Tra;
    expect(tao.ok, JSON.stringify(tao.error)).toBe(true);
    const orderId = tao.data.orderId as string;
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } });
    const goiHook = () => ingestPayosWebhook({ reference: `RV844-REAL-${orderId}`, description: `${phieu.matchKey} HOC PHI ONLINE`, amount: tao.data.tongTien, transactionDateTime: "2031-06-10 10:00:00", accountNumber: "9999000000001" }, "SEPAY");
    expect((await goiHook()).status).toBe("MATCHED");
    await goiHook(); // gửi LẠI cùng reference — idempotent
    expect(await db.payment.count({ where: { orderId } })).toBe(1);
    // dời đơn vào cửa sổ riêng (tháng 6/2031) rồi để kế toán xác nhận + hoàn MỘT PHẦN 200k
    await db.order.update({ where: { id: orderId }, data: { createdAt: vn("2031-06-10T09:00:00") } });
    await db.payment.updateMany({ where: { orderId }, data: { paidDate: vn("2031-06-10T10:00:00"), accountantStatus: "CONFIRMED" } });
    await db.orderOnlineGrant.updateMany({ where: { orderId }, data: { grantedAt: vn("2031-06-10T10:01:00") } });
    const dong = await db.orderItem.findFirstOrThrow({ where: { orderId }, select: { id: true } });
    const y = await taoYeuCauHoanOnline(db as never, { orderId, orderItemId: dong.id, lyDo: "Con không còn học được khoá này", nguon: { kenh: "STAFF", staffId: nv.id, staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    if (!y.ok) throw new Error(`tạo yêu cầu: ${JSON.stringify(y)}`);
    expect(await duyetHoanOnline(db as never, { id: y.yeuCau.id, approverId: nv2.id, approverName: "NV2", soTienDuyet: 200_000, now: new Date() })).toMatchObject({ ok: true });
    expect(await chiHoanOnline(db as never, { id: y.yeuCau.id, actorId: nv2.id, actorName: "NV2", method: "BANK_TRANSFER", paidDate: vn("2031-06-20T09:00:00"), maGiaoDichHoan: "FT-RV844", note: "hoàn một phần", now: new Date() })).toMatchObject({ ok: true });

    await db.refundRequest.update({ where: { id: y.yeuCau.id }, data: { createdAt: vn("2031-06-18T09:00:00") } });

    dangNhapQuyen(MARKETING);
    const q = `tu=2031-06-01&den=2031-06-30&khoaId=${khoa.courseId}`;
    const j = (await dung(summaryGet, "summary", q)).data;
    expect(j.tien).toMatchObject({ thu: 500_000, hoan: 200_000, dieuChinh: 0, rong: 300_000, soKhoan: { thu: 1, hoan: 1, dieuChinh: 0 }, rongDaXacNhanKeToan: 300_000 });
    expect(j.donHang).toMatchObject({ soDon: 1, soDonHieuLuc: 1, niemYet: 500_000, giamGia: 0, thanhToan: { daThuDu: 1, motPhan: 0, chuaThu: 0, khongCanThanhToan: 0 } });
    expect(j.quyenHoc).toEqual({ soQuyenDaCap: 1, soHocVienDuocCap: 1 });
    expect(j.yeuCauHoan).toMatchObject({ daChi: 1, tongTienDaDuyet: 200_000 });
    expect(j.canhBao).toEqual({ maGiaoDichTrung: 0, donThuThua: { soDon: 0, soTien: 0 }, hoanKhongCoYeuCau: 0, donDaThuDuChuaCapQuyen: 0 });
    expect(await oracle(vn("2031-06-01T00:00:00"), vn("2031-07-01T00:00:00"))).toMatchObject({ rong: 300_000, thu: 500_000, hoan: 200_000 });
    const rs = (await dung(reconcileGet, "reconcile", "tu=2031-06-01&den=2031-06-30")).data;
    expect(rs.khop).toBe(true);
    expect(rs.tomTat.rong).toBe(300_000);
  }, 300_000);
});
