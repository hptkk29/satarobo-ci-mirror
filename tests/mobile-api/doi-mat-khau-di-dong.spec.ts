import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web: chặn `@/lib/auth` để mọi đường lỡ gọi `auth()` thật sẽ đỏ.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as meRoute } from "@/app/api/mobile/v1/auth/me/route";
import { POST as lamMoiRoute } from "@/app/api/mobile/v1/auth/refresh/route";
import { POST as doiMkRoute } from "@/app/api/mobile/v1/parent/password/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [DMKD] POST /parent/password (BR-AUTH-02) — đổi mật khẩu TRÊN APP, Postgres thật, gọi thẳng route handler.
 *   [DMKD-DB-01] đúng ⇒ 200 + cặp token MỚI cho thiết bị đang gọi (dùng được ngay); access/refresh cũ chết; MỌI phiên khác chết; đăng nhập bằng mật khẩu mới được, cũ thì không; kiểm toán không chứa bí mật
 *   [DMKD-DB-02] mật khẩu hiện tại SAI ⇒ 400 PASSWORD_INCORRECT (KHÔNG phải 401); không đổi gì: băm, tokenVersion, phiên còn sống, token cũ còn dùng được
 *   [DMKD-DB-03] mật khẩu mới trùng cũ / quá ngắn / quá dài / thiếu trường ⇒ 400 VALIDATION, không đổi gì
 *   [DMKD-DB-04] giới hạn 5 lần / 15 phút theo người dùng: lượt thứ 6 ⇒ 429 + Retry-After (kể cả khi mật khẩu đúng); người dùng khác không bị ảnh hưởng
 *   [DMKD-DB-05] hai lượt đổi ĐỒNG THỜI ⇒ đúng MỘT thành công (409 «thử lại» cho lượt còn lại); mật khẩu cuối là của lượt thắng
 *   [DMKD-DB-06] phiên đang ở CHẾ ĐỘ HỌC SINH ⇒ 403 (không có trong danh sách cho phép), không đổi gì
 *   [DMKD-DB-07] chưa đăng nhập ⇒ 401; cờ MOBILE_API_ENABLED tắt ⇒ 404
 *   [DMKD-DB-08] SEC-12: mật khẩu mới quá yếu (dãy số, từ thông dụng, chứa SĐT của chính mình) ⇒ 400 VALIDATION + maChiTiet MAT_KHAU_YEU, KHÔNG đổi gì; mật khẩu khoẻ ⇒ 200
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const MK_CU = "Mat-khau-test-2026";
const MK_MOI = "Mat-khau-moi-2027!";
const NS = "dmkd-";
const THIET_BI = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
let ipN = 0;
const ip = () => `10.97.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: { accessToken: string; refreshToken: string; hetHanSau: number }; error?: { code: string; message: string } };
const SDT = { A: "0966400001", B: "0966400002", C: "0966400003", D: "0966400004", E: "0966400005" }; // E: SEC-12 (mật khẩu yếu)
const ids: Record<string, string> = {};

async function dangNhap(k: keyof typeof SDT, n: number, matKhau = MK_CU) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: SDT[k], matKhau, thietBi: { maThietBi: THIET_BI(n), nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  return { status: r.status, tok: b.data as { accessToken: string; refreshToken: string } };
}
const dang = async (k: keyof typeof SDT, n: number) => {
  const r = await dangNhap(k, n);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status}`);
  return r.tok;
};
const me = async (t: string) => (await meRoute(req("/api/mobile/v1/auth/me", undefined, `Bearer ${t}`))).status;
const doi = (t: string, hienTai: string, moi: string) => doiMkRoute(req("/api/mobile/v1/parent/password", { matKhauHienTai: hienTai, matKhauMoi: moi }, `Bearer ${t}`));
const nguoi = (k: keyof typeof SDT) => db.user.findUniqueOrThrow({ where: { id: ids[k]! }, select: { password: true, tokenVersion: true } });
const song = (k: keyof typeof SDT) => db.mobileSession.count({ where: { userId: ids[k]!, thuHoiLuc: null } });

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: uids } }, { actorId: { in: uids } }] } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[DMKD] đổi mật khẩu trên app — Postgres thật", () => {
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MK_CU, 4);
    for (const k of Object.keys(SDT) as Array<keyof typeof SDT>) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${SDT[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
  }, 60_000);
  afterAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    await don();
  });

  it("[DMKD-DB-01] đổi đúng ⇒ cặp token mới cho thiết bị gọi; phiên khác + token cũ chết; đăng nhập bằng mật khẩu mới", async () => {
    const may1 = await dang("A", 1);
    const may2 = await dang("A", 2);
    const truoc = await nguoi("A");
    const r = await doi(may1.accessToken, MK_CU, MK_MOI);
    const b = await json(r);
    expect(r.status).toBe(200);
    expect(b.data!.accessToken).toMatch(/^sma_/);
    expect(b.data!.refreshToken).toMatch(/^smr_/);
    expect(b.data!.hetHanSau).toBe(900);
    expect(await me(b.data!.accessToken)).toBe(200); // thiết bị vừa đổi KHÔNG bị đăng xuất
    expect(await me(may1.accessToken)).toBe(401); // access cũ của chính thiết bị này
    expect((await lamMoiRoute(req("/x", { refreshToken: may1.refreshToken }))).status).toBe(401); // refresh cũ không xin được cặp mới
    expect(await me(may2.accessToken)).toBe(401); // thiết bị KHÁC chết
    const sau = await nguoi("A");
    expect(sau.tokenVersion).toBe(truoc.tokenVersion + 1);
    expect(await bcrypt.compare(MK_MOI, sau.password!)).toBe(true);
    expect((await dangNhap("A", 3, MK_MOI)).status).toBe(200);
    expect((await dangNhap("A", 4, MK_CU)).status).toBe(401);
    // Kiểm toán: có dòng, KHÔNG có bí mật.
    const kt = await db.auditLog.findMany({ where: { entityId: ids.A, action: "mobile.password_changed" }, select: { newValues: true, oldValues: true } });
    expect(kt).toHaveLength(1);
    const chuoi = JSON.stringify(kt);
    for (const bm of [MK_CU, MK_MOI, b.data!.accessToken, b.data!.refreshToken, sau.password!]) expect(chuoi).not.toContain(bm);
  });

  it("[DMKD-DB-08] SEC-12: mật khẩu mới quá yếu ⇒ 400 VALIDATION/MAT_KHAU_YEU, không đổi băm / tokenVersion / phiên; mật khẩu khoẻ ⇒ 200", async () => {
    const t = await dang("E", 41);
    const truoc = await nguoi("E");
    // 4 lượt yếu + 1 lượt khoẻ = đúng 5 lượt/15 phút (mỗi lượt đều đếm — luật đổi mật khẩu [DMKD-DB-04])
    for (const yeu of ["12345678", "Password1", SDT.E, `Xx${SDT.E}`]) {
      const r = await doi(t.accessToken, MK_CU, yeu);
      const b = (await r.json()) as { error?: { code: string; maChiTiet?: string } };
      expect([r.status, b.error?.code, b.error?.maChiTiet], `«${yeu}»`).toEqual([400, "VALIDATION", "MAT_KHAU_YEU"]);
    }
    const sau = await nguoi("E");
    expect([sau.password, sau.tokenVersion]).toEqual([truoc.password, truoc.tokenVersion]);
    expect(await me(t.accessToken)).toBe(200); // phiên + token cũ còn sống
    const ok = await doi(t.accessToken, MK_CU, "bongdacamnang-2027");
    expect(ok.status).toBe(200);
    expect(await bcrypt.compare("bongdacamnang-2027", (await nguoi("E")).password ?? "")).toBe(true);
  }, 60_000);

  it("[DMKD-DB-02] mật khẩu hiện tại SAI ⇒ 400 PASSWORD_INCORRECT (không 401); không đổi gì", async () => {
    const tok = await dang("B", 1);
    const truoc = await nguoi("B");
    const r = await doi(tok.accessToken, "sai-mat-khau-hien-tai", MK_MOI);
    expect(r.status).toBe(400);
    expect((await json(r)).error!.code).toBe("PASSWORD_INCORRECT");
    const sau = await nguoi("B");
    expect([sau.password, sau.tokenVersion]).toEqual([truoc.password, truoc.tokenVersion]);
    expect(await song("B")).toBe(1);
    expect(await me(tok.accessToken)).toBe(200); // token cũ vẫn dùng được: sai mật khẩu KHÔNG phải «phiên hỏng»
  });

  it("[DMKD-DB-03] mật khẩu mới trùng cũ / quá ngắn / quá dài / thiếu trường ⇒ 400, không đổi gì", async () => {
    const tok = await dang("C", 1);
    const truoc = await nguoi("C");
    const mk = async (hienTai: unknown, moi: unknown) => {
      const r = await doiMkRoute(req("/x", { matKhauHienTai: hienTai, matKhauMoi: moi }, `Bearer ${tok.accessToken}`));
      return [r.status, (await json(r)).error?.code] as const;
    };
    expect(await mk(MK_CU, MK_CU)).toEqual([400, "VALIDATION"]);
    expect(await mk(MK_CU, "ngan")).toEqual([400, "VALIDATION"]);
    expect(await mk(MK_CU, "x".repeat(73))).toEqual([400, "VALIDATION"]);
    expect(await mk(undefined, MK_MOI)).toEqual([400, "VALIDATION"]);
    expect(await mk(MK_CU, undefined)).toEqual([400, "VALIDATION"]);
    const sau = await nguoi("C");
    expect([sau.password, sau.tokenVersion]).toEqual([truoc.password, truoc.tokenVersion]);
    expect(await me(tok.accessToken)).toBe(200);
  });

  it("[DMKD-DB-04] 5 lần / 15 phút theo người dùng: lượt thứ 6 ⇒ 429 (kể cả đúng mật khẩu); người dùng khác không ảnh hưởng", async () => {
    const tokD = await dang("D", 1);
    const tokA = (await dangNhap("A", 5, MK_MOI)).tok; // A đã đổi sang MK_MOI ở ca 01
    for (let i = 0; i < 5; i++) expect((await doi(tokD.accessToken, "sai-" + i + "-mat-khau", MK_MOI)).status).toBe(400);
    const r6 = await doi(tokD.accessToken, MK_CU, MK_MOI); // ĐÚNG mật khẩu nhưng đã hết lượt
    expect(r6.status).toBe(429);
    expect((await json(r6)).error!.code).toBe("RATE_LIMITED");
    expect(Number(r6.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await nguoi("D")).password).not.toBeNull();
    expect(await bcrypt.compare(MK_CU, (await nguoi("D")).password!)).toBe(true); // không đổi
    expect((await doi(tokA.accessToken, "sai-mat-khau-khac", MK_MOI)).status).toBe(400); // A (đã bị đổi mật khẩu ở ca 01 nhưng phiên mới) vẫn đi tới bước so mật khẩu, không bị 429 của D
  });

  it("[DMKD-DB-05] hai lượt đổi ĐỒNG THỜI ⇒ đúng MỘT thành công", async () => {
    // Đặt lại mật khẩu của B về MK_CU bằng đường DB (ca 02 không đổi gì) và dùng hai thiết bị.
    const may1 = await dang("B", 11);
    const may2 = await dang("B", 12);
    // ÉP đúng thế đua mà ca này đo: CẢ HAI lượt đã đọc dòng User (băm + tokenVersion cũ) rồi mới có lượt nào mở giao dịch — `bcrypt.hash(mật khẩu mới)`
    // đứng giữa hai bước đó. Không ép thì `Promise.all` không bảo đảm gì: lượt tới trễ đọc dòng User SAU khi lượt kia commit ⇒ 400 PASSWORD_INCORRECT
    // (tuần tự hoá hợp lệ, bất biến ở [DMKD-INV]) và ca đỏ chập chờn «[200, 400] ≠ [200, 409]» (đo 28/11: ép thứ tự đó ra đúng chữ ký 10/10 vòng).
    const bamThat = bcrypt.hash.bind(bcrypt);
    let soDen = 0;
    let moRao!: () => void;
    let hanRao: ReturnType<typeof setTimeout> | undefined;
    const duHai = new Promise<void>((ok, loi) => {
      hanRao = setTimeout(() => loi(new Error("[DMKD-DB-05] chỉ một lượt tới được bước băm mật khẩu mới")), 4_000);
      moRao = () => ok();
    });
    const gia = vi.spyOn(bcrypt, "hash").mockImplementation((async (mk: string, vong: number) => {
      if (++soDen === 2) moRao();
      await duHai;
      return bamThat(mk, vong);
    }) as never);
    let hai: Response[];
    try {
      hai = await Promise.all([doi(may1.accessToken, MK_CU, "Mat-khau-thang-1-2027"), doi(may2.accessToken, MK_CU, "Mat-khau-thang-2-2027")]);
    } finally {
      clearTimeout(hanRao);
      gia.mockRestore();
    }
    expect(soDen).toBe(2); // rào thật sự giữ cả hai lượt (đổi chỗ gọi băm trong dịch vụ thì ca này phải đỏ, không được xanh nhờ may rủi)
    const trangThai = hai.map((r) => r.status).sort();
    expect(trangThai).toEqual([200, 409]);
    const sau = await nguoi("B");
    const thang = hai[0]!.status === 200 ? "Mat-khau-thang-1-2027" : "Mat-khau-thang-2-2027";
    expect(await bcrypt.compare(thang, sau.password!)).toBe(true);
  });

  it("[DMKD-DB-06] phiên đang ở chế độ học sinh ⇒ 403; không đổi gì", async () => {
    const tok = await dang("C", 21);
    const hs = await db.student.create({ data: { id: `${NS}hs`, name: `${NS}hs`, parentUserId: ids.C } as never });
    await db.mobileSession.updateMany({ where: { userId: ids.C!, thuHoiLuc: null }, data: { hocSinhId: hs.id, hocSinhTuLuc: new Date() } });
    const truoc = await nguoi("C");
    const r = await doi(tok.accessToken, MK_CU, MK_MOI);
    expect(r.status).toBe(403);
    const sau = await nguoi("C");
    expect([sau.password, sau.tokenVersion]).toEqual([truoc.password, truoc.tokenVersion]);
    await db.mobileSession.updateMany({ where: { userId: ids.C! }, data: { hocSinhId: null, hocSinhTuLuc: null } });
    await db.student.delete({ where: { id: hs.id } });
  });

  it("[DMKD-DB-07] chưa đăng nhập ⇒ 401; cờ tắt ⇒ 404", async () => {
    expect((await doiMkRoute(req("/x", { matKhauHienTai: MK_CU, matKhauMoi: MK_MOI }))).status).toBe(401);
    process.env.MOBILE_API_ENABLED = "false";
    try {
      expect((await doiMkRoute(req("/x", { matKhauHienTai: MK_CU, matKhauMoi: MK_MOI }, "Bearer sma_x.y"))).status).toBe(404);
    } finally {
      process.env.MOBILE_API_ENABLED = "true";
    }
  });
});
