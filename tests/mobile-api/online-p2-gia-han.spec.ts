import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/route";
import { POST as xemTruocPost } from "@/app/api/mobile/v1/parent/online-orders/preview/route";
import { POST as taoDonPost } from "@/app/api/mobile/v1/parent/online-orders/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as quyenGet } from "@/app/api/mobile/v1/students/[studentId]/online/entitlements/route";
import { GET as muaDuocGet } from "@/app/api/mobile/v1/students/[studentId]/online/purchasable/route";
import { POST as tienDoPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/progress/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { tinhHanMoi } from "@/lib/elearning-online/thoi-han";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [ONL-P2R] V8.17 G3 — GIA HẠN quyền học Online qua HTTP + Postgres thật. KHÔNG có thuật toán hạn mới: hạn do `quyetDinhCap`/`tinhHanMoi` CỦA E quyết;
 * tiền về bằng `ingestPayosWebhook` THẬT. Bốn bước app dùng: kiểm khả năng/giá (`purchasable`) · xem trước (`preview`) · tạo đơn (`online-orders`) · trạng thái (`online-orders/:id`) · làm mới quyền (`entitlements`).
 *   [ONL-P2R-01] trạng thái mua theo quyền hiện có: chưa có · còn hạn+cho gia hạn · còn hạn+không cho · trọn đời · hết hạn · đã thu hồi (+ giá)
 *   [ONL-P2R-02] đơn gia hạn: giá = giá gia hạn của máy chủ; xem trước = tạo đơn; KHÔNG đổi hạn cho tới khi tiền về; bấm đúp ⇒ đơn cũ
 *   [ONL-P2R-03] 🔴 tiền về ⇒ hạn mới = `tinhHanMoi` của E (cộng từ hạn cũ); LỊCH SỬ HỌC còn nguyên (cùng dòng quyền, tiến độ không mất); webhook gửi lại ⇒ không cộng đôi
 *   [ONL-P2R-04] chặn đúng: trọn đời ⇒ 409 DA_TRON_DOI; còn hạn + khoá không cho gia hạn ⇒ 409 KHOA_KHONG_CHO_GIA_HAN; con nhà khác ⇒ 404
 *   [ONL-P2R-05] hết hạn/đã thu hồi ⇒ mở lại TỪ MỐC thanh toán (không cộng bù hạn cũ), tiến độ cũ còn
 *   [ONL-P2R-06] song song: hai yêu cầu cùng giỏ gia hạn ⇒ ĐÚNG MỘT đơn
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "onlp2r-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.99.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
let n = 0;
const NGAY = 24 * 3600 * 1000;

async function dungKhoa(o: { gia?: number; giaHan?: number | null; thang?: number | null } = {}) {
  const gia = o.gia ?? 500_000;
  const thang = o.thang === undefined ? 6 : o.thang;
  const gh = o.giaHan === undefined ? 300_000 : o.giaHan; // null = khoá KHÔNG cho gia hạn
  const t = await taoKhoa(db, { code: `ONLP2R-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: thang, renewalEnabled: gh !== null && thang !== null, renewalPrice: gh !== null && thang !== null ? gh : null }, null);
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
  const bai = await db.onlLesson.findFirstOrThrow({ where: { version: { courseId: t.courseId } }, select: { stableId: true } });
  return { courseId: t.courseId, gia, giaHan: gh, bai: bai.stableId, thang };
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

describe.skipIf(!RUN)("[ONL-P2R] gia hạn quyền học Online", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const P = (k: string) => ids[k]!;
  const ctxS = (studentId: string) => ({ params: Promise.resolve({ studentId }) as never });
  const gio = (khoaId: string, studentId: string) => [{ studentId, khoaId }];
  const taoDon = (t: string, d: unknown[]) => taoDonPost(req("POST", "/x", { dong: d }, bearer(t)));
  const xemTruoc = (t: string, d: unknown[]) => xemTruocPost(req("POST", "/x", { dong: d }, bearer(t)));
  const chiTiet = (t: string, oid: string) => chiTietGet(req("GET", "/x", undefined, bearer(t)), { params: Promise.resolve({ orderId: oid }) as never });
  const veTien = (matchKey: string, reference: string, amount: number) => ({ reference, description: `${matchKey} HOC PHI ONLINE`, amount, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" });
  const trangThaiMua = async (t: string, sid: string, courseId: string) => {
    const r = await muaDuocGet(req("GET", "/x", undefined, bearer(t)), ctxS(sid));
    return ((await json(r)).data.muc as Array<{ courseId: string; trangThai: string; gia: number | null }>).find((m) => m.courseId === courseId);
  };
  const capMua = (studentId: string, courseId: string, now = new Date()) => capQuyenHoc(db, { studentId, courseId, loai: "MUA", now, idempotencyKey: `${NS}cap-${studentId}-${courseId}-${now.getTime()}`, reason: "fixture" });
  const traTien = async (orderId: string, soTien: number, ref: string) => {
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } });
    return ingestPayosWebhook(veTien(phieu.matchKey!, ref, soTien), "SEPAY");
  };
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9e00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
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
    await mk("A", "84966980001");
    await mk("B", "84966980002");
    for (const [k, ph] of [["a1", "A"], ["a2", "A"], ["a3", "A"], ["a4", "A"], ["a5", "A"], ["a6", "A"], ["b1", "B"]] as const) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[ph] } as never, select: { id: true } })).id;
    tA = await dn("0966980001", 1);
    tB = await dn("0966980002", 2);
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[ONL-P2R-01] trạng thái mua theo quyền hiện có (+ giá)", async () => {
    const k = await dungKhoa({ gia: 500_000, giaHan: 300_000 });
    const kKhong = await dungKhoa({ giaHan: null });
    const kTron = await dungKhoa({ thang: null, giaHan: null });
    expect(await trangThaiMua(tA, P("sa1"), k.courseId)).toMatchObject({ trangThai: "MUA_DUOC", gia: 500_000 });
    expect((await capMua(P("sa1"), k.courseId)).ok).toBe(true);
    expect(await trangThaiMua(tA, P("sa1"), k.courseId)).toMatchObject({ trangThai: "GIA_HAN_DUOC", gia: 300_000 }); // còn hạn + cho gia hạn ⇒ giá GIA HẠN
    expect((await capMua(P("sa1"), kKhong.courseId)).ok).toBe(true);
    expect(await trangThaiMua(tA, P("sa1"), kKhong.courseId)).toMatchObject({ trangThai: "DANG_HOC_KHONG_GIA_HAN", gia: null });
    expect((await capMua(P("sa1"), kTron.courseId)).ok).toBe(true);
    expect(await trangThaiMua(tA, P("sa1"), kTron.courseId)).toMatchObject({ trangThai: "TRON_DOI", gia: null });
    // hết hạn ⇒ mua lại
    await db.onlEntitlement.update({ where: { studentId_courseId: { studentId: P("sa1"), courseId: k.courseId } }, data: { expiresAt: new Date(Date.now() - 3 * NGAY) } });
    expect(await trangThaiMua(tA, P("sa1"), k.courseId)).toMatchObject({ trangThai: "MUA_LAI_DUOC", gia: 500_000 });
    expect(await trangThaiMua(tA, P("sa2"), k.courseId)).toMatchObject({ trangThai: "MUA_DUOC", gia: 500_000 }); // quyền của con A1 không ảnh hưởng con A2
    // đã THU HỒI (quản trị) ⇒ mua lại mở lại từ mốc thanh toán, giá MUA
    const th = await thuHoiQuyenHoc(db, { studentId: P("sa1"), courseId: kKhong.courseId, reason: "thu hồi thử nghiệm", idempotencyKey: `${NS}thu-hoi-${kKhong.courseId}`, now: new Date() });
    expect(th.ok).toBe(true);
    expect(await trangThaiMua(tA, P("sa1"), kKhong.courseId)).toMatchObject({ trangThai: "MUA_LAI_DUOC", gia: kKhong.gia });
  });

  it("[ONL-P2R-02] đơn gia hạn: giá gia hạn do máy chủ; xem trước = tạo đơn; chưa đổi hạn khi chưa có tiền; bấm đúp ⇒ đơn cũ", async () => {
    const k = await dungKhoa({ gia: 500_000, giaHan: 300_000 });
    expect((await capMua(P("sa2"), k.courseId)).ok).toBe(true);
    const truoc = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: P("sa2"), courseId: k.courseId } }, select: { expiresAt: true, anchorDay: true } });
    const xt = (await json(await xemTruoc(tA, gio(k.courseId, P("sa2"))))).data;
    expect(xt).toMatchObject({ tongTien: 300_000, chiXemTruoc: true });
    expect(xt.dong[0]).toMatchObject({ loaiMua: "GIA_HAN", donGia: 300_000 });
    // [V8.34] `hetHanMoi` = hạn mới nếu thanh toán ngay (CÙNG phép tính của lõi cấp quyền, cộng từ hạn hiện tại); ISO; hơn hạn hiện tại
    const hetHanMong = tinhHanMoi({ ky: { loai: "THANG", soThang: 6 }, now: new Date(), hanHienTai: truoc.expiresAt, anchorDay: truoc.anchorDay }).hetHan;
    expect(typeof xt.dong[0].hetHanMoi).toBe("string");
    expect(new Date(xt.dong[0].hetHanMoi).getTime()).toBe(hetHanMong?.getTime());
    expect(new Date(xt.dong[0].hetHanMoi).getTime()).toBeGreaterThan(truoc.expiresAt!.getTime());
    const r = await taoDon(tA, gio(k.courseId, P("sa2")));
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d).toMatchObject({ daCo: false, tongTien: 300_000 });
    expect(d.dong[0]).toMatchObject({ loaiMua: "GIA_HAN", donGia: 300_000 });
    const sau = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: P("sa2"), courseId: k.courseId } }, select: { expiresAt: true } });
    expect(sau.expiresAt?.getTime()).toBe(truoc.expiresAt?.getTime()); // KHÔNG tự cấp/gia hạn khi chưa xác minh thanh toán
    expect((await json(await taoDon(tA, gio(k.courseId, P("sa2"))))).data).toMatchObject({ daCo: true, orderId: d.orderId });
    expect(await db.order.count({ where: { createdById: P("A"), items: { some: { onlineCourseId: k.courseId, studentId: P("sa2") } } } })).toBe(1);
    expect((await json(await chiTiet(tA, d.orderId))).data.dong[0].trangThai).toBe("DANG_CHO_THANH_TOAN");
  });

  it("[ONL-P2R-03] 🔴 tiền về ⇒ hạn mới do E tính (cộng từ hạn cũ); lịch sử học còn; webhook gửi lại ⇒ không cộng đôi", async () => {
    const k = await dungKhoa({ gia: 500_000, giaHan: 300_000 });
    expect((await capMua(P("sa3"), k.courseId)).ok).toBe(true);
    // tạo lịch sử học THẬT trước khi gia hạn (đọc xong bài READ qua HTTP)
    await db.mobileSession.updateMany({ where: { userId: P("A"), thuHoiLuc: null }, data: { hocSinhId: P("sa3"), hocSinhTuLuc: new Date() } }); // V8.44: ghi tiến độ chỉ do học viên (chế độ học sinh)
    const ht = await tienDoPost(req("POST", `/api/mobile/v1/students/${P("sa3")}/online/courses/${k.courseId}/lessons/${k.bai}/progress`, { daDoc: true }, bearer(tA)), { params: Promise.resolve({ studentId: P("sa3"), courseId: k.courseId, lessonId: k.bai }) as never });
    await db.mobileSession.updateMany({ where: { userId: P("A"), thuHoiLuc: null }, data: { hocSinhId: null, hocSinhTuLuc: null } });
    expect(ht.status, JSON.stringify(await ht.clone().json())).toBe(200);
    const q0 = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: P("sa3"), courseId: k.courseId } }, select: { id: true, expiresAt: true, anchorDay: true } });
    const tienDo0 = await db.onlLessonProgress.findMany({ where: { entitlementId: q0.id }, select: { lessonStableId: true, status: true } });
    expect(tienDo0.length).toBeGreaterThan(0);

    const xtTruoc = (await json(await xemTruoc(tA, gio(k.courseId, P("sa3"))))).data;
    const d = (await json(await taoDon(tA, gio(k.courseId, P("sa3"))))).data;
    const thieu = await traTien(d.orderId, 100_000, `ONP2RA${Date.now()}`);
    expect(thieu.status).toBe("MATCHED");
    expect((await db.onlEntitlement.findUniqueOrThrow({ where: { id: q0.id }, select: { expiresAt: true } })).expiresAt?.getTime()).toBe(q0.expiresAt?.getTime()); // thiếu tiền ⇒ chưa gia hạn
    const ref = `ONP2RB${Date.now()}`;
    expect((await traTien(d.orderId, 200_000, ref)).status).toBe("MATCHED");
    const mong = tinhHanMoi({ ky: { loai: "THANG", soThang: 6 }, now: new Date(), hanHienTai: q0.expiresAt, anchorDay: q0.anchorDay }).hetHan;
    const q1 = await db.onlEntitlement.findUniqueOrThrow({ where: { id: q0.id }, select: { id: true, expiresAt: true } });
    expect(q1.id).toBe(q0.id); // CÙNG dòng quyền (không tạo quyền mới)
    expect(q1.expiresAt?.getTime()).toBe(mong?.getTime());
    expect(q1.expiresAt!.getTime()).toBeGreaterThan(q0.expiresAt!.getTime());
    expect(new Date(xtTruoc.dong[0].hetHanMoi).getTime()).toBe(q1.expiresAt!.getTime()); // [V8.34] hạn XEM TRƯỚC == hạn THẬT sau khi tiền về
    expect((await db.onlLessonProgress.findMany({ where: { entitlementId: q0.id }, select: { lessonStableId: true, status: true } }))).toEqual(tienDo0); // lịch sử học NGUYÊN VẸN
    expect((await json(await chiTiet(tA, d.orderId))).data.dong[0].trangThai).toBe("DA_CAP_QUYEN");
    // làm mới quyền (app gọi lại) thấy hạn mới
    const qd = (await json(await quyenGet(req("GET", "/x", undefined, bearer(tA)), ctxS(P("sa3"))))).data.muc as Array<{ courseId: string; hetHanLuc: string | null }>;
    expect(new Date(qd.find((m) => m.courseId === k.courseId)!.hetHanLuc!).getTime()).toBe(mong?.getTime());
    // webhook GỬI LẠI cùng mã giao dịch + một mã khác dư ⇒ không cộng đôi
    await traTien(d.orderId, 200_000, ref);
    expect((await db.onlEntitlement.findUniqueOrThrow({ where: { id: q0.id }, select: { expiresAt: true } })).expiresAt?.getTime()).toBe(mong?.getTime());
    expect(await db.orderOnlineGrant.count({ where: { orderId: d.orderId, status: "GRANTED" } })).toBe(1);
  });

  it("[ONL-P2R-04] chặn đúng: trọn đời ⇒ 409 DA_TRON_DOI; còn hạn + khoá không cho gia hạn ⇒ 409; con nhà khác ⇒ 404", async () => {
    const kTron = await dungKhoa({ thang: null, giaHan: null });
    const kKhong = await dungKhoa({ giaHan: null });
    expect((await capMua(P("sa4"), kTron.courseId)).ok).toBe(true);
    expect((await capMua(P("sa4"), kKhong.courseId)).ok).toBe(true);
    const truoc = await db.order.count({ where: { createdById: P("A") } });
    expect(await ma(await taoDon(tA, gio(kTron.courseId, P("sa4"))))).toEqual([409, "DA_TRON_DOI"]);
    expect(await ma(await taoDon(tA, gio(kKhong.courseId, P("sa4"))))).toEqual([409, "KHOA_KHONG_CHO_GIA_HAN"]);
    expect(await ma(await xemTruoc(tA, gio(kTron.courseId, P("sa4"))))).toEqual([409, "DA_TRON_DOI"]);
    expect(await ma(await taoDon(tA, gio(kKhong.courseId, P("sb1"))))).toEqual([404, "NOT_FOUND"]); // con nhà B
    expect(await ma(await taoDon(tB, gio(kKhong.courseId, P("sa4"))))).toEqual([404, "NOT_FOUND"]); // PH B + con nhà A
    expect(await db.order.count({ where: { createdById: P("A") } })).toBe(truoc);
  });

  it("[ONL-P2R-05] hết hạn/thu hồi ⇒ mở lại TỪ MỐC thanh toán (không cộng bù); tiến độ cũ còn", async () => {
    const k = await dungKhoa({ gia: 400_000, giaHan: 250_000 });
    expect((await capMua(P("sa5"), k.courseId)).ok).toBe(true);
    await db.mobileSession.updateMany({ where: { userId: P("A"), thuHoiLuc: null }, data: { hocSinhId: P("sa5"), hocSinhTuLuc: new Date() } }); // V8.44: ghi tiến độ chỉ do học viên (chế độ học sinh)
    await tienDoPost(req("POST", `/api/mobile/v1/students/${P("sa5")}/online/courses/${k.courseId}/lessons/${k.bai}/progress`, { daDoc: true }, bearer(tA)), { params: Promise.resolve({ studentId: P("sa5"), courseId: k.courseId, lessonId: k.bai }) as never });
    await db.mobileSession.updateMany({ where: { userId: P("A"), thuHoiLuc: null }, data: { hocSinhId: null, hocSinhTuLuc: null } });
    const q = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: P("sa5"), courseId: k.courseId } }, select: { id: true } });
    const tienDo0 = await db.onlLessonProgress.count({ where: { entitlementId: q.id } });
    await db.onlEntitlement.update({ where: { id: q.id }, data: { expiresAt: new Date(Date.now() - 40 * NGAY) } });
    expect(await trangThaiMua(tA, P("sa5"), k.courseId)).toMatchObject({ trangThai: "MUA_LAI_DUOC", gia: 400_000 }); // hết hạn ⇒ giá MUA, không phải giá gia hạn
    const d = (await json(await taoDon(tA, gio(k.courseId, P("sa5"))))).data;
    expect(d.dong[0]).toMatchObject({ loaiMua: "MUA", donGia: 400_000 });
    const t0 = Date.now();
    expect((await traTien(d.orderId, 400_000, `ONP2RC${Date.now()}`)).status).toBe("MATCHED");
    const q1 = await db.onlEntitlement.findUniqueOrThrow({ where: { id: q.id }, select: { id: true, expiresAt: true } });
    const mong = tinhHanMoi({ ky: { loai: "THANG", soThang: 6 }, now: new Date(t0) }).hetHan!;
    expect(Math.abs(q1.expiresAt!.getTime() - mong.getTime())).toBeLessThan(2 * NGAY); // từ MỐC thanh toán (±2 ngày chênh đồng hồ), không phải hạn cũ (đã quá 40 ngày)
    expect(q1.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 100 * NGAY);
    expect(await db.onlLessonProgress.count({ where: { entitlementId: q.id } })).toBe(tienDo0);
  });

  it("[ONL-P2R-06] song song: hai yêu cầu cùng giỏ gia hạn ⇒ ĐÚNG MỘT đơn", async () => {
    const k = await dungKhoa({ gia: 500_000, giaHan: 300_000 });
    expect((await capMua(P("sa6"), k.courseId)).ok).toBe(true);
    const kq = await Promise.all([taoDon(tA, gio(k.courseId, P("sa6"))), taoDon(tA, gio(k.courseId, P("sa6"))), taoDon(tA, gio(k.courseId, P("sa6")))]);
    expect(kq.map((r) => r.status)).toEqual([200, 200, 200]);
    const ds = await Promise.all(kq.map((r) => json(r)));
    expect(new Set(ds.map((x) => x.data.orderId)).size).toBe(1);
    expect(ds.filter((x) => x.data.daCo === false)).toHaveLength(1);
    expect(await db.order.count({ where: { createdById: P("A"), items: { some: { onlineCourseId: k.courseId, studentId: P("sa6") } } } })).toBe(1);
  });
});
