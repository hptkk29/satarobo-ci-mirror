import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/storage/signed-url", () => ({ keyFromPublicUrl: () => null, signedMediaUrl: async (k: string) => k }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as ctBaiTap } from "@/app/api/mobile/v1/students/[studentId]/learning/assignments/[assignmentId]/route";
import { POST as nopRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/assignments/[assignmentId]/submissions/route";
import { POST as veRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/uploads/route";
import { POST as hoanTatRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/uploads/[uploadId]/complete/route";
import { db } from "@/lib/db";
import { layUrlTaiTep } from "@/lib/lms/tep-bai-nop";
import { datKhoTepRieng, kiemNoiDung, type KhoTepRieng } from "@/lib/mobile-api/kho-tep-rieng";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [UP-DB] VÉ TẢI LÊN + gắn vào bài nộp, trên POSTGRES THẬT với KHO GIẢ trong bộ nhớ (kho riêng — không URL công khai).
 *   [UP-DB-01] xin vé: loại/cỡ/đuôi; bài không nhận tệp / đã đóng / lớp khác / nhà khác ⇒ từ chối đúng mã
 *   [UP-DB-02] idempotent theo khoá; cùng khoá khai khác ⇒ 422; vé nằm kho RIÊNG (khoá không chứa tên tệp)
 *   [UP-DB-03] xác minh: thiếu tệp / sai cỡ / sai loại / sai định dạng ⇒ REJECTED + tệp bị XOÁ; đúng ⇒ UPLOADED; báo hai lần ⇒ như nhau
 *   [UP-DB-04] nộp có tệp: dòng tệp + storageKey + uploadId + ATTACHED + ảnh chụp tệp trong lịch sử; đọc chi tiết ký qua kho riêng, KHÔNG lộ storageKey
 *   [UP-DB-05] vé chưa xác minh / của học viên khác / của bài khác / đã gắn bài khác ⇒ 422
 *   [UP-DB-06] nộp lại: chỉ chữ ⇒ GIỮ tệp; tepIds mới ⇒ THAY; cùng chữ + cùng tệp ⇒ trùng; cùng chữ + tệp MỚI ⇒ phiên bản mới
 *   [UP-DB-07] bài yêu cầu video: không có video ⇒ 422; có video ⇒ nộp được
 *   [UP-DB-08] phiên chế độ học sinh xin vé của CHÍNH mình; anh/chị/em ⇒ 403
 *   [UP-DB-09] tải xuống web: phụ huynh chủ bài ✓; phụ huynh khác ✗; chưa đăng nhập 401; giáo viên đúng lớp ✓ / lớp khác ✗; nhân sự không quyền ✗; tệp công khai cũ ✗
 *   [UP-DB-10] KHÔNG kho riêng ⇒ 503 (không rơi về URL công khai) và đọc chi tiết bỏ tệp riêng
 *   [UP-DB-11] nhận dạng nội dung từng định dạng (kiemNoiDung)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "updb-";
const MK = "Mat-khau-test-2026";
const PHONE = { A: "0966600001", B: "0966600002" };
let dem = 0;
const ip = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const ids: Record<string, string> = {};
const gio = (ph: number) => new Date(Date.now() + ph * 60_000);
const bearer = (t: string) => `Bearer ${t}`;
const A = (k: string) => `${NS}${k}`;

// ── KHO GIẢ trong bộ nhớ ──
const doiTuong = new Map<string, { bytes: Uint8Array; contentType: string }>();
const kho: KhoTepRieng = {
  ten: "gia",
  async kyPut(key, ct) { return { url: `fake://put/${key}`, headers: { "Content-Type": ct } }; },
  async dau(key) { const o = doiTuong.get(key); return o ? { size: o.bytes.length, contentType: o.contentType } : null; },
  async docByteDau(key, n) { return doiTuong.get(key)?.bytes.slice(0, n) ?? null; },
  async kyGet(key) { return doiTuong.has(key) ? `fake://get/${key}?sig=1` : null; },
  async xoa(key) { doiTuong.delete(key); },
};
const JPG = (n = 100) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const MP4 = (n = 200) => { const b = new Uint8Array(n); b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]); return b; };
/** Mô phỏng app PUT lên URL đã ký. */
const taiLen = (uploadUrl: string, bytes: Uint8Array, ct: string) => doiTuong.set(uploadUrl.replace("fake://put/", ""), { bytes, contentType: ct });

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/x", { dinhDanh: phone, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  if (r.status !== 200) throw new Error(`đăng nhập ${r.status}`);
  return ((await json(r)).data as { accessToken: string }).accessToken;
}

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileUpload.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.assignmentSubmissionVersion.deleteMany({ where: { submission: { studentId: { startsWith: NS } } } });
  await db.assignmentSubmissionFile.deleteMany({ where: { submission: { studentId: { startsWith: NS } } } });
  await db.assignmentSubmission.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.assignment.deleteMany({ where: { id: { startsWith: NS } } });
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

describe.skipIf(!RUN)("[UP-DB] vé tải lên — Postgres thật + kho giả", () => {
  let tA = "";
  let tB = "";
  const S1 = A("s1");
  const S2 = A("s2");
  const S3 = A("s3");
  const L1 = A("l1");
  const L2 = A("l2");

  const ve = (tok: string, sv: string, than: unknown) => veRoute(req(`/api/mobile/v1/students/${sv}/learning/uploads`, than, bearer(tok)), { params: Promise.resolve({ studentId: sv }) as never });
  const hoanTat = (tok: string, sv: string, id: string) => hoanTatRoute(req(`/api/mobile/v1/students/${sv}/learning/uploads/${id}/complete`, {}, bearer(tok)), { params: Promise.resolve({ studentId: sv, uploadId: id }) as never });
  const nop = (tok: string, sv: string, aid: string, than: unknown) => nopRoute(req(`/api/mobile/v1/students/${sv}/learning/assignments/${aid}/submissions`, than, bearer(tok)), { params: Promise.resolve({ studentId: sv, assignmentId: aid }) as never });
  const chiTiet = (tok: string, sv: string, aid: string) => ctBaiTap(req(`/api/mobile/v1/students/${sv}/learning/assignments/${aid}`, undefined, bearer(tok)), { params: Promise.resolve({ studentId: sv, assignmentId: aid }) as never });
  const xinVeBai = (tok: string, sv: string, aid: string, khoa: string, o: Record<string, unknown> = {}) => ve(tok, sv, { mucDich: "bai_nop", khoaGuiLai: khoa, baiTapId: A(aid), tenTep: "bai-lam.jpg", loaiMime: "image/jpeg", kichThuoc: 100, ...o });
  /** Xin vé + tải + xác minh ⇒ id vé UPLOADED. */
  const veDaTai = async (tok: string, sv: string, aid: string, khoa: string, o: { ten?: string; mime?: string; bytes?: Uint8Array } = {}) => {
    const bytes = o.bytes ?? JPG();
    const r = await xinVeBai(tok, sv, aid, khoa, { tenTep: o.ten ?? "bai-lam.jpg", loaiMime: o.mime ?? "image/jpeg", kichThuoc: bytes.length });
    expect(r.status, await r.clone().text()).toBe(200);
    const d = (await json(r)).data;
    taiLen(d.uploadUrl, bytes, o.mime ?? "image/jpeg");
    const h = await hoanTat(tok, sv, d.tepId);
    expect(h.status, await h.clone().text()).toBe(200);
    return d.tepId as string;
  };
  const ma = async (r: Response) => [r.status, (await json(r)).error?.code];

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const k of ["A", "B"] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    ids.GV = (await db.user.create({ data: { email: `${NS}gv@seed.invalid`, name: `${NS}gv`, password: hash, role: "TEACHER", roles: ["TEACHER"] } as never, select: { id: true } })).id;
    ids.GV2 = (await db.user.create({ data: { email: `${NS}gv2@seed.invalid`, name: `${NS}gv2`, password: hash, role: "TEACHER", roles: ["TEACHER"] } as never, select: { id: true } })).id;
    ids.HR = (await db.user.create({ data: { email: `${NS}hr@seed.invalid`, name: `${NS}hr`, password: hash, role: "HR", roles: ["HR"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở UP", slug: A("cs"), address: "Địa chỉ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá UP", slug: A("kh"), totalSessions: 12 } });
    await db.class.create({ data: { id: L1, name: `Lớp ${L1}`, classCode: L1, courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00", teacherId: ids.GV } as never });
    await db.class.create({ data: { id: L2, name: `Lớp ${L2}`, classCode: L2, courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00", teacherId: ids.GV2 } as never });
    await db.student.create({ data: { id: S1, name: `${NS}An`, parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S2, name: `${NS}Binh`, parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S3, name: `${NS}Cuong`, parentUserId: ids.B, centerId: A("cs") } as never });
    const dk = (id: string, sv: string, lop: string) => db.enrollment.create({ data: { id: A(id), studentId: sv, classId: lop, courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    await dk("dk1", S1, L1);
    await dk("dk2", S2, L1);
    await dk("dk3", S3, L2);
    const bt = (id: string, lop: string, extra: Record<string, unknown>) => db.assignment.create({ data: { id: A(id), title: `BT ${id}`, description: `Mô tả ${id}`, classId: lop, totalPoints: 10, status: "PUBLISHED", allowText: true, allowFile: true, dueAt: gio(60 * 24), ...extra } as never });
    for (const id of ["f1", "f2", "f3", "f4", "f5", "f6"]) await bt(id, L1, {});
    await bt("nofile", L1, { allowFile: false });
    await bt("closed", L1, { status: "CLOSED", dueAt: gio(-60 * 24) });
    await bt("video", L1, { requireVideo: true });
    await bt("other", L2, {});
    tA = await dangNhap(PHONE.A, 1);
    tB = await dangNhap(PHONE.B, 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("/x", {}, bearer(t)));
  }, 120_000);
  afterAll(async () => {
    datKhoTepRieng(null);
    delete process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED;
    await don();
  });
  beforeEach(() => {
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
    datKhoTepRieng(kho);
  });

  it("[UP-DB-01] xin vé: loại/cỡ/đuôi; bài không nhận tệp / đã đóng / lớp khác / nhà khác ⇒ từ chối đúng mã", async () => {
    const dung = await xinVeBai(tA, S1, "f1", "ve-khoa-0001a");
    expect(dung.status).toBe(200);
    const d = (await json(dung)).data;
    expect([d.trangThai, d.phuongThuc, d.kichThuoc, d.headers["Content-Type"]]).toEqual(["CHO_TAI_LEN", "PUT", 100, "image/jpeg"]);
    expect(d.uploadUrl).toMatch(/^fake:\/\/put\/mobile\/bai_nop\//);
    expect(await ma(await xinVeBai(tA, S1, "f1", "ve-khoa-0002a", { tenTep: "x.svg", loaiMime: "image/svg+xml" }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // SVG cấm (XSS)
    expect(await ma(await xinVeBai(tA, S1, "f1", "ve-khoa-0003a", { tenTep: "x.exe", loaiMime: "application/x-msdownload" }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    // Đuôi/loại lệch nhau trong CÙNG nhóm không bị chặn ở bước xin vé — chốt chặn là NHẬN DẠNG NỘI DUNG lúc xác minh ([UP-DB-03]/[UP-DB-11]).
    expect(await ma(await xinVeBai(tA, S1, "f1", "ve-khoa-0005a", { kichThuoc: 11 * 1024 * 1024 }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // ảnh > 10MB
    expect(await ma(await xinVeBai(tA, S1, "f1", "ve-khoa-0006a", { tenTep: "v.mp4", loaiMime: "video/mp4", kichThuoc: 121 * 1024 * 1024 }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // video > 120MB
    expect(await ma(await xinVeBai(tA, S1, "nofile", "ve-khoa-0007a"))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect(await ma(await xinVeBai(tA, S1, "closed", "ve-khoa-0008a"))).toEqual([422, "DA_DONG"]);
    expect(await ma(await xinVeBai(tA, S1, "other", "ve-khoa-0009a"))).toEqual([404, "NOT_FOUND"]); // bài lớp khác
    expect(await ma(await xinVeBai(tB, S1, "f1", "ve-khoa-0010a"))).toEqual([404, "NOT_FOUND"]); // học viên nhà khác
    expect(await ma(await ve(tA, S1, { mucDich: "bai_nop", khoaGuiLai: "ve-khoa-0011a", baiTapId: A("f1"), tenTep: "a.jpg", loaiMime: "image/jpeg", kichThuoc: 10, ownerId: "x" }))).toEqual([400, "VALIDATION"]); // strict
  });

  it("[UP-DB-02] idempotent theo khoá; cùng khoá khai khác ⇒ 422; khoá kho riêng không chứa tên tệp", async () => {
    const a = (await json(await xinVeBai(tA, S1, "f1", "ve-khoa-idem01", { tenTep: "bi-mat-ten-con.jpg" }))).data;
    const b = (await json(await xinVeBai(tA, S1, "f1", "ve-khoa-idem01", { tenTep: "bi-mat-ten-con.jpg" }))).data;
    expect(b.tepId).toBe(a.tepId);
    expect(await db.mobileUpload.count({ where: { studentId: S1, assignmentId: A("f1"), fileName: "bi-mat-ten-con.jpg" } })).toBe(1);
    const dua = await Promise.all(Array.from({ length: 5 }, () => xinVeBai(tA, S1, "f1", "ve-khoa-dua001")));
    expect(dua.map((r) => r.status)).toEqual(Array(5).fill(200));
    expect(new Set(await Promise.all(dua.map(async (r) => (await json(r)).data.tepId))).size).toBe(1);
    expect(await ma(await xinVeBai(tA, S1, "f1", "ve-khoa-idem01", { kichThuoc: 101 }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    const hang = await db.mobileUpload.findUnique({ where: { id: a.tepId } });
    expect(hang!.storageKey).not.toContain("bi-mat-ten-con");
    expect(hang!.storageKey).toMatch(/^mobile\/bai_nop\/updb-s1\/[0-9a-f]{32}\.jpg$/);
    expect([hang!.status, hang!.purpose, hang!.assignmentId]).toEqual(["ISSUED", "ASSIGNMENT_SUBMISSION", A("f1")]);
  });

  it("[UP-DB-03] xác minh: thiếu tệp / sai cỡ / sai loại / sai định dạng ⇒ REJECTED + tệp bị XOÁ; đúng ⇒ UPLOADED; báo hai lần ⇒ như nhau", async () => {
    const mo = async (khoa: string, o?: Record<string, unknown>) => (await json(await xinVeBai(tA, S1, "f2", khoa, o))).data as { tepId: string; uploadUrl: string };
    const thieu = await mo("ve-xm-0001-a");
    expect(await ma(await hoanTat(tA, S1, thieu.tepId))).toEqual([422, "TEP_KHONG_HOP_LE"]); // chưa PUT
    expect((await db.mobileUpload.findUnique({ where: { id: thieu.tepId } }))!.status).toBe("ISSUED"); // còn thử lại được
    const saiCo = await mo("ve-xm-0002-a");
    taiLen(saiCo.uploadUrl, JPG(150), "image/jpeg");
    expect(await ma(await hoanTat(tA, S1, saiCo.tepId))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect([(await db.mobileUpload.findUnique({ where: { id: saiCo.tepId } }))!.status, doiTuong.has(saiCo.uploadUrl.replace("fake://put/", ""))]).toEqual(["REJECTED", false]); // tệp bị gỡ
    const saiLoai = await mo("ve-xm-0003-a");
    taiLen(saiLoai.uploadUrl, JPG(100), "image/png");
    expect((await hoanTat(tA, S1, saiLoai.tepId)).status).toBe(422);
    const saiDang = await mo("ve-xm-0004-a");
    taiLen(saiDang.uploadUrl, new Uint8Array(100).fill(7), "image/jpeg"); // không phải JPEG thật (đuôi + loại khai báo JPEG)
    expect(await ma(await hoanTat(tA, S1, saiDang.tepId))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect((await db.mobileUpload.findUnique({ where: { id: saiDang.tepId } }))!.status).toBe("REJECTED");
    const tot = await mo("ve-xm-0005-a");
    taiLen(tot.uploadUrl, JPG(100), "image/jpeg");
    const h1 = await json(await hoanTat(tA, S1, tot.tepId));
    const h2 = await json(await hoanTat(tA, S1, tot.tepId));
    expect([h1.data.trangThai, h1.data.kichThuoc, h2.data.trangThai]).toEqual(["DA_TAI_LEN", 100, "DA_TAI_LEN"]);
    const r = await db.mobileUpload.findUnique({ where: { id: tot.tepId } });
    expect([r!.status, r!.actualSize, r!.verifiedAt !== null]).toEqual(["UPLOADED", 100, true]);
    expect(await ma(await hoanTat(tB, S1, tot.tepId))).toEqual([404, "NOT_FOUND"]); // phụ huynh khác không báo hộ
    expect(await ma(await hoanTat(tA, S2, tot.tepId))).toEqual([404, "NOT_FOUND"]); // học viên khác trong nhà cũng không
    // vé đã REJECTED không dùng lại
    expect(await ma(await xinVeBai(tA, S1, "f2", "ve-xm-0002-a"))).toEqual([422, "TEP_KHONG_HOP_LE"]);
  });

  it("[UP-DB-04] nộp có tệp: dòng tệp + storageKey + uploadId + ATTACHED + ảnh chụp tệp; đọc chi tiết ký qua kho riêng, không lộ storageKey", async () => {
    const id = await veDaTai(tA, S1, "f3", "ve-nop-0001-a");
    const r = await nop(tA, S1, A("f3"), { khoaGuiLai: "nop-up-0001a", vanBan: "Bài kèm ảnh", tepIds: [id] });
    expect(r.status, await r.clone().text()).toBe(200);
    const sub = await db.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: A("f3"), studentId: S1 } }, include: { files: true, versions: true } });
    expect(sub!.files).toHaveLength(1);
    const f = sub!.files[0]!;
    expect([f.uploadId, f.fileName, f.mimeType, f.fileSize]).toEqual([id, "bai-lam.jpg", "image/jpeg", 100]);
    expect(f.storageKey).toMatch(/^mobile\/bai_nop\//);
    expect(f.fileUrl).toBe(`/api/lms/submission-file/${f.id}`); // đường dẫn CÓ PHÂN QUYỀN, không URL kho
    expect(sub!.fileUrl).toBe(f.fileUrl); // cột cũ phản chiếu tệp đầu (màn web cũ không vỡ)
    expect((await db.mobileUpload.findUnique({ where: { id } }))!.status).toBe("ATTACHED");
    expect(sub!.versions[0]!.filesJson).toEqual([{ fileId: f.id, tenTep: "bai-lam.jpg", loaiMime: "image/jpeg", kichThuoc: 100 }]);
    const ct = (await json(await chiTiet(tA, S1, A("f3")))).data;
    expect(ct.baiNop.tep).toHaveLength(1);
    expect(ct.baiNop.tep[0].url).toMatch(/^fake:\/\/get\/mobile\/bai_nop\//);
    const s = JSON.stringify(ct);
    expect(s).not.toContain("storageKey");
    expect(s).not.toContain("/api/lms/submission-file");
  });

  it("[UP-DB-05] vé chưa xác minh / của học viên khác / của bài khác / đã gắn bài khác ⇒ 422", async () => {
    const chua = (await json(await xinVeBai(tA, S1, "f4", "ve-gan-0001-a"))).data.tepId as string; // ISSUED
    expect(await ma(await nop(tA, S1, A("f4"), { khoaGuiLai: "nop-up-0002a", vanBan: "x", tepIds: [chua] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    const cuaS2 = await veDaTai(tA, S2, "f4", "ve-gan-0002-a");
    expect(await ma(await nop(tA, S1, A("f4"), { khoaGuiLai: "nop-up-0003a", vanBan: "x", tepIds: [cuaS2] }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // vé của anh/chị/em
    const cuaBaiKhac = await veDaTai(tA, S1, "f5", "ve-gan-0003-a");
    expect(await ma(await nop(tA, S1, A("f4"), { khoaGuiLai: "nop-up-0004a", vanBan: "x", tepIds: [cuaBaiKhac] }))).toEqual([422, "TEP_KHONG_HOP_LE"]); // vé của bài f5
    expect(await ma(await nop(tA, S1, A("f4"), { khoaGuiLai: "nop-up-0005a", vanBan: "x", tepIds: ["khong-co"] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect(await db.assignmentSubmission.count({ where: { assignmentId: A("f4"), studentId: S1 } })).toBe(0); // không ghi gì
    // vé đã ATTACHED cho bài này ⇒ không gắn lại cho bài nộp KHÁC của bài khác (cùng id vé ở bài f5 đã gắn ở nơi khác)
    await nop(tA, S1, A("f5"), { khoaGuiLai: "nop-up-0006a", vanBan: "f5", tepIds: [cuaBaiKhac] });
    expect(await ma(await nop(tA, S2, A("f5"), { khoaGuiLai: "nop-up-0007a", vanBan: "f5", tepIds: [cuaBaiKhac] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
  });

  it("[UP-DB-06] nộp lại: chỉ chữ ⇒ GIỮ tệp; tepIds mới ⇒ THAY; cùng chữ + cùng tệp ⇒ trùng; cùng chữ + tệp MỚI ⇒ phiên bản mới", async () => {
    const t1 = await veDaTai(tA, S1, "f6", "ve-lai-0001-a", { ten: "a.jpg" });
    const v1 = (await json(await nop(tA, S1, A("f6"), { khoaGuiLai: "nop-lai-0001a", vanBan: "Chữ một", tepIds: [t1] }))).data;
    expect([v1.phienBan, v1.trungLap]).toEqual([1, false]);
    const v2 = (await json(await nop(tA, S1, A("f6"), { khoaGuiLai: "nop-lai-0002a", vanBan: "Chữ hai" }))).data; // chỉ sửa chữ
    expect([v2.phienBan, v2.trungLap]).toEqual([2, false]);
    const sau2 = await db.assignmentSubmissionFile.findMany({ where: { submission: { assignmentId: A("f6"), studentId: S1 } } });
    expect(sau2.map((f) => f.uploadId)).toEqual([t1]); // tệp GIỮ NGUYÊN
    const trung = (await json(await nop(tA, S1, A("f6"), { khoaGuiLai: "nop-lai-0003a", vanBan: "Chữ hai", tepIds: [t1] }))).data; // cùng chữ + cùng tệp, khoá khác
    expect([trung.trungLap, trung.phienBan]).toEqual([true, 2]);
    const t2 = await veDaTai(tA, S1, "f6", "ve-lai-0002-a", { ten: "b.jpg" });
    const v3 = (await json(await nop(tA, S1, A("f6"), { khoaGuiLai: "nop-lai-0004a", vanBan: "Chữ hai", tepIds: [t2] }))).data; // CÙNG chữ, tệp MỚI ⇒ không được coi là trùng
    expect([v3.trungLap, v3.phienBan]).toEqual([false, 3]);
    const sau3 = await db.assignmentSubmissionFile.findMany({ where: { submission: { assignmentId: A("f6"), studentId: S1 } } });
    expect(sau3.map((f) => f.uploadId)).toEqual([t2]); // THAY toàn bộ
    const ls = await db.assignmentSubmissionVersion.findMany({ where: { submission: { assignmentId: A("f6"), studentId: S1 } }, orderBy: { versionNo: "asc" } });
    expect(ls.map((v) => (v.filesJson as { tenTep: string }[]).map((f) => f.tenTep))).toEqual([["a.jpg"], ["a.jpg"], ["b.jpg"]]); // lịch sử giữ ĐỦ tệp từng bản
    expect((await db.mobileUpload.findUnique({ where: { id: t1 } }))!.status).toBe("ATTACHED"); // tệp cũ được lưu giữ (không xoá kho)
    // Tệp cũ ĐÃ BỊ THAY (còn ATTACHED trong sổ vé) không được dùng lại làm tệp mới của bài
    expect(await ma(await nop(tA, S1, A("f6"), { khoaGuiLai: "nop-lai-0005a", vanBan: "Chữ ba", tepIds: [t1] }))).toEqual([422, "TEP_KHONG_HOP_LE"]);
  });

  it("[UP-DB-07] bài yêu cầu video: không có video ⇒ 422; có video ⇒ nộp được", async () => {
    expect(await ma(await nop(tA, S1, A("video"), { khoaGuiLai: "nop-vd-0001a", vanBan: "chỉ chữ" }))).toEqual([422, "TEP_CHUA_HO_TRO"]);
    const anh = await veDaTai(tA, S1, "video", "ve-vd-0001-a");
    expect(await ma(await nop(tA, S1, A("video"), { khoaGuiLai: "nop-vd-0002a", vanBan: "kèm ảnh", tepIds: [anh] }))).toEqual([422, "TEP_CHUA_HO_TRO"]);
    const vid = await veDaTai(tA, S1, "video", "ve-vd-0002-a", { ten: "bai.mp4", mime: "video/mp4", bytes: MP4() });
    const r = await nop(tA, S1, A("video"), { khoaGuiLai: "nop-vd-0003a", vanBan: "", tepIds: [vid] }); // chỉ video, không chữ
    expect(r.status, await r.clone().text()).toBe(200);
  });

  it("[UP-DB-08] phiên chế độ học sinh xin vé của CHÍNH mình; anh/chị/em ⇒ 403", async () => {
    const tok = await dangNhap(PHONE.A, 3);
    await quyDinhDongY(req("/x", {}, bearer(tok)));
    await db.mobileSession.updateMany({ where: { userId: ids.A!, thuHoiLuc: null, maThietBi: "00000000-0000-4000-c000-000000000003" }, data: { hocSinhId: S1, hocSinhTuLuc: new Date() } });
    expect((await xinVeBai(tok, S1, "f1", "ve-hs-0001-a")).status).toBe(200);
    expect((await xinVeBai(tok, S2, "f1", "ve-hs-0002-a")).status).toBe(403);
    expect((await hoanTat(tok, S2, "bat-ky")).status).toBe(403);
  });

  it("[UP-DB-09] tải xuống web: phụ huynh chủ bài ✓; phụ huynh khác ✗; chưa đăng nhập 401; giáo viên đúng lớp ✓ / lớp khác ✗; nhân sự không quyền ✗; tệp công khai cũ ✗", async () => {
    const f = (await db.assignmentSubmissionFile.findFirst({ where: { submission: { assignmentId: A("f3"), studentId: S1 } } }))!;
    const chu = await layUrlTaiTep(ids.A, f.id);
    expect(chu.ok && chu.url).toMatch(/^fake:\/\/get\//);
    expect(await layUrlTaiTep(ids.B, f.id)).toEqual({ ok: false, ma: 404 });
    expect(await layUrlTaiTep(null, f.id)).toEqual({ ok: false, ma: 401 });
    expect((await layUrlTaiTep(ids.GV, f.id)).ok).toBe(true); // giáo viên ĐƯỢC PHÂN lớp của bài + có quyền chấm
    expect(await layUrlTaiTep(ids.GV2, f.id)).toEqual({ ok: false, ma: 404 }); // giáo viên lớp KHÁC (cùng quyền nhưng ngoài lớp) ⇒ không tải được
    expect(await layUrlTaiTep(ids.HR, f.id)).toEqual({ ok: false, ma: 404 });
    expect(await layUrlTaiTep(ids.A, "khong-co")).toEqual({ ok: false, ma: 404 });
    const cu = await db.assignmentSubmission.create({ data: { assignmentId: A("f1"), studentId: S2, status: "SUBMITTED", textAnswer: "x", submittedAt: new Date() } as never });
    const congKhai = await db.assignmentSubmissionFile.create({ data: { submissionId: cu.id, fileUrl: "https://cdn.test/a.jpg", fileName: "a.jpg" } });
    expect(await layUrlTaiTep(ids.A, congKhai.id)).toEqual({ ok: false, ma: 404 }); // tệp công khai cũ không đi đường riêng
    datKhoTepRieng({ ...kho, kyGet: async () => null });
    expect(await layUrlTaiTep(ids.A, f.id)).toEqual({ ok: false, ma: 503 });
  });

  it("[UP-DB-10] KHÔNG kho riêng ⇒ 503 (không rơi về URL công khai) và đọc chi tiết bỏ tệp riêng", async () => {
    const truoc = { r2: process.env.R2_MOBILE_UPLOAD_BUCKET_NAME, loc: process.env.MOBILE_UPLOAD_LOCAL_DIR };
    delete process.env.R2_MOBILE_UPLOAD_BUCKET_NAME;
    delete process.env.MOBILE_UPLOAD_LOCAL_DIR;
    datKhoTepRieng(null);
    try {
      expect(await ma(await xinVeBai(tA, S1, "f1", "ve-503-0001-a"))).toEqual([503, "SERVER"]);
      const ct = (await json(await chiTiet(tA, S1, A("f3")))).data;
      expect(ct.baiNop.tep).toHaveLength(0); // fail-closed: không ký được ⇒ BỎ tệp
      expect(await layUrlTaiTep(ids.A, (await db.assignmentSubmissionFile.findFirst({ where: { submission: { assignmentId: A("f3"), studentId: S1 } } }))!.id)).toEqual({ ok: false, ma: 503 });
    } finally {
      if (truoc.r2) process.env.R2_MOBILE_UPLOAD_BUCKET_NAME = truoc.r2;
      if (truoc.loc) process.env.MOBILE_UPLOAD_LOCAL_DIR = truoc.loc;
    }
  });

  it("[UP-DB-11] nhận dạng nội dung từng định dạng", () => {
    const b = (...x: number[]) => new Uint8Array([...x, ...Array(32).fill(0x20)]);
    const chu = (s: string, vt = 0) => { const a = new Uint8Array(40).fill(0x20); a.set([...s].map((c) => c.charCodeAt(0)), vt); return a; };
    expect(kiemNoiDung("image/jpeg", b(0xff, 0xd8, 0xff))).toBe(true);
    expect(kiemNoiDung("image/jpeg", b(0x89, 0x50, 0x4e, 0x47))).toBe(false);
    expect(kiemNoiDung("image/png", b(0x89, 0x50, 0x4e, 0x47))).toBe(true);
    expect(kiemNoiDung("image/gif", chu("GIF89a"))).toBe(true);
    expect(kiemNoiDung("application/pdf", chu("%PDF-1.7"))).toBe(true);
    expect(kiemNoiDung("application/pdf", chu("<html>"))).toBe(false);
    expect(kiemNoiDung("video/mp4", chu("ftypisom", 4))).toBe(true);
    expect(kiemNoiDung("image/webp", (() => { const a = chu("RIFF"); a.set([...("WEBP")].map((c) => c.charCodeAt(0)), 8); return a; })())).toBe(true);
    expect(kiemNoiDung("text/plain", chu("xin chào"))).toBe(true);
    expect(kiemNoiDung("text/plain", b(0x68, 0x00, 0x69))).toBe(false); // nhị phân giả làm chữ
    expect(kiemNoiDung("application/x-msdownload", b(0x4d, 0x5a))).toBe(false); // loại lạ ⇒ không nhận
    expect(kiemNoiDung("image/jpeg", new Uint8Array([0xff, 0xd8]))).toBe(false); // quá ngắn
  });
});
