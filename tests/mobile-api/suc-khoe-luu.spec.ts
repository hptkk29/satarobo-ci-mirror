import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as noiDungGet } from "@/app/api/mobile/v1/parent/health/content/route";
import { DELETE as xoaDelete, GET as docGet, PUT as luuPut } from "@/app/api/mobile/v1/parent/health/records/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { datHomNay } from "@/lib/suc-khoe/dong-co-goc";
import { xoaSucKhoeHetHan } from "@/lib/suc-khoe/luu-may-chu-db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [SKR] V8.39 — SỨC KHOẺ LƯU CÓ CHỦ ĐÍCH (HL-01) qua HTTP + Postgres thật.
 *   [SKR-01] cờ tắt ⇒ 404 cả ba · [SKR-02] thiếu khoá mã hoá ⇒ 503, không lưu gì · [SKR-03] PUT→GET nguyên vẹn (hoatDong/vaiTro), bản lưu MÃ HOÁ (không có bản rõ), AAD buộc chủ tài khoản
 *   [SKR-04] cô lập: phụ huynh khác không thấy · [SKR-05] kiểm lại phía máy chủ ⇒ 400, không lưu · [SKR-06] khoá lạc quan + song song · [SKR-07] hết hạn ⇒ không có + xoá cứng
 *   [SKR-08] DELETE xoá cứng, idempotent; audit KHÔNG chứa nội dung · [SKR-09] thời hạn theo cấu hình + `luuTru` ở content · [SKR-10] xoá tài khoản ⇒ xoá theo · [SKR-11] thân > 64KB ⇒ 413 · [SKR-12] không log nội dung
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "skr-";
const MK = "Mat-khau-test-2026";
const KHOA_TEST = "khoa-thu-nghiem-suc-khoe-0123456789abcdef-0123456789";
let dem = 0;
const ip = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (method: string, body?: unknown, auth?: string, extra: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const nguoi = (n: number, o: Record<string, unknown> = {}) => ({ idCucBo: ID(n), tenGoi: "Bé Sao Băng", vaiTro: "Con gái", ns: "2018-05-01", gt: "nu", hoatDong: "nhieu", mt: false, benhNen: false, ban: [{ ngay: "2026-11-01", cao: 123.5, nang: 24.3, eo: null }], ...o });
const body = (ds: unknown[] = [nguoi(1)], extra: Record<string, unknown> = {}) => ({ dongY: { phienBan: "2026-11-22.1", luc: "2026-11-22T01:00:00.000Z" }, nguoi: ds, ...extra });

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.parentHealthRecord.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { entityType: "ParentHealthRecord" } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[SKR] sức khoẻ lưu có chủ đích", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const dn = async (sdt: string, nn: number) => {
    const r = await dangNhapRoute(req("POST", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9a00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
    const t = (j.data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", {}, bearer(t)));
    return t;
  };
  const luu = (t: string, b: unknown) => luuPut(req("PUT", b, bearer(t)));
  const doc = (t: string) => docGet(req("GET", undefined, bearer(t)));
  const xoa = (t: string) => xoaDelete(req("DELETE", undefined, bearer(t)));

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.SUC_KHOE_ENABLED = "true";
    process.env.HOA_DON_KHOA_BI_MAT = KHOA_TEST;
    delete process.env.HEALTH_RETENTION_MONTHS;
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const [k, sdt] of [["A", "84966950001"], ["B", "84966950002"]] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    tA = await dn("0966950001", 1);
    tB = await dn("0966950002", 2);
  }, 180_000);
  afterAll(async () => {
    await don();
    delete process.env.SUC_KHOE_ENABLED;
    delete process.env.HOA_DON_KHOA_BI_MAT;
    delete process.env.HEALTH_RETENTION_MONTHS;
  }, 180_000);

  it("[SKR-01] cờ SUC_KHOE_ENABLED tắt ⇒ 404 cả GET/PUT/DELETE (trước khi đọc thân)", async () => {
    process.env.SUC_KHOE_ENABLED = "false";
    try {
      expect((await doc(tA)).status).toBe(404);
      expect((await luuPut(new Request("http://localhost/x", { method: "PUT", headers: { authorization: bearer(tA), "content-type": "application/json", "x-forwarded-for": ip() }, body: "không-phải-json" }))).status).toBe(404);
      expect((await xoa(tA)).status).toBe(404);
    } finally {
      process.env.SUC_KHOE_ENABLED = "true";
    }
    expect(await db.parentHealthRecord.count({ where: { parentUserId: ids.A } })).toBe(0);
  });

  it("[SKR-02] thiếu khoá mã hoá ⇒ PUT 503 SUC_KHOE_CHUA_BAT_MA_HOA, KHÔNG lưu bản rõ", async () => {
    const giu = process.env.HOA_DON_KHOA_BI_MAT;
    delete process.env.HOA_DON_KHOA_BI_MAT;
    try {
      expect(await ma(await luu(tA, body()))).toEqual([503, "SUC_KHOE_CHUA_BAT_MA_HOA"]);
    } finally {
      process.env.HOA_DON_KHOA_BI_MAT = giu;
    }
    expect(await db.parentHealthRecord.count({ where: { parentUserId: ids.A } })).toBe(0);
  });

  it("[SKR-03] PUT→GET nguyên vẹn; bản lưu MÃ HOÁ; AAD buộc chủ tài khoản", async () => {
    const r = await luu(tA, body([nguoi(1), nguoi(2, { tenGoi: null, vaiTro: null, gt: "nam", hoatDong: "it", mt: true, benhNen: true })]));
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d).toMatchObject({ soNguoi: 2, soBan: 2, dongY: { phienBan: "2026-11-22.1", luc: "2026-11-22T01:00:00.000Z" }, luuTru: { phienBanDongY: "2026-11-22.1", thoiHanThang: 12 } });
    const g = (await json(await doc(tA))).data;
    expect(g.coDuLieu).toBe(true);
    expect(g.nguoi).toEqual([
      { idCucBo: ID(1), tenGoi: "Bé Sao Băng", vaiTro: "Con gái", ns: "2018-05-01", gt: "nu", hoatDong: "nhieu", mt: false, benhNen: false, ban: [{ ngay: "2026-11-01", cao: 123.5, nang: 24.3, eo: null }] },
      { idCucBo: ID(2), tenGoi: null, vaiTro: null, ns: "2018-05-01", gt: "nam", hoatDong: "it", mt: true, benhNen: true, ban: [{ ngay: "2026-11-01", cao: 123.5, nang: 24.3, eo: null }] },
    ]);
    expect(g.capNhatLuc).toBe(d.capNhatLuc);
    // hạn ≈ +12 tháng (hết ngày VN)
    const thang = (new Date(g.hetHanLuc).getTime() - Date.now()) / (30 * 86400_000);
    expect(thang).toBeGreaterThan(11.5);
    expect(thang).toBeLessThan(12.6);
    // bản lưu KHÔNG phải bản rõ
    const dong = await db.parentHealthRecord.findUniqueOrThrow({ where: { parentUserId: ids.A! }, select: { payloadMaHoa: true, consentVersion: true } });
    expect(dong.payloadMaHoa.startsWith("v1.")).toBe(true);
    for (const roRi of ["Sao Băng", "Con gái", "123.5", "24.3", "2018-05-01", "idCucBo"]) expect(dong.payloadMaHoa).not.toContain(roRi);
    expect(dong.consentVersion).toBe("2026-11-22.1");
    // AAD: chép chuỗi mã hoá của A sang dòng của B ⇒ B KHÔNG giải được (500 chung, không lộ gì)
    await db.parentHealthRecord.create({ data: { parentUserId: ids.B!, payloadMaHoa: dong.payloadMaHoa, consentVersion: "x", consentAt: new Date(), expiresAt: new Date(Date.now() + 86400_000) } });
    const bb = await doc(tB);
    expect(bb.status).toBe(500);
    expect(JSON.stringify(await json(bb))).not.toContain("Sao Băng");
    await db.parentHealthRecord.deleteMany({ where: { parentUserId: ids.B } });
  });

  it("[SKR-04] cô lập: phụ huynh khác không thấy dữ liệu; không có tham số chọn người", async () => {
    expect((await json(await doc(tB))).data).toMatchObject({ coDuLieu: false });
    const lienQuan = await docGet(new Request("http://localhost/x?parentUserId=" + ids.A + "&userId=" + ids.A, { method: "GET", headers: { authorization: bearer(tB), "x-forwarded-for": ip() } }));
    expect((await json(lienQuan)).data).toMatchObject({ coDuLieu: false });
    expect(await ma(await luu(tB, body([nguoi(1)], { parentUserId: ids.A })))).toEqual([400, "VALIDATION"]); // khoá lạ
    expect((await json(await doc(tA))).data.coDuLieu).toBe(true); // của A còn nguyên
    expect((await doc("sma_khong-co-that.x")).status).toBe(401);
  });

  it("[SKR-05] kiểm LẠI phía máy chủ ⇒ 400 và KHÔNG ghi đè bản đang có", async () => {
    const truoc = (await json(await doc(tA))).data.capNhatLuc;
    const xau: Array<[string, unknown]> = [
      ["ngày đo tương lai", body([nguoi(1, { ban: [{ ngay: "2999-01-01", cao: 120, nang: 25, eo: null }] })])],
      ["cao ngoài khoảng", body([nguoi(1, { ban: [{ ngay: "2026-11-01", cao: 5, nang: 25, eo: null }] })])],
      ["nặng ngoài khoảng", body([nguoi(1, { ban: [{ ngay: "2026-11-01", cao: 120, nang: 999, eo: null }] })])],
      ["ngày sinh tương lai", body([nguoi(1, { ns: "2999-01-01" })])],
      ["7 người", body(Array.from({ length: 7 }, (_, i) => nguoi(i + 1)))],
      ["4 bản", body([nguoi(1, { ban: Array.from({ length: 4 }, () => ({ ngay: "2026-11-01", cao: 120, nang: 25, eo: null })) })])],
      ["trùng idCucBo", body([nguoi(1), nguoi(2, { idCucBo: ID(1) })])],
      ["khoá lạ studentId", body([nguoi(1, { studentId: "x" })])],
      ["hoatDong sai", body([nguoi(1, { hoatDong: "cuc-nhieu" })])],
      ["thiếu dongY", { nguoi: [] }],
      ["phiên bản đồng ý cũ/bịa", { dongY: { phienBan: "1999-01-01.0", luc: "2026-11-22T01:00:00.000Z" }, nguoi: [] }],
    ];
    for (const [ten, b] of xau) expect(await ma(await luu(tA, b)), ten).toEqual([400, "VALIDATION"]);
    expect((await json(await doc(tA))).data.capNhatLuc).toBe(truoc);
    // Biên: ngày đo = hôm nay vẫn được, ngày mai thì không. «Hôm nay» là của MÁY CHỦ (`layHomNay`, theo TZ tiến trình: deploy đặt Asia/Ho_Chi_Minh, vitest ép UTC) ⇒
    // đóng băng như `suc-khoe.spec.ts`, không tự tính theo giờ VN từ đồng hồ thật — bản cũ gửi «hôm nay giờ VN» nên đỏ mọi lượt chạy trong 00:00–07:00 giờ VN.
    const luuNgayDo = (ngay: string) => luu(tA, body([nguoi(1, { ban: [{ ngay, cao: 120, nang: 25, eo: 60 }] })]));
    datHomNay("2026-11-22");
    try {
      expect(await ma(await luuNgayDo("2026-11-23"))).toEqual([400, "VALIDATION"]);
      expect((await luuNgayDo("2026-11-22")).status).toBe(200);
    } finally {
      datHomNay(null);
    }
  });

  it("[SKR-06] khoá lạc quan: lệch ⇒ 409; null khi đã có ⇒ 409; đúng ⇒ 200; vắng ⇒ ghi đè; song song cùng kỳ vọng ⇒ đúng một thắng", async () => {
    const g0 = (await json(await doc(tA))).data;
    expect(await ma(await luu(tA, body([nguoi(1)], { truocCapNhatLuc: "2020-01-01T00:00:00.000Z" })))).toEqual([409, "SUC_KHOE_DA_THAY_DOI"]);
    expect(await ma(await luu(tA, body([nguoi(1)], { truocCapNhatLuc: null })))).toEqual([409, "SUC_KHOE_DA_THAY_DOI"]);
    const ok = await luu(tA, body([nguoi(1, { tenGoi: "Lần hai" })], { truocCapNhatLuc: g0.capNhatLuc }));
    expect(ok.status).toBe(200);
    const g1 = (await json(await doc(tA))).data;
    expect(g1.nguoi[0].tenGoi).toBe("Lần hai");
    expect(new Date(g1.capNhatLuc).getTime()).toBeGreaterThan(new Date(g0.capNhatLuc).getTime());
    // vắng khoá ⇒ ghi đè (last-write-wins)
    expect((await luu(tA, body([nguoi(1, { tenGoi: "Ghi đè" })]))).status).toBe(200);
    // song song cùng kỳ vọng
    const g2 = (await json(await doc(tA))).data;
    const kq = await Promise.all([luu(tA, body([nguoi(1, { tenGoi: "P1" })], { truocCapNhatLuc: g2.capNhatLuc })), luu(tA, body([nguoi(1, { tenGoi: "P2" })], { truocCapNhatLuc: g2.capNhatLuc }))]);
    expect(kq.map((r) => r.status).sort()).toEqual([200, 409]);
    // chưa có dữ liệu + truocCapNhatLuc=null ⇒ 200
    expect((await json(await xoa(tA))).data.daXoa).toBe(true);
    expect((await luu(tA, body([nguoi(1)], { truocCapNhatLuc: null }))).status).toBe(200);
  });

  it("[SKR-07] hết hạn ⇒ coi như không có + xoá cứng; hàm dọn xoá bản hết hạn", async () => {
    await db.parentHealthRecord.update({ where: { parentUserId: ids.A! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const g = (await json(await doc(tA))).data;
    expect(g.coDuLieu).toBe(false);
    expect(await db.parentHealthRecord.count({ where: { parentUserId: ids.A } })).toBe(0);
    expect((await luu(tA, body())).status).toBe(200);
    await db.parentHealthRecord.update({ where: { parentUserId: ids.A! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await xoaSucKhoeHetHan(db as never, { now: new Date() })).toBeGreaterThanOrEqual(1);
    expect(await db.parentHealthRecord.count({ where: { parentUserId: ids.A } })).toBe(0);
    // hết hạn + truocCapNhatLuc=null ⇒ coi như chưa có ⇒ 200
    await luu(tA, body());
    await db.parentHealthRecord.update({ where: { parentUserId: ids.A! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await luu(tA, body([nguoi(1)], { truocCapNhatLuc: null }))).status).toBe(200);
  });

  it("[SKR-08] DELETE xoá cứng, idempotent; audit KHÔNG chứa nội dung", async () => {
    await luu(tA, body([nguoi(1, { tenGoi: "Tên Bí Mật Xyz", vaiTro: "Vai Bí Mật" })]));
    const d1 = await xoa(tA);
    expect(d1.status).toBe(200);
    expect((await json(d1)).data).toEqual({ daXoa: true });
    expect((await json(await xoa(tA))).data).toEqual({ daXoa: false });
    expect(await db.parentHealthRecord.count({ where: { parentUserId: ids.A } })).toBe(0);
    const audit = await db.auditLog.findMany({ where: { entityType: "ParentHealthRecord" }, select: { action: true, newValues: true } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["CREATE", "DELETE"]));
    const text = JSON.stringify(audit);
    for (const roRi of ["Tên Bí Mật", "Vai Bí Mật", "123.5", "Sao Băng", "2018-05-01"]) expect(text).not.toContain(roRi);
  });

  it("[SKR-09] thời hạn theo cấu hình + `luuTru` ở content", async () => {
    process.env.HEALTH_RETENTION_MONTHS = "3";
    try {
      const d = (await json(await luu(tA, body()))).data;
      expect(d.luuTru).toEqual({ phienBanDongY: "2026-11-22.1", thoiHanThang: 3 });
      const thang = (new Date(d.hetHanLuc).getTime() - Date.now()) / (30 * 86400_000);
      expect(thang).toBeGreaterThan(2.5);
      expect(thang).toBeLessThan(3.6);
      const c = (await json(await noiDungGet(req("GET", undefined, bearer(tA))))).data;
      expect(c.luuTru).toEqual({ phienBanDongY: "2026-11-22.1", thoiHanThang: 3 });
      process.env.HEALTH_RETENTION_MONTHS = "rac";
      expect((await json(await noiDungGet(req("GET", undefined, bearer(tA))))).data.luuTru.thoiHanThang).toBe(12);
    } finally {
      delete process.env.HEALTH_RETENTION_MONTHS;
    }
  });

  it("[SKR-10] xoá tài khoản ⇒ bản sức khoẻ xoá theo (cascade)", async () => {
    await luu(tB, body());
    expect(await db.parentHealthRecord.count({ where: { parentUserId: ids.B } })).toBe(1);
    await db.mobileSession.deleteMany({ where: { userId: ids.B } });
    await db.sitePolicyAcceptance.deleteMany({ where: { userId: ids.B } });
    await db.user.delete({ where: { id: ids.B! } });
    expect(await db.parentHealthRecord.count({ where: { parentUserId: ids.B } })).toBe(0);
  });

  it("[SKR-11] thân > 64 KB (Content-Length) ⇒ 413, không đọc thân", async () => {
    const r = await luuPut(new Request("http://localhost/x", { method: "PUT", headers: { authorization: bearer(tA), "content-type": "application/json", "x-forwarded-for": ip(), "content-length": String(70 * 1024) }, body: JSON.stringify(body()) }));
    expect(r.status).toBe(413);
  });

  it("[SKR-12] không log nội dung (console không thấy tên/số đo)", async () => {
    const goi: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { goi.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); }));
    try {
      await luu(tA, body([nguoi(1, { tenGoi: "Tên Không Được Log", vaiTro: "Vai Không Được Log" })]));
      await luu(tA, { nguoi: [{ idCucBo: ID(1), tenGoi: "Tên Không Được Log" }] }); // lỗi 400
      await doc(tA);
      await xoa(tA);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(goi.join("\n")).not.toContain("Không Được Log");
    expect(goi.join("\n")).not.toContain("123.5");
  });
});
