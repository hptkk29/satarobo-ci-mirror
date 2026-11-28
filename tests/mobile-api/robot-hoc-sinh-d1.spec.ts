import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (orig) => {
  const that = await orig<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: async (a: { key: string; max: number; windowMs: number }) => (a.key.startsWith("m-disc:") ? { success: true, remaining: 999, resetAt: Date.now() + 1000 } : that.rateLimit(a)) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as dangXuatRoute } from "@/app/api/mobile/v1/auth/logout/route";
import { POST as bookPost } from "@/app/api/mobile/v1/parent/disc/book/route";
import { GET as membersGet, POST as membersPost } from "@/app/api/mobile/v1/parent/disc/members/route";
import { POST as startPost } from "@/app/api/mobile/v1/parent/disc/test/start/route";
import { POST as submitPost } from "@/app/api/mobile/v1/parent/disc/test/submit/route";
import { POST as pinPost } from "@/app/api/mobile/v1/parent/disc/pin/route";
import { POST as pinVerifyPost } from "@/app/api/mobile/v1/parent/disc/pin/verify/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { GET as robotHsGet } from "@/app/api/mobile/v1/student-mode/personality-robot/route";
import { GET as robotCuGet } from "@/app/api/mobile/v1/students/[studentId]/personality-robot/route";
import { db } from "@/lib/db";
import { layRobotTinhCach, layRobotChoHocSinh } from "@/lib/mobile-api/dich-vu/robot-tinh-cach";
import type { MaHocVienDaKiem } from "@/lib/mobile-api/so-huu";
import { docVe } from "@/lib/disc/ngan-hang/de-ky";
import { timCauNganHang } from "@/lib/disc/ngan-hang/nap";
import { layKhoaDisc } from "@/lib/disc/phone-key";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [D1] ROBOT TÍNH CÁCH CHO HỌC SINH (Owner D1=A, 22/11/2026) — Postgres scratch, route handler thật, cờ ép PIN BẬT.
 *   [D1-01] sổ có PIN: phụ huynh CHƯA mở khoá ⇒ đường phụ huynh 403 DISC_CHUA_MO_KHOA; học sinh (phiên khoá vào em) ⇒ 200 robot của CHÍNH em, KHÔNG cần bằng chứng PIN
 *   [D1-02] chỉ robot: không dữ liệu DISC thô / tên thành viên khác / chủ sổ / báo cáo; không có đường tới anh-chị-em (không tham số học viên)
 *   [D1-03] học sinh KHÔNG đọc được DISC gia đình (members…) dù phụ huynh mở khoá ở phiên khác; đường cũ với em khác ⇒ 403; phiên phụ huynh gọi route Student ⇒ 403
 *   [D1-04] KIỂM QUYỀN LẠI mỗi lần: đổi liên kết (học viên sang phụ huynh khác) / xoá mềm / cờ DISC tắt ⇒ 404; đăng xuất ⇒ 401
 *   [D1-05] không đăng nhập ⇒ 401
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "d1rb-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.120.${Math.floor(++dem / 250)}.${(dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Ket = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; maChichiTiet?: string; maChiTiet?: string } };
const json = async (r: Response) => (await r.clone().json()) as Ket;
const U = (p: string) => `/api/mobile/v1/parent/disc${p}`;
const refresh = new Map<string, string>();

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-a500-${String(n + 900).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status}`);
  const d = b.data as { accessToken: string; refreshToken: string };
  refresh.set(d.accessToken, d.refreshToken);
  return d.accessToken;
}
async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const ids = us.map((u) => u.id);
  await db.discGiaDinh.deleteMany({ where: { ownerUserId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { module: "disc", actorId: { in: ids } } });
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: ids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: ids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: ids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: ids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.authAttemptCounter.deleteMany({});
}
function traLoiThienVe(ve: string, tvId: string, cao: "D" | "I" | "S" | "C", gia: number[]): Record<string, number> {
  const d = docVe(ve, layKhoaDisc(), tvId, new Date());
  if (!d.ok) throw new Error("vé hỏng");
  const max = Math.max(...gia), min = Math.min(...gia);
  const r: Record<string, number> = {};
  d.de.maCau.forEach((ma, i) => { const c = timCauNganHang(ma)!; r[String(i)] = c.truc === cao ? (c.dao ? min : max) : c.dao ? max : min; });
  return r;
}

describe.skipIf(!RUN)("[D1] Robot tính cách cho học sinh — API Student", () => {
  const ids: Record<string, string> = {};
  let tokP = ""; let tokP2 = ""; let tokHs = ""; let tokQ = "";
  const S1 = `${NS}be-mot`; const S2 = `${NS}be-hai`;
  const robotCu = async (sid: string, tok: string) => { const r = await robotCuGet(req(`/api/mobile/v1/students/${sid}/personality-robot`, undefined, tok), { params: Promise.resolve({ studentId: sid }) }); return { s: r.status, b: await json(r), raw: await r.clone().text() }; };
  const robotHs = async (tok?: string) => { const r = await robotHsGet(req("/api/mobile/v1/student-mode/personality-robot", undefined, tok)); return { s: r.status, b: await json(r), raw: await r.clone().text() }; };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.DISC_ENABLED = "true";
    process.env.DISC_NGAN_HANG_ENABLED = "true";
    process.env.DISC_PEPPER = "kiem-thu-disc-pepper-khong-phai-bi-mat-123456";
    process.env.DISC_PIN_ENFORCE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const [k, p] of [["P", "0966900101"], ["Q", "0966900102"]] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${p.slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.student.create({ data: { id: S1, name: "Bé Một Robot", parentUserId: ids.P } as never });
    await db.student.create({ data: { id: S2, name: "Bé Hai Robot", parentUserId: ids.P } as never });
    tokP = await dangNhap("0966900101", 1); tokP2 = await dangNhap("0966900101", 2); tokQ = await dangNhap("0966900102", 3);
    for (const t of [tokP, tokP2, tokQ]) await quyDinhDongY(req("/x", {}, t));
    expect((await bookPost(req(U("/book"), { tenChuSo: "Mẹ Robot", vaiTroChuSo: "me", namSinhChuSo: 1990 }, tokP))).status).toBe(200);
    // hai thành viên NỐI hai học viên, hai kết quả khác kiểu
    // Lúc tạo sổ, học viên đã có được NỐI sẵn thành thành viên (HOC_VIEN_DA_NOI) — lấy theo studentId.
    const ds = ((await json(await membersGet(req(U("/members"), undefined, tokP)))).data as { manThanhVien: { thanhVien: Array<{ id: string; studentId: string | null }> } }).manThanhVien.thanhVien;
    const mk = async (_ten: string, sid: string, cao: "D" | "S") => {
      const id = ds.find((t) => t.studentId === sid)?.id;
      expect(id, `thành viên nối ${sid}`).toBeTruthy();
      const up = await membersPost(req(U("/members"), { id, ten: "Bé " + (cao === "D" ? "Một" : "Hai") + " Robot", vaiTro: "con", lop: "4", namSinh: 2016, studentId: sid }, tokP));
      expect(up.status, await up.clone().text()).toBe(200);
      const stR = await startPost(req(U("/test/start"), { thanhVienId: id, cachLam: "TU_LAM" }, tokP));
      expect(stR.status, await stR.clone().text()).toBe(200);
      const st = await json(stR);
      const de = (st.data as { de: { ve: string; thang: Array<{ gia: number }> } }).de;
      const nop = await submitPost(req(U("/test/submit"), { thanhVienId: id, cachLam: "TU_LAM", ve: de.ve, traLoi: traLoiThienVe(de.ve, id!, cao, de.thang.map((x) => x.gia)) }, tokP));
      expect(nop.status, await nop.clone().text()).toBe(200);
      return id!;
    };
    await mk("Bé Một Robot", S1, "D");
    await mk("Bé Hai Robot", S2, "S");
    // đặt PIN ⇒ sổ được bảo vệ (phụ huynh CHƯA mở khoá)
    expect((await pinPost(req(U("/pin"), { pin: "1234" }, tokP))).status).toBe(200);
    // chế độ học sinh cho em 1 trên tokP (phiên khoá vào em 1)
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, tokP2))).status).toBe(200);
    tokHs = tokP;
    expect((await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: S1 }, tokHs))).status).toBe(200);
  }, 120_000);
  afterAll(async () => {
    await don();
    for (const k of ["DISC_ENABLED", "DISC_NGAN_HANG_ENABLED", "DISC_PEPPER", "DISC_PIN_ENFORCE_ENABLED"]) delete process.env[k];
  });

  it("[D1-01] sổ CÓ PIN, phụ huynh chưa mở khoá: đường phụ huynh bị chặn; HỌC SINH xem được Robot của CHÍNH em mà không cần PIN", async () => {
    // đối chứng: phiên phụ huynh THỨ HAI (không ở chế độ học sinh) bị cổng PIN chặn
    const pc = await robotCu(S1, tokP2);
    expect([pc.s, pc.b.error?.maChiTiet]).toEqual([403, "DISC_CHUA_MO_KHOA"]);
    // học sinh: 200
    const r = await robotHs(tokHs);
    expect(r.s, r.raw).toBe(200);
    expect(r.b.data).toMatchObject({ coRobot: true, robot: { nguon: "SO_GIA_DINH", chinh: { ma: "D" } } });
    // đường cũ trong chế độ học sinh cho CHÍNH em cũng trả cùng nội dung (không còn DISC_KHONG_DU_QUYEN)
    const cu = await robotCu(S1, tokHs);
    expect(cu.s, cu.raw).toBe(200);
    expect(cu.b.data).toEqual(r.b.data);
    // không có phiên mở khoá DISC nào được tạo / dùng
    expect(await db.discUnlockSession.count({ where: { userId: ids.P } })).toBe(0);
  });

  it("[D1-02] chỉ robot: không dữ liệu DISC thô, không tên thành viên khác / chủ sổ / báo cáo; không tham số học viên", async () => {
    const r = await robotHs(tokHs);
    const data = r.b.data as { coRobot: boolean; robot: Record<string, unknown> };
    expect(Object.keys(data).sort()).toEqual(["coRobot", "robot"]);
    expect(Object.keys(data.robot).sort()).toEqual(["chinh", "nguon", "phu"]); // D1: KHÔNG có `thanh` (số liệu phần trăm)
    expect(r.raw).not.toMatch(/"thanh"/);
    expect(r.raw).not.toMatch(/Bé Hai|Mẹ Robot|ownerUserId|baoCao|giaDinh|thanhVienId|pinHash|\bpin\b|traLoi|diemTho/i);
    expect((data.robot.chinh as { ma: string }).ma).toBe("D"); // kiểu của EM 1, không phải của em 2 (S)
    // route Student KHÔNG nhận tham số học viên: truyền ?studentId=… bị bỏ qua, vẫn là em đang khoá
    const r2 = await robotHsGet(new Request(`http://localhost/api/mobile/v1/student-mode/personality-robot?studentId=${S2}&id=${S2}`, { headers: { authorization: `Bearer ${tokHs}`, "x-forwarded-for": ip() } }));
    expect((((await json(r2)).data as { robot: { chinh: { ma: string } } }).robot.chinh.ma)).toBe("D");
  });

  it("[D1-03] học sinh KHÔNG đọc được DISC gia đình dù phụ huynh mở khoá ở phiên khác; em khác ⇒ 403; phiên phụ huynh gọi route Student ⇒ 403", async () => {
    // phụ huynh mở khoá bằng PIN ở phiên 2
    expect((await pinVerifyPost(req(U("/pin/verify"), { pin: "1234" }, tokP2))).status).toBe(200);
    expect((await membersGet(req(U("/members"), undefined, tokP2))).status).toBe(200); // phụ huynh đọc được
    const hs = await membersGet(req(U("/members"), undefined, tokHs));
    expect(hs.status).toBe(403); // học sinh không kế thừa
    expect((await robotHs(tokHs)).s).toBe(200); // robot vẫn chạy (không phụ thuộc phiên mở khoá)
    const khac = await robotCu(S2, tokHs);
    expect(khac.s).toBe(403); // anh/chị/em
    expect(khac.raw).not.toMatch(/"coRobot"/);
    const pr = await robotHs(tokP2);
    expect([pr.s, pr.b.error?.code]).toEqual([403, "FORBIDDEN"]); // phiên phụ huynh
  });

  it("[D1-03b] TẦNG DỊCH VỤ (độc lập với allow-list của cổng): phiên học sinh khoá em 1 đòi robot em 2 ⇒ 403; phiên phụ huynh gọi hàm Student ⇒ 403; ghép phiên học sinh với CHỦ KHÁC ⇒ 404", async () => {
    const hsNguoi = { userId: ids.P!, sessionId: "s-hs", name: "", email: "", phone: null, hocSinhId: S1 };
    await expect(layRobotTinhCach(S2 as MaHocVienDaKiem, hsNguoi)).rejects.toMatchObject({ status: 403 });
    await expect(layRobotChoHocSinh({ ...hsNguoi, hocSinhId: null })).rejects.toMatchObject({ status: 403 });
    await expect(layRobotChoHocSinh({ ...hsNguoi, userId: ids.Q! })).rejects.toMatchObject({ status: 404 }); // em 1 không thuộc phụ huynh Q
    const ok = await layRobotChoHocSinh(hsNguoi);
    expect(ok).toMatchObject({ coRobot: true });
  });

  it("[D1-04] KIỂM QUYỀN LẠI mỗi lần: đổi liên kết / xoá mềm / cờ DISC tắt ⇒ 404; đăng xuất ⇒ 401", async () => {
    expect((await robotHs(tokHs)).s).toBe(200);
    // đổi liên kết: học viên chuyển sang phụ huynh khác
    await db.student.update({ where: { id: S1 }, data: { parentUserId: ids.Q! } });
    const a = await robotHs(tokHs);
    expect([a.s, a.b.error?.code]).toEqual([404, "NOT_FOUND"]);
    expect(a.raw).not.toMatch(/"coRobot"/);
    await db.student.update({ where: { id: S1 }, data: { parentUserId: ids.P! } });
    expect((await robotHs(tokHs)).s).toBe(200);
    // xoá mềm
    await db.student.update({ where: { id: S1 }, data: { deletedAt: new Date() } });
    expect((await robotHs(tokHs)).s).toBe(404);
    await db.student.update({ where: { id: S1 }, data: { deletedAt: null } });
    // cờ DISC tắt
    process.env.DISC_ENABLED = "false";
    expect((await robotHs(tokHs)).s).toBe(404);
    process.env.DISC_ENABLED = "true";
    expect((await robotHs(tokHs)).s).toBe(200);
    // đăng xuất (token chết)
    const lo = await dangXuatRoute(req("/api/mobile/v1/auth/logout", { refreshToken: refresh.get(tokHs) }));
    expect(lo.status).toBe(200);
    expect((await robotHs(tokHs)).s).toBe(401);
  });

  it("[D1-05] không đăng nhập / token rác ⇒ 401, không lộ gì", async () => {
    const a = await robotHs(undefined);
    expect(a.s).toBe(401);
    const b = await robotHs("token-rac-khong-hop-le");
    expect(b.s).toBe(401);
    expect(a.raw + b.raw).not.toMatch(/robot|coRobot/i);
  });
});
