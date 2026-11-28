import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as anhRoute } from "@/app/api/mobile/v1/students/[studentId]/photos/route";
import { db } from "@/lib/db";
import { GET as devKhoGet } from "@/app/api/dev-kho/[...khoa]/route";
import { onMediaApprovedNotif } from "@/lib/_handlers/anh-duyet-notif";
import { kyAnhMacDinh, layAnhBuoiHoc, TTL_URL_ANH_GIAY, type KyAnh } from "@/lib/mobile-api/dich-vu/anh-buoi-hoc";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [ANH-DB] V8.2 — ảnh buổi học (BR-PHOTO-01), Postgres thật + bộ ký GIẢ (không kho thật):
 *   [ANH-DB-01] con CÓ đồng ý: chỉ ảnh APPROVED + (gắn thẻ con HOẶC chung lớp); DRAFT/PENDING/REJECTED, ảnh thẻ con khác, ảnh lớp khác KHÔNG lộ
 *   [ANH-DB-02] con KHÔNG đồng ý / đã thu hồi ⇒ 0 ảnh, dongYHinhAnh=false (bộ ký không được gọi)
 *   [ANH-DB-03] CHỈ URL ký: ảnh không ký được ⇒ bị bỏ (không thay bằng URL gốc); mọi ảnh lỗi ký ⇒ 503 MEDIA_CHUA_SAN_SANG; không có `fileUrl` gốc/tên tệp/người duyệt trong phản hồi
 *   [ANH-DB-04] phân trang theo ảnh (soLuong/trang), tongSo ổn định
 *   [ANH-DB-05] route HTTP: cờ ký TẮT (mặc định local) ⇒ 503 (fail-closed, không URL công khai); con nhà khác 404; không token 401; tham số lạ 400
 *   [ANH-DB-07] V8.5 thông báo «Có ảnh mới» khi duyệt ảnh: chỉ học viên ĐƯỢC THẤY ảnh (thẻ / chung lớp đang học) VÀ có đồng ý ảnh; không đồng ý ⇒ không báo; ảnh chưa APPROVED / không có ⇒ không báo; idempotent; duyệt lại (mốc mới) ⇒ báo mới
 *   [ANH-DB-06] bộ ký mặc định không bao giờ trả URL công khai (cờ tắt / URL ngoài kho ⇒ null)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "anh-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.95.0.${(++dem % 250) + 1}`;
const req = (url: string, auth?: string) => new Request(`http://localhost${url}`, { method: "GET", headers: { "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) } });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const A = (k: string) => `${NS}${k}`;
const kyGia: KyAnh = async (u) => (u.includes("khong-ky") ? null : `https://kho-rieng.invalid/ky?id=${Buffer.from(u).toString("base64url").slice(-14)}&sig=1`);

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.notification.deleteMany({ where: { dedupeKey: { startsWith: `media.approved:${NS}` } } }); // dòng sót của lượt chạy trước bị dừng giữa chừng
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

describe.skipIf(!RUN)("[ANH-DB] ảnh buổi học — Postgres thật", () => {
  const ids: Record<string, string> = {};
  const S1 = A("s1"); // có đồng ý
  const S2 = A("s2"); // KHÔNG đồng ý
  const S3 = A("s3"); // nhà B
  let tA = "";
  const url = (k: string) => `https://anh.uat.invalid/uploads/${NS}${k}.jpg`;

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    delete process.env.MEDIA_SIGNED_URL; // mặc định local: cờ TẮT
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const [k, sdt] of [["A", "84966960001"], ["B", "84966960002"]] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở ANH", slug: A("cs"), address: "Địa chỉ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá ANH", slug: A("kh"), totalSessions: 12 } });
    for (const l of ["l1", "l2"]) await db.class.create({ data: { id: A(l), name: `Lớp ${l}`, classCode: A(l), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: S1, name: "An", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S2, name: "Bình", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S3, name: "Cường", parentUserId: ids.B, centerId: A("cs") } as never });
    for (const [id, sv] of [["dk1", S1], ["dk2", S2], ["dk3", S3]] as const) await db.enrollment.create({ data: { id: A(id), studentId: sv, classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    await db.studentConsent.create({ data: { studentId: S1, type: "CLASS_MEDIA", status: "GRANTED" } });
    await db.studentConsent.create({ data: { studentId: S3, type: "CLASS_MEDIA", status: "GRANTED" } });
    const m = (k: string, o: Record<string, unknown>) => db.classSessionMedia.create({ data: { id: A(k), classId: A("l1"), fileUrl: url(k), status: "APPROVED", takenAt: new Date(`2026-11-1${k.length % 9}T10:00:00Z`), ...o } as never });
    await m("the-s1", {});
    await m("chung", { isClassWide: true });
    await m("the-s3", {}); // chỉ gắn thẻ S3
    await m("khong-the", {}); // không thẻ, không chung lớp ⇒ ẩn
    await m("nhap", { status: "DRAFT", isClassWide: true });
    await m("cho-duyet", { status: "PENDING", isClassWide: true });
    await m("bi-tu-choi", { status: "REJECTED", isClassWide: true });
    await m("lop-khac", { classId: A("l2"), isClassWide: true });
    await m("khong-ky", { isClassWide: true }); // ảnh có URL mà bộ ký giả từ chối
    await db.mediaStudentTag.create({ data: { mediaId: A("the-s1"), studentId: S1 } });
    await db.mediaStudentTag.create({ data: { mediaId: A("the-s3"), studentId: S3 } });
    const r = await dangNhapRoute(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ dinhDanh: "0966960001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9a00-000000000001", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }) }));
    tA = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), authorization: `Bearer ${tA}` }, body: "{}" }));
  }, 120_000);
  afterAll(don);

  it("[ANH-DB-01] chỉ ảnh APPROVED + (thẻ con | chung lớp); không lộ ảnh ẩn / của con khác / lớp khác", async () => {
    const d = await layAnhBuoiHoc(S1 as never, { soLuong: 60, trang: 1 }, kyGia);
    expect(d.dongYHinhAnh).toBe(true);
    const idAnh = d.nhom.flatMap((g) => g.anh.map((a) => a.id)).sort();
    expect(idAnh).toEqual([A("chung"), A("the-s1")].sort()); // khong-ky bị bỏ vì không ký được (xem DB-03)
    for (const x of ["the-s3", "khong-the", "nhap", "cho-duyet", "bi-tu-choi", "lop-khac"]) expect(idAnh, x).not.toContain(A(x));
    const txt = JSON.stringify(d);
    expect(txt).not.toContain("anh.uat.invalid"); // không URL gốc
    expect(txt).not.toMatch(/fileUrl|fileName|uploadedBy|approvedBy|classId/);
    expect(d.hetHanSauGiay).toBe(TTL_URL_ANH_GIAY);
    expect(TTL_URL_ANH_GIAY).toBeLessThanOrEqual(900);
  });

  it("[ANH-DB-02] không đồng ý / đã thu hồi ⇒ 0 ảnh và bộ ký không được gọi", async () => {
    const ky = vi.fn(kyGia);
    const d = await layAnhBuoiHoc(S2 as never, { soLuong: 60, trang: 1 }, ky);
    expect([d.dongYHinhAnh, d.tongSo, d.nhom]).toEqual([false, 0, []]);
    expect(ky).not.toHaveBeenCalled();
    await db.studentConsent.update({ where: { studentId_type: { studentId: S1, type: "CLASS_MEDIA" } }, data: { status: "REVOKED", revokedAt: new Date() } });
    const sau = await layAnhBuoiHoc(S1 as never, { soLuong: 60, trang: 1 }, ky);
    expect([sau.dongYHinhAnh, sau.nhom.length]).toEqual([false, 0]);
    await db.studentConsent.update({ where: { studentId_type: { studentId: S1, type: "CLASS_MEDIA" } }, data: { status: "GRANTED", revokedAt: null } });
    expect((await layAnhBuoiHoc(S1 as never, { soLuong: 60, trang: 1 }, kyGia)).dongYHinhAnh).toBe(true);
  });

  it("[ANH-DB-03] chỉ URL ký: ảnh lỗi ký bị bỏ; mọi ảnh lỗi ký ⇒ 503; không rơi về URL gốc", async () => {
    const d = await layAnhBuoiHoc(S1 as never, { soLuong: 60, trang: 1 }, kyGia);
    expect(d.nhom.flatMap((g) => g.anh).every((a) => a.url.startsWith("https://kho-rieng.invalid/ky"))).toBe(true);
    expect(d.tongSo).toBe(2); // V8.6: tongSo = số ảnh KÝ ĐƯỢC (the-s1 + chung); khong-ky đủ điều kiện nhưng bị bỏ ở bước ký nên không tính
    // ảnh không ký được nằm ĐẦU danh sách không làm trang đầu «trống»/503 khi vẫn còn ảnh ký được ở phía sau
    const chiMotAnh = async (u: string) => (u.includes("the-s1") ? `https://kho-rieng.invalid/ky/${u}` : null);
    const p1 = await layAnhBuoiHoc(S1 as never, { soLuong: 1, trang: 1 }, chiMotAnh);
    expect([p1.tongSo, p1.nhom.flatMap((g) => g.anh).length, p1.coTrangSau]).toEqual([1, 1, false]);
    await expect(layAnhBuoiHoc(S1 as never, { soLuong: 60, trang: 1 }, async () => null)).rejects.toMatchObject({ code: "MEDIA_CHUA_SAN_SANG", status: 503 });
  });

  it("[ANH-DB-04] phân trang theo ảnh", async () => {
    const t1 = await layAnhBuoiHoc(S1 as never, { soLuong: 2, trang: 1 }, async (u) => `ky:${u}`);
    const t2 = await layAnhBuoiHoc(S1 as never, { soLuong: 2, trang: 2 }, async (u) => `ky:${u}`);
    const so = (x: typeof t1) => x.nhom.reduce((n, g) => n + g.anh.length, 0);
    expect([so(t1), t1.coTrangSau, t1.tongSo, so(t2), t2.coTrangSau]).toEqual([2, true, 3, 1, false]);
    const a = t1.nhom.flatMap((g) => g.anh.map((x) => x.id));
    const b = t2.nhom.flatMap((g) => g.anh.map((x) => x.id));
    expect(a.filter((x) => b.includes(x))).toEqual([]);
  });

  it("[ANH-DB-05] route HTTP: cờ ký tắt ⇒ 503 (fail-closed); nhà khác 404; không token 401; tham số lạ 400", async () => {
    const lay = (sv: string, q = "", tok: string | undefined = tA) => anhRoute(req(`/api/mobile/v1/students/${sv}/photos${q}`, tok ? `Bearer ${tok}` : undefined), { params: Promise.resolve({ studentId: sv }) as never });
    const r = await lay(S1);
    expect([r.status, (await json(r)).error?.code]).toEqual([503, "MEDIA_CHUA_SAN_SANG"]);
    const khong = await lay(S2); // không đồng ý ⇒ không cần ký ⇒ 200 rỗng
    expect([khong.status, (await json(khong)).data.dongYHinhAnh]).toEqual([200, false]);
    expect((await lay(S3)).status).toBe(404);
    expect((await lay(S1, "", "")).status).toBe(401);
    for (const q of ["?soLuong=0", "?soLuong=101", "?trang=0", "?khac=1"]) expect((await lay(S1, q)).status, q).toBe(400);
  });

  it("[ANH-DB-07] thông báo «Có ảnh mới»", async () => {
    const ev = (p: Record<string, unknown>) => ({ id: A("ev"), type: "media.approved", payload: p });
    const dem = (mediaId: string) => db.notification.findMany({ where: { dedupeKey: { startsWith: `media.approved:${mediaId}:` } }, select: { studentId: true, audience: true, title: true, body: true } });
    const luc = new Date("2026-11-20T03:00:00Z");
    // reset: S1 có đồng ý; S2 không; thêm S4 (nhà A) có đồng ý + học lớp l1
    await db.studentConsent.upsert({ where: { studentId_type: { studentId: S1, type: "CLASS_MEDIA" } }, create: { studentId: S1, type: "CLASS_MEDIA", status: "GRANTED" }, update: { status: "GRANTED", revokedAt: null } });
    await db.student.create({ data: { id: A("s4"), name: "Dũng", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.enrollment.create({ data: { id: A("dk4"), studentId: A("s4"), classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    await db.studentConsent.create({ data: { studentId: A("s4"), type: "CLASS_MEDIA", status: "GRANTED" } });
    // ảnh CHUNG LỚP đã duyệt: báo mọi học viên đang học lớp CÓ đồng ý (S1, S3, S4); KHÔNG báo S2 (không đồng ý)
    await db.classSessionMedia.create({ data: { id: A("moi-chung"), classId: A("l1"), fileUrl: "https://kho.invalid/m1.jpg", status: "APPROVED", isClassWide: true, approvedAt: luc } as never });
    await onMediaApprovedNotif(ev({ mediaId: A("moi-chung") }));
    await onMediaApprovedNotif(ev({ mediaId: A("moi-chung") })); // retry
    const a = await dem(A("moi-chung"));
    expect(a.map((x) => x.studentId).sort()).toEqual([S1, S3, A("s4")].sort()); // S1, S3, S4 học lớp l1 và đều CÓ đồng ý; S2 KHÔNG đồng ý ⇒ không có
    expect(a.every((x) => x.audience === "STUDENT" && x.title === "Có ảnh mới")).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/m1\.jpg|kho\.invalid/); // không lộ URL/tên tệp
    // ảnh chỉ gắn THẺ S1: chỉ S1
    await db.classSessionMedia.create({ data: { id: A("moi-the"), classId: A("l1"), fileUrl: "https://kho.invalid/m2.jpg", status: "APPROVED", approvedAt: luc } as never });
    await db.mediaStudentTag.create({ data: { mediaId: A("moi-the"), studentId: S1 } });
    await onMediaApprovedNotif(ev({ mediaId: A("moi-the") }));
    expect((await dem(A("moi-the"))).map((x) => x.studentId)).toEqual([S1]);
    // thẻ gắn cho S2 (không đồng ý) ⇒ không báo
    await db.classSessionMedia.create({ data: { id: A("moi-the2"), classId: A("l1"), fileUrl: "https://kho.invalid/m3.jpg", status: "APPROVED", approvedAt: luc } as never });
    await db.mediaStudentTag.create({ data: { mediaId: A("moi-the2"), studentId: S2 } });
    await onMediaApprovedNotif(ev({ mediaId: A("moi-the2") }));
    expect(await dem(A("moi-the2"))).toEqual([]);
    // chưa duyệt (PENDING/DRAFT/REJECTED) / không có ảnh / payload rỗng ⇒ không báo
    for (const [k, st] of [["moi-pending", "PENDING"], ["moi-nhap", "DRAFT"], ["moi-tuchoi", "REJECTED"]] as const) {
      await db.classSessionMedia.create({ data: { id: A(k), classId: A("l1"), fileUrl: "https://kho.invalid/x.jpg", status: st, isClassWide: true, approvedAt: luc } as never });
      await onMediaApprovedNotif(ev({ mediaId: A(k) }));
      expect(await dem(A(k)), st).toEqual([]);
    }
    await onMediaApprovedNotif(ev({ mediaId: "khong-co" }));
    await onMediaApprovedNotif(ev({}));
    // duyệt lại (mốc mới) ⇒ thông báo mới; cùng mốc ⇒ không trùng
    await db.classSessionMedia.update({ where: { id: A("moi-the") }, data: { approvedAt: new Date("2026-11-21T03:00:00Z") } });
    await onMediaApprovedNotif(ev({ mediaId: A("moi-the") }));
    expect((await dem(A("moi-the"))).length).toBe(2);
    await db.notification.deleteMany({ where: { dedupeKey: { startsWith: "media.approved:" } } });
  });

  it("[ANH-DB-08] thu hồi SAU khi đã duyệt: từ chối lại / gỡ thẻ / xoá ảnh / thu hồi đồng ý ⇒ biến khỏi danh sách ngay (kiểm lúc ĐỌC, không dựa vào thông báo cũ)", async () => {
    const ids = async () => (await layAnhBuoiHoc(S1 as never, { soLuong: 60, trang: 1 }, kyGia)).nhom.flatMap((g) => g.anh.map((x) => x.id));
    expect(await ids()).toContain(A("the-s1"));
    // 1) quản lý đổi lại thành REJECTED
    await db.classSessionMedia.update({ where: { id: A("the-s1") }, data: { status: "REJECTED" } });
    expect(await ids()).not.toContain(A("the-s1"));
    await db.classSessionMedia.update({ where: { id: A("the-s1") }, data: { status: "APPROVED" } });
    expect(await ids()).toContain(A("the-s1"));
    // 2) gỡ thẻ học viên (ảnh không chung lớp) ⇒ S1 không còn thấy
    const the = await db.mediaStudentTag.findFirst({ where: { mediaId: A("the-s1"), studentId: S1 } });
    expect(the).not.toBeNull();
    await db.mediaStudentTag.delete({ where: { id: the!.id } });
    expect(await ids()).not.toContain(A("the-s1"));
    await db.mediaStudentTag.create({ data: { mediaId: A("the-s1"), studentId: S1 } });
    expect(await ids()).toContain(A("the-s1"));
    // 3) xoá hẳn ảnh
    await db.mediaStudentTag.deleteMany({ where: { mediaId: A("the-s1") } });
    await db.classSessionMedia.delete({ where: { id: A("the-s1") } });
    expect(await ids()).not.toContain(A("the-s1"));
    await db.classSessionMedia.create({ data: { id: A("the-s1"), classId: A("l1"), fileUrl: "https://anh.uat.invalid/the-s1.jpg", status: "APPROVED", approvedAt: new Date() } as never });
    await db.mediaStudentTag.create({ data: { mediaId: A("the-s1"), studentId: S1 } });
    expect(await ids()).toContain(A("the-s1"));
    // 4) giới hạn đã biết: URL ĐÃ ký còn dùng được tới hết TTL (≤ 900 giây) — thu hồi tác động từ lần đọc kế tiếp
    expect(TTL_URL_ANH_GIAY).toBeLessThanOrEqual(900);
  });

  it("[ANH-DB-09] ảnh trong KHO RIÊNG local (chuỗi đầy đủ): ký mặc định → tuyến dev-kho phục vụ; sửa chữ ký / hết hạn ⇒ 403; thu hồi đồng ý ⇒ không còn trong danh sách", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "anh-kho-"));
    const truoc = { d: process.env.MOBILE_UPLOAD_LOCAL_DIR, b: process.env.MOBILE_UPLOAD_LOCAL_BASE };
    process.env.MOBILE_UPLOAD_LOCAL_DIR = dir;
    process.env.MOBILE_UPLOAD_LOCAL_BASE = "http://localhost";
    try {
      const khoa = "class-media/anh-db09.png";
      await fs.mkdir(path.join(dir, "class-media"), { recursive: true });
      await fs.writeFile(path.join(dir, ...khoa.split("/")), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      await fs.writeFile(path.join(dir, ...khoa.split("/")) + ".meta", JSON.stringify({ contentType: "image/png" }));
      await db.classSessionMedia.create({ data: { id: A("rieng"), classId: A("l1"), fileUrl: `private:${khoa}`, status: "APPROVED", isClassWide: true, approvedAt: new Date() } as never });
      const d = await layAnhBuoiHoc(S1 as never, { soLuong: 60, trang: 1 }); // bộ ký MẶC ĐỊNH
      const a = d.nhom.flatMap((x) => x.anh).find((x) => x.id === A("rieng"));
      expect(a, "ảnh kho riêng phải hiện").toBeTruthy();
      const url = new URL(a!.url);
      expect(url.pathname).toBe(`/api/dev-kho/${khoa}`);
      const ctx = { params: Promise.resolve({ khoa: khoa.split("/") }) };
      const ok = await devKhoGet(new Request(a!.url), ctx);
      expect([ok!.status, ok!.headers.get("content-type")]).toEqual([200, "image/png"]);
      const hong = new URL(a!.url);
      hong.searchParams.set("s", hong.searchParams.get("s")!.slice(0, -2) + "00");
      expect((await devKhoGet(new Request(hong), ctx))!.status).toBe(403); // chữ ký sai
      const hetHan = new URL(a!.url);
      hetHan.searchParams.set("e", String(Date.now() - 1000)); // đổi hạn ⇒ chữ ký không còn khớp
      expect((await devKhoGet(new Request(hetHan), ctx))!.status).toBe(403);
      const khac = new URL(a!.url.replace(khoa, "class-media/khac.png"));
      expect((await devKhoGet(new Request(khac), { params: Promise.resolve({ khoa: ["class-media", "khac.png"] }) }))!.status).toBe(403); // chữ ký của khoá này không dùng cho khoá khác
      // thu hồi đồng ý ⇒ ảnh biến khỏi danh sách (kiểm lúc đọc)
      await db.studentConsent.update({ where: { studentId_type: { studentId: S1, type: "CLASS_MEDIA" } }, data: { status: "REVOKED", revokedAt: new Date() } });
      expect((await layAnhBuoiHoc(S1 as never, { soLuong: 60, trang: 1 })).nhom).toEqual([]);
      await db.studentConsent.update({ where: { studentId_type: { studentId: S1, type: "CLASS_MEDIA" } }, data: { status: "GRANTED", revokedAt: null } });
    } finally {
      if (truoc.d === undefined) delete process.env.MOBILE_UPLOAD_LOCAL_DIR; else process.env.MOBILE_UPLOAD_LOCAL_DIR = truoc.d;
      if (truoc.b === undefined) delete process.env.MOBILE_UPLOAD_LOCAL_BASE; else process.env.MOBILE_UPLOAD_LOCAL_BASE = truoc.b;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("[ANH-DB-06] bộ ký mặc định không bao giờ trả URL công khai", async () => {
    delete process.env.MEDIA_SIGNED_URL;
    expect(await kyAnhMacDinh(url("the-s1"))).toBeNull(); // cờ tắt
    process.env.MEDIA_SIGNED_URL = "true";
    try {
      expect(await kyAnhMacDinh("https://nguoi-la.example/anh.jpg")).toBeNull(); // URL ngoài kho
    } finally {
      delete process.env.MEDIA_SIGNED_URL;
    }
  });
});
