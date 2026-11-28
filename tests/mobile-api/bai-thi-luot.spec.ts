import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web: chặn `@/lib/auth` để mọi đường lỡ gọi `auth()` thật sẽ đỏ.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/storage/signed-url", () => ({ keyFromPublicUrl: () => null, signedMediaUrl: async (k: string) => k }));
// Các ca này kiểm LOGIC lượt thi, không kiểm trần tần suất (đã có ở [NOP-DB-10]).
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as lichSuRoute, POST as batDauRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/exams/[examId]/attempts/route";
import { GET as khoiPhucRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/attempts/[attemptId]/route";
import { POST as luuRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/attempts/[attemptId]/answers/route";
import { GET as ketQuaRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/attempts/[attemptId]/result/route";
import { POST as nopRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/attempts/[attemptId]/submit/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [BT-DB] B-LMS3 — LƯỢT THI trên POSTGRES THẬT, gọi thẳng route handler.
 *   [BT-DB-01] bắt đầu: bản ghim + KHÔNG đáp án + giờ do máy chủ; bắt đầu lại (cùng/khác khoá) ⇒ CÙNG lượt
 *   [BT-DB-02] 6 lượt bắt đầu ĐỒNG THỜI ⇒ đúng MỘT lượt
 *   [BT-DB-03] số lượt tối đa: nộp xong + hết lượt ⇒ 422 HET_LUOT; còn lượt ⇒ lượt mới
 *   [BT-DB-04] lưu + KHÔI PHỤC bản nháp: cùng thứ tự xáo, cùng id, câu đã lưu trả lại; thuTuGhi cũ bị bỏ qua
 *   [BT-DB-05] lưu: sai dạng/id lạ/lệch phiên bản ⇒ từ chối; sau hạn ⇒ 422 HET_GIO (không tự gia hạn)
 *   [BT-DB-06] nộp đề chấm máy ⇒ DA_CHAM + điểm ĐÚNG theo từng dạng; bỏ trống = sai; bài về nhà cập nhật
 *   [BT-DB-07] nộp đề có tự luận ⇒ CHO_CHAM, điểm máy từng câu đã ghi, tổng chưa chốt
 *   [BT-DB-08] nộp HAI LẦN / đồng thời ⇒ một kết quả, không chấm lại
 *   [BT-DB-09] BẢN GHIM: sửa đề sau khi bắt đầu KHÔNG đổi chấm/hình chiếu của lượt đang làm
 *   [BT-DB-10] đề có câu lỗi / dạng CODE ⇒ KHÔNG bắt đầu được (DE_CHUA_HO_TRO), không chấm 0 ngầm
 *   [BT-DB-11] quyền: nhà khác / anh-chị-em / học viên không ghi danh ⇒ 404; lượt không thuộc học viên ⇒ 404
 *   [BT-DB-12] kết quả: xemLai chỉ khi đã chấm + showResultAfterSubmit; KHÔNG đáp án đúng
 *   [BT-DB-13] phiên chế độ học sinh: làm bài của CHÍNH mình; anh/chị/em ⇒ 403
 *   [BT-DB-14] lỗi GIỮA CHỪNG lúc nộp ⇒ cuộn lại hoàn toàn (điểm câu, lượt, bài về nhà)
 *   [BT-DB-15] câu nộp sản phẩm: chỉ nhận vé tải lên ĐÃ XÁC MINH của đúng học viên/lượt/câu; nộp xong ⇒ ATTACHED
 *   [BT-DB-16] KHÔNG sinh giao dịch SataCoin; cờ TẮT ⇒ 404; nộp trễ theo chính sách (cả hai giá trị)
 * Dữ liệu tiền tố `btdb-`; dọn ở afterAll.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "btdb-";
const MK = "Mat-khau-test-2026";
const PHONE = { A: "0966700001", B: "0966700002" };
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string, method?: string) =>
  new Request(`http://localhost${url}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const ids: Record<string, string> = {};
const bearer = (t: string) => `Bearer ${t}`;
const E = (k: string) => `${NS}e-${k}`;
const EQ = (e: string, k: string) => `${NS}eq-${e}-${k}`;

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/x", { dinhDanh: phone, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-d000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  if (r.status !== 200) throw new Error(`đăng nhập ${r.status}`);
  return ((await json(r)).data as { accessToken: string }).accessToken;
}

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileUpload.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.examAnswer.deleteMany({ where: { attempt: { studentId: { startsWith: NS } } } });
  await db.examAttempt.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.homeworkAssignment.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.examQuestion.deleteMany({ where: { examId: { startsWith: NS } } });
  await db.exam.deleteMany({ where: { id: { startsWith: NS } } });
  await db.choice.deleteMany({ where: { questionId: { startsWith: NS } } });
  await db.question.deleteMany({ where: { id: { startsWith: NS } } });
  await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

const BAN_DO = { rows: 4, cols: 4, walls: [[1, 1]], goal: [0, 2], start: [2, 0], dir: "N" };
const PALETTE = [{ id: "di", label: "Đi thẳng", kind: "move" }, { id: "phai", label: "Rẽ phải", kind: "turnR" }, { id: "lap2", label: "Lặp 2 lần", kind: "repeat", times: 2 }];

describe.skipIf(!RUN)("[BT-DB] lượt thi — Postgres thật", () => {
  let tA = "";
  let tB = "";
  const S1 = `${NS}s1`;
  const S2 = `${NS}s2`;
  const S3 = `${NS}s3`;
  const L1 = `${NS}l1`;
  const L2 = `${NS}l2`;

  const cauHoi = (id: string, type: string, o: Record<string, unknown> = {}, choices: { order: number; text: string; isCorrect: boolean }[] = []) =>
    db.question.create({ data: { id: `${NS}q-${id}`, type: type as never, text: `Đề ${id}`, ...o, ...(choices.length ? { choices: { create: choices.map((c) => ({ id: `${NS}c-${id}-${c.order}`, ...c })) } } : {}) } as never });
  const deThi = (e: string, qs: [string, number][], o: Record<string, unknown> = {}) =>
    db.exam.create({
      data: { id: E(e), title: `Đề ${e}`, classId: L1, durationMinutes: 30, totalPoints: qs.reduce((n, q) => n + q[1], 0), passingScore: 3, status: "PUBLISHED", maxAttempts: 1, showResultAfterSubmit: true, ...o, examQuestions: { create: qs.map(([k, pts], i) => ({ id: EQ(e, k), questionId: `${NS}q-${k}`, order: i + 1, points: pts })) } } as never,
    });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    // Khoá ký (hạt xáo/id mờ của lượt thi trộn bí mật máy chủ): bắt buộc ≥32 ký tự — chuỗi TEST, vô hại.
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const k of ["A", "B"] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: `${NS}cs`, name: "Cơ sở BT", slug: `${NS}cs`, address: "Địa chỉ" } });
    await db.course.create({ data: { id: `${NS}kh`, name: "Khoá BT", slug: `${NS}kh`, totalSessions: 12 } });
    for (const l of [L1, L2]) await db.class.create({ data: { id: l, name: `Lớp ${l}`, classCode: l, courseId: `${NS}kh`, centerId: `${NS}cs`, status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: S1, name: `${NS}An`, parentUserId: ids.A, centerId: `${NS}cs` } as never });
    await db.student.create({ data: { id: S2, name: `${NS}Binh`, parentUserId: ids.A, centerId: `${NS}cs` } as never });
    await db.student.create({ data: { id: S3, name: `${NS}Cuong`, parentUserId: ids.B, centerId: `${NS}cs` } as never });
    const dk = (id: string, sv: string, lop: string) => db.enrollment.create({ data: { id: `${NS}${id}`, studentId: sv, classId: lop, courseId: `${NS}kh`, status: "ACTIVE", centerId: `${NS}cs` } as never });
    await dk("dk1", S1, L1);
    await dk("dk2", S2, L1);
    await dk("dk3", S3, L2);

    // Ngân hàng câu hỏi (đáp án ghi dấu SECRET để dò rò rỉ)
    await cauHoi("mc", "MULTIPLE_CHOICE", { meta: { ui: "single" } }, [{ order: 1, text: "Một", isCorrect: false }, { order: 2, text: "Hai", isCorrect: true }, { order: 3, text: "Ba", isCorrect: false }]);
    await cauHoi("fill", "FILL_BLANK", { text: "Robot ______ đi ______ ô", meta: { answers: ["SECRET-có thể", "SECRET-ba"] } });
    await cauHoi("num", "NUMERIC", { meta: { value: "60", tolerance: "0.5", unit: "cm" } });
    await cauHoi("ord", "ORDERING", { meta: { items: ["V-bước một", "V-bước hai", "V-bước ba", "V-bước bốn"] } });
    await cauHoi("blk", "BLOCK_PROGRAM", { meta: { palette: PALETTE, grid: BAN_DO, maxBlocks: 6 } });
    await cauHoi("essay", "ESSAY");
    await cauHoi("video", "VIDEO");
    await cauHoi("badfill", "FILL_BLANK", { text: "Chỉ một ______ chỗ", meta: { answers: ["a", "b"] } });
    await cauHoi("code", "CODE", { correctAnswer: "print(1)" });
    await cauHoi("short", "SHORT_ANSWER", { correctAnswer: "SECRET-Robot" });

    await deThi("auto", [["mc", 2], ["fill", 2], ["num", 2], ["ord", 2], ["blk", 2]], { maxAttempts: 2 });
    await deThi("mix", [["mc", 2], ["essay", 4]]);
    await deThi("bad", [["mc", 2], ["badfill", 2]]);
    await deThi("code", [["mc", 2], ["code", 2]]);
    await deThi("vid", [["mc", 2], ["video", 4]]);
    await deThi("hide", [["mc", 2]], { showResultAfterSubmit: false });
    await deThi("ban", [["mc", 2], ["short", 2]]); // dùng cho ca BẢN GHIM
    await deThi("late", [["mc", 2]], { maxAttempts: 3 });
    await deThi("rb", [["mc", 2], ["num", 2]]);
    await deThi("l2", [["mc", 2]], { classId: L2 });
    await db.homeworkAssignment.create({ data: { classSessionId: `${NS}buoi`, examId: E("auto"), studentId: S1, status: "ASSIGNED" } as never });
    await db.homeworkAssignment.create({ data: { classSessionId: `${NS}buoi`, examId: E("rb"), studentId: S1, status: "ASSIGNED" } as never });
    tA = await dangNhap(PHONE.A, 1);
    tB = await dangNhap(PHONE.B, 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("/x", {}, bearer(t)));
  }, 120_000);
  afterAll(async () => {
    delete process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED;
    await don();
  });
  beforeEach(() => {
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
  });

  // ── trợ giúp gọi route (URL THẬT, vì cổng chế độ học sinh đọc đường dẫn) ──
  const gb = (sv: string, e: string) => `/api/mobile/v1/students/${sv}/learning/exams/${E(e)}/attempts`;
  const ga = (sv: string, a: string, tail = "") => `/api/mobile/v1/students/${sv}/learning/attempts/${a}${tail}`;
  const batDau = (tok: string, sv: string, e: string, khoa = "bd-khoa-00001") => batDauRoute(req(gb(sv, e), { khoaGuiLai: khoa }, bearer(tok)), { params: Promise.resolve({ studentId: sv, examId: E(e) }) as never });
  const lichSu = (tok: string, sv: string, e: string) => lichSuRoute(req(gb(sv, e), undefined, bearer(tok)), { params: Promise.resolve({ studentId: sv, examId: E(e) }) as never });
  const khoiPhuc = (tok: string, sv: string, a: string) => khoiPhucRoute(req(ga(sv, a), undefined, bearer(tok)), { params: Promise.resolve({ studentId: sv, attemptId: a }) as never });
  const luu = (tok: string, sv: string, a: string, than: unknown) => luuRoute(req(ga(sv, a, "/answers"), than, bearer(tok)), { params: Promise.resolve({ studentId: sv, attemptId: a }) as never });
  const nop = (tok: string, sv: string, a: string, than: unknown) => nopRoute(req(ga(sv, a, "/submit"), than, bearer(tok)), { params: Promise.resolve({ studentId: sv, attemptId: a }) as never });
  const ketQua = (tok: string, sv: string, a: string) => ketQuaRoute(req(ga(sv, a, "/result"), undefined, bearer(tok)), { params: Promise.resolve({ studentId: sv, attemptId: a }) as never });
  const bd = async (tok: string, sv: string, e: string, khoa?: string) => {
    const r = await batDau(tok, sv, e, khoa);
    expect(r.status, `bắt đầu ${e}: ${await r.clone().text()}`).toBe(200);
    return (await json(r)).data as { luotId: string; phienBanDe: string; conLaiGiay: number; cauHoi: any[]; daLuu: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const cauCua = (l: { cauHoi: any[] }, e: string, k: string) => l.cauHoi.find((c) => c.id === EQ(e, k))!; // eslint-disable-line @typescript-eslint/no-explicit-any
  let seq = 0;
  const luuCau = async (tok: string, sv: string, l: { luotId: string; phienBanDe: string }, e: string, k: string, traLoi: unknown, thuTuGhi = ++seq) => luu(tok, sv, l.luotId, { phienBanDe: l.phienBanDe, cauHoiId: EQ(e, k), traLoi, thuTuGhi });
  const idTheoChu = (c: any, khoa: string, chu: string) => (c[khoa] as { id: string; noiDung: string }[]).find((x) => x.noiDung === chu)!.id; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** Trả lời ĐÚNG cả 5 câu của đề `auto`. */
  const traLoiDungAuto = async (tok: string, sv: string, l: Awaited<ReturnType<typeof bd>>) => {
    const ord = cauCua(l, "auto", "ord");
    const dung = ["V-bước một", "V-bước hai", "V-bước ba", "V-bước bốn"].map((t) => idTheoChu(ord, "muc", t));
    const r = [
      await luuCau(tok, sv, l, "auto", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` }),
      await luuCau(tok, sv, l, "auto", "fill", { dang: "dien_khuyet", cho: ["secret-có thể", "SECRET-ba"] }),
      await luuCau(tok, sv, l, "auto", "num", { dang: "nhap_so", giaTri: "60.5", donVi: "cm" }),
      await luuCau(tok, sv, l, "auto", "ord", { dang: "sap_xep", thuTu: dung }),
      await luuCau(tok, sv, l, "auto", "blk", { dang: "sap_khoi_lenh", chuongTrinh: [{ khoiId: "lap2", con: [{ khoiId: "di" }] }, { khoiId: "phai" }, { khoiId: "lap2", con: [{ khoiId: "di" }] }] }),
    ];
    for (const x of r) expect(x.status).toBe(200);
  };

  it("[BT-DB-01] bắt đầu: bản ghim, KHÔNG đáp án, giờ do máy chủ; bắt đầu lại ⇒ CÙNG lượt", async () => {
    const l = await bd(tA, S1, "auto", "bd-khoa-0001a");
    const s = JSON.stringify(l);
    expect(s).not.toContain("SECRET");
    for (const k of ["isCorrect", "correctAnswer", '"meta"', '"answers"', '"pairs"', '"regions"']) expect(s).not.toContain(k);
    expect(l.cauHoi).toHaveLength(5);
    expect(l.conLaiGiay).toBeGreaterThan(30 * 60 - 20);
    expect(l.conLaiGiay).toBeLessThanOrEqual(30 * 60);
    expect(l.phienBanDe).toMatch(/^[0-9a-f]{32}$/);
    const hang = await db.examAttempt.findUnique({ where: { id: l.luotId }, select: { contentSnapshot: true, seed: true, deadlineAt: true, startKey: true, attemptNo: true, status: true } });
    expect([hang!.status, hang!.attemptNo, hang!.startKey]).toEqual(["IN_PROGRESS", 1, "bd-khoa-0001a"]);
    expect(hang!.contentSnapshot).toBeTruthy();
    const lai = await bd(tA, S1, "auto", "bd-khoa-0001a");
    const khac = await bd(tA, S1, "auto", "bd-khoa-0001b");
    expect([lai.luotId, khac.luotId]).toEqual([l.luotId, l.luotId]);
    expect(await db.examAttempt.count({ where: { examId: E("auto"), studentId: S1 } })).toBe(1);
  });

  it("[BT-DB-02] 6 lượt bắt đầu ĐỒNG THỜI ⇒ đúng MỘT lượt", async () => {
    const kq = await Promise.all(Array.from({ length: 6 }, (_, i) => batDau(tA, S2, "mix", `bd-dua-0000${i}`)));
    expect(kq.map((r) => r.status)).toEqual(Array(6).fill(200));
    const lt = await Promise.all(kq.map(async (r) => (await json(r)).data.luotId));
    expect(new Set(lt).size).toBe(1);
    expect(await db.examAttempt.count({ where: { examId: E("mix"), studentId: S2 } })).toBe(1);
  });

  it("[BT-DB-03] số lượt tối đa: hết lượt ⇒ 422 HET_LUOT; còn lượt ⇒ lượt mới (attemptNo 2)", async () => {
    // đề `late` maxAttempts=3, đề `hide` maxAttempts=1
    const l1 = await bd(tA, S2, "hide", "bd-hl-000001");
    await luuCau(tA, S2, l1, "hide", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` });
    expect((await nop(tA, S2, l1.luotId, { phienBanDe: l1.phienBanDe, khoaGuiLai: "nop-hl-00001" })).status).toBe(200);
    const het = await batDau(tA, S2, "hide", "bd-hl-000002");
    expect([het.status, (await json(het)).error?.code]).toEqual([422, "HET_LUOT"]);
    const m1 = await bd(tA, S2, "late", "bd-lt-000001");
    await nop(tA, S2, m1.luotId, { phienBanDe: m1.phienBanDe, khoaGuiLai: "nop-lt-00001" });
    const m2 = await bd(tA, S2, "late", "bd-lt-000002");
    expect(m2.luotId).not.toBe(m1.luotId);
    expect((await db.examAttempt.findUnique({ where: { id: m2.luotId }, select: { attemptNo: true } }))!.attemptNo).toBe(2);
    const ls = (await json(await lichSu(tA, S2, "late"))).data.muc;
    expect(ls.map((x: { lanThu: number }) => x.lanThu)).toEqual([2, 1]);
  });

  it("[BT-DB-04] lưu + KHÔI PHỤC bản nháp: cùng thứ tự xáo, cùng id; câu đã lưu trả lại; thuTuGhi cũ bị bỏ qua", async () => {
    const l = await bd(tA, S1, "auto", "bd-khoa-0001a");
    await traLoiDungAuto(tA, S1, l);
    const kp = (await json(await khoiPhuc(tA, S1, l.luotId))).data;
    expect(JSON.stringify(kp.cauHoi)).toBe(JSON.stringify(l.cauHoi)); // cùng thứ tự + cùng id mờ
    expect(Object.keys(kp.daLuu).sort()).toEqual(["mc", "fill", "num", "ord", "blk"].map((k) => EQ("auto", k)).sort());
    // bản cũ đến muộn không ghi đè bản mới
    const moi = await luuCau(tA, S1, l, "auto", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-1` }, 9000);
    expect((await json(moi)).data.boQua).toBe(false);
    const cu = await luuCau(tA, S1, l, "auto", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-3` }, 5);
    expect((await json(cu)).data.boQua).toBe(true);
    const han = await db.examAnswer.findUnique({ where: { attemptId_examQuestionId: { attemptId: l.luotId, examQuestionId: EQ("auto", "mc") } } });
    expect([han!.answerSeq, han!.selectedChoiceIds]).toEqual([9000, [`${NS}c-mc-1`]]);
    await luuCau(tA, S1, l, "auto", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` }, 9001); // trả về đáp án đúng cho ca nộp sau
  });

  it("[BT-DB-05] lưu: sai dạng/id lạ/lệch phiên bản ⇒ từ chối; sau hạn ⇒ 422 HET_GIO (không tự gia hạn)", async () => {
    const l = await bd(tA, S1, "auto", "bd-khoa-0001a");
    const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
    expect(await ma(await luuCau(tA, S1, l, "auto", "mc", { dang: "dung_sai", luaChonId: `${NS}c-mc-2` }))).toEqual([400, "VALIDATION"]); // sai dạng
    expect(await ma(await luuCau(tA, S1, l, "auto", "mc", { dang: "chon_mot", luaChonId: "khong-co" }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await luuCau(tA, S1, l, "auto", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2`, diem: 9 }))).toEqual([400, "VALIDATION"]); // trường lạ (strict)
    expect(await ma(await luu(tA, S1, l.luotId, { phienBanDe: "ban-cu", cauHoiId: EQ("auto", "mc"), traLoi: { dang: "chon_mot", luaChonId: `${NS}c-mc-2` }, thuTuGhi: 99999 }))).toEqual([409, "NOI_DUNG_DA_DOI"]);
    expect(await ma(await luu(tA, S1, l.luotId, { phienBanDe: l.phienBanDe, cauHoiId: "cau-la", traLoi: { dang: "chon_mot", luaChonId: "x" }, thuTuGhi: 99998 }))).toEqual([400, "VALIDATION"]);
    const hanCu = (await db.examAttempt.findUnique({ where: { id: l.luotId }, select: { deadlineAt: true } }))!.deadlineAt!;
    await db.examAttempt.update({ where: { id: l.luotId }, data: { deadlineAt: new Date(Date.now() - 5000) } });
    try {
      expect(await ma(await luuCau(tA, S1, l, "auto", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` }, 99997))).toEqual([422, "HET_GIO"]);
      const kp = (await json(await khoiPhuc(tA, S1, l.luotId))).data;
      expect(kp.conLaiGiay).toBe(0); // máy chủ KHÔNG cộng thêm giờ
    } finally {
      await db.examAttempt.update({ where: { id: l.luotId }, data: { deadlineAt: hanCu } });
    }
  });

  it("[BT-DB-06] nộp đề chấm máy ⇒ DA_CHAM + điểm theo từng dạng; bỏ trống = sai; bài về nhà cập nhật", async () => {
    const l = await bd(tA, S1, "auto", "bd-khoa-0001a");
    await traLoiDungAuto(tA, S1, l);
    // làm SAI câu số: để chắc chấm từng câu (60.5 ± 0.5 đúng; đổi thành 61 ⇒ sai)
    await luuCau(tA, S1, l, "auto", "num", { dang: "nhap_so", giaTri: "61", donVi: "cm" });
    const r = await nop(tA, S1, l.luotId, { phienBanDe: l.phienBanDe, khoaGuiLai: "nop-khoa-00001" });
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect([d.trangThai, d.tre, d.trungLap]).toEqual(["DA_CHAM", false, false]);
    const luot = await db.examAttempt.findUnique({ where: { id: l.luotId }, select: { status: true, totalScore: true, passed: true } });
    expect([luot!.status, luot!.totalScore, luot!.passed]).toEqual(["GRADED", 8, true]); // 4 câu đúng × 2 = 8; câu số sai
    const hang = await db.examAnswer.findMany({ where: { attemptId: l.luotId }, select: { examQuestionId: true, isCorrect: true, score: true } });
    const theoCau = Object.fromEntries(hang.map((h) => [h.examQuestionId, [h.isCorrect, h.score]]));
    expect(theoCau[EQ("auto", "num")]).toEqual([false, 0]);
    expect(theoCau[EQ("auto", "blk")]).toEqual([true, 2]);
    expect((await db.homeworkAssignment.findFirst({ where: { studentId: S1, examId: E("auto") } }))!.status).toBe("GRADED");
    expect(await db.sataCoinTransaction.count({ where: { studentId: S1 } })).toBe(0); // [BT-DB-16] không tự thưởng coin
    // bỏ trống toàn bộ = sai thật (lượt mới, nhiều lượt)
    const l2 = await bd(tA, S1, "auto", "bd-khoa-0002a");
    const r2 = await nop(tA, S1, l2.luotId, { phienBanDe: l2.phienBanDe, khoaGuiLai: "nop-khoa-00002" });
    expect((await json(r2)).data.trangThai).toBe("DA_CHAM");
    expect((await db.examAttempt.findUnique({ where: { id: l2.luotId }, select: { totalScore: true, passed: true } }))).toEqual({ totalScore: 0, passed: false });
  });

  it("[BT-DB-07] nộp đề có tự luận ⇒ CHO_CHAM, điểm máy từng câu đã ghi, tổng CHƯA chốt", async () => {
    const l = await bd(tA, S2, "mix", "bd-dua-00000");
    await luuCau(tA, S2, l, "mix", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` });
    await luuCau(tA, S2, l, "mix", "essay", { dang: "tu_luan", vanBan: "Bài tự luận của em" });
    const r = await nop(tA, S2, l.luotId, { phienBanDe: l.phienBanDe, khoaGuiLai: "nop-mix-00001" });
    expect((await json(r)).data.trangThai).toBe("CHO_CHAM");
    const luot = await db.examAttempt.findUnique({ where: { id: l.luotId }, select: { status: true, totalScore: true, gradedAt: true } });
    expect([luot!.status, luot!.totalScore, luot!.gradedAt]).toEqual(["SUBMITTED", null, null]);
    const mc = await db.examAnswer.findUnique({ where: { attemptId_examQuestionId: { attemptId: l.luotId, examQuestionId: EQ("mix", "mc") } } });
    const es = await db.examAnswer.findUnique({ where: { attemptId_examQuestionId: { attemptId: l.luotId, examQuestionId: EQ("mix", "essay") } } });
    expect([mc!.isCorrect, mc!.score]).toEqual([true, 2]);
    expect([es!.textAnswer, es!.isCorrect, es!.score]).toEqual(["Bài tự luận của em", null, null]); // chờ giáo viên: KHÔNG chấm 0 ngầm (isCorrect null)
    const kq = (await json(await ketQua(tA, S2, l.luotId))).data;
    expect([kq.trangThai, kq.diem, kq.xemLai]).toEqual(["CHO_CHAM", null, null]);
  });

  it("[BT-DB-08] nộp HAI LẦN / đồng thời ⇒ một kết quả, không chấm lại", async () => {
    const l = await bd(tA, S1, "rb", "bd-rb-000001");
    await luuCau(tA, S1, l, "rb", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` });
    const kq = await Promise.all(Array.from({ length: 5 }, (_, i) => nop(tA, S1, l.luotId, { phienBanDe: l.phienBanDe, khoaGuiLai: `nop-rb-0000${i}` })));
    expect(kq.map((r) => r.status)).toEqual(Array(5).fill(200));
    const b = await Promise.all(kq.map(json));
    expect(b.filter((x) => x.data.trungLap === false)).toHaveLength(1);
    expect(new Set(b.map((x) => x.data.nopLuc)).size).toBe(1);
    // lưu SAU khi nộp ⇒ từ chối, điểm không đổi
    const sau = await luuCau(tA, S1, l, "rb", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-1` });
    expect([sau.status, (await json(sau)).error?.code]).toEqual([409, "LUOT_DA_NOP"]);
    expect((await db.examAttempt.findUnique({ where: { id: l.luotId }, select: { totalScore: true } }))!.totalScore).toBe(2);
  });

  it("[BT-DB-09] BẢN GHIM: sửa/xoá đáp án đề sau khi bắt đầu KHÔNG đổi chấm và hình chiếu của lượt đang làm", async () => {
    const l = await bd(tA, S2, "ban", "bd-ban-00001");
    const truoc = JSON.stringify(l.cauHoi);
    // giáo viên đổi đáp án đúng + đổi đáp án câu ngắn NGAY SAU khi học viên bắt đầu
    await db.choice.updateMany({ where: { questionId: `${NS}q-mc` }, data: { isCorrect: false } });
    await db.choice.update({ where: { id: `${NS}c-mc-3` }, data: { isCorrect: true } });
    await db.question.update({ where: { id: `${NS}q-short` }, data: { correctAnswer: "DOI-DAP-AN" } });
    try {
      expect(JSON.stringify((await json(await khoiPhuc(tA, S2, l.luotId))).data.cauHoi)).toBe(truoc);
      await luuCau(tA, S2, l, "ban", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` }); // đáp án CŨ vẫn là đúng theo bản ghim
      await luuCau(tA, S2, l, "ban", "short", { dang: "ngan", vanBan: "secret-robot" });
      const r = await nop(tA, S2, l.luotId, { phienBanDe: l.phienBanDe, khoaGuiLai: "nop-ban-00001" });
      expect((await json(r)).data.trangThai).toBe("DA_CHAM");
      expect((await db.examAttempt.findUnique({ where: { id: l.luotId }, select: { totalScore: true } }))!.totalScore).toBe(4);
    } finally {
      await db.choice.updateMany({ where: { questionId: `${NS}q-mc` }, data: { isCorrect: false } });
      await db.choice.update({ where: { id: `${NS}c-mc-2` }, data: { isCorrect: true } });
      await db.question.update({ where: { id: `${NS}q-short` }, data: { correctAnswer: "SECRET-Robot" } });
    }
  });

  it("[BT-DB-10] đề có câu lỗi / dạng CODE ⇒ KHÔNG bắt đầu được; không tạo lượt", async () => {
    for (const e of ["bad", "code"]) {
      const r = await batDau(tA, S1, e, `bd-loi-${e}-001`);
      expect([r.status, (await json(r)).error?.code], e).toEqual([422, "DE_CHUA_HO_TRO"]);
      expect(await db.examAttempt.count({ where: { examId: E(e), studentId: S1 } })).toBe(0);
    }
  });

  it("[BT-DB-11] quyền: nhà khác / anh-chị-em / học viên không ghi danh ⇒ 404; lượt không thuộc học viên ⇒ 404", async () => {
    const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
    expect(await ma(await batDau(tB, S1, "mix", "bd-nk-000001"))).toEqual([404, "NOT_FOUND"]); // B xin học viên nhà A
    expect((await batDau(tB, S3, "mix", "bd-nk-000003")).status).toBe(404); // đề của lớp khác
    const l = await bd(tA, S2, "auto", "bd-nk-00000a");
    expect((await khoiPhuc(tA, S1, l.luotId)).status).toBe(404); // lượt của S2, hỏi bằng S1 (anh/chị/em cùng nhà)
    expect((await luuCau(tA, S1, l, "auto", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` })).status).toBe(404);
    expect((await nop(tA, S1, l.luotId, { phienBanDe: l.phienBanDe, khoaGuiLai: "nop-nk-00001" })).status).toBe(404);
    expect((await ketQua(tA, S1, l.luotId)).status).toBe(404);
    expect((await batDau(tA, S1, "l2", "bd-l2-000001")).status).toBe(404); // đề lớp khác
    await db.enrollment.update({ where: { id: `${NS}dk1` }, data: { status: "CANCELLED" } as never });
    try {
      expect((await batDau(tA, S1, "hide", "bd-nghi-00001")).status).toBe(404); // ghi danh đã nghỉ
    } finally {
      await db.enrollment.update({ where: { id: `${NS}dk1` }, data: { status: "ACTIVE" } as never });
    }
  });

  it("[BT-DB-12] kết quả: xemLai chỉ khi đã chấm + showResultAfterSubmit; KHÔNG đáp án đúng", async () => {
    const hien = (await db.examAttempt.findFirst({ where: { examId: E("auto"), studentId: S1, status: "GRADED" }, select: { id: true } }))!.id;
    const kq = (await json(await ketQua(tA, S1, hien))).data;
    expect(kq.trangThai).toBe("DA_CHAM");
    // phụ huynh: điểm chỉ khi cấu hình `homework.showScoreToParent` bật — mock getSetting=false ⇒ ẩn; xemLai null
    expect([kq.diem, kq.xemLai]).toEqual([null, null]);
    const hs = await json(await ketQua(tA, S1, hien));
    expect(JSON.stringify(hs)).not.toContain("SECRET");
    // đề ẩn kết quả
    const luotAn = (await db.examAttempt.findFirst({ where: { examId: E("hide"), studentId: S2 }, select: { id: true } }))!.id;
    const an = (await json(await ketQua(tA, S2, luotAn))).data;
    expect([an.diem, an.dat, an.nhanXet, an.xemLai]).toEqual([null, null, null, null]);
  });

  it("[BT-DB-13] phiên chế độ học sinh: làm bài của CHÍNH mình; anh/chị/em ⇒ 403; học sinh thấy điểm + xemLai", async () => {
    const tok = await dangNhap(PHONE.A, 3);
    await quyDinhDongY(req("/x", {}, bearer(tok)));
    await db.mobileSession.updateMany({ where: { userId: ids.A!, thuHoiLuc: null, maThietBi: "00000000-0000-4000-d000-000000000003" }, data: { hocSinhId: S1, hocSinhTuLuc: new Date() } });
    const l = await bd(tok, S1, "late", "bd-hs-000001");
    await luuCau(tok, S1, l, "late", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` });
    expect((await nop(tok, S1, l.luotId, { phienBanDe: l.phienBanDe, khoaGuiLai: "nop-hs-000001" })).status).toBe(200);
    const kq = (await json(await ketQua(tok, S1, l.luotId))).data;
    expect([kq.trangThai, kq.diem, kq.xemLai?.length]).toEqual(["DA_CHAM", 2, 1]); // học sinh luôn thấy điểm của mình
    expect(JSON.stringify(kq)).not.toContain("correct");
    expect((await batDau(tok, S2, "mix", "bd-hs-000002")).status).toBe(403);
    expect((await khoiPhuc(tok, S2, l.luotId)).status).toBe(403);
  });

  it("[BT-DB-14] lỗi GIỮA CHỪNG lúc nộp ⇒ cuộn lại hoàn toàn (điểm câu, lượt, bài về nhà)", async () => {
    await deThi("rb2", [["mc", 2], ["num", 2]], { maxAttempts: 2 });
    await db.homeworkAssignment.create({ data: { classSessionId: `${NS}buoi2`, examId: E("rb2"), studentId: S1, status: "ASSIGNED" } as never });
    const l2 = await bd(tA, S1, "rb2", "bd-rb2-00001");
    await luuCau(tA, S1, l2, "rb2", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` });
    await luuCau(tA, S1, l2, "rb2", "num", { dang: "nhap_so", giaTri: "60", donVi: "cm" });
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION btdb_boom() RETURNS trigger AS $f$ BEGIN IF NEW.status::text = 'GRADED' THEN RAISE EXCEPTION 'btdb boom'; END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS btdb_boom_trg ON "ExamAttempt"`);
    await db.$executeRawUnsafe(`CREATE TRIGGER btdb_boom_trg BEFORE UPDATE ON "ExamAttempt" FOR EACH ROW EXECUTE FUNCTION btdb_boom()`);
    try {
      const r = await nop(tA, S1, l2.luotId, { phienBanDe: l2.phienBanDe, khoaGuiLai: "nop-rb2-00001" });
      expect(r.status).toBeGreaterThanOrEqual(500);
      const luot = await db.examAttempt.findUnique({ where: { id: l2.luotId }, select: { status: true, submittedAt: true, totalScore: true } });
      expect([luot!.status, luot!.submittedAt, luot!.totalScore]).toEqual(["IN_PROGRESS", null, null]);
      const hang = await db.examAnswer.findMany({ where: { attemptId: l2.luotId }, select: { isCorrect: true, score: true } });
      expect(hang.every((h) => h.isCorrect === null)).toBe(true); // điểm từng câu ĐÃ cuộn lại
      expect((await db.homeworkAssignment.findFirst({ where: { studentId: S1, examId: E("rb2") } }))!.status).toBe("ASSIGNED");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS btdb_boom_trg ON "ExamAttempt"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS btdb_boom()`);
    }
    const lai = await nop(tA, S1, l2.luotId, { phienBanDe: l2.phienBanDe, khoaGuiLai: "nop-rb2-00001" });
    expect([lai.status, (await json(lai)).data.trungLap]).toEqual([200, false]); // sự cố qua đi ⇒ nộp được, không để lại dấu «đã nộp»
  });

  it("[BT-DB-15] câu nộp sản phẩm: chỉ nhận vé tải lên ĐÃ XÁC MINH của đúng học viên/lượt/câu; nộp xong ⇒ ATTACHED", async () => {
    const l = await bd(tA, S2, "vid", "bd-vid-000001");
    const ve = (id: string, sv: string, o: Record<string, unknown> = {}) =>
      db.mobileUpload.create({ data: { id: `${NS}up-${id}`, parentUserId: ids.A!, studentId: sv, purpose: "EXAM_ANSWER", attemptId: l.luotId, examQuestionId: EQ("vid", "video"), storageKey: `${NS}key-${id}`, fileName: "v.mp4", declaredMime: "video/mp4", declaredSize: 1000, expiresAt: new Date(Date.now() + 3_600_000), ...o } as never });
    await ve("chua", S2); // ISSUED (chưa xác minh)
    await ve("ok", S2, { status: "UPLOADED", verifiedAt: new Date(), actualSize: 1000 });
    await ve("khac", S1, { status: "UPLOADED" }); // của học viên khác
    await ve("cauKhac", S2, { status: "UPLOADED", examQuestionId: EQ("vid", "mc") }); // gắn câu khác
    const ma = async (id: string) => (await luuCau(tA, S2, l, "vid", "video", { dang: "nop_san_pham", tepIds: [`${NS}up-${id}`] })).status;
    expect(await ma("chua")).toBe(422);
    expect(await ma("khac")).toBe(422);
    expect(await ma("cauKhac")).toBe(422);
    expect(await ma("khongco")).toBe(422);
    expect(await ma("ok")).toBe(200);
    await luuCau(tA, S2, l, "vid", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` });
    const r = await nop(tA, S2, l.luotId, { phienBanDe: l.phienBanDe, khoaGuiLai: "nop-vid-00001" });
    expect((await json(r)).data.trangThai).toBe("CHO_CHAM"); // câu nộp sản phẩm chấm tay
    expect((await db.mobileUpload.findUnique({ where: { id: `${NS}up-ok` } }))!.status).toBe("ATTACHED");
    expect((await db.mobileUpload.findUnique({ where: { id: `${NS}up-chua` } }))!.status).toBe("ISSUED"); // vé chưa dùng không bị gắn
    expect((await db.mobileUpload.findUnique({ where: { id: `${NS}up-cauKhac` } }))!.status).toBe("UPLOADED"); // vé không nằm trong câu trả lời ⇒ không bị gắn
  });

  it("[BT-DB-16] cờ TẮT ⇒ 404; nộp trễ theo chính sách (mặc định nhận câu đã lưu + cờ tre)", async () => {
    const l = await bd(tA, S1, "late", "bd-trem-00001");
    await luuCau(tA, S1, l, "late", "mc", { dang: "chon_mot", luaChonId: `${NS}c-mc-2` });
    await db.examAttempt.update({ where: { id: l.luotId }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "false";
    expect((await batDau(tA, S1, "late", "bd-tat-000001")).status).toBe(404);
    expect((await khoiPhuc(tA, S1, l.luotId)).status).toBe(404);
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
    const r = await nop(tA, S1, l.luotId, { phienBanDe: l.phienBanDe, khoaGuiLai: "nop-trem-0001" });
    const d = (await json(r)).data;
    expect([r.status, d.tre, d.trangThai]).toEqual([200, true, "DA_CHAM"]); // mặc định = như web: chấm các câu đã lưu, gắn cờ trễ
  });
});
