import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/route";
import { POST as huyPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/cancel/route";
import { POST as xemTruocPost } from "@/app/api/mobile/v1/parent/online-orders/preview/route";
import { POST as taoDonPost } from "@/app/api/mobile/v1/parent/online-orders/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [ONL-P2M] V8.17 G2 — NHẬP MÃ GIẢM GIÁ cho đơn Online (route-handler thật + Postgres thật). Dùng ĐÚNG hệ khuyến mãi có sẵn (`lib/khuyen-mai`, `lyDoKhongDung`, `tienGiamCuaMa`), không có voucher thứ hai.
 *   [ONL-P2M-01] xem trước giá bằng MÃ (hoa/thường/khoảng trắng đều khớp): giảm đúng, KHÔNG tạo đơn, KHÔNG dùng lượt
 *   [ONL-P2M-02] tạo đơn bằng mã: tổng do máy chủ; ghi lượt + usedCount + ảnh chụp khuyến mãi; gửi cả voucherId+maGiamGia ⇒ 400; client gửi số tiền ⇒ 400
 *   [ONL-P2M-03] mã bị từ chối ĐÚNG lý do: lạ · kênh OFFLINE · khoá khác · hết hạn · chưa hiệu lực · dưới đơn tối thiểu · tắt
 *   [ONL-P2M-04] lượt theo CON: lần hai cùng con ⇒ 422 MA_HET_LUOT_CUA_CON; con khác dùng được
 *   [ONL-P2M-05] suất cuối dưới ĐUA: hai phụ huynh cùng lúc ⇒ ĐÚNG một đơn có mã, bên kia 409 MA_HET_SUAT, usedCount = 1
 *   [ONL-P2M-06] đổi giá khoá/mã SAU khi tạo đơn ⇒ đơn cũ giữ nguyên số tiền (ảnh chụp)
 *   [ONL-P2M-07] xem trước: không token + thân sai ⇒ 401; chế độ học sinh ⇒ 403; con nhà khác ⇒ 404
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "onlp2m-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.98.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
let n = 0;

async function dungKhoa(gia = 500_000) {
  const t = await taoKhoa(db, { code: `ONLP2M-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: false }, null);
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

async function dungMa(o: { kenh?: "OFFLINE" | "ONLINE" | "BOTH"; khoa: string[]; phanTram?: number; soTien?: number; soLuong?: number | null; gioiHanMoiCon?: number; tu?: string; den?: string; donToiThieu?: number; tat?: boolean }) {
  const i = ++n;
  const cs = await db.promotionPolicy.create({
    data: { documentCode: `${NS}VB${i}-${Date.now() % 100000}`, name: `${NS}CT${i}`, benefitText: "Ưu đãi thử nghiệm online", validFrom: new Date(o.tu ?? "2026-01-01"), validUntil: new Date(o.den ?? "2027-12-31"), channel: o.kenh ?? "ONLINE", onlineCourseIds: o.khoa },
    select: { id: true },
  });
  const v = await db.voucher.create({
    data: {
      code: `${NS}MA${i}-${Date.now() % 100000}`,
      name: `${NS}Mã ${i}`,
      type: "ALL",
      discountKind: o.soTien ? "FIXED" : "PERCENT",
      discountPercent: o.soTien ? null : (o.phanTram ?? 10),
      discountAmount: o.soTien ?? null,
      minOrderValue: o.donToiThieu ?? 0,
      validFrom: new Date(`${o.tu ?? "2026-01-01"}T00:00:00Z`),
      validUntil: new Date(`${o.den ?? "2027-12-31"}T00:00:00Z`),
      quantity: o.soLuong === undefined ? null : o.soLuong,
      usageLimitPerUser: o.gioiHanMoiCon ?? 1,
      isActive: !o.tat,
      policyId: cs.id,
    },
    select: { id: true, code: true },
  });
  return { voucherId: v.id, ma: v.code, policyId: cs.id };
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
  await db.voucher.deleteMany({ where: { code: { startsWith: NS } } });
  await db.promotionPolicy.deleteMany({ where: { documentCode: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

// Làm ấm đủ 5 kết nối của pool TRƯỚC mỗi đợt bắn: pool nguội ⇒ lượt đầu commit xong trước khi các lượt sau mở được kết nối ⇒ «song song» thực ra là nối tiếp và ca không bắt được tranh chấp.
const amPool = () => Promise.all(Array.from({ length: 5 }, () => db.$queryRaw`SELECT pg_sleep(0.05)::text AS x`));

describe.skipIf(!RUN)("[ONL-P2M] nhập mã giảm giá đơn Online", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const P = (k: string) => ids[k]!;
  const dong = (khoaId: string, studentId: string, extra: Record<string, unknown> = {}) => ({ studentId, khoaId, ...extra });
  const xemTruoc = (t: string | undefined, d: unknown[]) => xemTruocPost(req("POST", "/api/mobile/v1/parent/online-orders/preview", { dong: d }, t ? bearer(t) : undefined));
  const taoDon = (t: string, d: unknown[]) => taoDonPost(req("POST", "/api/mobile/v1/parent/online-orders", { dong: d }, bearer(t)));
  const dnTok = async (dinhDanh: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9d00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${dinhDanh}: ${JSON.stringify(j.error)}`);
    const t = (j.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966970001");
    await mk("B", "84966970002");
    for (const [k, ph] of [["a1", "A"], ["a2", "A"], ["b1", "B"]] as const) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[ph] } as never, select: { id: true } })).id;
    tA = await dnTok("0966970001", 1);
    tB = await dnTok("0966970002", 2);
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[ONL-P2M-01] xem trước bằng MÃ: giảm đúng, không tạo đơn, không dùng lượt; hoa/thường/khoảng trắng đều khớp", async () => {
    const k = await dungKhoa(500_000);
    const m = await dungMa({ khoa: [k.courseId], phanTram: 20 });
    const truoc = await db.order.count({ where: { createdById: P("A") } });
    for (const go of [m.ma, ` ${m.ma.toLowerCase()} `]) {
      const r = await xemTruoc(tA, [dong(k.courseId, P("sa1"), { maGiamGia: go })]);
      expect(r.status, go).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      const d = (await json(r)).data;
      expect(d).toMatchObject({ tongTien: 400_000, giamTong: 100_000, chiXemTruoc: true });
      expect(d.dong[0]).toMatchObject({ donGia: 500_000, giam: 100_000, thanhTien: 400_000, maGiamGia: m.ma });
    }
    expect(await db.order.count({ where: { createdById: P("A") } })).toBe(truoc); // không tạo đơn
    expect((await db.voucher.findUniqueOrThrow({ where: { id: m.voucherId }, select: { usedCount: true } })).usedCount).toBe(0); // không dùng lượt
    expect(await db.voucherRedemption.count({ where: { voucherId: m.voucherId } })).toBe(0);
    // không mã: giá niêm yết
    expect((await json(await xemTruoc(tA, [dong(k.courseId, P("sa1"))]))).data).toMatchObject({ tongTien: 500_000, giamTong: 0 });
  });

  it("[ONL-P2M-02] tạo đơn bằng mã: tổng do máy chủ; ghi lượt + usedCount + ảnh chụp; thân gửi cả hai/số tiền ⇒ 400", async () => {
    const k = await dungKhoa(600_000);
    const m = await dungMa({ khoa: [k.courseId], soTien: 50_000, soLuong: 5 });
    const r = await taoDon(tA, [dong(k.courseId, P("sa1"), { maGiamGia: m.ma })]);
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d).toMatchObject({ daCo: false, tongTien: 550_000, giamTong: 50_000 });
    const it = await db.orderItem.findFirstOrThrow({ where: { orderId: d.orderId }, select: { discountAmount: true, discountReason: true, metadata: true } });
    expect(it.discountAmount).toBe(50_000);
    expect(it.discountReason).toContain(m.ma);
    expect((it.metadata as { khuyenMai?: { voucherId: string; ma: string; giamUng: number } }).khuyenMai).toMatchObject({ voucherId: m.voucherId, ma: m.ma, giamUng: 50_000 });
    expect(await db.voucherRedemption.count({ where: { voucherId: m.voucherId, orderId: d.orderId } })).toBe(1);
    expect((await db.voucher.findUniqueOrThrow({ where: { id: m.voucherId }, select: { usedCount: true } })).usedCount).toBe(1);
    // bấm đúp ⇒ đơn cũ, không dùng thêm lượt
    const l2 = await taoDon(tA, [dong(k.courseId, P("sa1"), { maGiamGia: m.ma })]);
    expect((await json(l2)).data).toMatchObject({ daCo: true, orderId: d.orderId });
    expect((await db.voucher.findUniqueOrThrow({ where: { id: m.voucherId }, select: { usedCount: true } })).usedCount).toBe(1);
    // gửi cả hai cách / số tiền / trường lạ ⇒ không tin client
    const k2 = await dungKhoa();
    const m2 = await dungMa({ khoa: [k2.courseId] });
    expect(await ma(await taoDon(tA, [dong(k2.courseId, P("sa2"), { maGiamGia: m2.ma, voucherId: m2.voucherId })]))).toEqual([400, "DU_LIEU_SAI"]);
    for (const x of [{ giam: 1 }, { soTienGiam: 1 }, { donGia: 1 }]) expect((await taoDon(tA, [dong(k2.courseId, P("sa2"), { maGiamGia: m2.ma, ...x })])).status, JSON.stringify(x)).toBe(400);
  });

  it("[ONL-P2M-03] mã bị từ chối đúng lý do (kèm 0 đơn được tạo)", async () => {
    const k = await dungKhoa(500_000);
    const kKhac = await dungKhoa(500_000);
    const truoc = await db.order.count({ where: { createdById: P("A") } });
    const case_ = async (ten: string, m: { ma: string }, mong: [number, string]) => {
      expect(await ma(await xemTruoc(tA, [dong(k.courseId, P("sa2"), { maGiamGia: m.ma })])), `xem trước · ${ten}`).toEqual(mong);
      expect(await ma(await taoDon(tA, [dong(k.courseId, P("sa2"), { maGiamGia: m.ma })])), `tạo đơn · ${ten}`).toEqual(mong);
    };
    expect(await ma(await xemTruoc(tA, [dong(k.courseId, P("sa2"), { maGiamGia: "KHONG-CO-MA-NAY" })]))).toEqual([422, "MA_KHONG_TON_TAI"]);
    await case_("kênh OFFLINE", await dungMa({ kenh: "OFFLINE", khoa: [] }), [422, "MA_KHONG_DUNG_DUOC"]);
    await case_("khoá khác", await dungMa({ khoa: [kKhac.courseId] }), [422, "MA_KHONG_DUNG_DUOC"]);
    await case_("hết hạn", await dungMa({ khoa: [k.courseId], tu: "2025-01-01", den: "2025-12-31" }), [422, "MA_KHONG_DUNG_DUOC"]);
    await case_("chưa hiệu lực", await dungMa({ khoa: [k.courseId], tu: "2027-06-01", den: "2027-12-31" }), [422, "MA_KHONG_DUNG_DUOC"]);
    await case_("dưới đơn tối thiểu", await dungMa({ khoa: [k.courseId], donToiThieu: 900_000 }), [422, "MA_KHONG_DUNG_DUOC"]);
    await case_("đã tắt (coi như đã gỡ)", await dungMa({ khoa: [k.courseId], tat: true }), [422, "MA_KHONG_TON_TAI"]);
    expect(await db.order.count({ where: { createdById: P("A") } })).toBe(truoc);
  });

  it("[ONL-P2M-04] lượt theo CON: lần hai cùng con ⇒ MA_HET_LUOT_CUA_CON; con khác dùng được", async () => {
    const k1 = await dungKhoa();
    const k2 = await dungKhoa();
    const m = await dungMa({ khoa: [k1.courseId, k2.courseId], gioiHanMoiCon: 1 });
    expect((await taoDon(tA, [dong(k1.courseId, P("sa1"), { maGiamGia: m.ma })])).status).toBe(200);
    expect(await ma(await taoDon(tA, [dong(k2.courseId, P("sa1"), { maGiamGia: m.ma })]))).toEqual([422, "MA_HET_LUOT_CUA_CON"]);
    expect(await ma(await xemTruoc(tA, [dong(k2.courseId, P("sa1"), { maGiamGia: m.ma })]))).toEqual([422, "MA_HET_LUOT_CUA_CON"]);
    expect((await taoDon(tA, [dong(k2.courseId, P("sa2"), { maGiamGia: m.ma })])).status).toBe(200); // con khác của cùng nhà
  });

  it("[ONL-P2M-05] suất cuối dưới ĐUA: hai phụ huynh cùng lúc ⇒ đúng một đơn có mã, usedCount = 1", async () => {
    const k = await dungKhoa();
    const m = await dungMa({ khoa: [k.courseId], soLuong: 1 });
    const kq = await Promise.all([taoDon(tA, [dong(k.courseId, P("sa1"), { maGiamGia: m.ma })]), taoDon(tB, [dong(k.courseId, P("sb1"), { maGiamGia: m.ma })])]);
    // Bên thua: 409 MA_HET_SUAT (đua thật tại giao dịch) HOẶC 422 MA_KHONG_DUNG_DUOC (bên thắng đã ghi xong trước khi bên kia đọc) — cả hai đều đúng, KHÔNG được cùng thắng.
    expect(kq.map((r) => r.status).filter((x) => x === 200)).toHaveLength(1);
    const thua = await Promise.all(kq.filter((r) => r.status !== 200).map((r) => json(r)));
    expect(thua).toHaveLength(1);
    expect(["MA_HET_SUAT", "MA_KHONG_DUNG_DUOC"]).toContain(thua[0]!.error?.code);
    expect((await db.voucher.findUniqueOrThrow({ where: { id: m.voucherId }, select: { usedCount: true } })).usedCount).toBe(1);
    expect(await db.voucherRedemption.count({ where: { voucherId: m.voucherId } })).toBe(1);
  });

  it("[ONL-P2M-06] đổi giá khoá + đổi mã SAU khi tạo đơn ⇒ đơn cũ giữ nguyên số tiền", async () => {
    const k = await dungKhoa(500_000);
    const m = await dungMa({ khoa: [k.courseId], phanTram: 10 });
    const d = (await json(await taoDon(tB, [dong(k.courseId, P("sb1"), { maGiamGia: m.ma })]))).data;
    expect(d).toMatchObject({ tongTien: 450_000, giamTong: 50_000 });
    await db.onlCourse.update({ where: { id: k.courseId }, data: { listPrice: 900_000, salePrice: 900_000 } });
    await db.voucher.update({ where: { id: m.voucherId }, data: { discountPercent: 50 } });
    const ct = await chiTietGet(req("GET", `/x`, undefined, bearer(tB)), { params: Promise.resolve({ orderId: d.orderId }) as never });
    expect(ct.status).toBe(200);
    expect((await json(ct)).data).toMatchObject({ tongTien: 450_000 });
    const o = await db.order.findUniqueOrThrow({ where: { id: d.orderId }, select: { totalAmount: true, discountAmount: true } });
    expect([o.totalAmount, o.discountAmount]).toEqual([450_000, 50_000]);
    // đối chứng: giỏ MỚI cùng khoá thấy giá mới
    expect((await json(await xemTruoc(tA, [dong(k.courseId, P("sa1"))]))).data.tongTien).toBe(900_000);
  });

  it("[ONL-P2M-07] xem trước: không token + thân sai ⇒ 401; con nhà khác ⇒ 404; chế độ học sinh ⇒ 403", async () => {
    const k = await dungKhoa();
    expect((await xemTruocPost(req("POST", "/x", { sai: 1 }))).status).toBe(401);
    expect(await ma(await xemTruoc(tA, [dong(k.courseId, P("sb1"))]))).toEqual([404, "NOT_FOUND"]);
    const hs = await dnTok("0966970001", 9);
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(hs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: P("sa1") }, bearer(hs)))).status).toBe(200);
    expect(await ma(await xemTruoc(hs, [dong(k.courseId, P("sa1"))]))).toEqual([403, "FORBIDDEN"]);
    expect((await xemTruoc(tA, [dong(k.courseId, P("sa1"))])).status).toBe(200); // đối chứng dương
  });

  const CGT_N = 6;
  const tomCgt = async (nhan: string, ds: Promise<Response>[]) => {
    const kq = await Promise.all((await Promise.all(ds)).map(async (r) => { const j = await json(r); return { s: r.status, ma: j.error?.code, data: j.data as any }; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.info(`${nhan} phản hồi: ${kq.map((x) => `${x.s}${x.ma ? `:${x.ma}` : ""}${x.data?.daCo === true || x.data?.daHuyTruocDo === true || x.data?.trungLap === true ? ":lặp" : ""}`).sort().join(" ")}`);
    return kq;
  };

  it("[CGT-03] tạo đơn có mã (1 suất, 1 lượt/con) × 6 request y hệt song song ⇒ đúng MỘT đơn, dùng MỘT lượt", async () => {
    const k = await dungKhoa(500_000);
    const m = await dungMa({ khoa: [k.courseId], soTien: 50_000, soLuong: 1, gioiHanMoiCon: 1 });
    const gui = () => taoDon(tA, [dong(k.courseId, P("sa1"), { maGiamGia: m.ma })]);
    await amPool();
    const kq = await tomCgt("[CGT-03]", Array.from({ length: CGT_N }, gui));
    const duoc = kq.filter((x) => x.s === 200);
    expect(duoc.length).toBeGreaterThanOrEqual(1);
    expect(new Set(duoc.map((x) => x.data.orderId)).size).toBe(1);
    expect(duoc.filter((x) => x.data.daCo === false)).toHaveLength(1);
    for (const x of kq.filter((y) => y.s !== 200)) expect(["MA_HET_SUAT", "MA_HET_LUOT_CUA_CON", "MA_KHONG_DUNG_DUOC"], `${x.s} ${x.ma}`).toContain(x.ma);
    expect(await db.orderItem.count({ where: { onlineCourseId: k.courseId, studentId: P("sa1") } })).toBe(1);
    expect((await db.voucher.findUniqueOrThrow({ where: { id: m.voucherId }, select: { usedCount: true } })).usedCount).toBe(1);
    expect(await db.voucherRedemption.count({ where: { voucherId: m.voucherId } })).toBe(1);
    expect((await json(await gui())).data).toMatchObject({ daCo: true, orderId: duoc[0]!.data.orderId }); // gửi lại sau cùng ⇒ đơn cũ
  }, 60_000);

  it("[CGT-04] huỷ đơn có mã × 6 song song ⇒ trả lượt mã đúng MỘT lần (đơn khác cùng mã giữ nguyên lượt)", async () => {
    const k = await dungKhoa(500_000);
    const m = await dungMa({ khoa: [k.courseId], soTien: 50_000, soLuong: 5, gioiHanMoiCon: 1 });
    const d1 = (await json(await taoDon(tA, [dong(k.courseId, P("sa1"), { maGiamGia: m.ma })]))).data;
    const d2 = (await json(await taoDon(tA, [dong(k.courseId, P("sa2"), { maGiamGia: m.ma })]))).data;
    const luot = async () => (await db.voucher.findUniqueOrThrow({ where: { id: m.voucherId }, select: { usedCount: true } })).usedCount;
    expect(await luot()).toBe(2); // đối chứng: trả lượt HAI lần sẽ về 0
    const huy = () => huyPost(req("POST", "/x", {}, bearer(tA)), { params: Promise.resolve({ orderId: d1.orderId }) as never });
    await amPool();
    const kq = await tomCgt("[CGT-04]", Array.from({ length: CGT_N }, huy));
    expect(kq.map((x) => x.s)).toEqual(Array(CGT_N).fill(200));
    expect(kq.filter((x) => x.data.daHuyTruocDo === false)).toHaveLength(1);
    expect(await luot()).toBe(1);
    expect(await db.voucherRedemption.count({ where: { orderId: d1.orderId } })).toBe(0);
    expect(await db.voucherRedemption.count({ where: { orderId: d2.orderId } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: d1.orderId, action: "CANCEL" } })).toBe(1);
  }, 60_000);

  it("[CGT-12] tạo đơn KHÔNG mã × 6 y hệt song song ⇒ đúng MỘT đơn, mọi lượt cùng trả đơn đó", async () => {
    const k = await dungKhoa(500_000);
    await amPool();
    const kq = await tomCgt("[CGT-12]", Array.from({ length: CGT_N }, () => taoDon(tA, [dong(k.courseId, P("sa1"))])));
    expect(kq.map((x) => x.s)).toEqual(Array(CGT_N).fill(200));
    expect(new Set(kq.map((x) => x.data.orderId)).size).toBe(1);
    expect(kq.filter((x) => x.data.daCo === false)).toHaveLength(1);
    expect(await db.orderItem.count({ where: { onlineCourseId: k.courseId, studentId: P("sa1") } })).toBe(1);
    expect(await db.paymentRequest.count({ where: { orderId: kq[0]!.data.orderId } })).toBe(1);
  }, 60_000);
});
