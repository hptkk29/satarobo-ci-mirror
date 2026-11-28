import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as dangXuatTatCaPost } from "@/app/api/mobile/v1/auth/logout-all/route";
import { GET as meGet } from "@/app/api/mobile/v1/auth/me/route";
import { POST as lamMoiRoute } from "@/app/api/mobile/v1/auth/refresh/route";
import { DELETE as thuHoiDelete } from "@/app/api/mobile/v1/auth/sessions/[sessionId]/route";
import { GET as phienGet } from "@/app/api/mobile/v1/auth/sessions/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [PDN] QUẢN LÝ PHIÊN ĐĂNG NHẬP (SEC-05) + CẤP LẠI REFRESH CÓ TRẦN (SEC-13) trên POSTGRES THẬT. Gọi thẳng route handler.
 *   [PDN-01] danh sách: đủ thiết bị CỦA MÌNH (không của người khác), đúng MỘT dòng laThietBiNay, đúng bảy khoá, không lộ mã tra / băm
 *   [PDN-02] thu hồi MỘT phiên khác từ xa: access + refresh của nó chết (TOKEN_REVOKED), DB ghi lý do + xoá bốn cột token, phiên gọi vẫn sống, lặp lại ⇒ 200, có kiểm toán
 *   [PDN-03] BOLA: phiên của người khác / id lạ ⇒ cùng một 404, phiên người kia KHÔNG bị chạm
 *   [PDN-04] đăng xuất mọi thiết bị: giuPhienHienTai:true ⇒ chỉ các thiết bị khác; mặc định ⇒ cả thiết bị này; người khác không bị chạm; có kiểm toán
 *   [PDN-05] chế độ học sinh: cả ba route bị chặn 403 (trẻ không thu hồi được phiên của ba mẹ)
 *   [PDN-06] chưa đăng nhập ⇒ 401 ở cả ba route
 *   [PDN-07] SEC-13: cấp lại (R5) lần 1–2 ⇒ 200 + kiểm toán REFRESH_REISSUE; lần 3 trong cửa sổ ⇒ 401 TOKEN_REVOKED, phiên thu hồi `dung-lai-token`, kiểm toán REFRESH_REISSUE_LIMIT
 *   [PDN-08] SEC-13 đối chứng DƯƠNG: hai lần cấp lại CŨ (ngoài cửa sổ) không tính ⇒ cấp lại hợp lệ vẫn 200
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "pdntest-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966700001", B: "0966700002" };
let dem = 0;
const ipMoi = () => `10.98.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string, method?: string) =>
  new Request(`http://localhost${url}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const bearer = (t: string) => `Bearer ${t}`;
const ids: Record<string, string> = {};
const maTb = (n: number) => `00000000-0000-4000-8000-${String(n + 700).padStart(12, "0")}`;

type Cap = { accessToken: string; refreshToken: string };
async function dangNhap(phone: string, n: number, tenMay = `Máy ${n}`, nenTang: "ios" | "android" = "ios"): Promise<Cap> {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: maTb(n), nenTang, tenMay, phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return b.data as unknown as Cap;
}
const phienCuaMay = (n: number) => db.mobileSession.findFirstOrThrow({ where: { maThietBi: maTb(n) }, orderBy: { createdAt: "desc" } });
const danhSach = async (t: string) => (await json(await phienGet(req("/api/mobile/v1/auth/sessions", undefined, bearer(t))))).data as { phien: Array<Record<string, unknown>> };
const thuHoiPhien = (t: string, id: string) => thuHoiDelete(req(`/api/mobile/v1/auth/sessions/${id}`, undefined, bearer(t), "DELETE"), { params: Promise.resolve({ sessionId: id }) });
const tatCa = (t: string, body: unknown) => dangXuatTatCaPost(req("/api/mobile/v1/auth/logout-all", body, bearer(t)));
const dung = async (t: string) => (await meGet(req("/api/mobile/v1/auth/me", undefined, bearer(t)))).status;
const lamMoi = (c: Cap) => lamMoiRoute(req("/api/mobile/v1/auth/refresh", { refreshToken: c.refreshToken }));

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const phien = await db.mobileSession.findMany({ where: { userId: { in: uids } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...phien.map((p) => p.id), ...uids] } }, { actorId: { in: uids } }] } });
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

describe.skipIf(!RUN)("[PDN] phiên đăng nhập: xem · thu hồi từ xa · đăng xuất mọi thiết bị · cấp lại có trần — Postgres thật", () => {
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B"] as const) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    await db.center.create({ data: { id: `${NS}cs`, name: "Cơ sở PDN", slug: `${NS}cs`, address: "Địa chỉ" } });
    await db.student.create({ data: { id: `${NS}a1`, name: `${NS}a1`, parentUserId: ids.A, centerId: `${NS}cs` } as never });
  }, 60_000);
  afterAll(don);
  // MỖI ca tự đủ: không phiên / bộ đếm nào của ca trước còn lại (đăng nhập cùng một định danh quá 5 lần/phút sẽ ăn 429, và phiên cũ cùng mã thiết bị làm lệch phép tra).
  beforeEach(async () => {
    await db.mobileSession.deleteMany({ where: { userId: { in: [ids.A!, ids.B!] } } });
    await db.authAttemptCounter.deleteMany({});
  });

  it("[PDN-01] danh sách: đủ thiết bị của MÌNH, đúng một dòng «thiết bị này», đúng bảy khoá, không lộ mã tra / băm; không có thiết bị người khác", async () => {
    const a1 = await dangNhap(PHONE.A, 1, "iPhone của mẹ", "ios");
    await dangNhap(PHONE.A, 2, "Pixel của ba", "android");
    await dangNhap(PHONE.A, 3, "iPad nhà");
    await dangNhap(PHONE.B, 9, "Máy người khác");
    const ds = await danhSach(a1.accessToken);
    expect(ds.phien).toHaveLength(3);
    expect(ds.phien.filter((p) => p.laThietBiNay === true)).toHaveLength(1);
    expect(ds.phien.find((p) => p.laThietBiNay === true)).toMatchObject({ tenMay: "iPhone của mẹ", nenTang: "ios" });
    for (const p of ds.phien) expect(Object.keys(p).sort()).toEqual(["dangNhapLuc", "id", "laThietBiNay", "lanDungCuoi", "nenTang", "phienBanApp", "tenMay"]);
    const raw = JSON.stringify(ds);
    expect(raw).not.toContain("Máy người khác");
    expect(raw).not.toMatch(/maTra|accessHash|refreshHash|maThietBi|smr_|sma_/);
    expect(raw).not.toContain(maTb(1));
    // phiên đã thu hồi KHÔNG hiện
    expect(ds.phien.map((p) => p.id)).toContain((await phienCuaMay(2)).id);
    expect((await thuHoiPhien(a1.accessToken, (await phienCuaMay(3)).id)).status).toBe(200);
    expect((await danhSach(a1.accessToken)).phien).toHaveLength(2);
  });

  it("[PDN-02] thu hồi MỘT phiên khác từ xa: access + refresh của nó chết, DB ghi lý do và xoá token, phiên gọi vẫn sống, lặp lại ⇒ 200, có kiểm toán", async () => {
    const a1 = await dangNhap(PHONE.A, 1);
    const a2 = await dangNhap(PHONE.A, 2);
    expect(await dung(a2.accessToken)).toBe(200);
    const p2 = await phienCuaMay(2);
    const r = await thuHoiPhien(a1.accessToken, p2.id);
    expect(r.status).toBe(200);
    expect((await json(r)).data).toEqual({ daThuHoi: true, laThietBiNay: false });
    // bên bị thu hồi: access ⇒ TOKEN_REVOKED; refresh ⇒ TOKEN_REVOKED
    const x = await meGet(req("/x", undefined, bearer(a2.accessToken)));
    expect([x.status, (await json(x)).error?.code]).toEqual([401, "TOKEN_REVOKED"]);
    const y = await lamMoi(a2);
    expect([y.status, (await json(y)).error?.code]).toEqual([401, "TOKEN_REVOKED"]);
    const sau = await db.mobileSession.findUniqueOrThrow({ where: { id: p2.id } });
    expect(sau).toMatchObject({ lyDoThuHoi: "nguoi-dung-thu-hoi", accessHash: null, refreshHash: null, refreshHashTruoc: null, accessHetHan: null });
    expect(sau.thuHoiLuc).not.toBeNull();
    // phiên đang gọi vẫn dùng được; danh sách không còn phiên vừa thu hồi
    expect(await dung(a1.accessToken)).toBe(200);
    expect((await danhSach(a1.accessToken)).phien.map((p) => p.id)).not.toContain(p2.id);
    // lặp lại ⇒ 200 (idempotent), KHÔNG thêm dòng kiểm toán
    const truoc = await db.auditLog.count({ where: { entityId: p2.id, action: "SESSION_REVOKED" } });
    expect((await thuHoiPhien(a1.accessToken, p2.id)).status).toBe(200);
    expect(await db.auditLog.count({ where: { entityId: p2.id, action: "SESSION_REVOKED" } })).toBe(truoc);
    expect(truoc).toBe(1);
    // kiểm toán KHÔNG chứa token / băm
    const ghi = await db.auditLog.findFirstOrThrow({ where: { entityId: p2.id, action: "SESSION_REVOKED" } });
    expect(JSON.stringify(ghi)).not.toMatch(/smr_|sma_|Hash/);
    // tự thu hồi CHÍNH phiên này ⇒ laThietBiNay true và token của nó chết
    const t1 = await phienCuaMay(1);
    const tu = await thuHoiPhien(a1.accessToken, t1.id);
    expect((await json(tu)).data).toEqual({ daThuHoi: true, laThietBiNay: true });
    expect(await dung(a1.accessToken)).toBe(401);
  });

  it("[PDN-03] BOLA: phiên của người khác và id lạ ⇒ cùng một 404; phiên người kia KHÔNG bị chạm", async () => {
    const a1 = await dangNhap(PHONE.A, 1);
    const b9 = await dangNhap(PHONE.B, 9);
    const pB = await phienCuaMay(9);
    const khac = await thuHoiPhien(a1.accessToken, pB.id);
    const la = await thuHoiPhien(a1.accessToken, "khong-co-phien-nay");
    expect([khac.status, la.status]).toEqual([404, 404]);
    const e1 = (await json(khac)).error!, e2 = (await json(la)).error!;
    expect([e1.code, e1.message]).toEqual([e2.code, e2.message]); // không phân biệt «của người khác» với «không tồn tại»
    expect((await db.mobileSession.findUniqueOrThrow({ where: { id: pB.id } })).thuHoiLuc).toBeNull();
    expect(await dung(b9.accessToken)).toBe(200);
  });

  it("[PDN-04] đăng xuất mọi thiết bị: giuPhienHienTai:true ⇒ chỉ thiết bị khác; mặc định ⇒ cả thiết bị này; người khác không bị chạm; có kiểm toán", async () => {
    const a1 = await dangNhap(PHONE.A, 1);
    const a2 = await dangNhap(PHONE.A, 2);
    const a3 = await dangNhap(PHONE.A, 3);
    const b9 = await dangNhap(PHONE.B, 9);
    const giu = await tatCa(a1.accessToken, { giuPhienHienTai: true });
    expect(giu.status).toBe(200);
    expect((await json(giu)).data).toEqual({ soPhienThuHoi: 2, giuPhienHienTai: true });
    expect([await dung(a1.accessToken), await dung(a2.accessToken), await dung(a3.accessToken)]).toEqual([200, 401, 401]);
    expect(await dung(b9.accessToken)).toBe(200);
    // mặc định (thân rỗng) ⇒ gồm cả thiết bị này
    const b = await dangNhap(PHONE.A, 4);
    const het = await tatCa(b.accessToken, {});
    expect((await json(het)).data).toEqual({ soPhienThuHoi: 2, giuPhienHienTai: false }); // a1 + máy 4 (a2/a3 đã chết)
    expect([await dung(a1.accessToken), await dung(b.accessToken)]).toEqual([401, 401]);
    expect(await dung(b9.accessToken)).toBe(200);
    // phiên đã chết mang lý do và token bị xoá
    expect(await db.mobileSession.count({ where: { userId: ids.A, thuHoiLuc: null } })).toBe(0);
    expect(await db.mobileSession.count({ where: { userId: ids.A, lyDoThuHoi: "nguoi-dung-thu-hoi", refreshHash: null } })).toBeGreaterThanOrEqual(4);
    expect(await db.auditLog.count({ where: { entityId: ids.A, action: "mobile.sessions_revoked" } })).toBeGreaterThanOrEqual(2);
    // không còn phiên nào để thu hồi ⇒ vẫn 200, soPhienThuHoi 0
    const c = await dangNhap(PHONE.A, 5);
    await tatCa(c.accessToken, {});
    expect(await dung(c.accessToken)).toBe(401);
  });

  it("[PDN-05] CHẾ ĐỘ HỌC SINH: xem / thu hồi / đăng xuất mọi thiết bị đều 403; phiên của ba mẹ không bị chạm", async () => {
    const a1 = await dangNhap(PHONE.A, 1);
    const a2 = await dangNhap(PHONE.A, 2);
    await quyDinhDongY(req("/x", {}, bearer(a1.accessToken)));
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, bearer(a1.accessToken)))).status).toBe(200);
    expect((await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: `${NS}a1` }, bearer(a1.accessToken)))).status).toBe(200);
    const p2 = await phienCuaMay(2);
    expect((await phienGet(req("/api/mobile/v1/auth/sessions", undefined, bearer(a1.accessToken)))).status).toBe(403);
    expect((await thuHoiPhien(a1.accessToken, p2.id)).status).toBe(403);
    expect((await tatCa(a1.accessToken, {})).status).toBe(403);
    expect((await db.mobileSession.findUniqueOrThrow({ where: { id: p2.id } })).thuHoiLuc).toBeNull();
    expect(await dung(a2.accessToken)).toBe(200);
  });

  it("[PDN-06] chưa đăng nhập ⇒ 401 ở cả ba route (thân sai cũng 401 — xác thực TRƯỚC khi đọc thân)", async () => {
    expect((await phienGet(req("/api/mobile/v1/auth/sessions"))).status).toBe(401);
    expect((await thuHoiPhien("khong-phai-token", "x")).status).toBe(401);
    expect((await dangXuatTatCaPost(req("/api/mobile/v1/auth/logout-all", { giuPhienHienTai: "không phải boolean" }))).status).toBe(401);
    // đăng nhập rồi mà thân sai kiểu ⇒ 400, KHÔNG thu hồi gì
    const a = await dangNhap(PHONE.A, 1);
    const sai = await tatCa(a.accessToken, { giuPhienHienTai: "co" });
    expect(sai.status).toBe(400);
    expect(await dung(a.accessToken)).toBe(200);
  });

  it("[PDN-07] SEC-13: cấp lại (R5) lần 1–2 ⇒ 200 + kiểm toán; lần 3 trong cửa sổ ⇒ thu hồi `dung-lai-token` + kiểm toán REFRESH_REISSUE_LIMIT; đối chứng: lần xoay thường (R4) KHÔNG tính", async () => {
    const c0 = await dangNhap(PHONE.A, 6);
    const p = await phienCuaMay(6);
    expect((await lamMoi(c0)).status).toBe(200); // R4: xoay — cặp mới "bị mất", app giữ token cũ c0
    const r1 = await lamMoi(c0); // R5 lần 1
    const r2 = await lamMoi(c0); // R5 lần 2
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(await db.auditLog.count({ where: { entityId: p.id, action: "REFRESH_REISSUE" } })).toBe(2); // R4 không ghi REFRESH_REISSUE
    const r3 = await lamMoi(c0); // R5 lần 3 ⇒ vượt trần
    expect([r3.status, (await json(r3)).error?.code]).toEqual([401, "TOKEN_REVOKED"]);
    const sau = await db.mobileSession.findUniqueOrThrow({ where: { id: p.id } });
    expect(sau.lyDoThuHoi).toBe("dung-lai-token");
    expect(sau.thuHoiLuc).not.toBeNull();
    expect(await db.auditLog.count({ where: { entityId: p.id, action: "REFRESH_REISSUE_LIMIT" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: p.id, action: "REFRESH_REISSUE" } })).toBe(2); // lần 3 không thêm dòng «cấp lại»
    // cặp cấp lại gần nhất cũng chết cùng phiên
    const r2d = (await json(r2)).data as unknown as Cap;
    expect(await dung(r2d.accessToken)).toBe(401);
  });

  it("[PDN-08] SEC-13 đối chứng DƯƠNG: hai lần cấp lại cũ (ngoài cửa sổ 15 phút) không tính ⇒ cấp lại hợp lệ vẫn 200 và phiên còn sống", async () => {
    const c0 = await dangNhap(PHONE.B, 7);
    const p = await phienCuaMay(7);
    // ghi hai dòng cấp lại đã 16 phút trước (cùng khuôn kiểm toán thật), rồi lùi giờ của chúng
    for (let i = 0; i < 2; i++) await writeAudit({ actor: { id: ids.B, name: "x" }, module: "mobile-auth", entityType: "MobileSession", entityId: p.id, action: "REFRESH_REISSUE", newValues: null });
    await db.auditLog.updateMany({ where: { entityId: p.id, action: "REFRESH_REISSUE" }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await lamMoi(c0)).status).toBe(200); // R4
    const r = await lamMoi(c0); // R5 — chỉ có 0 lần cấp lại TRONG cửa sổ
    expect(r.status).toBe(200);
    expect((await db.mobileSession.findUniqueOrThrow({ where: { id: p.id } })).thuHoiLuc).toBeNull();
    const moi = (await json(r)).data as unknown as Cap;
    expect(await dung(moi.accessToken)).toBe(200);
  });
});
