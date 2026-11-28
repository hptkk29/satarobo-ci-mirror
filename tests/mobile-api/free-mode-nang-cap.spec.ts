import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as taoDonPost } from "@/app/api/mobile/v1/parent/online-orders/route";
import { GET as freeModeGet } from "@/app/api/mobile/v1/parent/free-mode/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { GET as mucLucCoPhiGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/outline/route";
import { POST as hsOpenPost } from "@/app/api/mobile/v1/students/[studentId]/online/preview/courses/[slug]/lessons/[lessonId]/open/route";
import { POST as hsProgressPost } from "@/app/api/mobile/v1/students/[studentId]/online/preview/courses/[slug]/lessons/[lessonId]/progress/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { capQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { capQuyenOnlineChoDon } from "@/lib/online-checkout/cap-quyen-sau-thanh-toan";
import { ingestPayosWebhook } from "@/lib/payments/payos-ingest";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [FMN] FREE MODE · F4 — NÂNG CẤP lên khoá TRẢ PHÍ qua đường thanh toán THẬT (đơn Online → webhook → `capQuyenOnlineChoDon` → `capQuyenHoc` của E) — Postgres thật.
 *   [FMN-01] học thử 2 bài → mua khoá ⇒ 2 bài GIỮ nguyên tiến độ ở quyền học thật; không ghi trùng khi webhook/cron lặp; con khác không bị chuyển; KHÔNG lượt thi/điểm
 *   [FMN-02] chuyển tiến độ chỉ khi quyền học THẬT tạo ra từ tiền ĐÃ THU ĐỦ: đơn chưa đủ tiền ⇒ tiến độ học thử NGUYÊN, chưa chuyển
 *   [FMN-03] chuyển tiến độ lỗi ⇒ KHÔNG mất tiền, KHÔNG có quyền nửa vời (đơn chờ thử lại / `LOI_HA_TANG`); sửa xong thử lại ⇒ cấp + chuyển
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "fmn-";
const MK = "Mat-khau-test-2026";
let dem = 0;
let n = 0;
let devN = 0;
const ip = () => `10.99.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const GIA = 500_000;

async function dung() {
  const t = await taoKhoa(db, { code: `CI-FMN-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: GIA, salePrice: GIA, validityMonths: 6, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!c.ok) throw new Error("chuong");
  const b = async (kind: "VIDEO" | "READ", title: string, contentJson: object, extra: object = {}) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind, title, contentJson, ...extra });
    if (!r.ok) throw new Error(r.thongBao);
    return r.stableId;
  };
  const v1 = await b("VIDEO", "Video học thử", { mediaRef: "online/video/fmn/v1.mp4" }, { freePreview: true });
  const r1 = await b("READ", "Đọc học thử", { body: "x" }, { freePreview: true });
  const p1 = await b("READ", "Bài trả phí", { body: "y" });
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" as const } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, new Date());
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  const kh = await db.onlCourse.findUniqueOrThrow({ where: { id: t.courseId }, select: { slug: true } });
  return { courseId: t.courseId, slug: kh.slug, v1, r1, p1 };
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
    await db.receipt.deleteMany({ where: { payment: { orderId: { in: oid } } } });
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

describe.skipIf(!RUN)("[FMN] Free Mode F4: học thử → mua khoá trả phí (đường thanh toán thật)", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  const P = (k: string) => ids[k]!;
  const SU = (s: string) => `/api/mobile/v1/students/${s}/online/preview`;
  const cs = (studentId: string, slug: string, lessonId?: string) => ({ params: Promise.resolve({ studentId, slug, lessonId }) as never });
  const mo = (t: string, s: string, slug: string, l: string) => hsOpenPost(req("POST", `${SU(s)}/courses/${slug}/lessons/${l}/open`, {}, bearer(t)), cs(s, slug, l));
  const td = (t: string, s: string, slug: string, l: string, than: unknown) => hsProgressPost(req("POST", `${SU(s)}/courses/${slug}/lessons/${l}/progress`, than, bearer(t)), cs(s, slug, l));
  const dang = async (sdt: string) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9d00-${String(++devN).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const jr = await json(r);
    if (!jr.data) throw new Error(`đăng nhập thất bại: ${JSON.stringify(jr.error)}`);
    const t = (jr.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  const phienHocSinh = async (sdt: string, s: string) => {
    await db.mobileSession.deleteMany({ where: { userId: P("A"), hocSinhId: { not: null } } });
    const t = await dang(sdt);
    await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(t)));
    expect((await enterPost(req("POST", "/x", { studentId: s }, bearer(t)))).status).toBe(200);
    return t;
  };
  const taoDon = async (khoaId: string, studentId: string) => {
    const r = await taoDonPost(req("POST", "/x", { dong: [{ studentId, khoaId }] }, bearer(tA)));
    expect(r.status).toBe(200);
    return (await json(r)).data as { orderId: string };
  };
  const traTien = async (orderId: string, soTien: number, ref: string) => {
    const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId }, select: { matchKey: true } });
    return ingestPayosWebhook({ reference: ref, description: `${phieu.matchKey} HOC PHI ONLINE`, amount: soTien, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" }, "SEPAY");
  };
  /** Học thử: học viên mở + ghi tiến độ cho từng bài. */
  const hocThu = async (sdt: string, s: string, k: { slug: string; v1: string; r1: string }, percent: number) => {
    const hs = await phienHocSinh(sdt, s);
    await mo(hs, s, k.slug, k.v1);
    await td(hs, s, k.slug, k.v1, { percent });
    await mo(hs, s, k.slug, k.r1);
    await td(hs, s, k.slug, k.r1, { daDoc: true });
  };
  const dongCoPhi = (sid: string, cid: string) => db.onlLessonProgress.findMany({ where: { entitlement: { studentId: sid, courseId: cid } }, select: { lessonStableId: true, status: true, percent: true }, orderBy: { lessonStableId: "asc" } });

  beforeEach(async () => {
    await don();
    const hash = await bcrypt.hash(MK, 4);
    ids.A = (await db.user.create({ data: { email: `${NS}A@seed.invalid`, name: "PH A", phone: "84966991001", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    for (const k of ["c1", "c2"]) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids.A, currentGrade: 4 } as never, select: { id: true } })).id;
    tA = await dang("0966991001");
  }, 180_000);
  beforeAll(() => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    process.env.LOGIN_RATELIMIT_DISABLED = "1";
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
  });
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
    delete process.env.LOGIN_RATELIMIT_DISABLED;
  }, 180_000);

  it("[FMN-01] 🔴 học thử 2 bài → mua khoá THẬT ⇒ tiến độ được GIỮ (đúng học viên, đúng bài), không ghi trùng khi webhook/cron lặp, con khác không bị chuyển, KHÔNG lượt thi/điểm", async () => {
    const k = await dung();
    await hocThu("0966991001", P("sc1"), k, 95); // c1: video xong + đọc xong
    await hocThu("0966991001", P("sc2"), k, 40); // c2: video 40% + đọc xong
    expect(await db.onlEntitlement.count()).toBe(0); // học thử KHÔNG tạo quyền
    const d = await taoDon(k.courseId, P("sc1"));
    expect((await traTien(d.orderId, GIA, `FMN-A-${Date.now()}`)).status).toBe("MATCHED");
    const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: P("sc1"), courseId: k.courseId } });
    expect(q).toMatchObject({ source: "PURCHASE", status: "ACTIVE" });
    expect(await dongCoPhi(P("sc1"), k.courseId)).toEqual([
      { lessonStableId: k.r1, status: "COMPLETED", percent: 100 },
      { lessonStableId: k.v1, status: "COMPLETED", percent: 95 },
    ].sort((a, b) => a.lessonStableId.localeCompare(b.lessonStableId)));
    expect(await db.onlAttempt.count({ where: { entitlement: { studentId: P("sc1") } } })).toBe(0);
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1"), transferredEntitlementId: q.id } })).toBe(2);
    // c2 (chưa mua) KHÔNG bị chuyển, vẫn là tiến độ học thử
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc2"), transferredEntitlementId: null } })).toBe(2);
    expect(await db.onlEntitlement.count({ where: { studentId: P("sc2") } })).toBe(0);
    expect(await db.onlLessonProgress.count({ where: { entitlement: { studentId: P("sc2") } } })).toBe(0);
    // đường HTTP có phí thấy đúng tiến độ đã giữ
    const ml = await json(await mucLucCoPhiGet(req("GET", "/x", undefined, bearer(tA)), { params: Promise.resolve({ studentId: P("sc1"), courseId: k.courseId }) as never }));
    const theoBai = Object.fromEntries((ml.data.bai as Array<{ lessonId: string; trangThai: string; phanTram: number }>).map((b) => [b.lessonId, [b.trangThai, b.phanTram]]));
    expect(theoBai[k.v1]).toEqual(["COMPLETED", 95]);
    expect(theoBai[k.r1]).toEqual(["COMPLETED", 100]);
    expect(theoBai[k.p1]?.[0]).not.toBe("COMPLETED");
    // KHÔNG ghi trùng: webhook lặp + cron/đối soát chạy lại + cấp lại cùng khoá
    const truoc = { tien: await db.onlLessonProgress.count(), su: await db.onlEntitlementEvent.count(), free: await db.onlFreeLessonProgress.count({ where: { transferredAt: { not: null } } }) };
    await traTien(d.orderId, GIA, `FMN-A-${Date.now()}-lap`).catch(() => undefined);
    await capQuyenOnlineChoDon(db, d.orderId, new Date());
    await capQuyenOnlineChoDon(db, d.orderId, new Date());
    expect({ tien: await db.onlLessonProgress.count(), su: await db.onlEntitlementEvent.count(), free: await db.onlFreeLessonProgress.count({ where: { transferredAt: { not: null } } }) }).toEqual(truoc);
    // sau nâng cấp: mở bài học thử ở khu miễn phí ⇒ chỉ đường sang khu có phí, không ghi thêm tiến độ học thử
    const hs = await phienHocSinh("0966991001", P("sc1"));
    const r = await mo(hs, P("sc1"), k.slug, k.v1);
    expect([r.status, (await json(r)).error?.code]).toEqual([409, "DA_CO_QUYEN_HOC"]);
    // trạng thái Free của tài khoản: c1 có 1 quyền trả phí; gợi ý nâng cấp còn cho c2 (đã học thử, chưa mua)
    const fm = (await json(await freeModeGet(req("GET", "/x", undefined, bearer(tA))))).data;
    const h1 = fm.hocVien.find((h: { id: string }) => h.id === P("sc1"));
    expect(h1.quyenOnline).toEqual({ traPhi: 1, mienPhiTuNhan: 0 });
    expect(fm.goiYNangCap.map((g: { studentId: string; slug: string }) => [g.studentId, g.slug])).toEqual([[P("sc2"), k.slug]]);
  });

  it("[FMN-02] chưa thu đủ tiền ⇒ KHÔNG có quyền thật, tiến độ học thử NGUYÊN (chưa chuyển); không cấp từ tín hiệu client", async () => {
    const k = await dung();
    await hocThu("0966991001", P("sc1"), k, 95);
    const d = await taoDon(k.courseId, P("sc1"));
    expect((await traTien(d.orderId, GIA / 5, `FMN-B-${Date.now()}`)).status).toBe("MATCHED"); // thu một phần
    expect(await db.onlEntitlement.count({ where: { studentId: P("sc1") } })).toBe(0);
    expect(await db.onlLessonProgress.count()).toBe(0);
    expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1"), transferredEntitlementId: null } })).toBe(2);
    await capQuyenOnlineChoDon(db, d.orderId, new Date());
    expect(await db.onlEntitlement.count({ where: { studentId: P("sc1") } })).toBe(0); // cron cũng không cấp khi chưa đủ tiền
    expect((await traTien(d.orderId, GIA - GIA / 5, `FMN-B2-${Date.now()}`)).status).toBe("MATCHED"); // đủ tiền
    expect(await db.onlEntitlement.count({ where: { studentId: P("sc1") } })).toBe(1);
    expect(await db.onlLessonProgress.count()).toBe(2);
  });

  it("[FMN-03] 🔴 chuyển tiến độ LỖI ⇒ tiền vẫn ghi sổ, quyền KHÔNG nửa vời (đơn chờ thử lại, LOI_HA_TANG); gỡ lỗi + thử lại ⇒ cấp + chuyển đủ", async () => {
    const k = await dung();
    await hocThu("0966991001", P("sc1"), k, 95);
    const d = await taoDon(k.courseId, P("sc1"));
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fmn_chan_chuyen() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fmn: chuyen tien do loi gia'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fmn_chan_chuyen_trg BEFORE INSERT ON "OnlLessonProgress" FOR EACH ROW EXECUTE FUNCTION fmn_chan_chuyen()`);
    try {
      await traTien(d.orderId, GIA, `FMN-C-${Date.now()}`);
      // tiền ĐÃ vào sổ dù cấp quyền hỏng
      expect((await db.payment.findMany({ where: { orderId: d.orderId } })).reduce((s, p) => s + p.amount, 0)).toBe(GIA);
      // quyền KHÔNG được tạo nửa chừng (giao dịch của E rollback cả cấp lẫn chuyển)
      expect(await db.onlEntitlement.count({ where: { studentId: P("sc1") } })).toBe(0);
      expect(await db.onlFreeLessonProgress.count({ where: { studentId: P("sc1"), transferredEntitlementId: null } })).toBe(2); // tiến độ học thử còn nguyên
      const g = await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: d.orderId } });
      expect(g.status).toBe("PENDING");
      expect(g.lastErrorCode).toBe("LOI_HA_TANG");
      expect(g.nextRetryAt).toBeTruthy();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fmn_chan_chuyen_trg ON "OnlLessonProgress"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fmn_chan_chuyen()`);
    }
    await capQuyenOnlineChoDon(db, d.orderId, new Date(Date.now() + 3600_000)); // thử lại thật
    expect(await db.onlEntitlement.count({ where: { studentId: P("sc1") } })).toBe(1);
    expect(await db.onlLessonProgress.count()).toBe(2);
    expect((await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: d.orderId } })).status).toBe("GRANTED");
  });

  it("[FMN-04] gia hạn khi quyền còn hạn KHÔNG chuyển lại; mở lại sau hết hạn chỉ chuyển dòng CHƯA chuyển (không ghi trùng, không hạ tiến độ)", async () => {
    const k = await dung();
    await hocThu("0966991001", P("sc1"), k, 95);
    const c = await capQuyenHoc(db, { studentId: P("sc1"), courseId: k.courseId, loai: "CAP_MIEN_PHI", idempotencyKey: `${NS}cap-${Date.now()}`, now: new Date() });
    if (!c.ok) throw new Error(c.thongBao);
    expect(await db.onlLessonProgress.count()).toBe(2);
    const daChuyen = await db.onlFreeLessonProgress.findMany({ where: { studentId: P("sc1") }, select: { id: true, transferredAt: true, transferredEntitlementId: true }, orderBy: { id: "asc" } });
    expect(daChuyen.every((x) => x.transferredAt && x.transferredEntitlementId === c.entitlementId)).toBe(true);
    // người học tiến thêm ở khu có phí, rồi quyền hết hạn và được MỞ LẠI
    await db.onlLessonProgress.updateMany({ where: { entitlement: { studentId: P("sc1") } }, data: { percent: 100 } });
    await db.onlEntitlement.update({ where: { id: c.entitlementId }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
    const lai = await capQuyenHoc(db, { studentId: P("sc1"), courseId: k.courseId, loai: "CAP_MIEN_PHI", idempotencyKey: `${NS}cap2-${Date.now()}`, now: new Date() });
    expect(lai.ok && lai.hanhDong).toBe("MO_LAI_SAU_HET_HAN");
    const dong = await dongCoPhi(P("sc1"), k.courseId);
    expect(dong).toHaveLength(2); // không thêm dòng trùng
    expect(dong.every((x) => x.percent === 100)).toBe(true); // không bị đè xuống 95 bởi dòng học thử cũ (đã đánh dấu chuyển)
    // dòng học thử ĐÃ chuyển không bị chuyển lần nữa (mốc chuyển giữ nguyên) — mở lại chỉ chạm dòng CHƯA chuyển
    expect(await db.onlFreeLessonProgress.findMany({ where: { studentId: P("sc1") }, select: { id: true, transferredAt: true, transferredEntitlementId: true }, orderBy: { id: "asc" } })).toEqual(daChuyen);
  });
});
