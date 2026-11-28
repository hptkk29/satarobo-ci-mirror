import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/route";
import { POST as rutPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/refund-requests/[id]/cancel/route";
import { GET as hoanGet, POST as hoanPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/refund-requests/route";
import { POST as taoDonPost } from "@/app/api/mobile/v1/parent/online-orders/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as muaDuocGet } from "@/app/api/mobile/v1/students/[studentId]/online/purchasable/route";
import { GET as adminDs } from "@/app/api/admin/online-refunds/route";
import { GET as adminCt } from "@/app/api/admin/online-refunds/[id]/route";
import { POST as adminDuyet } from "@/app/api/admin/online-refunds/[id]/approve/route";
import { POST as adminTuChoi } from "@/app/api/admin/online-refunds/[id]/reject/route";
import { POST as adminChi } from "@/app/api/admin/online-refunds/[id]/pay/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { capQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { chiHoanOnline, duyetHoanOnline, taoYeuCauHoanOnline, tuChoiHoanOnline } from "@/lib/finance/hoan-tien-online";
import { dungHuongDanThanhToan } from "@/lib/online-checkout/huong-dan-thanh-toan";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { setGlobalSetting } from "@/lib/settings/service";
import { donBangOnl } from "../elearning/_onl-don";
import { seedOrg, seedRoles } from "../e2e/_helpers/seed";

/**
 * [HTO] V8.40 — HOÀN TIỀN ONLINE (PAY-06) qua route phụ huynh + dịch vụ nhân viên + Postgres thật.
 *   [HTO-01] gửi yêu cầu: tắt ⇒ 409, GET vẫn 200; strict (số tiền/bằng chứng ⇒ 400); lyDo 10–500 code point; đơn/dòng người khác ⇒ 404; một yêu cầu MỞ/dòng (daCo)
 *   [HTO-02] duyệt: số tiền BẮT BUỘC, nguyên, >0; trần HAI PHÍA (giá dòng · tiền đã thu của đơn · khoản duyệt khác); nhân viên không tự duyệt
 *   [HTO-03] chi: dòng Payment âm liên kết khoản gốc, idempotent, trần kiểm lại lúc chi; MUA hoàn hết ⇒ thu hồi quyền; GIA_HAN/một phần ⇒ canXuLyQuyen
 *   [HTO-04] NGƯỜI ĐỌC: đã hoàn hết vẫn DA_THU_DU, không hướng dẫn thanh toán, daThu = tiền đang giữ, lịch sử thu chỉ dương + lichSuHoan; MOT_PHAN/DA_HOAN; đơn hoàn hết ⇒ REFUNDED
 *   [HTO-05] chuyển khoản TRỄ cùng nội dung SR sau hoàn ⇒ KHÔNG cấp lại quyền · [HTO-06] rút yêu cầu · [HTO-07] từ chối + lộ trường · [HTO-08] song song
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "htoh-";
const MK = "Mat-khau-test-2026";
const LY_DO = "Con không còn học được khoá này nữa";
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
let n = 0;

async function dungKhoa(gia: number) {
  const t = await taoKhoa(db, { code: `HTO-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: true, renewalPrice: 200_000 }, null);
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

async function don() {
  await donBangOnl(db);
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  const oid = (await db.order.findMany({ where: { createdById: { in: uids } }, select: { id: true } })).map((o) => o.id);
  if (oid.length) {
    await db.refundRequest.deleteMany({ where: { orderItem: { orderId: { in: oid } } } }).catch(() => undefined);
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
  await db.auditLog.deleteMany({ where: { entityType: "RefundRequest" } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

// Làm ấm đủ 5 kết nối của pool TRƯỚC mỗi đợt bắn: pool nguội ⇒ lượt đầu commit xong trước khi các lượt sau mở được kết nối ⇒ «song song» thực ra là nối tiếp và ca không bắt được tranh chấp.
const amPool = () => Promise.all(Array.from({ length: 5 }, () => db.$queryRaw`SELECT pg_sleep(0.05)::text AS x`));

describe.skipIf(!RUN)("[HTO] hoàn tiền Online", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const P = (k: string) => ids[k]!;
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9b00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
    const t = (j.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  const batKenh = async (v: boolean) => {
    const r = await setGlobalSetting({ isSuperAdmin: true } as never, { key: "onlineRefund.parentRequestEnabled", value: v, reason: "kiểm thử hoàn tiền Online", actorName: "test" });
    if (!r.ok) throw new Error(`đặt tham số: ${JSON.stringify(r.error)}`);
  };
  const taoDon = async (t: string, dong: Array<{ studentId: string; khoaId: string }>) => (await json(await taoDonPost(req("POST", "/x", { dong }, bearer(t))))).data as { orderId: string; dong: Array<{ orderItemId: string; courseId: string }>; tongTien: number };
  const chiTiet = async (t: string, orderId: string) => (await json(await chiTietGet(req("GET", "/x", undefined, bearer(t)), { params: Promise.resolve({ orderId }) as never }))).data;
  const traTien = async (orderId: string, soTien: number, ref: string) => {
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } });
    return ingestPayosWebhook({ reference: ref, description: `${phieu.matchKey} HOC PHI ONLINE`, amount: soTien, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" }, "SEPAY");
  };
  /** đơn đã thu ĐỦ + kế toán đã XÁC NHẬN khoản thu (điều kiện để hoàn) */
  const donDaThu = async (dong: Array<{ studentId: string; khoa: { courseId: string; gia: number } }>) => {
    const d = await taoDon(tA, dong.map((x) => ({ studentId: x.studentId, khoaId: x.khoa.courseId })));
    const r = await traTien(d.orderId, d.tongTien, `HTO-${Date.now()}-${++n}`);
    expect(r.status).toBe("MATCHED");
    await db.payment.updateMany({ where: { orderId: d.orderId, amount: { gt: 0 } }, data: { accountantStatus: "CONFIRMED" } });
    return d;
  };
  const gui = (t: string, orderId: string, body: unknown) => hoanPost(req("POST", "/x", body, bearer(t)), { params: Promise.resolve({ orderId }) as never });
  const xem = (t: string, orderId: string) => hoanGet(req("GET", "/x", undefined, bearer(t)), { params: Promise.resolve({ orderId }) as never });
  const rut = (t: string, orderId: string, id: string) => rutPost(req("POST", "/x", {}, bearer(t)), { params: Promise.resolve({ orderId, id }) as never });
  const NV = () => ({ approverId: P("nv"), approverName: "Kế toán thử" });
  const duyet = (id: string, soTien: unknown, approverId = P("nv")) => duyetHoanOnline(db as never, { id, approverId, approverName: "Kế toán thử", soTienDuyet: soTien, now: new Date() });
  const chi = (id: string) => chiHoanOnline(db as never, { id, actorId: P("nv"), actorName: "Kế toán thử", method: "BANK_TRANSFER", paidDate: new Date(), maGiaoDichHoan: "FT-HOAN-0001", note: "đã chuyển khoản hoàn", now: new Date() });
  const soQuyenConHieuLuc = async (studentId: string, courseId: string) => db.onlEntitlement.count({ where: { studentId, courseId, status: "ACTIVE" } });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string, role = "PARENT") => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `ND ${k}`, phone: sdt, password: hash, role, roles: [role] } as never, select: { id: true } })).id);
    await mk("A", "84966930001");
    await mk("B", "84966930002");
    await mk("nv", "84966930003", "ACCOUNTANT");
    await mk("nv2", "84966930004", "ACCOUNTANT");
    await mk("qt", "84966930005", "SUPER_ADMIN");
    // 28/11/2026 — cổng hoàn tiền Online đọc quyền từ `UserOrgRole` (bỏ so chuỗi vai trên phiên) ⇒ Quản trị tối cao của bộ này phải được neo vai thật ở Hội sở.
    await seedOrg(["HO"]);
    await seedRoles();
    const goc = (await db.orgUnit.findFirstOrThrow({ where: { type: { in: ["ROOT", "HO"] } }, orderBy: { depth: "asc" }, select: { id: true } })).id;
    const vaiQt = (await db.roleDef.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, select: { id: true } })).id;
    await db.userOrgRole.create({ data: { userId: P("qt"), orgUnitId: goc, roleId: vaiQt, grantedById: P("qt") } });
    for (const [k, ph] of [["a1", "A"], ["a2", "A"], ["a3", "A"], ["a4", "A"], ["a5", "A"], ["a6", "A"], ["a7", "A"], ["a8", "A"], ["b1", "B"]] as const) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: P(ph) } as never, select: { id: true } })).id;
    tA = await dn("0966930001", 1);
    tB = await dn("0966930002", 2);
    await batKenh(false);
  }, 240_000);
  afterAll(async () => {
    await batKenh(false).catch(() => undefined);
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 240_000);

  it("[HTO-01] gửi yêu cầu: kênh tắt ⇒ 409 (GET vẫn 200); strict; lyDo; người khác 404; một yêu cầu mở/dòng", async () => {
    const k = await dungKhoa(500_000);
    const d = await donDaThu([{ studentId: P("sa1"), khoa: k }]);
    const dong = d.dong[0]!.orderItemId;
    // kênh TẮT
    expect(await ma(await gui(tA, d.orderId, { orderItemId: dong, lyDo: LY_DO }))).toEqual([409, "HOAN_TIEN_DANG_TAT"]);
    const x0 = await xem(tA, d.orderId);
    expect(x0.status).toBe(200);
    expect((await json(x0)).data).toEqual({ muc: [] });
    expect((await chiTiet(tA, d.orderId)).hoanTien).toMatchObject({ trangThai: "KHONG", choPhepGuiYeuCau: false, yeuCauMo: null });
    await batKenh(true);
    // strict + lyDo
    for (const thua of [{ soTien: 1 }, { bangChung: [] }, { daHoan: true }, { status: "PAID" }]) expect((await gui(tA, d.orderId, { orderItemId: dong, lyDo: LY_DO, ...thua })).status, JSON.stringify(thua)).toBe(400);
    expect((await gui(tA, d.orderId, { orderItemId: dong, lyDo: "ngắn" })).status).toBe(400);
    expect((await gui(tA, d.orderId, { orderItemId: dong, lyDo: "   chín ký t" })).status).toBe(400); // sau trim = 9 code point
    expect((await gui(tA, d.orderId, { orderItemId: dong, lyDo: "ệ".repeat(501) })).status).toBe(400); // > 500 code point
    expect((await gui(tA, d.orderId, { orderItemId: dong, lyDo: "ệ".repeat(10) })).status).toBe(200); // đúng 10 code point (có dấu) — rồi hủy ở dưới
    await db.refundRequest.deleteMany({ where: { orderItemId: dong } });
    // người khác ⇒ 404; dòng lạ ⇒ 404
    expect((await gui(tB, d.orderId, { orderItemId: dong, lyDo: LY_DO })).status).toBe(404);
    expect((await gui(tA, d.orderId, { orderItemId: "khong-co-dong", lyDo: LY_DO })).status).toBe(404);
    expect((await xem(tB, d.orderId)).status).toBe(404);
    // một yêu cầu MỞ / dòng
    const a = await gui(tA, d.orderId, { orderItemId: dong, lyDo: LY_DO });
    expect(a.status).toBe(200);
    const ja = (await json(a)).data;
    expect(ja).toMatchObject({ daCo: false, yeuCau: { trangThai: "PENDING", orderItemId: dong, lyDo: LY_DO, soTienDuocDuyet: null, daHoanLuc: null } });
    const b2 = (await json(await gui(tA, d.orderId, { orderItemId: dong, lyDo: "Một lý do khác cũng đủ dài" }))).data;
    expect(b2).toMatchObject({ daCo: true, yeuCau: { id: ja.yeuCau.id } });
    expect(await db.refundRequest.count({ where: { orderItemId: dong, kenh: "ONLINE" } })).toBe(1);
    // nhân viên tạo cũng không tạo được yêu cầu mở thứ hai
    const nv = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: dong, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    expect(nv).toMatchObject({ ok: true, daCo: true });
    // chỉ mục từng phần ở DB: chèn thẳng bản mở thứ hai ⇒ lỗi
    await expect(db.refundRequest.create({ data: { orderItemId: dong, trigger: "MANUAL", reason: "x", paidConfirmed: 0, sessionsTotal: 0, sessionsLearned: 0, unitPrice: 0, proposedAmount: 0, status: "PENDING", kenh: "ONLINE" } as never })).rejects.toThrow();
    // dòng không phải ONLINE (ràng buộc DB): ONLINE bắt buộc có orderItemId
    await expect(db.refundRequest.create({ data: { trigger: "MANUAL", reason: "x", paidConfirmed: 0, sessionsTotal: 0, sessionsLearned: 0, unitPrice: 0, proposedAmount: 0, status: "PENDING", kenh: "ONLINE", enrollmentId: null } as never })).rejects.toThrow();
    const d2 = (await chiTiet(tA, d.orderId)).hoanTien;
    expect(d2).toMatchObject({ trangThai: "DANG_XET", choPhepGuiYeuCau: true, yeuCauMo: { id: ja.yeuCau.id, trangThai: "PENDING" } });
    await batKenh(false);
  });

  it("[HTO-02] duyệt: số tiền bắt buộc/nguyên/>0; trần HAI PHÍA; không tự duyệt", async () => {
    const k1 = await dungKhoa(500_000);
    const k2 = await dungKhoa(300_000);
    const d = await donDaThu([{ studentId: P("sa2"), khoa: k1 }, { studentId: P("sa3"), khoa: k2 }]);
    const [i1, i2] = d.dong.map((x) => x.orderItemId) as [string, string];
    const y1 = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: i1, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    const y2 = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: i2, lyDo: LY_DO, nguon: { kenh: "PARENT", parentUserId: P("A") }, choPhepPhuHuynh: true, now: new Date() });
    if (!y1.ok || !y2.ok) throw new Error("tạo yêu cầu");
    // số tiền xấu
    for (const xau of [undefined, null, 0, -1, 1.5, "500000", Number.NaN]) expect(await duyet(y1.yeuCau.id, xau, P("nv2")), String(xau)).toMatchObject({ ok: false, ma: "VALIDATION" });
    // vượt giá dòng
    expect(await duyet(y1.yeuCau.id, 500_001, P("nv2"))).toMatchObject({ ok: false, ma: "VUOT_TRAN" });
    // nhân viên tạo thì không tự duyệt; người khác duyệt được
    expect(await duyet(y1.yeuCau.id, 500_000, P("nv"))).toMatchObject({ ok: false, ma: "TU_DUYET" });
    expect(await duyet(y1.yeuCau.id, 500_000, P("nv2"))).toMatchObject({ ok: true, soTienDuyet: 500_000 });
    // đã duyệt khoản 500k của dòng 1 ⇒ dòng 2 (giá 300k) vẫn ≤ 800k − 500k = 300k
    expect(await duyet(y2.yeuCau.id, 300_001)).toMatchObject({ ok: false, ma: "VUOT_TRAN" });
    expect(await duyet(y2.yeuCau.id, 300_000)).toMatchObject({ ok: true });
    expect(await duyet(y2.yeuCau.id, 1)).toMatchObject({ ok: false, ma: "SAI_TRANG_THAI" }); // đã duyệt rồi
    const dd = await db.refundRequest.findUniqueOrThrow({ where: { id: y1.yeuCau.id }, select: { status: true, approvedAmount: true, approvedById: true } });
    expect(dd).toMatchObject({ status: "APPROVED", approvedAmount: 500_000, approvedById: P("nv2") });
    // trần theo ĐƠN: đơn chỉ thu MỘT PHẦN (kế toán mới xác nhận 100k) ⇒ không duyệt quá tiền đã thu dù giá dòng cao hơn
    const k3 = await dungKhoa(500_000);
    const d3 = await taoDon(tA, [{ studentId: P("sa4"), khoaId: k3.courseId }]);
    expect((await traTien(d3.orderId, 100_000, `HTO-p-${Date.now()}`)).status).toBe("MATCHED");
    await db.payment.updateMany({ where: { orderId: d3.orderId, amount: { gt: 0 } }, data: { accountantStatus: "CONFIRMED" } });
    expect(await taoYeuCauHoanOnline(db as never, { orderId: d3.orderId, orderItemId: d3.dong[0]!.orderItemId, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() })).toMatchObject({ ok: true });
    const y3 = await db.refundRequest.findFirstOrThrow({ where: { orderItemId: d3.dong[0]!.orderItemId }, select: { id: true } });
    expect(await duyet(y3.id, 100_001, P("nv2"))).toMatchObject({ ok: false, ma: "VUOT_TRAN" });
    expect(await duyet(y3.id, 100_000, P("nv2"))).toMatchObject({ ok: true });
    // đơn CHƯA có khoản thu xác nhận ⇒ không tạo được yêu cầu
    const k4 = await dungKhoa(100_000);
    const d4 = await taoDon(tA, [{ studentId: P("sa5"), khoaId: k4.courseId }]);
    expect(await taoYeuCauHoanOnline(db as never, { orderId: d4.orderId, orderItemId: d4.dong[0]!.orderItemId, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() })).toMatchObject({ ok: false, ma: "DONG_KHONG_HOP_LE" });
    void NV;
  });

  it("[HTO-03/04] chi hoàn: Payment âm liên kết gốc; idempotent; MUA hoàn hết ⇒ thu hồi quyền; người đọc đúng; đơn hoàn hết ⇒ REFUNDED", async () => {
    const k1 = await dungKhoa(500_000);
    const k2 = await dungKhoa(300_000);
    const d = await donDaThu([{ studentId: P("sa6"), khoa: k1 }, { studentId: P("sa7"), khoa: k2 }]);
    const [i1, i2] = d.dong.map((x) => x.orderItemId) as [string, string];
    expect(await soQuyenConHieuLuc(P("sa6"), k1.courseId)).toBe(1);
    const y1 = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: i1, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    if (!y1.ok) throw new Error("tạo");
    // chưa duyệt ⇒ không chi được
    expect(await chi(y1.yeuCau.id)).toMatchObject({ ok: false, ma: "SAI_TRANG_THAI" });
    expect(await duyet(y1.yeuCau.id, 500_000, P("nv2"))).toMatchObject({ ok: true });
    const c = await chi(y1.yeuCau.id);
    expect(c).toMatchObject({ ok: true, soTien: 500_000, quyen: { daThuHoi: true, canXuLyTay: false } });
    // dòng âm liên kết khoản gốc
    const am = await db.payment.findMany({ where: { orderId: d.orderId, amount: { lt: 0 } }, select: { amount: true, accountantStatus: true, adjustmentOfId: true, refundRequestId: true } });
    expect(am).toHaveLength(1);
    expect(am[0]).toMatchObject({ amount: -500_000, accountantStatus: "REFUNDED", refundRequestId: y1.yeuCau.id });
    expect(am[0]!.adjustmentOfId).toBeTruthy();
    // idempotent: chi lại ⇒ không thêm dòng âm
    expect(await chi(y1.yeuCau.id)).toMatchObject({ ok: true });
    expect(await db.payment.count({ where: { orderId: d.orderId, amount: { lt: 0 } } })).toBe(1);
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id: y1.yeuCau.id }, select: { status: true, maGiaoDichHoan: true, quyenDaThuHoiLuc: true } }))).toMatchObject({ status: "PAID", maGiaoDichHoan: "FT-HOAN-0001" });
    // quyền học bị thu hồi
    expect(await soQuyenConHieuLuc(P("sa6"), k1.courseId)).toBe(0);
    expect(await soQuyenConHieuLuc(P("sa7"), k2.courseId)).toBe(1); // dòng kia còn nguyên
    // NGƯỜI ĐỌC
    const ct = await chiTiet(tA, d.orderId);
    expect(ct).toMatchObject({ trangThaiThanhToan: "DA_THU_DU", daThu: 300_000, daHoan: 500_000, soDongDaHoan: 1, hoanTien: { trangThai: "MOT_PHAN", yeuCauMo: null } });
    expect(ct.lichSuThanhToan.every((x: { soTien: number }) => x.soTien > 0)).toBe(true);
    expect(ct.lichSuHoan).toHaveLength(1);
    expect(ct.lichSuHoan[0]).toMatchObject({ soTien: 500_000 });
    const l1 = ct.dong.find((x: { orderItemId: string }) => x.orderItemId === i1);
    expect(l1).toMatchObject({ hoanTien: "DA_HOAN", soTienDaHoan: 500_000, hoanHet: true, quyenDaThuHoi: true, canXuLyQuyen: false });
    expect(ct.dong.find((x: { orderItemId: string }) => x.orderItemId === i2)).toMatchObject({ hoanTien: "KHONG", soTienDaHoan: 0, hoanHet: false, quyenDaThuHoi: false });
    // KHÔNG còn hướng dẫn thanh toán dù tiền đang giữ (300k) < tổng đơn (800k)
    expect(await dungHuongDanThanhToan(db as never, d.orderId)).toMatchObject({ trangThai: "KHONG_CAN" });
    // purchasable của (con × khoá) đã hoàn: mua lại được
    const mua = (await json(await muaDuocGet(req("GET", "/x", undefined, bearer(tA)), { params: Promise.resolve({ studentId: P("sa6") }) as never }))).data.muc as Array<{ courseId: string; trangThai: string }>;
    expect(mua.find((m) => m.courseId === k1.courseId)?.trangThai).toBe("MUA_LAI_DUOC"); // quyền đã thu hồi ⇒ mua lại được
    // hoàn nốt dòng 2 ⇒ đơn REFUNDED + DA_HOAN
    const y2 = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: i2, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    if (!y2.ok) throw new Error("tạo 2");
    expect(await duyet(y2.yeuCau.id, 300_000, P("nv2"))).toMatchObject({ ok: true });
    expect(await chi(y2.yeuCau.id)).toMatchObject({ ok: true, quyen: { daThuHoi: true } });
    expect((await db.order.findUniqueOrThrow({ where: { id: d.orderId }, select: { status: true } })).status).toBe("REFUNDED");
    const ct2 = await chiTiet(tA, d.orderId);
    expect(ct2).toMatchObject({ trangThaiThanhToan: "DA_THU_DU", daThu: 0, daHoan: 800_000, soDongDaHoan: 2, hoanTien: { trangThai: "DA_HOAN" }, trangThaiDon: "REFUNDED" });
    expect(await dungHuongDanThanhToan(db as never, d.orderId)).toMatchObject({ trangThai: "KHONG_CAN" });
  });

  it("[HTO-03b] một phần / GIA_HAN ⇒ KHÔNG tự thu hồi quyền, canXuLyQuyen; trần kiểm lại lúc chi", async () => {
    // một phần số tiền của dòng MUA
    const k1 = await dungKhoa(500_000);
    const d = await donDaThu([{ studentId: P("sa8"), khoa: k1 }]);
    const i = d.dong[0]!.orderItemId;
    const y = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: i, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    if (!y.ok) throw new Error("tạo");
    expect(await duyet(y.yeuCau.id, 200_000, P("nv2"))).toMatchObject({ ok: true });
    // giả mạo: nâng số đã duyệt vượt trần ngay trong DB ⇒ lúc CHI phải chặn (trần hai phía kiểm lại), không ghi dòng âm nào
    await db.refundRequest.update({ where: { id: y.yeuCau.id }, data: { approvedAmount: 999_999 } });
    expect(await chi(y.yeuCau.id)).toMatchObject({ ok: false, ma: "KHONG_DU_TIEN" });
    expect(await db.payment.count({ where: { orderId: d.orderId, amount: { lt: 0 } } })).toBe(0);
    await db.refundRequest.update({ where: { id: y.yeuCau.id }, data: { approvedAmount: 200_000 } });
    expect(await chi(y.yeuCau.id)).toMatchObject({ ok: true, quyen: { daThuHoi: false, canXuLyTay: true } });
    expect(await soQuyenConHieuLuc(P("sa8"), k1.courseId)).toBe(1); // quyền còn
    const ct = await chiTiet(tA, d.orderId);
    expect(ct).toMatchObject({ daThu: 300_000, daHoan: 200_000, soDongDaHoan: 1, hoanTien: { trangThai: "MOT_PHAN" }, trangThaiThanhToan: "DA_THU_DU" });
    expect(ct.dong[0]).toMatchObject({ hoanTien: "DA_HOAN", hoanHet: false, soTienDaHoan: 200_000, quyenDaThuHoi: false, canXuLyQuyen: true });
    // GIA_HAN: hoàn dòng gia hạn ⇒ không thu hồi (cộng vào CÙNG dòng quyền của lần mua trước)
    const k2 = await dungKhoa(500_000);
    const cap = await capQuyenHoc(db, { studentId: P("sa1"), courseId: k2.courseId, loai: "MUA", now: new Date(), idempotencyKey: `${NS}cap-gh-${Date.now()}`, reason: "fixture" });
    expect(cap.ok).toBe(true);
    const dg = await donDaThu([{ studentId: P("sa1"), khoa: { courseId: k2.courseId, gia: 200_000 } }]);
    expect(await soQuyenConHieuLuc(P("sa1"), k2.courseId)).toBe(1);
    const yg = await taoYeuCauHoanOnline(db as never, { orderId: dg.orderId, orderItemId: dg.dong[0]!.orderItemId, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    if (!yg.ok) throw new Error("tạo gh");
    const thuc = (await db.orderItem.findUniqueOrThrow({ where: { id: dg.dong[0]!.orderItemId }, select: { unitPrice: true, discountAmount: true, metadata: true } }));
    expect((thuc.metadata as { loaiMua?: string }).loaiMua).toBe("GIA_HAN");
    expect(await duyet(yg.yeuCau.id, thuc.unitPrice - thuc.discountAmount, P("nv2"))).toMatchObject({ ok: true });
    expect(await chi(yg.yeuCau.id)).toMatchObject({ ok: true, quyen: { daThuHoi: false, canXuLyTay: true } });
    expect(await soQuyenConHieuLuc(P("sa1"), k2.courseId)).toBe(1);
  });

  it("[HTO-03c] trần theo DÒNG kiểm lại lúc CHI (khác trần theo đơn): số duyệt bị nâng vượt giá dòng nhưng chưa vượt tổng tiền đơn ⇒ chặn", async () => {
    const k1 = await dungKhoa(500_000);
    const k2 = await dungKhoa(300_000);
    const d = await donDaThu([{ studentId: P("sa6"), khoa: k1 }, { studentId: P("sa7"), khoa: k2 }]);
    const i2 = d.dong[1]!.orderItemId;
    const y = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: i2, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    if (!y.ok) throw new Error("tạo");
    expect(await duyet(y.yeuCau.id, 300_000, P("nv2"))).toMatchObject({ ok: true });
    // giả mạo trong DB: 400k > giá dòng (300k) nhưng ≤ tiền đã thu của đơn (800k) ⇒ chỉ trần THEO DÒNG ở bước chi mới chặn được
    await db.refundRequest.update({ where: { id: y.yeuCau.id }, data: { approvedAmount: 400_000 } });
    expect(await chi(y.yeuCau.id)).toMatchObject({ ok: false, ma: "KHONG_DU_TIEN" });
    expect(await db.payment.count({ where: { orderId: d.orderId, amount: { lt: 0 } } })).toBe(0);
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id: y.yeuCau.id }, select: { status: true } })).status).toBe("APPROVED"); // không đổi trạng thái khi bị chặn
    await db.refundRequest.update({ where: { id: y.yeuCau.id }, data: { approvedAmount: 300_000 } });
    expect(await chi(y.yeuCau.id)).toMatchObject({ ok: true, soTien: 300_000 });
  });

  it("[HTO-05] chuyển khoản TRỄ cùng nội dung SR sau hoàn ⇒ không cấp lại quyền, không mở lại phiếu thu", async () => {
    const k = await dungKhoa(400_000);
    const d = await donDaThu([{ studentId: P("sa2"), khoa: k }]);
    const i = d.dong[0]!.orderItemId;
    const y = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: i, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    if (!y.ok) throw new Error("tạo");
    expect(await duyet(y.yeuCau.id, 400_000, P("nv2"))).toMatchObject({ ok: true });
    expect(await chi(y.yeuCau.id)).toMatchObject({ ok: true, quyen: { daThuHoi: true } });
    expect(await soQuyenConHieuLuc(P("sa2"), k.courseId)).toBe(0);
    const phieuTruoc = await db.paymentRequest.findMany({ where: { orderId: d.orderId }, select: { status: true, matchKey: true } });
    // khách (hoặc ngân hàng gửi lại) chuyển 400k lần nữa với cùng nội dung
    const tre = await traTien(d.orderId, 400_000, `HTO-tre-${Date.now()}`);
    // KHÔNG được thành quyền học: dù giao dịch được ghi nhận/giữ đối soát, quyền vẫn bị thu hồi
    expect(await soQuyenConHieuLuc(P("sa2"), k.courseId)).toBe(0);
    const ct = await chiTiet(tA, d.orderId);
    expect(ct.trangThaiThanhToan).not.toBe("CHO_THANH_TOAN");
    expect(await dungHuongDanThanhToan(db as never, d.orderId)).toMatchObject({ trangThai: "KHONG_CAN" });
    // phiếu thu không bị mở lại thành đang chờ
    const phieuSau = await db.paymentRequest.findMany({ where: { orderId: d.orderId }, select: { status: true } });
    expect(phieuTruoc.map((p) => p.status)).toEqual(["PAID"]);
    expect(phieuSau.map((p) => p.status)).toEqual(["PAID"]); // KHÔNG mở lại
    // giao dịch trễ nằm ở HÀNG CHỜ ĐỐI SOÁT (UNMATCHED) — không tạo khoản thu dương mới, không cấp quyền
    expect(tre.status).toBe("UNMATCHED");
    expect(await db.payment.count({ where: { orderId: d.orderId, amount: { gt: 0 } } })).toBe(1);
    expect(ct.daThu).toBe(0); // đã hoàn hết
  });

  it("[HTO-06] rút yêu cầu: PENDING ⇒ rút được (lặp ⇒ ok); đã duyệt ⇒ 409 HOAN_TIEN_KHONG_RUT_DUOC; người khác ⇒ 404", async () => {
    await batKenh(true);
    const k = await dungKhoa(300_000);
    const d = await donDaThu([{ studentId: P("sa3"), khoa: k }]);
    const dong = d.dong[0]!.orderItemId;
    const y = (await json(await gui(tA, d.orderId, { orderItemId: dong, lyDo: LY_DO }))).data.yeuCau as { id: string };
    expect((await rut(tB, d.orderId, y.id)).status).toBe(404);
    const r1 = await rut(tA, d.orderId, y.id);
    expect(r1.status).toBe(200);
    expect((await json(r1)).data).toEqual({ daRut: true });
    expect((await json(await rut(tA, d.orderId, y.id))).data).toEqual({ daRut: true }); // rút lặp
    const ds = (await json(await xem(tA, d.orderId))).data.muc as Array<{ id: string; trangThai: string }>;
    expect(ds.find((x) => x.id === y.id)?.trangThai).toBe("RUT");
    expect((await chiTiet(tA, d.orderId)).hoanTien.trangThai).toBe("KHONG"); // rút không hiện như bị từ chối
    // gửi lại được sau khi rút; duyệt xong thì không rút được
    const y2 = (await json(await gui(tA, d.orderId, { orderItemId: dong, lyDo: "Gửi lại sau khi đã rút" }))).data.yeuCau as { id: string };
    expect(y2.id).not.toBe(y.id);
    expect(await duyet(y2.id, 100_000, P("nv"))).toMatchObject({ ok: true });
    expect(await ma(await rut(tA, d.orderId, y2.id))).toEqual([409, "HOAN_TIEN_KHONG_RUT_DUOC"]);
    await batKenh(false);
  });

  it("[HTO-07] từ chối: phụ huynh thấy lyDoTuChoi + trạng thái, KHÔNG thấy người duyệt/ghi chú/mã giao dịch hoàn", async () => {
    await batKenh(true);
    const k = await dungKhoa(300_000);
    const d = await donDaThu([{ studentId: P("sa4"), khoa: k }]);
    const dong = d.dong[0]!.orderItemId;
    const y = (await json(await gui(tA, d.orderId, { orderItemId: dong, lyDo: LY_DO }))).data.yeuCau as { id: string };
    expect(await tuChoiHoanOnline(db as never, { id: y.id, approverId: P("nv"), approverName: "NV", lyDoTuChoi: "ngắn", now: new Date() })).toMatchObject({ ok: false, ma: "VALIDATION" });
    expect(await tuChoiHoanOnline(db as never, { id: y.id, approverId: P("nv"), approverName: "NV", lyDoTuChoi: "Khoá đã học quá nửa nội dung nên không hoàn", now: new Date() })).toMatchObject({ ok: true });
    expect(await duyet(y.id, 100_000, P("nv2"))).toMatchObject({ ok: false, ma: "SAI_TRANG_THAI" }); // đã từ chối ⇒ không duyệt
    const muc = (await json(await xem(tA, d.orderId))).data.muc as Array<Record<string, unknown>>;
    expect(muc[0]).toMatchObject({ trangThai: "REJECTED", lyDoTuChoi: "Khoá đã học quá nửa nội dung nên không hoàn", lyDo: LY_DO });
    expect(Object.keys(muc[0]!).sort()).toEqual(["capNhatLuc", "daHoanLuc", "id", "lyDo", "lyDoTuChoi", "orderItemId", "soTienDuocDuyet", "taoLuc", "trangThai"]);
    expect((await chiTiet(tA, d.orderId)).hoanTien.trangThai).toBe("TU_CHOI");
    // lộ trường: bản chi tiết đơn cũng không mang người duyệt/mã giao dịch hoàn
    expect(JSON.stringify(await chiTiet(tA, d.orderId))).not.toMatch(/approvedById|maGiaoDichHoan|FT-HOAN|ghiChuNoiBo/);
    await batKenh(false);
  });

  it("[HTO-09] thông báo phụ huynh khi đã duyệt / từ chối / đã hoàn: idempotent, không lộ số tiền", async () => {
    const k = await dungKhoa(350_000);
    const d = await donDaThu([{ studentId: P("sa1"), khoa: k }]);
    const y = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: d.dong[0]!.orderItemId, lyDo: LY_DO, nguon: { kenh: "PARENT", parentUserId: P("A") }, choPhepPhuHuynh: true, now: new Date() });
    if (!y.ok) throw new Error("tạo");
    const dem = (tt: string) => db.notification.count({ where: { dedupeKey: `online_refund:${y.yeuCau.id}:${tt}` } });
    expect(await dem("DA_DUYET")).toBe(0);
    expect(await duyet(y.yeuCau.id, 350_000, P("nv2"))).toMatchObject({ ok: true });
    expect(await dem("DA_DUYET")).toBe(1);
    expect(await chi(y.yeuCau.id)).toMatchObject({ ok: true });
    expect(await chi(y.yeuCau.id)).toMatchObject({ ok: true });
    expect(await dem("DA_HOAN")).toBe(1);
    const tb = await db.notification.findFirstOrThrow({ where: { dedupeKey: `online_refund:${y.yeuCau.id}:DA_HOAN` }, select: { title: true, body: true, audience: true, studentId: true, centerId: true } });
    expect(tb).toMatchObject({ audience: "STUDENT", studentId: P("sa1"), centerId: null });
    expect(JSON.stringify(tb)).not.toMatch(/350/);
    const k2 = await dungKhoa(250_000);
    const d2 = await donDaThu([{ studentId: P("sa2"), khoa: k2 }]);
    const y2 = await taoYeuCauHoanOnline(db as never, { orderId: d2.orderId, orderItemId: d2.dong[0]!.orderItemId, lyDo: LY_DO, nguon: { kenh: "PARENT", parentUserId: P("A") }, choPhepPhuHuynh: true, now: new Date() });
    if (!y2.ok) throw new Error("tạo 2");
    expect(await tuChoiHoanOnline(db as never, { id: y2.yeuCau.id, approverId: P("nv"), approverName: "NV", lyDoTuChoi: "Không đủ điều kiện hoàn theo chính sách", now: new Date() })).toMatchObject({ ok: true });
    expect(await db.notification.count({ where: { dedupeKey: `online_refund:${y2.yeuCau.id}:TU_CHOI` } })).toBe(1);
    expect(await db.notification.count({ where: { dedupeKey: `online_refund:${y2.yeuCau.id}:DA_DUYET` } })).toBe(0);
  });

  it("[HTO-10] Admin API hoàn Online: chỉ Quản trị tối cao/cấp Hội sở; duyệt → chi qua route; kế toán cơ sở bị chặn", async () => {
    const dangNhap = (k: string, role: string) => vi.mocked(auth).mockResolvedValue({ user: { id: P(k), name: `ND ${k}`, email: `${k}@x.invalid`, role, roles: [role] } } as never);
    const k = await dungKhoa(400_000);
    const d = await donDaThu([{ studentId: P("sa1"), khoa: k }]);
    const y = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: d.dong[0]!.orderItemId, lyDo: LY_DO, nguon: { kenh: "PARENT", parentUserId: P("A") }, choPhepPhuHuynh: true, now: new Date() });
    if (!y.ok) throw new Error("tạo");
    const ctx = { params: Promise.resolve({ id: y.yeuCau.id }) as never };
    const post = (url: string, body: unknown) => req("POST", url, body);
    // chưa đăng nhập ⇒ 401
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await adminDs(req("GET", "/api/admin/online-refunds"))).status).toBe(401);
    // phụ huynh ⇒ 403 ; kế toán KHÔNG ở cấp Hội sở ⇒ 403 (dù có payments:confirm) — đối chứng ÂM
    dangNhap("A", "PARENT");
    expect((await adminDs(req("GET", "/api/admin/online-refunds"))).status).toBe(403);
    dangNhap("nv", "ACCOUNTANT");
    expect((await adminDs(req("GET", "/api/admin/online-refunds"))).status).toBe(403);
    expect((await adminDuyet(post("/x", { soTienDuyet: 400_000 }), ctx)).status).toBe(403);
    expect(await db.refundRequest.findUniqueOrThrow({ where: { id: y.yeuCau.id }, select: { status: true } })).toMatchObject({ status: "PENDING" });
    // Quản trị tối cao ⇒ thấy hàng đợi (đối chứng DƯƠNG)
    dangNhap("qt", "SUPER_ADMIN");
    const dsRes = await adminDs(req("GET", "/api/admin/online-refunds?trangThai=PENDING"));
    const ds = await json(dsRes.clone());
    if (!ds.data) throw new Error(`DS ${dsRes.status} ${JSON.stringify(ds)}`);
    expect((ds.data as Array<{ id: string }>).some((r) => r.id === y.yeuCau.id)).toBe(true);
    expect((await adminDs(req("GET", "/api/admin/online-refunds?trangThai=LA"))).status).toBe(400);
    const ct = await json(await adminCt(req("GET", "/x"), ctx));
    expect(ct.data).toMatchObject({ id: y.yeuCau.id, trangThai: "PENDING", don: { id: d.orderId }, dong: { thucTra: 400_000 } });
    // thân lạ / thiếu ⇒ 400
    expect((await adminDuyet(post("/x", { soTienDuyet: 400_000, bangChung: "x" }), ctx)).status).toBe(400);
    expect((await adminDuyet(post("/x", {}), ctx)).status).toBe(400);
    // vượt trần ⇒ 422 ; duyệt đúng ⇒ 200 ; duyệt lần hai ⇒ 409
    expect((await adminDuyet(post("/x", { soTienDuyet: 400_001 }), ctx)).status).toBe(422);
    expect((await adminDuyet(post("/x", { soTienDuyet: 400_000 }), ctx)).status).toBe(200);
    expect((await adminDuyet(post("/x", { soTienDuyet: 400_000 }), ctx)).status).toBe(409);
    // chi qua route: ghi đúng MỘT dòng âm, lặp lại không ghi thêm
    expect((await adminChi(post("/x", { method: "BANK_TRANSFER", maGiaoDichHoan: "FT-HTO10" }), ctx)).status).toBe(200);
    expect((await adminChi(post("/x", { method: "BANK_TRANSFER", maGiaoDichHoan: "FT-HTO10" }), ctx)).status).toBe(200);
    expect(await db.payment.count({ where: { orderId: d.orderId, amount: { lt: 0 } } })).toBe(1);
    const ct2 = await json(await adminCt(req("GET", "/x"), ctx));
    expect(ct2.data).toMatchObject({ trangThai: "PAID", soTienDuyet: 400_000, maGiaoDichHoan: "FT-HTO10" });
    // từ chối: yêu cầu khác; lý do ngắn ⇒ 400
    const k2 = await dungKhoa(200_000);
    const d2 = await donDaThu([{ studentId: P("sa2"), khoa: k2 }]);
    const y2 = await taoYeuCauHoanOnline(db as never, { orderId: d2.orderId, orderItemId: d2.dong[0]!.orderItemId, lyDo: LY_DO, nguon: { kenh: "PARENT", parentUserId: P("A") }, choPhepPhuHuynh: true, now: new Date() });
    if (!y2.ok) throw new Error("tạo 2");
    const ctx2 = { params: Promise.resolve({ id: y2.yeuCau.id }) as never };
    expect((await adminTuChoi(post("/x", { lyDo: "ngắn" }), ctx2)).status).toBe(400);
    expect((await adminTuChoi(post("/x", { lyDo: "Không đủ điều kiện hoàn theo chính sách" }), ctx2)).status).toBe(200);
    expect((await adminCt(req("GET", "/x"), ctx2).then(json)).data).toMatchObject({ trangThai: "REJECTED", lyDoTuChoi: "Không đủ điều kiện hoàn theo chính sách" });
    vi.mocked(auth).mockResolvedValue(null as never);
  });

  it("[HTO-08] song song: hai lượt duyệt cùng yêu cầu ⇒ đúng một thắng; hai lượt chi ⇒ đúng một bộ dòng âm", async () => {
    const k = await dungKhoa(450_000);
    const d = await donDaThu([{ studentId: P("sa5"), khoa: k }]);
    const i = d.dong[0]!.orderItemId;
    const y = await taoYeuCauHoanOnline(db as never, { orderId: d.orderId, orderItemId: i, lyDo: LY_DO, nguon: { kenh: "STAFF", staffId: P("nv"), staffName: "NV" }, choPhepPhuHuynh: false, now: new Date() });
    if (!y.ok) throw new Error("tạo");
    const dd = await Promise.all([duyet(y.yeuCau.id, 450_000, P("nv2")), duyet(y.yeuCau.id, 450_000, P("nv2"))]);
    expect(dd.filter((x) => x.ok).length).toBe(1);
    const cc = await Promise.all([chi(y.yeuCau.id), chi(y.yeuCau.id)]);
    expect(cc.every((x) => x.ok)).toBe(true);
    expect(await db.payment.count({ where: { orderId: d.orderId, amount: { lt: 0 } } })).toBe(1);
    expect(await db.payment.aggregate({ where: { orderId: d.orderId, amount: { lt: 0 } }, _sum: { amount: true } }).then((x) => x._sum.amount)).toBe(-450_000);
  });

  const CGT_N = 6;
  const tomCgt = async (nhan: string, ds: Promise<Response>[]) => {
    const kq = await Promise.all((await Promise.all(ds)).map(async (r) => { const j = await json(r); return { s: r.status, ma: j.error?.code, data: j.data as any }; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.info(`${nhan} phản hồi: ${kq.map((x) => `${x.s}${x.ma ? `:${x.ma}` : ""}${x.data?.daCo === true || x.data?.daHuyTruocDo === true || x.data?.trungLap === true ? ":lặp" : ""}`).sort().join(" ")}`);
    return kq;
  };

  it("[CGT-05] gửi yêu cầu hoàn × 6 song song ⇒ MỘT yêu cầu; [CGT-06] rút × 6 song song ⇒ rút MỘT lần", async () => {
    await batKenh(true);
    const k = await dungKhoa(300_000);
    const d = await donDaThu([{ studentId: P("sa7"), khoa: k }]);
    const dong = d.dong[0]!.orderItemId;
    await amPool();
    const kq = await tomCgt("[CGT-05]", Array.from({ length: CGT_N }, () => gui(tA, d.orderId, { orderItemId: dong, lyDo: LY_DO })));
    expect(kq.map((x) => x.s)).toEqual(Array(CGT_N).fill(200));
    expect(kq.filter((x) => x.data.daCo === false)).toHaveLength(1);
    expect(new Set(kq.map((x) => x.data.yeuCau.id)).size).toBe(1);
    const ds = await db.refundRequest.findMany({ where: { orderItemId: dong, kenh: "ONLINE" }, select: { id: true } });
    expect(ds).toHaveLength(1);
    const id = ds[0]!.id;
    expect(await db.auditLog.count({ where: { entityType: "RefundRequest", entityId: id, action: "CREATE" } })).toBe(1);
    await amPool();
    const kqRut = await tomCgt("[CGT-06]", Array.from({ length: CGT_N }, () => rut(tA, d.orderId, id)));
    expect(kqRut.map((x) => [x.s, x.data])).toEqual(Array(CGT_N).fill([200, { daRut: true }]));
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe("REJECTED");
    expect(await db.auditLog.count({ where: { entityType: "RefundRequest", entityId: id, action: "STATUS_CHANGE" } })).toBe(1);
    expect(await db.payment.count({ where: { orderId: d.orderId, amount: { lt: 0 } } })).toBe(0); // không có đồng nào đi ra
  }, 90_000);
});
