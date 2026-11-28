import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Phiên WEB giả lập: `auth()` trả người dùng do ca đặt. Mật khẩu / thu hồi chạy trên Postgres THẬT.
const phienWeb: { user: { id: string; name: string; email: string; role: string; roles: string[] } | null } = { user: null };
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => phienWeb),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.88.0.1", "user-agent": "vitest" })),
  cookies: vi.fn(async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined })),
}));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as meRoute } from "@/app/api/mobile/v1/auth/me/route";
import { POST as lamMoiRoute } from "@/app/api/mobile/v1/auth/refresh/route";
import { changeOwnPasswordAction } from "@/app/(auth)/doi-mat-khau/_actions";
import { changePassword } from "@/app/(admin)/admin/settings/actions";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * ĐỔI MẬT KHẨU TRÊN WEB ⇒ THU HỒI PHIÊN DI ĐỘNG (B3.5, mã ca: DMK) — Postgres thật. Hai đường web CHỦ Ý không tăng `tokenVersion`:
 * `(auth)/doi-mat-khau` và `(admin)/admin/settings`. Cổng DB cục bộ như `xac-thuc.spec.ts`; dữ liệu tiền tố `mobiletest-pw-`, dọn ở `afterAll`.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const MK_CU = "Mat-khau-test-2026";
const MK_MOI = "Mat-khau-moi-2027!";
const NS = "mobiletest-pw-";
const THIET_BI = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;
let ipN = 0;
const ip = () => `10.99.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;

const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };

async function dangNhapDiDong(dinhDanh: string, n: number, matKhau = MK_CU) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh, matKhau, thietBi: { maThietBi: THIET_BI(n), nenTang: "ios", tenMay: "iPhone15,2", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập di động thất bại ${r.status} ${JSON.stringify(b)}`);
  return b.data as { accessToken: string; refreshToken: string };
}
const me = async (t: string) => {
  const r = await meRoute(req("/api/mobile/v1/auth/me", undefined, `Bearer ${t}`));
  return [r.status, (await json(r)).error?.code ?? "ok"] as const;
};
const lamMoi = async (t: string) => {
  const r = await lamMoiRoute(req("/api/mobile/v1/auth/refresh", { refreshToken: t }));
  return [r.status, (await json(r)).error?.code ?? "ok"] as const;
};

const ids: Record<string, string> = {};
const SDT = { PH: "0966300001", PH2: "0966300002", NV: "0966300003" };
const dangSong = (userId: string) => db.mobileSession.count({ where: { userId, thuHoiLuc: null } });
const dangNhapWeb = (u: { id: string; email: string; role: string }) => (phienWeb.user = { id: u.id, name: "t", email: u.email, role: u.role, roles: [u.role] });

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: uids } }, { actorId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("đổi mật khẩu web ⇒ thu hồi phiên di động — Postgres thật", () => {
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MK_CU, 4);
    const tao = async (k: keyof typeof SDT, role: "PARENT" | "TEACHER", extra: Record<string, unknown> = {}) => {
      const u = await db.user.create({
        data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${SDT[k].slice(1)}`, password: hash, role, roles: [role], ...extra } as never,
        select: { id: true },
      });
      ids[k] = u.id;
    };
    await tao("PH", "PARENT", { mustChangePassword: true });
    await tao("PH2", "PARENT");
    await tao("NV", "TEACHER");
  });
  afterAll(async () => {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS dmk_chan_thu_hoi ON "MobileSession"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS dmk_chan_thu_hoi_fn()`);
    await don();
  });

  it("[DMK-01] (auth)/doi-mat-khau: đổi mật khẩu ⇒ MỌI phiên di động (nhiều thiết bị) bị thu hồi; access + refresh cũ bị từ chối; tokenVersion KHÔNG đổi (phiên web giữ)", async () => {
    const a = await dangNhapDiDong(SDT.PH, 1);
    const b = await dangNhapDiDong(SDT.PH, 2); // thiết bị khác
    expect(await dangSong(ids.PH)).toBe(2);
    expect(await me(a.accessToken)).toEqual([200, "ok"]);
    const truoc = await db.user.findUniqueOrThrow({ where: { id: ids.PH }, select: { tokenVersion: true } });

    dangNhapWeb({ id: ids.PH, email: `${NS}PH@seed.invalid`, role: "PARENT" });
    const kq = await changeOwnPasswordAction({ newPassword: MK_MOI, confirmPassword: MK_MOI });
    expect(kq).toEqual({ ok: true });

    expect(await dangSong(ids.PH)).toBe(0);
    const ss = await db.mobileSession.findMany({ where: { userId: ids.PH } });
    expect(ss.map((s) => s.lyDoThuHoi)).toEqual(["tai-khoan", "tai-khoan"]);
    expect(ss.every((s) => s.accessHash === null && s.refreshHash === null && s.refreshHashTruoc === null)).toBe(true); // băm token đã xoá
    // access cũ (cả hai thiết bị) và refresh cũ đều bị từ chối
    expect(await me(a.accessToken)).toEqual([401, "TOKEN_REVOKED"]);
    expect(await me(b.accessToken)).toEqual([401, "TOKEN_REVOKED"]);
    expect(await lamMoi(a.refreshToken)).toEqual([401, "TOKEN_REVOKED"]);
    expect(await lamMoi(b.refreshToken)).toEqual([401, "TOKEN_REVOKED"]);
    // phiên web: chính sách đã duyệt = KHÔNG tăng tokenVersion (giữ phiên web hiện tại)
    const sau = await db.user.findUniqueOrThrow({ where: { id: ids.PH }, select: { tokenVersion: true, mustChangePassword: true } });
    expect(sau.tokenVersion).toBe(truoc.tokenVersion);
    expect(sau.mustChangePassword).toBe(false);
    // mật khẩu mới dùng được, cũ thì không
    const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: SDT.PH, matKhau: MK_CU, thietBi: { maThietBi: THIET_BI(3), nenTang: "ios" } }));
    expect(r.status).toBe(401);
    expect((await dangNhapDiDong(SDT.PH, 3, MK_MOI)).accessToken).toBeTruthy();
    // kiểm toán: có dòng thu hồi hàng loạt, KHÔNG chứa token / mật khẩu
    const kt = await db.auditLog.findMany({ where: { entityId: ids.PH, action: "mobile.sessions_revoked" } });
    expect(kt.length).toBe(1);
    const dong = JSON.stringify(kt[0]);
    for (const bi of [a.accessToken, a.refreshToken, MK_CU, MK_MOI]) expect(dong).not.toContain(bi);
    expect(dong).toContain('"soPhien":2');
    expect(dong).toContain('"lyDo":"doi-mat-khau"'); // nguyên nhân cụ thể ở kiểm toán
  });

  it("[DMK-02] không ảnh hưởng tài khoản KHÁC: phiên di động của phụ huynh khác vẫn sống", async () => {
    const khac = await dangNhapDiDong(SDT.PH2, 1);
    dangNhapWeb({ id: ids.PH, email: `${NS}PH@seed.invalid`, role: "PARENT" });
    await dangNhapDiDong(SDT.PH, 4, MK_MOI);
    const kq = await changeOwnPasswordAction({ newPassword: "Mat-khau-khac-2028!", confirmPassword: "Mat-khau-khac-2028!" });
    expect(kq).toEqual({ ok: true });
    expect(await dangSong(ids.PH)).toBe(0);
    expect(await dangSong(ids.PH2)).toBe(1);
    expect(await me(khac.accessToken)).toEqual([200, "ok"]);
  });

  it("[DMK-03] đường THẤT BẠI không thu hồi sai phiên: mật khẩu trùng / không hợp lệ / chưa đăng nhập web ⇒ phiên di động còn sống", async () => {
    const t = await dangNhapDiDong(SDT.PH2, 2);
    const truoc = await dangSong(ids.PH2);
    dangNhapWeb({ id: ids.PH2, email: `${NS}PH2@seed.invalid`, role: "PARENT" });
    // trùng mật khẩu hiện tại
    expect(await changeOwnPasswordAction({ newPassword: MK_CU, confirmPassword: MK_CU })).toEqual({ ok: false, error: "Mật khẩu mới phải khác mật khẩu hiện tại" });
    // không hợp lệ (ngắn / không khớp)
    expect((await changeOwnPasswordAction({ newPassword: "x", confirmPassword: "y" })).ok).toBe(false);
    // chưa đăng nhập web
    phienWeb.user = null;
    expect(await changeOwnPasswordAction({ newPassword: MK_MOI, confirmPassword: MK_MOI })).toEqual({ ok: false, error: "Chưa đăng nhập" });
    expect(await dangSong(ids.PH2)).toBe(truoc);
    expect(await me(t.accessToken)).toEqual([200, "ok"]);
  });

  it("[DMK-04] NHẤT QUÁN GIAO DỊCH: thu hồi lỗi giữa chừng ⇒ giao dịch CUỘN LẠI — mật khẩu KHÔNG đổi, phiên KHÔNG mất, người dùng nhận lỗi (không báo thành công)", async () => {
    const t = await dangNhapDiDong(SDT.PH2, 2); // đăng nhập TRƯỚC khi đặt trigger (đăng nhập cũng UPDATE bảng này)
    // Gây lỗi thật ở DB: trigger từ chối UPDATE bảng MobileSession của đúng tài khoản thử.
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION dmk_chan_thu_hoi_fn() RETURNS trigger AS $f$ BEGIN IF NEW."userId" = '${ids.PH2}' THEN RAISE EXCEPTION 'dmk: chan thu hoi'; END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER dmk_chan_thu_hoi BEFORE UPDATE ON "MobileSession" FOR EACH ROW EXECUTE FUNCTION dmk_chan_thu_hoi_fn()`);
    try {
      const hashTruoc = (await db.user.findUniqueOrThrow({ where: { id: ids.PH2 }, select: { password: true } })).password;
      const songTruoc = await dangSong(ids.PH2);
      dangNhapWeb({ id: ids.PH2, email: `${NS}PH2@seed.invalid`, role: "PARENT" });
      const kq = await changeOwnPasswordAction({ newPassword: MK_MOI, confirmPassword: MK_MOI });
      expect(kq.ok).toBe(false);
      expect(JSON.stringify(kq)).not.toContain("dmk: chan"); // không lộ chi tiết lỗi DB
      const hashSau = (await db.user.findUniqueOrThrow({ where: { id: ids.PH2 }, select: { password: true } })).password;
      expect(hashSau).toBe(hashTruoc); // mật khẩu KHÔNG đổi
      expect(await dangSong(ids.PH2)).toBe(songTruoc); // không phiên nào bị thu hồi
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS dmk_chan_thu_hoi ON "MobileSession"`);
    }
    expect(await me(t.accessToken)).toEqual([200, "ok"]); // (đo SAU khi gỡ trigger: /me cũng UPDATE `lanDungCuoi`) phiên vẫn dùng được
  });

  it("[DMK-05] (admin)/admin/settings: nhân sự tự đổi mật khẩu ⇒ phiên di động của CHÍNH tài khoản đó bị thu hồi; tokenVersion giữ; sai mật khẩu hiện tại ⇒ không thu hồi", async () => {
    const t = await dangNhapDiDong(SDT.PH2, 5, MK_CU).catch(() => null);
    void t;
    // tài khoản nhân viên: tạo phiên di động trực tiếp trong DB (app di động từ chối nhân viên ở cổng đăng nhập)
    const nv = ids.NV;
    await db.mobileSession.create({
      data: { userId: nv, maTra: randomBytes(16).toString("base64url").slice(0, 22), maThietBi: THIET_BI(77), nenTang: "ios", hetHanKhongDung: new Date(Date.now() + 86_400_000), hetHanTuyetDoi: new Date(Date.now() + 2 * 86_400_000), accessHetHan: new Date(Date.now() + 60_000), accessHash: "a".repeat(64), refreshHash: "b".repeat(64), xacNhanLuc: new Date(), tokenVersionLucCap: 0 },
    });
    dangNhapWeb({ id: nv, email: `${NS}NV@seed.invalid`, role: "TEACHER" });
    const truoc = await db.user.findUniqueOrThrow({ where: { id: nv }, select: { tokenVersion: true } });

    const form = (cu: string, moi: string) => {
      const f = new FormData();
      f.set("currentPassword", cu);
      f.set("newPassword", moi);
      f.set("confirmPassword", moi);
      return f;
    };
    expect(await changePassword(form("sai-mat-khau-hien-tai", MK_MOI))).toEqual({ error: "Mật khẩu hiện tại không đúng" });
    expect(await dangSong(nv)).toBe(1); // sai mật khẩu hiện tại: KHÔNG thu hồi

    expect(await changePassword(form(MK_CU, MK_MOI))).toEqual({});
    expect(await dangSong(nv)).toBe(0);
    expect((await db.mobileSession.findFirstOrThrow({ where: { userId: nv } })).lyDoThuHoi).toBe("tai-khoan");
    expect((await db.user.findUniqueOrThrow({ where: { id: nv }, select: { tokenVersion: true } })).tokenVersion).toBe(truoc.tokenVersion);
    expect(await bcrypt.compare(MK_MOI, (await db.user.findUniqueOrThrow({ where: { id: nv }, select: { password: true } })).password as string)).toBe(true);
  });
});
