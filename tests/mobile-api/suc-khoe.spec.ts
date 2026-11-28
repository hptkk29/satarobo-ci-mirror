import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as noiDungGet } from "@/app/api/mobile/v1/parent/health/content/route";
import { POST as danhGiaPost } from "@/app/api/mobile/v1/parent/health/evaluate/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { THAN_TOI_DA_BYTE } from "@/lib/mobile-api/cong";
import { db } from "@/lib/db";
import { datHomNay } from "@/lib/suc-khoe/dong-co-goc";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [SKS] V8.23 — «Sức khoẻ cả nhà» / «Khảo sát thói quen» ở mức ROUTE-HANDLER + Postgres thật (chỉ nhận lệnh trong test — tác giả CHƯA chạy):
 *   [SKS-01] cờ SUC_KHOE_ENABLED tắt ⇒ 404 cho cả hai route (kể cả khi thân sai — không lộ 400)
 *   [SKS-02] cờ bật: không token ⇒ 401; token rác ⇒ 401
 *   [SKS-03] GET content ⇒ 200 no-store; bộ câu + khuôn; hai phụ huynh nhận cùng nội dung, KHÔNG chứa dữ liệu của ai
 *   [SKS-04] POST evaluate ⇒ 200 đúng kết quả tính tay; KHÔNG tạo dòng nào (đếm User · Student · AuditLog · MobileSession)
 *   [SKS-05] cách ly: phụ huynh B gửi số đo khác ⇒ chỉ thấy kết quả của chính mình; không có đường nào đọc lại số đo của A (không có lịch sử để rò)
 *   [SKS-06] đầu vào: trường lạ / ngoài khoảng / ngày tương lai / JSON hỏng ⇒ 400 VALIDATION, câu lỗi không chứa giá trị đã gửi; Content-Length quá trần ⇒ 413; thân thật quá trần ⇒ 413
 *   [SKS-07] chế độ học sinh ⇒ 403 cho cả hai route
 * ⚠️ «Phụ huynh nhà khác ⇒ 404» và «lịch sử theo thành viên» KHÔNG có chủ thể ở miền này (không studentId, không bảng) — xem SUC-KHOE-API-V823.md; [SKS-05] là phép kiểm tương đương duy nhất có nghĩa.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "skh-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string, them: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}), ...them },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; field?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const A = (k: string) => `${NS}${k}`;

const URL_CT = "/api/mobile/v1/parent/health/content";
const URL_DG = "/api/mobile/v1/parent/health/evaluate";
const nguoiHopLe = (o: Record<string, unknown> = {}) => ({
  ma: "ba",
  ngaySinh: "1990-01-01",
  gioiTinh: "nam",
  soDo: [{ ngay: "2026-11-01", chieuCaoCm: 170, canNangKg: 65 }],
  ...o,
});

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

async function dangNhap(sdt: string, maThietBi: string): Promise<string> {
  const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  const tok = ((await json(r)).data as { accessToken: string }).accessToken;
  await quyDinhDongY(req("POST", "/x", {}, bearer(tok)));
  return tok;
}

describe.skipIf(!RUN)("[SKS] sức khoẻ cả nhà — cổng route", () => {
  let tokA = "";
  let tokB = "";
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    delete process.env.SUC_KHOE_ENABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    datHomNay("2026-11-21"); // luật 19: đóng băng đồng hồ của miền (route chạy cùng tiến trình)
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const ua = await db.user.create({ data: { email: `${NS}A@seed.invalid`, name: "PH A", phone: "84966971001", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    const ub = await db.user.create({ data: { email: `${NS}B@seed.invalid`, name: "PH B", phone: "84966971002", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
    await db.student.create({ data: { id: A("sa"), name: "Bé A", parentUserId: ua.id } as never });
    await db.student.create({ data: { id: A("sb"), name: "Bé B", parentUserId: ub.id } as never });
    tokA = await dangNhap("0966971001", "00000000-0000-4000-9d00-000000001001");
    tokB = await dangNhap("0966971002", "00000000-0000-4000-9d00-000000001002");
  }, 120_000);
  afterAll(async () => {
    await don();
    delete process.env.SUC_KHOE_ENABLED;
    datHomNay(null);
  }, 120_000);

  it("[SKS-01] cờ tắt ⇒ 404 NOT_FOUND cho cả hai route, kể cả khi không token hoặc thân sai", async () => {
    delete process.env.SUC_KHOE_ENABLED;
    for (const r of [
      await noiDungGet(req("GET", URL_CT, undefined, bearer(tokA))),
      await noiDungGet(req("GET", URL_CT)),
      await danhGiaPost(req("POST", URL_DG, { nguoi: [nguoiHopLe()] }, bearer(tokA))),
      await danhGiaPost(req("POST", URL_DG, "không phải json", bearer(tokA))),
      await danhGiaPost(req("POST", URL_DG, { nguoi: "sai" })),
    ]) {
      expect([r.status, (await json(r)).error?.code]).toEqual([404, "NOT_FOUND"]);
    }
  });

  it("[SKS-02] cờ bật: không token / token rác ⇒ 401", async () => {
    process.env.SUC_KHOE_ENABLED = "true";
    expect((await noiDungGet(req("GET", URL_CT))).status).toBe(401);
    expect((await danhGiaPost(req("POST", URL_DG, { nguoi: [nguoiHopLe()] }))).status).toBe(401);
    expect((await noiDungGet(req("GET", URL_CT, undefined, bearer("rac.rac.rac")))).status).toBe(401);
    expect((await danhGiaPost(req("POST", URL_DG, { nguoi: [nguoiHopLe()] }, bearer("rac.rac.rac")))).status).toBe(401);
  });

  it("[SKS-03] GET content ⇒ 200 no-store; hai phụ huynh nhận cùng nội dung tham chiếu", async () => {
    process.env.SUC_KHOE_ENABLED = "true";
    const a = await noiDungGet(req("GET", URL_CT, undefined, bearer(tokA)));
    expect(a.status).toBe(200);
    expect(a.headers.get("cache-control")).toBe("no-store");
    const da = (await json(a)).data;
    expect(da.khaoSat.tre.length).toBeGreaterThan(0);
    expect(da.khaoSat.nguoiLon.length).toBeGreaterThan(0);
    expect(Object.keys(da.khuon).sort()).toEqual(["dac-biet", "nl-binh-thuong", "nl-can-chu-y", "nl-nhe-can", "tre", "tre-nho"]);
    expect(da.gioiHan).toEqual({ toiDaNguoi: 6, toiDaBanMoiNguoi: 3, soCauThuThach: 3 });
    const db_ = (await json(await noiDungGet(req("GET", URL_CT, undefined, bearer(tokB))))).data;
    expect(db_).toEqual(da);
  });

  it("[SKS-04] POST evaluate ⇒ 200 đúng kết quả; không tạo dòng nào", async () => {
    process.env.SUC_KHOE_ENABLED = "true";
    const dem0 = async () => [await db.user.count(), await db.student.count(), await db.auditLog.count(), await db.mobileSession.count()];
    const truoc = await dem0();
    const r = await danhGiaPost(req("POST", URL_DG, { nguoi: [nguoiHopLe()] }, bearer(tokA)));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const k = (await json(r)).data.nguoi[0];
    // 36 tuổi, BMI 65 / 1,7² = 22,5 (< 23 ⇒ bình thường châu Á), BMR 1537,5 × 1,55 = 2383 ⇒ 2380 kcal
    expect(k).toMatchObject({ ma: "ba", khuon: "nl-binh-thuong", nangLuongUocTinhKcal: 2380, phanLoaiBmi: { ma: "ok" }, tuoi: { nhom: "nl", laTreEm: false } });
    expect(k.soDo[0].bmi).toBe(22.5);
    expect(await dem0()).toEqual(truoc);
  });

  it("[SKS-05] cách ly: số đo của A không xuất hiện ở phản hồi của B và không có đường đọc lại", async () => {
    process.env.SUC_KHOE_ENABLED = "true";
    const dauA = 171.37; // giá trị đặc trưng
    await danhGiaPost(req("POST", URL_DG, { nguoi: [nguoiHopLe({ ma: "a-only", soDo: [{ ngay: "2026-11-01", chieuCaoCm: dauA, canNangKg: 66 }] })] }, bearer(tokA)));
    const rb = await danhGiaPost(req("POST", URL_DG, { nguoi: [nguoiHopLe({ ma: "b-only", gioiTinh: "nu" })] }, bearer(tokB)));
    const txt = JSON.stringify(await json(rb));
    expect(txt).toContain("b-only");
    expect(txt).not.toContain("a-only");
    expect(txt).not.toContain(String(dauA));
    // GET/PUT/DELETE trên các đường này không tồn tại ngoài phương thức đã khai ⇒ không có cách đọc lại số đo đã gửi
    const modun: Record<string, unknown> = await import("@/app/api/mobile/v1/parent/health/evaluate/route");
    expect(Object.keys(modun).filter((k) => ["GET", "PUT", "PATCH", "DELETE"].includes(k))).toEqual([]);
  });

  it("[SKS-06] đầu vào sai ⇒ 400 VALIDATION không lộ giá trị; Content-Length / thân quá trần ⇒ 413", async () => {
    process.env.SUC_KHOE_ENABLED = "true";
    const ten = "Nguyen Bao An 0966971001";
    for (const [than, truong] of [
      [{ nguoi: [nguoiHopLe({ ten })] }, undefined],
      [{ nguoi: [nguoiHopLe({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: 999.123, canNangKg: 65 }] })] }, "nguoi.0.soDo.0.chieuCaoCm"],
      [{ nguoi: [nguoiHopLe({ soDo: [{ ngay: "2026-11-22", chieuCaoCm: 170, canNangKg: 65 }] })] }, "nguoi.0.soDo.0.ngay"],
      [{ nguoi: [nguoiHopLe({ ngaySinh: "2026-11-22" })] }, "nguoi.0.ngaySinh"],
      [{ nguoi: [] }, undefined],
      [{ nguoi: Array.from({ length: 7 }, (_, i) => nguoiHopLe({ ma: `n${i}` })) }, undefined],
      [{ nguoi: [nguoiHopLe({ soDo: [] })] }, undefined],
      [{}, undefined],
    ] as const) {
      const r = await danhGiaPost(req("POST", URL_DG, than, bearer(tokA)));
      const j = await json(r);
      expect([r.status, j.error?.code], JSON.stringify(than).slice(0, 80)).toEqual([400, "VALIDATION"]);
      if (truong) expect(j.error?.field).toBe(truong);
      const txt = JSON.stringify(j);
      for (const lo of [ten, "999.123", "0966971001"]) expect(txt).not.toContain(lo);
    }
    expect((await danhGiaPost(req("POST", URL_DG, "{hỏng", bearer(tokA)))).status).toBe(400);
    // 413 TRƯỚC xác thực nếu khai Content-Length
    const khai = { "content-length": String(THAN_TOI_DA_BYTE + 1) };
    expect((await danhGiaPost(req("POST", URL_DG, "{}", undefined, khai))).status).toBe(413);
    // thân thật quá trần (đã đăng nhập) ⇒ 413
    const lon = JSON.stringify({ nguoi: [nguoiHopLe()], pad: "x".repeat(THAN_TOI_DA_BYTE + 10) });
    expect((await danhGiaPost(req("POST", URL_DG, lon, bearer(tokA)))).status).toBe(413);
  });

  it("[SKS-07] chế độ học sinh ⇒ 403 cho cả hai route", async () => {
    process.env.SUC_KHOE_ENABLED = "true";
    expect((await codePost(req("POST", "/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, bearer(tokA)))).status).toBe(200);
    expect((await enterPost(req("POST", "/api/mobile/v1/student-mode/enter", { studentId: A("sa") }, bearer(tokA)))).status).toBe(200);
    for (const r of [await noiDungGet(req("GET", URL_CT, undefined, bearer(tokA))), await danhGiaPost(req("POST", URL_DG, { nguoi: [nguoiHopLe()] }, bearer(tokA)))]) {
      expect([r.status, (await json(r)).error?.code]).toEqual([403, "FORBIDDEN"]);
    }
    // đối chứng dương: phụ huynh B (không ở chế độ học sinh) vẫn dùng được
    expect((await noiDungGet(req("GET", URL_CT, undefined, bearer(tokB)))).status).toBe(200);
  });
});
