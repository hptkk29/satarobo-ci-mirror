import bcrypt from "bcryptjs";
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as bookPost } from "@/app/api/mobile/v1/parent/disc/book/route";
import { GET as membersGet } from "@/app/api/mobile/v1/parent/disc/members/route";
import { GET as optionsGet } from "@/app/api/mobile/v1/parent/disc/test/options/route";
import { GET as pairsGet } from "@/app/api/mobile/v1/parent/disc/pairs/route";
import { GET as planGet } from "@/app/api/mobile/v1/parent/disc/plan/route";
import { GET as tongQuanGet } from "@/app/api/mobile/v1/parent/disc/route";
import { POST as pinPost } from "@/app/api/mobile/v1/parent/disc/pin/route";
import { POST as pinVerifyPost } from "@/app/api/mobile/v1/parent/disc/pin/verify/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as doiMaPost } from "@/app/api/mobile/v1/student-mode/code/change/route";
import { GET as nhatKyGet } from "@/app/api/mobile/v1/student-mode/log/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * KIỂM TOÁN theo yêu cầu của Owner/B (V8.27 của B, 22/11/2026) — POSTGRES SCRATCH, người dùng RIÊNG (`ktpin-`), KHÔNG UAT. Hai phần:
 *  PHẦN 1 — PIN DISC (`/parent/disc/pin`, `/pin/verify`): ĐẶC TẢ hành vi HIỆN TẠI để B ghi mô hình đe doạ (các ca [KTPIN-*] KHẲNG ĐỊNH LỖ HỔNG ĐÃ ĐO — khi sửa, chúng chuyển đỏ và phải đổi có chủ đích).
 *    [KTPIN-01] (a) đã có PIN: POST /pin {pin mới} KHÔNG kèm bằng chứng ⇒ 200; verify PIN mới ⇒ 200; PIN cũ ⇒ 403
 *    [KTPIN-02] (b) sau khóa 5 lần sai (429): POST /pin ⇒ 200 GỠ KHOÁ; verify PIN mới ⇒ 200; DB pinSai=0, pinKhoaDen=null
 *    [KTPIN-03] (c) audit `disc.pin.dat`: có mục cho MỖI lần đặt/đổi, KHÔNG phân biệt đặt lần đầu / đổi / có hay không PIN cũ; không chứa PIN/băm
 *    [KTPIN-04] (d) máy chủ KHÔNG dùng PIN để chặn dữ liệu: khi PIN đang BỊ KHOÁ, mọi route dữ liệu DISC vẫn 200; `/pin/verify` thành công không phát token/trạng thái nào
 *  PHẦN 2 — ĐỔI MÃ THOÁT (H-Ma): [KMA-01..06] sai mã cũ (400 «Còn N lần»), đủ lần sai ⇒ 429 + Retry-After, mã mới trùng/dễ đoán/lệch ⇒ 400, chế độ học sinh ⇒ 403, không token ⇒ 401, nhật ký rỗng ⇒ {muc:[]}, nhật ký KHÔNG chứa mã/băm
 * Biến môi trường tuỳ chọn: KTPIN_GHI=<tệp> để ghi kết quả quan sát (cho báo cáo).
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "ktpin-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966800001", B: "0966800002", C: "0966800003", D: "0966800004" };
let dem = 0;
const ip = () => `10.99.${Math.floor(++dem / 250)}.${(dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Ket = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; maChiTiet?: string } };
const json = async (r: Response) => (await r.clone().json()) as Ket;
const ids: Record<string, string> = {};
const ghi = (s: string) => { if (process.env.KTPIN_GHI) appendFileSync(process.env.KTPIN_GHI, s + "\n"); };

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-9000-${String(n + 800).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status}`);
  return (b.data as { accessToken: string }).accessToken;
}
async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.discGiaDinh.deleteMany({ where: { ownerUserId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: uids } }, { entityId: { in: uids } }] } });
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

describe.skipIf(!RUN)("[KTPIN/KMA] kiểm toán PIN DISC + đổi mã thoát — scratch", () => {
  let tokA = ""; let tokB = ""; let tokC = ""; let tokD = "";
  const pin = (t: string, p: string) => pinPost(req("/api/mobile/v1/parent/disc/pin", { pin: p }, t));
  const xacNhan = (t: string, p: string) => pinVerifyPost(req("/api/mobile/v1/parent/disc/pin/verify", { pin: p }, t));
  const soDo = async () => db.discGiaDinh.findUniqueOrThrow({ where: { ownerUserId: ids.A! }, select: { id: true, pinHash: true, pinSai: true, pinKhoaDen: true } });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.DISC_ENABLED = "true";
    process.env.DISC_PEPPER = "kiem-thu-disc-pepper-khong-phai-bi-mat-123456";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of Object.keys(PHONE) as Array<keyof typeof PHONE>) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    for (const [k, o] of [["hs-c", "C"], ["hs-d", "D"]] as const) await db.student.create({ data: { id: `${NS}${k}`, name: `${NS}${k}`, parentUserId: ids[o] } as never });
    tokA = await dangNhap(PHONE.A, 1); tokB = await dangNhap(PHONE.B, 2); tokC = await dangNhap(PHONE.C, 3); tokD = await dangNhap(PHONE.D, 4);
    for (const t of [tokA, tokB, tokC, tokD]) await quyDinhDongY(req("/x", {}, t));
    expect((await bookPost(req("/api/mobile/v1/parent/disc/book", { tenChuSo: "Mẹ KT", vaiTroChuSo: "me", namSinhChuSo: 1990 }, tokA))).status).toBe(200);
  }, 90_000);
  afterAll(async () => { await don(); delete process.env.DISC_ENABLED; delete process.env.DISC_PEPPER; });

  // ───────────────────────── PHẦN 1 — PIN DISC ─────────────────────────
  // V8.31 — ĐÃ VÁ: các ca KTPIN-01..04 từng KHẲNG ĐỊNH lỗ hổng đã đo (đổi PIN không bằng chứng · POST /pin gỡ khoá · audit không phân biệt · máy chủ không chặn dữ liệu). Theo đúng lời dặn trong đầu tệp,
  // nay đảo kỳ vọng thành HÀNH VI MỚI. Bộ đầy đủ (race, hết hạn, thu hồi, giả mạo, fail-closed, trẻ em…) ở `disc-pin-may-chu.spec.ts` ([PINE-*]).
  it("[KTPIN-01] (a) ĐÃ VÁ: đã có PIN ⇒ đổi PIN PHẢI kèm PIN cũ HOẶC mật khẩu (400 CAN_PIN_CU_HOAC_MAT_KHAU nếu thiếu); PIN cũ vẫn dùng được; có PIN cũ đúng ⇒ đổi được", async () => {
    expect((await pin(tokA, "1111")).status).toBe(200); // đặt lần đầu: không cần bằng chứng
    expect((await xacNhan(tokA, "1111")).status).toBe(200);
    const thieu = await pin(tokA, "2222");
    expect(thieu.status).toBe(400);
    expect((await json(thieu)).error?.maChiTiet).toBe("CAN_PIN_CU_HOAC_MAT_KHAU");
    expect((await xacNhan(tokA, "1111")).status).toBe(200); // PIN cũ nguyên vẹn
    const co = await pinPost(req("/api/mobile/v1/parent/disc/pin", { pin: "2222", pinCu: "1111" }, tokA));
    expect(co.status).toBe(200);
    expect((await xacNhan(tokA, "2222")).status).toBe(200);
    expect((await xacNhan(tokA, "1111")).status).toBe(403);
  });

  it("[KTPIN-02] (b) ĐÃ VÁ: PIN bị khoá (sai 5 lần ⇒ 429) KHÔNG gỡ được bằng POST /pin (thiếu bằng chứng ⇒ 400; pinCu ⇒ 429); CHỈ mật khẩu đúng gỡ", async () => {
    await db.discGiaDinh.update({ where: { ownerUserId: ids.A! }, data: { pinSai: 0, pinKhoaDen: null } });
    const kq: number[] = [];
    for (let i = 0; i < 5; i++) kq.push((await xacNhan(tokA, "0000")).status);
    expect(kq).toEqual([403, 403, 403, 403, 429]);
    expect((await soDo()).pinKhoaDen).not.toBeNull();
    expect((await pin(tokA, "3333")).status).toBe(400);
    expect((await pinPost(req("/api/mobile/v1/parent/disc/pin", { pin: "3333", pinCu: "2222" }, tokA))).status).toBe(429);
    expect((await soDo()).pinKhoaDen).not.toBeNull();
    const go = await pinPost(req("/api/mobile/v1/parent/disc/pin", { pin: "3333", matKhau: MAT_KHAU }, tokA));
    expect(go.status).toBe(200);
    const sau = await soDo();
    expect([sau.pinSai, sau.pinKhoaDen]).toEqual([0, null]);
    expect((await xacNhan(tokA, "3333")).status).toBe(200);
  });

  it("[KTPIN-03] (c) ĐÃ VÁ: audit PHÂN BIỆT đặt lần đầu (disc.pin.dat) / đổi (disc.pin.doi) / gỡ khoá (disc.pin.go-khoa) / khoá (disc.pin.khoa); không chứa PIN/mật khẩu/băm", async () => {
    const hang = await db.auditLog.findMany({ where: { module: "disc", entityId: (await soDo()).id, action: { startsWith: "disc.pin." } }, select: { action: true, newValues: true } });
    const dem = (a: string) => hang.filter((h) => h.action === a).length;
    expect(dem("disc.pin.dat")).toBe(1);
    expect(dem("disc.pin.doi")).toBe(2);
    expect(dem("disc.pin.go-khoa")).toBe(1);
    expect(dem("disc.pin.khoa")).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(hang)).not.toMatch(/1111|2222|3333|Mat-khau|scrypt|\$2[aby]\$/);
  });

  it("[KTPIN-04] (d) ĐÃ VÁ (cờ `DISC_PIN_ENFORCE_ENABLED` BẬT): PIN đang BỊ KHOÁ ⇒ MỌI route dữ liệu DISC bị chặn; mở khoá thành công ⇒ chạy lại", async () => {
    process.env.DISC_PIN_ENFORCE_ENABLED = "true";
    try {
      await db.discGiaDinh.update({ where: { ownerUserId: ids.A! }, data: { pinSai: 0, pinKhoaDen: new Date(Date.now() + 600_000) } });
      for (const [ten, h, url] of [["tổng quan", tongQuanGet, ""], ["members", membersGet, "/members"], ["options", optionsGet, "/test/options"], ["pairs", pairsGet, "/pairs"], ["plan", planGet, "/plan"]] as const) {
        const r = await h(req(`/api/mobile/v1/parent/disc${url}`, undefined, tokA));
        expect(r.status, ten).toBe(429);
      }
      await db.discGiaDinh.update({ where: { ownerUserId: ids.A! }, data: { pinSai: 0, pinKhoaDen: null } });
      expect((await xacNhan(tokA, "3333")).status).toBe(200);
      expect((await membersGet(req("/api/mobile/v1/parent/disc/members", undefined, tokA))).status).toBe(200);
    } finally {
      delete process.env.DISC_PIN_ENFORCE_ENABLED;
    }
  });

  it("[KTPIN-05] nhà KHÁC không đặt/đổi/verify được PIN của nhà này; không token ⇒ 401", async () => {
    expect((await pinPost(req("/api/mobile/v1/parent/disc/pin", { pin: "9999" }))).status).toBe(401);
    expect((await pin(tokB, "9999")).status).toBe(404); // B chưa có sổ ⇒ không đụng được sổ của A
    const g = await soDo();
    expect(g.pinHash).not.toBeNull();
    expect((await xacNhan(tokA, "3333")).status).toBe(200); // PIN của A còn nguyên
  });

  // ───────────────────────── PHẦN 2 — ĐỔI MÃ THOÁT (H-Ma) ─────────────────────────
  const doi = (t: string | null, maCu: string, ma: string, xn = ma) => doiMaPost(req("/api/mobile/v1/student-mode/code/change", { maCu, ma, xacNhan: xn }, t ?? undefined));
  const nhatKy = (t: string | null) => nhatKyGet(req("/api/mobile/v1/student-mode/log", undefined, t ?? undefined));

  it("[KMA-01] mã cũ SAI ⇒ 400 «Còn N lần thử» (N giảm dần); mã mới trùng cũ / dễ đoán / hai ô lệch ⇒ 400", async () => {
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, tokC))).status).toBe(200);
    const r1 = await doi(tokC, "0000", "5831");
    expect(r1.status).toBe(400);
    const m1 = (await json(r1)).error!.message;
    expect(m1).toMatch(/Còn \d+ lần/);
    const r2 = await doi(tokC, "0001", "5831");
    const m2 = (await json(r2)).error!.message;
    const n = (m: string) => Number(/Còn (\d+) lần/.exec(m)![1]);
    expect(n(m2)).toBe(n(m1) - 1);
    expect((await doi(tokC, "4729", "4729")).status).toBe(400); // trùng mã cũ
    expect((await doi(tokC, "4729", "1234")).status).toBe(400); // dễ đoán
    expect((await doi(tokC, "4729", "5831", "5832")).status).toBe(400); // hai ô lệch
    ghi(`KMA-01: mã cũ sai ⇒ 400 «${m1}» rồi «${m2}»; trùng/dễ đoán/lệch ⇒ 400`);
  });

  it("[KMA-02] đủ lần sai ⇒ 429 + Retry-After; mã cũ ĐÚNG trong lúc khoá vẫn 429; không đổi được", async () => {
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "7351", xacNhan: "7351" }, tokD))).status).toBe(200);
    const kq: number[] = []; let retry: string | null = null;
    for (let i = 0; i < 6; i++) { const r = await doi(tokD, "0000", "5831"); kq.push(r.status); if (r.status === 429) retry = r.headers.get("retry-after"); }
    expect(kq.slice(0, 4)).toEqual([400, 400, 400, 400]);
    expect(kq[4]).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
    const dung = await doi(tokD, "7351", "5831"); // mã cũ ĐÚNG nhưng đang khoá
    expect(dung.status).toBe(429);
    expect(Number(dung.headers.get("retry-after"))).toBeGreaterThan(0);
    const bam = await db.hocSinhMaThoat.findUniqueOrThrow({ where: { parentUserId: ids.D! } });
    expect(bam.khoaDen).not.toBeNull();
    ghi(`KMA-02: chuỗi=${JSON.stringify(kq)}; Retry-After=${retry}; mã ĐÚNG khi khoá ⇒ ${dung.status}`);
  });

  it("[KMA-03] không token ⇒ 401 (đổi mã + nhật ký); trong CHẾ ĐỘ HỌC SINH ⇒ 403 (đổi mã + nhật ký)", async () => {
    expect((await doi(null, "4729", "5831")).status).toBe(401);
    expect((await nhatKy(null)).status).toBe(401);
    expect((await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: `${NS}hs-c` }, tokC))).status).toBe(200);
    expect((await doi(tokC, "4729", "5831")).status).toBe(403);
    expect((await nhatKy(tokC)).status).toBe(403);
  });

  it("[KMA-04] nhật ký RỖNG ⇒ 200 {muc: []}; nhật ký KHÔNG chứa mã/băm (kể cả sau khi đổi mã + nhập sai)", async () => {
    const trang = await nhatKy(tokB); // B: chưa làm gì ở chế độ học sinh
    expect(trang.status).toBe(200);
    expect((await json(trang)).data).toEqual({ muc: [] });
    // A của phần H-Ma = C (đã có thao tác): thoát chế độ học sinh bằng mã đúng, rồi đổi mã thật
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "6024", xacNhan: "6024" }, tokB))).status).toBe(200);
    expect((await doi(tokB, "9999", "5831")).status).toBe(400); // sai
    expect((await doi(tokB, "6024", "5831")).status).toBe(200); // đổi
    const r = await nhatKy(tokB);
    const raw = JSON.stringify((await json(r)).data);
    const dong = await db.hocSinhMaThoat.findUniqueOrThrow({ where: { parentUserId: ids.B! } });
    expect(raw).toMatch(/DOI_MA/);
    for (const cam of ["6024", "5831", "9999", dong.maBam, "scrypt", "matKhau"]) expect(raw, `nhật ký không được chứa «${cam}»`).not.toContain(cam);
    ghi("KMA-04: nhật ký rỗng ⇒ {muc:[]}; sau đổi mã chỉ có loại/tên con/thời gian, không mã/băm");
  });
});
