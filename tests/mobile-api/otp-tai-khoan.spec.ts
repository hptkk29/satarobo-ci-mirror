import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web: chặn `@/lib/auth` để mọi đường lỡ gọi `auth()` thật sẽ đỏ.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as kichHoatXacNhan } from "@/app/api/mobile/v1/auth/activation/confirm/route";
import { POST as kichHoatXinMa } from "@/app/api/mobile/v1/auth/activation/request-otp/route";
import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as meRoute } from "@/app/api/mobile/v1/auth/me/route";
import { POST as datLaiXacNhan } from "@/app/api/mobile/v1/auth/password-reset/confirm/route";
import { POST as datLaiXinMa } from "@/app/api/mobile/v1/auth/password-reset/request-otp/route";
import { db } from "@/lib/db";
import { issueOfflineOtp } from "@/lib/otp/service";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [OTP-DD] OTP kích hoạt / đặt lại mật khẩu trên APP (W-CONTRACT CRITICAL-2) — Postgres thật, gọi thẳng route handler, dịch vụ OTP thật của web.
 *   [OTP-DD-01] xin mã kích hoạt: phản hồi GIỐNG HỆT cho SĐT lạ / đã kích hoạt / nhân viên / đã xoá (không oracle); chỉ tài khoản phụ huynh PENDING mới có OtpRequest
 *   [OTP-DD-02] xin mã đặt lại: chỉ phụ huynh ACTIVE được gửi; PENDING / nhân viên / lạ nuốt về phản hồi chung
 *   [OTP-DD-03] kích hoạt đúng mã ⇒ 200, ACTIVE, mật khẩu dùng được (đăng nhập), `phoneVerifiedAt` set; dùng lại mã ⇒ OTP_INVALID
 *   [OTP-DD-04] sai mã: OTP_INVALID kèm `chiTiet.conLai` giảm dần; hết lượt ⇒ OTP_TOO_MANY_ATTEMPTS 429; mã ĐÚNG sau khoá vẫn bị từ chối
 *   [OTP-DD-05] mã hết hạn ⇒ OTP_EXPIRED 400, mật khẩu không đổi
 *   [OTP-DD-06] đặt lại đúng mã ⇒ MỌI phiên di động thu hồi, `tokenVersion + 1`, token cũ 401, mật khẩu cũ hết dùng, mật khẩu mới dùng được, có audit user.password_reset
 *   [OTP-DD-07] trạng thái sai (kích hoạt tài khoản ACTIVE / đặt lại tài khoản PENDING) dù có mã đúng ⇒ 409, KHÔNG đổi mật khẩu
 *   [OTP-DD-08] tài khoản NHÂN VIÊN có mã đúng ⇒ 409 TAI_KHOAN_KHONG_HOP_LE, KHÔNG đổi mật khẩu (app chỉ phục vụ phụ huynh)
 *   [OTP-DD-09] giới hạn tần suất: xin mã vượt 5/giờ theo định danh ⇒ 429 + Retry-After (định danh khác không bị ảnh hưởng); xác nhận vượt 10/15 phút ⇒ 429
 *   [OTP-DD-10] đầu vào sai (SĐT/ mã 5 số / mật khẩu ngắn / dài > 72) ⇒ 400 VALIDATION; cờ MOBILE_API_ENABLED tắt ⇒ 404
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const MK_CU = "Mat-khau-cu-2026";
const MK_MOI = "Mat-khau-moi-2027!";
const NS = "otpdd-";
const THIET_BI = (n: number) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
let ipN = 0;
const ip = () => `10.98.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Phan = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; chiTiet?: { conLai?: number } } };
const json = async (r: Response) => (await r.json()) as Phan;

// SĐT di động hợp lệ (đầu 09…); lưu dạng chuẩn hoá `84…` như web.
const SDT = {
  CHO: "0966500001", // PENDING — xin/kích hoạt
  DUNG_LAI: "0966500002", // ACTIVE — xin/đặt lại
  KICH_HOAT_OK: "0966500003",
  SAI_MA: "0966500004",
  HET_HAN: "0966500005",
  DAT_LAI_OK: "0966500006",
  DA_KICH_HOAT: "0966500007",
  NHAN_VIEN: "0966500008",
  XOA: "0966500009",
  HAN_MUC: "0966500010",
  KHAC: "0966500011",
  YEU_KH: "0966500012", // SEC-12
  YEU_DL: "0966500013", // SEC-12
} as const;
type K = keyof typeof SDT;
const chuan = (k: K) => `84${SDT[k].slice(1)}`;
const ids: Partial<Record<K, string>> = {};

async function tao(k: K, o: { accountStatus: "PENDING_ACTIVATION" | "ACTIVE"; role?: "PARENT" | "TEACHER"; deletedAt?: Date | null; matKhau?: string | null }) {
  const role = o.role ?? "PARENT";
  const u = await db.user.create({
    data: {
      email: `${NS}${k.toLowerCase()}@seed.invalid`,
      name: `${NS}${k}`,
      phone: chuan(k),
      role,
      roles: [role],
      accountStatus: o.accountStatus,
      isActive: true,
      deletedAt: o.deletedAt ?? null,
      password: o.matKhau === undefined ? (o.accountStatus === "ACTIVE" ? await bcrypt.hash(MK_CU, 4) : null) : o.matKhau,
    } as never,
  });
  ids[k] = u.id;
}
const nguoi = (k: K) => db.user.findUniqueOrThrow({ where: { id: ids[k]! }, select: { password: true, tokenVersion: true, accountStatus: true, phoneVerifiedAt: true } });
const dangNhap = (k: K, n: number, matKhau: string) =>
  dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: SDT[k], matKhau, thietBi: { maThietBi: THIET_BI(n), nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
const xin = (route: typeof kichHoatXinMa, k: K | string, extra: object = {}) => route(req("/api/mobile/v1/auth/x", { dinhDanh: typeof k === "string" && k in SDT ? SDT[k as K] : k, ...extra }));
const xacNhan = (route: typeof kichHoatXacNhan, k: K, ma: string, matKhau = MK_MOI) => route(req("/api/mobile/v1/auth/x", { dinhDanh: SDT[k], ma, matKhau }));
const coOtp = (k: K, mucDich: "ACTIVATION" | "RESET") => db.otpRequest.count({ where: { target: chuan(k), purpose: mucDich } });
async function layMa(k: K, mucDich: "ACTIVATION" | "RESET") {
  const r = await issueOfflineOtp({ target: chuan(k), purpose: mucDich, userId: ids[k] ?? null });
  if (!r.ok) throw new Error(`không cấp được mã: ${r.error}`);
  return r.code;
}

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: uids } }, { actorId: { in: uids } }] } });
  const dich = (Object.keys(SDT) as K[]).map(chuan);
  const otp = await db.otpRequest.findMany({ where: { target: { in: dich } }, select: { id: true } });
  await db.otpDeliveryLog.deleteMany({ where: { otpRequestId: { in: otp.map((o) => o.id) } } });
  await db.otpRequest.deleteMany({ where: { target: { in: dich } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[OTP-DD] OTP kích hoạt / đặt lại mật khẩu trên app — Postgres thật", () => {
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    await tao("CHO", { accountStatus: "PENDING_ACTIVATION" });
    await tao("DUNG_LAI", { accountStatus: "ACTIVE" });
    await tao("KICH_HOAT_OK", { accountStatus: "PENDING_ACTIVATION" });
    await tao("SAI_MA", { accountStatus: "PENDING_ACTIVATION" });
    await tao("HET_HAN", { accountStatus: "PENDING_ACTIVATION" });
    await tao("DAT_LAI_OK", { accountStatus: "ACTIVE" });
    await tao("DA_KICH_HOAT", { accountStatus: "ACTIVE" });
    await tao("NHAN_VIEN", { accountStatus: "PENDING_ACTIVATION", role: "TEACHER" });
    await tao("XOA", { accountStatus: "PENDING_ACTIVATION", deletedAt: new Date() });
    await tao("HAN_MUC", { accountStatus: "PENDING_ACTIVATION" });
    await tao("KHAC", { accountStatus: "PENDING_ACTIVATION" });
    await tao("YEU_KH", { accountStatus: "PENDING_ACTIVATION" });
    await tao("YEU_DL", { accountStatus: "ACTIVE" });
  }, 60_000);
  afterAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    await don();
  }, 60_000);

  it("[OTP-DD-01] xin mã kích hoạt: phản hồi giống hệt cho mọi loại định danh; chỉ phụ huynh PENDING có OtpRequest", async () => {
    const phanHoi: Array<{ s: number; b: Phan }> = [];
    for (const k of ["CHO", "DA_KICH_HOAT", "NHAN_VIEN", "XOA"] as K[]) {
      const r = await xin(kichHoatXinMa, k);
      phanHoi.push({ s: r.status, b: await json(r) });
    }
    const la = await xin(kichHoatXinMa, "0966599999"); // SĐT chưa có tài khoản
    phanHoi.push({ s: la.status, b: await json(la) });
    for (const p of phanHoi) {
      expect(p.s).toBe(200);
      expect(p.b.ok).toBe(true);
      expect(Object.keys(p.b.data ?? {})).toEqual(["choGuiLaiSau"]);
      expect(typeof p.b.data?.choGuiLaiSau).toBe("number");
    }
    expect(new Set(phanHoi.map((p) => JSON.stringify(p.b))).size).toBe(1); // bít-đối-bít
    expect(await coOtp("CHO", "ACTIVATION")).toBe(1);
    for (const k of ["DA_KICH_HOAT", "NHAN_VIEN", "XOA"] as K[]) expect(await coOtp(k, "ACTIVATION"), k).toBe(0);
  }, 60_000);

  it("[OTP-DD-02] xin mã đặt lại: chỉ phụ huynh ACTIVE được gửi; còn lại nuốt về phản hồi chung", async () => {
    const hop = await xin(datLaiXinMa, "DUNG_LAI");
    const chua = await xin(datLaiXinMa, "KHAC"); // PENDING ⇒ chưa có mật khẩu để đặt lại
    const nv = await xin(datLaiXinMa, "NHAN_VIEN");
    for (const r of [hop, chua, nv]) expect(r.status).toBe(200);
    expect(JSON.stringify(await json(hop))).toBe(JSON.stringify(await json(chua)));
    expect(await coOtp("DUNG_LAI", "RESET")).toBe(1);
    expect(await coOtp("KHAC", "RESET")).toBe(0);
    expect(await coOtp("NHAN_VIEN", "RESET")).toBe(0);
  }, 60_000);

  it("[OTP-DD-11] SEC-12 — mật khẩu quá yếu bị TỪ CHỐI 400 VALIDATION/MAT_KHAU_YEU TRƯỚC khi tiêu mã OTP: mã vẫn dùng được, mật khẩu không đổi; mật khẩu khoẻ rồi mới qua (kích hoạt + đặt lại)", async () => {
    for (const [k, route, mucDich] of [["YEU_KH", kichHoatXacNhan, "ACTIVATION"], ["YEU_DL", datLaiXacNhan, "RESET"]] as const) {
      const ma = await layMa(k, mucDich);
      const truoc = await nguoi(k);
      for (const yeu of ["12345678", "Password1", SDT[k], `${SDT[k]}ab`]) {
        const r = await xacNhan(route, k, ma, yeu);
        const b = await json(r);
        expect([r.status, b.error?.code, (b.error as { maChiTiet?: string } | undefined)?.maChiTiet], `${k} «${yeu}»`).toEqual([400, "VALIDATION", "MAT_KHAU_YEU"]);
      }
      const sau = await nguoi(k);
      expect([sau.password, sau.tokenVersion, sau.accountStatus]).toEqual([truoc.password, truoc.tokenVersion, truoc.accountStatus]); // không đổi gì
      const ok = await xacNhan(route, k, ma, MK_MOI); // CÙNG mã vẫn còn dùng được
      expect(ok.status, `${k} mã phải còn dùng được sau khi bị từ chối vì mật khẩu yếu`).toBe(200);
      expect(await bcrypt.compare(MK_MOI, (await nguoi(k)).password ?? "")).toBe(true);
    }
  }, 60_000);

  it("[OTP-DD-03] kích hoạt đúng mã ⇒ 200, ACTIVE, đăng nhập được bằng mật khẩu vừa đặt; dùng lại mã ⇒ OTP_INVALID", async () => {
    const ma = await layMa("KICH_HOAT_OK", "ACTIVATION");
    const r = await xacNhan(kichHoatXacNhan, "KICH_HOAT_OK", ma);
    expect(r.status).toBe(200);
    expect((await json(r)).data).toEqual({ daDatMatKhau: true });
    const u = await nguoi("KICH_HOAT_OK");
    expect(u.accountStatus).toBe("ACTIVE");
    expect(u.phoneVerifiedAt).not.toBeNull();
    expect(await bcrypt.compare(MK_MOI, u.password ?? "")).toBe(true);
    expect((await dangNhap("KICH_HOAT_OK", 1, MK_MOI)).status).toBe(200);
    const lai = await xacNhan(kichHoatXacNhan, "KICH_HOAT_OK", ma, "Mat-khau-khac-2028!");
    expect(lai.status).toBe(400);
    expect((await json(lai)).error?.code).toBe("OTP_INVALID");
    expect(await bcrypt.compare(MK_MOI, (await nguoi("KICH_HOAT_OK")).password ?? "")).toBe(true); // mật khẩu không bị đổi lần hai
  }, 60_000);

  it("[OTP-DD-04] sai mã: OTP_INVALID kèm conLai giảm dần; hết lượt ⇒ OTP_TOO_MANY_ATTEMPTS 429; mã đúng sau khoá vẫn bị từ chối", async () => {
    const ma = await layMa("SAI_MA", "ACTIVATION");
    const sai = ma === "000000" ? "111111" : "000000";
    const conLai: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await xacNhan(kichHoatXacNhan, "SAI_MA", sai);
      const b = await json(r);
      expect(r.status).toBe(400);
      expect(b.error?.code).toBe("OTP_INVALID");
      conLai.push(b.error?.chiTiet?.conLai ?? -1);
    }
    expect(conLai).toEqual([4, 3, 2, 1]);
    const cuoi = await xacNhan(kichHoatXacNhan, "SAI_MA", sai); // lần thử thứ 5 ⇒ khoá ngay
    expect(cuoi.status).toBe(429);
    expect((await json(cuoi)).error?.code).toBe("OTP_TOO_MANY_ATTEMPTS");
    const khoa = await xacNhan(kichHoatXacNhan, "SAI_MA", ma); // MÃ ĐÚNG nhưng đã hết lượt
    expect(khoa.status).toBe(429);
    expect((await json(khoa)).error?.code).toBe("OTP_TOO_MANY_ATTEMPTS");
    expect((await nguoi("SAI_MA")).accountStatus).toBe("PENDING_ACTIVATION");
  }, 60_000);

  it("[OTP-DD-05] mã hết hạn ⇒ OTP_EXPIRED 400, mật khẩu không đổi", async () => {
    const ma = await layMa("HET_HAN", "ACTIVATION");
    await db.otpRequest.updateMany({ where: { target: chuan("HET_HAN"), purpose: "ACTIVATION" }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const r = await xacNhan(kichHoatXacNhan, "HET_HAN", ma);
    expect(r.status).toBe(400);
    expect((await json(r)).error?.code).toBe("OTP_EXPIRED");
    expect((await nguoi("HET_HAN")).password).toBeNull();
  }, 60_000);

  it("[OTP-DD-06] đặt lại đúng mã ⇒ thu hồi MỌI phiên, tokenVersion+1, token cũ 401, mật khẩu cũ hết dùng, mới dùng được, có audit", async () => {
    const p1 = await dangNhap("DAT_LAI_OK", 11, MK_CU);
    const p2 = await dangNhap("DAT_LAI_OK", 12, MK_CU);
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    const tokCu = ((await json(p1)).data as { accessToken: string }).accessToken;
    expect((await meRoute(req("/api/mobile/v1/auth/me", undefined, `Bearer ${tokCu}`))).status).toBe(200);
    const tvTruoc = (await nguoi("DAT_LAI_OK")).tokenVersion;
    expect(await db.mobileSession.count({ where: { userId: ids.DAT_LAI_OK!, thuHoiLuc: null } })).toBe(2);

    const ma = await layMa("DAT_LAI_OK", "RESET");
    const r = await xacNhan(datLaiXacNhan, "DAT_LAI_OK", ma);
    expect(r.status).toBe(200);
    expect((await json(r)).data).toEqual({ daDatMatKhau: true });

    expect((await nguoi("DAT_LAI_OK")).tokenVersion).toBe(tvTruoc + 1);
    expect(await db.mobileSession.count({ where: { userId: ids.DAT_LAI_OK!, thuHoiLuc: null } })).toBe(0);
    expect((await meRoute(req("/api/mobile/v1/auth/me", undefined, `Bearer ${tokCu}`))).status).toBe(401);
    expect((await dangNhap("DAT_LAI_OK", 13, MK_CU)).status).toBe(401); // mật khẩu cũ hết dùng
    expect((await dangNhap("DAT_LAI_OK", 14, MK_MOI)).status).toBe(200);
    expect(await db.auditLog.count({ where: { entityId: ids.DAT_LAI_OK!, action: "user.password_reset" } })).toBeGreaterThan(0);
  }, 90_000);

  it("[OTP-DD-07] trạng thái sai dù có mã đúng ⇒ 409, KHÔNG đổi mật khẩu", async () => {
    const hash = (await nguoi("DA_KICH_HOAT")).password;
    const maKH = await layMa("DA_KICH_HOAT", "ACTIVATION");
    const r1 = await xacNhan(kichHoatXacNhan, "DA_KICH_HOAT", maKH);
    expect(r1.status).toBe(409);
    expect((await json(r1)).error?.code).toBe("VALIDATION");
    expect((await nguoi("DA_KICH_HOAT")).password).toBe(hash);

    const maDL = await layMa("CHO", "RESET"); // CHO vẫn PENDING (OTP-DD-01 chỉ xin mã, chưa xác nhận)
    const r2 = await xacNhan(datLaiXacNhan, "CHO", maDL);
    expect(r2.status).toBe(409);
    expect((await nguoi("CHO")).password).toBeNull();
    expect((await nguoi("CHO")).accountStatus).toBe("PENDING_ACTIVATION");
  }, 60_000);

  it("[OTP-DD-08] tài khoản nhân viên có mã đúng ⇒ 409 TAI_KHOAN_KHONG_HOP_LE, KHÔNG đổi mật khẩu", async () => {
    const ma = await layMa("NHAN_VIEN", "ACTIVATION");
    const r = await xacNhan(kichHoatXacNhan, "NHAN_VIEN", ma);
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).toContain("TAI_KHOAN_KHONG_HOP_LE");
    const u = await nguoi("NHAN_VIEN");
    expect(u.password).toBeNull();
    expect(u.accountStatus).toBe("PENDING_ACTIVATION");
  }, 60_000);

  it("[OTP-DD-09] xin mã vượt 5/giờ theo định danh ⇒ 429 + Retry-After; định danh khác không bị ảnh hưởng; xác nhận vượt 10/15 phút ⇒ 429", async () => {
    const kq: number[] = [];
    let thuLai: string | null = null;
    for (let i = 0; i < 6; i++) {
      const r = await xin(kichHoatXinMa, "HAN_MUC");
      kq.push(r.status);
      if (r.status === 429) thuLai = r.headers.get("retry-after");
    }
    expect(kq).toEqual([200, 200, 200, 200, 200, 429]);
    expect(Number(thuLai)).toBeGreaterThan(0);
    expect((await xin(kichHoatXinMa, "KHAC")).status).toBe(200); // định danh khác không bị đếm chung

    // Định danh CHƯA có mã nào ⇒ «chưa có mã» (400) không tiêu lượt thử của dịch vụ OTP, nên chỉ còn trần của route chặn được.
    const trangThai: number[] = [];
    for (let i = 0; i < 11; i++) trangThai.push((await kichHoatXacNhan(req("/x", { dinhDanh: "0966599998", ma: "123456", matKhau: MK_MOI }))).status);
    expect(trangThai.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(trangThai[10]).toBe(429);
  }, 120_000);

  it("[OTP-DD-10] đầu vào sai ⇒ 400 VALIDATION; cờ MOBILE_API_ENABLED tắt ⇒ 404", async () => {
    const xet = async (r: Response) => ({ s: r.status, c: (await json(r)).error?.code });
    expect(await xet(await xin(kichHoatXinMa, "khong-phai-sdt"))).toEqual({ s: 400, c: "VALIDATION" });
    expect(await xet(await kichHoatXacNhan(req("/x", { dinhDanh: SDT.CHO, ma: "12345", matKhau: MK_MOI })))).toEqual({ s: 400, c: "VALIDATION" });
    expect(await xet(await kichHoatXacNhan(req("/x", { dinhDanh: SDT.CHO, ma: "123456", matKhau: "ngan" })))).toEqual({ s: 400, c: "VALIDATION" });
    expect(await xet(await kichHoatXacNhan(req("/x", { dinhDanh: SDT.CHO, ma: "123456", matKhau: "x".repeat(73) })))).toEqual({ s: 400, c: "VALIDATION" });
    expect(await xet(await datLaiXacNhan(req("/x", { dinhDanh: SDT.CHO })))).toEqual({ s: 400, c: "VALIDATION" });
    process.env.MOBILE_API_ENABLED = "false";
    try {
      expect((await xin(kichHoatXinMa, "CHO")).status).toBe(404);
      expect((await xacNhan(datLaiXacNhan, "CHO", "123456")).status).toBe(404);
    } finally {
      process.env.MOBILE_API_ENABLED = "true";
    }
  }, 60_000);
});
