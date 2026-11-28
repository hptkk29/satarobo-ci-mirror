import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as dangXuatRoute } from "@/app/api/mobile/v1/auth/logout/route";
import { DELETE as xoaTokenRoute, POST as dangKyTokenRoute } from "@/app/api/mobile/v1/devices/push-token/route";
import { GET as layTuyChonRoute, PUT as datTuyChonRoute } from "@/app/api/mobile/v1/notifications/preferences/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { dangKyPushToken } from "@/lib/mobile-api/dich-vu/thiet-bi-push";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [PUSH-DB] V8.1 — sổ token push + tuỳ chọn thông báo, Postgres thật (KHÔNG gửi push thật — chưa có FCM/APNs).
 *   [PUSH-DB-01] đăng ký: 200, KHÔNG trả lại token; idempotent (một dòng); android+APNS / trường lạ / token ngắn ⇒ 400; không đăng nhập ⇒ 401
 *   [PUSH-DB-02] xoay vòng: cùng phiên token mới ⇒ token cũ bị thu hồi `thay-token`
 *   [PUSH-DB-03] SEC-14: người KHÁC (máy khác, phiên chủ còn sống) đăng ký token đang sống của A ⇒ KHÔNG chiếm được (vẫn DA_DANG_KY, kiểm toán không chứa token); cùng THIẾT BỊ ⇒ chuyển chủ (máy đổi tài khoản); phiên chủ quá hạn / token đã thu hồi ⇒ chuyển; người cũ xoá token ⇒ KHÔNG ảnh hưởng người mới
 *   [PUSH-DB-04] thu hồi: DELETE token của mình ⇒ thu hồi; token lạ / của người khác ⇒ vẫn 200 và không đổi gì
 *   [PUSH-DB-05] đăng xuất ⇒ token của phiên bị thu hồi CÙNG (`dang-xuat`), token của phiên khác còn sống
 *   [PUSH-DB-06] tối đa 5 token sống mỗi phụ huynh: cũ nhất bị thu hồi `vuot-han-muc`
 *   [PUSH-DB-07] phiên chế độ học sinh không đăng ký được (phòng thủ ở dịch vụ)
 *   [PUSH-DB-08] tuỳ chọn thông báo: mặc định bật cả 5; đặt/đọc lại; danh mục lạ/lặp ⇒ 400; cách ly theo người
 *   [PUSH-DB-09] token KHÔNG xuất hiện trong kiểm toán / phản hồi
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "push-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const T = (k: string) => `${NS}token-${k}-${"x".repeat(40)}`; // token giả ≥ 20 ký tự, in được

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobilePushToken.deleteMany({ where: { userId: { in: uids } } });
  await db.mobileNotificationPref.deleteMany({ where: { userId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[PUSH-DB] token push + tuỳ chọn thông báo — Postgres thật", () => {
  const ids: Record<string, string> = {};
  const tok: Record<string, { access: string; refresh: string }> = {};
  const dky = (t: string, than: unknown) => dangKyTokenRoute(req("POST", "/api/mobile/v1/devices/push-token", than, bearer(t)));
  const xoa = (t: string, than: unknown) => xoaTokenRoute(req("DELETE", "/api/mobile/v1/devices/push-token", than, bearer(t)));
  const body = (k: string, o: Record<string, unknown> = {}) => ({ nenTang: "android", nhaCungCap: "FCM", token: T(k), phienBanApp: "1.0.0", ...o });
  const dangNhap = async (sdt: string, n: number) => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    if (r.status !== 200) throw new Error(`đăng nhập ${r.status}`);
    return (await json(r)).data as { accessToken: string; refreshToken: string };
  };
  const dong = (t: string) => db.mobilePushToken.findUnique({ where: { token: t } });
  const ma = async (r: Response) => [r.status, (await json(r)).error?.code];

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const [k, sdt] of [["A", "84966950001"], ["B", "84966950002"]] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    const a1 = await dangNhap("0966950001", 1);
    const a2 = await dangNhap("0966950001", 2); // máy thứ hai của A
    const b1 = await dangNhap("0966950002", 3);
    tok.a1 = { access: a1.accessToken, refresh: a1.refreshToken };
    tok.a2 = { access: a2.accessToken, refresh: a2.refreshToken };
    tok.b1 = { access: b1.accessToken, refresh: b1.refreshToken };
    for (const k of ["a1", "a2", "b1"]) await quyDinhDongY(req("POST", "/x", {}, bearer(tok[k]!.access)));
  }, 120_000);
  afterAll(don);

  it("[PUSH-DB-01] đăng ký: không trả token, idempotent, từ chối sai dạng", async () => {
    const r = await dky(tok.a1!.access, body("t1"));
    expect(r.status).toBe(200);
    const txt = JSON.stringify(await json(r));
    expect(txt).not.toContain(T("t1"));
    expect(JSON.parse(txt).data).toEqual({ trangThai: "DA_DANG_KY" });
    await dky(tok.a1!.access, body("t1"));
    expect(await db.mobilePushToken.count({ where: { token: T("t1") } })).toBe(1);
    expect((await dong(T("t1")))?.userId).toBe(ids.A);
    expect(await ma(await dky(tok.a1!.access, body("t2", { nenTang: "android", nhaCungCap: "APNS" })))).toEqual([400, "VALIDATION"]);
    expect(await ma(await dky(tok.a1!.access, body("t2", { userId: ids.B })))).toEqual([400, "VALIDATION"]);
    expect(await ma(await dky(tok.a1!.access, body("t2", { token: "ngan" })))).toEqual([400, "VALIDATION"]);
    expect(await ma(await dky(tok.a1!.access, body("t2", { token: `co khoang trang ${"x".repeat(30)}` })))).toEqual([400, "VALIDATION"]);
    const kh = await dangKyTokenRoute(req("POST", "/api/mobile/v1/devices/push-token", body("t2")));
    expect(kh.status).toBe(401);
  });

  it("[PUSH-DB-02] xoay vòng: cùng phiên token mới ⇒ token cũ bị thu hồi", async () => {
    await dky(tok.a1!.access, body("t3"));
    const cu = await dong(T("t1"));
    expect(cu?.thuHoiLuc).not.toBeNull();
    expect(cu?.lyDoThuHoi).toBe("thay-token");
    expect((await dong(T("t3")))?.thuHoiLuc).toBeNull();
  });

  it("[PUSH-DB-03] SEC-14: không chiếm được token đang sống của người khác; chuyển chủ chỉ khi cùng thiết bị / phiên chủ đã chết / token đã thu hồi", async () => {
    await dky(tok.a1!.access, body("t3")); // tự đủ khi chạy MỘT mình: t3 là token SỐNG của A ở máy 1 (idempotent nếu ca trước đã đăng ký)
    // t3 đang SỐNG của A (máy 1). B ở MÁY KHÁC (máy 3) đăng ký cùng token ⇒ KHÔNG chiếm: vẫn «DA_DANG_KY» (không lộ), dòng vẫn của A, có kiểm toán KHÔNG chứa token.
    const truocKt = await db.auditLog.count({ where: { entityId: ids.B, action: "mobile.push_token_takeover_blocked" } });
    const chan = await dky(tok.b1!.access, body("t3"));
    expect([chan.status, (await json(chan)).data]).toEqual([200, { trangThai: "DA_DANG_KY" }]);
    let d = await dong(T("t3"));
    expect([d?.userId, d?.thuHoiLuc]).toEqual([ids.A, null]);
    expect(await db.auditLog.count({ where: { entityId: ids.B, action: "mobile.push_token_takeover_blocked" } })).toBe(truocKt + 1);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { entityId: ids.B, action: "mobile.push_token_takeover_blocked" } }))).not.toContain(T("t3"));
    // bị chặn thì KHÔNG có tác dụng phụ: token khác của B vẫn nguyên (không bị xoay vòng)
    await dky(tok.b1!.access, body("b-giu"));
    await dky(tok.b1!.access, body("t3")); // bị chặn lần nữa
    expect((await dong(T("b-giu")))?.thuHoiLuc).toBeNull();
    // (c) CÙNG THIẾT BỊ: B đăng nhập trên máy 1 (cùng maThietBi với phiên của A) ⇒ được chuyển (máy đổi tài khoản)
    const bMay1 = await dangNhap("0966950002", 1);
    await quyDinhDongY(req("POST", "/x", {}, bearer(bMay1.accessToken)));
    await dky(bMay1.accessToken, body("t3"));
    d = await dong(T("t3"));
    expect([d?.userId, d?.thuHoiLuc]).toEqual([ids.B, null]);
    expect((await xoa(tok.a1!.access, { token: T("t3") })).status).toBe(200); // A không còn là chủ
    expect((await dong(T("t3")))?.thuHoiLuc).toBeNull();
    // (b) PHIÊN CHỦ ĐÃ QUÁ HẠN (token chưa kịp bị quét): A đăng ký t4 ở máy 7 (phiên tạm), rồi phiên đó quá hạn ⇒ B (máy khác) lấy được
    const aTam = await dangNhap("0966950001", 7); // phiên TẠM của A (máy 7) — để làm quá hạn mà không đụng phiên a1/a2 của các ca sau
    await quyDinhDongY(req("POST", "/x", {}, bearer(aTam.accessToken)));
    await dky(aTam.accessToken, body("t4"));
    const phienA2 = (await db.mobilePushToken.findUniqueOrThrow({ where: { token: T("t4") }, select: { mobileSessionId: true } })).mobileSessionId;
    expect((await dky(tok.b1!.access, body("t4"))).status).toBe(200);
    expect((await dong(T("t4")))?.userId).toBe(ids.A); // phiên tạm của A còn sống ⇒ vẫn chặn
    await db.mobileSession.update({ where: { id: phienA2 }, data: { hetHanKhongDung: new Date(Date.now() - 60_000) } });
    await dky(tok.b1!.access, body("t4"));
    expect((await dong(T("t4")))?.userId).toBe(ids.B);
    // (a) token ĐÃ THU HỒI (A tự huỷ) ⇒ ai đăng ký lại cũng được
    await dky(tok.a1!.access, body("t5"));
    await xoa(tok.a1!.access, { token: T("t5") });
    await dky(tok.b1!.access, body("t5"));
    expect((await dong(T("t5")))?.userId).toBe(ids.B);
    // (d) CÙNG NGƯỜI giữa hai phiên của CHÍNH mình (đăng nhập lại / máy thứ hai) ⇒ luôn chuyển được — SEC-14 chỉ chặn NGƯỜI KHÁC
    await dky(tok.a1!.access, body("t6"));
    await dky(tok.a2!.access, body("t6"));
    const phienA2Moi = await db.mobileSession.findFirstOrThrow({ where: { userId: ids.A, maThietBi: "00000000-0000-4000-a000-000000000002", thuHoiLuc: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
    expect((await dong(T("t6")))?.mobileSessionId).toBe(phienA2Moi.id);
    // đảm bảo trạng thái cho ca sau: B giữ t3 (từ nhánh cùng thiết bị)
    expect((await dong(T("t3")))?.userId).toBe(ids.B);
  }, 60_000);

  it("[PUSH-DB-04] thu hồi: của mình ⇒ thu hồi; token lạ ⇒ vẫn 200 không đổi gì", async () => {
    expect((await xoa(tok.b1!.access, { token: T("t3") })).status).toBe(200);
    expect((await dong(T("t3")))?.lyDoThuHoi).toBe("nguoi-dung-huy");
    const r = await xoa(tok.b1!.access, { token: T("khong-ton-tai") });
    expect([r.status, (await json(r)).data]).toEqual([200, { trangThai: "DA_HUY" }]);
    expect(await ma(await xoa(tok.b1!.access, { token: "ngan" }))).toEqual([400, "VALIDATION"]);
  });

  it("[PUSH-DB-05] đăng xuất ⇒ token của phiên bị thu hồi CÙNG; phiên khác còn sống", async () => {
    await dky(tok.a1!.access, body("m1"));
    await dky(tok.a2!.access, body("m2"));
    expect((await dangXuatRoute(req("POST", "/api/mobile/v1/auth/logout", { refreshToken: tok.a1!.refresh }))).status).toBe(200);
    const m1 = await dong(T("m1"));
    expect([m1?.thuHoiLuc !== null, m1?.lyDoThuHoi]).toEqual([true, "dang-xuat"]);
    expect((await dong(T("m2")))?.thuHoiLuc).toBeNull();
  });

  it("[PUSH-DB-06] tối đa 5 token sống: cũ nhất bị thu hồi", async () => {
    // Token rải trên phiên KHÁC phiên đang đăng ký (phiên a1 đã đăng xuất ở ca trước — chỉ cần một dòng phiên hợp lệ làm khoá ngoại): cùng phiên thì xoay vòng sẽ thu hồi hết.
    let daThuHoi = (await db.mobileSession.findMany({ where: { userId: ids.A, thuHoiLuc: { not: null } }, select: { id: true } }))[0];
    if (!daThuHoi) {
      // tự đủ khi chạy MỘT mình: dựng một phiên đã thu hồi (đăng nhập máy 8 rồi đăng xuất)
      const tam = await dangNhap("0966950001", 8);
      await dangXuatRoute(req("POST", "/api/mobile/v1/auth/logout", { refreshToken: tam.refreshToken }));
      daThuHoi = (await db.mobileSession.findMany({ where: { userId: ids.A, thuHoiLuc: { not: null } }, select: { id: true } }))[0];
    }
    const phien = daThuHoi!.id;
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      await db.mobilePushToken.create({ data: { userId: ids.A!, mobileSessionId: phien, nenTang: "android", nhaCungCap: "FCM", token: T(`l${i}`), lanDangKyCuoi: new Date(t0 - (10 - i) * 60_000) } });
    }
    await dky(tok.a2!.access, body("l5")); // token thứ 6 ⇒ chỉ còn 5 sống (m2 của phiên a2 bị thay vì xoay vòng)
    const song = await db.mobilePushToken.count({ where: { userId: ids.A, thuHoiLuc: null } });
    expect(song).toBe(5);
    expect((await dong(T("l5")))?.thuHoiLuc).toBeNull(); // mới nhất luôn sống
    expect((await dong(T("l0")))?.lyDoThuHoi).toBe("vuot-han-muc"); // cũ nhất bị loại
  });

  it("[PUSH-DB-07] phiên chế độ học sinh không đăng ký được (phòng thủ ở dịch vụ)", async () => {
    await expect(
      dangKyPushToken({ userId: ids.A!, sessionId: "x", name: "n", email: "e", phone: null, hocSinhId: "hs1" }, { nenTang: "android", nhaCungCap: "FCM", token: T("hs") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await dong(T("hs"))).toBeNull();
  });

  it("[PUSH-DB-08] tuỳ chọn thông báo", async () => {
    const lay = async (t: string) => (await json(await layTuyChonRoute(req("GET", "/api/mobile/v1/notifications/preferences", undefined, bearer(t))))).data.tuyChon as Array<{ danhMuc: string; bat: boolean }>;
    const dat = (t: string, than: unknown) => datTuyChonRoute(req("PUT", "/api/mobile/v1/notifications/preferences", than, bearer(t)));
    const mac = await lay(tok.a2!.access);
    expect(mac.map((x) => x.danhMuc)).toEqual(["NHAN_XET", "HOC_BU", "HOC_BA", "KHAO_SAT", "THONG_BAO"]);
    expect(mac.every((x) => x.bat)).toBe(true);
    const r = await dat(tok.a2!.access, { tuyChon: [{ danhMuc: "HOC_BU", bat: false }, { danhMuc: "KHAO_SAT", bat: false }] });
    expect(r.status).toBe(200);
    const sau = await lay(tok.a2!.access);
    expect(sau.filter((x) => !x.bat).map((x) => x.danhMuc).sort()).toEqual(["HOC_BU", "KHAO_SAT"]);
    await dat(tok.a2!.access, { tuyChon: [{ danhMuc: "HOC_BU", bat: true }] }); // đặt lại một mục không đụng mục khác
    expect((await lay(tok.a2!.access)).filter((x) => !x.bat).map((x) => x.danhMuc)).toEqual(["KHAO_SAT"]);
    expect(await ma(await dat(tok.a2!.access, { tuyChon: [{ danhMuc: "LA", bat: true }] }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await dat(tok.a2!.access, { tuyChon: [{ danhMuc: "HOC_BU", bat: true }, { danhMuc: "HOC_BU", bat: false }] }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await dat(tok.a2!.access, { tuyChon: [] }))).toEqual([400, "VALIDATION"]);
    expect((await lay(tok.b1!.access)).every((x) => x.bat)).toBe(true); // B không bị ảnh hưởng
  });

  it("[PUSH-DB-09] token không có trong kiểm toán", async () => {
    const kt = await db.auditLog.findMany({ where: { actorId: { in: [ids.A!, ids.B!] } }, select: { newValues: true, oldValues: true } }).catch(() => []);
    expect(JSON.stringify(kt)).not.toContain(`${NS}token-`);
  });
});
