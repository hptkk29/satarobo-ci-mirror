import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { DELETE as xoaGioDelete, GET as gioGet, PATCH as apMaTatCaPatch } from "@/app/api/mobile/v1/parent/cart/route";
import { POST as datHangPost } from "@/app/api/mobile/v1/parent/cart/checkout/route";
import { POST as huyDonPost } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/cancel/route";
import { DELETE as xoaDongDelete, PATCH as suaDongPatch } from "@/app/api/mobile/v1/parent/cart/items/[itemId]/route";
import { POST as themDongPost } from "@/app/api/mobile/v1/parent/cart/items/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { themDongGio } from "@/lib/online-checkout/gio-hang-luu";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [GL] V8.34 — GIỎ HÀNG ĐÃ LƯU (Commerce v2, vòng 1: ONLINE_COURSE) qua HTTP + Postgres thật.
 *   [GL-01] thêm dòng ⇒ GET giỏ trả giá/hạn do MÁY CHỦ; thân có số tiền/loại lạ ⇒ 400 (strict)
 *   [GL-02] thêm lại cùng (khoá × con) ⇒ dòng cũ (daCo) — không nhân đôi, không đổi revision
 *   [GL-03] 🔴 KHOÁ OFFLINE: id khoá Offline THẬT ở thêm dòng ⇒ 409 LOAI_SAN_PHAM_CHUA_HO_TRO (rõ ràng), id lạ ⇒ 404; không có dòng nào; CẤU TRÚC DB: CartItem không có FK tới Course/CoursePackage/Exam
 *   [GL-04] sở hữu: con nhà khác ⇒ 404; sửa/xoá dòng của giỏ khác ⇒ 404 (không lộ tồn tại)
 *   [GL-05] giỏ không hết hạn; dòng cũ hỏng (khoá ngừng bán) ⇒ KHONG_MUA_DUOC kèm mã; checkout chọn dòng tốt vẫn đặt được, chọn dòng hỏng ⇒ 409
 *   [GL-06] revision: kỳ vọng cũ ⇒ 409 GIO_DA_THAY_DOI kèm giỏ; song song cùng kỳ vọng ⇒ ĐÚNG MỘT thắng
 *   [GL-07] checkout: tạo đúng MỘT đơn ONLINE, xoá ĐÚNG các dòng đã đặt, giữ dòng còn lại, tăng revision; dùng lại revision cũ ⇒ 409
 *   [GL-08] checkout song song cùng giỏ ⇒ ĐÚNG MỘT đơn; bấm đúp tuần tự cùng revision ⇒ trả đơn cũ daCo:true
 *   [GL-16] huỷ đơn `khoiPhucVaoGio:true` ⇒ dòng quay lại giỏ (kèm mã giảm), idempotent, không nhân đôi; không cờ ⇒ hành vi cũ; đơn có tiền ⇒ không khôi phục; đơn người khác ⇒ 404; thân lạ ⇒ 400
 *   [GL-12] checkout lỗi (hồ sơ thiếu) ⇒ KHÔNG xoá dòng nào; [GL-13] «áp mã cho tất cả» (PATCH giỏ) + DTO tổng: tongTien/giamTong/soDongSanSang/soDong; giaDaDoi boolean
 *   [GL-09] mã giảm giá giữ dạng chữ, KHÔNG tiêu lượt; mã lạ ⇒ dòng KHONG_MUA_DUOC MA_KHONG_TON_TAI
 *   [GL-10] cấu trúc loại: học cụ không tồn tại bị từ chối theo sản phẩm (SAN_PHAM_KHONG_TON_TAI; đã đổi từ LOAI_SAN_PHAM_CHUA_HO_TRO ở V8.42); CHECK DB: đúng một FK theo loại, số lượng khoá = 1, trùng cặp bị chỉ mục từng phần chặn
 *   [GL-11] trần 50 dòng/giỏ ⇒ 409 GIO_TOI_DA_DONG
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "glhang-";
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
  const t = await taoKhoa(db, { code: `GLH-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 6, renewalEnabled: true, renewalPrice: 300_000 }, null);
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
  await db.cartItem.deleteMany({ where: { cart: { parentUserId: { in: uids } } } });
  await db.cart.deleteMany({ where: { parentUserId: { in: uids } } });
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
  await db.course.deleteMany({ where: { slug: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

// Làm ấm đủ 5 kết nối của pool TRƯỚC mỗi đợt bắn: pool nguội ⇒ lượt đầu commit xong trước khi các lượt sau mở được kết nối ⇒ «song song» thực ra là nối tiếp và ca không bắt được tranh chấp.
const amPool = () => Promise.all(Array.from({ length: 5 }, () => db.$queryRaw`SELECT pg_sleep(0.05)::text AS x`));

describe.skipIf(!RUN)("[GL] giỏ hàng đã lưu — Commerce v2", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const P = (k: string) => ids[k]!;
  const them = (t: string, body: unknown) => themDongPost(req("POST", "/x", body, bearer(t)));
  const xem = (t: string) => gioGet(req("GET", "/x", undefined, bearer(t)));
  const xoaDong = (t: string, itemId: string, q = "") => xoaDongDelete(req("DELETE", `/x${q}`, undefined, bearer(t)), { params: Promise.resolve({ itemId }) as never });
  const suaDong = (t: string, itemId: string, body: unknown) => suaDongPatch(req("PATCH", "/x", body, bearer(t)), { params: Promise.resolve({ itemId }) as never });
  const datHang = (t: string, body: unknown) => datHangPost(req("POST", "/x", body, bearer(t)));
  const gio = async (t: string) => (await json(await xem(t))).data as { revision: number; dong: Array<{ itemId: string; khoaId: string; studentId: string; trangThai: string; ma?: string; donGia?: number; thanhTien?: number; hetHanMoi?: string | null; maGiamGia?: string | null }>; tongTien: number; giamTong: number; soDongSanSang: number; soDong: number };
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9f00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
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
    await mk("A", "84966990001");
    await mk("B", "84966990002");
    for (const [k, ph] of [["a1", "A"], ["a2", "A"], ["a3", "A"], ["a4", "A"], ["a5", "A"], ["a6", "A"], ["b1", "B"]] as const) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: P(ph) } as never, select: { id: true } })).id;
    tA = await dn("0966990001", 1);
    tB = await dn("0966990002", 2);
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[GL-01] thêm dòng ⇒ giá/hạn do máy chủ; thân có số tiền/loại lạ ⇒ 400", async () => {
    const k = await dungKhoa(500_000);
    const r = await them(tA, { khoaId: k.courseId, studentId: P("sa1") });
    expect(r.status).toBe(200);
    const g = await gio(tA);
    expect(g.dong).toHaveLength(1);
    expect(g.dong[0]).toMatchObject({ khoaId: k.courseId, studentId: P("sa1"), trangThai: "SAN_SANG", donGia: 500_000, thanhTien: 500_000 });
    expect(typeof g.dong[0]!.hetHanMoi).toBe("string");
    for (const thua of [{ donGia: 1 }, { soTien: 1 }, { tongTien: 0 }, { loai: "COURSE_ENROLLMENT" }, { itemType: "PRODUCT" }, { productId: "x" }]) {
      expect(await ma(await them(tA, { khoaId: k.courseId, studentId: P("sa2"), ...thua }))).toEqual([400, expect.anything()]);
    }
    expect((await gio(tA)).dong).toHaveLength(1);
  });

  it("[GL-02] thêm lại cùng (khoá × con) ⇒ dòng cũ, không đổi revision", async () => {
    const k = await dungKhoa();
    const a = (await json(await them(tA, { khoaId: k.courseId, studentId: P("sa3") }))).data;
    const rev = (await gio(tA)).revision;
    const b = (await json(await them(tA, { khoaId: k.courseId, studentId: P("sa3") }))).data;
    expect(b).toMatchObject({ daCo: true, itemId: a.itemId });
    expect((await gio(tA)).revision).toBe(rev);
    expect(await db.cartItem.count({ where: { cart: { parentUserId: P("A") }, onlineCourseId: k.courseId, studentId: P("sa3") } })).toBe(1);
  });

  it("[GL-03] 🔴 khoá OFFLINE giả mạo ⇒ 404; DB: CartItem không có FK tới Course/CoursePackage/Exam", async () => {
    const off = await db.course.create({ data: { name: `${NS}Offline`, slug: `${NS}off-${Date.now()}`, type: "OFFLINE", price: 1_000_000 } as never, select: { id: true } });
    const truoc = await db.cartItem.count({ where: { cart: { parentUserId: P("A") } } });
    expect(await ma(await them(tA, { khoaId: off.id, studentId: P("sa1") }))).toEqual([409, "LOAI_SAN_PHAM_CHUA_HO_TRO"]);
    expect(await ma(await them(tA, { khoaId: "id-khong-co-that", studentId: P("sa1") }))).toEqual([404, "KHOA_KHONG_TON_TAI"]);
    expect(await ma(await datHang(tA, { revision: (await gio(tA)).revision, itemIds: [off.id] }))).toEqual([404, "DONG_KHONG_THUOC_GIO"]); // id Offline đưa vào checkout cũng không có đường
    expect(await db.cartItem.count({ where: { cart: { parentUserId: P("A") } } })).toBe(truoc);
    // CẤU TRÚC: các bảng mà CartItem trỏ tới (FK) — chỉ được là Cart · OnlCourse · Product · Student
    const fk = (await db.$queryRaw<Array<{ bang: string }>>`SELECT DISTINCT ccu.table_name AS bang FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'CartItem'`).map((x) => x.bang).sort();
    expect(fk).toEqual(["Cart", "OnlCourse", "Product", "Student"]);
  });

  it("[GL-04] sở hữu: con nhà khác ⇒ 404; sửa/xoá dòng của giỏ khác ⇒ 404", async () => {
    const k = await dungKhoa();
    expect(await ma(await them(tA, { khoaId: k.courseId, studentId: P("sb1") }))).toEqual([404, "NOT_FOUND"]);
    const d = (await json(await them(tA, { khoaId: k.courseId, studentId: P("sa4") }))).data;
    expect(await ma(await xoaDong(tB, d.itemId))).toEqual([404, "DONG_KHONG_THUOC_GIO"]);
    expect(await ma(await suaDong(tB, d.itemId, { maGiamGia: null }))).toEqual([404, "DONG_KHONG_THUOC_GIO"]);
    expect((await gio(tB)).dong).toHaveLength(0);
    expect((await gio(tA)).dong.some((x) => x.itemId === d.itemId)).toBe(true);
  });

  it("[GL-05] giỏ không hết hạn; khoá ngừng bán ⇒ KHONG_MUA_DUOC; checkout chọn dòng tốt vẫn đặt được, chọn dòng hỏng ⇒ 409", async () => {
    const tot = await dungKhoa(400_000);
    const hong = await dungKhoa(600_000);
    const a = (await json(await them(tA, { khoaId: tot.courseId, studentId: P("sa5") }))).data;
    const b = (await json(await them(tA, { khoaId: hong.courseId, studentId: P("sa5") }))).data;
    await db.$executeRaw`UPDATE "CartItem" SET "createdAt" = now() - interval '400 days', "updatedAt" = now() - interval '400 days' WHERE "id" IN (${a.itemId}, ${b.itemId})`;
    await doiTrangThaiBan(db, { courseId: hong.courseId, saleStatus: "NOT_ON_SALE" });
    const g = await gio(tA);
    expect(g.dong.find((x) => x.itemId === a.itemId)).toMatchObject({ trangThai: "SAN_SANG" }); // giỏ KHÔNG hết hạn theo thời gian
    expect(g.dong.find((x) => x.itemId === b.itemId)).toMatchObject({ trangThai: "KHONG_MUA_DUOC", ma: "KHOA_KHONG_DANG_BAN" });
    expect(await ma(await datHang(tA, { revision: g.revision, itemIds: [b.itemId] }))).toEqual([409, "KHONG_CO_DONG_DE_DAT"]);
    const ok = await datHang(tA, { revision: g.revision, itemIds: [a.itemId] });
    expect(ok.status).toBe(200);
    const sau = await gio(tA);
    expect(sau.dong.some((x) => x.itemId === a.itemId)).toBe(false); // dòng đã đặt biến khỏi giỏ
    expect(sau.dong.some((x) => x.itemId === b.itemId)).toBe(true); // dòng hỏng còn nguyên
  });

  it("[GL-06] revision: kỳ vọng cũ ⇒ 409 kèm giỏ; song song cùng kỳ vọng ⇒ đúng một thắng", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k1 = await dungKhoa();
    const k2 = await dungKhoa();
    const rev0 = (await gio(tA)).revision;
    expect((await them(tA, { khoaId: k1.courseId, studentId: P("sa6"), revision: rev0 })).status).toBe(200);
    const loi = await them(tA, { khoaId: k2.courseId, studentId: P("sa6"), revision: rev0 }); // đã cũ
    expect(loi.status).toBe(409);
    expect((await json(loi)).error?.code).toBe("GIO_DA_THAY_DOI"); // app tự GET lại giỏ — lỗi không mang thân giỏ
    const rev1 = (await gio(tA)).revision;
    const kq = await Promise.all([them(tA, { khoaId: k2.courseId, studentId: P("sa6"), revision: rev1 }), them(tA, { khoaId: k2.courseId, studentId: P("sa1"), revision: rev1 })]);
    expect(kq.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("[GL-07] checkout: một đơn ONLINE, xoá đúng dòng đã đặt, giữ dòng còn lại, tăng revision; revision cũ ⇒ 409", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k1 = await dungKhoa(500_000);
    const k2 = await dungKhoa(700_000);
    const a = (await json(await them(tA, { khoaId: k1.courseId, studentId: P("sa1") }))).data;
    await them(tA, { khoaId: k2.courseId, studentId: P("sa1") });
    const g0 = await gio(tA);
    const r = await datHang(tA, { revision: g0.revision, itemIds: [a.itemId] });
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d).toMatchObject({ daCo: false, tongTien: 500_000 });
    const o = await db.order.findUniqueOrThrow({ where: { id: d.orderId }, select: { type: true, items: { select: { onlineCourseId: true, studentId: true } } } });
    expect(o.type).toBe("ONLINE");
    expect(o.items).toEqual([{ onlineCourseId: k1.courseId, studentId: P("sa1") }]);
    const g1 = await gio(tA);
    expect(g1.dong.map((x) => x.khoaId)).toEqual([k2.courseId]);
    expect(g1.revision).toBeGreaterThan(g0.revision);
    // bấm đúp cùng revision cũ ⇒ phát lại đơn vừa tạo (không 409); revision KHÁC bất kỳ ⇒ 409
    const lai = await datHang(tA, { revision: g0.revision, itemIds: [a.itemId] });
    expect(lai.status).toBe(200);
    expect((await json(lai)).data).toMatchObject({ daCo: true, orderId: d.orderId });
    expect(await ma(await datHang(tA, { revision: g0.revision + 7, itemIds: [a.itemId] }))).toEqual([409, "GIO_DA_THAY_DOI"]);
  });

  it("[GL-08] checkout song song cùng giỏ ⇒ đúng một đơn", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k = await dungKhoa(450_000);
    await them(tA, { khoaId: k.courseId, studentId: P("sa2") });
    const g = await gio(tA);
    const kq = await Promise.all([datHang(tA, { revision: g.revision }), datHang(tA, { revision: g.revision })]);
    expect(kq.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(await db.order.count({ where: { createdById: P("A"), items: { some: { onlineCourseId: k.courseId, studentId: P("sa2") } } } })).toBe(1);
    // bấm đúp TUẦN TỰ cùng revision (dòng đã bị xoá) ⇒ trả lại đơn vừa tạo, không 409, không đơn thứ hai
    const lan2 = await datHang(tA, { revision: g.revision });
    expect(lan2.status).toBe(200);
    const d2 = (await json(lan2)).data;
    expect(d2).toMatchObject({ daCo: true });
    expect(await db.order.count({ where: { createdById: P("A"), items: { some: { onlineCourseId: k.courseId, studentId: P("sa2") } } } })).toBe(1);
  });

  it("[GL-18] phát lại checkout (revision cũ) sau khi đơn đã HUỶ ⇒ 409 DON_DA_HUY, KHÔNG báo «chờ thanh toán» cho đơn đã huỷ; không tạo đơn mới", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k = await dungKhoa(380_000);
    await them(tA, { khoaId: k.courseId, studentId: P("sa1") });
    const g = await gio(tA);
    const dat = await datHang(tA, { revision: g.revision });
    expect(dat.status).toBe(200);
    const orderId = (await json(dat)).data.orderId as string;
    // huỷ KHÔNG khôi phục giỏ ⇒ dấu «checkout cuối» còn nguyên (đúng tình huống B đo trên UAT)
    expect((await huyDonPost(req("POST", "/x", {}, bearer(tA)), { params: Promise.resolve({ orderId }) as never })).status).toBe(200);
    const truoc = await db.order.count({ where: { createdById: P("A"), type: "ONLINE" } });
    expect(await ma(await datHang(tA, { revision: g.revision }))).toEqual([409, "DON_DA_HUY"]);
    expect(await db.order.count({ where: { createdById: P("A"), type: "ONLINE" } })).toBe(truoc);
    // đối chứng DƯƠNG: replay đơn CÒN SỐNG vẫn là 200 daCo:true + CHO_THANH_TOAN
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k2 = await dungKhoa(390_000);
    await them(tA, { khoaId: k2.courseId, studentId: P("sa2") });
    const g2 = await gio(tA);
    const dat2 = await datHang(tA, { revision: g2.revision });
    const lai = await json(await datHang(tA, { revision: g2.revision }));
    expect(lai.data).toMatchObject({ daCo: true, orderId: (await json(dat2.clone())).data.orderId, trangThaiThanhToan: "CHO_THANH_TOAN" });
  });

  it("[GL-09] mã giảm giá giữ dạng chữ, không tiêu lượt; mã lạ ⇒ KHONG_MUA_DUOC MA_KHONG_TON_TAI", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k = await dungKhoa();
    const d = (await json(await them(tA, { khoaId: k.courseId, studentId: P("sa3"), maGiamGia: "KHONG-CO-MA-NAY" }))).data;
    const g = await gio(tA);
    expect(g.dong[0]).toMatchObject({ itemId: d.itemId, maGiamGia: "KHONG-CO-MA-NAY", trangThai: "KHONG_MUA_DUOC", ma: "MA_KHONG_TON_TAI" });
    expect(await db.voucherRedemption.count({ where: { customerPhone: "84966990001" } })).toBe(0);
    expect((await suaDong(tA, d.itemId, { maGiamGia: null })).status).toBe(200);
    expect((await gio(tA)).dong[0]).toMatchObject({ maGiamGia: null, trangThai: "SAN_SANG" });
  });

  it("[GL-10] học cụ không tồn tại bị từ chối theo sản phẩm (không theo loại); CHECK DB: đúng một FK theo loại, khoá SL=1, trùng cặp bị chặn", async () => {
    // V8.42: học cụ ĐÃ được hỗ trợ — dịch vụ không còn từ chối theo LOẠI; chỉ từ chối theo sản phẩm (không tồn tại / không bán Online / hết hàng).
    const r = await themDongGio(db as never, { parentUserId: P("A"), loai: "PHYSICAL_GOOD", productId: "bat-ky", soLuong: 1, now: new Date() } as never);
    expect(r).toMatchObject({ ok: false, ma: "SAN_PHAM_KHONG_TON_TAI" });
    const k = await dungKhoa();
    const cart = await db.cart.findFirstOrThrow({ where: { parentUserId: P("A") }, select: { id: true } });
    const ghi = (data: Record<string, unknown>) => db.cartItem.create({ data: { cartId: cart.id, ...data } as never });
    await expect(ghi({ itemType: "ONLINE_COURSE", onlineCourseId: null, studentId: P("sa1") })).rejects.toThrow(); // thiếu FK của loại
    await expect(ghi({ itemType: "ONLINE_COURSE", onlineCourseId: k.courseId, studentId: P("sa1"), productId: "x" })).rejects.toThrow(); // thừa FK loại khác
    await expect(ghi({ itemType: "ONLINE_COURSE", onlineCourseId: k.courseId, studentId: P("sa1"), quantity: 2 })).rejects.toThrow(); // khoá SL = 1
    await expect(ghi({ itemType: "COURSE_ENROLLMENT", onlineCourseId: k.courseId, studentId: P("sa1") })).rejects.toThrow(); // loại Offline không tồn tại trong CHECK
    await ghi({ itemType: "ONLINE_COURSE", onlineCourseId: k.courseId, studentId: P("sa1") });
    await expect(ghi({ itemType: "ONLINE_COURSE", onlineCourseId: k.courseId, studentId: P("sa1") })).rejects.toThrow(); // chỉ mục từng phần chặn trùng
  });

  it("[GL-12] checkout lỗi (hồ sơ phụ huynh thiếu) ⇒ KHÔNG xoá dòng nào, không tạo đơn", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k = await dungKhoa();
    const d = (await json(await them(tA, { khoaId: k.courseId, studentId: P("sa4") }))).data;
    await db.user.update({ where: { id: P("A") }, data: { name: "" } });
    try {
      const g = await gio(tA);
      const truoc = await db.order.count({ where: { createdById: P("A") } });
      const r = await datHang(tA, { revision: g.revision, itemIds: [d.itemId] });
      expect(r.status).toBe(422);
      expect((await gio(tA)).dong.map((x) => x.itemId)).toContain(d.itemId);
      expect((await gio(tA)).revision).toBe(g.revision); // không đổi revision khi lỗi
      expect(await db.order.count({ where: { createdById: P("A") } })).toBe(truoc);
    } finally {
      await db.user.update({ where: { id: P("A") }, data: { name: "PH A" } });
    }
  });

  it("[GL-13] «áp mã cho tất cả» + DTO tổng + giaDaDoi boolean", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k1 = await dungKhoa(500_000);
    const k2 = await dungKhoa(300_000);
    await them(tA, { khoaId: k1.courseId, studentId: P("sa5") });
    await them(tA, { khoaId: k2.courseId, studentId: P("sa5") });
    const g = await gio(tA);
    expect(g).toMatchObject({ soDong: 2, soDongSanSang: 2, tongTien: 800_000, giamTong: 0 });
    expect(g.dong.every((x) => (x as { giaDaDoi?: unknown }).giaDaDoi === false)).toBe(true);
    // đổi giá khoá sau khi thêm ⇒ giaDaDoi=true, donGiaLucThem giữ giá lúc thêm
    await db.onlCourse.update({ where: { id: k2.courseId }, data: { salePrice: 250_000 } });
    const g2 = await gio(tA);
    const dong2 = g2.dong.find((x) => x.khoaId === k2.courseId) as unknown as { giaDaDoi: boolean; donGiaLucThem: number; donGia: number };
    expect(dong2).toMatchObject({ giaDaDoi: true, donGiaLucThem: 300_000, donGia: 250_000 });
    expect(g2.tongTien).toBe(750_000);
    // áp mã cho tất cả: mã lạ ⇒ mọi dòng KHONG_MUA_DUOC; gỡ mã ⇒ SAN_SANG; tongTien chỉ cộng dòng SAN_SANG
    expect((await apMaTatCaPatch(req("PATCH", "/x", { maGiamGia: "KHONG-CO-MA", revision: g2.revision }, bearer(tA)))).status).toBe(200);
    const g3 = await gio(tA);
    expect(g3.dong.every((x) => x.trangThai === "KHONG_MUA_DUOC" && x.maGiamGia === "KHONG-CO-MA")).toBe(true);
    expect(g3).toMatchObject({ soDongSanSang: 0, tongTien: 0 });
    expect((await apMaTatCaPatch(req("PATCH", "/x", { maGiamGia: null }, bearer(tA)))).status).toBe(200);
    expect((await gio(tA)).soDongSanSang).toBe(2);
    expect((await xoaGioDelete(req("DELETE", "/x", undefined, bearer(tA)))).status).toBe(200);
    expect((await gio(tA)).dong).toHaveLength(0);
  });

  it("[GL-15] dòng có đơn CHƯA thanh toán cùng cặp ⇒ donDangCho báo sớm; không đổi trạng thái; đơn đã huỷ ⇒ null", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k = await dungKhoa(420_000);
    const k2 = await dungKhoa(380_000);
    const d1 = (await json(await them(tA, { khoaId: k.courseId, studentId: P("sa6") }))).data;
    const g0 = await gio(tA);
    const dat = await datHang(tA, { revision: g0.revision });
    expect(dat.status).toBe(200);
    const don1 = (await json(dat)).data;
    // thêm lại đúng cặp vừa đặt (đơn đang chờ thanh toán) + một khoá khác
    await them(tA, { khoaId: k.courseId, studentId: P("sa6") });
    await them(tA, { khoaId: k2.courseId, studentId: P("sa6") });
    const g = await gio(tA);
    const dong = g.dong as unknown as Array<{ khoaId: string; trangThai: string; donDangCho: { orderId: string; orderCode: string } | null }>;
    expect(dong.find((x) => x.khoaId === k.courseId)).toMatchObject({ trangThai: "SAN_SANG", donDangCho: { orderId: don1.orderId, orderCode: don1.orderCode } });
    expect(dong.find((x) => x.khoaId === k2.courseId)).toMatchObject({ donDangCho: null });
    await db.order.update({ where: { id: don1.orderId }, data: { status: "CANCELLED" } });
    expect((await gio(tA)).dong.every((x) => (x as unknown as { donDangCho: unknown }).donDangCho === null)).toBe(true);
    expect(d1.itemId).toBeTruthy();
  });

  it("[GL-16] huỷ đơn khôi phục dòng về giỏ (không xoá giỏ): kèm mã, idempotent, không nhân đôi", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k1 = await dungKhoa(500_000);
    const k2 = await dungKhoa(300_000);
    await them(tA, { khoaId: k1.courseId, studentId: P("sa1") });
    await them(tA, { khoaId: k2.courseId, studentId: P("sa1") });
    const g0 = await gio(tA);
    const dh = await datHang(tA, { revision: g0.revision });
    expect(dh.status).toBe(200);
    const don1 = (await json(dh)).data;
    // mô phỏng đơn đã dùng một mã giảm giá (ảnh chụp khuyến mãi nằm ở metadata dòng đơn)
    const it1 = await db.orderItem.findFirstOrThrow({ where: { orderId: don1.orderId, onlineCourseId: k1.courseId }, select: { id: true, metadata: true } });
    await db.orderItem.update({ where: { id: it1.id }, data: { metadata: { ...((it1.metadata as object) ?? {}), khuyenMai: { ma: "MA-GIU-CHU" } } } });
    expect((await gio(tA)).soDong).toBe(0);
    const huy = (orderId: string, body?: unknown, tok = tA) => huyDonPost(req("POST", "/x", body, bearer(tok)), { params: Promise.resolve({ orderId }) as never });
    // thân lạ ⇒ 400; đơn người khác ⇒ 404
    expect((await huy(don1.orderId, { khoiPhucVaoGio: true, soTien: 1 })).status).toBe(400);
    expect((await huy(don1.orderId, { khoiPhucVaoGio: true }, tB)).status).toBe(404);
    // người dùng đã tự thêm LẠI một dòng (k2) trước khi huỷ ⇒ khôi phục bỏ qua dòng đã có, không lỗi
    await them(tA, { khoaId: k2.courseId, studentId: P("sa1") });
    const truocHuy = await gio(tA);
    // huỷ có cờ ⇒ dòng còn thiếu (k1) quay lại, mã giữ chữ, revision tăng, trả gio
    const r = await huy(don1.orderId, { khoiPhucVaoGio: true });
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d).toMatchObject({ daHuy: true, daHuyTruocDo: false, khoiPhucVaoGio: true, soDongKhoiPhuc: 1 });
    expect(d.gio.soDong).toBe(2);
    expect(d.gio.dong.find((x: { khoaId: string }) => x.khoaId === k1.courseId)).toMatchObject({ maGiamGia: "MA-GIU-CHU", donGiaLucThem: 500_000 });
    expect(d.gio.revision).toBe(truocHuy.revision + 1); // khôi phục tăng revision đúng một bậc
    expect((await db.order.findUniqueOrThrow({ where: { id: don1.orderId }, select: { status: true } })).status).toBe("CANCELLED");
    // huỷ lặp (mạng rớt): KHÔNG nhân đôi; người dùng bỏ một dòng rồi huỷ lặp ⇒ KHÔNG khôi phục lại
    const lap = (await json(await huy(don1.orderId, { khoiPhucVaoGio: true }))).data;
    expect(lap).toMatchObject({ daHuyTruocDo: true, soDongKhoiPhuc: 0 });
    expect(lap.gio.soDong).toBe(2);
    await xoaDong(tA, d.gio.dong[0].itemId);
    expect((await json(await huy(don1.orderId, { khoiPhucVaoGio: true }))).data.gio.soDong).toBe(1);
    // đơn khác, không cờ ⇒ hành vi cũ (không khôi phục, không có gio)
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    await them(tA, { khoaId: k1.courseId, studentId: P("sa3") });
    const dh2 = (await json(await datHang(tA, { revision: (await gio(tA)).revision }))).data;
    const cu = (await json(await huy(dh2.orderId, {}))).data;
    expect(cu).toEqual({ daHuy: true, daHuyTruocDo: false });
    expect((await gio(tA)).soDong).toBe(0);
    // đơn đã có tiền ⇒ không huỷ, không khôi phục
    const k3 = await dungKhoa(200_000);
    await them(tA, { khoaId: k3.courseId, studentId: P("sa2") });
    const dh3 = (await json(await datHang(tA, { revision: (await gio(tA)).revision }))).data;
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId: dh3.orderId }, select: { matchKey: true } });
    const tt = await ingestPayosWebhook({ reference: `GL16-${Date.now()}`, description: `${phieu.matchKey} HOC PHI ONLINE`, amount: 50_000, transactionDateTime: "2026-11-22 12:00:00", accountNumber: "9999000000001" }, "SEPAY");
    expect(tt.status).toBe("MATCHED");
    expect(await ma(await huy(dh3.orderId, { khoiPhucVaoGio: true }))).toEqual([409, "DA_CO_TIEN"]);
    expect((await gio(tA)).soDong).toBe(0);
  });

  it("[GL-11] trần 50 dòng/giỏ ⇒ 409 GIO_TOI_DA_DONG", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k = await dungKhoa();
    const cart = await db.cart.findFirstOrThrow({ where: { parentUserId: P("A") }, select: { id: true } });
    const khac = await dungKhoa();
    const sts = [P("sa1"), P("sa2"), P("sa3"), P("sa4"), P("sa5"), P("sa6")];
    // 50 dòng = (khoá × con) khác nhau: dựng 9 khoá phụ × 6 con (54) rồi cắt còn 50
    const dsKhoa = [k.courseId, khac.courseId];
    for (let i = 0; i < 8; i++) dsKhoa.push((await dungKhoa()).courseId);
    const cap = dsKhoa.flatMap((c) => sts.map((s) => ({ c, s }))).slice(0, 50);
    await db.cartItem.createMany({ data: cap.map((x) => ({ cartId: cart.id, itemType: "ONLINE_COURSE", onlineCourseId: x.c, studentId: x.s })) as never });
    const them51 = dsKhoa.flatMap((c) => sts.map((s) => ({ c, s }))).slice(50)[0]!;
    expect(await ma(await them(tA, { khoaId: them51.c, studentId: them51.s }))).toEqual([409, "GIO_TOI_DA_DONG"]);
  });

  const CGT_N = 6;
  const tomCgt = async (nhan: string, ds: Promise<Response>[]) => {
    const kq = await Promise.all((await Promise.all(ds)).map(async (r) => { const j = await json(r); return { s: r.status, ma: j.error?.code, data: j.data as any }; })); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.info(`${nhan} phản hồi: ${kq.map((x) => `${x.s}${x.ma ? `:${x.ma}` : ""}${x.data?.daCo === true || x.data?.daHuyTruocDo === true || x.data?.trungLap === true ? ":lặp" : ""}`).sort().join(" ")}`);
    return kq;
  };

  it("[CGT-09] thêm dòng giỏ × 6 y hệt song song (giỏ CHƯA tồn tại) ⇒ MỘT giỏ, MỘT dòng; gửi lại cùng `revision` ⇒ 409, không dòng thứ hai", async () => {
    const k = await dungKhoa(300_000);
    // Đua TẠO GIỎ chỉ lộ khi hai lượt cùng thấy «chưa có giỏ» ⇒ bắn NHIỀU VÒNG, mỗi vòng bắt đầu từ chưa có giỏ.
    for (let vong = 1; vong <= 8; vong++) {
      await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("B") } } });
      await db.cart.deleteMany({ where: { parentUserId: P("B") } });
      await amPool();
      const kq = await tomCgt(`[CGT-09a vòng ${vong}]`, Array.from({ length: CGT_N }, () => them(tB, { khoaId: k.courseId, studentId: P("sb1") })));
      expect(kq.map((x) => x.s), `vòng ${vong}`).toEqual(Array(CGT_N).fill(200));
      expect(kq.filter((x) => x.data.daCo === false), `vòng ${vong}`).toHaveLength(1);
      expect(await db.cart.count({ where: { parentUserId: P("B") } })).toBe(1);
      expect(await db.cartItem.count({ where: { cart: { parentUserId: P("B") } } })).toBe(1);
    }
    const k2 = await dungKhoa(300_000);
    const than = { khoaId: k2.courseId, studentId: P("sb1"), revision: (await gio(tB)).revision };
    await amPool();
    const kq2 = await tomCgt("[CGT-09b]", Array.from({ length: CGT_N }, () => them(tB, than)));
    expect(kq2.map((x) => x.s).sort()).toEqual([200, 409, 409, 409, 409, 409]);
    expect(kq2.filter((x) => x.s === 409).map((x) => x.ma)).toEqual(Array(5).fill("GIO_DA_THAY_DOI"));
    expect(await db.cartItem.count({ where: { cart: { parentUserId: P("B") }, onlineCourseId: k2.courseId } })).toBe(1);
  }, 60_000);

  // N = 6 > pool mặc định 5 (`lib/db.ts`): ít hơn không lộ được lỗi giao dịch xin kết nối thứ hai ([GL-08] chỉ chạy 2).
  it("[CGT-11] checkout giỏ CÓ KHOÁ × 6 y hệt song song ⇒ đúng MỘT đơn; gửi lại tuần tự ⇒ đơn cũ", async () => {
    await db.cartItem.deleteMany({ where: { cart: { parentUserId: P("A") } } });
    const k = await dungKhoa(460_000);
    await them(tA, { khoaId: k.courseId, studentId: P("sa4") });
    const than = { revision: (await gio(tA)).revision };
    await amPool();
    const kq = await tomCgt("[CGT-11]", Array.from({ length: CGT_N }, () => datHang(tA, than)));
    const duoc = kq.filter((x) => x.s === 200);
    expect(duoc.length).toBeGreaterThanOrEqual(1);
    expect(new Set(duoc.map((x) => x.data.orderId)).size).toBe(1);
    for (const x of kq.filter((y) => y.s !== 200)) expect([x.s, ["GIO_DA_THAY_DOI", "KHONG_CO_DONG_DE_DAT"].includes(x.ma ?? "")], x.ma).toEqual([409, true]);
    expect(await db.orderItem.count({ where: { onlineCourseId: k.courseId, studentId: P("sa4") } })).toBe(1);
    expect((await json(await datHang(tA, than))).data).toMatchObject({ daCo: true, orderId: duoc[0]!.data.orderId });
    expect(await db.orderItem.count({ where: { onlineCourseId: k.courseId, studentId: P("sa4") } })).toBe(1);
  }, 60_000);
});
