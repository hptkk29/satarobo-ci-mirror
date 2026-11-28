import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web: chặn `@/lib/auth` để mọi đường lỡ gọi `auth()` thật sẽ đỏ.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
// Cấu hình `homework.showScoreToParent` là ranh giới cấu hình (có test riêng ở lib/settings): ở đây điều khiển được để kiểm cả hai chiều.
const cauHinh = { showScoreToParent: false };
vi.mock("@/lib/settings/service", async (goc) => ({
  ...(await goc<typeof import("@/lib/settings/service")>()),
  getSetting: vi.fn(async (k: string) => (k === "homework.showScoreToParent" ? cauHinh.showScoreToParent : null)),
}));
// R2 không có ở máy test: bộ ký URL giả — chỉ URL thuộc `https://r2.test/` mới «ký» được (đối chứng fail-closed cho mọi URL khác).
vi.mock("@/lib/storage/signed-url", () => ({
  keyFromPublicUrl: (u: string) => (u.startsWith("https://r2.test/") ? u.slice("https://r2.test/".length) : null),
  signedMediaUrl: async (key: string) => `https://r2.test/ky/${key}?X-Expires=900`,
}));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as dsBaiTap } from "@/app/api/mobile/v1/students/[studentId]/learning/assignments/route";
import { GET as ctBaiTap } from "@/app/api/mobile/v1/students/[studentId]/learning/assignments/[assignmentId]/route";
import { GET as dsBaiThi } from "@/app/api/mobile/v1/students/[studentId]/learning/exams/route";
import { GET as ctBaiThi } from "@/app/api/mobile/v1/students/[studentId]/learning/exams/[examId]/route";
import { GET as dsBaiHoc } from "@/app/api/mobile/v1/students/[studentId]/learning/lessons/route";
import { GET as ctBaiHoc } from "@/app/api/mobile/v1/students/[studentId]/learning/lessons/[lessonId]/route";
import { GET as ketQuaGet } from "@/app/api/mobile/v1/students/[studentId]/learning/results/route";
import { GET as baiTapTheoBuoi } from "@/app/api/mobile/v1/students/[studentId]/learning/session-homework/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [LMS-DB] B-LMS1 — API ĐỌC LMS (bài tập · bài thi · bài học · kết quả) trên POSTGRES THẬT, gọi thẳng route handler.
 *   [LMS-DB-01] cờ TẮT ⇒ 404 phong bì ở CẢ BẢY route, trước mọi truy vấn; cờ BẬT ⇒ đọc được
 *   [LMS-DB-02] bài tập: chỉ PUBLISHED/CLOSED của lớp học viên ĐANG HỌC; nháp / lớp khác / ghi danh đã nghỉ KHÔNG lộ; cửa nộp do MÁY CHỦ (mở · nộp trễ · đóng); trạng thái nộp đúng
 *   [LMS-DB-03] điểm: phụ huynh chỉ thấy khi `showScoreToParent` BẬT; chưa chấm ⇒ CHUA_CHAM; ẩn theo cấu hình ⇒ THEO_CAU_HINH; nhận xét chỉ khi ĐÃ CHẤM
 *   [LMS-DB-04] chi tiết bài tập: bài nộp CHỈ của chính học viên (anh/chị/em cùng lớp không thấy nội dung nhau); tệp ký ngắn hạn, URL không ký được ⇒ BỎ tệp (không rơi về URL công khai)
 *   [LMS-DB-05] cách ly: phụ huynh B xin bài của học viên nhà A ⇒ 404; id bài/đề/bài học của lớp khác ⇒ 404 (cùng khuôn «không có»)
 *   [LMS-DB-06] bài thi: đề của lớp + đề dùng chung đã giao riêng; đề NHÁP / lớp khác ẨN; `dangMo` theo giờ máy chủ; lượt dùng; KHÔNG câu hỏi/đáp án trong phản hồi
 *   [LMS-DB-07] kết quả: chỉ lượt/bài ĐÃ NỘP của chính học viên; điểm/nhận xét chỉ khi ĐÃ CHẤM + cho phép; `showResultAfterSubmit=false` ẩn điểm + nhận xét
 *   [LMS-DB-08] bài học: chỉ bài ĐÃ DẠY + tài liệu giáo viên ĐÃ GIAO cho chính lớp; giáo án nội bộ không lộ
 *   [LMS-DB-09] phiên CHẾ ĐỘ HỌC SINH: đọc được của CHÍNH MÌNH (điểm hiện kể cả khi ẩn với phụ huynh); anh/chị/em ⇒ 403
 * Dữ liệu tiền tố `lmsdb-`; dọn ở afterAll.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "lmsdb-";
const MK = "Mat-khau-test-2026";
const PHONE = { A: "0966600001", B: "0966600002" };
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const ids: Record<string, string> = {};
const gio = (offsetPhut: number) => new Date(Date.now() + offsetPhut * 60_000);

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/x", { dinhDanh: phone, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  if (r.status !== 200) throw new Error(`đăng nhập ${r.status}`);
  return ((await json(r)).data as { accessToken: string }).accessToken;
}
// `params` mang thêm id bài/đề/bài học tuỳ route: ép về `never` để dùng chung một helper cho cả bảy route (kiểm kiểu từng route không phải việc của ca này).
const ctx = (studentId: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ studentId, ...extra }) as never });
const bearer = (t: string) => `Bearer ${t}`;

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.examAnswer.deleteMany({ where: { attempt: { studentId: { startsWith: NS } } } });
  await db.examAttempt.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.homeworkAssignment.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.examQuestion.deleteMany({ where: { examId: { startsWith: NS } } });
  await db.exam.deleteMany({ where: { id: { startsWith: NS } } });
  await db.question.deleteMany({ where: { text: { startsWith: NS } } });
  await db.assignmentSubmissionFile.deleteMany({ where: { submission: { studentId: { startsWith: NS } } } });
  await db.assignmentSubmission.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.assignmentAttachment.deleteMany({ where: { assignmentId: { startsWith: NS } } });
  await db.assignmentDocument.deleteMany({ where: { assignmentId: { startsWith: NS } } });
  await db.assignment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.document.deleteMany({ where: { id: { startsWith: NS } } });
  await db.classSession.deleteMany({ where: { id: { startsWith: NS } } });
  await db.lesson.deleteMany({ where: { id: { startsWith: NS } } });
  await db.curriculum.deleteMany({ where: { id: { startsWith: NS } } });
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

describe.skipIf(!RUN)("[LMS-DB] API đọc LMS — Postgres thật", () => {
  let tA = "";
  let tB = "";
  const S1 = `${NS}s1`; // học viên nhà A, lớp L1
  const S2 = `${NS}s2`; // anh/chị/em, CÙNG lớp L1
  const S3 = `${NS}s3`; // nhà B, lớp L2
  const L1 = `${NS}l1`;
  const L2 = `${NS}l2`;

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const k of ["A", "B"] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: `${NS}cs`, name: "Cơ sở LMS", slug: `${NS}cs`, address: "Địa chỉ" } });
    await db.course.create({ data: { id: `${NS}kh`, name: "Khoá LMS", slug: `${NS}kh`, totalSessions: 12 } });
    for (const l of [L1, L2]) await db.class.create({ data: { id: l, name: `Lớp ${l}`, classCode: l, courseId: `${NS}kh`, centerId: `${NS}cs`, status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: S1, name: `${NS}An`, parentUserId: ids.A, centerId: `${NS}cs` } as never });
    await db.student.create({ data: { id: S2, name: `${NS}Binh`, parentUserId: ids.A, centerId: `${NS}cs` } as never });
    await db.student.create({ data: { id: S3, name: `${NS}Cuong`, parentUserId: ids.B, centerId: `${NS}cs` } as never });
    const ghiDanh = (id: string, sv: string, lop: string, status = "ACTIVE") => db.enrollment.create({ data: { id: `${NS}${id}`, studentId: sv, classId: lop, courseId: `${NS}kh`, status, centerId: `${NS}cs` } as never });
    await ghiDanh("dk1", S1, L1);
    await ghiDanh("dk2", S2, L1);
    await ghiDanh("dk3", S3, L2);

    // Bài tập của L1: mở · quá hạn đã đóng · nháp · lưu trữ · (L2: của lớp khác)
    const bt = (id: string, lop: string, extra: Record<string, unknown>) => db.assignment.create({ data: { id: `${NS}${id}`, title: `BT ${id}`, description: `Mô tả ${id}`, classId: lop, totalPoints: 10, ...extra } as never });
    await bt("bt-mo", L1, { status: "PUBLISHED", kind: "HOMEWORK", dueAt: gio(60 * 24), instructions: "Làm theo hướng dẫn", allowText: true, allowFile: true });
    await bt("bt-han", L1, { status: "PUBLISHED", dueAt: gio(-60 * 24) });
    await bt("bt-nhap", L1, { status: "DRAFT" });
    await bt("bt-luutru", L1, { status: "ARCHIVED" });
    await bt("bt-dong", L1, { status: "CLOSED" });
    await bt("bt-lopkhac", L2, { status: "PUBLISHED" });
    await db.assignmentAttachment.create({ data: { assignmentId: `${NS}bt-mo`, fileUrl: "https://r2.test/gv/de-bai.pdf", fileName: "de-bai.pdf", mimeType: "application/pdf" } });
    await db.assignmentAttachment.create({ data: { assignmentId: `${NS}bt-mo`, fileUrl: "https://nguoi-la.example/rac.pdf", fileName: "rac.pdf", mimeType: "application/pdf" } }); // URL không ký được ⇒ bị BỎ
    await db.document.create({ data: { id: `${NS}doc`, title: "Tài liệu giao", type: "PDF", fileUrl: "https://r2.test/doc/tl.pdf", fileName: "tl.pdf", fileSize: 10 } as never });
    await db.assignmentDocument.create({ data: { assignmentId: `${NS}bt-mo`, documentId: `${NS}doc` } as never });
    // Bài nộp: S1 đã chấm (điểm 8 + nhận xét); S2 nộp văn bản riêng (không được S1 thấy).
    const sub = await db.assignmentSubmission.create({ data: { assignmentId: `${NS}bt-mo`, studentId: S1, textAnswer: "Bài làm của An", status: "GRADED", score: 8, feedback: "Tốt lắm", submittedAt: gio(-30), gradedAt: gio(-10) } as never });
    await db.assignmentSubmissionFile.create({ data: { submissionId: sub.id, fileUrl: "https://r2.test/hs/an-bai.jpg", fileName: "an-bai.jpg", mimeType: "image/jpeg" } });
    await db.assignmentSubmission.create({ data: { assignmentId: `${NS}bt-mo`, studentId: S2, textAnswer: "BÍ MẬT của Bình", status: "SUBMITTED", submittedAt: gio(-20), feedback: "nhận xét nháp chưa chấm" } as never });
    await db.assignmentSubmission.create({ data: { assignmentId: `${NS}bt-dong`, studentId: S1, textAnswer: "nộp", status: "LATE", submittedAt: gio(-5) } as never });

    // Bài thi: L1 (mở, 2 lượt), L1 hết hạn, L1 nháp, L2 (lớp khác), dùng chung giao riêng cho S1.
    const q = await db.question.create({ data: { type: "MULTIPLE_CHOICE", text: `${NS}Câu hỏi bí mật`, correctAnswer: "ĐÁP-ÁN-BÍ-MẬT" } as never });
    const de = (id: string, lop: string | null, extra: Record<string, unknown>) => db.exam.create({ data: { id: `${NS}${id}`, title: `Đề ${id}`, classId: lop, durationMinutes: 30, totalPoints: 10, passingScore: 5, ...extra } as never });
    await de("de-mo", L1, { status: "PUBLISHED", maxAttempts: 2, openAt: gio(-60), closeAt: gio(60 * 24), description: "Đề mở" });
    await de("de-han", L1, { status: "PUBLISHED", openAt: gio(-60 * 48), closeAt: gio(-60) });
    await de("de-nhap", L1, { status: "DRAFT" });
    await de("de-lopkhac", L2, { status: "PUBLISHED" });
    await de("de-chung", null, { status: "PUBLISHED" });
    await de("de-chung-khac", null, { status: "PUBLISHED" }); // dùng chung nhưng KHÔNG giao cho S1
    await de("de-an", L1, { status: "PUBLISHED", showResultAfterSubmit: false });
    for (const e of ["de-mo", "de-an"]) await db.examQuestion.create({ data: { examId: `${NS}${e}`, questionId: q.id, order: 1, points: 10 } });
    const buoi = await db.classSession.create({ data: { id: `${NS}buoi`, classId: L1, date: gio(-60 * 24 * 7), status: "COMPLETED" } as never });
    await db.homeworkAssignment.create({ data: { classSessionId: buoi.id, examId: `${NS}de-chung`, studentId: S1 } as never });
    await db.examAttempt.create({ data: { examId: `${NS}de-mo`, studentId: S1, attemptNo: 1, status: "GRADED", totalScore: 9, passed: true, feedback: "Giỏi", submittedAt: gio(-100), gradedAt: gio(-90) } as never });
    await db.examAttempt.create({ data: { examId: `${NS}de-mo`, studentId: S1, attemptNo: 2, status: "IN_PROGRESS" } as never });
    await db.examAttempt.create({ data: { examId: `${NS}de-an`, studentId: S1, attemptNo: 1, status: "GRADED", totalScore: 7, passed: true, feedback: "ẨN", submittedAt: gio(-50) } as never });
    await db.examAttempt.create({ data: { examId: `${NS}de-mo`, studentId: S2, attemptNo: 1, status: "SUBMITTED", submittedAt: gio(-40) } as never });

    // Bài học: đã dạy (có tài liệu giao cho lớp) + chưa dạy.
    await db.curriculum.create({ data: { id: `${NS}gt`, courseId: `${NS}kh`, name: "Giáo trình" } as never });
    await db.lesson.create({ data: { id: `${NS}ls1`, curriculumId: `${NS}gt`, order: 1, title: "Bài 1 đã dạy", content: "Nội dung bài 1", objectives: ["Mục tiêu A"] } as never });
    await db.lesson.create({ data: { id: `${NS}ls2`, curriculumId: `${NS}gt`, order: 2, title: "Bài 2 CHƯA dạy" } as never });
    await db.classSession.update({ where: { id: buoi.id }, data: { lessonId: `${NS}ls1` } });
    await db.assignment.update({ where: { id: `${NS}bt-mo` }, data: { lessonId: `${NS}ls1` } });

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
    cauHinh.showScoreToParent = false;
  });

  const goiDs = async (h: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, tok: string, sv: string) => h(req("/x", undefined, bearer(tok)), ctx(sv));

  it("[LMS-DB-01] cờ TẮT ⇒ 404 phong bì ở cả bảy route; cờ BẬT ⇒ đọc được", async () => {
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "false";
    const bay = [
      (t: string) => dsBaiTap(req("/x", undefined, bearer(t)), ctx(S1)),
      (t: string) => ctBaiTap(req("/x", undefined, bearer(t)), ctx(S1, { assignmentId: `${NS}bt-mo` })),
      (t: string) => dsBaiThi(req("/x", undefined, bearer(t)), ctx(S1)),
      (t: string) => ctBaiThi(req("/x", undefined, bearer(t)), ctx(S1, { examId: `${NS}de-mo` })),
      (t: string) => dsBaiHoc(req("/x", undefined, bearer(t)), ctx(S1)),
      (t: string) => ctBaiHoc(req("/x", undefined, bearer(t)), ctx(S1, { lessonId: `${NS}ls1` })),
      (t: string) => ketQuaGet(req("/x", undefined, bearer(t)), ctx(S1)),
    ];
    for (const [i, f] of bay.entries()) {
      const r = await f(tA);
      expect([i, r.status, (await json(r)).error?.code]).toEqual([i, 404, "NOT_FOUND"]); // phong bì JSON, không phải HTML
    }
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
    for (const [i, f] of bay.entries()) expect([i, (await f(tA)).status]).toEqual([i, 200]);
  });

  it("[LMS-DB-02] bài tập: chỉ PUBLISHED/CLOSED của lớp ĐANG HỌC; nháp/lưu trữ/lớp khác ẨN; cửa nộp do máy chủ", async () => {
    const d = (await json(await goiDs(dsBaiTap, tA, S1))).data as { muc: Array<{ id: string; cuaNop: { trangThai: string; nhanDuocNop: boolean }; trangThaiNop: string; loai: string; tongDiem: number }> };
    const idsRa = d.muc.map((m) => m.id).sort();
    expect(idsRa).toEqual([`${NS}bt-dong`, `${NS}bt-han`, `${NS}bt-mo`].sort());
    const theo = Object.fromEntries(d.muc.map((m) => [m.id, m]));
    expect([theo[`${NS}bt-mo`]!.cuaNop.trangThai, theo[`${NS}bt-mo`]!.cuaNop.nhanDuocNop, theo[`${NS}bt-mo`]!.loai]).toEqual(["mo", true, "VE_NHA"]);
    expect([theo[`${NS}bt-han`]!.cuaNop.trangThai, theo[`${NS}bt-han`]!.cuaNop.nhanDuocNop]).toEqual(["dong", false]); // quá hạn ⇒ tự đóng (suy ở lúc đọc)
    expect(theo[`${NS}bt-dong`]!.cuaNop.trangThai).toBe("dong");
    expect(theo[`${NS}bt-mo`]!.trangThaiNop).toBe("DA_CHAM");
    expect(theo[`${NS}bt-dong`]!.trangThaiNop).toBe("NOP_TRE");
    expect(theo[`${NS}bt-han`]!.trangThaiNop).toBe("CHUA_NOP");
    // Ghi danh đã nghỉ ⇒ không còn thấy bài của lớp.
    await db.enrollment.update({ where: { id: `${NS}dk2` }, data: { status: "CANCELLED" } as never });
    try {
      expect((await json(await goiDs(dsBaiTap, tA, S2))).data.muc).toEqual([]);
    } finally {
      await db.enrollment.update({ where: { id: `${NS}dk2` }, data: { status: "ACTIVE" } as never });
    }
  });

  it("[LMS-DB-03] điểm: ẩn với phụ huynh theo cấu hình; chưa chấm ⇒ CHUA_CHAM; nhận xét chỉ khi ĐÃ CHẤM", async () => {
    const lay = async () => {
      const d = (await json(await goiDs(dsBaiTap, tA, S1))).data.muc as Array<{ id: string; diem: number | null; lyDoAnDiem: string | null }>;
      return Object.fromEntries(d.map((m) => [m.id, m]));
    };
    let m = await lay();
    expect([m[`${NS}bt-mo`]!.diem, m[`${NS}bt-mo`]!.lyDoAnDiem]).toEqual([null, "THEO_CAU_HINH"]); // đã chấm nhưng cấu hình ẩn
    expect([m[`${NS}bt-han`]!.diem, m[`${NS}bt-han`]!.lyDoAnDiem]).toEqual([null, "CHUA_CHAM"]);
    cauHinh.showScoreToParent = true;
    m = await lay();
    expect([m[`${NS}bt-mo`]!.diem, m[`${NS}bt-mo`]!.lyDoAnDiem]).toEqual([8, null]);
    // S2 nộp nhưng CHƯA chấm: nhận xét nháp KHÔNG được lộ.
    const ct = (await json(await ctBaiTap(req("/x", undefined, bearer(tA)), ctx(S2, { assignmentId: `${NS}bt-mo` })))).data;
    expect(ct.trangThaiNop).toBe("DA_NOP");
    expect(ct.baiNop.nhanXet).toBeNull();
    expect(JSON.stringify(ct)).not.toContain("nhận xét nháp");
  });

  it("[LMS-DB-04] chi tiết: bài nộp CHỈ của chính học viên; tệp ký ngắn hạn; URL không ký được bị BỎ", async () => {
    const ct = (await json(await ctBaiTap(req("/x", undefined, bearer(tA)), ctx(S1, { assignmentId: `${NS}bt-mo` })))).data;
    expect(ct.moTa).toBe("Mô tả bt-mo");
    expect(ct.huongDan).toBe("Làm theo hướng dẫn");
    expect([ct.choPhepVanBan, ct.choPhepTep, ct.yeuCauVideo]).toEqual([true, true, false]);
    expect(ct.baiNop.vanBan).toBe("Bài làm của An");
    expect(ct.baiNop.nhanXet).toBe("Tốt lắm"); // đã chấm
    expect(ct.baiNop.tep.map((t: { url: string }) => t.url)).toEqual(["https://r2.test/ky/hs/an-bai.jpg?X-Expires=900"]);
    expect(ct.tepDinhKem.map((t: { tenTep: string; url: string }) => [t.tenTep, t.url])).toEqual([["de-bai.pdf", "https://r2.test/ky/gv/de-bai.pdf?X-Expires=900"]]); // rac.pdf bị BỎ (fail-closed)
    expect(ct.taiLieu).toEqual([{ id: `${NS}doc`, tieuDe: "Tài liệu giao", url: "https://r2.test/ky/doc/tl.pdf?X-Expires=900" }]);
    const chuoi = JSON.stringify(ct);
    expect(chuoi).not.toContain("nguoi-la.example"); // không URL công khai/ngoài R2
    expect(chuoi).not.toContain("BÍ MẬT của Bình"); // bài nộp của S2 (cùng lớp, cùng nhà) không lẫn sang S1
    const ct2 = (await json(await ctBaiTap(req("/x", undefined, bearer(tA)), ctx(S2, { assignmentId: `${NS}bt-mo` })))).data;
    expect(ct2.baiNop.vanBan).toBe("BÍ MẬT của Bình");
    expect(JSON.stringify(ct2)).not.toContain("Bài làm của An");
  });

  it("[LMS-DB-05] cách ly: nhà khác / lớp khác ⇒ 404 cùng khuôn", async () => {
    const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
    expect(await ma(await goiDs(dsBaiTap, tB, S1))).toEqual([404, "NOT_FOUND"]); // B xin học viên nhà A
    expect(await ma(await ctBaiTap(req("/x", undefined, bearer(tB)), ctx(S1, { assignmentId: `${NS}bt-mo` })))).toEqual([404, "NOT_FOUND"]);
    // Chính chủ nhưng id của LỚP KHÁC / nháp / không có ⇒ cùng 404.
    for (const aid of [`${NS}bt-lopkhac`, `${NS}bt-nhap`, `${NS}bt-luutru`, "khong-co"]) expect(await ma(await ctBaiTap(req("/x", undefined, bearer(tA)), ctx(S1, { assignmentId: aid })))).toEqual([404, "NOT_FOUND"]);
    for (const eid of [`${NS}de-lopkhac`, `${NS}de-nhap`, `${NS}de-chung-khac`, "khong-co"]) expect(await ma(await ctBaiThi(req("/x", undefined, bearer(tA)), ctx(S1, { examId: eid })))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await ctBaiHoc(req("/x", undefined, bearer(tA)), ctx(S1, { lessonId: `${NS}ls2` })))).toEqual([404, "NOT_FOUND"]); // bài CHƯA dạy
    // B thấy bài của lớp mình, không thấy bài lớp A.
    const b = (await json(await goiDs(dsBaiTap, tB, S3))).data.muc.map((m: { id: string }) => m.id);
    expect(b).toEqual([`${NS}bt-lopkhac`]);
  });

  it("[LMS-DB-06] bài thi: đề lớp + đề dùng chung đã giao; nháp/lớp khác/chung-chưa-giao ẨN; dangMo theo máy chủ; không câu hỏi/đáp án", async () => {
    const r = await goiDs(dsBaiThi, tA, S1);
    const d = (await json(r)).data.muc as Array<{ id: string; dangMo: boolean; soLuotToiDa: number; soLuotDaDung: number; lanGanNhat: { trangThai: string; diem: number | null } | null }>;
    expect(d.map((e) => e.id).sort()).toEqual([`${NS}de-an`, `${NS}de-chung`, `${NS}de-han`, `${NS}de-mo`].sort());
    const e = Object.fromEntries(d.map((x) => [x.id, x]));
    expect([e[`${NS}de-mo`]!.dangMo, e[`${NS}de-mo`]!.soLuotToiDa, e[`${NS}de-mo`]!.soLuotDaDung, e[`${NS}de-mo`]!.lanGanNhat?.trangThai]).toEqual([true, 2, 2, "DANG_LAM"]);
    expect(e[`${NS}de-han`]!.dangMo).toBe(false); // hết hạn theo giờ MÁY CHỦ
    const ct = (await json(await ctBaiThi(req("/x", undefined, bearer(tA)), ctx(S1, { examId: `${NS}de-mo` })))).data;
    expect([ct.soCau, ct.conLuot, ct.choPhepBatDau, ct.tongDiem, ct.diemDat, ct.moTa]).toEqual([1, 0, true, 10, 5, "Đề mở"]); // hết lượt nhưng ĐANG có lượt dở ⇒ được tiếp tục
    const hetCa = JSON.stringify([d, ct]);
    for (const bm of ["ĐÁP-ÁN-BÍ-MẬT", "Câu hỏi bí mật", "correctAnswer", "isCorrect", "meta"]) expect(hetCa).not.toContain(bm);
    const han = (await json(await ctBaiThi(req("/x", undefined, bearer(tA)), ctx(S1, { examId: `${NS}de-han` })))).data;
    expect(han.choPhepBatDau).toBe(false);
  });

  it("[LMS-DB-07] kết quả: chỉ lượt/bài đã nộp của chính mình; điểm theo cấu hình; showResultAfterSubmit=false ẩn điểm + nhận xét", async () => {
    let d = (await json(await goiDs(ketQuaGet, tA, S1))).data as { bai_thi: Array<{ tieuDe: string; trangThai: string; diem: number | null; dat: boolean | null; nhanXet: string | null }>; bai_tap: Array<{ baiTapId: string; diem: number | null; nhanXet: string | null }> };
    expect(d.bai_thi.map((x) => x.tieuDe).sort()).toEqual(["Đề de-an", "Đề de-mo"]); // lượt IN_PROGRESS không phải «kết quả»
    const mo = d.bai_thi.find((x) => x.tieuDe === "Đề de-mo")!;
    expect([mo.trangThai, mo.diem, mo.dat, mo.nhanXet]).toEqual(["DA_CHAM", null, null, "Giỏi"]); // điểm ẩn theo cấu hình; nhận xét đã chấm thì hiện
    const an = d.bai_thi.find((x) => x.tieuDe === "Đề de-an")!;
    expect([an.diem, an.nhanXet]).toEqual([null, null]); // showResultAfterSubmit=false ⇒ ẨN cả điểm và nhận xét
    cauHinh.showScoreToParent = true;
    d = (await json(await goiDs(ketQuaGet, tA, S1))).data;
    const mo2 = d.bai_thi.find((x) => x.tieuDe === "Đề de-mo")!;
    expect([mo2.diem, mo2.dat]).toEqual([9, true]);
    expect(d.bai_thi.find((x) => x.tieuDe === "Đề de-an")!.diem).toBeNull(); // vẫn ẩn dù cấu hình bật
    expect(d.bai_tap.find((x) => x.baiTapId === `${NS}bt-mo`)).toMatchObject({ diem: 8, nhanXet: "Tốt lắm" });
    // Lượt của S2 (SUBMITTED, chưa chấm) không lẫn sang S1; với S2 điểm/nhận xét = null.
    const d2 = (await json(await goiDs(ketQuaGet, tA, S2))).data;
    expect(d2.bai_thi).toHaveLength(1);
    expect([d2.bai_thi[0].trangThai, d2.bai_thi[0].diem, d2.bai_thi[0].nhanXet]).toEqual(["CHO_CHAM", null, null]);
  });

  it("[LMS-DB-08] bài học: chỉ bài ĐÃ DẠY + tài liệu giao cho lớp; bài chưa dạy ẩn", async () => {
    const d = (await json(await goiDs(dsBaiHoc, tA, S1))).data.muc as Array<{ id: string; tieuDe: string; mucTieu: string[]; taiLieu: Array<{ url: string }> }>;
    expect(d.map((b) => b.id)).toEqual([`${NS}ls1`]);
    expect(d[0]!.mucTieu).toEqual(["Mục tiêu A"]);
    expect(d[0]!.taiLieu.map((t) => t.url)).toContain("https://r2.test/ky/doc/tl.pdf?X-Expires=900");
    expect(d[0]!.taiLieu.every((t) => t.url.includes("X-Expires=900"))).toBe(true); // mọi URL đã KÝ
    const ct = (await json(await ctBaiHoc(req("/x", undefined, bearer(tA)), ctx(S1, { lessonId: `${NS}ls1` })))).data;
    expect(ct.noiDung).toBe("Nội dung bài 1");
    // Lớp L2 không thấy bài của L1.
    expect((await json(await goiDs(dsBaiHoc, tB, S3))).data.muc).toEqual([]);
  });

  it("[LMS-DB-09] phiên chế độ học sinh: đọc của CHÍNH MÌNH (điểm hiện); anh/chị/em ⇒ 403", async () => {
    const tok = await dangNhap(PHONE.A, 3);
    await quyDinhDongY(req("/x", {}, bearer(tok)));
    await db.mobileSession.updateMany({ where: { userId: ids.A!, thuHoiLuc: null, maThietBi: "00000000-0000-4000-c000-000000000003" }, data: { hocSinhId: S1, hocSinhTuLuc: new Date() } });
    cauHinh.showScoreToParent = false; // ẩn với phụ huynh…
    // Cổng chế độ học sinh đọc ĐƯỜNG DẪN THẬT của yêu cầu ⇒ phải dùng URL thật (không phải "/x").
    const thuc = (sv: string, duong: string) => req(`/api/mobile/v1/students/${sv}/learning/${duong}`, undefined, bearer(tok));
    const own = (await json(await dsBaiTap(thuc(S1, "assignments"), ctx(S1)))).data.muc as Array<{ id: string; diem: number | null }>;
    expect(own.find((m) => m.id === `${NS}bt-mo`)!.diem).toBe(8); // …nhưng học sinh tự xem điểm của mình
    expect((await dsBaiTap(thuc(S2, "assignments"), ctx(S2))).status).toBe(403); // anh/chị/em
    expect((await ketQuaGet(thuc(S2, "results"), ctx(S2))).status).toBe(403);
    expect((await ketQuaGet(thuc(S1, "results"), ctx(S1))).status).toBe(200);
    expect((await ctBaiThi(thuc(S1, `exams/${NS}de-mo`), ctx(S1, { examId: `${NS}de-mo` }))).status).toBe(200);
    // Phụ huynh (phiên KHÔNG khoá) cùng cấu hình ẩn ⇒ không thấy điểm (đối chứng).
    const ph = (await json(await dsBaiTap(req(`/api/mobile/v1/students/${S1}/learning/assignments`, undefined, bearer(tA)), ctx(S1)))).data.muc as Array<{ id: string; diem: number | null }>;
    expect(ph.find((m) => m.id === `${NS}bt-mo`)!.diem).toBeNull();
  });

  it("[LMS-DB-10] bộ bài tập theo buổi (HL-BT-*): giao theo buổi, lượt dùng/tối đa, điểm cao nhất theo luật hiện điểm; cách ly; không coin/đáp án", async () => {
    const buoiId = `${NS}buoi`;
    const tao = (examId: string) => db.homeworkAssignment.create({ data: { classSessionId: buoiId, examId, studentId: S1 } as never });
    await tao(`${NS}de-mo`);
    await tao(`${NS}de-an`);
    try {
      const lay = async (tok: string, sv: string) => baiTapTheoBuoi(req(`/api/mobile/v1/students/${sv}/learning/session-homework`, undefined, bearer(tok)), ctx(sv));
      type Muc = { deId: string; trangThaiGiao: string; soLuotToiDa: number; soLuotDaDung: number; diemCaoNhat: number | null; soCau: number; buoiId: string; soBuoi: number | null; lanGanNhat: { trangThai: string; diem: number | null } | null };
      cauHinh.showScoreToParent = false;
      const r = await json(await lay(tA, S1));
      let muc = r.data.muc as Muc[];
      expect(muc.map((m) => m.deId).sort()).toEqual([`${NS}de-an`, `${NS}de-chung`, `${NS}de-mo`].sort());
      const mo = muc.find((m) => m.deId === `${NS}de-mo`)!;
      expect([mo.soLuotToiDa, mo.soLuotDaDung, mo.buoiId]).toEqual([2, 2, buoiId]);
      expect(typeof mo.soBuoi).toBe("number");
      expect(mo.diemCaoNhat).toBeNull(); // phụ huynh + setting tắt ⇒ ẨN điểm
      expect(muc.find((m) => m.deId === `${NS}de-chung`)).toMatchObject({ soLuotDaDung: 0, diemCaoNhat: null, lanGanNhat: null, trangThaiGiao: "DA_GIAO" });
      cauHinh.showScoreToParent = true;
      muc = (await json(await lay(tA, S1))).data.muc as Muc[];
      expect(muc.find((m) => m.deId === `${NS}de-mo`)!.diemCaoNhat).toBe(9); // lượt IN_PROGRESS không tính; lượt GRADED 9
      expect(muc.find((m) => m.deId === `${NS}de-an`)!.diemCaoNhat).toBeNull(); // đề ẩn kết quả (showResultAfterSubmit=false) ⇒ vẫn ẩn dù setting bật
      expect(JSON.stringify(r.data)).not.toMatch(/coin|dapAn|dap_an|correct|isCorrect/i); // không trường thưởng/đáp án
      // Cách ly: anh/chị/em không thấy bài giao của nhau; nhà khác ⇒ 404
      expect(((await json(await lay(tA, S2))).data.muc as Muc[])).toEqual([]);
      expect((await lay(tB, S1)).status).toBe(404);
    } finally {
      await db.homeworkAssignment.deleteMany({ where: { classSessionId: buoiId, examId: { in: [`${NS}de-mo`, `${NS}de-an`] } } });
    }
  });
});
