// @vitest-environment node
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({ phien: null as null | { user: Record<string, unknown> } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => M.phien), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { GET as fileNguoiCham } from "@/app/api/admin/online-exam/submissions/[submissionId]/file/route";
import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as batDauPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/route";
import { PUT as nhapPut } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/draft/route";
import { POST as veTaiLenPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/product/upload-ticket/route";
import { POST as dangKyPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/product/submit/route";
import { POST as nopPost } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/attempts/[attemptId]/submit/route";
import { db } from "@/lib/db";
import { capQuyenHoc } from "@/lib/elearning-online/quyen-hoc-db";
import { datKhoTepRieng, type KhoTepRieng } from "@/lib/mobile-api/kho-tep-rieng";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { donBangOnl } from "../elearning/_onl-don";
import { CAU_CO_BAN, dungKhoaThi } from "./_online-exam-fixture";

/**
 * [OSP] NỘP SẢN PHẨM (câu PRODUCT) trên app — vé tải lên + đăng ký bài nộp + người chấm tải về. Postgres thật + lõi E thật + kho tệp GIẢ trong bộ nhớ.
 *   [OSP-01] vé: HS ⇒ 200, khoá `online/sp/{khoá}/{em}/{lượt}-{câu}-{uuid}.{đuôi}`, đúng Content-Type; phụ huynh phiên thường ⇒ 403; nhà khác ⇒ 404; chưa đăng nhập ⇒ 401
 *   [OSP-02] vé từ chối sớm: loại tệp lạ · quá cỡ khai · thời lượng quá trần · thời lượng cho ảnh · câu không phải PRODUCT · lượt lạ ⇒ 422/404; kho chưa cấu hình ⇒ 503
 *   [OSP-03] đăng ký đúng: tệp đã PUT ⇒ 200 `submissionId`, bài nộp lưu CỠ THẬT; mã đó lưu được làm đáp án nháp; gửi lại cùng khoá ⇒ idempotent (một dòng)
 *   [OSP-04] đăng ký sai: tệp chưa lên · MIME thật khác khai · byte đầu không đúng định dạng · quá cỡ THẬT (đối tượng bị XOÁ) ⇒ 422, không có dòng bài nộp
 *   [OSP-05] khoá không thuộc đúng lượt+câu+em (lượt/câu khác, em khác, `..`, URL) ⇒ 422, không có dòng bài nộp
 *   [OSP-06] lượt đã nộp ⇒ 409 DA_NOP (vé lẫn đăng ký), không đổi gì
 *   [OSP-07] người chấm: chưa đăng nhập 401 · thiếu quyền `onl:assessment:grade` 403 · có quyền ⇒ URL KÝ (TTL 5 phút) · bài nộp lạ 404
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "osp-";
const MK = "Mat-khau-test-2026";
const MB = 1024 * 1024;
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; maChiTiet?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;

/** Kho giả: mọi thao tác ở bộ nhớ; `ghi` đóng vai «app PUT tệp lên URL ký». */
function taoKhoGia() {
  const o = new Map<string, { du: Uint8Array; loai: string }>();
  const daKy: string[] = [];
  const kho: KhoTepRieng = {
    ten: "gia",
    async kyPut(key, loai) { daKy.push(key); return { url: `mem://put/${key}`, headers: { "Content-Type": loai } }; },
    async dau(key) { const x = o.get(key); return x ? { size: x.du.length, contentType: x.loai } : null; },
    async docByteDau(key, n) { const x = o.get(key); return x ? x.du.slice(0, n) : null; },
    async kyGet(key, _ttl, ten) { return o.has(key) ? `mem://get/${key}?ten=${encodeURIComponent(ten ?? "")}` : null; },
    async xoa(key) { o.delete(key); },
  };
  return { kho, o, daKy, ghi: (key: string, du: Uint8Array, loai: string) => void o.set(key, { du, loai }) };
}
const MP4 = (n = 64) => { const b = new Uint8Array(n); b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]); return b; }; // …ftypmp42
const PNG = (n = 64) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47]); return b; };

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

describe.skipIf(!RUN)("[OSP] nộp sản phẩm Online qua HTTP + Postgres thật + lõi E thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  let khoa: Awaited<ReturnType<typeof dungKhoaThi>>;
  let spId = "";
  let cauKhacId = "";
  const base = (s: string) => `/api/mobile/v1/students/${s}/online/courses/${khoa.courseId}/lessons/${khoa.lessonStableId}`;
  const ctx = (s: string, a?: string) => ({ params: Promise.resolve({ studentId: s, courseId: khoa.courseId, lessonId: khoa.lessonStableId, attemptId: a }) as never });
  const batHS = (userId: string, s: string) => db.mobileSession.updateMany({ where: { userId, thuHoiLuc: null }, data: { hocSinhId: s, hocSinhTuLuc: new Date() } });
  const batPH = (userId: string) => db.mobileSession.updateMany({ where: { userId, thuHoiLuc: null }, data: { hocSinhId: null, hocSinhTuLuc: null } });
  const ve = (tok: string, s: string, a: string, than: unknown) => veTaiLenPost(req("POST", `${base(s)}/attempts/${a}/product/upload-ticket`, than, bearer(tok)), ctx(s, a));
  const dk = (tok: string, s: string, a: string, than: unknown) => dangKyPost(req("POST", `${base(s)}/attempts/${a}/product/submit`, than, bearer(tok)), ctx(s, a));
  const veOk = async (s: string, a: string, o: Partial<{ mime: string; sizeBytes: number; durationSec: number; fileName: string }> = {}) => {
    const r = await ve(tA, s, a, { questionId: spId, fileName: "robot.mp4", mime: "video/mp4", sizeBytes: 1000, ...((o.mime ?? "video/mp4").startsWith("image") ? {} : { durationSec: 30 }), ...o });
    expect(r.status).toBe(200);
    return (await json(r)).data as { uploadUrl: string; key: string; headers: Record<string, string>; hetHanLuc: string; toiDaByte: number };
  };
  /** Học viên MỚI của nhà A có quyền học + một lượt đang làm; HS bật. */
  const lamBai = async (ten: string) => {
    const s = await db.student.create({ data: { id: `${NS}${ten}-${++dem}`, name: `Bé ${ten}`, parentUserId: ids.A } as never, select: { id: true } });
    const c = await capQuyenHoc(db, { studentId: s.id, courseId: khoa.courseId, loai: "MUA", now: new Date(), idempotencyKey: `${NS}cap-${s.id}` });
    if (!c.ok) throw new Error(c.thongBao);
    await batHS(ids.A!, s.id);
    const r = await batDauPost(req("POST", `${base(s.id)}/attempts`, {}, bearer(tA)), ctx(s.id));
    if (r.status !== 200) throw new Error(`bắt đầu lượt ${r.status}: ${JSON.stringify((await json(r)).error)}`);
    return { s: s.id, a: (await json(r)).data.luotId as string };
  };

  const kho = taoKhoGia();
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    process.env.LOGIN_RATELIMIT_DISABLED = "1";
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string, role = "PARENT") => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role, roles: [role] } as never, select: { id: true } })).id);
    await mk("A", "84966980001");
    await mk("B", "84966980002");
    await mk("admin", "84966980003", "SUPER_ADMIN");
    const ho = await db.orgUnit.findFirstOrThrow({ where: { type: "HO" }, select: { id: true } });
    const rd = await db.roleDef.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: ids.admin!, orgUnitId: ho.id, roleId: rd.id, grantedById: ids.admin! } });
    ids.sB = (await db.student.create({ data: { id: `${NS}sB`, name: "Bé B", parentUserId: ids.B } as never, select: { id: true } })).id;
    const dn = async (sdt: string, nn: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9d00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966980001", 1);
    tB = await dn("0966980002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    khoa = await dungKhoaThi({
      ten: "OSP",
      timeLimitMin: 30,
      cau: [...CAU_CO_BAN.slice(0, 1), { khoa: "sp", input: { type: "PRODUCT", stem: "Quay video robot", cauHinh: { accept: ["VIDEO", "IMAGE"], maxMb: 1, maxVideoSec: 60 } } }],
    });
    cauKhacId = khoa.q.chonMot!;
    spId = khoa.q.sp!;
    const cb = await capQuyenHoc(db, { studentId: ids.sB!, courseId: khoa.courseId, loai: "MUA", now: new Date(), idempotencyKey: `${NS}capB` });
    if (!cb.ok) throw new Error(cb.thongBao);
    datKhoTepRieng(kho.kho);
  }, 120_000);
  afterAll(async () => {
    datKhoTepRieng(null);
    M.phien = null;
    await don();
  }, 60_000);

  it("[OSP-01] vé: HS ⇒ 200 đúng khoá/Content-Type; phụ huynh phiên thường ⇒ 403; nhà khác ⇒ 404; chưa đăng nhập ⇒ 401", async () => {
    const { s, a } = await lamBai("ve");
    const v = await veOk(s, a);
    expect(v.key.startsWith(`online/sp/${khoa.courseId}/${s}/${a}-${spId}-`)).toBe(true);
    expect(v.key.endsWith(".mp4")).toBe(true);
    expect(v.headers["Content-Type"]).toBe("video/mp4");
    expect(v.uploadUrl).toContain(v.key);
    expect(v.toiDaByte).toBe(1 * MB);
    expect(new Date(v.hetHanLuc).getTime()).toBeGreaterThan(Date.now());
    // đuôi do MÁY CHỦ suy từ MIME, không từ tên tệp khai
    expect((await veOk(s, a, { mime: "image/png", fileName: "x.exe" })).key.endsWith(".png")).toBe(true);

    await batPH(ids.A!); // phiên thường của phụ huynh: ghi ⇒ 403, KHÔNG cấp vé
    const dem0 = kho.daKy.length;
    const ph = await ve(tA, s, a, { questionId: spId, fileName: "r.mp4", mime: "video/mp4", sizeBytes: 10 });
    expect([ph.status, (await json(ph)).error?.code]).toEqual([403, "FORBIDDEN"]);
    expect(kho.daKy.length).toBe(dem0);
    await batHS(ids.A!, s);
    const khac = await ve(tB, s, a, { questionId: spId, fileName: "r.mp4", mime: "video/mp4", sizeBytes: 10 });
    expect(khac.status).toBe(404);
    const an = await veTaiLenPost(req("POST", `${base(s)}/attempts/${a}/product/upload-ticket`, { questionId: spId, fileName: "r.mp4", mime: "video/mp4", sizeBytes: 10 }), ctx(s, a));
    expect(an.status).toBe(401);
  }, 90_000);

  it("[OSP-02] vé từ chối sớm: loại lạ · quá cỡ · thời lượng · ảnh có thời lượng · câu không phải PRODUCT · lượt lạ; kho chưa cấu hình ⇒ 503", async () => {
    const { s, a } = await lamBai("tuchoi");
    const thu = async (o: Record<string, unknown>) => { const r = await ve(tA, s, a, { questionId: spId, fileName: "r.mp4", mime: "video/mp4", sizeBytes: 1000, durationSec: 30, ...o }); return [r.status, (await json(r)).error?.code]; };
    expect(await thu({ mime: "application/pdf" })).toEqual([422, "TEP_KHONG_HOP_LE"]); // câu chỉ nhận VIDEO/IMAGE
    expect(await thu({ mime: "video/x-msvideo" })).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect(await thu({ sizeBytes: 1 * MB + 1 })).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect(await thu({ durationSec: 61 })).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect(await thu({ durationSec: undefined })).toEqual([422, "TEP_KHONG_HOP_LE"]); // video có trần thời lượng mà không khai thời lượng
    expect(await thu({ mime: "image/png", durationSec: 5 })).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect((await thu({ mime: "image/png", durationSec: undefined }))[0]).toBe(200); // ảnh KHÔNG cần thời lượng
    expect(await thu({ questionId: cauKhacId })).toEqual([422, "CAU_KHONG_PHAI_SAN_PHAM"]);
    expect((await ve(tA, s, "khong-co-luot", { questionId: spId, fileName: "r.mp4", mime: "video/mp4", sizeBytes: 10 })).status).toBe(404);
    expect((await thu({ fileName: "a/b.mp4" }))[0]).toBe(400); // tên tệp có dấu `/` ⇒ sai lược đồ
    expect((await thu({ sizeBytes: 0 }))[0]).toBe(400);
    datKhoTepRieng(null);
    delete process.env.R2_MOBILE_UPLOAD_BUCKET_NAME;
    try {
      expect(await thu({})).toEqual([503, "KHO_TEP_CHUA_CAU_HINH"]);
    } finally {
      datKhoTepRieng(kho.kho);
    }
  }, 90_000);

  it("[OSP-03] đăng ký đúng ⇒ submissionId + CỠ THẬT; đưa làm đáp án nháp; gửi lại cùng khoá ⇒ idempotent", async () => {
    const { s, a } = await lamBai("dung");
    const v = await veOk(s, a, { sizeBytes: 9999 }); // khai 9999 nhưng tệp thật 64 byte
    kho.ghi(v.key, MP4(64), "video/mp4");
    const r = await dk(tA, s, a, { questionId: spId, key: v.key, name: "Robot của em.mp4", mime: "video/mp4", durationSec: 30 });
    expect(r.status).toBe(200);
    const b = (await json(r)).data as { submissionId: string; nopLai: boolean; daDangKyTruocDo: boolean };
    expect(b.daDangKyTruocDo).toBe(false);
    const dong = await db.onlSubmission.findUniqueOrThrow({ where: { id: b.submissionId } });
    expect([dong.fileKey, dong.fileName, dong.mimeType, dong.sizeBytes, dong.durationSec, dong.studentId, dong.attemptId, dong.questionId]).toEqual([v.key, "Robot của em.mp4", "video/mp4", 64, 30, s, a, spId]);
    const lai = await dk(tA, s, a, { questionId: spId, key: v.key, name: "Robot của em.mp4", mime: "video/mp4", durationSec: 30 });
    expect((await json(lai)).data).toMatchObject({ submissionId: b.submissionId, daDangKyTruocDo: true });
    expect(await db.onlSubmission.count({ where: { attemptId: a, questionId: spId } })).toBe(1);
    // mã bài nộp là «câu trả lời» của câu PRODUCT
    const luu = await nhapPut(req("PUT", `${base(s)}/attempts/${a}/draft`, { requestId: `osp-${Date.now()}`, deviceId: "may-1", items: [{ questionId: spId, answer: b.submissionId, baseRevision: 0 }] }, bearer(tA)), ctx(s, a));
    expect(luu.status).toBe(200);
    expect((await json(luu)).data.items[0].ketQua).toBe("SAVED");
  }, 90_000);

  it("[OSP-04] đăng ký sai: chưa lên · MIME thật khác · byte đầu sai · quá cỡ thật (đối tượng bị XOÁ) ⇒ 422, không có dòng bài nộp", async () => {
    const { s, a } = await lamBai("sai");
    const gui = async (key: string, mime = "video/mp4") => { const r = await dk(tA, s, a, { questionId: spId, key, name: "x.mp4", mime, durationSec: 30 }); return [r.status, (await json(r)).error?.code]; };
    const v1 = await veOk(s, a);
    expect(await gui(v1.key)).toEqual([422, "TEP_KHONG_HOP_LE"]); // chưa PUT
    const v2 = await veOk(s, a);
    kho.ghi(v2.key, PNG(64), "image/png"); // khai mp4, thật là ảnh
    expect(await gui(v2.key)).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect(kho.o.has(v2.key)).toBe(false);
    const v3 = await veOk(s, a);
    kho.ghi(v3.key, new Uint8Array(64).fill(7), "video/mp4"); // đúng Content-Type nhưng ruột không phải mp4
    expect(await gui(v3.key)).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect(kho.o.has(v3.key)).toBe(false);
    const v4 = await veOk(s, a);
    kho.ghi(v4.key, MP4(1 * MB + 1), "video/mp4"); // quá cỡ THẬT dù lúc xin vé khai nhỏ
    expect(await gui(v4.key)).toEqual([422, "TEP_KHONG_HOP_LE"]);
    expect(kho.o.has(v4.key)).toBe(false);
    const v5 = await veOk(s, a);
    kho.ghi(v5.key, MP4(64), "video/mp4");
    expect((await dk(tA, s, a, { questionId: spId, key: v5.key, name: "x.mp4", mime: "video/mp4", durationSec: 61 })).status).toBe(422); // thời lượng quá trần
    expect(await db.onlSubmission.count({ where: { attemptId: a } })).toBe(0);
  }, 90_000);

  it("[OSP-05] khoá không thuộc đúng lượt+câu+em ⇒ 422, không có dòng bài nộp", async () => {
    const { s, a } = await lamBai("khoa");
    const kia = await lamBai("khoa-kia");
    const tuKia = await veOk(kia.s, kia.a); // khoá hợp lệ nhưng của lượt/em KHÁC (phiên đang ở chế độ học sinh của «kia»)
    kho.ghi(tuKia.key, MP4(64), "video/mp4");
    await batHS(ids.A!, s); // quay lại em thứ nhất để nộp
    const v = await veOk(s, a);
    kho.ghi(v.key, MP4(64), "video/mp4");
    // Đối tượng được GHI sẵn ở mọi khoá thử ⇒ 422 chỉ có thể đến từ việc khoá KHÔNG thuộc đúng lượt+câu+em (không phải «tệp chưa lên»).
    const thu = async (key: string) => { kho.ghi(key, MP4(64), "video/mp4"); return (await dk(tA, s, a, { questionId: spId, key, name: "x.mp4", mime: "video/mp4", durationSec: 30 })).status; };
    expect(await thu(v.key)).toBe(200); // ĐỐI CHỨNG DƯƠNG: khoá đúng + có thời lượng thì ĐƯỢC — nếu không, các ca 422 dưới đây xanh vì lý do sai
    await db.onlSubmission.deleteMany({ where: { attemptId: a } });
    expect(await thu(tuKia.key)).toBe(422);
    expect(await thu(v.key.replace(`-${spId}-`, "-cau-khac-"))).toBe(422);
    expect(await thu(v.key.replace(`/${s}/`, `/${ids.sB}/`))).toBe(422);
    expect(await thu(`online/sp/${khoa.courseId}/${s}/../${ids.sB}/x.mp4`)).toBe(422);
    expect(await thu(`https://evil.example/${v.key}`)).toBe(422);
    expect(await thu(`${v.key}%20`)).toBe(422);
    expect(await db.onlSubmission.count({ where: { attemptId: a } })).toBe(0);
  }, 90_000);

  it("[OSP-06] lượt đã nộp ⇒ 409 DA_NOP (vé lẫn đăng ký)", async () => {
    const { s, a } = await lamBai("danop");
    const v = await veOk(s, a);
    kho.ghi(v.key, MP4(64), "video/mp4");
    expect((await nopPost(req("POST", `${base(s)}/attempts/${a}/submit`, { traLoi: {} }, bearer(tA)), ctx(s, a))).status).toBe(200);
    const moi = await ve(tA, s, a, { questionId: spId, fileName: "r.mp4", mime: "video/mp4", sizeBytes: 10 });
    expect([moi.status, (await json(moi)).error?.code]).toEqual([409, "DA_NOP"]);
    const dky = await dk(tA, s, a, { questionId: spId, key: v.key, name: "x.mp4", mime: "video/mp4", durationSec: 30 });
    expect([dky.status, (await json(dky)).error?.code]).toEqual([409, "DA_NOP"]);
    expect(await db.onlSubmission.count({ where: { attemptId: a } })).toBe(0);
  }, 90_000);

  it("[OSP-07] người chấm: 401 / 403 / URL KÝ / bài lạ 404", async () => {
    const { s, a } = await lamBai("cham");
    const v = await veOk(s, a);
    kho.ghi(v.key, MP4(64), "video/mp4");
    const rDk = await dk(tA, s, a, { questionId: spId, key: v.key, name: "Robot.mp4", mime: "video/mp4", durationSec: 30 });
    if (rDk.status !== 200) throw new Error(`đăng ký ${rDk.status}: ${JSON.stringify((await json(rDk)).error)}`);
    const sub = ((await json(rDk)).data as { submissionId: string }).submissionId;
    const goi = (id: string) => fileNguoiCham(req("GET", `/x`), { params: Promise.resolve({ submissionId: id }) });
    M.phien = null;
    expect((await goi(sub)).status).toBe(401);
    M.phien = { user: { id: ids.A, role: "PARENT", roles: ["PARENT"] } }; // phụ huynh: KHÔNG có quyền chấm
    expect((await goi(sub)).status).toBe(403);
    M.phien = { user: { id: ids.admin, role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] } };
    try {
      const r = await goi(sub);
      expect(r.status).toBe(200);
      const d = (await json(r)).data as { url: string; hetHanLuc: string; tenTep: string; mime: string };
      expect(d.url).toContain(v.key);
      expect([d.tenTep, d.mime]).toEqual(["Robot.mp4", "video/mp4"]);
      expect(new Date(d.hetHanLuc).getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
      expect((await goi("khong-co-bai-nop")).status).toBe(404);
      expect((await goi("../etc/passwd")).status).toBe(404);
    } finally {
      M.phien = null;
    }
  }, 90_000);
});
