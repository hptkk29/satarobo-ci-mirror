import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { DELETE as cauHinhDelete, GET as cauHinhGet, PUT as cauHinhPut } from "@/app/api/admin/online-payment-config/route";
import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as huyPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/cancel/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/route";
import { POST as taoDonPost } from "@/app/api/mobile/v1/parent/online-orders/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { chuanHoaMemo, noiDungChuyenKhoan } from "@/lib/online-checkout/cau-hinh-thanh-toan";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [ONL-P2Q] V8.18 — THU TIỀN ONLINE = SATAROBO (Owner chốt): cấu hình do QUẢN TRỊ TỐI CAO quản lý, mỗi đơn CHỤP thông tin nhận tiền + pháp nhân lúc tạo đơn, nội dung CK `SR{ma}`.
 * Tài khoản dùng ở đây là GIẢ ghi rõ «TEST» (ngân hàng 000000, STK 0000000000) — KHÔNG phải thông tin thụ hưởng thật. Không gọi ngân hàng/nhà cung cấp.
 *   [ONL-P2Q-00] nội dung CK: `SR` + mã, không dấu, ≤ 25 ký tự; vượt ⇒ null (không cắt ngầm)
 *   [ONL-P2Q-01] chưa cấu hình ⇒ đơn VẪN tạo được nhưng KHÔNG có bản chụp; hướng dẫn = CHUA_CAU_HINH (BLOCKED_CONFIG) + trường thiếu; không lộ tài khoản
 *   [ONL-P2Q-02] API quản trị: chỉ Quản trị tối cao (401/403 cho người khác); thiếu lý do 400; phương thức của CƠ SỞ/đang tắt 422; pháp nhân KHÔNG phải gốc SataRobo 422; PROD khi chưa có khoá mở 409; audit + che STK
 *   [ONL-P2Q-03] đơn mới CHỤP pháp nhân gốc + tài khoản; TEST ⇒ nhãn TEST, không cho chuyển tiền, KHÔNG ảnh QR; `SR{mã}` đúng; tiền theo nội dung đó khớp ĐÚNG đơn
 *   [ONL-P2Q-04] đổi cấu hình SAU khi tạo ⇒ đơn đang chờ GIỮ thông tin đã phát hành; đơn MỚI dùng cấu hình mới; ngừng cấu hình không làm mất hướng dẫn của đơn cũ
 *   [ONL-P2Q-05] đơn tạo TRƯỚC cấu hình không được điền ngược; PROD cần khoá mở (đọc lại lúc xem — fail-closed) rồi mới có ảnh QR + cho chuyển
 *   [ONL-P2Q-06] đã thu đủ/đã huỷ ⇒ KONG_CAN; chi tiết đơn luôn hiện «đơn vị bán» từ bản chụp
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "onlp2q-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.101.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
let n = 0;

async function dungKhoa(gia = 500_000) {
  const t = await taoKhoa(db, { code: `ONLP2Q-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: false }, null);
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
  const orders = await db.order.findMany({ where: { createdById: { in: uids } }, select: { id: true } });
  const oid = orders.map((o) => o.id);
  if (oid.length) {
    await db.voucherRedemption.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderOnlineGrant.deleteMany({ where: { orderId: { in: oid } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: oid } } } });
    await db.payment.deleteMany({ where: { orderId: { in: oid } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
    await db.order.deleteMany({ where: { id: { in: oid } } });
  }
  await db.onlinePaymentConfig.deleteMany({});
  await db.paymentMethod.deleteMany({ where: { code: { startsWith: NS } } });
  await db.legalEntity.deleteMany({ where: { taxCode: { startsWith: "ONLP2Q" } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe("[ONL-P2Q-00] nội dung chuyển khoản SR{ma}", () => {
  it("không dấu · ≤ 25 · vượt thì null (không cắt)", () => {
    expect(noiDungChuyenKhoan("SR", "ONL26000001D0")).toBe("SRONL26000001D0");
    expect(noiDungChuyenKhoan("sr", "onl-26 000001-d0")).toBe("SRONL26000001D0");
    expect(chuanHoaMemo("Đơn Hàng-ÂÊ 12")).toBe("DONHANGAE12");
    expect(noiDungChuyenKhoan("SR", "A".repeat(23))).toBe(`SR${"A".repeat(23)}`); // đúng 25
    expect(noiDungChuyenKhoan("SR", "A".repeat(24))).toBeNull(); // 26 > 25 ⇒ null
    expect(noiDungChuyenKhoan("SR", "---")).toBeNull();
  });
});

describe.skipIf(!RUN)("[ONL-P2Q] thu tiền Online = SataRobo (cấu hình · chụp lúc tạo đơn)", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let pmId = "";
  let pmId2 = "";
  let goc = "";
  const P = (k: string) => ids[k]!;
  afterEach(() => {
    delete process.env.ONLINE_PAYMENT_PROD_UNLOCK;
    vi.mocked(auth).mockReset();
    vi.mocked(auth).mockResolvedValue(null as never);
  });
  const dangNhapAdmin = (role: string, roles: string[] = [role]) => vi.mocked(auth).mockResolvedValue({ user: { id: P("admin"), name: "Quản trị", email: "qt@x.invalid", role, roles } } as never);
  const put = (body: unknown) => cauHinhPut(req("PUT", "/api/admin/online-payment-config", body));
  const taoDon = async (con: string) => {
    const k = await dungKhoa(500_000);
    const r = await taoDonPost(req("POST", "/x", { dong: [{ studentId: con, khoaId: k.courseId }] }, bearer(tA)));
    expect(r.status).toBe(200);
    return { k, d: (await json(r)).data };
  };
  const chiTiet = async (oid: string) => (await json(await chiTietGet(req("GET", "/x", undefined, bearer(tA)), { params: Promise.resolve({ orderId: oid }) as never }))).data;
  const taoPm = (o: Partial<{ isActive: boolean; type: "BANK_TRANSFER" | "CASH"; centerId: string | null; bankAccountNumber: string | null; bankAccountName: string }> = {}) =>
    db.paymentMethod.create({
      data: { code: `${NS}PM-${++n}`, name: `${NS}TEST không dùng chuyển tiền`, type: o.type ?? "BANK_TRANSFER", isActive: o.isActive ?? true, centerId: o.centerId === undefined ? null : o.centerId, bankBin: "000000", bankName: "NGAN HANG TEST", bankAccountNumber: o.bankAccountNumber === undefined ? "0000000000" : o.bankAccountNumber, bankAccountName: o.bankAccountName ?? "TEST ONLINE KHONG CHUYEN TIEN" } as never,
      select: { id: true },
    });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    ids.A = (await db.user.create({ data: { email: `${NS}A@seed.invalid`, name: "PH A", phone: "84966910001", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    ids.admin = (await db.user.create({ data: { email: `${NS}admin@seed.invalid`, name: "Quản trị tối cao", password: hash, role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] } as never, select: { id: true } })).id;
    for (const k of ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids.A } as never, select: { id: true } })).id;
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966910001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9a00-000000000001", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    tA = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(tA)));
    pmId = (await taoPm()).id;
    pmId2 = (await taoPm({ bankAccountNumber: "0000000001", bankAccountName: "TEST ONLINE 2 KHONG CHUYEN TIEN" })).id;
    goc = (await db.legalEntity.findFirstOrThrow({ where: { isPrimary: true, isActive: true, deletedAt: null }, select: { id: true } })).id;
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[ONL-P2Q-01] chưa cấu hình ⇒ đơn tạo được nhưng KHÔNG bản chụp; CHUA_CAU_HINH + trường thiếu; không lộ tài khoản", async () => {
    await db.onlinePaymentConfig.deleteMany({});
    const { d } = await taoDon(P("sa1"));
    expect(d).toMatchObject({ huongDanThanhToan: null, huongDanTrangThai: "CHUA_CAU_HINH" });
    expect(d.thongTinCanOwnerCungCap.length).toBe(3);
    const o = await db.order.findUniqueOrThrow({ where: { id: d.orderId }, select: { legalEntityId: true, onlinePaymentSnapshot: true } });
    expect([o.legalEntityId, o.onlinePaymentSnapshot]).toEqual([null, null]);
    expect(JSON.stringify(d)).not.toMatch(/soTaiKhoan|0000000000|anhQrUrl/);
    expect((await chiTiet(d.orderId)).donViBan).toBeNull();
  });

  it("[ONL-P2Q-02] API quản trị: chỉ Quản trị tối cao; kiểm phương thức/pháp nhân/PROD; audit + che STK", async () => {
    const body = { paymentMethodId: pmId, mode: "TEST", reason: "Cấu hình TEST thử nghiệm Online" };
    expect((await put(body)).status).toBe(401); // chưa đăng nhập
    for (const role of ["ACCOUNTANT", "CENTER_MANAGER", "PARENT"]) {
      dangNhapAdmin(role);
      expect((await put(body)).status, role).toBe(403);
      expect((await cauHinhGet()).status, `GET ${role}`).toBe(403);
      expect((await cauHinhDelete(req("DELETE", "/x", { reason: "ngừng cấu hình thử" }))).status, `DELETE ${role}`).toBe(403);
    }
    dangNhapAdmin("SUPER_ADMIN");
    expect((await put({ ...body, reason: "ngắn" })).status).toBe(400); // lý do < 10 ký tự
    expect((await put({ ...body, khoaLa: 1 })).status).toBe(400); // strict
    const csPm = await taoPm({ centerId: (await db.center.findFirstOrThrow({ select: { id: true } })).id });
    let r = await put({ ...body, paymentMethodId: csPm.id });
    expect([r.status, (await json(r)).error?.code]).toEqual([422, "PHUONG_THUC_KHONG_HOP_LE"]); // tài khoản của CƠ SỞ
    r = await put({ ...body, paymentMethodId: (await taoPm({ isActive: false })).id });
    expect(r.status).toBe(422);
    r = await put({ ...body, paymentMethodId: (await taoPm({ type: "CASH" })).id });
    expect(r.status).toBe(422);
    r = await put({ ...body, paymentMethodId: (await taoPm({ bankAccountNumber: null })).id });
    expect(r.status).toBe(422);
    r = await put({ ...body, paymentMethodId: "khong-co" });
    expect(r.status).toBe(422);
    const khac = await db.legalEntity.create({ data: { taxCode: `ONLP2Q${Date.now() % 100000}`, legalName: "Pháp nhân KHÁC (không phải SataRobo)", isPrimary: false } });
    r = await put({ ...body, legalEntityId: khac.id });
    expect([r.status, (await json(r)).error?.code]).toEqual([422, "PHAP_NHAN_KHONG_HOP_LE"]);
    r = await put({ ...body, mode: "PROD" });
    expect([r.status, (await json(r)).error?.code]).toEqual([409, "PROD_CHUA_MO"]); // chưa có khoá mở PROD
    r = await put({ ...body, memoPrefix: "sr-x!!!!!!!!!" });
    expect(r.status).toBe(400);
    r = await put({ ...body, legalEntityId: goc }); // đúng pháp nhân gốc (tuỳ chọn)
    expect(r.status).toBe(200);
    const cfgId = (await json(r)).data.configId;
    const kt = await db.onlinePaymentConfig.findMany({ where: { isActive: true } });
    expect(kt.map((x) => x.id)).toEqual([cfgId]);
    expect(kt[0]).toMatchObject({ mode: "TEST", memoPrefix: "SR", legalEntityId: goc, createdById: P("admin") });
    // bật cái MỚI ⇒ cái cũ tắt; vẫn đúng MỘT dòng bật
    r = await put({ ...body, paymentMethodId: pmId2, reason: "Đổi sang tài khoản TEST thứ hai" });
    expect(r.status).toBe(200);
    expect(await db.onlinePaymentConfig.count({ where: { isActive: true } })).toBe(1);
    expect(await db.onlinePaymentConfig.count()).toBe(2);
    const g = await cauHinhGet();
    const gd = (await json(g)).data;
    expect(gd.dangBat).toMatchObject({ trangThai: "SAN_SANG", mode: "TEST", memoPrefix: "SR" });
    expect(gd.lichSu).toHaveLength(2);
    expect(gd.lichSu[0].soTaiKhoanCuoi).toBe("0001"); // che STK: chỉ 4 số cuối
    expect(JSON.stringify(gd)).not.toMatch(/0000000001|0000000000\b/);
    const au = await db.auditLog.findMany({ where: { entityType: "OnlinePaymentConfig" } });
    expect(au.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(au)).not.toMatch(/0000000001|0000000000\b/); // audit KHÔNG chứa STK
  });

  it("[ONL-P2Q-03] đơn mới CHỤP pháp nhân gốc + tài khoản; TEST ⇒ không chuyển tiền/không QR; SR{mã} khớp ĐÚNG đơn", async () => {
    await db.onlinePaymentConfig.deleteMany({});
    dangNhapAdmin("SUPER_ADMIN");
    expect((await put({ paymentMethodId: pmId, mode: "TEST", reason: "Cấu hình TEST cho ca chụp đơn" })).status).toBe(200);
    const a = await taoDon(P("sa2"));
    const b = await taoDon(P("sa3"));
    const o = await db.order.findUniqueOrThrow({ where: { id: a.d.orderId }, select: { legalEntityId: true, onlinePaymentSnapshot: true } });
    expect(o.legalEntityId).toBe(goc);
    expect(o.onlinePaymentSnapshot).toMatchObject({ phienBan: 1, mode: "TEST", memoPrefix: "SR", soTaiKhoan: "0000000000", phapNhan: { id: goc, maSoThue: "0402301783" } });
    const ka = await db.paymentRequest.findFirstOrThrow({ where: { orderId: a.d.orderId }, select: { matchKey: true } });
    const ca = await chiTiet(a.d.orderId);
    expect(ca.huongDanTrangThai).toBe("SAN_SANG");
    expect(ca.huongDanThanhToan).toMatchObject({ moiTruong: "THU_NGHIEM", choPhepChuyenTien: false, nhan: "TEST — KHÔNG CHUYỂN TIỀN THẬT", anhQrUrl: null, soTien: 500_000, noiDung: ka.matchKey, donViBan: { maSoThue: "0402301783" } });
    expect(ca.huongDanThanhToan.noiDung.length).toBeLessThanOrEqual(25);
    expect(ka.matchKey).toMatch(/^SR[A-Z0-9]+D0$/); // nội dung CK CHÍNH LÀ mã đối khớp của phiếu thu (SR + mã đơn + D0)
    expect(ka.matchKey).toBe(chuanHoaMemo(ka.matchKey!));
    expect(ca.donViBan).toMatchObject({ maSoThue: "0402301783" });
    const cb = await chiTiet(b.d.orderId);
    expect(cb.huongDanThanhToan.noiDung).not.toBe(ca.huongDanThanhToan.noiDung);
    // [V8.33] tiền về TÀI KHOẢN KHÁC (không phải tài khoản nhận Online đã chụp vào đơn) mà nội dung mang mã đơn A ⇒ KHÔNG tính là đã thu, KHÔNG cấp quyền, nằm ở hàng chờ đối soát tay (không mất tiền)
    const refSai = `ONP2Q-SAI-${Date.now()}`;
    const sai = await ingestPayosWebhook({ reference: refSai, description: ca.huongDanThanhToan.noiDung, amount: 500_000, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" }, "SEPAY");
    expect(sai.status).toBe("UNMATCHED");
    expect((sai as { reason?: string }).reason).toMatch(/KHÁC tài khoản nhận Online/);
    expect(await db.payment.count({ where: { orderId: a.d.orderId } })).toBe(0);
    expect(await db.paymentRequest.count({ where: { orderId: a.d.orderId, status: "PAID" } })).toBe(0);
    expect(await db.bankTransaction.count({ where: { providerTxnId: refSai, status: "UNMATCHED" } })).toBe(1); // đúng giao dịch của lượt này (không đếm cặn lượt chạy trước)
    // thiếu số tài khoản nhận ⇒ fail-closed
    const thieu = await ingestPayosWebhook({ reference: `ONP2Q-THIEU-${Date.now()}`, description: ca.huongDanThanhToan.noiDung, amount: 500_000, transactionDateTime: "2026-11-20 12:00:00" }, "SEPAY");
    expect(thieu.status).toBe("UNMATCHED");
    expect(await db.payment.count({ where: { orderId: a.d.orderId } })).toBe(0);
    // tiền theo nội dung `SR{mã}` của A, ĐÚNG tài khoản nhận (so chữ số, bỏ khoảng trắng) khớp A, không chạm B
    const r = await ingestPayosWebhook({ reference: `ONP2Q-A-${Date.now()}`, description: ca.huongDanThanhToan.noiDung, amount: 500_000, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "0000 0000 00" }, "SEPAY");
    expect(r.status).toBe("MATCHED");
    expect((await chiTiet(a.d.orderId)).huongDanTrangThai).toBe("KHONG_CAN");
    expect(await chiTiet(b.d.orderId)).toMatchObject({ daThu: 0, huongDanTrangThai: "SAN_SANG" });
    // phiếu thu đối khớp đúng đơn A
    expect(await db.paymentRequest.count({ where: { orderId: a.d.orderId, status: "PAID" } })).toBe(1);
  });

  it("[ONL-P2Q-04] đổi cấu hình SAU khi tạo ⇒ đơn cũ GIỮ thông tin đã phát hành; đơn mới dùng cấu hình mới; ngừng cấu hình không làm mất đơn cũ", async () => {
    await db.onlinePaymentConfig.deleteMany({});
    dangNhapAdmin("SUPER_ADMIN");
    await put({ paymentMethodId: pmId, mode: "TEST", reason: "Cấu hình TEST tài khoản số một" });
    const cu = await taoDon(P("sa4"));
    expect((await chiTiet(cu.d.orderId)).huongDanThanhToan.soTaiKhoan).toBe("0000000000");
    await put({ paymentMethodId: pmId2, mode: "TEST", reason: "Đổi sang tài khoản TEST số hai" });
    await db.paymentMethod.update({ where: { id: pmId }, data: { bankAccountNumber: "9999999999" } }); // sửa cả bản ghi gốc
    expect((await chiTiet(cu.d.orderId)).huongDanThanhToan.soTaiKhoan).toBe("0000000000"); // đơn cũ GIỮ bản chụp
    await db.paymentMethod.update({ where: { id: pmId }, data: { bankAccountNumber: "0000000000" } });
    const moi = await taoDon(P("sa5"));
    expect((await chiTiet(moi.d.orderId)).huongDanThanhToan.soTaiKhoan).toBe("0000000001");
    // ngừng cấu hình: đơn cũ vẫn có hướng dẫn; đơn tạo SAU đó thì không
    const r = await cauHinhDelete(req("DELETE", "/x", { reason: "Tạm ngừng cấu hình thu tiền Online" }));
    expect(r.status).toBe(200);
    expect((await chiTiet(cu.d.orderId)).huongDanTrangThai).toBe("SAN_SANG");
    const sau = await taoDon(P("sa6"));
    expect(sau.d.huongDanTrangThai).toBe("CHUA_CAU_HINH");
    expect((await cauHinhDelete(req("DELETE", "/x", { reason: "Ngừng lần hai không còn gì" }))).status).toBe(409); // không có cấu hình bật
  });

  it("[ONL-P2Q-05] đơn tạo TRƯỚC cấu hình không điền ngược; PROD cần khoá mở (đọc lại lúc xem) mới có ảnh QR", async () => {
    await db.onlinePaymentConfig.deleteMany({});
    dangNhapAdmin("SUPER_ADMIN");
    const truoc = await taoDon(P("sa7"));
    await put({ paymentMethodId: pmId, mode: "TEST", reason: "Cấu hình TEST sau khi đã có đơn" });
    expect((await chiTiet(truoc.d.orderId)).huongDanTrangThai).toBe("CHUA_CAU_HINH"); // không điền ngược
    process.env.ONLINE_PAYMENT_PROD_UNLOCK = "OWNER_VERIFIED"; // giả lập Owner đã mở (TÀI KHOẢN VẪN LÀ GIẢ)
    // V8.19: PROD đòi chỉ đích danh pháp nhân + gõ lại MST — thiếu/sai ⇒ 422 PHAP_NHAN_CHUA_XAC_NHAN, không ghi cấu hình
    const mst = (await db.legalEntity.findUniqueOrThrow({ where: { id: goc }, select: { taxCode: true } })).taxCode;
    const thieu = await put({ paymentMethodId: pmId, mode: "PROD", reason: "Thử chế độ PROD với tài khoản giả" });
    expect([thieu.status, (await json(thieu)).error?.code]).toEqual([422, "PHAP_NHAN_CHUA_XAC_NHAN"]);
    const sai = await put({ paymentMethodId: pmId, mode: "PROD", reason: "Thử chế độ PROD với tài khoản giả", legalEntityId: goc, xacNhanMaSoThue: "0000000000" });
    expect(sai.status).toBe(422);
    expect((await db.onlinePaymentConfig.findFirst({ where: { isActive: true }, select: { mode: true } }))?.mode).toBe("TEST"); // chưa đổi
    const r = await put({ paymentMethodId: pmId, mode: "PROD", reason: "Thử chế độ PROD với tài khoản giả", legalEntityId: goc, xacNhanMaSoThue: mst });
    expect(r.status).toBe(200);
    const p = await taoDon(P("sa8"));
    const ct = await chiTiet(p.d.orderId);
    expect(ct.huongDanThanhToan).toMatchObject({ moiTruong: "THAT", choPhepChuyenTien: true, nhan: null });
    expect(ct.huongDanThanhToan.anhQrUrl).toMatch(/^https:\/\/img\.vietqr\.io\/image\/000000-0000000000-compact2\.png\?amount=500000&addInfo=SR/);
    delete process.env.ONLINE_PAYMENT_PROD_UNLOCK; // khoá bị gỡ ⇒ fail-closed lúc xem, và tạo đơn MỚI không có bản chụp
    expect(await chiTiet(p.d.orderId)).toMatchObject({ huongDanThanhToan: null, huongDanTrangThai: "CAU_HINH_KHONG_HOP_LE" });
    const k2 = await dungKhoa();
    const r2 = await taoDonPost(req("POST", "/x", { dong: [{ studentId: P("sa1"), khoaId: k2.courseId }] }, bearer(tA)));
    expect((await json(r2)).data.huongDanTrangThai).toBe("CHUA_CAU_HINH"); // cấu hình PROD không dùng được ⇒ BLOCKED_CONFIG
  });

  it("[ONL-P2Q-06] đã thu đủ/đã huỷ ⇒ KHONG_CAN; chi tiết luôn hiện đơn vị bán", async () => {
    await db.onlinePaymentConfig.deleteMany({});
    dangNhapAdmin("SUPER_ADMIN");
    await put({ paymentMethodId: pmId, mode: "TEST", reason: "Cấu hình TEST cho ca huỷ đơn" });
    const { d } = await taoDon(P("sa2"));
    expect((await chiTiet(d.orderId)).donViBan).toMatchObject({ tenPhapLy: expect.stringContaining("Sata Robo"), maSoThue: "0402301783" });
    const h = await huyPost(req("POST", "/x", {}, bearer(tA)), { params: Promise.resolve({ orderId: d.orderId }) as never });
    expect(h.status).toBe(200);
    const ct = await chiTiet(d.orderId);
    expect(ct).toMatchObject({ huongDanThanhToan: null, huongDanTrangThai: "KHONG_CAN" });
    expect(ct.donViBan).toMatchObject({ maSoThue: "0402301783" });
  });
});
