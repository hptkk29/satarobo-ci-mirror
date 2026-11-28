import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({ phien: null as null | { user: Record<string, unknown> }, gioiHanThat: false }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => M.phien), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: (o: Parameters<typeof that.rateLimit>[0]) => (M.gioiHanThat ? that.rateLimit(o) : Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>)) };
});

import { GET as capBuInterruptions } from "@/app/api/admin/online-exam/interruptions/route";
import { POST as quyetPost } from "@/app/api/admin/online-exam/interruptions/[interruptionId]/quyet/route";
import { POST as capBuPost } from "@/app/api/admin/online-exam/attempts/[attemptId]/cap-bu/route";
import { POST as capLaiPost } from "@/app/api/admin/online-exam/entitlements/grant/route";
import { POST as thuHoiPost } from "@/app/api/admin/online-exam/entitlements/revoke/route";
import { GET as cronGet } from "@/app/api/cron/online-thi-doi-soat/route";
import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as batDauPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/route";
import { GET as nhapGet, PUT as nhapPut } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/draft/route";
import { GET as trangThaiGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/status/route";
import { POST as nopPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/submit/route";
import { GET as ketQuaGet } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/results/route";
import { db } from "@/lib/db";
import { capQuyenHoc, thuHoiQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { kiemCheDoHocSinh } from "@/lib/mobile-api/che-do-hoc-sinh-thuan";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { chayDoiSoatLuotQuaHan } from "@/lib/online-thi/doi-soat-luot";
import { donBangOnl } from "../elearning/_onl-don";
import { DAP_AN_SAI_KIEU, DAU_GIAI_THICH, dapAnHopLeTuDe, dungKhoaThi, type CauSoan } from "./_online-exam-fixture";
import { dang13 } from "./_online-exam-13";

/**
 * [OEX] ONLINE EXAM P0 qua HTTP route-handler + Postgres thật + LÕI E THẬT (không cổng giả, không mock lõi):
 *   [OEX-01] bắt đầu lượt + đọc trạng thái/nháp: phụ huynh phiên thường ⇒ 403 và KHÔNG tạo lượt; học viên ⇒ 200; đề không đáp án; em khác/nhà khác ⇒ 404
 *   [OEX-02] nháp theo câu: save → resume → CONFLICT/AHEAD → hai thiết bị
 *   [OEX-03] idempotency theo requestId (gửi lại ⇒ cùng kết quả, không ghi hai lần) + mất mạng
 *   [OEX-04] MỘT CÂU SAI KIỂU KHÔNG LÀM MẤT CÂU KHÁC (+ biên: toàn sai, câu lạ, trùng, quá nhiều, lượt đã chốt)
 *   [OEX-05] nộp + kết quả; không lộ đáp án trong đề/nháp/trạng thái/CONFLICT
 *   [OEX-06] hết giờ: PUT sau hạn ⇒ 409; chốt lười khi đọc; cron tự chốt (có nháp ⇒ chấm, không nháp ⇒ EXPIRED), idempotent, song song, chạy bù, đủ lô
 *   [OEX-07] EX-02 thu hồi giữa chừng ⇒ INTERRUPTED + giữ bài + không trượt; cấp lại ⇒ lượt thay thế (đúng đề cũ)
 *   [OEX-08] EX-01 cấp bù lỗi hệ thống qua route admin (RBAC đúng/sai vai, lý do/bằng chứng, audit, idempotent)
 *   [OEX-09] duyệt/từ chối bồi hoàn PENDING_REVIEW qua route admin
 *   [OEX-10] chế độ học sinh + IDOR; cờ tắt ⇒ 404; chưa đăng nhập ⇒ 401
 *   [OEX-11] giới hạn tần suất 2 tầng (adapter 429 + Retry-After; lõi E VUOT_TAN_SUAT 429 + Retry-After)
 *   [OEX-12] 13 dạng câu hỏi: mỗi dạng lưu được đáp án hợp lệ, sai kiểu bị từ chối riêng
 * Đồng hồ: Date bị ĐÓNG BĂNG/dịch bằng `vi.setSystemTime` (luật 19) — KHÔNG sửa dueAt/savedAt trong DB.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "oex-";
const MK = "Mat-khau-test-2026";
const CRON = "cron-scratch-secret-oex";
let dem = 0;
const ip = () => `10.99.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string, tho?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: tho ?? (body === undefined ? undefined : JSON.stringify(body)) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; chiTiet?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const bearer = (t: string) => `Bearer ${t}`;
let nrq = 0;
const rid = () => `oex-rq-${Date.now()}-${++nrq}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[OEX] Online Exam P0 qua HTTP + Postgres thật + lõi E thật", () => {
  const ids: Record<string, string> = {};
  let tA1 = "";
  let tA2 = "";
  let tB = "";
  let khoa: Awaited<ReturnType<typeof dungKhoaThi>>;
  const ctx = (s: string, c: string, l: string, a?: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ studentId: s, courseId: c, lessonId: l, attemptId: a, ...extra }) as never });
  const base = (s: string, c = khoa.courseId, l = khoa.lessonStableId) => `/api/mobile/v1/students/${s}/online/courses/${c}/lessons/${l}`;

  const batHS = async (userId: string, s: string) => db.mobileSession.updateMany({ where: { userId, thuHoiLuc: null }, data: { hocSinhId: s, hocSinhTuLuc: new Date() } });
  const batPH = async (userId: string) => db.mobileSession.updateMany({ where: { userId, thuHoiLuc: null }, data: { hocSinhId: null, hocSinhTuLuc: null } });
  /** Học viên MỚI (nhà A) có quyền học khoá hiện tại; trả id. */
  const moiHocVien = async (ten: string, k = khoa) => {
    const s = await db.student.create({ data: { id: `${NS}${ten}-${++nrq}`, name: `Bé ${ten}`, parentUserId: ids.A } as never, select: { id: true } });
    const c = await capQuyenHoc(db, { studentId: s.id, courseId: k.courseId, loai: "MUA", now: new Date(), idempotencyKey: `${NS}cap-${s.id}` });
    if (!c.ok) throw new Error(c.thongBao);
    return s.id;
  };
  const bd = async (tok: string, s: string, than: unknown = {}) => batDauPost(req("POST", `${base(s)}/attempts`, than, bearer(tok)), ctx(s, khoa.courseId, khoa.lessonStableId));
  const luu = async (tok: string, s: string, a: string, body: unknown, tho?: string) => nhapPut(req("PUT", `${base(s)}/attempts/${a}/draft`, body, bearer(tok), tho), ctx(s, khoa.courseId, khoa.lessonStableId, a));
  const doc = async (tok: string, s: string, a: string) => nhapGet(req("GET", `${base(s)}/attempts/${a}/draft`, undefined, bearer(tok)), ctx(s, khoa.courseId, khoa.lessonStableId, a));
  const tt = async (tok: string, s: string, a: string) => trangThaiGet(req("GET", `${base(s)}/attempts/${a}/status`, undefined, bearer(tok)), ctx(s, khoa.courseId, khoa.lessonStableId, a));
  const nop = async (tok: string, s: string, a: string, traLoi: Record<string, unknown>) => nopPost(req("POST", `${base(s)}/attempts/${a}/submit`, { traLoi }, bearer(tok)), ctx(s, khoa.courseId, khoa.lessonStableId, a));
  const kq = async (tok: string, s: string) => ketQuaGet(req("GET", `${base(s)}/results`, undefined, bearer(tok)), ctx(s, khoa.courseId, khoa.lessonStableId));
  const it1 = (questionId: string, answer: unknown, baseRevision = 0) => ({ questionId, answer, baseRevision });
  /** HS bắt đầu lượt, trả {s, a}. */
  const lamBai = async (ten: string, tok = tA1) => {
    const s = await moiHocVien(ten);
    await batHS(ids.A!, s);
    const r = await bd(tok, s);
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    return { s, a: d.luotId as string, d };
  };
  const cronReq = (auth: string | null) => new NextRequest("http://localhost/api/cron/online-thi-doi-soat", { headers: auth ? { authorization: auth } : {} });
  const admin = (id: string) => (M.phien = { user: { id, name: "Admin OEX", email: `${NS}admin@seed.invalid`, role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] } });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    process.env.CRON_SECRET = CRON;
    process.env.LOGIN_RATELIMIT_DISABLED = "1";
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string, role = "PARENT") => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role, roles: [role] } as never, select: { id: true } })).id);
    await mk("A", "84966960001");
    await mk("B", "84966960002");
    await mk("admin", "84966960003", "SUPER_ADMIN");
    await mk("gv", "84966960004", "TEACHER");
    await mk("train", "84966960005", "TRAINING");
    await mk("mkt", "84966960006", "MARKETING");
    const ho = await db.orgUnit.findFirstOrThrow({ where: { type: "HO" }, select: { id: true } });
    for (const [u, code] of [["admin", "SUPER_ADMIN"], ["train", "TRAINING"], ["mkt", "HO_MARKETING"]] as const) {
      const rd = await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } });
      await db.userOrgRole.create({ data: { userId: ids[u]!, orgUnitId: ho.id, roleId: rd.id, grantedById: ids.admin! } });
    }
    ids.sB = (await db.student.create({ data: { id: `${NS}sB`, name: "Bé B", parentUserId: ids.B } as never, select: { id: true } })).id;
    const dn = async (sdt: string, nn: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9c00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA1 = await dn("0966960001", 1);
    tA2 = await dn("0966960001", 2); // thiết bị thứ hai của cùng phụ huynh
    tB = await dn("0966960002", 3);
    for (const t of [tA1, tA2, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    khoa = await dungKhoaThi({ ten: "OEX", timeLimitMin: 3, passPercent: 50 });
    const cb = await capQuyenHoc(db, { studentId: ids.sB!, courseId: khoa.courseId, loai: "MUA", now: new Date(), idempotencyKey: `${NS}capB` });
    if (!cb.ok) throw new Error(cb.thongBao);
  }, 240_000);
  afterEach(() => {
    vi.useRealTimers();
    M.gioiHanThat = false;
    M.phien = null;
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    delete process.env.ONLINE_NHAP_E_YEU_CAU_MOI_PHUT;
  });
  afterAll(async () => {
    await don();
    delete process.env.ELEARNING_ONLINE_ENABLED;
    delete process.env.CRON_SECRET;
  }, 240_000);

  it("[OEX-01] bắt đầu lượt + đọc trạng thái: phụ huynh phiên thường ⇒ 403 không tạo lượt; học viên ⇒ 200; đề KHÔNG đáp án; em khác ⇒ 404", async () => {
    const s = await moiHocVien("o1");
    const s2 = await moiHocVien("o1b");
    await batPH(ids.A!);
    const r0 = await bd(tA1, s);
    expect([r0.status, (await json(r0)).error?.chiTiet]).toEqual([403, { yeuCau: "CHE_DO_HOC_SINH" }]);
    expect(await db.onlAttempt.count({ where: { studentId: s } })).toBe(0);
    await batHS(ids.A!, s);
    const r1 = await bd(tA1, s);
    expect(r1.status).toBe(200);
    expect(r1.headers.get("cache-control")).toBe("no-store");
    const l = (await json(r1)).data;
    expect(l.soLuotToiDa).toBeNull(); // D2: thi lại không giới hạn
    expect(l.daTiepTuc).toBe(false);
    const raw = JSON.stringify(l.de);
    expect(raw).not.toContain(DAU_GIAI_THICH);
    expect(raw).not.toMatch(/"correct"|"key"|answerKey|accepted|"answer"/);
    expect(l.de.cau).toHaveLength(4);
    // trạng thái nhẹ
    const st = await tt(tA1, s, l.luotId);
    expect(st.status).toBe(200);
    const sd = (await json(st)).data;
    expect(sd).toMatchObject({ luotId: l.luotId, soLuot: 1, trangThai: "IN_PROGRESS", draftRevision: 0, coKetQua: false, tuDongNop: false, gianDoan: null, luotThayThe: null, luotConLai: { daDung: 1, luotThayTheDangCho: 0, toiDa: null, conLai: null } });
    expect(sd.giayConLai).toBeGreaterThan(170);
    expect(sd.giayConLai).toBeLessThanOrEqual(180);
    expect(sd.de).toBeUndefined();
    expect(JSON.stringify(sd)).not.toContain(DAU_GIAI_THICH);
    // resume rỗng + đề
    const dr = (await json(await doc(tA1, s, l.luotId))).data;
    expect(dr).toMatchObject({ trangThai: "IN_PROGRESS", nhap: [] });
    expect(dr.de.cau).toHaveLength(4);
    expect(JSON.stringify(dr)).not.toContain(DAU_GIAI_THICH);
    // phụ huynh phiên thường vẫn ĐỌC được
    await batPH(ids.A!);
    expect((await tt(tA1, s, l.luotId)).status).toBe(200);
    expect((await doc(tA1, s, l.luotId)).status).toBe(200);
    // em KHÁC cùng nhà: lượt không thuộc em đó ⇒ 404 LUOT_KHONG_TON_TAI
    expect(await ma(await tt(tA1, s2, l.luotId))).toEqual([404, "LUOT_KHONG_TON_TAI"]);
    expect(await ma(await doc(tA1, s2, l.luotId))).toEqual([404, "LUOT_KHONG_TON_TAI"]);
    // nhà khác ⇒ 404 NOT_FOUND (không lộ tồn tại)
    expect(await ma(await tt(tB, s, l.luotId))).toEqual([404, "NOT_FOUND"]);
    // attemptId lạ
    expect(await ma(await tt(tA1, s, "khong-co-luot"))).toEqual([404, "LUOT_KHONG_TON_TAI"]);
  });

  it("[OEX-02] nháp theo câu: save → resume → CONFLICT/AHEAD → hai thiết bị cùng một câu", async () => {
    const { s, a } = await lamBai("o2");
    const q = khoa.q;
    const r = await luu(tA1, s, a, { requestId: rid(), deviceId: "may-1", items: [it1(q.chonMot!, "a"), it1(q.dungSai!, true)] });
    expect(r.status).toBe(200);
    let d = (await json(r)).data;
    expect(d).toMatchObject({ daGuiLai: false, trangThai: "IN_PROGRESS", draftRevision: 1, soCauDaLuu: 2, soCauTuChoi: 0 });
    expect(d.items.map((i: { ketQua: string; revision: number }) => [i.ketQua, i.revision])).toEqual([["SAVED", 1], ["SAVED", 1]]);
    // resume (đóng app → mở lại): thấy đúng cái máy chủ đã ACK
    const rs = (await json(await doc(tA1, s, a))).data;
    expect(rs.nhap.map((n: { questionId: string; revision: number; dapAn: unknown }) => [n.questionId, n.revision, n.dapAn]).sort()).toEqual([[q.chonMot, 1, "a"], [q.dungSai, 1, true]].sort());
    expect(rs.draftRevision).toBe(1);
    // đổi đáp án đúng revision ⇒ rev 2
    d = (await json(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.chonMot!, "b", 1)] }))).data;
    expect(d.items[0]).toMatchObject({ ketQua: "SAVED", revision: 2 });
    // gửi base cũ ⇒ CONFLICT trả bản máy chủ (đáp án CỦA HỌC VIÊN, không đáp án đúng) — HTTP 200
    const rc = await luu(tA1, s, a, { requestId: rid(), items: [it1(q.chonMot!, "a", 1)] });
    expect(rc.status).toBe(200);
    const c = (await json(rc)).data;
    expect(c.items[0]).toMatchObject({ ketQua: "CONFLICT", serverRevision: 2, serverAnswer: "b" });
    expect(c.soCauDaLuu).toBe(0);
    // base vượt trước ⇒ AHEAD
    const ah = (await json(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.chonMot!, "a", 9)] }))).data;
    expect(ah.items[0]).toMatchObject({ ketQua: "AHEAD", serverRevision: 2 });
    expect(JSON.stringify([c, ah])).not.toContain(DAU_GIAI_THICH);
    // HAI THIẾT BỊ (hai phiên của cùng phụ huynh): máy 2 giữ revision cũ ghi đè ⇒ CONFLICT, bản máy 1 còn nguyên
    const m2 = await luu(tA2, s, a, { requestId: rid(), deviceId: "may-2", items: [it1(q.dungSai!, false, 0)] });
    expect((await json(m2)).data.items[0]).toMatchObject({ ketQua: "CONFLICT", serverRevision: 1, serverAnswer: true });
    const gio = await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: a, questionId: q.dungSai } });
    expect(gio.answerJson).toBe(true);
    // máy 2 hợp nhất (base = revision máy chủ) rồi ghi ⇒ SAVED rev 2
    const m2b = (await json(await luu(tA2, s, a, { requestId: rid(), deviceId: "may-2", items: [it1(q.dungSai!, false, 1)] }))).data;
    expect(m2b.items[0]).toMatchObject({ ketQua: "SAVED", revision: 2 });
    expect(await db.onlAttemptDraft.count({ where: { attemptId: a } })).toBe(2); // một dòng/câu, không nhân đôi
  });

  it("[OEX-03] idempotency requestId: gửi lại ⇒ đúng kết quả cũ, không ghi hai lần, không tăng revision (mất mạng sau khi máy chủ đã ghi)", async () => {
    const { s, a } = await lamBai("o3");
    const q = khoa.q;
    const rq = rid();
    const body = { requestId: rq, items: [it1(q.ngan!, "Hà Nội"), it1(q.nhapSo!, 5)] };
    const l1 = (await json(await luu(tA1, s, a, body))).data;
    const l2 = (await json(await luu(tA1, s, a, body))).data; // retry sau khi mất phản hồi
    expect(l1.daGuiLai).toBe(false);
    expect(l2).toMatchObject({ daGuiLai: true, draftRevision: 1, soCauDaLuu: 2 });
    expect(l2.items).toEqual(l1.items);
    expect(await db.onlAttemptDraftOp.count({ where: { attemptId: a } })).toBe(1);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: a } })).draftRevision).toBe(1);
    // đủ ba lần
    expect((await json(await luu(tA1, s, a, body))).data.daGuiLai).toBe(true);
    // cùng requestId nhưng BODY KHÁC ⇒ câu ngoài kết quả cũ KHÔNG BAO GIỜ là SAVED (fail-closed)
    const kh = (await json(await luu(tA1, s, a, { requestId: rq, items: [it1(q.ngan!, "Hà Nội"), it1(q.chonMot!, "a")] }))).data;
    const chon = kh.items.find((i: { questionId: string }) => i.questionId === q.chonMot);
    expect(chon.ketQua).toBe("KHONG_XAC_DINH");
    expect(await db.onlAttemptDraft.count({ where: { attemptId: a, questionId: q.chonMot } })).toBe(0);
    // requestId của lượt này dùng cho lượt khác: lượt khác độc lập
    const o = await lamBai("o3b");
    const dd = (await json(await luu(tA1, o.s, o.a, { requestId: rq, items: [it1(q.ngan!, "x")] }))).data;
    expect(dd.daGuiLai).toBe(false);
  });

  it("[OEX-04] MỘT CÂU SAI KIỂU không làm mất câu khác; biên: toàn sai · câu lạ · trùng · quá nhiều · lược đồ · lượt đã chốt", async () => {
    const { s, a } = await lamBai("o4");
    const q = khoa.q;
    const rq = rid();
    const body = { requestId: rq, items: [it1(q.chonMot!, "a"), it1(q.dungSai!, "co"), it1("cau-la-khong-co", "a"), it1(q.ngan!, "Hà Nội"), it1(q.nhapSo!, DAP_AN_SAI_KIEU)] };
    const r = await luu(tA1, s, a, body);
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d.items.map((i: { questionId: string; ketQua: string }) => [i.questionId, i.ketQua])).toEqual([
      [q.chonMot, "SAVED"], [q.dungSai, "SAI_KIEU"], ["cau-la-khong-co", "CAU_KHONG_THUOC_LUOT"], [q.ngan, "SAVED"], [q.nhapSo, "SAI_KIEU"],
    ]);
    expect(d).toMatchObject({ soCauDaLuu: 2, soCauTuChoi: 3, draftRevision: 1 });
    expect(d.items[1]).toMatchObject({ ma: "DAP_AN_KHONG_HOP_LE" });
    const luuDb = await db.onlAttemptDraft.findMany({ where: { attemptId: a }, select: { questionId: true } });
    expect(luuDb.map((x) => x.questionId).sort()).toEqual([q.chonMot, q.ngan].sort());
    // gửi lại cùng requestId ⇒ cùng kết quả (cả phần từ chối được dựng lại tất định)
    const d2 = (await json(await luu(tA1, s, a, body))).data;
    expect(d2.daGuiLai).toBe(true);
    expect(d2.items).toEqual(d.items);
    // TOÀN SAI: 200, không ghi gì, không dùng requestId; nhưng VẪN qua cổng trạng thái
    const ops = await db.onlAttemptDraftOp.count({ where: { attemptId: a } });
    const ts = await luu(tA1, s, a, { requestId: rid(), items: [it1(q.dungSai!, 123)] });
    expect(ts.status).toBe(200);
    expect((await json(ts)).data).toMatchObject({ soCauDaLuu: 0, soCauTuChoi: 1, draftRevision: 1 });
    expect(await db.onlAttemptDraftOp.count({ where: { attemptId: a } })).toBe(ops);
    // lược đồ / trần
    expect((await luu(tA1, s, a, { requestId: rid(), items: [] })).status).toBe(400);
    expect((await luu(tA1, s, a, { requestId: "ngan", items: [it1(q.ngan!, "x")] })).status).toBe(400);
    expect((await luu(tA1, s, a, { requestId: rid(), items: [{ questionId: q.ngan, answer: "x", baseRevision: 0, correct: true }] })).status).toBe(400);
    expect((await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "x")], parentUserId: ids.B })).status).toBe(400);
    expect((await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "x", -1)] })).status).toBe(400);
    expect(await ma(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "a", 2), it1(q.ngan!, "b", 2)] }))).toEqual([422, "YEU_CAU_KHONG_HOP_LE"]);
    const nhieu = Array.from({ length: 51 }, (_, i) => it1(`q${i}`, "a"));
    expect(await ma(await luu(tA1, s, a, { requestId: rid(), items: nhieu }))).toEqual([422, "YEU_CAU_KHONG_HOP_LE"]);
    expect((await luu(tA1, s, a, undefined, "{không phải json")).status).toBe(400);
    expect((await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "x".repeat(300_000))] })).status).toBe(413);
    // lượt đã chốt ⇒ 409 LUOT_DA_CHOT (kể cả khi toàn câu sai) và nháp không đổi
    expect((await nop(tA1, s, a, { [q.chonMot!]: "a" })).status).toBe(200);
    expect(await ma(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "y", 1)] }))).toEqual([409, "LUOT_DA_CHOT"]);
    expect(await ma(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.dungSai!, 999)] }))).toEqual([409, "LUOT_DA_CHOT"]);
    expect(await db.onlAttemptDraft.count({ where: { attemptId: a } })).toBe(2);
  });

  it("[OEX-05] nộp + kết quả: nộp đúng ⇒ GRADED; nộp lại idempotent; kết quả có luotId/lý do chốt; đề không lộ đáp án khi đang làm", async () => {
    const { s, a } = await lamBai("o5");
    const q = khoa.q;
    await luu(tA1, s, a, { requestId: rid(), items: [it1(q.chonMot!, "a"), it1(q.dungSai!, true)] });
    const traLoi = { [q.chonMot!]: "a", [q.dungSai!]: true, [q.ngan!]: "Hà Nội", [q.nhapSo!]: 5 };
    const n1 = await nop(tA1, s, a, traLoi);
    expect(n1.status).toBe(200);
    const d1 = (await json(n1)).data;
    expect(d1).toMatchObject({ daNopTruocDo: false, trangThai: "GRADED" });
    expect(d1.ketQua.scorePercent).toBe(100);
    const d2 = (await json(await nop(tA1, s, a, { [q.chonMot!]: "b" }))).data; // nộp lại với nội dung khác ⇒ KHÔNG chấm lại
    expect(d2).toMatchObject({ daNopTruocDo: true, trangThai: "GRADED" });
    expect(d2.ketQua.scorePercent).toBe(100);
    const sd = (await json(await tt(tA1, s, a))).data;
    expect(sd).toMatchObject({ trangThai: "GRADED", coKetQua: true, tuDongNop: false, lyDoChot: "SUBMIT", giayConLai: null });
    const dr = (await json(await doc(tA1, s, a))).data;
    expect(dr.de).toBeNull(); // đã chốt ⇒ không còn đề
    const kr = (await json(await kq(tA1, s))).data;
    expect(kr.muc).toHaveLength(1);
    expect(kr.muc[0]).toMatchObject({ luotId: a, soLuot: 1, trangThai: "GRADED", tuDongNop: false, lyDoChot: "SUBMIT", gianDoan: null });
    expect(kr.luotConLai).toMatchObject({ daDung: 1, toiDa: null, conLai: null });
    // nộp của lượt người khác / nhà khác
    expect((await nop(tB, s, a, traLoi)).status).toBe(404);
    const o = await lamBai("o5b");
    await batHS(ids.A!, s);
    expect(await ma(await nop(tA1, s, o.a, traLoi))).toEqual([404, "LUOT_KHONG_TON_TAI"]);
    // phụ huynh phiên thường không nộp thay con
    await batPH(ids.A!);
    expect((await nop(tA1, o.s, o.a, traLoi)).status).toBe(403);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: o.a } })).status).toBe("IN_PROGRESS");
  });

  it("[OEX-06a] hết giờ: PUT sau hạn ⇒ 409 HET_GIO (dung sai 60 s: chưa chốt; quá dung sai: chốt lười từ nháp, chấm)", async () => {
    const { s, a } = await lamBai("o6a");
    const q = khoa.q;
    await luu(tA1, s, a, { requestId: rid(), items: [it1(q.chonMot!, "a"), it1(q.dungSai!, true), it1(q.ngan!, "Hà Nội"), it1(q.nhapSo!, 5)] });
    const luot = await db.onlAttempt.findUniqueOrThrow({ where: { id: a } });
    const due = luot.dueAt!.getTime();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(due + 10_000)); // quá hạn nhưng TRONG dung sai
    expect(await ma(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "muộn", 1)] }))).toEqual([409, "HET_GIO"]);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: a } })).status).toBe("IN_PROGRESS");
    vi.setSystemTime(new Date(due + 90_000)); // quá dung sai ⇒ chốt lười
    const r = await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "muộn", 1)] });
    const b = await json(r);
    expect([r.status, b.error?.code, b.error?.chiTiet]).toEqual([409, "HET_GIO", { daChot: true }]);
    vi.useRealTimers();
    const lt = await db.onlAttempt.findUniqueOrThrow({ where: { id: a } });
    expect(lt).toMatchObject({ status: "GRADED", finalizeReason: "DEADLINE_AUTO" });
    expect(lt.scorePercent).toBe(100); // chấm từ nháp đã lưu; câu "muộn" KHÔNG được nhận
    const sd = (await json(await tt(tA1, s, a))).data;
    expect(sd).toMatchObject({ trangThai: "GRADED", tuDongNop: true, coKetQua: true, lyDoChot: "DEADLINE_AUTO" });
    // nộp sau khi đã chốt tự động ⇒ trả kết quả đã chốt, không dùng đáp án gửi muộn
    const nm = (await json(await nop(tA1, s, a, { [q.chonMot!]: "b" }))).data;
    expect(nm).toMatchObject({ daNopTruocDo: true, trangThai: "GRADED" });
    expect(nm.ketQua.scorePercent).toBe(100);
  });

  it("[OEX-06b] CRON tự chốt: 401 khi thiếu/sai bí mật · có nháp ⇒ chấm · không nháp ⇒ EXPIRED (không tính trượt) · trong dung sai không đụng · idempotent · hai worker song song", async () => {
    expect((await cronGet(cronReq(null))).status).toBe(401);
    expect((await cronGet(cronReq("Bearer sai-bi-mat"))).status).toBe(401);
    const q = khoa.q;
    const A1 = await lamBai("o6c1");
    const A2 = await lamBai("o6c2"); // không nháp
    const A3 = await lamBai("o6c3"); // sẽ còn trong dung sai
    await batHS(ids.A!, A1.s);
    expect((await luu(tA1, A1.s, A1.a, { requestId: rid(), items: [it1(q.chonMot!, "a"), it1(q.dungSai!, true)] })).status).toBe(200);
    const due = (await db.onlAttempt.findUniqueOrThrow({ where: { id: A1.a } })).dueAt!.getTime();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(due + 20_000)); // trong dung sai: không ai bị chốt
    const som = await (await cronGet(cronReq(`Bearer ${CRON}`))).json();
    expect(som.ok).toBe(true);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: A1.a } })).status).toBe("IN_PROGRESS");
    vi.setSystemTime(new Date(due + 120_000));
    // hai worker SONG SONG
    const [r1, r2] = await Promise.all([cronGet(cronReq(`Bearer ${CRON}`)), cronGet(cronReq(`Bearer ${CRON}`))]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const t1 = (await r1.json()).data, t2 = (await r2.json()).data;
    expect(t1.loi).toEqual([]);
    expect(t2.loi).toEqual([]);
    vi.useRealTimers();
    const l1 = await db.onlAttempt.findUniqueOrThrow({ where: { id: A1.a } });
    expect(l1).toMatchObject({ status: "GRADED", finalizeReason: "DEADLINE_AUTO" });
    expect(l1.earnedPoints).toBeGreaterThan(0);
    const l2 = await db.onlAttempt.findUniqueOrThrow({ where: { id: A2.a } });
    expect(l2).toMatchObject({ status: "EXPIRED", finalizeReason: "NO_DRAFT_EXPIRED", passed: null, scorePercent: null });
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: A3.a } })).status).toBe("EXPIRED");
    // chấm ĐÚNG MỘT LẦN: không worker nào chấm trùng
    expect(t1.daChot + t2.daChot).toBeGreaterThanOrEqual(1);
    const sauHaiLan = await db.onlAttempt.findMany({ where: { id: { in: [A1.a, A2.a, A3.a] } }, select: { id: true, finalizedAt: true, earnedPoints: true } });
    // chạy lại ⇒ không đổi gì (idempotent)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(due + 600_000));
    const lai = (await (await cronGet(cronReq(`Bearer ${CRON}`))).json()).data;
    vi.useRealTimers();
    expect(lai.daChot).toBe(0);
    const sau = await db.onlAttempt.findMany({ where: { id: { in: [A1.a, A2.a, A3.a] } }, select: { id: true, finalizedAt: true, earnedPoints: true } });
    expect(sau).toEqual(sauHaiLan);
    await batPH(ids.A!); // ba mẹ ĐỌC
    // học viên đọc: EXPIRED ⇒ không có kết quả, KHÔNG phải trượt; GRADED ⇒ có kết quả, tuDongNop
    const sd2 = (await json(await tt(tA1, A2.s, A2.a))).data;
    expect(sd2).toMatchObject({ trangThai: "EXPIRED", coKetQua: false, lyDoChot: "NO_DRAFT_EXPIRED", tuDongNop: false });
    const kr2 = (await json(await kq(tA1, A2.s))).data;
    expect(kr2.muc[0]).toMatchObject({ trangThai: "EXPIRED", ketQua: null });
    const sd1 = (await json(await tt(tA1, A1.s, A1.a))).data;
    expect(sd1).toMatchObject({ trangThai: "GRADED", tuDongNop: true, coKetQua: true });
  });

  it("[OEX-06c] CHẠY BÙ sau restart: nhiều lượt tồn đọng quá hạn nhiều giờ ⇒ tick kế tiếp chốt hết theo lô nhỏ (nhiều vòng); lượt có nháp được chấm, lượt không nháp EXPIRED", async () => {
    const q = khoa.q;
    const xs: { s: string; a: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const x = await lamBai(`o6d${i}`);
      xs.push(x);
      if (i % 2 === 0) await luu(tA1, x.s, x.a, { requestId: rid(), items: [it1(q.chonMot!, "a")] });
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 6 * 3600_000)); // "máy chủ chết 6 giờ, vừa khởi động lại"
    const r = await chayDoiSoatLuotQuaHan(db, { now: () => new Date(), gioiHan: 2 });
    vi.useRealTimers();
    expect(r.loi).toEqual([]);
    expect(r.soVong).toBeGreaterThanOrEqual(3); // 5+ lượt / lô 2 ⇒ phải lặp
    expect(r.conLai).toBe(false);
    const st = await db.onlAttempt.findMany({ where: { id: { in: xs.map((x) => x.a) } }, select: { id: true, status: true, finalizeReason: true } });
    expect(st.filter((x) => x.status === "IN_PROGRESS")).toEqual([]);
    expect(st.find((x) => x.id === xs[0]!.a)).toMatchObject({ status: "GRADED", finalizeReason: "DEADLINE_AUTO" });
    expect(st.find((x) => x.id === xs[1]!.a)).toMatchObject({ status: "EXPIRED", finalizeReason: "NO_DRAFT_EXPIRED" });
  });

  it("[OEX-07] EX-02 thu hồi giữa chừng: lượt INTERRUPTED, GIỮ bài làm, KHÔNG chấm/không trượt; cấp lại ⇒ lượt thay thế dùng ĐÚNG đề cũ", async () => {
    const { s, a, d } = await lamBai("o7");
    const q = khoa.q;
    await luu(tA1, s, a, { requestId: rid(), items: [it1(q.chonMot!, "a"), it1(q.ngan!, "Hà Nội")] });
    const deCu = d.de.cau.map((c: { id: string }) => c.id);
    await thuHoiQuyenHoc(db, { studentId: s, courseId: khoa.courseId, reason: "Admin thu hồi để thử gián đoạn", idempotencyKey: `${NS}th-${s}`, now: new Date(), actorUserId: ids.admin, loaiThuHoi: "ADMIN" });
    const lt = await db.onlAttempt.findUniqueOrThrow({ where: { id: a } });
    expect(lt).toMatchObject({ status: "INTERRUPTED", passed: null, scorePercent: null, submittedAt: null });
    expect(await db.onlAttemptDraft.count({ where: { attemptId: a } })).toBe(2); // KHÔNG xoá đáp án đã lưu
    // đang bị thu hồi quyền: cổng quyền chặn mọi đọc/ghi (403 DA_THU_HOI), nháp vẫn nằm trong DB
    expect(await ma(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "x", 1)] }))).toEqual([403, "DA_THU_HOI"]);
    expect(await ma(await tt(tA1, s, a))).toEqual([403, "DA_THU_HOI"]);
    expect(await ma(await nop(tA1, s, a, { [q.chonMot!]: "a" }))).toEqual([403, "DA_THU_HOI"]);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: a } })).status).toBe("INTERRUPTED");
    // cron không động vào lượt bị gián đoạn dù quá hạn rất lâu
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 10 * 3600_000));
    await chayDoiSoatLuotQuaHan(db, { now: () => new Date() });
    vi.useRealTimers();
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ status: "INTERRUPTED", scorePercent: null, passed: null });
    // cấp lại ⇒ đọc được: INTERRUPTED, giữ nháp, lượt thay thế chờ
    const cl = await capQuyenHoc(db, { studentId: s, courseId: khoa.courseId, loai: "MUA", now: new Date(), idempotencyKey: `${NS}cl-${s}`, actorUserId: ids.admin });
    expect(cl.ok).toBe(true);
    const sd = (await json(await tt(tA1, s, a))).data;
    expect(sd).toMatchObject({ trangThai: "INTERRUPTED", coKetQua: false, giayConLai: null, luotThayThe: { trangThai: "AVAILABLE", luotThayTheId: null }, luotConLai: { daDung: 1, luotThayTheDangCho: 1, toiDa: null, conLai: null } });
    expect(sd.gianDoan).toMatchObject({ trangThai: "COMPENSATED" });
    const dr = (await json(await doc(tA1, s, a))).data;
    expect(dr.de).toBeNull();
    expect(dr.nhap).toHaveLength(2); // nháp còn nguyên và đọc được
    expect(await ma(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, "x", 1)] }))).toEqual([409, "LUOT_BI_GIAN_DOAN"]);
    expect(await ma(await luu(tA1, s, a, { requestId: rid(), items: [it1(q.ngan!, 1234, 1)] }))).toEqual([409, "LUOT_BI_GIAN_DOAN"]); // toàn sai kiểu cũng không lọt
    const kr = (await json(await kq(tA1, s))).data;
    expect(kr.muc[0]).toMatchObject({ trangThai: "INTERRUPTED", ketQua: null, luotId: a, gianDoan: { trangThai: "COMPENSATED" } });
    // lượt thay thế: đúng đề cũ, soLuot 2
    await batHS(ids.A!, s);
    const r2 = (await json(await bd(tA1, s))).data;
    expect(r2).toMatchObject({ soLuot: 2, daTiepTuc: false });
    expect(r2.de.cau.map((c: { id: string }) => c.id)).toEqual(deCu);
    const sd2 = (await json(await tt(tA1, s, a))).data;
    expect(sd2.luotThayThe).toMatchObject({ trangThai: "USED", luotThayTheId: r2.luotId });
    expect(sd2.luotConLai.luotThayTheDangCho).toBe(0);
    expect(await db.onlAttemptDraft.count({ where: { attemptId: a } })).toBe(2); // nháp lượt cũ vẫn nguyên
  });

  it("[OEX-08] EX-01 cấp bù lỗi hệ thống qua route admin: 401/403 sai vai · 422 thiếu lý do/bằng chứng · 409 lượt đang làm · 200 · idempotent · audit · không sửa lượt cũ", async () => {
    const { s, a } = await lamBai("o8");
    const q = khoa.q;
    const go = (att: string, body: unknown) => capBuPost(req("POST", `/x`, body), { params: Promise.resolve({ attemptId: att }) } as never);
    const bc = { lyDo: "Máy chủ lỗi 500 lúc nộp bài, đã xác minh", bangChung: "SU-CO-2026-1125" };
    expect((await go(a, bc)).status).toBe(401); // chưa đăng nhập
    M.phien = { user: { id: ids.A, name: "PH", role: "PARENT", roles: ["PARENT"] } };
    expect((await go(a, bc)).status).toBe(403); // phụ huynh
    M.phien = { user: { id: ids.gv, name: "GV", role: "TEACHER", roles: ["TEACHER"] } };
    expect((await go(a, bc)).status).toBe(403); // giáo viên không có onl:student:grant
    M.phien = { user: { id: ids.mkt, name: "MKT", role: "MARKETING", roles: ["MARKETING"] } };
    expect((await go(a, bc)).status).toBe(403); // Marketing chỉ đọc
    admin(ids.admin!);
    expect(await ma(await go(a, bc))).toEqual([409, "LUOT_DANG_LAM"]); // đang làm ⇒ cứ tiếp tục
    // đóng lượt bằng nộp (điểm thấp) rồi xin cấp bù
    await luu(tA1, s, a, { requestId: rid(), items: [it1(q.chonMot!, "b")] });
    M.phien = null;
    await nop(tA1, s, a, { [q.chonMot!]: "b" });
    const truoc = await db.onlAttempt.findUniqueOrThrow({ where: { id: a } });
    admin(ids.admin!);
    expect((await go(a, { lyDo: "ngắn", bangChung: "SU-CO-1" })).status).toBe(400); // zod của E ⇒ VALIDATION 400
    expect((await go(a, { lyDo: bc.lyDo })).status).toBe(400);
    expect((await go(a, { ...bc, x: 1 })).status).toBe(400); // strict
    expect((await go("khong-co", bc)).status).toBe(404);
    const ok1 = await go(a, bc);
    expect(ok1.status).toBe(200);
    const d1 = (await json(ok1)).data;
    expect(d1).toMatchObject({ daCoTruocDo: false });
    M.phien = { user: { id: ids.train, name: "Đào tạo", role: "TRAINING", roles: ["TRAINING"] } };
    const ok2 = (await json(await go(a, bc))).data; // vai Đào tạo (đối chứng dương) gọi lại ⇒ không bù thêm
    admin(ids.admin!);
    expect(ok2).toMatchObject({ daCoTruocDo: true, compensationId: d1.compensationId });
    expect(await db.onlAttemptCompensation.count({ where: { studentId: s } })).toBe(1);
    // KHÔNG sửa lượt cũ
    const sau = await db.onlAttempt.findUniqueOrThrow({ where: { id: a } });
    expect({ status: sau.status, scorePercent: sau.scorePercent, passed: sau.passed, answersJson: sau.answersJson }).toEqual({ status: truoc.status, scorePercent: truoc.scorePercent, passed: truoc.passed, answersJson: truoc.answersJson });
    // audit
    const gd8 = await db.onlAttemptInterruption.findUniqueOrThrow({ where: { attemptId: a } });
    expect(gd8).toMatchObject({ reasonCode: "LOI_HE_THONG", status: "COMPENSATED", reviewedByUserId: ids.admin });
    const au = await db.auditLog.findMany({ where: { entityType: "OnlAttemptInterruption", entityId: gd8.id } });
    expect(au.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(au.map((x) => [x.action, x.newValues]))).toContain("SU-CO-2026-1125");
    // học viên thấy lượt thay thế chờ & dùng đúng đề cũ
    M.phien = null;
    const sd = (await json(await tt(tA1, s, a))).data;
    expect(sd).toMatchObject({ trangThai: "GRADED", luotConLai: { luotThayTheDangCho: 1 }, luotThayThe: { trangThai: "AVAILABLE" } });
    await batHS(ids.A!, s);
    const r2 = (await json(await bd(tA1, s))).data;
    expect(r2.soLuot).toBe(2);
    // học viên KHÔNG gọi được route admin bằng token di động (không có phiên Auth.js)
    M.phien = null;
    expect((await go(a, bc)).status).toBe(401);
  });

  it("[OEX-09] bồi hoàn chờ xem xét: admin DUYỆT/TỪ CHỐI qua route (RBAC, lý do ≥10, idempotent, không đổi quyết định); lịch sử gián đoạn", async () => {
    const s = await moiHocVien("o9");
    await batHS(ids.A!, s);
    const l = (await json(await bd(tA1, s))).data;
    admin(ids.admin!);
    const th = (b: unknown) => thuHoiPost(req("POST", "/x", b));
    const cl = (b: unknown) => capLaiPost(req("POST", "/x", b));
    const rb = { courseId: khoa.courseId, studentId: s, idempotencyKey: `${NS}th9-${s}`, lyDo: "Admin thu hồi thử EX-02 qua route" };
    M.phien = null;
    expect((await th(rb)).status).toBe(401);
    M.phien = { user: { id: ids.A, role: "PARENT", roles: ["PARENT"] } };
    expect((await th(rb)).status).toBe(403);
    admin(ids.admin!);
    expect((await th({ ...rb, lyDo: "ngắn" })).status).toBe(422); // lõi E: lý do thu hồi ≥ 10 ký tự
    const r1 = await th(rb);
    expect(r1.status).toBe(200);
    expect((await json(await th(rb))).data.daXuLyTruocDo).toBe(true);
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: l.luotId } })).toMatchObject({ status: "INTERRUPTED" });
    // cấp lại với ngưỡng xem xét 0 ⇒ PENDING_REVIEW (dùng hàm lõi để đặt cấu hình ngưỡng)
    const c = await capQuyenHoc(db, { studentId: s, courseId: khoa.courseId, loai: "MUA", now: new Date(), idempotencyKey: `${NS}cl9-${s}`, actorUserId: ids.admin, cauHinhBoiHoan: { nguongXemXet: 0, cuaSoNgay: 30 } });
    expect(c.ok).toBe(true);
    const gd = await db.onlAttemptInterruption.findUniqueOrThrow({ where: { attemptId: l.luotId } });
    expect(gd.status).toBe("PENDING_REVIEW");
    expect((await json(await tt(tA1, s, l.luotId))).data.gianDoan.trangThai).toBe("PENDING_REVIEW");
    const lsr = await capBuInterruptions(req("GET", `/x?courseId=${khoa.courseId}`));
    expect(lsr.status).toBe(200);
    expect((await json(lsr)).data.some((x: { id: string }) => x.id === gd.id)).toBe(true);
    M.phien = { user: { id: ids.A, role: "PARENT", roles: ["PARENT"] } };
    expect((await capBuInterruptions(req("GET", `/x?courseId=${khoa.courseId}`))).status).toBe(403);
    const qy = (b: unknown) => quyetPost(req("POST", "/x", b), { params: Promise.resolve({ interruptionId: gd.id }) } as never);
    expect((await qy({ quyet: "DUYET", lyDo: "đủ điều kiện được duyệt" })).status).toBe(403);
    admin(ids.admin!);
    expect((await qy({ quyet: "DUYET", lyDo: "ngắn" })).status).toBe(400);
    expect(await ma(await qy({ quyet: "TU_CHOI", lyDo: "không rõ nguyên nhân thu hồi" }))).toEqual([200, undefined]);
    expect((await db.onlAttemptInterruption.findUniqueOrThrow({ where: { id: gd.id } })).status).toBe("DENIED");
    expect(await ma(await qy({ quyet: "DUYET", lyDo: "đổi ý muốn duyệt lại" }))).toEqual([409, "KHONG_CHO_XEM_XET"]); // không đảo quyết định
    expect(await db.onlAttemptCompensation.count({ where: { studentId: s } })).toBe(0);
    expect((await json(await tt(tA1, s, l.luotId))).data.gianDoan.trangThai).toBe("DENIED");
    // cấp lại qua route admin (EX-02 phần cấp lại) idempotent
    const g = { courseId: khoa.courseId, studentId: s, loai: "CAP_MIEN_PHI", idempotencyKey: `${NS}g9-${s}`, lyDo: "Cấp lại cho em thi tiếp" };
    expect((await cl(g)).status).toBe(200);
    expect((await json(await cl(g))).data.daXuLyTruocDo).toBe(true); // cùng khoá ⇒ không cấp hai lần
    M.phien = null;
    expect((await cl(g)).status).toBe(401);
  });

  it("[OEX-10] chế độ học sinh + IDOR + cờ: HS chỉ ghi CHÍNH em; em khác/nhà khác bị chặn; cờ tắt ⇒ 404; không token ⇒ 401; luật allow-list thuần", async () => {
    const s = await moiHocVien("o10");
    const s2 = await moiHocVien("o10b");
    await batHS(ids.A!, s);
    const l = (await json(await bd(tA1, s))).data;
    // phụ huynh PHIÊN THƯỜNG ghi nháp thay con ⇒ 403 CHE_DO_HOC_SINH và KHÔNG ghi gì (đối chứng dương: HS cùng thân ⇒ 200, ngay dưới)
    await batPH(ids.A!);
    const gh = await luu(tA1, s, l.luotId, { requestId: rid(), items: [it1(khoa.q.ngan!, "phu-huynh-ghi-ho")] });
    expect([gh.status, (await json(gh)).error?.chiTiet]).toEqual([403, { yeuCau: "CHE_DO_HOC_SINH" }]);
    expect(await db.onlAttemptDraft.count({ where: { attemptId: l.luotId } })).toBe(0);
    await batHS(ids.A!, s);
    expect((await luu(tA1, s, l.luotId, { requestId: rid(), items: [it1(khoa.q.ngan!, "hoc-sinh-ghi")] })).status).toBe(200);
    // phiên HS của s đụng em khác (anh/chị/em) ⇒ 403 ở cổng chế độ học sinh (không phải 404 lộ tồn tại)
    expect((await bd(tA1, s2)).status).toBe(403);
    expect((await luu(tA1, s2, l.luotId, { requestId: rid(), items: [it1(khoa.q.ngan!, "x")] })).status).toBe(403);
    expect((await tt(tA1, s2, l.luotId)).status).toBe(403);
    // em nhà khác ⇒ 403 (HS khoá vào em mình), phụ huynh nhà khác ⇒ 404
    expect((await luu(tA1, ids.sB!, l.luotId, { requestId: rid(), items: [it1(khoa.q.ngan!, "x")] })).status).toBe(403);
    expect(await ma(await luu(tB, s, l.luotId, { requestId: rid(), items: [it1(khoa.q.ngan!, "x")] }))).toEqual([404, "NOT_FOUND"]);
    // không token ⇒ 401
    expect((await nhapPut(req("PUT", `${base(s)}/attempts/${l.luotId}/draft`, { requestId: rid(), items: [it1(khoa.q.ngan!, "x")] }), ctx(s, khoa.courseId, khoa.lessonStableId, l.luotId))).status).toBe(401);
    // cờ ONLINE tắt ⇒ 404 mọi route
    process.env.ELEARNING_ONLINE_ENABLED = "false";
    expect((await luu(tA1, s, l.luotId, { requestId: rid(), items: [it1(khoa.q.ngan!, "x")] })).status).toBe(404);
    expect((await doc(tA1, s, l.luotId)).status).toBe(404);
    expect((await tt(tA1, s, l.luotId)).status).toBe(404);
    expect(await db.onlAttemptDraft.count({ where: { attemptId: l.luotId } })).toBe(1); // chỉ bản của HS; các yêu cầu bị chặn KHÔNG ghi
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    // cờ MOBILE tắt ⇒ 404
    process.env.MOBILE_API_ENABLED = "false";
    expect((await tt(tA1, s, l.luotId)).status).toBe(404);
    process.env.MOBILE_API_ENABLED = "true";
    // luật thuần: ghi nháp CHỈ khi đúng em; đường lạ/phương thức lạ bị chặn mặc định
    const k = (path: string, method: string, hs = s) => kiemCheDoHocSinh({ pathname: `/api/mobile/v1/students/${hs}/online/courses/c/lessons/l/${path}`, method, hocSinhId: s });
    expect(k("attempts/a/draft", "PUT")).toEqual({ ok: true });
    expect(k("attempts/a/draft", "GET")).toEqual({ ok: true });
    expect(k("attempts/a/status", "GET")).toEqual({ ok: true });
    expect(k("attempts/a/draft", "PUT", s2)).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(k("attempts/a/draft", "DELETE")).toMatchObject({ ok: false });
    expect(k("attempts/a/draft/x", "PUT")).toMatchObject({ ok: false });
    expect(k("attempts/a/status", "PUT")).toMatchObject({ ok: false });
  });

  it("[OEX-11] tần suất 2 tầng: adapter 1 lần/2 s/lượt ⇒ 429 + Retry-After (lượt khác không ảnh hưởng); lõi E VUOT_TAN_SUAT ⇒ 429 + Retry-After", async () => {
    const A = await lamBai("o11a");
    const B = await lamBai("o11b");
    const q = khoa.q;
    M.gioiHanThat = true;
    await batHS(ids.A!, A.s);
    const r1 = await luu(tA1, A.s, A.a, { requestId: rid(), items: [it1(q.ngan!, "x")] });
    expect(r1.status).toBe(200);
    const r2 = await luu(tA1, A.s, A.a, { requestId: rid(), items: [it1(q.ngan!, "y", 1)] });
    expect([r2.status, (await json(r2)).error?.code]).toEqual([429, "RATE_LIMITED"]);
    expect(Number(r2.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    await batHS(ids.A!, B.s);
    const rB = await luu(tA1, B.s, B.a, { requestId: rid(), items: [it1(q.ngan!, "x")] }); // lượt khác
    expect(rB.status).toBe(200);
    M.gioiHanThat = false;
    // lõi E: tối đa 2 yêu cầu GHI/phút (env), bản thứ ba ⇒ 429 + Retry-After (adapter tắt)
    process.env.ONLINE_NHAP_E_YEU_CAU_MOI_PHUT = "2";
    const C = await lamBai("o11c");
    expect((await luu(tA1, C.s, C.a, { requestId: rid(), items: [it1(q.ngan!, "1")] })).status).toBe(200);
    expect((await luu(tA1, C.s, C.a, { requestId: rid(), items: [it1(q.ngan!, "2", 1)] })).status).toBe(200);
    const r3 = await luu(tA1, C.s, C.a, { requestId: rid(), items: [it1(q.ngan!, "3", 2)] });
    expect([r3.status, (await json(r3)).error?.code]).toEqual([429, "VUOT_TAN_SUAT"]);
    expect(Number(r3.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: C.a, questionId: q.ngan } })).revision).toBe(2); // yêu cầu bị 429 KHÔNG ghi
  });

  it("[OEX-12] 13 dạng câu hỏi: mỗi dạng lưu được đáp án hợp lệ (dựng từ đề gửi cho học viên), sai kiểu bị từ chối RIÊNG, đề không lộ đáp án", async () => {
    const cau: CauSoan[] = dang13();
    const k13 = await dungKhoaThi({ ten: "OEX13", cau, timeLimitMin: 10 });
    const s = (await db.student.create({ data: { id: `${NS}s13`, name: "Bé 13", parentUserId: ids.A } as never, select: { id: true } })).id;
    const c = await capQuyenHoc(db, { studentId: s, courseId: k13.courseId, loai: "MUA", now: new Date(), idempotencyKey: `${NS}cap13` });
    if (!c.ok) throw new Error(c.thongBao);
    await batHS(ids.A!, s);
    const b13 = `/api/mobile/v1/students/${s}/online/courses/${k13.courseId}/lessons/${k13.lessonStableId}`;
    const cx = (a?: string) => ({ params: Promise.resolve({ studentId: s, courseId: k13.courseId, lessonId: k13.lessonStableId, attemptId: a }) as never });
    const st = await batDauPost(req("POST", `${b13}/attempts`, {}, bearer(tA1)), cx());
    expect(st.status).toBe(200);
    const l = (await json(st)).data;
    expect(l.de.cau).toHaveLength(13);
    expect(JSON.stringify(l.de)).not.toContain(DAU_GIAI_THICH);
    const hopLe = l.de.cau.map((c2: { id: string; type: string; options: { id: string }[]; cauHinh?: Record<string, unknown> }) => it1(c2.id, dapAnHopLeTuDe(c2)));
    const r = await nhapPut(req("PUT", `${b13}/attempts/${l.luotId}/draft`, { requestId: rid(), items: hopLe }, bearer(tA1)), cx(l.luotId));
    // 13 > 50? không: 13 câu ≤ 50
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d.items.map((i: { ketQua: string }) => i.ketQua)).toEqual(Array(13).fill("SAVED"));
    expect(l.de.cau.map((c2: { type: string }) => c2.type).sort()).toEqual(["BLOCK_SEQUENCE", "CLASSIFY", "ESSAY", "FILL_BLANK", "IMAGE_HOTSPOT", "MATCHING", "MULTIPLE_CHOICE", "NUMERIC", "ORDERING", "PRODUCT", "SHORT_TEXT", "SINGLE_CHOICE", "TRUE_FALSE"]);
    // sai kiểu cho TỪNG dạng: một yêu cầu gồm 13 câu sai + (câu 1 đúng revision 1) ⇒ 12 sai kiểu
    const sai = l.de.cau.map((c2: { id: string }) => it1(c2.id, DAP_AN_SAI_KIEU, 1));
    const r2 = (await json(await nhapPut(req("PUT", `${b13}/attempts/${l.luotId}/draft`, { requestId: rid(), items: sai }, bearer(tA1)), cx(l.luotId)))).data;
    expect(r2.items.map((i: { ketQua: string }) => i.ketQua)).toEqual(Array(13).fill("SAI_KIEU"));
    expect(r2.soCauDaLuu).toBe(0);
    // resume trả đủ 13 nháp
    const rs = (await json(await nhapGet(req("GET", `${b13}/attempts/${l.luotId}/draft`, undefined, bearer(tA1)), cx(l.luotId)))).data;
    expect(rs.nhap).toHaveLength(13);
    // PRODUCT: mã bài nộp sản phẩm sai định dạng bị từ chối riêng, còn lại lưu được
    const pr = l.de.cau.find((c2: { type: string }) => c2.type === "PRODUCT");
    const ess = l.de.cau.find((c2: { type: string }) => c2.type === "ESSAY");
    const hon = (await json(await nhapPut(req("PUT", `${b13}/attempts/${l.luotId}/draft`, { requestId: rid(), items: [it1(pr.id, "không hợp lệ !", 1), it1(ess.id, "Bài mới", 1)] }, bearer(tA1)), cx(l.luotId)))).data;
    expect(hon.items.map((i: { ketQua: string }) => i.ketQua)).toEqual(["SAI_KIEU", "SAVED"]);
  });
});
