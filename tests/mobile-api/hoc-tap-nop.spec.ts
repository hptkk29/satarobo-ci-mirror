import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web: chặn `@/lib/auth` để mọi đường lỡ gọi `auth()` thật sẽ đỏ.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
// Cho ca DB-11 chạy khi ngân sách nộp bài của phụ huynh đã cạn bởi các ca trước: chỉ vượt QUA bộ đếm, không đổi logic nào khác.
const mockGioiHan = vi.hoisted(() => ({ tat: false }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: (a: Parameters<typeof that.rateLimit>[0]) => (mockGioiHan.tat ? Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) : that.rateLimit(a)) };
});
vi.mock("@/lib/storage/signed-url", () => ({ keyFromPublicUrl: () => null, signedMediaUrl: async (k: string) => k }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as ctBaiTap } from "@/app/api/mobile/v1/students/[studentId]/learning/assignments/[assignmentId]/route";
import { POST as nopRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/assignments/[assignmentId]/submissions/route";
import { db } from "@/lib/db";
import { GIOI_HAN_NOP_BAI } from "@/lib/mobile-api/dich-vu/hoc-tap-nop";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [NOP-DB] B-LMS2 — NỘP BÀI TẬP (văn bản) trên POSTGRES THẬT, gọi thẳng route handler.
 *   [NOP-DB-01] nộp hợp lệ ⇒ 200 DA_NOP, phiên bản 1; DB: bản nộp + MỘT dòng lịch sử; KHÔNG sinh giao dịch SataCoin; đọc lại thấy bài nộp
 *   [NOP-DB-02] ĐỒNG THỜI 8 lượt cùng khoá ⇒ đúng MỘT bản nộp + MỘT phiên bản; còn lại `trungLap`; gửi lại cùng khoá SAU KHI bài đã đóng vẫn trả kết quả cũ
 *   [NOP-DB-03] nộp lại nội dung KHÁC ⇒ phiên bản 2, lịch sử giữ bản 1; cùng nội dung khoá khác ⇒ KHÔNG thêm phiên bản; hai lượt khác nội dung đồng thời ⇒ hai phiên bản liên tiếp, không trùng số
 *   [NOP-DB-04] cửa nộp do MÁY CHỦ: quá hạn + còn cửa bù ⇒ NOP_TRE; hết hạn / bài CLOSED ⇒ 422 DA_DONG và KHÔNG ghi gì
 *   [NOP-DB-05] đã CHẤM ⇒ 409 DA_CHAM, không đổi bài
 *   [NOP-DB-06] tệp / video / bài chỉ-nhận-tệp ⇒ 422 TEP_CHUA_HO_TRO, không ghi gì; trường lạ (điểm, trạng thái…) ⇒ 400; thiếu nội dung ⇒ 400
 *   [NOP-DB-07] nộp lại KHÔNG xoá tệp đã nộp từ web
 *   [NOP-DB-08] quyền: nhà khác / bài nháp / bài lớp khác / ghi danh đã nghỉ ⇒ cùng 404; cờ TẮT ⇒ 404
 *   [NOP-DB-09] phiên chế độ học sinh: nộp bài của CHÍNH MÌNH được; anh/chị/em ⇒ 403
 *   [NOP-DB-10] trần 30 lượt / 10 phút theo phụ huynh ⇒ 429 + Retry-After, lượt bị chặn không ghi gì
 * Dữ liệu tiền tố `nopdb-`; dọn ở afterAll.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "nopdb-";
const MK = "Mat-khau-test-2026";
const PHONE = { A: "0966800001", B: "0966800002" };
let dem = 0;
const ip = () => `10.95.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const ids: Record<string, string> = {};
const gio = (ph: number) => new Date(Date.now() + ph * 60_000);
const bearer = (t: string) => `Bearer ${t}`;
// Cổng chế độ học sinh đọc ĐƯỜNG DẪN THẬT: dùng URL thật cho mọi lời gọi.
const url = (sv: string, aid: string) => `/api/mobile/v1/students/${sv}/learning/assignments/${aid}/submissions`;
const ctx = (sv: string, aid: string) => ({ params: Promise.resolve({ studentId: sv, assignmentId: aid }) as never });

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/x", { dinhDanh: phone, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-e000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  if (r.status !== 200) throw new Error(`đăng nhập ${r.status}`);
  return ((await json(r)).data as { accessToken: string }).accessToken;
}

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.assignmentSubmissionVersion.deleteMany({ where: { submission: { studentId: { startsWith: NS } } } });
  await db.assignmentSubmissionFile.deleteMany({ where: { submission: { studentId: { startsWith: NS } } } });
  await db.assignmentSubmission.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.assignment.deleteMany({ where: { id: { startsWith: NS } } });
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

describe.skipIf(!RUN)("[NOP-DB] nộp bài tập — Postgres thật", () => {
  let tA = "";
  let tB = "";
  const S1 = `${NS}s1`;
  const S2 = `${NS}s2`;
  const S3 = `${NS}s3`;
  const L1 = `${NS}l1`;
  const L2 = `${NS}l2`;
  const A = (k: string) => `${NS}${k}`;

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const k of ["A", "B"] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: `${NS}cs`, name: "Cơ sở NOP", slug: `${NS}cs`, address: "Địa chỉ" } });
    await db.course.create({ data: { id: `${NS}kh`, name: "Khoá NOP", slug: `${NS}kh`, totalSessions: 12 } });
    for (const l of [L1, L2]) await db.class.create({ data: { id: l, name: `Lớp ${l}`, classCode: l, courseId: `${NS}kh`, centerId: `${NS}cs`, status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: S1, name: `${NS}An`, parentUserId: ids.A, centerId: `${NS}cs` } as never });
    await db.student.create({ data: { id: S2, name: `${NS}Binh`, parentUserId: ids.A, centerId: `${NS}cs` } as never });
    await db.student.create({ data: { id: S3, name: `${NS}Cuong`, parentUserId: ids.B, centerId: `${NS}cs` } as never });
    const dk = (id: string, sv: string, lop: string) => db.enrollment.create({ data: { id: `${NS}${id}`, studentId: sv, classId: lop, courseId: `${NS}kh`, status: "ACTIVE", centerId: `${NS}cs` } as never });
    await dk("dk1", S1, L1);
    await dk("dk2", S2, L1);
    await dk("dk3", S3, L2);
    const bt = (id: string, lop: string, extra: Record<string, unknown>) => db.assignment.create({ data: { id: A(id), title: `BT ${id}`, description: `Mô tả ${id}`, classId: lop, totalPoints: 10, status: "PUBLISHED", allowText: true, allowFile: true, ...extra } as never });
    await bt("mo", L1, { dueAt: gio(60 * 24) });
    await bt("mo2", L1, { dueAt: gio(60 * 24) });
    await bt("mo3", L1, { dueAt: gio(60 * 24) });
    await bt("tre", L1, { dueAt: gio(-60), lateUntil: gio(60 * 24) });
    await bt("han", L1, { dueAt: gio(-60 * 24) });
    await bt("dong", L1, { status: "CLOSED" });
    await bt("cham", L1, { dueAt: gio(60 * 24) });
    await bt("video", L1, { dueAt: gio(60 * 24), requireVideo: true });
    await bt("chitep", L1, { dueAt: gio(60 * 24), allowText: false });
    await bt("nhap", L1, { status: "DRAFT" });
    await bt("lopkhac", L2, { dueAt: gio(60 * 24) });
    await bt("tep", L1, { dueAt: gio(60 * 24) });
    await bt("rl", L2, { dueAt: gio(60 * 24) });
    await db.assignmentSubmission.create({ data: { assignmentId: A("cham"), studentId: S1, textAnswer: "Bài đã chấm", status: "GRADED", score: 9, submittedAt: gio(-100), gradedAt: gio(-50) } as never });
    const subTep = await db.assignmentSubmission.create({ data: { assignmentId: A("tep"), studentId: S1, textAnswer: "bản web", status: "SUBMITTED", submittedAt: gio(-10), fileUrl: "https://r2.test/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg" } as never });
    await db.assignmentSubmissionFile.create({ data: { submissionId: subTep.id, fileUrl: "https://r2.test/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg" } });
    tA = await dangNhap(PHONE.A, 1);
    tB = await dangNhap(PHONE.B, 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("/x", {}, bearer(t)));
  }, 90_000);
  afterAll(async () => {
    delete process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED;
    await don();
  });
  beforeEach(() => {
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
  });

  const nop = (tok: string, sv: string, aid: string, than: unknown) => nopRoute(req(url(sv, aid), than, bearer(tok)), ctx(sv, aid));
  const versions = (sv: string, aid: string) => db.assignmentSubmissionVersion.findMany({ where: { submission: { studentId: sv, assignmentId: aid } }, orderBy: { versionNo: "asc" } });
  const subOf = (sv: string, aid: string) => db.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: aid, studentId: sv } } });

  it("[NOP-DB-01] nộp hợp lệ ⇒ DA_NOP, phiên bản 1, MỘT dòng lịch sử, không sinh giao dịch SataCoin", async () => {
    const truocCoin = await db.sataCoinTransaction.count({ where: { studentId: S1 } });
    const r = await nop(tA, S1, A("mo"), { khoaGuiLai: "nop-khoa-0001", vanBan: "  Bài làm của An  " });
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect([d.trangThaiNop, d.trungLap, d.phienBan]).toEqual(["DA_NOP", false, 1]);
    const sub = await subOf(S1, A("mo"));
    expect([sub!.textAnswer, sub!.status]).toEqual(["Bài làm của An", "SUBMITTED"]); // đã cắt khoảng trắng
    const v = await versions(S1, A("mo"));
    expect(v).toHaveLength(1);
    expect([v[0]!.versionNo, v[0]!.textAnswer, v[0]!.idempotencyKey, v[0]!.source]).toEqual([1, "Bài làm của An", "nop-khoa-0001", "MOBILE"]);
    expect(await db.sataCoinTransaction.count({ where: { studentId: S1 } })).toBe(truocCoin); // KHÔNG tự thưởng coin khi nộp bài
    const ct = (await json(await ctBaiTap(req(`/api/mobile/v1/students/${S1}/learning/assignments/${A("mo")}`, undefined, bearer(tA)), { params: Promise.resolve({ studentId: S1, assignmentId: A("mo") }) as never }))).data;
    expect([ct.trangThaiNop, ct.baiNop.vanBan]).toEqual(["DA_NOP", "Bài làm của An"]);
  });

  it("[NOP-DB-02] 8 lượt ĐỒNG THỜI cùng khoá ⇒ MỘT bản nộp + MỘT phiên bản; gửi lại sau khi đóng vẫn trả kết quả cũ", async () => {
    const kq = await Promise.all(Array.from({ length: 8 }, () => nop(tA, S2, A("mo2"), { khoaGuiLai: "nop-khoa-dua-1", vanBan: "Bài của Bình" })));
    expect(kq.map((r) => r.status)).toEqual(Array(8).fill(200));
    const body = await Promise.all(kq.map(json));
    expect(body.filter((b) => b.data.trungLap === false)).toHaveLength(1);
    expect(await db.assignmentSubmission.count({ where: { assignmentId: A("mo2"), studentId: S2 } })).toBe(1);
    expect(await versions(S2, A("mo2"))).toHaveLength(1);
    // Bài đóng SAU lượt đầu: gửi lại cùng khoá vẫn thấy kết quả cũ (không đổi thành lỗi DA_DONG).
    await db.assignment.update({ where: { id: A("mo2") }, data: { status: "CLOSED" } });
    const lai = await nop(tA, S2, A("mo2"), { khoaGuiLai: "nop-khoa-dua-1", vanBan: "Bài của Bình" });
    expect(lai.status).toBe(200);
    expect((await json(lai)).data.trungLap).toBe(true);
    const moi = await nop(tA, S2, A("mo2"), { khoaGuiLai: "nop-khoa-khac-1", vanBan: "Sửa sau khi đóng" });
    expect(moi.status).toBe(422); // khoá KHÁC (lượt mới thật) thì cửa đóng chặn
  });

  it("[NOP-DB-03] nộp lại nội dung khác ⇒ phiên bản 2 + lịch sử giữ bản 1; cùng nội dung khoá khác ⇒ không thêm; hai lượt đồng thời ⇒ hai phiên bản liên tiếp", async () => {
    await nop(tA, S1, A("mo3"), { khoaGuiLai: "nop-khoa-3-001", vanBan: "Bản 1" });
    const r2 = await json(await nop(tA, S1, A("mo3"), { khoaGuiLai: "nop-khoa-3-002", vanBan: "Bản 2 sửa lại" }));
    expect([r2.data.phienBan, r2.data.trungLap]).toEqual([2, false]);
    expect((await subOf(S1, A("mo3")))!.textAnswer).toBe("Bản 2 sửa lại");
    expect((await versions(S1, A("mo3"))).map((v) => [v.versionNo, v.textAnswer])).toEqual([[1, "Bản 1"], [2, "Bản 2 sửa lại"]]); // bản cũ KHÔNG mất
    const giong = await json(await nop(tA, S1, A("mo3"), { khoaGuiLai: "nop-khoa-3-003", vanBan: "Bản 2 sửa lại" }));
    expect([giong.data.trungLap, giong.data.phienBan]).toEqual([true, 2]); // khoá khác, cùng nội dung ⇒ lành tính
    expect(await versions(S1, A("mo3"))).toHaveLength(2);
    const hai = await Promise.all([nop(tA, S1, A("mo3"), { khoaGuiLai: "nop-khoa-3-004", vanBan: "Song song X" }), nop(tA, S1, A("mo3"), { khoaGuiLai: "nop-khoa-3-005", vanBan: "Song song Y" })]);
    expect(hai.map((r) => r.status)).toEqual([200, 200]);
    expect((await versions(S1, A("mo3"))).map((v) => v.versionNo)).toEqual([1, 2, 3, 4]); // không trùng số, không mất dòng
  });

  it("[NOP-DB-04] cửa nộp do máy chủ: quá hạn + cửa bù ⇒ NOP_TRE; hết hạn / CLOSED ⇒ 422 DA_DONG, không ghi gì", async () => {
    const tre = await json(await nop(tA, S1, A("tre"), { khoaGuiLai: "nop-khoa-tre-1", vanBan: "Nộp trong cửa bù" }));
    expect([tre.data.trangThaiNop, (await subOf(S1, A("tre")))!.status]).toEqual(["NOP_TRE", "LATE"]);
    for (const aid of [A("han"), A("dong")]) {
      const r = await nop(tA, S1, aid, { khoaGuiLai: `nop-khoa-${aid.slice(-4)}`, vanBan: "Muộn rồi" });
      expect([r.status, (await json(r)).error?.code]).toEqual([422, "DA_DONG"]);
      expect(await subOf(S1, aid)).toBeNull();
    }
  });

  it("[NOP-DB-05] đã CHẤM ⇒ 409 DA_CHAM, bài không đổi", async () => {
    const r = await nop(tA, S1, A("cham"), { khoaGuiLai: "nop-khoa-cham-1", vanBan: "Cố nộp lại" });
    expect([r.status, (await json(r)).error?.code]).toEqual([409, "DA_CHAM"]);
    const sub = await subOf(S1, A("cham"));
    expect([sub!.textAnswer, sub!.status, sub!.score]).toEqual(["Bài đã chấm", "GRADED", 9]);
    expect(await versions(S1, A("cham"))).toHaveLength(0);
  });

  it("[NOP-DB-06] tệp / video / bài chỉ-nhận-tệp ⇒ 422 TEP_CHUA_HO_TRO; trường lạ ⇒ 400; thiếu nội dung ⇒ 400; không ghi gì", async () => {
    const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
    expect(await ma(await nop(tA, S2, A("mo"), { khoaGuiLai: "nop-khoa-tep-01", vanBan: "x", tepIds: ["t1"] }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // vé không có thật (B-LMS2: tệp đi qua vé tải lên)
    expect(await ma(await nop(tA, S2, A("video"), { khoaGuiLai: "nop-khoa-vid-01", vanBan: "x" }))).toEqual([422, "TEP_CHUA_HO_TRO"]);
    expect(await ma(await nop(tA, S2, A("chitep"), { khoaGuiLai: "nop-khoa-ct-001", vanBan: "x" }))).toEqual([422, "TEP_CHUA_HO_TRO"]);
    for (const them of [{ diem: 10 }, { score: 10 }, { status: "GRADED" }, { trangThaiNop: "DA_CHAM" }, { studentId: S1 }]) {
      expect(await ma(await nop(tA, S2, A("mo"), { khoaGuiLai: "nop-khoa-la-001", vanBan: "x", ...them }))).toEqual([400, "VALIDATION"]); // strict: máy chủ TỪ CHỐI trường lạ, không bỏ qua im lặng
    }
    expect(await ma(await nop(tA, S2, A("mo"), { khoaGuiLai: "nop-khoa-trong1", vanBan: "   " }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await nop(tA, S2, A("mo"), { khoaGuiLai: "ngan", vanBan: "x" }))).toEqual([400, "VALIDATION"]);
    for (const aid of [A("video"), A("chitep")]) expect(await subOf(S2, aid)).toBeNull();
    expect(await db.assignmentSubmissionVersion.count({ where: { idempotencyKey: { in: ["nop-khoa-tep-01", "nop-khoa-vid-01", "nop-khoa-ct-001", "nop-khoa-la-001", "nop-khoa-trong1"] } } })).toBe(0);
  });

  it("[NOP-DB-07] nộp lại KHÔNG xoá tệp đã nộp từ web", async () => {
    const r = await nop(tA, S1, A("tep"), { khoaGuiLai: "nop-khoa-tep-w1", vanBan: "bản mobile mới" });
    expect(r.status).toBe(200);
    const sub = await subOf(S1, A("tep"));
    expect(sub!.textAnswer).toBe("bản mobile mới");
    expect(sub!.fileUrl).toBe("https://r2.test/a.jpg"); // cột cũ giữ nguyên
    expect(await db.assignmentSubmissionFile.count({ where: { submissionId: sub!.id } })).toBe(1); // danh sách tệp giữ nguyên
  });

  it("[NOP-DB-08] quyền: nhà khác / nháp / lớp khác / ghi danh đã nghỉ ⇒ cùng 404; cờ TẮT ⇒ 404", async () => {
    const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
    expect(await ma(await nop(tB, S1, A("mo"), { khoaGuiLai: "nop-khoa-nk-001", vanBan: "x" }))).toEqual([404, "NOT_FOUND"]); // B xin học viên nhà A
    expect(await ma(await nop(tA, S1, A("nhap"), { khoaGuiLai: "nop-khoa-nh-001", vanBan: "x" }))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await nop(tA, S1, A("lopkhac"), { khoaGuiLai: "nop-khoa-lk-001", vanBan: "x" }))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await nop(tA, S1, "khong-co", { khoaGuiLai: "nop-khoa-kc-001", vanBan: "x" }))).toEqual([404, "NOT_FOUND"]);
    await db.enrollment.update({ where: { id: A("dk2") }, data: { status: "CANCELLED" } as never });
    try {
      expect(await ma(await nop(tA, S2, A("mo"), { khoaGuiLai: "nop-khoa-gd-001", vanBan: "x" }))).toEqual([404, "NOT_FOUND"]);
    } finally {
      await db.enrollment.update({ where: { id: A("dk2") }, data: { status: "ACTIVE" } as never });
    }
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "false";
    expect(await ma(await nop(tA, S1, A("mo"), { khoaGuiLai: "nop-khoa-co-001", vanBan: "x" }))).toEqual([404, "NOT_FOUND"]);
    expect(await subOf(S2, A("mo"))).toBeNull();
  });

  it("[NOP-DB-09] phiên chế độ học sinh: nộp bài của CHÍNH MÌNH được; anh/chị/em ⇒ 403", async () => {
    const tok = await dangNhap(PHONE.A, 3);
    await quyDinhDongY(req("/x", {}, bearer(tok)));
    await db.mobileSession.updateMany({ where: { userId: ids.A!, thuHoiLuc: null, maThietBi: "00000000-0000-4000-e000-000000000003" }, data: { hocSinhId: S1, hocSinhTuLuc: new Date() } });
    const own = await nop(tok, S1, A("mo"), { khoaGuiLai: "nop-khoa-hs-001", vanBan: "Con tự nộp" });
    expect(own.status).toBe(200);
    expect((await subOf(S1, A("mo")))!.textAnswer).toBe("Con tự nộp");
    const sib = await nop(tok, S2, A("mo"), { khoaGuiLai: "nop-khoa-hs-002", vanBan: "Nộp hộ anh/chị/em" });
    expect(sib.status).toBe(403);
    expect(await subOf(S2, A("mo"))).toBeNull();
  });

  it("[NOP-DB-10] trần 30 lượt / 10 phút theo phụ huynh ⇒ 429 + Retry-After; lượt bị chặn không ghi gì", async () => {
    const kq: Response[] = [];
    for (let i = 0; i < GIOI_HAN_NOP_BAI.max + 5; i++) kq.push(await nop(tB, S3, A("rl"), { khoaGuiLai: `nop-khoa-rl-${String(i).padStart(3, "0")}`, vanBan: `Bản số ${i}` }));
    const bi = kq.filter((r) => r.status === 429);
    expect(bi.length).toBeGreaterThanOrEqual(1);
    expect(kq.length - bi.length).toBeLessThanOrEqual(GIOI_HAN_NOP_BAI.max);
    expect(Number(bi[0]!.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await db.assignmentSubmissionVersion.count({ where: { submission: { studentId: S3 } } })).toBeLessThanOrEqual(kq.length - bi.length);
  }, 120_000);

  it("[NOP-DB-11] lỗi GIỮA CHỪNG (ghi lịch sử nổ) ⇒ cuộn lại: bản nộp mới không lưu, bản cũ nguyên vẹn, nộp lại được sau khi hết lỗi", async () => {
    mockGioiHan.tat = true;
    await nop(tA, S1, A("mo3"), { khoaGuiLai: "nop-khoa-rb-0001", vanBan: "Bản sạch trước khi lỗi" });
    const truoc = await subOf(S1, A("mo3"));
    const soVerTruoc = (await versions(S1, A("mo3"))).length;
    // Trigger tạm (chỉ DB test): bản ghi lịch sử mang nội dung «BOOM» làm câu INSERT nổ SAU khi `upsert` đã ghi cột hiện hành trong cùng giao dịch.
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION nopdb_boom() RETURNS trigger AS $f$ BEGIN IF NEW."textAnswer" = 'BOOM' THEN RAISE EXCEPTION 'nopdb boom'; END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS nopdb_boom_trg ON "AssignmentSubmissionVersion"`);
    await db.$executeRawUnsafe(`CREATE TRIGGER nopdb_boom_trg BEFORE INSERT ON "AssignmentSubmissionVersion" FOR EACH ROW EXECUTE FUNCTION nopdb_boom()`);
    try {
      const r = await nop(tA, S1, A("mo3"), { khoaGuiLai: "nop-khoa-rb-0002", vanBan: "BOOM" });
      expect(r.status).toBeGreaterThanOrEqual(500); // lỗi hệ thống, KHÔNG báo thành công
      const sau = await subOf(S1, A("mo3"));
      expect([sau!.textAnswer, sau!.status, sau!.submittedAt?.getTime()]).toEqual([truoc!.textAnswer, truoc!.status, truoc!.submittedAt?.getTime()]); // upsert đã BỊ CUỘN LẠI
      expect((await versions(S1, A("mo3"))).length).toBe(soVerTruoc);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS nopdb_boom_trg ON "AssignmentSubmissionVersion"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS nopdb_boom()`);
    }
    const lai = await nop(tA, S1, A("mo3"), { khoaGuiLai: "nop-khoa-rb-0002", vanBan: "BOOM" });
    expect(lai.status).toBe(200); // cùng khoá gửi lại sau sự cố: nộp được (lượt hỏng KHÔNG để lại dấu «đã dùng khoá»)
    expect((await json(lai)).data.trungLap).toBe(false);
    mockGioiHan.tat = false;
  });
});
