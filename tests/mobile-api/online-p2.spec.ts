import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as catalogGet } from "@/app/api/mobile/v1/online/catalog/route";
import { GET as catalogChiTietGet } from "@/app/api/mobile/v1/online/catalog/[slug]/route";
import { POST as validatePost } from "@/app/api/mobile/v1/parent/checkout/validate/route";
import { POST as huyPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/cancel/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/route";
import { GET as danhSachGet, POST as taoDonPost } from "@/app/api/mobile/v1/parent/online-orders/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { GET as khoaOnlineGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/route";
import { GET as purchasableGet } from "@/app/api/mobile/v1/students/[studentId]/online/purchasable/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [ONL-P2] V8.15 — mua khoá Online qua HTTP route-handler + Postgres thật (lõi `online-checkout` + E NGUYÊN VẸN, tiền về bằng `ingestPayosWebhook` THẬT):
 *   [ONL-P2-01] danh mục công khai: chỉ khoá ĐÃ phát hành + đang bán; chi tiết theo slug; không token 401; slug lạ 404
 *   [ONL-P2-02] khoá mua được cho con + giá máy chủ; con nhà khác 404
 *   [ONL-P2-03] tạo đơn nhiều con × nhiều khoá: tổng do máy chủ; thân có giá/trường lạ ⇒ 400; con nhà khác ⇒ 404; khoá chưa phát hành ⇒ chặn; KHÔNG cấp quyền khi mới tạo đơn
 *   [ONL-P2-04] bấm đúp/6 yêu cầu SONG SONG cùng giỏ ⇒ ĐÚNG MỘT đơn
 *   [ONL-P2-05] hồ sơ phụ huynh thiếu ⇒ 422 THIEU_HO_SO_PHU_HUYNH, không tạo đơn
 *   [ONL-P2-06] danh sách/chi tiết chỉ của mình; đơn nhà khác 404; huongDanThanhToan=null
 *   [ONL-P2-07] 🔴 tiền về THẬT: thiếu tiền ⇒ KHÔNG cấp; đủ ⇒ cấp ngay (đơn DA_CAP_QUYEN + khoá hiện ở P0); webhook gửi lại ⇒ không cấp đôi; huỷ đơn đã có tiền ⇒ 409
 *   [ONL-P2-08] huỷ đơn chưa có tiền: 200, huỷ lại idempotent, đơn nhà khác 404
 *   [ONL-P2-09] chế độ học sinh: mọi route mua ⇒ 403 (đối chứng dương: phiên phụ huynh thường 200)
 *   [ONL-P2-10] cổng `checkout/validate` dùng danh mục THẬT: khoá bán được ⇒ hợp lệ; chưa phát hành ⇒ COURSE_NOT_FOR_SALE
 *   [ONL-P2-11] cờ Online tắt ⇒ 404 mọi route mới, không tạo đơn
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "onlp2-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
let n = 0;

async function dungKhoa(o: { gia?: number; chuaPhatHanh?: boolean; khongBan?: boolean } = {}) {
  const gia = o.gia ?? 500_000;
  const t = await taoKhoa(db, { code: `ONLP2-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  if (!o.chuaPhatHanh) {
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
    if (!o.khongBan) await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" }); // khongBan: ĐÃ phát hành nhưng NOT_ON_SALE
  }
  const k = await db.onlCourse.findUniqueOrThrow({ where: { id: t.courseId }, select: { slug: true } });
  return { courseId: t.courseId, slug: k.slug, gia };
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
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[ONL-P2] mua khoá Online qua HTTP + Postgres thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  let tC = "";
  const P = (k: string) => ids[k]!;
  const ctxS = (studentId: string) => ({ params: Promise.resolve({ studentId }) as never });
  const ctxO = (orderId: string) => ({ params: Promise.resolve({ orderId }) as never });
  const taoDon = (t: string | undefined, dong: unknown) => taoDonPost(req("POST", "/api/mobile/v1/parent/online-orders", { dong }, t ? bearer(t) : undefined));
  const chiTiet = (t: string, oid: string) => chiTietGet(req("GET", `/api/mobile/v1/parent/online-orders/${oid}`, undefined, bearer(t)), ctxO(oid));
  const huy = (t: string, oid: string) => huyPost(req("POST", `/api/mobile/v1/parent/online-orders/${oid}/cancel`, {}, bearer(t)), ctxO(oid));
  const gioA = (courseId: string, studentId: string) => ({ studentId, khoaId: courseId });
  const veTien = (matchKey: string, reference: string, amount: number) => ({ reference, description: `${matchKey} HOC PHI ONLINE`, amount, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string | null, name: string | null) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966950001", "Phụ huynh A");
    await mk("B", "84966950002", "Phụ huynh B");
    await mk("C", null, "Phụ huynh C"); // thiếu SĐT
    for (const [k, ph] of [["a1", "A"], ["a2", "A"], ["b1", "B"], ["c1", "C"]] as const) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[ph] } as never, select: { id: true } })).id;
    const dn = async (sdt: string, nn: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9b00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      const j = await json(r);
      if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
      return (j.data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966950001", 1);
    tB = await dn("0966950002", 2);
    tC = await dn("0966950003", 3).catch(() => ""); // C không có SĐT ⇒ không đăng nhập bằng SĐT được; dùng email bên dưới
    if (!tC) {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: `${NS}C@seed.invalid`, matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9b00-000000000003", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      tC = ((await json(r)).data as { accessToken: string }).accessToken;
    }
    for (const t of [tA, tB, tC]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[ONL-P2-01] danh mục: chỉ khoá đã phát hành + đang bán; chi tiết theo slug; 401 không token; slug lạ 404", async () => {
    const ban = await dungKhoa();
    const chua = await dungKhoa({ chuaPhatHanh: true });
    const dung = await dungKhoa({ khongBan: true });
    const r = await catalogGet(req("GET", "/api/mobile/v1/online/catalog?coTrang=50", undefined, bearer(tA)));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await json(r)).data;
    const slugs = (d.muc as Array<{ slug: string }>).map((m) => m.slug);
    expect(slugs).toContain(ban.slug);
    expect(slugs).not.toContain(chua.slug);
    expect(slugs).not.toContain(dung.slug); // đã phát hành nhưng ngừng bán ⇒ không hiện
    expect(JSON.stringify(d)).not.toMatch(/mediaRef|online\/video|contentJson/);
    const ct = await catalogChiTietGet(req("GET", `/api/mobile/v1/online/catalog/${ban.slug}`, undefined, bearer(tA)), { params: Promise.resolve({ slug: ban.slug }) as never });
    expect(ct.status).toBe(200);
    expect((await json(ct)).data.salePrice).toBe(ban.gia);
    expect(await ma(await catalogChiTietGet(req("GET", `/x/${chua.slug}`, undefined, bearer(tA)), { params: Promise.resolve({ slug: chua.slug }) as never }))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await catalogChiTietGet(req("GET", "/x/khong-co", undefined, bearer(tA)), { params: Promise.resolve({ slug: "khong-co" }) as never }))).toEqual([404, "NOT_FOUND"]);
    expect((await catalogGet(req("GET", "/api/mobile/v1/online/catalog"))).status).toBe(401);
    expect((await catalogGet(req("GET", "/api/mobile/v1/online/catalog?coTrang=9999", undefined, bearer(tA)))).status).toBe(400);
  });

  it("[ONL-P2-02] khoá mua được cho con + giá máy chủ; con nhà khác 404", async () => {
    const k = await dungKhoa({ gia: 700_000 });
    const r = await purchasableGet(req("GET", `/x`, undefined, bearer(tA)), ctxS(P("sa1")));
    expect(r.status).toBe(200);
    const muc = (await json(r)).data.muc as Array<{ courseId: string; trangThai: string; gia: number }>;
    expect(muc.find((m) => m.courseId === k.courseId)).toMatchObject({ trangThai: "MUA_DUOC", gia: 700_000 });
    expect(await ma(await purchasableGet(req("GET", `/x`, undefined, bearer(tA)), ctxS(P("sb1"))))).toEqual([404, "NOT_FOUND"]);
    expect((await purchasableGet(req("GET", `/x`), ctxS(P("sa1")))).status).toBe(401);
  });

  it("[ONL-P2-03] tạo đơn nhiều con × nhiều khoá: tổng do máy chủ; giá/trường lạ ⇒ 400; con nhà khác ⇒ 404; chưa phát hành chặn; chưa cấp quyền", async () => {
    const k1 = await dungKhoa({ gia: 500_000 });
    const k2 = await dungKhoa({ gia: 300_000 });
    const chua = await dungKhoa({ chuaPhatHanh: true });
    const dung = await dungKhoa({ khongBan: true });
    const r = await taoDon(tA, [gioA(k1.courseId, P("sa1")), gioA(k2.courseId, P("sa1")), gioA(k1.courseId, P("sa2"))]);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await json(r)).data;
    expect(d).toMatchObject({ daCo: false, tongTien: 500_000 + 300_000 + 500_000, trangThaiThanhToan: "CHO_THANH_TOAN", huongDanThanhToan: null });
    expect(d.dong).toHaveLength(3);
    expect(d.gioiHan.join(" ")).toMatch(/chuyển khoản/);
    // máy chủ KHÔNG tin số tiền/trường lạ của client
    for (const x of [{ tongTien: 1 }, { dong: [{ ...gioA(k1.courseId, P("sa1")), donGia: 1 }] }, { dong: [gioA(k1.courseId, P("sa1"))], giam: 100 }]) {
      const body = "dong" in x ? x : { dong: [gioA(k2.courseId, P("sa2"))], ...x };
      expect((await taoDonPost(req("POST", "/x", body, bearer(tA)))).status, JSON.stringify(x)).toBe(400);
    }
    expect(await ma(await taoDon(tA, []))).toEqual([400, "VALIDATION"]);
    expect(await ma(await taoDon(tA, [gioA(k1.courseId, P("sb1"))]))).toEqual([404, "NOT_FOUND"]); // con nhà khác
    expect(await ma(await taoDon(tA, [gioA(k2.courseId, P("sa1")), gioA(k2.courseId, P("sa1"))]))).toEqual([400, "TRUNG_CAP_KHOA_HOC_VIEN"]);
    const cc = await ma(await taoDon(tA, [gioA(chua.courseId, P("sa2"))]));
    expect(cc[0]).toBeGreaterThanOrEqual(404);
    expect([404, 409]).toContain(cc[0]);
    expect(await ma(await taoDon(tA, [gioA(dung.courseId, P("sa2"))]))).toEqual([409, "KHOA_KHONG_DANG_BAN"]); // đã phát hành nhưng ngừng bán
    expect(await db.onlEntitlement.count({ where: { studentId: { in: [P("sa1"), P("sa2")] } } })).toBe(0); // mới tạo đơn ⇒ KHÔNG cấp quyền
    expect(await db.order.count({ where: { createdById: P("A"), type: "ONLINE" } })).toBeGreaterThanOrEqual(1);
  });

  it("[ONL-P2-04] 6 yêu cầu SONG SONG cùng giỏ ⇒ ĐÚNG MỘT đơn", async () => {
    const k = await dungKhoa({ gia: 400_000 });
    const truoc = await db.order.count({ where: { createdById: P("B"), type: "ONLINE" } });
    const rs = await Promise.all(Array.from({ length: 6 }, () => taoDon(tB, [gioA(k.courseId, P("sb1"))])));
    const js = await Promise.all(rs.map(async (r) => ({ s: r.status, d: (await json(r)).data })));
    expect(js.every((x) => x.s === 200)).toBe(true);
    expect(new Set(js.map((x) => x.d.orderId)).size).toBe(1);
    expect(js.filter((x) => x.d.daCo === false)).toHaveLength(1);
    expect(await db.order.count({ where: { createdById: P("B"), type: "ONLINE" } })).toBe(truoc + 1);
  });

  it("[ONL-P2-05] hồ sơ phụ huynh thiếu SĐT ⇒ 422 THIEU_HO_SO_PHU_HUYNH, không tạo đơn", async () => {
    const k = await dungKhoa();
    expect(await ma(await taoDon(tC, [gioA(k.courseId, P("sc1"))]))).toEqual([422, "THIEU_HO_SO_PHU_HUYNH"]);
    expect(await db.order.count({ where: { createdById: P("C") } })).toBe(0);
  });

  it("[ONL-P2-06] danh sách/chi tiết chỉ của mình; đơn nhà khác 404", async () => {
    const k = await dungKhoa({ gia: 250_000 });
    const d = (await json(await taoDon(tA, [gioA(k.courseId, P("sa2"))]))).data;
    const lsA = (await json(await danhSachGet(req("GET", "/x", undefined, bearer(tA))))).data.muc as Array<{ orderId: string }>;
    expect(lsA.some((o) => o.orderId === d.orderId)).toBe(true);
    const lsB = (await json(await danhSachGet(req("GET", "/x", undefined, bearer(tB))))).data.muc as Array<{ orderId: string }>;
    expect(lsB.some((o) => o.orderId === d.orderId)).toBe(false);
    const ct = await chiTiet(tA, d.orderId);
    expect(ct.status).toBe(200);
    const ctj = (await json(ct)).data;
    expect(ctj).toMatchObject({ orderId: d.orderId, tongTien: 250_000, daThu: 0, huongDanThanhToan: null });
    expect(ctj.dong[0].trangThai).toBe("DANG_CHO_THANH_TOAN");
    expect(await ma(await chiTiet(tB, d.orderId))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await chiTiet(tA, "don-khong-co"))).toEqual([404, "NOT_FOUND"]);
  });

  it("[ONL-P2-07] 🔴 tiền về THẬT (ingestPayosWebhook): thiếu ⇒ không cấp; đủ ⇒ cấp ngay + hiện ở P0; gửi lại ⇒ không cấp đôi; huỷ đơn có tiền ⇒ 409", async () => {
    const k = await dungKhoa({ gia: 500_000 });
    const d = (await json(await taoDon(tA, [gioA(k.courseId, P("sa1"))]))).data;
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId: d.orderId }, select: { matchKey: true } });
    const thieu = await ingestPayosWebhook(veTien(phieu.matchKey!, `ONP2A${Date.now()}`, 300_000), "SEPAY");
    expect(thieu.status).toBe("MATCHED");
    expect(await db.onlEntitlement.count({ where: { studentId: P("sa1"), courseId: k.courseId } })).toBe(0); // thu một phần ⇒ KHÔNG cấp
    let ct = (await json(await chiTiet(tA, d.orderId))).data;
    expect(ct.dong[0].trangThai).toBe("DANG_CHO_THANH_TOAN");
    expect(ct.daThu).toBe(300_000);
    expect(await ma(await huy(tA, d.orderId))).toEqual([409, "DA_CO_TIEN"]); // đã có tiền ⇒ không huỷ
    const refDu = `ONP2B${Date.now()}`;
    const du = await ingestPayosWebhook(veTien(phieu.matchKey!, refDu, 200_000), "SEPAY");
    expect(du.status).toBe("MATCHED");
    ct = (await json(await chiTiet(tA, d.orderId))).data;
    expect(ct.dong[0].trangThai).toBe("DA_CAP_QUYEN");
    expect(ct.dong[0].hetHan).toBeTruthy();
    const kh = (await json(await khoaOnlineGet(req("GET", "/x", undefined, bearer(tA)), ctxS(P("sa1"))))).data.muc as Array<{ courseId: string }>;
    expect(kh.map((x) => x.courseId)).toContain(k.courseId); // khoá hiện ngay ở API học (P0)
    const lai = await ingestPayosWebhook(veTien(phieu.matchKey!, refDu, 200_000), "SEPAY"); // webhook gửi lại cùng mã giao dịch
    expect(lai.status).not.toBe("MATCHED");
    expect(await db.onlEntitlementEvent.count({ where: { entitlement: { studentId: P("sa1"), courseId: k.courseId } } })).toBe(1);
    expect(await ma(await huy(tA, d.orderId))).toEqual([409, expect.stringMatching(/DA_CO_TIEN|DA_CAP_QUYEN|SAI_TRANG_THAI/)]);
  });

  it("[ONL-P2-08] huỷ đơn chưa có tiền: 200; huỷ lại idempotent; đơn nhà khác 404", async () => {
    const k = await dungKhoa();
    const d = (await json(await taoDon(tA, [gioA(k.courseId, P("sa2"))]))).data;
    expect(await ma(await huy(tB, d.orderId))).toEqual([404, "NOT_FOUND"]);
    const r1 = await huy(tA, d.orderId);
    expect(r1.status).toBe(200);
    expect((await json(r1)).data).toEqual({ daHuy: true, daHuyTruocDo: false });
    expect((await json(await huy(tA, d.orderId))).data).toEqual({ daHuy: true, daHuyTruocDo: true });
    expect((await db.order.findUniqueOrThrow({ where: { id: d.orderId }, select: { status: true } })).status).toBe("CANCELLED");
  });

  it("[ONL-P2-09] chế độ học sinh: mọi route mua ⇒ 403; đối chứng dương: phiên phụ huynh thường 200", async () => {
    const k = await dungKhoa();
    const dn = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966950001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9b00-0000000000a9", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const hs = ((await json(dn)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(hs)));
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(hs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: P("sa1") }, bearer(hs)))).status).toBe(200);
    const kq = [
      await catalogGet(req("GET", "/api/mobile/v1/online/catalog", undefined, bearer(hs))),
      await purchasableGet(req("GET", "/x", undefined, bearer(hs)), ctxS(P("sa1"))),
      await taoDon(hs, [gioA(k.courseId, P("sa1"))]),
      await danhSachGet(req("GET", "/x", undefined, bearer(hs))),
      await chiTiet(hs, "x"),
      await huy(hs, "x"),
    ];
    expect(kq.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    // đối chứng dương: phiên thường của cùng phụ huynh làm được
    expect((await catalogGet(req("GET", "/api/mobile/v1/online/catalog", undefined, bearer(tA)))).status).toBe(200);
    expect((await danhSachGet(req("GET", "/x", undefined, bearer(tA)))).status).toBe(200);
  });

  it("[ONL-P2-10] cổng checkout/validate dùng danh mục THẬT", async () => {
    const ban = await dungKhoa();
    const chua = await dungKhoa({ chuaPhatHanh: true });
    const dung = await dungKhoa({ khongBan: true });
    const v = async (khoaId: string) => (await json(await validatePost(req("POST", "/x", { dong: [{ studentId: P("sa1"), khoaId }] }, bearer(tA))))).data as { hopLe: boolean; loi: Array<{ code: string }>; chuaKiemDuoc: string[] };
    const a = await v(ban.courseId);
    expect(a.hopLe).toBe(true);
    expect(a.chuaKiemDuoc).toEqual([]);
    const b = await v(chua.courseId);
    expect(b.hopLe).toBe(false);
    expect(b.loi.map((l) => l.code)).toContain("COURSE_NOT_FOR_SALE");
    const c = await v(dung.courseId); // đã phát hành nhưng NOT_ON_SALE ⇒ cũng không bán
    expect(c.loi.map((l) => l.code)).toContain("COURSE_NOT_FOR_SALE");
  });

  it("[ONL-P2-11] cờ Online tắt ⇒ 404 mọi route mới, không tạo đơn", async () => {
    const k = await dungKhoa();
    const dCo = (await json(await taoDon(tA, [gioA(k.courseId, P("sa2"))]))).data; // đơn THẬT tạo khi cờ bật
    const truoc = await db.order.count({ where: { createdById: P("A") } });
    process.env.ELEARNING_ONLINE_ENABLED = "false";
    try {
      const kq = [
        await catalogGet(req("GET", "/api/mobile/v1/online/catalog", undefined, bearer(tA))),
        await purchasableGet(req("GET", "/x", undefined, bearer(tA)), ctxS(P("sa1"))),
        await taoDon(tA, [gioA(k.courseId, P("sa1"))]),
        await danhSachGet(req("GET", "/x", undefined, bearer(tA))),
        await chiTiet(tA, dCo.orderId), // đơn có thật: cờ tắt vẫn 404
        await huy(tA, dCo.orderId),
      ];
      expect(kq.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404]);
      expect((await db.order.findUniqueOrThrow({ where: { id: dCo.orderId }, select: { status: true } })).status).not.toBe("CANCELLED"); // huỷ khi cờ tắt không được chạy
      expect(await db.order.count({ where: { createdById: P("A") } })).toBe(truoc);
    } finally {
      process.env.ELEARNING_ONLINE_ENABLED = "true";
    }
  });
});
