import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as hoSoGet, PATCH as hoSoPatch } from "@/app/api/mobile/v1/parent/profile/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as dongYGet, PUT as dongYPut } from "@/app/api/mobile/v1/students/[studentId]/consents/photo/route";
import { DELETE as donXoa, PATCH as donSua } from "@/app/api/mobile/v1/students/[studentId]/pickup-contacts/[contactId]/route";
import { GET as donGet, POST as donPost } from "@/app/api/mobile/v1/students/[studentId]/pickup-contacts/route";
import { GET as noiDungGet } from "@/app/api/mobile/v1/students/[studentId]/sessions/[sessionId]/content/route";
import { POST as yeuCauPost } from "@/app/api/mobile/v1/students/[studentId]/requests/route";
import { db } from "@/lib/db";
import { layAnhBuoiHoc } from "@/lib/mobile-api/dich-vu/anh-buoi-hoc";
import { goNguoiDon, themNguoiDon } from "@/lib/mobile-api/dich-vu/ho-so-ghi";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [HSG-DB] V8.4 (G2) — GHI hồ sơ phụ huynh từ app, Postgres thật:
 *   [HSG-DB-01] PATCH profile: chỉ địa chỉ + phụ huynh 2 (strict: tên/email/SĐT đăng nhập/trường lạ ⇒ 400); ghi như web (User.address + Student.parent2* của MỌI con); SĐT chuẩn hoá; audit CHỈ tên trường; nhà khác không ảnh hưởng
 *   [HSG-DB-02] đồng ý ảnh: GET trạng thái + lịch sử; PUT đổi (audit cùng hàm web); lặp cùng giá trị ⇒ không audit trùng; thu hồi ⇒ ảnh biến mất; con nhà khác 404
 *   [HSG-DB-03] người đón: thêm/sửa/gỡ; SĐT chuẩn hoá + không trùng (409); tối đa 5 — 24 yêu cầu SONG SONG ⇒ đúng 5 thành công; gỡ = thu hồi (giữ dòng); sửa/gỡ dòng của bé khác hoặc đã gỡ ⇒ 404; audit không chứa PII
 *   [HSG-DB-04] yêu cầu «Ưu đãi & tư vấn»/«Hỏi thêm thầy»: tạo ParentRequest OTHER đúng chủ đề; KHÔNG tạo đơn/khoản thu/giảm giá
 *   [HSG-DB-05] nội dung buổi (HL-Buoi): bài tập gắn buổi + đề về nhà của CHÍNH học viên; buổi lớp khác/không có ⇒ 404; chưa gắn bài giảng ⇒ baiGiang null; cờ LMS tắt ⇒ 404
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "hsg-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.94.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const A = (k: string) => `${NS}${k}`;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: uids } }, { entityId: { startsWith: NS } }] } });
  await db.studentPickupContact.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.homeworkAssignment.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.examQuestion.deleteMany({ where: { examId: { startsWith: NS } } });
  await db.exam.deleteMany({ where: { id: { startsWith: NS } } });
  await db.assignment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.classSession.deleteMany({ where: { id: { startsWith: NS } } });
  await db.mediaStudentTag.deleteMany({ where: { mediaId: { startsWith: NS } } });
  await db.classSessionMedia.deleteMany({ where: { id: { startsWith: NS } } });
  await db.studentConsent.deleteMany({ where: { studentId: { startsWith: NS } } });
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

describe.skipIf(!RUN)("[HSG-DB] ghi hồ sơ phụ huynh — Postgres thật", () => {
  const ids: Record<string, string> = {};
  const S1 = A("s1");
  const S2 = A("s2"); // cùng nhà A
  const S3 = A("s3"); // nhà B
  let tA = "";
  let tB = "";
  const ctx = (sv: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ studentId: sv, ...extra }) as never });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const [k, sdt] of [["A", "84966970001"], ["B", "84966970002"]] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở HSG", slug: A("cs"), address: "Địa chỉ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá HSG", slug: A("kh"), totalSessions: 12 } });
    for (const l of ["l1", "l2"]) await db.class.create({ data: { id: A(l), name: `Lớp ${l}`, classCode: A(l), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: S1, name: "An", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S2, name: "Bình", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S3, name: "Cường", parentUserId: ids.B, centerId: A("cs") } as never });
    await db.enrollment.create({ data: { id: A("dk1"), studentId: S1, classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    await db.enrollment.create({ data: { id: A("dk3"), studentId: S3, classId: A("l2"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    const dn = async (sdt: string, n: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9b00-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966970001", 1);
    tB = await dn("0966970002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
  }, 120_000);
  afterAll(don);

  it("[HSG-DB-01] sửa hồ sơ: chỉ địa chỉ + phụ huynh 2; strict; chuẩn hoá SĐT; audit không PII", async () => {
    const patch = (tok: string, than: unknown) => hoSoPatch(req("PATCH", "/api/mobile/v1/parent/profile", than, bearer(tok)));
    const r = await patch(tA, { diaChi: "  12 Nguyễn Văn Linh,  Đà Nẵng ", phuHuynh2: { ten: "Bà Ngoại", sdt: "0912 345 678" } });
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect([d.diaChi, d.phuHuynh2.ten]).toEqual(["12 Nguyễn Văn Linh, Đà Nẵng", "Bà Ngoại"]);
    expect(d.phuHuynh2.sdt).toMatch(/^84?\d{9,11}$|^0?\d{9,11}$/);
    // ghi như web: mọi con của nhà A đều có phụ huynh 2; nhà B không đổi
    const con = await db.student.findMany({ where: { id: { in: [S1, S2, S3] } }, select: { id: true, parent2Name: true } });
    expect(con.filter((c) => c.parent2Name === "Bà Ngoại").map((c) => c.id).sort()).toEqual([S1, S2]);
    expect((await db.user.findUnique({ where: { id: ids.B! }, select: { address: true } }))?.address).toBeNull();
    // KHÔNG sửa tên / email / SĐT đăng nhập / trường lạ
    for (const x of [{ ten: "Tên mới" }, { name: "X" }, { email: "a@b.c" }, { phone: "0900000000" }, { diaChi: "x", id: "u" }, { phuHuynh2: { ten: "a", email: "b" } }, {}, { phuHuynh2: {} }]) {
      expect(await ma(await patch(tA, x)), JSON.stringify(x)).toEqual([400, "VALIDATION"]);
    }
    expect(await ma(await patch(tA, { phuHuynh2: { sdt: "abc" } }))).toEqual([400, "VALIDATION"]);
    expect((await db.user.findUnique({ where: { id: ids.A! }, select: { name: true } }))?.name).toBe("PH A"); // tên giữ nguyên
    // xoá phụ huynh 2 bằng chuỗi rỗng
    expect((await patch(tA, { phuHuynh2: { ten: "", sdt: "" } })).status).toBe(200);
    expect((await db.student.findUnique({ where: { id: S1 }, select: { parent2Name: true, parent2Phone: true } }))).toEqual({ parent2Name: null, parent2Phone: null });
    // audit: chỉ tên trường, không giá trị
    const kt = await db.auditLog.findMany({ where: { actorId: ids.A, action: "PROFILE_UPDATED_MOBILE" }, select: { changedFields: true, newValues: true, oldValues: true } });
    expect(kt.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(kt)).not.toMatch(/Nguyễn Văn Linh|Bà Ngoại|0912|912345/);
    // đọc lại qua GET (web ghi → mobile đọc cùng nguồn)
    const doc = await hoSoGet(req("GET", "/api/mobile/v1/parent/profile", undefined, bearer(tA)));
    expect(doc.status).toBe(200);
    expect(JSON.stringify((await json(doc)).data)).toContain("12 Nguyễn Văn Linh");
    expect((await hoSoPatch(req("PATCH", "/api/mobile/v1/parent/profile", { diaChi: "x" }))).status).toBe(401);
  });

  it("[HSG-DB-02] đồng ý hình ảnh: đổi + lịch sử + thu hồi ⇒ ảnh biến mất", async () => {
    const get = (sv: string, tok = tA) => dongYGet(req("GET", `/api/mobile/v1/students/${sv}/consents/photo`, undefined, bearer(tok)), ctx(sv));
    const put = (sv: string, than: unknown, tok = tA) => dongYPut(req("PUT", `/api/mobile/v1/students/${sv}/consents/photo`, than, bearer(tok)), ctx(sv));
    expect((await json(await get(S1))).data).toEqual({ trangThai: "CHUA_CO", lichSu: [] });
    expect((await put(S1, { dongY: true })).status).toBe(200);
    await put(S1, { dongY: true }); // lặp ⇒ không audit trùng
    let d = (await json(await get(S1))).data;
    expect([d.trangThai, d.lichSu.length, d.lichSu[0].hanhDong, d.lichSu[0].nguon]).toEqual(["DA_DONG_Y", 1, "DONG_Y", "MOBILE_APP"]);
    // có ảnh gắn thẻ ⇒ thấy; thu hồi ⇒ biến mất
    await db.classSessionMedia.create({ data: { id: A("anh1"), classId: A("l1"), fileUrl: "https://kho.invalid/a.jpg", status: "APPROVED" } as never });
    await db.mediaStudentTag.create({ data: { mediaId: A("anh1"), studentId: S1 } });
    const ky = async (u: string) => `ky:${u.length}`;
    expect((await layAnhBuoiHoc(S1 as never, { soLuong: 10, trang: 1 }, ky)).tongSo).toBe(1);
    await put(S1, { dongY: false });
    d = (await json(await get(S1))).data;
    expect([d.trangThai, d.lichSu.length, d.lichSu[0].hanhDong]).toEqual(["DA_THU_HOI", 2, "THU_HOI"]);
    expect((await layAnhBuoiHoc(S1 as never, { soLuong: 10, trang: 1 }, ky)).tongSo).toBe(0);
    expect(await ma(await put(S3, { dongY: true }))).toEqual([404, "NOT_FOUND"]); // con nhà khác
    expect((await get(S3)).status).toBe(404);
    for (const x of [{}, { dongY: "co" }, { dongY: true, khac: 1 }]) expect(await ma(await put(S1, x)), JSON.stringify(x)).toEqual([400, "VALIDATION"]);
  });

  it("[HSG-DB-03] người đón con: thêm/sửa/gỡ, trùng SĐT, tối đa 5 song song, cách ly, audit không PII", async () => {
    const them = (sv: string, than: unknown, tok = tA) => donPost(req("POST", `/api/mobile/v1/students/${sv}/pickup-contacts`, than, bearer(tok)), ctx(sv));
    const ds = (sv: string, tok = tA) => donGet(req("GET", `/api/mobile/v1/students/${sv}/pickup-contacts`, undefined, bearer(tok)), ctx(sv));
    const sua = (sv: string, id: string, than: unknown, tok = tA) => donSua(req("PATCH", `/api/mobile/v1/students/${sv}/pickup-contacts/${id}`, than, bearer(tok)), ctx(sv, { contactId: id }));
    const go = (sv: string, id: string, tok = tA) => donXoa(req("DELETE", `/api/mobile/v1/students/${sv}/pickup-contacts/${id}`, undefined, bearer(tok)), ctx(sv, { contactId: id }));
    const r = await them(S1, { hoTen: "  Nguyễn Văn Ông ", quanHe: "Ông", soDienThoai: "0905 111 222", ghiChu: "Đón thứ 7" });
    expect(r.status).toBe(200);
    const c1 = (await json(r)).data;
    expect([c1.hoTen, c1.quanHe]).toEqual(["Nguyễn Văn Ông", "Ông"]);
    expect(c1.soDienThoai).not.toContain(" ");
    expect(await ma(await them(S1, { hoTen: "Người khác", quanHe: "Cô", soDienThoai: "0905111222" }))).toEqual([409, "VALIDATION"]); // trùng SĐT (cùng dạng chuẩn hoá)
    for (const x of [{ hoTen: "A", quanHe: "Ông", soDienThoai: "0905111333" }, { hoTen: "Ba Hai", quanHe: "Hàng xóm", soDienThoai: "0905111333" }, { hoTen: "Ba Hai", quanHe: "Ông", soDienThoai: "abc12345" }, { hoTen: "Ba Hai", quanHe: "Ông", soDienThoai: "0905111333", studentId: S3 }]) {
      expect(await ma(await them(S1, x)), JSON.stringify(x)).toEqual([400, "VALIDATION"]);
    }
    // sửa
    const s = await sua(S1, c1.id, { quanHe: "Bác", ghiChu: null });
    const sd = (await json(s.clone())).data;
    expect([s.status, sd.quanHe, sd.ghiChu]).toEqual([200, "Bác", null]);
    expect(await ma(await sua(S1, c1.id, {}))).toEqual([400, "VALIDATION"]);
    // cách ly: dòng của bé này không sửa/gỡ qua bé khác, nhà khác không thấy
    expect(await ma(await sua(S2, c1.id, { quanHe: "Cô" }))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await go(S2, c1.id))).toEqual([404, "NOT_FOUND"]);
    expect((await ds(S3, tA)).status).toBe(404);
    expect((await json(await ds(S3, tB))).data.muc).toEqual([]);
    expect((await sua(S3, c1.id, { quanHe: "Cô" }, tB)).status).toBe(404);
    // tối đa 5: 24 yêu cầu SONG SONG với SĐT khác nhau (đã có 1 ⇒ chỉ còn 4 chỗ)
    const song = await Promise.all(Array.from({ length: 24 }, (_, i) => them(S1, { hoTen: `Người đón ${i}`, quanHe: "Khác", soDienThoai: `09051200${String(i).padStart(2, "0")}` })));
    const trangThai = song.map((x) => x.status);
    expect([trangThai.filter((x) => x === 200).length, trangThai.filter((x) => x === 422).length]).toEqual([4, 20]);
    expect((await json(await ds(S1))).data.muc.length).toBe(5);
    // gỡ = thu hồi (giữ dòng), gỡ lần hai 404, sửa dòng đã gỡ 404, rồi thêm lại được
    expect((await go(S1, c1.id)).status).toBe(200);
    expect(await ma(await go(S1, c1.id))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await sua(S1, c1.id, { quanHe: "Cô" }))).toEqual([404, "NOT_FOUND"]);
    const dong = await db.studentPickupContact.findUnique({ where: { id: c1.id }, select: { trangThai: true, thuHoiLuc: true, thuHoiBoiUserId: true } });
    expect([dong?.trangThai, dong?.thuHoiLuc !== null, dong?.thuHoiBoiUserId]).toEqual(["REVOKED", true, ids.A]);
    expect((await them(S1, { hoTen: "Ông lại", quanHe: "Ông", soDienThoai: "0905111222" })).status).toBe(200); // SĐT đã gỡ dùng lại được
    expect((await json(await ds(S1))).data.muc.length).toBe(5);
    // audit: đủ hành động, KHÔNG PII
    const kt = await db.auditLog.findMany({ where: { entityType: "StudentPickupContact", actorId: ids.A }, select: { action: true, newValues: true, changedFields: true } });
    const act = new Set(kt.map((k) => k.action));
    expect([...act].sort()).toEqual(["PICKUP_CONTACT_ADDED", "PICKUP_CONTACT_REVOKED", "PICKUP_CONTACT_UPDATED"]);
    expect(JSON.stringify(kt)).not.toMatch(/Nguyễn Văn Ông|0905|Người đón|Ông lại/);
  });

  it("[HSG-DB-03b] ĐUA ở tầng dịch vụ: 40 lần thêm song song (SĐT khác nhau) ⇒ đúng 5 người sống; cùng SĐT 10 lần song song ⇒ đúng 1", async () => {
    const nguoi = { userId: ids.A!, sessionId: "x", name: "n", email: "e", phone: null, hocSinhId: null };
    const kq = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => themNguoiDon(S2 as never, nguoi, { hoTen: `Đua ${i}`, quanHe: "Khác", soDienThoai: `09061200${String(i).padStart(2, "0")}` })));
    expect(kq.filter((k) => k.status === "fulfilled").length).toBe(5);
    expect(await db.studentPickupContact.count({ where: { studentId: S2, trangThai: "ACTIVE" } })).toBe(5);
    // gỡ hết rồi đua cùng một SĐT
    const song = await db.studentPickupContact.findMany({ where: { studentId: S2, trangThai: "ACTIVE" }, select: { id: true } });
    for (const x of song) await goNguoiDon(S2 as never, nguoi, x.id);
    const cung = await Promise.allSettled(Array.from({ length: 10 }, () => themNguoiDon(S2 as never, nguoi, { hoTen: "Cùng số", quanHe: "Ông", soDienThoai: "0907000111" })));
    expect(cung.filter((k) => k.status === "fulfilled").length).toBe(1);
    expect(await db.studentPickupContact.count({ where: { studentId: S2, trangThai: "ACTIVE", soDienThoai: { contains: "907000111" } } })).toBe(1);
  });

  it("[HSG-DB-04] «Ưu đãi & tư vấn» / «Hỏi thêm thầy» chỉ tạo yêu cầu, không giảm giá/không khoản thu", async () => {
    const gui = (sv: string, than: unknown) => yeuCauPost(req("POST", `/api/mobile/v1/students/${sv}/requests`, than, bearer(tA)), ctx(sv));
    const truocDon = await db.order.count();
    const r1 = await gui(S1, { loai: "khac", chuDe: "Ưu đãi & tư vấn", ghiChu: "Ba mẹ muốn được tư vấn ưu đãi gia hạn" });
    expect(r1.status).toBe(200);
    const r2 = await gui(S1, { loai: "khac", chuDe: "Giáo viên & lớp", ghiChu: "Em muốn hỏi thêm thầy về bài robot" });
    expect(r2.status).toBe(200);
    const ds = await db.parentRequest.findMany({ where: { studentId: S1 }, select: { type: true, status: true, content: true } });
    expect(ds.every((x) => x.type === "OTHER" && x.status === "PENDING")).toBe(true);
    expect(ds.some((x) => x.content.includes("Chủ đề: Ưu đãi & tư vấn"))).toBe(true);
    expect(ds.some((x) => x.content.includes("Chủ đề: Giáo viên & lớp"))).toBe(true);
    expect(await db.order.count()).toBe(truocDon); // không đơn / khoản thu
    expect(await ma(await gui(S1, { loai: "khac", chuDe: "Mã giảm giá 50%", ghiChu: "áp mã giúp" }))).toEqual([400, "VALIDATION"]); // chủ đề lạ bị từ chối
    expect((await gui(S3, { loai: "khac", chuDe: "Khác", ghiChu: "con nhà khác" })).status).toBe(404);
  });

  it("[HSG-DB-05] nội dung buổi (HL-Buoi)", async () => {
    const buoi = (k: string, lop: string) => db.classSession.create({ data: { id: A(k), classId: lop, date: new Date("2026-11-10T11:00:00Z"), status: "COMPLETED" } as never });
    await buoi("b1", A("l1"));
    await buoi("b2", A("l2")); // lớp khác
    await db.assignment.create({ data: { id: A("bt1"), title: "Bài tập buổi 1", description: "d", classId: A("l1"), classSessionId: A("b1"), totalPoints: 10, status: "PUBLISHED", allowText: true, dueAt: new Date(Date.now() + 86400000) } as never });
    await db.assignment.create({ data: { id: A("bt-nhap"), title: "Bài nháp", description: "d", classId: A("l1"), classSessionId: A("b1"), totalPoints: 10, status: "DRAFT", allowText: true } as never });
    await db.exam.create({ data: { id: A("de1"), title: "Đề về nhà buổi 1", classId: A("l1"), status: "PUBLISHED", durationMinutes: 20, totalPoints: 10, passingScore: 5, maxAttempts: 3, showResultAfterSubmit: true } as never });
    await db.exam.create({ data: { id: A("de-nhap"), title: "Đề nháp", classId: A("l1"), status: "DRAFT", durationMinutes: 20, totalPoints: 10, passingScore: 5, maxAttempts: 3 } as never });
    for (const [k, ex] of [["h1", "de1"], ["h2", "de-nhap"]] as const) await db.homeworkAssignment.create({ data: { id: A(k), classSessionId: A("b1"), examId: A(ex), studentId: S1 } as never });
    const lay = (sv: string, sid: string, tok = tA) => noiDungGet(req("GET", `/api/mobile/v1/students/${sv}/sessions/${sid}/content`, undefined, bearer(tok)), ctx(sv, { sessionId: sid }));
    const r = await lay(S1, A("b1"));
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d.buoiId).toBe(A("b1"));
    expect(d.baiGiang).toBeNull(); // buổi chưa gắn bài giảng
    const ten = d.baiVeNha.map((x: { tieuDe: string }) => x.tieuDe).sort();
    expect(ten).toEqual(["Bài tập buổi 1", "Đề về nhà buổi 1"]); // không nháp
    expect(d.baiVeNha.find((x: { loai: string }) => x.loai === "BAI_TAP").trangThai).toBe("NOT_SUBMITTED");
    expect(JSON.stringify(d)).not.toMatch(/score|diem|dapAn|isCorrect/i);
    expect(await ma(await lay(S1, A("b2")))).toEqual([404, "NOT_FOUND"]); // buổi lớp khác
    expect(await ma(await lay(S1, "khong-co"))).toEqual([404, "NOT_FOUND"]);
    expect((await lay(S3, A("b2"))).status).toBe(404); // con nhà khác
    expect((await lay(S2, A("b1"))).status).toBe(404); // con cùng nhà nhưng KHÔNG học lớp đó
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "false";
    try {
      expect((await lay(S1, A("b1"))).status).toBe(404); // cờ LMS tắt
    } finally {
      process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
    }
  });
});
