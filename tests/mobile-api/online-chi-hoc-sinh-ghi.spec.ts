/* eslint-disable @typescript-eslint/no-unused-vars -- spec SINH từ online-p1.spec.ts (scratchpad sinh-hsg.py): còn dư vài import/helper dùng chung */
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
import { POST as batDauPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/route";
import { POST as nopPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/submit/route";
import { POST as tienDoPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/progress/route";
import { GET as ketQuaGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/results/route";
import { PUT as nhapPut } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/draft/route";
import { GET as baiGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/route";
import { GET as mucLucGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/outline/route";
import { db } from "@/lib/db";
import { caiDatKhoiDauChoBanNhap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { luuCauHoi, luuDeThi } from "@/lib/elearning-online/danh-gia-db";
import { doiTrangThaiBan, taoKhoa } from "@/lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "@/lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "@/lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";

/**
 * [HSG] V8.44 (Owner V8.46) — GHI HỌC TẬP ONLINE CHỈ DO HỌC VIÊN (chế độ học sinh); PHỤ HUYNH PHIÊN THƯỜNG CHỈ XEM.
 *   [HSG-01] phiên phụ huynh thường: tiến độ · bắt đầu · nộp · lưu nháp ⇒ 403 FORBIDDEN (chiTiet.yeuCau=CHE_DO_HOC_SINH) và KHÔNG đổi gì (không dòng tiến độ, không lượt, lượt không bị nộp/chấm)
 *   [HSG-02] cùng phiên đó vẫn XEM được: mục lục, bài, kết quả
 *   [HSG-03] đối chứng dương: phiên chế độ học sinh của ĐÚNG em ghi tiến độ · làm bài · nộp · lưu nháp được
 *   [HSG-04] phiên học sinh của em này KHÔNG ghi cho em khác (anh/chị/em, nhà khác) ⇒ 403/404; phụ huynh nhà khác ⇒ 404
 *   [HSG-05] thoát chế độ học sinh ⇒ lại bị chặn; lỗi hệ thống/đồng thời: nhiều lần bấm «Bắt đầu» bằng phiên phụ huynh KHÔNG tiêu lượt
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "hsg844-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const MOC = new Date();
let n = 0;
const key = (t: string) => `${NS}${t}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function dungKhoa(o: { maxLuot?: number | null } = {}) {
  const t = await taoKhoa(db, { code: `ONLP1-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${NS}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 6, renewalEnabled: true }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const cid = t.courseId;
  const cau = async (input: Omit<Parameters<typeof luuCauHoi>[1], "courseId">) => {
    const r = await luuCauHoi(db, { courseId: cid, ...input }, "u");
    if (!r.ok) throw new Error(r.thongBao);
    return r.id;
  };
  const q1 = await cau({ type: "SINGLE_CHOICE", stem: "1+1=?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }], correct: "a", explanation: "vì 1+1=2" });
  const q2 = await cau({ type: "TRUE_FALSE", stem: "Robot có động cơ?", correct: true });
  const de = await luuDeThi(db, { courseId: cid, kind: "QUIZ", title: "Kiểm tra", passPercent: 100, status: "ACTIVE", cau: [{ questionId: q1 }, { questionId: q2 }], maxAttempts: o.maxLuot ?? null }, "u");
  if (!de.ok) throw new Error(de.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const bai = async (kind: "READ" | "VIDEO" | "QUIZ", title: string, nd: object) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind, title, contentJson: nd });
    if (!r.ok) throw new Error("bai");
    return r.stableId;
  };
  const doc = await bai("READ", "Bài đọc", { body: "nội dung" });
  const video = await bai("VIDEO", "Video", { mediaRef: "online/video/t/v.mp4" });
  const quiz = await bai("QUIZ", "Kiểm tra", { assessmentId: de.id });
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, cid, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: cid, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, MOC);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: cid, saleStatus: "ON_SALE" });
  return { courseId: cid, doc, video, quiz };
}
const cap = async (studentId: string, courseId: string, now = MOC) => {
  const r = await capQuyenHoc(db, { studentId, courseId, loai: "CAP_MIEN_PHI", now, idempotencyKey: key("cap") });
  if (!r.ok) throw new Error(r.thongBao);
};

async function don() {
  await donBangOnl(db);
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[HSG] ghi tiến độ + làm bài Online qua HTTP + Postgres thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const P = (k: string) => ids[k]!;
  const ctx = (s: string, c: string, l: string, a?: string) => ({ params: Promise.resolve({ studentId: s, courseId: c, lessonId: l, attemptId: a }) as never });
  const base = (s: string, c: string, l: string) => `/api/mobile/v1/students/${s}/online/courses/${c}/lessons/${l}`;
  // V8.44: thao tác GHI chỉ do HỌC VIÊN (phiên ở chế độ học sinh của em đó). Helper đặt phiên của chủ token vào chế độ học sinh của `s` (kể cả em nhà khác ⇒ vẫn 404 ở bước sở hữu).
  const chuToken = new Map<string, string>();
  const batHS = async (tok: string, s: string) => {
    if (!chuToken.has(tok)) return; // token đã ở chế độ học sinh THẬT (vd. ONL-P1-05) ⇒ không đụng
    await db.mobileSession.updateMany({ where: { userId: chuToken.get(tok)!, thuHoiLuc: null }, data: { hocSinhId: s, hocSinhTuLuc: new Date() } });
  };
  const td = async (tok: string, s: string, c: string, l: string, than: unknown) => (await batHS(tok, s), tienDoPost(req("POST", `${base(s, c, l)}/progress`, than, bearer(tok)), ctx(s, c, l)));
  const bd = async (tok: string, s: string, c: string, l: string, than: unknown = {}) => (await batHS(tok, s), batDauPost(req("POST", `${base(s, c, l)}/attempts`, than, bearer(tok)), ctx(s, c, l)));
  const nop = async (tok: string, s: string, c: string, l: string, a: string, than: unknown) => (await batHS(tok, s), nopPost(req("POST", `${base(s, c, l)}/attempts/${a}/submit`, than, bearer(tok)), ctx(s, c, l, a)));
  const kq = async (tok: string, s: string, c: string, l: string) => (await batHS(tok, s), ketQuaGet(req("GET", `${base(s, c, l)}/results`, undefined, bearer(tok)), ctx(s, c, l)));

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    process.env.LOGIN_RATELIMIT_DISABLED = "1"; // spec này đăng nhập nhiều phiên cùng tài khoản; chỉ ngoài production
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966950001");
    await mk("B", "84966950002");
    for (const [k, ph] of [["c1", "A"], ["c2", "A"], ["b1", "B"]] as const) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[ph] } as never, select: { id: true } })).id;
    const dn = async (sdt: string, nn: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9b00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966950001", 1);
    tB = await dn("0966950002", 2);
    chuToken.set(tA, ids.A!);
    chuToken.set(tB, ids.B!);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
    delete process.env.LOGIN_RATELIMIT_DISABLED;
  }, 180_000);


  // ───── helper THÔ: KHÔNG tự bật chế độ học sinh ─────
  const tdRaw = (tok: string, s: string, c: string, l: string, than: unknown) => tienDoPost(req("POST", `${base(s, c, l)}/progress`, than, bearer(tok)), ctx(s, c, l));
  const bdRaw = (tok: string, s: string, c: string, l: string) => batDauPost(req("POST", `${base(s, c, l)}/attempts`, {}, bearer(tok)), ctx(s, c, l));
  const nopRaw = (tok: string, s: string, c: string, l: string, a: string, than: unknown) => nopPost(req("POST", `${base(s, c, l)}/attempts/${a}/submit`, than, bearer(tok)), ctx(s, c, l, a));
  const nhapRaw = (tok: string, s: string, c: string, l: string, a: string) =>
    nhapPut(req("PUT", `${base(s, c, l)}/attempts/${a}/draft`, { requestId: "hsg-rq-00000001", items: [{ questionId: "q1", answer: "a", baseRevision: 0 }] }, bearer(tok)), ctx(s, c, l, a));
  const dang = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9b00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const jr = await json(r);
    if (!jr.data) throw new Error(`đăng nhập thất bại: ${JSON.stringify(jr.error)}`);
    const t = (jr.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    return t;
  };
  /** Phiên MỚI ở chế độ học sinh của `s` (đặt mã thoát nếu chưa có). */
  const phienHocSinh = async (sdt: string, nn: number, s: string) => {
    await db.mobileSession.deleteMany({ where: { userId: P("A"), hocSinhId: { not: null } } }); // dọn phiên học sinh của ca trước (giới hạn số phiên/tài khoản)
    const t = await dang(sdt, nn);
    await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(t))); // lần sau đã có mã ⇒ bỏ qua kết quả
    expect((await enterPost(req("POST", "/x", { studentId: s }, bearer(t)))).status).toBe(200);
    return t;
  };
  const diemDanh = async (sid: string, courseId: string) => ({
    tienDo: await db.onlLessonProgress.count({ where: { entitlement: { studentId: sid, courseId } } }),
    luot: await db.onlAttempt.count({ where: { entitlement: { studentId: sid, courseId } } }),
  });
  const KIEU_CHAN = [403, "FORBIDDEN"];

  it("[HSG-01] phiên phụ huynh thường: mọi thao tác GHI ⇒ 403 và KHÔNG đổi gì", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    // một lượt do HỌC VIÊN mở sẵn để thử nộp/nháp bằng phiên phụ huynh
    const hs = await phienHocSinh("0966950001", 11, P("sc1"));
    const l = (await json(await bdRaw(hs, P("sc1"), k.courseId, k.quiz))).data;
    expect(l.luotId).toBeTruthy();
    const truoc = await diemDanh(P("sc1"), k.courseId);
    expect(truoc).toEqual({ tienDo: 0, luot: 1 });

    const r1 = await tdRaw(tA, P("sc1"), k.courseId, k.doc, { daDoc: true });
    expect([r1.status, (await json(r1.clone())).error?.code]).toEqual(KIEU_CHAN);
    expect((await json(r1)).error).toMatchObject({ chiTiet: { yeuCau: "CHE_DO_HOC_SINH" } });
    expect(await ma(await tdRaw(tA, P("sc1"), k.courseId, k.video, { percent: 80 }))).toEqual(KIEU_CHAN);
    expect(await ma(await bdRaw(tA, P("sc1"), k.courseId, k.quiz))).toEqual(KIEU_CHAN);
    expect(await ma(await nopRaw(tA, P("sc1"), k.courseId, k.quiz, l.luotId, { traLoi: {} }))).toEqual(KIEU_CHAN);
    expect(await ma(await nhapRaw(tA, P("sc1"), k.courseId, k.quiz, l.luotId))).toEqual(KIEU_CHAN);
    for (let i = 0; i < 3; i++) expect((await bdRaw(tA, P("sc1"), k.courseId, k.quiz)).status).toBe(403); // bấm lặp không tiêu lượt
    expect(await diemDanh(P("sc1"), k.courseId)).toEqual(truoc);
    const luot = await db.onlAttempt.findUniqueOrThrow({ where: { id: l.luotId }, select: { status: true, submittedAt: true } });
    expect(luot).toMatchObject({ status: "IN_PROGRESS", submittedAt: null }); // lượt KHÔNG bị nộp/chấm bởi phụ huynh
  });

  it("[HSG-02] phiên phụ huynh thường vẫn XEM được: mục lục · bài · kết quả", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    const hs = await phienHocSinh("0966950001", 12, P("sc1"));
    const l = (await json(await bdRaw(hs, P("sc1"), k.courseId, k.quiz))).data;
    const get = (m: (r: Request, c: never) => Promise<Response>, path: string, c: unknown) => m(req("GET", path, undefined, bearer(tA)), c as never);
    expect((await get(ketQuaGet as never, `${base(P("sc1"), k.courseId, k.quiz)}/results`, ctx(P("sc1"), k.courseId, k.quiz))).status).toBe(200);
    expect((await get(baiGet as never, base(P("sc1"), k.courseId, k.quiz), ctx(P("sc1"), k.courseId, k.quiz))).status).toBe(200);
    expect((await get(mucLucGet as never, `/api/mobile/v1/students/${P("sc1")}/online/courses/${k.courseId}/outline`, { params: Promise.resolve({ studentId: P("sc1"), courseId: k.courseId }) })).status).toBe(200);
  });

  it("[HSG-03] đối chứng dương: phiên chế độ học sinh của ĐÚNG em ghi tiến độ · làm bài · nộp · lưu nháp", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    const hs = await phienHocSinh("0966950001", 13, P("sc1"));
    expect((await tdRaw(hs, P("sc1"), k.courseId, k.doc, { daDoc: true })).status).toBe(200);
    const l = (await json(await bdRaw(hs, P("sc1"), k.courseId, k.quiz))).data;
    expect(l.luotId).toBeTruthy();
    expect((await nopRaw(hs, P("sc1"), k.courseId, k.quiz, l.luotId, { traLoi: {} })).status).toBe(200);
    const d = await diemDanh(P("sc1"), k.courseId);
    expect(d.tienDo).toBeGreaterThan(0);
    expect(d.luot).toBe(1);
  });

  it("[HSG-04] phiên học sinh của em này KHÔNG ghi cho em khác; phụ huynh nhà khác ⇒ 404", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    await cap(P("sc2"), k.courseId);
    const hs = await phienHocSinh("0966950001", 14, P("sc1"));
    expect(await ma(await tdRaw(hs, P("sc2"), k.courseId, k.doc, { daDoc: true }))).toEqual(KIEU_CHAN); // anh/chị/em
    expect(await ma(await bdRaw(hs, P("sb1"), k.courseId, k.quiz))).toEqual(KIEU_CHAN); // em nhà khác (chế độ học sinh không với tới)
    expect(await ma(await tdRaw(tB, P("sc1"), k.courseId, k.doc, { daDoc: true }))).toEqual([404, "NOT_FOUND"]); // phụ huynh nhà khác
    expect(await ma(await bdRaw(tB, P("sc1"), k.courseId, k.quiz))).toEqual([404, "NOT_FOUND"]);
    expect(await diemDanh(P("sc2"), k.courseId)).toEqual({ tienDo: 0, luot: 0 });
    expect(await diemDanh(P("sc1"), k.courseId)).toEqual({ tienDo: 0, luot: 0 });
  });

  it("[HSG-05] thoát chế độ học sinh ⇒ lại bị chặn ghi", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    const hs = await phienHocSinh("0966950001", 15, P("sc1"));
    expect((await tdRaw(hs, P("sc1"), k.courseId, k.doc, { daDoc: true })).status).toBe(200);
    await db.mobileSession.updateMany({ where: { userId: P("A"), thuHoiLuc: null }, data: { hocSinhId: null, hocSinhTuLuc: null } }); // phiên trở về chế độ phụ huynh
    expect(await ma(await tdRaw(hs, P("sc1"), k.courseId, k.video, { percent: 70 }))).toEqual(KIEU_CHAN);
    expect(await ma(await bdRaw(hs, P("sc1"), k.courseId, k.quiz))).toEqual(KIEU_CHAN);
    expect(await db.onlAttempt.count({ where: { entitlement: { studentId: P("sc1"), courseId: k.courseId } } })).toBe(0);
  });
});
