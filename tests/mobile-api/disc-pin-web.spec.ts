import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mô phỏng «trình duyệt»: kho cookie theo từng người dùng, và phiên đăng nhập hiện hành ──
const hoi = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  datLai: [] as Array<{ ten: string; gia: string; opts: Record<string, unknown> }>,
  user: null as { id: string; role: string } | null,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (t: string) => (hoi.jar.has(t) ? { name: t, value: hoi.jar.get(t)! } : undefined),
    set: (t: string, v: string, opts: Record<string, unknown>) => {
      hoi.datLai.push({ ten: t, gia: v, opts });
      if (v === "" || opts.maxAge === 0) hoi.jar.delete(t);
      else hoi.jar.set(t, v);
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (hoi.user ? { user: hoi.user } : null)), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { GET as baoCaoGet } from "@/app/(portal)/portal/disc/[id]/bao-cao/route";
import { GET as duLieuGet } from "@/app/(portal)/portal/disc/du-lieu-cua-toi/route";
import { datPinAction, chayPhanTichAction, khoaLaiDiscAction, luuThanhVienAction, nopBaiAction, phatDeAction, taoSoGiaDinhAction, trangThaiPinAction, vaoCheDoTreEmAction, xacNhanPinAction } from "@/app/(portal)/portal/disc/_actions-so";
import { TEN_COOKIE_MO_KHOA, yeuCauPhienDisc } from "@/app/(portal)/portal/disc/_lib/phien-disc";
import { db } from "@/lib/db";
import { docVe } from "@/lib/disc/ngan-hang/de-ky";
import { timCauNganHang } from "@/lib/disc/ngan-hang/nap";
import { layKhoaDisc } from "@/lib/disc/phone-key";
import { thuHoiKhiAuthSignOut } from "@/lib/push/thu-hoi";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [PINW] PIN DISC ép ở máy chủ — ĐƯỜNG WEB (cookie HttpOnly) trên Postgres scratch. Server Action + route handler thật, `auth()`/`cookies()` mô phỏng. Cờ ép BẬT.
 *   [PINW-01] chưa mở khoá ⇒ mọi action/route/trang bị chặn (403/redirect mở-khoá), DB không đổi · [PINW-02] mở khoá ⇒ cookie HttpOnly+Strict+path, DB chỉ giữ BĂM, token thô không lọt audit/DB
 *   [PINW-03] trình duyệt khác / cookie giả / chiếm phiên (fixation) / phát lại sau khoá ⇒ bị chặn · [PINW-04] đổi PIN / đổi mật khẩu / đăng xuất / mất sở hữu thu hồi
 *   [PINW-05] chế độ trẻ em · [PINW-06] một nhà không đọc/ghi được sổ nhà khác dù đã mở khoá sổ của mình
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "pinw-";
const MAT_KHAU = "Mat-khau-test-2026";
const ids: Record<string, string> = {};
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const dangNhapLa = (k: string | null) => { hoi.user = k ? { id: ids[k]!, role: "PARENT" } : null; };
const trinhDuyet = (jar: Map<string, string>) => { hoi.jar = jar; };

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.discGiaDinh.deleteMany({ where: { ownerUserId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { module: "disc", actorId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

function traLoi(ve: string, tvId: string, gia: number[]): Record<string, number> {
  const d = docVe(ve, layKhoaDisc(), tvId, new Date());
  if (!d.ok) throw new Error("vé hỏng");
  const max = Math.max(...gia), min = Math.min(...gia);
  const r: Record<string, number> = {};
  d.de.maCau.forEach((ma, i) => { const c = timCauNganHang(ma)!; r[String(i)] = c.truc === "D" ? (c.dao ? min : max) : c.dao ? max : min; });
  return r;
}

describe.skipIf(!RUN)("[PINW] PIN DISC ép ở máy chủ — đường WEB", () => {
  let soX = ""; let meX = ""; let conX = ""; let meY = "";
  const jarX1 = new Map<string, string>(); // trình duyệt của X
  const jarX2 = new Map<string, string>(); // máy khác của X
  const jarY = new Map<string, string>();
  const soHang = async (id: string) => ({ tv: await db.discThanhVien.count({ where: { giaDinhId: id } }), bai: await db.discBaiLam.count({ where: { giaDinhId: id } }) });

  beforeAll(async () => {
    process.env.DISC_ENABLED = "true";
    process.env.DISC_NGAN_HANG_ENABLED = "true";
    process.env.DISC_PEPPER = "kiem-thu-disc-pepper-khong-phai-bi-mat-123456";
    process.env.DISC_PIN_ENFORCE_ENABLED = "true";
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["X", "Y", "Z"]) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `8496700${k.charCodeAt(0)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    // X dựng sổ (chưa PIN ⇒ cổng cho qua)
    trinhDuyet(jarX1); dangNhapLa("X");
    expect((await taoSoGiaDinhAction({ tenChuSo: "Mẹ Web X", vaiTroChuSo: "me", namSinhChuSo: 1990 })).ok).toBe(true);
    const a = await luuThanhVienAction({ ten: "Con Web X", vaiTro: "con", namSinh: 2016 });
    expect(a.ok).toBe(true);
    soX = (await db.discGiaDinh.findUniqueOrThrow({ where: { ownerUserId: ids.X! }, select: { id: true } })).id;
    meX = (await db.discThanhVien.findFirstOrThrow({ where: { giaDinhId: soX, ten: "Mẹ Web X" } })).id;
    conX = (await db.discThanhVien.findFirstOrThrow({ where: { giaDinhId: soX, ten: "Con Web X" } })).id;
    trinhDuyet(jarY); dangNhapLa("Y");
    expect((await taoSoGiaDinhAction({ tenChuSo: "Bố Web Y", vaiTroChuSo: "bo", namSinhChuSo: 1988 })).ok).toBe(true);
    meY = (await db.discThanhVien.findFirstOrThrow({ where: { giaDinh: { ownerUserId: ids.Y! }, ten: "Bố Web Y" } })).id;
    trinhDuyet(jarX1); dangNhapLa("X");
    const r = await datPinAction({ pin: "1234" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }, 90_000);
  afterAll(async () => {
    await don();
    for (const k of ["DISC_ENABLED", "DISC_NGAN_HANG_ENABLED", "DISC_PEPPER", "DISC_PIN_ENFORCE_ENABLED"]) delete process.env[k];
  });

  it("[PINW-01] CHƯA MỞ KHOÁ ⇒ action ghi/đọc bị chặn, route 403, trang redirect mở-khoá; DB không đổi; trạng thái PIN vẫn đọc được (bootstrap)", async () => {
    trinhDuyet(jarX1); dangNhapLa("X"); jarX1.clear();
    const truoc = await soHang(soX);
    const w = await luuThanhVienAction({ ten: "Không được", vaiTro: "khac" });
    expect(w.ok).toBe(false);
    expect((w as { loi?: string }).loi).toBe("DISC_CHUA_MO_KHOA");
    expect((await chayPhanTichAction()).ok).toBe(false);
    expect((await phatDeAction({ thanhVienId: conX, cachLam: "TU_LAM" })).ok).toBe(false);
    expect(await soHang(soX)).toEqual(truoc);
    await expect(yeuCauPhienDisc({ phamVi: "DOC" })).rejects.toThrow("NEXT_REDIRECT:/portal/disc/mo-khoa");
    const r1 = await baoCaoGet(new Request("http://x/portal/disc/abc/bao-cao"), { params: Promise.resolve({ id: "abc" }) } as never);
    expect(r1.status).toBe(403);
    const r2 = await duLieuGet();
    expect(r2.status).toBe(403);
    expect(await r2.text()).not.toMatch(/Web X/);
    const tt = await trangThaiPinAction();
    expect(tt.ok && tt.trangThai).toMatchObject({ coPin: true, epMayChu: true, daMoKhoa: false });
    // chưa đăng nhập ⇒ /login (không lộ gì)
    dangNhapLa(null);
    await expect(yeuCauPhienDisc({ phamVi: "DOC" })).rejects.toThrow("NEXT_REDIRECT:/login");
    dangNhapLa("X");
  });

  it("[PINW-02] MỞ KHOÁ: PIN sai ⇒ lỗi + không cookie; PIN đúng ⇒ cookie HttpOnly/Strict/path=/portal/disc/hết hạn; DB chỉ giữ BĂM; sau đó action/route chạy", async () => {
    jarX1.clear(); hoi.datLai.length = 0;
    const sai = await xacNhanPinAction({ pin: "0000" });
    expect(sai.ok).toBe(false);
    expect(jarX1.has(TEN_COOKIE_MO_KHOA)).toBe(false);
    const dung = await xacNhanPinAction({ pin: "1234" });
    expect(dung.ok, JSON.stringify(dung)).toBe(true);
    const ck = hoi.datLai.find((c) => c.ten === TEN_COOKIE_MO_KHOA && c.gia !== "")!;
    expect(ck.opts).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/portal/disc" });
    expect(ck.opts.expires).toBeInstanceOf(Date);
    expect(ck.gia).toMatch(/^[A-Za-z0-9_-]{20,80}$/);
    const hang = await db.discUnlockSession.findFirstOrThrow({ where: { giaDinhId: soX, kenh: "WEB", thuHoiLuc: null } });
    expect(hang.tokenHash).toBe(sha(ck.gia)); // chỉ băm
    expect(hang.tokenHash).not.toBe(ck.gia);
    expect(JSON.stringify(hang)).not.toContain(ck.gia);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { module: "disc", entityId: soX } }))).not.toContain(ck.gia);
    expect(hang.phienDangNhapId).toBeNull();
    // ĐỐI CHỨNG DƯƠNG: đã mở khoá ⇒ chạy được
    expect((await chayPhanTichAction()).ok !== undefined).toBe(true);
    const ok = await luuThanhVienAction({ ten: "Ông Web X", vaiTro: "ong", namSinh: 1950 });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    const r2 = await duLieuGet();
    expect(r2.status).toBe(200);
    expect(await yeuCauPhienDisc({ phamVi: "DOC" })).toMatchObject({ userId: ids.X });
  });

  it("[PINW-03] trình duyệt KHÁC (cùng tài khoản) không thừa hưởng; cookie giả ⇒ bị chặn; CHIẾM PHIÊN: cookie do kẻ tấn công đặt trước KHÔNG trở thành hợp lệ, mở khoá cấp token MỚI; phát lại token sau khi khoá ⇒ bị chặn", async () => {
    const tokX1 = jarX1.get(TEN_COOKIE_MO_KHOA)!;
    trinhDuyet(jarX2); jarX2.clear();
    expect((await luuThanhVienAction({ ten: "Máy khác", vaiTro: "khac" })).ok).toBe(false);
    jarX2.set(TEN_COOKIE_MO_KHOA, "token-gia-khong-ton-tai-0123456789abcdef");
    expect((await luuThanhVienAction({ ten: "Cookie giả", vaiTro: "khac" })).ok).toBe(false);
    // fixation: kẻ tấn công cấy một token chọn trước vào máy nạn nhân rồi chờ nạn nhân mở khoá
    const cay = "ke-tan-cong-cay-truoc-0123456789abcdef";
    jarX2.set(TEN_COOKIE_MO_KHOA, cay);
    expect((await xacNhanPinAction({ pin: "1234" })).ok).toBe(true);
    const sau = jarX2.get(TEN_COOKIE_MO_KHOA)!;
    expect(sau).not.toBe(cay); // máy chủ cấp token MỚI, không nhận token do client chọn
    expect(await db.discUnlockSession.count({ where: { tokenHash: sha(cay) } })).toBe(0);
    jarX2.set(TEN_COOKIE_MO_KHOA, cay);
    expect((await luuThanhVienAction({ ten: "Dùng token cấy", vaiTro: "khac" })).ok).toBe(false); // token cấy vẫn vô dụng
    // khoá lại ở máy 1 ⇒ token cũ của máy 1 phát lại bị chặn
    trinhDuyet(jarX1);
    expect((await khoaLaiDiscAction()).ok).toBe(true);
    expect(jarX1.has(TEN_COOKIE_MO_KHOA)).toBe(false); // cookie bị xoá phía client
    jarX1.set(TEN_COOKIE_MO_KHOA, tokX1); // kẻ nghe lén phát lại token cũ
    const phatLai = await luuThanhVienAction({ ten: "Phát lại", vaiTro: "khac" });
    expect([phatLai.ok, (phatLai as { loi?: string }).loi]).toEqual([false, "DISC_CHUA_MO_KHOA"]);
    expect(await db.discThanhVien.count({ where: { giaDinhId: soX, ten: { in: ["Máy khác", "Cookie giả", "Dùng token cấy", "Phát lại"] } } })).toBe(0);
    // máy 2 (đã mở bằng token mới) KHÔNG bị ảnh hưởng bởi việc khoá ở máy 1
    trinhDuyet(jarX2); jarX2.set(TEN_COOKIE_MO_KHOA, sau);
    expect((await luuThanhVienAction({ ten: "Máy hai còn mở", vaiTro: "khac" })).ok).toBe(true);
    trinhDuyet(jarX1); jarX1.clear();
    expect((await xacNhanPinAction({ pin: "1234" })).ok).toBe(true);
  });

  it("[PINW-04] THU HỒI: đổi PIN ⇒ cookie cũ vô hiệu (cả hai máy); ĐĂNG XUẤT (hook Auth.js) ⇒ thu hồi mọi phiên; đổi MẬT KHẨU (tokenVersion) ⇒ phiên cũ vô hiệu; mất sở hữu ⇒ không đọc được", async () => {
    // (a) đổi PIN ở máy 1 ⇒ máy 2 mất hiệu lực
    trinhDuyet(jarX1);
    const doi = await datPinAction({ pin: "5678", pinCu: "1234" });
    expect(doi.ok, JSON.stringify(doi)).toBe(true);
    expect(jarX1.has(TEN_COOKIE_MO_KHOA)).toBe(false); // phiên của chính máy đổi cũng phải mở lại
    trinhDuyet(jarX2);
    expect((await luuThanhVienAction({ ten: "Sau đổi PIN", vaiTro: "khac" })).ok).toBe(false);
    // (b) đăng xuất
    trinhDuyet(jarX1); expect((await xacNhanPinAction({ pin: "5678" })).ok).toBe(true);
    trinhDuyet(jarX2); expect((await xacNhanPinAction({ pin: "5678" })).ok).toBe(true);
    expect(await db.discUnlockSession.count({ where: { giaDinhId: soX, thuHoiLuc: null } })).toBeGreaterThanOrEqual(2);
    await thuHoiKhiAuthSignOut({ token: { id: ids.X } });
    expect(await db.discUnlockSession.count({ where: { giaDinhId: soX, thuHoiLuc: null } })).toBe(0);
    for (const j of [jarX1, jarX2]) { trinhDuyet(j); expect((await luuThanhVienAction({ ten: "Sau đăng xuất", vaiTro: "khac" })).ok).toBe(false); }
    // (c) đổi mật khẩu = tăng tokenVersion
    trinhDuyet(jarX1); expect((await xacNhanPinAction({ matKhau: MAT_KHAU })).ok).toBe(true);
    expect((await luuThanhVienAction({ ten: "Trước đổi MK", vaiTro: "khac" })).ok).toBe(true);
    await db.user.update({ where: { id: ids.X! }, data: { tokenVersion: { increment: 1 } } });
    const t = await luuThanhVienAction({ ten: "Sau đổi MK", vaiTro: "khac" });
    expect([t.ok, (t as { loi?: string }).loi]).toEqual([false, "DISC_PHIEN_THU_HOI"]);
    // (d) mất quyền sở hữu
    expect((await xacNhanPinAction({ pin: "5678" })).ok).toBe(true);
    await db.discGiaDinh.update({ where: { id: soX }, data: { ownerUserId: ids.Z! } });
    const m = await luuThanhVienAction({ ten: "Sau mất sở hữu", vaiTro: "khac" });
    expect(m.ok).toBe(false);
    await db.discGiaDinh.update({ where: { id: soX }, data: { ownerUserId: ids.X! } });
    expect(await db.discThanhVien.count({ where: { giaDinhId: soX, ten: { in: ["Sau đổi PIN", "Sau đăng xuất", "Sau đổi MK", "Sau mất sở hữu"] } } })).toBe(0);
    // mật khẩu SAI không mở khoá, và PIN đang khoá ⇒ chỉ mật khẩu
    expect((await xacNhanPinAction({ matKhau: "sai-mat-khau-12345" })).ok).toBe(false);
  });

  it("[PINW-05] CHẾ ĐỘ TRẺ EM (web): hạ quyền ⇒ chỉ làm bài của MỘT thành viên; ghi/đọc khác bị chặn; thoát = nhập PIN", async () => {
    trinhDuyet(jarX1); jarX1.clear();
    expect((await xacNhanPinAction({ pin: "5678" })).ok).toBe(true);
    const k = await vaoCheDoTreEmAction({ thanhVienId: conX });
    expect(k.ok, JSON.stringify(k)).toBe(true);
    const w = await luuThanhVienAction({ ten: "Bé thêm người", vaiTro: "khac" });
    expect([w.ok, (w as { loi?: string }).loi]).toEqual([false, "DISC_KHONG_DU_QUYEN"]);
    expect((await chayPhanTichAction()).ok).toBe(false);
    expect((await duLieuGet()).status).toBe(403);
    const lam = await phatDeAction({ thanhVienId: conX, cachLam: "TU_LAM" });
    expect(lam.ok, JSON.stringify(lam)).toBe(true);
    const khac = await phatDeAction({ thanhVienId: meX, cachLam: "TU_LAM" });
    expect([khac.ok, (khac as { loi?: string }).loi]).toEqual([false, "DISC_KHONG_DU_QUYEN"]);
    if (lam.ok) {
      const nop = await nopBaiAction({ thanhVienId: conX, cachLam: "TU_LAM", ve: lam.de.ve, traLoi: traLoi(lam.de.ve, conX, lam.de.thang.map((x) => x.gia)) });
      expect(nop.ok, JSON.stringify(nop)).toBe(true);
    }
    expect((await xacNhanPinAction({ pin: "5678" })).ok).toBe(true);
    expect((await luuThanhVienAction({ ten: "Mẹ đã thoát", vaiTro: "khac" })).ok).toBe(true);
  });

  it("[PINW-06] NHÀ KHÁC: Y chưa có PIN ⇒ không bị cổng chặn (opt-in) nhưng KHÔNG đọc/ghi được sổ X dù X đã mở khoá; cookie của X không có tác dụng với sổ Y", async () => {
    trinhDuyet(jarX1); expect(jarX1.has(TEN_COOKIE_MO_KHOA)).toBe(true);
    const tokX = jarX1.get(TEN_COOKIE_MO_KHOA)!;
    trinhDuyet(jarY); jarY.clear(); dangNhapLa("Y");
    const y = await luuThanhVienAction({ ten: "Con Web Y", vaiTro: "con", namSinh: 2017 });
    expect(y.ok, JSON.stringify(y)).toBe(true);
    expect(await db.discThanhVien.count({ where: { giaDinhId: soX, ten: "Con Web Y" } })).toBe(0); // vào đúng sổ của Y
    // Y thử dùng id thành viên của X
    const p = await phatDeAction({ thanhVienId: meX, cachLam: "TU_LAM" });
    expect(p.ok).toBe(false);
    // Y mang cookie của X: Y có sổ KHÔNG PIN ⇒ cổng cho qua nhưng dữ liệu vẫn là của Y
    jarY.set(TEN_COOKIE_MO_KHOA, tokX);
    const r = await duLieuGet();
    expect(r.status).toBe(200);
    expect(await r.text()).not.toMatch(/Web X/);
    // Y đặt PIN rồi, cookie của X không mở được sổ Y
    expect((await datPinAction({ pin: "2468" })).ok).toBe(true);
    expect((await luuThanhVienAction({ ten: "Y dùng cookie X", vaiTro: "khac" })).ok).toBe(false);
    expect(meY).toBeTruthy();
  });
});
