// @vitest-environment node
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web: chặn `@/lib/auth` để mọi đường lỡ gọi `auth()` thật sẽ đỏ.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { GET as xemYeuCau, POST as guiYeuCau } from "@/app/api/mobile/v1/account/deletion-request/route";
import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as meRoute } from "@/app/api/mobile/v1/auth/me/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { db } from "@/lib/db";
import { maHienThiYeuCau, nhanTiepNhan } from "@/lib/mobile-api/dich-vu/yeu-cau-xoa-tai-khoan";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [YCX] YÊU CẦU XOÁ TÀI KHOẢN trên app (W-CONTRACT CRITICAL-1) — Postgres thật, gọi thẳng route handler. CHỈ GHI NHẬN: không xoá/ẩn danh/thu hồi phiên.
 *   [YCX-01] mật khẩu SAI ⇒ 400 PASSWORD_INCORRECT, không có dòng; ĐÚNG ⇒ 200 {maYeuCau, tiepNhanLuc}; dòng RECEIVED; kiểm toán KHÔNG chứa mật khẩu/lý do; phiên + tài khoản KHÔNG đổi
 *   [YCX-02] gửi lại khi còn yêu cầu mở ⇒ cùng mã, `daCoTruocDo:true`, vẫn MỘT dòng — kể cả hai yêu cầu ĐỒNG THỜI
 *   [YCX-03] GET: chưa có ⇒ null; có ⇒ đúng yêu cầu; người khác không thấy (IDOR); yêu cầu đã đóng không tính là «đang mở» và gửi mới tạo dòng mới
 *   [YCX-04] giới hạn nhập mật khẩu 5 lần/15 phút theo người dùng (cửa thử mật khẩu ngoài đăng nhập) ⇒ lần 6 ⇒ 429 + Retry-After; người dùng khác không bị ảnh hưởng
 *   [YCX-05] đầu vào/ngữ cảnh: thiếu mật khẩu · lý do > 500 ⇒ 400; chưa đăng nhập ⇒ 401; phiên Ở CHẾ ĐỘ HỌC SINH ⇒ 403 (con không gửi được); cờ tắt ⇒ 404
 *   [YCX-06] lý do: rỗng/khoảng trắng ⇒ lưu NULL; có chữ ⇒ lưu đã cắt khoảng trắng; nhãn giờ theo giờ VN
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "ycx-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.95.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string; maChiTiet?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const URL_YC = "/api/mobile/v1/account/deletion-request";

describe.skipIf(!RUN)("[YCX] yêu cầu xoá tài khoản trên app — Postgres thật", () => {
  const ids: Record<string, string> = {};
  const tok: Record<string, string> = {};
  const gui = (k: string, body: unknown) => guiYeuCau(req("POST", URL_YC, body, bearer(tok[k]!)));
  const xem = (k: string) => xemYeuCau(req("GET", URL_YC, undefined, bearer(tok[k]!)));
  const so = (k: string) => db.accountDeletionRequest.count({ where: { userId: ids[k]! } });

  async function don() {
    const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
    const uids = us.map((u) => u.id);
    await db.accountDeletionRequest.deleteMany({ where: { userId: { in: uids } } });
    await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
    await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
    await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
    await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: uids } }, { actorId: { in: uids } }] } });
    await db.student.deleteMany({ where: { OR: [{ id: { startsWith: NS } }, { parentUserId: { in: uids } }] } });
    await db.authAttemptCounter.deleteMany({});
    await db.user.deleteMany({ where: { id: { in: uids } } });
  }

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id);
    const SDT: Record<string, string> = { a: "84966990001", b: "84966990002", c: "84966990003", d: "84966990004", e: "84966990005", f: "84966990006" };
    for (const k of Object.keys(SDT)) await mk(k, SDT[k]!);
    let n = 0;
    for (const k of Object.keys(SDT)) {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: `0${SDT[k]!.slice(2)}`, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-a100-${String(++n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      tok[k] = ((await json(r)).data as { accessToken: string }).accessToken;
      await quyDinhDongY(req("POST", "/x", {}, bearer(tok[k]!)));
    }
  }, 90_000);
  afterAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    await don();
  }, 60_000);

  it("[YCX-01] sai mật khẩu ⇒ 400 PASSWORD_INCORRECT, không có dòng; đúng ⇒ 200; kiểm toán sạch; phiên + tài khoản không đổi", async () => {
    const sai = await gui("a", { matKhau: "Sai-mat-khau-1", lyDo: "Không dùng nữa" });
    expect([sai.status, (await json(sai)).error?.code]).toEqual([400, "PASSWORD_INCORRECT"]);
    expect(await so("a")).toBe(0);

    const truoc = await db.user.findUniqueOrThrow({ where: { id: ids.a! }, select: { password: true, tokenVersion: true, isActive: true, accountStatus: true, deletedAt: true, name: true } });
    const r = await gui("a", { matKhau: MK, lyDo: "Bé đã chuyển trường, xin xoá tài khoản" });
    expect(r.status).toBe(200);
    const b = (await json(r)).data as { maYeuCau: string; tiepNhanLuc: string; daCoTruocDo: boolean };
    expect(b.maYeuCau).toMatch(/^XTK-[0-9A-Z]{8}$/);
    expect(b.tiepNhanLuc).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
    expect(b.daCoTruocDo).toBe(false);
    const dong = await db.accountDeletionRequest.findFirstOrThrow({ where: { userId: ids.a! } });
    expect([dong.status, dong.nguon, dong.lyDo, dong.handledAt]).toEqual(["RECEIVED", "MOBILE_APP", "Bé đã chuyển trường, xin xoá tài khoản", null]);
    expect(maHienThiYeuCau(dong.id)).toBe(b.maYeuCau);

    // CHỈ GHI NHẬN: không xoá/ẩn danh/khoá, không thu hồi phiên
    const sau = await db.user.findUniqueOrThrow({ where: { id: ids.a! }, select: { password: true, tokenVersion: true, isActive: true, accountStatus: true, deletedAt: true, name: true } });
    expect(sau).toEqual(truoc);
    expect((await meRoute(req("GET", "/api/mobile/v1/auth/me", undefined, bearer(tok.a!)))).status).toBe(200);
    expect(await db.mobileSession.count({ where: { userId: ids.a!, thuHoiLuc: null } })).toBe(1);

    // kiểm toán: có dòng, KHÔNG chứa mật khẩu và KHÔNG chứa nội dung lý do
    const kt = await db.auditLog.findMany({ where: { entityId: ids.a!, action: "mobile.account_deletion_requested" } });
    expect(kt).toHaveLength(1);
    const tho = JSON.stringify(kt[0]);
    expect(tho).not.toContain(MK);
    expect(tho).not.toContain("Sai-mat-khau-1");
    expect(tho).not.toContain("chuyển trường");
    expect(tho).toContain("coLyDo");
  }, 60_000);

  it("[YCX-02] gửi lại ⇒ cùng mã, daCoTruocDo:true, một dòng — kể cả hai yêu cầu ĐỒNG THỜI", async () => {
    const r1 = await json(await gui("b", { matKhau: MK }));
    const r2 = await json(await gui("b", { matKhau: MK }));
    expect(r2.data.maYeuCau).toBe(r1.data.maYeuCau);
    expect([r1.data.daCoTruocDo, r2.data.daCoTruocDo]).toEqual([false, true]);
    expect(await so("b")).toBe(1);

    const song = await Promise.all([gui("c", { matKhau: MK }), gui("c", { matKhau: MK })]);
    const ma = await Promise.all(song.map(async (r) => (await json(r)).data?.maYeuCau));
    expect(song.map((r) => r.status)).toEqual([200, 200]);
    expect(ma[0]).toBe(ma[1]);
    expect(await so("c")).toBe(1);
  }, 60_000);

  it("[YCX-03] GET: null → đúng yêu cầu; người khác không thấy; yêu cầu đã đóng không còn «đang mở»", async () => {
    expect((await json(await xem("d"))).data).toBeNull();
    const g = (await json(await gui("d", { matKhau: MK }))).data as { maYeuCau: string; tiepNhanLuc: string };
    const x = (await json(await xem("d"))).data as { maYeuCau: string; tiepNhanLuc: string };
    expect(x).toEqual({ maYeuCau: g.maYeuCau, tiepNhanLuc: g.tiepNhanLuc });
    expect((await json(await xem("e"))).data).toBeNull(); // IDOR: người khác không thấy yêu cầu của d
    // pháp chế đóng yêu cầu ⇒ không còn «đang mở»; gửi mới ⇒ dòng mới
    await db.accountDeletionRequest.updateMany({ where: { userId: ids.d! }, data: { status: "REJECTED", handledAt: new Date() } });
    expect((await json(await xem("d"))).data).toBeNull();
    const moi = (await json(await gui("d", { matKhau: MK }))).data as { maYeuCau: string; daCoTruocDo: boolean };
    expect(moi.daCoTruocDo).toBe(false);
    expect(moi.maYeuCau).not.toBe(g.maYeuCau);
    expect(await so("d")).toBe(2);
  }, 60_000);

  it("[YCX-04] 5 lần nhập mật khẩu/15 phút theo người dùng ⇒ lần 6 ⇒ 429 + Retry-After; người dùng khác không bị ảnh hưởng", async () => {
    const kq: number[] = [];
    let thuLai: string | null = null;
    for (let i = 0; i < 6; i++) {
      const r = await gui("f", { matKhau: `Sai-lan-${i}-xxxx` });
      kq.push(r.status);
      if (r.status === 429) thuLai = r.headers.get("retry-after");
    }
    expect(kq).toEqual([400, 400, 400, 400, 400, 429]);
    expect(Number(thuLai)).toBeGreaterThan(0);
    expect((await gui("f", { matKhau: MK })).status).toBe(429); // đúng mật khẩu cũng bị chặn khi đã chạm trần (cùng khoá đếm)
    expect(await so("f")).toBe(0);
    expect((await gui("e", { matKhau: MK })).status).toBe(200); // người khác không liên quan
  }, 60_000);

  it("[YCX-05] thiếu mật khẩu / lý do dài ⇒ 400; chưa đăng nhập ⇒ 401; chế độ học sinh ⇒ 403; cờ tắt ⇒ 404", async () => {
    const xet = async (r: Response) => [r.status, (await json(r)).error?.code];
    expect(await xet(await guiYeuCau(req("POST", URL_YC, {}, bearer(tok.e!))))).toEqual([400, "VALIDATION"]);
    expect(await xet(await gui("e", { matKhau: MK, lyDo: "x".repeat(501) }))).toEqual([400, "VALIDATION"]);
    expect((await guiYeuCau(req("POST", URL_YC, { matKhau: MK }))).status).toBe(401);
    expect((await xemYeuCau(req("GET", URL_YC))).status).toBe(401);

    // phiên ở chế độ học sinh (con): route KHÔNG nằm trong danh sách cho phép ⇒ 403, không có dòng nào
    const s = await db.student.create({ data: { id: `${NS}hs`, name: "Bé E", parentUserId: ids.e! } as never, select: { id: true } });
    await db.mobileSession.updateMany({ where: { userId: ids.e!, thuHoiLuc: null }, data: { hocSinhId: s.id, hocSinhTuLuc: new Date() } });
    const truoc = await so("e");
    const hs = await gui("e", { matKhau: MK });
    expect(hs.status).toBe(403);
    expect((await xem("e")).status).toBe(403);
    expect(await so("e")).toBe(truoc);
    await db.mobileSession.updateMany({ where: { userId: ids.e!, thuHoiLuc: null }, data: { hocSinhId: null, hocSinhTuLuc: null } });

    process.env.MOBILE_API_ENABLED = "false";
    try {
      expect((await gui("e", { matKhau: MK })).status).toBe(404);
      expect((await xem("e")).status).toBe(404);
    } finally {
      process.env.MOBILE_API_ENABLED = "true";
    }
  }, 60_000);

  it("[YCX-06] lý do rỗng ⇒ NULL, có chữ ⇒ lưu đã cắt khoảng trắng; nhãn giờ theo giờ VN", async () => {
    await db.accountDeletionRequest.deleteMany({ where: { userId: ids.e! } });
    expect((await gui("e", { matKhau: MK, lyDo: "   " })).status).toBe(200);
    expect((await db.accountDeletionRequest.findFirstOrThrow({ where: { userId: ids.e! } })).lyDo).toBeNull();
    await db.accountDeletionRequest.deleteMany({ where: { userId: ids.e! } });
    expect((await gui("e", { matKhau: MK, lyDo: "  hết nhu cầu  " })).status).toBe(200);
    expect((await db.accountDeletionRequest.findFirstOrThrow({ where: { userId: ids.e! } })).lyDo).toBe("hết nhu cầu");
    // 18:05Z ngày 24 ⇒ 01:05 ngày 25 ở Việt Nam (đổi ngày!)
    expect(nhanTiepNhan(new Date("2026-11-24T18:05:00Z"))).toBe("01:05 25/11/2026");
  }, 60_000);
});
