import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { GET as areasGet } from "@/app/api/mobile/v1/students/[studentId]/learning/areas/route";
import { GET as chiTietGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/route";
import { GET as baiGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/route";
import { GET as mucLucGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/outline/route";
import { GET as dsGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/route";
import { GET as chungNhanGet } from "@/app/api/mobile/v1/students/[studentId]/online/certificates/route";
import { capChungNhanTay } from "@/lib/elearning-online/chung-nhan";
import { GET as quyenGet } from "@/app/api/mobile/v1/students/[studentId]/online/entitlements/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { ghiTienDoBai } from "@/lib/elearning-online/hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { moBanNhap, themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { taoHocVienChiOnline } from "@/lib/online-checkout/hoc-vien-chi-online";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [ONL-P0] V8.9 — ONLINE P0 qua HTTP route-handler + Postgres thật (lõi E-learning NGUYÊN VẸN, không engine thứ hai):
 *   [ONL-P0-01] cờ ELEARNING_ONLINE_ENABLED tắt ⇒ 404 mọi route Online + areas.online CHUA_MO; bật ⇒ 200
 *   [ONL-P0-02] danh sách theo TỪNG con: con có quyền thấy khoá; con không quyền ⇒ rỗng; con nhà khác ⇒ 404; thu hồi ⇒ biến; hết hạn ⇒ vẫn hiện HET_HAN
 *   [ONL-P0-03] chi tiết: có ⇒ 200; không quyền/thu hồi ⇒ 404; nhà khác ⇒ 404
 *   [ONL-P0-04] mục lục: hết hạn (D23) ⇒ 200 chỉ-đọc `hetHan:true`, mọi bài khoá (lyDoChuaMo HET_HAN), tiến độ giữ nguyên, mở bài vẫn 403; thu hồi ⇒ 403 DA_THU_HOI; không quyền ⇒ 403 KHONG_CO_QUYEN; không có nội dung bài
 *   [ONL-P0-05] ★ MỐC: học viên CÓ quyền mở được bài hợp lệ (thân bài); thu hồi ⇒ chặn; hết hạn ⇒ chặn; không xem lại bài đã hoàn thành ⇒ 403; không lộ khoá media/đề
 *   [ONL-P0-06] làm mới quyền: cấp ⇒ xuất hiện; thu hồi ⇒ biến; no-store
 *   [ONL-P0-07] chế độ học sinh: đúng con ⇒ 200 (areas/list/outline/bài); con anh/chị/em ⇒ 403; mọi phản hồi no-store
 *   [ONL-P0-09] V8.12 DTO bổ sung (soBan, batDauLuc) + chứng nhận của con
 *   [ONL-P0-08] học viên CHỈ-ONLINE (mã SR, centerId NULL): phụ huynh thấy khoá của con đó; hai hệ quyền tách bạch (offline có lớp / online có khoá / cả hai / không có)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "onlp0-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const MOC = new Date();
const sau = (ngay: number, base = MOC) => new Date(base.getTime() + ngay * 86_400_000);
let n = 0;
const key = (t: string) => `${NS}${t}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function dungKhoa(o: { khongXemLai?: boolean; thang?: number | null; moHet?: boolean } = {}) {
  const t = await taoKhoa(db, { code: `ONLP0-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: 400_000, salePrice: 400_000, validityMonths: o.thang === undefined ? 6 : o.thang, renewalEnabled: true }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const b1 = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B1", contentJson: { body: "nội dung bài 1" } });
  const b2 = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B2", contentJson: { body: "nội dung bài 2" } });
  const bv = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "VIDEO", title: "V1", contentJson: { mediaRef: "online/video/t/video-1.mp4" } });
  if (!b1.ok || !b2.ok || !bv.ok) throw new Error("bai");
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET", khongChoXemLaiBaiDaQua: o.khongXemLai ?? false } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, MOC);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, b1: b1.stableId, b2: b2.stableId, video: bv.stableId };
}
const cap = async (studentId: string, courseId: string, now = MOC) => {
  const r = await capQuyenHoc(db, { studentId, courseId, loai: "CAP_MIEN_PHI", now, idempotencyKey: key("cap") });
  if (!r.ok) throw new Error(r.thongBao);
  return r;
};

async function don() {
  await donBangOnl(db);
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[ONL-P0] Online P0 qua HTTP + Postgres thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const P = (k: string) => ids[k]!;
  const ctx = (studentId: string, courseId?: string, lessonId?: string) => ({ params: Promise.resolve({ studentId, courseId, lessonId }) as never });
  const base = (sv: string) => `/api/mobile/v1/students/${sv}`;
  const ds = (tok: string, sv: string) => dsGet(req("GET", `${base(sv)}/online/courses`, undefined, bearer(tok)), ctx(sv));
  const ct = (tok: string, sv: string, c: string) => chiTietGet(req("GET", `${base(sv)}/online/courses/${c}`, undefined, bearer(tok)), ctx(sv, c));
  const ml = (tok: string, sv: string, c: string) => mucLucGet(req("GET", `${base(sv)}/online/courses/${c}/outline`, undefined, bearer(tok)), ctx(sv, c));
  const bai = (tok: string, sv: string, c: string, l: string) => baiGet(req("GET", `${base(sv)}/online/courses/${c}/lessons/${l}`, undefined, bearer(tok)), ctx(sv, c, l));
  const qy = (tok: string, sv: string) => quyenGet(req("GET", `${base(sv)}/online/entitlements`, undefined, bearer(tok)), ctx(sv));
  const kv = (tok: string, sv: string) => areasGet(req("GET", `${base(sv)}/learning/areas`, undefined, bearer(tok)), ctx(sv));

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966910001");
    await mk("B", "84966910002");
    await db.center.create({ data: { id: `${NS}cs`, name: "Cơ sở ONLP0", slug: `${NS}cs`, address: "Địa chỉ" } });
    await db.course.create({ data: { id: `${NS}kh`, name: "Khoá offline", slug: `${NS}kh`, totalSessions: 12 } });
    await db.class.create({ data: { id: `${NS}l1`, name: "Lớp", classCode: `${NS}l1`, courseId: `${NS}kh`, centerId: `${NS}cs`, status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    // A có 4 con: ON (chỉ online), OFF (chỉ offline), CA (cả hai), KHONG (không quyền nào). B có 1 con.
    for (const [k, ph] of [["ON", "A"], ["OFF", "A"], ["CA", "A"], ["KHONG", "A"], ["B1", "B"]] as const) {
      ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[ph], centerId: `${NS}cs` } as never, select: { id: true } })).id;
    }
    for (const k of ["OFF", "CA"]) await db.enrollment.create({ data: { id: `${NS}dk${k}`, studentId: P(`s${k}`), classId: `${NS}l1`, courseId: `${NS}kh`, status: "ACTIVE", centerId: `${NS}cs` } as never });
    const dn = async (sdt: string, nn: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9f00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966910001", 1);
    tB = await dn("0966910002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[ONL-P0-01] cờ tắt ⇒ 404 mọi route Online + areas.online CHUA_MO; bật ⇒ 200", async () => {
    const k = await dungKhoa();
    await cap(P("sON"), k.courseId);
    process.env.ELEARNING_ONLINE_ENABLED = "false";
    try {
      for (const r of [await ds(tA, P("sON")), await ct(tA, P("sON"), k.courseId), await ml(tA, P("sON"), k.courseId), await bai(tA, P("sON"), k.courseId, k.b1), await qy(tA, P("sON"))]) expect(await ma(r)).toEqual([404, "NOT_FOUND"]);
      expect((await json(await kv(tA, P("sON")))).data.online).toMatchObject({ trangThai: "CHUA_MO" }); // đối chứng: khu học tập vẫn trả, chỉ online đóng
    } finally {
      process.env.ELEARNING_ONLINE_ENABLED = "true";
    }
    expect((await ds(tA, P("sON"))).status).toBe(200);
  });

  it("[ONL-P0-02] danh sách theo từng con; nhà khác 404; thu hồi biến; hết hạn vẫn hiện", async () => {
    const k = await dungKhoa();
    await cap(P("sON"), k.courseId);
    const r = await ds(tA, P("sON"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await json(r)).data;
    expect(d.muc.map((m: { courseId: string }) => m.courseId)).toContain(k.courseId); // (con ON đã có khoá từ ca 01)
    expect(d.muc.find((m: { courseId: string }) => m.courseId === k.courseId)).toMatchObject({ trangThaiQuyen: "CON_HAN", choPhepGiaHan: true });
    expect(JSON.stringify(d)).not.toMatch(/mediaRef|online\/video|assessmentId|contentJson/);
    expect((await json(await ds(tA, P("sKHONG")))).data.muc).toEqual([]); // con không quyền ⇒ rỗng (200)
    expect(await ma(await ds(tB, P("sON")))).toEqual([404, "NOT_FOUND"]); // nhà khác
    expect(await ma(await ds(tA, P("sB1")))).toEqual([404, "NOT_FOUND"]); // con của nhà khác
    // hết hạn: cấp với mốc quá khứ, hạn 1 tháng ⇒ đã hết hạn ở thời điểm thật
    const kh = await dungKhoa({ thang: 1 });
    await cap(P("sON"), kh.courseId, sau(-90));
    const het = (await json(await ds(tA, P("sON")))).data.muc.find((m: { courseId: string }) => m.courseId === kh.courseId);
    expect(het).toMatchObject({ trangThaiQuyen: "HET_HAN" });
    // thu hồi ⇒ biến
    await thuHoiQuyenHoc(db, { studentId: P("sON"), courseId: k.courseId, reason: "thu hồi thử nghiệm P0", idempotencyKey: key("thu"), now: MOC });
    expect((await json(await ds(tA, P("sON")))).data.muc.map((m: { courseId: string }) => m.courseId)).not.toContain(k.courseId);
  });

  it("[ONL-P0-03] chi tiết: có ⇒ 200; không quyền / thu hồi / nhà khác ⇒ 404", async () => {
    const k = await dungKhoa();
    await cap(P("sON"), k.courseId);
    const r = await ct(tA, P("sON"), k.courseId);
    expect(r.status).toBe(200);
    expect((await json(r)).data).toMatchObject({ courseId: k.courseId, trangThaiQuyen: "CON_HAN" });
    expect(await ma(await ct(tA, P("sKHONG"), k.courseId))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await ct(tB, P("sON"), k.courseId))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await ct(tA, P("sON"), "x".repeat(150)))).toEqual([404, "NOT_FOUND"]);
    await thuHoiQuyenHoc(db, { studentId: P("sON"), courseId: k.courseId, reason: "thu hồi thử nghiệm chi tiết", idempotencyKey: key("thu"), now: MOC });
    expect(await ma(await ct(tA, P("sON"), k.courseId))).toEqual([404, "NOT_FOUND"]);
  });

  it("[ONL-P0-04] mục lục: hết hạn (D23) ⇒ 200 chỉ-đọc hetHan, không bài nào mở; thu hồi ⇒ 403 DA_THU_HOI; không quyền ⇒ 403; không nội dung bài", async () => {
    const k = await dungKhoa();
    await cap(P("sON"), k.courseId);
    const r = await ml(tA, P("sON"), k.courseId);
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d.bai.map((b: { lessonId: string }) => b.lessonId).sort()).toEqual([k.b1, k.b2, k.video].sort());
    expect(d.hetHan).toBe(false); // đối chứng cho nhánh hết hạn bên dưới: còn hạn ⇒ hetHan false, bài mở được
    expect(d.bai.every((b: { mo: boolean }) => b.mo)).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/nội dung bài|mediaRef|online\/video/); // mục lục KHÔNG chứa nội dung
    expect(await ma(await ml(tA, P("sKHONG"), k.courseId))).toEqual([403, "KHONG_CO_QUYEN"]);
    expect(await ma(await ml(tB, P("sON"), k.courseId))).toEqual([404, "NOT_FOUND"]);
    const kh = await dungKhoa({ thang: 1 });
    await cap(P("sCA"), kh.courseId, sau(-90));
    // học xong bài 1 KHI CÒN HẠN ⇒ sau hết hạn lịch sử còn nguyên nhưng bài đã xong cũng không mở
    expect((await ghiTienDoBai(db, { parentUserId: P("A"), studentId: P("sCA"), courseId: kh.courseId, lessonStableId: kh.b1, daDoc: true, now: sau(-89) })).ok).toBe(true);
    const rh = await ml(tA, P("sCA"), kh.courseId);
    expect(rh.status).toBe(200);
    expect(rh.headers.get("cache-control")).toBe("no-store");
    const dh = (await json(rh)).data;
    expect(dh.hetHan).toBe(true);
    expect(dh.bai.map((b: { lessonId: string }) => b.lessonId).sort()).toEqual([kh.b1, kh.b2, kh.video].sort());
    expect(dh.bai.map((b: { mo: boolean; lyDoChuaMo: unknown }) => [b.mo, b.lyDoChuaMo])).toEqual([[false, "HET_HAN"], [false, "HET_HAN"], [false, "HET_HAN"]]);
    expect(dh.bai.find((b: { lessonId: string }) => b.lessonId === kh.b1)).toMatchObject({ trangThai: "COMPLETED", phanTram: 100 });
    expect(JSON.stringify(dh)).not.toMatch(/nội dung bài|mediaRef|online\/video|assessmentId|contentJson/);
    expect(await ma(await bai(tA, P("sCA"), kh.courseId, kh.b1))).toEqual([403, "HET_HAN"]); // nới mục lục KHÔNG nới nội dung
    expect(await ma(await ml(tB, P("sCA"), kh.courseId))).toEqual([404, "NOT_FOUND"]); // hết hạn không bỏ cổng sở hữu
    await thuHoiQuyenHoc(db, { studentId: P("sON"), courseId: k.courseId, reason: "thu hồi thử nghiệm mục lục", idempotencyKey: key("thu"), now: MOC });
    expect(await ma(await ml(tA, P("sON"), k.courseId))).toEqual([403, "DA_THU_HOI"]);
  });

  it("[ONL-P0-05] ★ MỐC: có quyền mở được bài; thu hồi / hết hạn / không quyền / nhà khác bị chặn; không xem lại bài đã hoàn thành; không lộ media/đề", async () => {
    const k = await dungKhoa({ khongXemLai: true });
    await cap(P("sON"), k.courseId);
    const r = await bai(tA, P("sON"), k.courseId, k.b1);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await json(r)).data;
    expect(d.soBan).toBeGreaterThanOrEqual(1);
    expect(d.bai).toMatchObject({ kind: "READ", body: "nội dung bài 1" });
    const v = (await json(await bai(tA, P("sON"), k.courseId, k.video))).data;
    expect(v.bai).toMatchObject({ kind: "VIDEO", coVideo: true });
    expect(JSON.stringify(v)).not.toMatch(/mediaRef|online\/video|\.mp4/); // KHÔNG khoá media
    expect(await ma(await bai(tA, P("sON"), k.courseId, "bai-khong-co"))).toEqual([404, "BAI_KHONG_TON_TAI"]);
    expect(await ma(await bai(tA, P("sKHONG"), k.courseId, k.b1))).toEqual([403, "KHONG_CO_QUYEN"]);
    expect(await ma(await bai(tB, P("sON"), k.courseId, k.b1))).toEqual([404, "NOT_FOUND"]); // PH khác, đối chứng dương ở trên
    // hoàn thành bài ⇒ không xem lại (cấu hình bật)
    const gt = await ghiTienDoBai(db, { parentUserId: P("A"), studentId: P("sON"), courseId: k.courseId, lessonStableId: k.b1, daDoc: true, now: MOC });
    expect(gt.ok).toBe(true);
    expect(await ma(await bai(tA, P("sON"), k.courseId, k.b1))).toEqual([403, "DA_HOAN_THANH_KHONG_XEM_LAI"]);
    expect((await bai(tA, P("sON"), k.courseId, k.b2)).status).toBe(200); // bài khác vẫn mở
    // hết hạn
    const kh = await dungKhoa({ thang: 1 });
    await cap(P("sCA"), kh.courseId, sau(-90));
    expect(await ma(await bai(tA, P("sCA"), kh.courseId, kh.b1))).toEqual([403, "HET_HAN"]);
    // thu hồi ⇒ chặn NGAY (đối chứng dương: trước thu hồi mở được)
    expect((await bai(tA, P("sON"), k.courseId, k.b2)).status).toBe(200);
    await thuHoiQuyenHoc(db, { studentId: P("sON"), courseId: k.courseId, reason: "thu hồi thử nghiệm MỐC", idempotencyKey: key("thu"), now: MOC });
    expect(await ma(await bai(tA, P("sON"), k.courseId, k.b2))).toEqual([403, "DA_THU_HOI"]);
  });

  it("[ONL-P0-06] làm mới quyền: cấp ⇒ xuất hiện; thu hồi ⇒ biến; no-store", async () => {
    const k = await dungKhoa();
    const truoc = await qy(tA, P("sKHONG"));
    expect(truoc.headers.get("cache-control")).toBe("no-store");
    expect((await json(truoc)).data.muc).toEqual([]);
    await cap(P("sKHONG"), k.courseId);
    expect((await json(await qy(tA, P("sKHONG")))).data.muc.map((m: { courseId: string }) => m.courseId)).toEqual([k.courseId]);
    await thuHoiQuyenHoc(db, { studentId: P("sKHONG"), courseId: k.courseId, reason: "thu hồi thử nghiệm làm mới", idempotencyKey: key("thu"), now: MOC });
    expect((await json(await qy(tA, P("sKHONG")))).data.muc).toEqual([]);
    expect(await ma(await qy(tB, P("sKHONG")))).toEqual([404, "NOT_FOUND"]);
  });

  it("[ONL-P0-07] chế độ học sinh: đúng con ⇒ 200; con anh/chị/em ⇒ 403", async () => {
    const k = await dungKhoa();
    await cap(P("sCA"), k.courseId);
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966910001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9f00-0000000000a9", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const hs = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(hs)));
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(hs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: P("sCA") }, bearer(hs)))).status).toBe(200);
    expect((await json(await kv(hs, P("sCA")))).data).toMatchObject({ offline: { coLop: true }, online: { trangThai: "CO_QUYEN", soKhoaConHan: 1 } });
    expect((await ds(hs, P("sCA"))).status).toBe(200);
    expect((await ct(hs, P("sCA"), k.courseId)).status).toBe(200);
    expect((await ml(hs, P("sCA"), k.courseId)).status).toBe(200);
    expect((await bai(hs, P("sCA"), k.courseId, k.b1)).status).toBe(200);
    expect((await qy(hs, P("sCA"))).status).toBe(200);
    // anh/chị/em (cùng nhà) ⇒ 403 (đường dẫn khác học viên đang khoá)
    expect(await ma(await ds(hs, P("sON")))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await bai(hs, P("sON"), k.courseId, k.b1))).toEqual([403, "FORBIDDEN"]);
  });

  it("[ONL-P0-09] V8.12 DTO bổ sung: soBan + batDauLuc ở danh sách/chi tiết/mục lục; chứng nhận của con (giữ cả khoá thu hồi); nhà khác 404", async () => {
    const k = await dungKhoa();
    await cap(P("sCA"), k.courseId);
    const q = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: P("sCA"), courseId: k.courseId } }, select: { startsAt: true } });
    // phát hành THẬT bản 2 (chính sách giữ tiến độ) để soBan không thể trùng một hằng số: bản đang chạy phải là 2
    const nhap = await moBanNhap(db, k.courseId, null);
    expect(nhap.ok).toBe(true);
    const xt2 = await xemTruocPhatHanh(db, k.courseId, { loai: "KEEP_PROGRESS" });
    if (!xt2.ok) throw new Error(xt2.thongBao);
    const ph2 = await phatHanh(db, { courseId: k.courseId, chinhSach: { loai: "KEEP_PROGRESS" }, dauVet: xt2.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, MOC);
    if (!ph2.ok) throw new Error(ph2.thongBao);
    const ban = 2;
    const list = (await json(await ds(tA, P("sCA")))).data.muc.find((m: { courseId: string }) => m.courseId === k.courseId);
    expect(list).toMatchObject({ soBan: ban, batDauLuc: q.startsAt.toISOString() });
    expect((await json(await ct(tA, P("sCA"), k.courseId))).data).toMatchObject({ soBan: ban, batDauLuc: q.startsAt.toISOString() });
    expect((await json(await ml(tA, P("sCA"), k.courseId))).data.soBan).toBe(ban);
    const cn = (tok: string, sv: string) => chungNhanGet(req("GET", `/api/mobile/v1/students/${sv}/online/certificates`, undefined, bearer(tok)), ctx(sv));
    expect((await json(await cn(tA, P("sCA")))).data.muc).toEqual([]);
    const cap2 = await capChungNhanTay(db, { courseId: k.courseId, studentId: P("sCA"), actorUserId: P("A"), reason: "cấp tay để kiểm thử chứng nhận", now: MOC });
    expect(cap2.ok).toBe(true);
    const r = await cn(tA, P("sCA"));
    expect(r.headers.get("cache-control")).toBe("no-store");
    const muc = (await json(r)).data.muc as Array<{ ma: string; maHienThi: string; trangThai: string; tenKhoa: string }>;
    expect(muc.length).toBe(1);
    expect(muc[0]).toMatchObject({ trangThai: "ISSUED" });
    // C10 (X-2): `ma` = mã ĐÃ LƯU (khoá), `maHienThi` = chuỗi khớp giấy
    const daLuu = (await db.onlCertificate.findUniqueOrThrow({ where: { studentId_courseId: { studentId: P("sCA"), courseId: k.courseId } }, select: { code: true } })).code;
    expect(daLuu).toMatch(/^SRON[A-HJKMNP-Z2-9]{10}$/);
    expect([muc[0]!.ma, muc[0]!.maHienThi]).toEqual([daLuu, `SR-ON-${daLuu.slice(4)}`]);
    // mã cấp TRƯỚC C10 giữ nguyên cả hai trường
    await db.onlCertificate.update({ where: { code: daLuu }, data: { code: "K7M2N9P4Q8" } });
    expect((await json(await cn(tA, P("sCA")))).data.muc[0]).toMatchObject({ ma: "K7M2N9P4Q8", maHienThi: "K7M2N9P4Q8" });
    await thuHoiQuyenHoc(db, { studentId: P("sCA"), courseId: k.courseId, reason: "thu hồi thử nghiệm chứng nhận", idempotencyKey: key("thu"), now: MOC });
    expect(((await json(await cn(tA, P("sCA")))).data.muc as unknown[]).length).toBe(1); // giữ chứng nhận của khoá đã thu hồi quyền
    expect(await ma(await cn(tB, P("sCA")))).toEqual([404, "NOT_FOUND"]);
  });

  it("[ONL-P0-08] học viên CHỈ-ONLINE (SR, centerId NULL) + bốn trạng thái tách bạch", async () => {
    const k = await dungKhoa();
    const sv = await taoHocVienChiOnline(db as never, { parentUserId: P("A"), name: "Bé Chỉ Online", now: MOC });
    expect(sv).toMatchObject({ ok: true });
    if (!sv.ok) return;
    expect(sv.studentCode).toMatch(/^SR-\d{2}-[A-Z0-9]{6}$/);
    expect((await db.student.findUnique({ where: { id: sv.studentId }, select: { centerId: true } }))?.centerId).toBeNull();
    await cap(sv.studentId, k.courseId);
    expect((await json(await ds(tA, sv.studentId))).data.muc.map((m: { courseId: string }) => m.courseId)).toEqual([k.courseId]);
    expect((await bai(tA, sv.studentId, k.courseId, k.b1)).status).toBe(200);
    expect(await ma(await ds(tB, sv.studentId))).toEqual([404, "NOT_FOUND"]);
    // bốn trạng thái: chỉ-online / chỉ-offline / cả hai / không có
    await cap(P("sCA"), k.courseId);
    const kvx = async (sid: string) => (await json(await kv(tA, sid))).data;
    expect(await kvx(sv.studentId)).toMatchObject({ offline: { coLop: false }, online: { trangThai: "CO_QUYEN" } });
    expect(await kvx(P("sOFF"))).toMatchObject({ offline: { coLop: true }, online: { trangThai: "CHUA_CO_QUYEN" } });
    expect(await kvx(P("sCA"))).toMatchObject({ offline: { coLop: true }, online: { trangThai: "CO_QUYEN" } });
    expect(await kvx(P("sKHONG"))).toMatchObject({ offline: { coLop: false }, online: { trangThai: "CHUA_CO_QUYEN" } });
  });
});
