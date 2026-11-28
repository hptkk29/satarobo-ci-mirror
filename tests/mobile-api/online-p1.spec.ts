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
 * [ONL-P1] V8.12 — ghi tiến độ + làm bài Online qua HTTP route-handler + Postgres thật (lõi E NGUYÊN VẸN):
 *   [ONL-P1-01] tiến độ: READ cần daDoc, VIDEO cần percent (% chỉ tăng, không hạ); loại bài khác ⇒ 422; thiếu dữ liệu ⇒ 422; trường lạ ⇒ 400; phản hồi no-store
 *   [ONL-P1-02] cổng quyền chạy TRƯỚC khi ghi: không quyền/thu hồi/hết hạn/nhà khác ⇒ chặn VÀ không ghi dòng tiến độ nào
 *   [ONL-P1-03] làm bài: bắt đầu ⇒ đề KHÔNG đáp án; hai lần bấm ⇒ cùng một lượt (tiếp tục); nộp ⇒ kết quả; nộp lại ⇒ daNopTruocDo (idempotent); lượt của người khác ⇒ 404
 *   [ONL-P1-04] hết lượt ⇒ 409 HET_LUOT; thu hồi giữa chừng ⇒ nộp bị chặn 403 và KHÔNG chấm; bài không phải đánh giá ⇒ 422
 *   [ONL-P1-06] cờ tắt ⇒ 404 mọi route ghi/làm bài, không ghi gì
 *   [ONL-P1-08] #1300: bài đã khoá xem lại ⇒ `results` 200 CHỈ ĐIỂM (không từng câu/đáp án/giải thích) dù khoá bật xem đáp án; đối chứng khoá thường thấy đáp án
 *   [ONL-P1-07] C10: nộp bài cấp chứng nhận ⇒ `chungNhan` (mã đã lưu, khoá) + `chungNhanMaHienThi` (SR-ON-…); nộp lại ⇒ null
 *   [ONL-P1-05] chế độ học sinh: đúng con ghi tiến độ + làm bài được; con anh/chị/em ⇒ 403
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "onlp1-";
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

async function dungKhoa(o: { maxLuot?: number | null; khongXemLai?: boolean; xemCaDapAn?: boolean } = {}) {
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
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET", khongChoXemLaiBaiDaQua: o.khongXemLai ?? false, ...(o.xemCaDapAn ? { xemKetQua: "CA_DAP_AN_SAU_HET_LUOT" as const, hienDapAn: "SAU_KHI_NOP" as const } : {}) } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, cid, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: cid, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, MOC);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: cid, saleStatus: "ON_SALE" });
  return { courseId: cid, doc, video, quiz, q1, q2 };
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

describe.skipIf(!RUN)("[ONL-P1] ghi tiến độ + làm bài Online qua HTTP + Postgres thật", () => {
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
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    await mk("A", "84966940001");
    await mk("B", "84966940002");
    for (const [k, ph] of [["c1", "A"], ["c2", "A"], ["b1", "B"]] as const) ids[`s${k}`] = (await db.student.create({ data: { id: `${NS}s${k}`, name: `Bé ${k}`, parentUserId: ids[ph] } as never, select: { id: true } })).id;
    const dn = async (sdt: string, nn: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9a00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966940001", 1);
    tB = await dn("0966940002", 2);
    chuToken.set(tA, ids.A!);
    chuToken.set(tB, ids.B!);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
  }, 180_000);

  it("[ONL-P1-01] tiến độ: READ cần daDoc; VIDEO cần percent (chỉ tăng); loại khác 422; thiếu 422; trường lạ 400", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    let r = await td(tA, P("sc1"), k.courseId, k.doc, { daDoc: true });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await json(r)).data).toMatchObject({ trangThai: "COMPLETED", phanTram: 100, vuaHoanThanhBai: true });
    r = await td(tA, P("sc1"), k.courseId, k.video, { percent: 40 });
    expect((await json(r)).data).toMatchObject({ trangThai: "IN_PROGRESS", phanTram: 40 });
    r = await td(tA, P("sc1"), k.courseId, k.video, { percent: 10 }); // chỉ tăng, không hạ
    expect((await json(r)).data.phanTram).toBe(40);
    expect(await ma(await td(tA, P("sc1"), k.courseId, k.quiz, { percent: 50 }))).toEqual([422, "LOAI_BAI_KHONG_GHI_TRUC_TIEP"]);
    expect(await ma(await td(tA, P("sc1"), k.courseId, k.video, {}))).toEqual([422, "THIEU_DU_LIEU"]);
    expect(await ma(await td(tA, P("sc1"), k.courseId, k.doc, { daDoc: false }))).toEqual([422, "THIEU_DU_LIEU"]);
    for (const x of [{ percent: 101 }, { percent: -1 }, { percent: 1.5 }, { daDoc: "yes" }, { percent: 10, lessonStableId: "x" }, { studentId: P("sb1"), daDoc: true }]) expect((await td(tA, P("sc1"), k.courseId, k.doc, x)).status, JSON.stringify(x)).toBe(400);
  });

  it("[ONL-P1-02] cổng quyền TRƯỚC khi ghi: không quyền / thu hồi / hết hạn / nhà khác ⇒ chặn và KHÔNG có dòng tiến độ", async () => {
    const k = await dungKhoa();
    const dem = async (sv: string) => db.onlLessonProgress.count({ where: { entitlement: { studentId: sv, courseId: k.courseId } } });
    expect(await ma(await td(tA, P("sc2"), k.courseId, k.doc, { daDoc: true }))).toEqual([403, "KHONG_CO_QUYEN"]);
    expect(await ma(await td(tB, P("sc2"), k.courseId, k.doc, { daDoc: true }))).toEqual([404, "NOT_FOUND"]);
    expect(await dem(P("sc2"))).toBe(0);
    await cap(P("sc1"), k.courseId);
    expect((await td(tA, P("sc1"), k.courseId, k.doc, { daDoc: true })).status).toBe(200); // đối chứng dương
    await thuHoiQuyenHoc(db, { studentId: P("sc1"), courseId: k.courseId, reason: "thu hồi thử nghiệm tiến độ", idempotencyKey: key("thu"), now: MOC });
    const truoc = await dem(P("sc1"));
    expect(await ma(await td(tA, P("sc1"), k.courseId, k.video, { percent: 90 }))).toEqual([403, "DA_THU_HOI"]);
    expect(await dem(P("sc1"))).toBe(truoc); // không ghi thêm
    const kh = await dungKhoa();
    await cap(P("sc2"), kh.courseId, new Date(Date.now() - 400 * 86_400_000)); // hết hạn
    expect(await ma(await td(tA, P("sc2"), kh.courseId, kh.doc, { daDoc: true }))).toEqual([403, "HET_HAN"]);
    // D23: đường CHỈ ĐỌC `results` vẫn mở khi hết hạn; đường bắt đầu làm bài thì không.
    const kqHet = await kq(tA, P("sc2"), kh.courseId, kh.quiz);
    expect(kqHet.status).toBe(200);
    expect((await json(kqHet)).data.muc).toEqual([]);
    expect(await ma(await bd(tA, P("sc2"), kh.courseId, kh.quiz))).toEqual([403, "HET_HAN"]);
  });

  it("[ONL-P1-03] làm bài: đề không đáp án; bấm hai lần = một lượt; nộp; nộp lại idempotent; lượt của người khác 404", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    const r1 = await bd(tA, P("sc1"), k.courseId, k.quiz);
    expect(r1.status).toBe(200);
    const l1 = (await json(r1)).data;
    expect(l1.daTiepTuc).toBe(false);
    expect(Math.abs(new Date(l1.gioMayChu).getTime() - Date.now())).toBeLessThan(60_000); // V8.18: giờ MÁY CHỦ để app tính đồng hồ không lệch giờ máy
    expect(l1.soLuotToiDa).toBeNull(); // V8.17: đề không giới hạn lượt ⇒ null (đối chứng: đề có trần xem ca dưới)
    expect(JSON.stringify(l1.de)).not.toMatch(/"correct"|"key"|dapAn|answerKey|vì 1\+1=2/); // đề KHÔNG đáp án / giải thích
    const l2 = (await json(await bd(tA, P("sc1"), k.courseId, k.quiz))).data;
    expect([l2.luotId, l2.daTiepTuc]).toEqual([l1.luotId, true]); // cùng lượt
    expect(await db.onlAttempt.count({ where: { studentId: P("sc1") } })).toBe(1);
    const cauIds = (l1.de.cau as Array<{ id: string }>).map((c) => c.id);
    const traLoi: Record<string, unknown> = {};
    for (const id of cauIds) traLoi[id] = "a"; // câu 1 đúng ("a"), câu 2 dạng đúng/sai trả sai kiểu ⇒ không đạt 100%
    const n1 = await nop(tA, P("sc1"), k.courseId, k.quiz, l1.luotId, { traLoi });
    expect(n1.status).toBe(200);
    const d1 = (await json(n1)).data;
    expect(d1.daNopTruocDo).toBe(false);
    expect(d1.ketQua).toBeTruthy();
    const n2 = (await json(await nop(tA, P("sc1"), k.courseId, k.quiz, l1.luotId, { traLoi: {} }))).data; // nộp lại (nội dung khác) ⇒ KẾT QUẢ CŨ
    expect(n2.daNopTruocDo).toBe(true);
    expect(n2.ketQua).toEqual(d1.ketQua);
    const ds = (await json(await kq(tA, P("sc1"), k.courseId, k.quiz))).data.muc;
    expect(ds.length).toBe(1);
    expect(await ma(await nop(tB, P("sc1"), k.courseId, k.quiz, l1.luotId, { traLoi }))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await nop(tA, P("sc1"), k.courseId, k.quiz, "khong-co-luot", { traLoi }))).toEqual([404, "LUOT_KHONG_TON_TAI"]);
    expect((await nop(tA, P("sc1"), k.courseId, k.quiz, l1.luotId, { traLoi, x: 1 })).status).toBe(400);
  });

  it("[ONL-P1-04] thi lại không giới hạn (D2, thay cho hết lượt 409); thu hồi giữa chừng ⇒ nộp bị chặn và KHÔNG chấm; bài không phải đánh giá 422", async () => {
    const k = await dungKhoa({ maxLuot: 1 });
    await cap(P("sc1"), k.courseId);
    const l1 = (await json(await bd(tA, P("sc1"), k.courseId, k.quiz))).data;
    expect([l1.soLuot, l1.soLuotToiDa]).toEqual([1, null]); // D2 (Owner 21/11): thi lại KHÔNG giới hạn ⇒ `soLuotToiDa` luôn null dù cột maxAttempts còn giá trị (V8.45 bỏ «lượt 1/1»)
    await nop(tA, P("sc1"), k.courseId, k.quiz, l1.luotId, { traLoi: {} });
    // 25/11/2026 (tích hợp E-P0·D2): thi lại KHÔNG giới hạn — `maxAttempts` không còn chặn, mã `HET_LUOT` đã gỡ khỏi lõi E ⇒ lượt thứ hai được mở (200), không 409.
    const lan2 = await bd(tA, P("sc1"), k.courseId, k.quiz);
    expect(lan2.status).toBe(200);
    expect((await json(lan2)).data.soLuot).toBe(2);
    expect(await ma(await bd(tA, P("sc1"), k.courseId, k.doc))).toEqual([422, "BAI_KHONG_PHAI_DANH_GIA"]);
    const k2 = await dungKhoa();
    await cap(P("sc2"), k2.courseId);
    const l2 = (await json(await bd(tA, P("sc2"), k2.courseId, k2.quiz))).data;
    await thuHoiQuyenHoc(db, { studentId: P("sc2"), courseId: k2.courseId, reason: "thu hồi giữa lúc làm bài", idempotencyKey: key("thu"), now: MOC });
    expect(await ma(await nop(tA, P("sc2"), k2.courseId, k2.quiz, l2.luotId, { traLoi: {} }))).toEqual([403, "DA_THU_HOI"]);
    expect((await db.onlAttempt.findUnique({ where: { id: l2.luotId }, select: { status: true } }))?.status).toBe("IN_PROGRESS"); // không chấm
    expect(await ma(await kq(tA, P("sc2"), k2.courseId, k2.quiz))).toEqual([403, "DA_THU_HOI"]); // kết quả cũng bị chặn sau thu hồi (không nuốt lỗi)
  });

  it("[ONL-P1-07] C10: nộp bài đạt làm HOÀN THÀNH khoá ⇒ trả mã đã lưu (khoá) + mã hiển thị SR-ON-…; nộp lại ⇒ cả hai null", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    expect((await td(tA, P("sc1"), k.courseId, k.doc, { daDoc: true })).status).toBe(200);
    expect((await td(tA, P("sc1"), k.courseId, k.video, { percent: 100 })).status).toBe(200);
    const l = (await json(await bd(tA, P("sc1"), k.courseId, k.quiz))).data;
    const dung = { [k.q1]: "a", [k.q2]: true };
    const d = (await json(await nop(tA, P("sc1"), k.courseId, k.quiz, l.luotId, { traLoi: dung }))).data;
    expect(d).toMatchObject({ vuaCapChungNhan: true, ketQua: { passed: true } });
    const daLuu = (await db.onlCertificate.findUniqueOrThrow({ where: { studentId_courseId: { studentId: P("sc1"), courseId: k.courseId } }, select: { code: true } })).code;
    expect(daLuu).toMatch(/^SRON[A-HJKMNP-Z2-9]{10}$/);
    expect([d.chungNhan, d.chungNhanMaHienThi]).toEqual([daLuu, `SR-ON-${daLuu.slice(4)}`]);
    const lai = (await json(await nop(tA, P("sc1"), k.courseId, k.quiz, l.luotId, { traLoi: dung }))).data;
    expect([lai.daNopTruocDo, lai.chungNhan, lai.chungNhanMaHienThi]).toEqual([true, null, null]);
  });

  it("[ONL-P1-08] #1300: bài đã khoá xem lại ⇒ results 200 CHỈ ĐIỂM, không lộ đáp án; mở lại bài vẫn 403", async () => {
    const lamDat = async (khongXemLai: boolean) => {
      const k = await dungKhoa({ khongXemLai, xemCaDapAn: true });
      await cap(P("sc1"), k.courseId);
      const l = (await json(await bd(tA, P("sc1"), k.courseId, k.quiz))).data;
      expect((await json(await nop(tA, P("sc1"), k.courseId, k.quiz, l.luotId, { traLoi: { [k.q1]: "a", [k.q2]: true } }))).data.ketQua).toMatchObject({ passed: true });
      const r = await kq(tA, P("sc1"), k.courseId, k.quiz);
      expect(r.status).toBe(200);
      return { k, muc: (await json(r)).data.muc as Array<{ ketQua: Record<string, unknown> }> };
    };
    const thuong = await lamDat(false); // đối chứng dương: cùng cài đặt xem đáp án, KHÔNG khoá xem lại ⇒ thấy đáp án + giải thích
    expect(JSON.stringify(thuong.muc)).toMatch(/dapAnDung/);
    expect(JSON.stringify(thuong.muc)).toContain("vì 1+1=2");
    const khoa = await lamDat(true);
    expect(khoa.muc).toHaveLength(1);
    expect(khoa.muc[0]!.ketQua).toEqual({ scorePercent: 100, passed: true, daChamXong: true });
    expect(JSON.stringify(khoa.muc)).not.toMatch(/chiTiet|dapAnDung|giaiThich|vì 1\+1=2/);
    expect(await ma(await bd(tA, P("sc1"), khoa.k.courseId, khoa.k.quiz))).toEqual([403, "DA_HOAN_THANH_KHONG_XEM_LAI"]); // mở lại bài/làm lại vẫn bị chặn
  });

  it("[ONL-P1-06] cờ ELEARNING_ONLINE_ENABLED tắt ⇒ 404 ở cả bốn route ghi/làm bài; bật lại ⇒ hoạt động", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    process.env.ELEARNING_ONLINE_ENABLED = "false";
    try {
      expect(await ma(await td(tA, P("sc1"), k.courseId, k.doc, { daDoc: true }))).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await bd(tA, P("sc1"), k.courseId, k.quiz))).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await nop(tA, P("sc1"), k.courseId, k.quiz, "x", { traLoi: {} }))).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await kq(tA, P("sc1"), k.courseId, k.quiz))).toEqual([404, "NOT_FOUND"]);
      expect(await db.onlLessonProgress.count({ where: { entitlement: { studentId: P("sc1"), courseId: k.courseId } } })).toBe(0); // không ghi gì khi cờ tắt
    } finally {
      process.env.ELEARNING_ONLINE_ENABLED = "true";
    }
    expect((await td(tA, P("sc1"), k.courseId, k.doc, { daDoc: true })).status).toBe(200);
  });

  it("[ONL-P1-05] chế độ học sinh: đúng con ghi tiến độ + làm bài; anh/chị/em 403", async () => {
    const k = await dungKhoa();
    await cap(P("sc1"), k.courseId);
    await cap(P("sc2"), k.courseId);
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966940001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9a00-0000000000a9", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const hs = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(hs)));
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(hs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: P("sc1") }, bearer(hs)))).status).toBe(200);
    expect((await td(hs, P("sc1"), k.courseId, k.doc, { daDoc: true })).status).toBe(200);
    const l = (await json(await bd(hs, P("sc1"), k.courseId, k.quiz))).data;
    expect(l.luotId).toBeTruthy();
    expect((await nop(hs, P("sc1"), k.courseId, k.quiz, l.luotId, { traLoi: {} })).status).toBe(200);
    expect((await kq(hs, P("sc1"), k.courseId, k.quiz)).status).toBe(200);
    expect(await ma(await td(hs, P("sc2"), k.courseId, k.doc, { daDoc: true }))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await bd(hs, P("sc2"), k.courseId, k.quiz))).toEqual([403, "FORBIDDEN"]);
  });
});
