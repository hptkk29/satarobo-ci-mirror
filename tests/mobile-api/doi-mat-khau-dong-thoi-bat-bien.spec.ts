import bcrypt from "bcryptjs";
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web: chặn `@/lib/auth`.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as meRoute } from "@/app/api/mobile/v1/auth/me/route";
import { POST as doiMkRoute } from "@/app/api/mobile/v1/parent/password/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [DMKD-INV] BẤT BIẾN BẢO MẬT của đổi mật khẩu ĐỒNG THỜI (V8.30) — chạy NHIỀU vòng, ghi lại PHÂN BỐ cặp trạng thái (để điều tra `[DMKD-DB-05]` đỏ thoáng qua).
 * KHÔNG khẳng định một cặp trạng thái cụ thể (đó là việc của [DMKD-DB-05]); khẳng định những điều KHÔNG BAO GIỜ được sai, dù lịch chạy ra sao:
 *   (1) KHÔNG BAO GIỜ hai lượt cùng 200;  (2) mọi trạng thái ∈ {200, 400 PASSWORD_INCORRECT (lượt đến SAU khi mật khẩu đã đổi — tuần tự hoá), 409 (thua CAS)};
 *   (3) mật khẩu cuối là của lượt thắng (hoặc không đổi nếu không ai thắng); (4) tokenVersion tăng ĐÚNG số lượt 200;
 *   (5) sau lượt thắng: token mới của người thắng dùng được; token CŨ của cả hai thiết bị chết (401) — không phiên nào sống sót với mật khẩu cũ.
 * Biến môi trường: DMKD_VONG (số vòng, mặc định 25) · DMKD_GHI (đường dẫn tệp để ghi phân bố — dùng khi điều tra).
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));
const VONG = Number(process.env.DMKD_VONG ?? 25);

const MK_CU = "Mat-khau-test-2026";
const NS = "dmkdinv-";
const SDT = "0966410001";
let ipN = 0;
const ip = () => `10.98.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Ket = { ok: boolean; data?: { accessToken: string; refreshToken: string }; error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Ket;
const thietBi = (n: number) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
let uid = "";
let hashCu = "";

async function dang(n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: SDT, matKhau: MK_CU, thietBi: { maThietBi: thietBi(n), nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200 || !b.data) throw new Error(`đăng nhập thất bại ${r.status}`);
  return b.data;
}
const me = async (t: string) => (await meRoute(req("/api/mobile/v1/auth/me", undefined, `Bearer ${t}`))).status;

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: uids } }, { actorId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[DMKD-INV] đổi mật khẩu đồng thời — bất biến bảo mật", () => {
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    hashCu = await bcrypt.hash(MK_CU, 4);
    const u = await db.user.create({ data: { email: `${NS}A@seed.invalid`, name: `${NS}A`, phone: `84${SDT.slice(1)}`, password: hashCu, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    uid = u.id;
  }, 60_000);
  afterAll(don);

  it(`[DMKD-INV-01] ${VONG} vòng hai lượt đổi đồng thời: không bao giờ hai 200; bất biến mật khẩu/tokenVersion/phiên giữ đúng`, async () => {
    const phanBo: Record<string, number> = {};
    for (let v = 0; v < VONG; v++) {
      // đường cơ sở sạch cho mỗi vòng: mật khẩu cũ, phiên cũ thu hồi, bộ đếm giới hạn xoá
      await db.mobileSession.deleteMany({ where: { userId: uid } });
      await db.authAttemptCounter.deleteMany({});
      await db.user.update({ where: { id: uid }, data: { password: hashCu } });
      const may1 = await dang(1);
      const may2 = await dang(2);
      const tv0 = (await db.user.findUniqueOrThrow({ where: { id: uid }, select: { tokenVersion: true } })).tokenVersion;
      const mk1 = `Mat-khau-thang-1-vong${v}`;
      const mk2 = `Mat-khau-thang-2-vong${v}`;
      const doi = (t: string, moi: string) => doiMkRoute(req("/api/mobile/v1/parent/password", { matKhauHienTai: MK_CU, matKhauMoi: moi }, `Bearer ${t}`));
      const [r1, r2] = await Promise.all([doi(may1.accessToken, mk1), doi(may2.accessToken, mk2)]);
      const b1 = await json(r1.clone()); const b2 = await json(r2.clone());
      const mo = (r: Response, b: Ket) => (r.status === 200 ? "200" : `${r.status}${b.error?.code ? ":" + b.error.code : ""}`);
      const cap = [mo(r1, b1), mo(r2, b2)].sort().join(" + ");
      phanBo[cap] = (phanBo[cap] ?? 0) + 1;

      const thang = [r1, r2].filter((r) => r.status === 200).length;
      expect(thang, `vòng ${v}: ${cap}`).toBeLessThanOrEqual(1); // (1) KHÔNG BAO GIỜ hai lượt cùng thành công
      for (const [r, b] of [[r1, b1], [r2, b2]] as const) {
        const hopLe = r.status === 200 || (r.status === 400 && b.error?.code === "PASSWORD_INCORRECT") || (r.status === 409);
        expect(hopLe, `vòng ${v}: trạng thái ngoài dự kiến ${r.status} ${b.error?.code}`).toBe(true); // (2)
      }
      const sau = await db.user.findUniqueOrThrow({ where: { id: uid }, select: { password: true, tokenVersion: true } });
      expect(sau.tokenVersion - tv0, `vòng ${v}`).toBe(thang); // (4)
      if (thang === 1) {
        const mkThang = r1.status === 200 ? mk1 : mk2;
        expect(await bcrypt.compare(mkThang, sau.password!)).toBe(true); // (3)
        const tokThang = (r1.status === 200 ? b1 : b2).data!;
        expect(await me(tokThang.accessToken), `vòng ${v}: token mới của người thắng`).toBe(200); // (5)
        expect(await me(may1.accessToken), `vòng ${v}: token cũ máy 1`).toBe(401);
        expect(await me(may2.accessToken), `vòng ${v}: token cũ máy 2`).toBe(401);
      } else {
        expect(await bcrypt.compare(MK_CU, sau.password!)).toBe(true); // không ai thắng ⇒ không đổi
      }
    }
    const dong = `${new Date().toISOString()} vong=${VONG} phan-bo=${JSON.stringify(phanBo)}`;
    console.log("[DMKD-INV] " + dong);
    if (process.env.DMKD_GHI) appendFileSync(process.env.DMKD_GHI, dong + "\n");
  }, 600_000);

  it("[DMKD-INV-02] DB CHẬM (khoá người dùng bị giữ > timeout giao dịch 5 s): lượt đổi FAIL-SAFE — mật khẩu/tokenVersion KHÔNG đổi, phiên vẫn dùng được; không bao giờ trả 200 khi chưa ghi", async () => {
    await db.mobileSession.deleteMany({ where: { userId: uid } });
    await db.authAttemptCounter.deleteMany({});
    await db.user.update({ where: { id: uid }, data: { password: hashCu } });
    const may = await dang(3);
    const tv0 = (await db.user.findUniqueOrThrow({ where: { id: uid }, select: { tokenVersion: true } })).tokenVersion;
    let giuXong!: () => void; const tuGiu = new Promise<void>((ok) => { giuXong = ok; });
    // «DB chậm»: một giao dịch KHÁC giữ đúng khoá advisory của người dùng 8 giây
    const giu = db.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${uid}))`; giuXong(); await tx.$executeRaw`SELECT pg_sleep(6.5)`; }, { timeout: 20_000 });
    await tuGiu;
    const r = await doiMkRoute(req("/api/mobile/v1/parent/password", { matKhauHienTai: MK_CU, matKhauMoi: "Mat-khau-cham-2027" }, `Bearer ${may.accessToken}`));
    const b = await json(r.clone());
    await giu;
    const dong = `${new Date().toISOString()} DB-CHAM trang-thai=${r.status} code=${b.error?.code ?? "-"}`;
    console.log("[DMKD-INV] " + dong);
    if (process.env.DMKD_GHI) appendFileSync(process.env.DMKD_GHI, dong + "\n");
    const sau = await db.user.findUniqueOrThrow({ where: { id: uid }, select: { password: true, tokenVersion: true } });
    if (r.status === 200) {
      expect(await bcrypt.compare("Mat-khau-cham-2027", sau.password!)).toBe(true); // 200 ⇒ ĐÃ ghi thật
      expect(sau.tokenVersion).toBe(tv0 + 1);
    } else {
      expect(await bcrypt.compare(MK_CU, sau.password!)).toBe(true); // lỗi ⇒ KHÔNG đổi gì
      expect(sau.tokenVersion).toBe(tv0);
      expect(await me(may.accessToken)).toBe(200); // phiên cũ vẫn dùng được (không bị thu hồi oan)
    }
  }, 60_000);
});
