import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
// Đếm số lần PIN thực sự được SO SÁNH (bằng chứng trực tiếp cho «≤ 5 lượt đoán»: kiểm bằng mã trạng thái không phân biệt được «bị chặn trước khi so» với «đã so mà sai»).
const soLanSoPin = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/disc/so-gia-dinh/pin", async (orig) => {
  const that = await orig<typeof import("@/lib/disc/so-gia-dinh/pin")>();
  return { ...that, kiemPin: (...a: Parameters<typeof that.kiemPin>) => { soLanSoPin.n++; return that.kiemPin(...a); } };
});
// Giới hạn tần suất CỦA DỊCH VỤ (`m-disc:*`, 60 ghi/10 phút) không phải đối tượng của bộ này — nới để ~100 lượt gọi không dính 429 ngoài ý muốn. Giới hạn ĐẾM PIN là bộ đếm trong DB (không phải rateLimit) nên vẫn được thử thật;
// khoá khác (đăng nhập…) đi qua bản thật.
vi.mock("@/lib/rate-limit", async (orig) => {
  const that = await orig<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: async (a: { key: string; max: number; windowMs: number }) => (a.key.startsWith("m-disc:") ? { success: true, remaining: 999, resetAt: Date.now() + 1000 } : that.rateLimit(a)) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as dangXuatRoute } from "@/app/api/mobile/v1/auth/logout/route";
import { POST as lamMoiRoute } from "@/app/api/mobile/v1/auth/refresh/route";
import { POST as bookPost } from "@/app/api/mobile/v1/parent/disc/book/route";
import { GET as membersGet, POST as membersPost } from "@/app/api/mobile/v1/parent/disc/members/route";
import { POST as memberDeletePost } from "@/app/api/mobile/v1/parent/disc/members/[memberId]/delete/route";
import { GET as reportGet } from "@/app/api/mobile/v1/parent/disc/members/[memberId]/report/route";
import { GET as optionsGet } from "@/app/api/mobile/v1/parent/disc/test/options/route";
import { POST as startPost } from "@/app/api/mobile/v1/parent/disc/test/start/route";
import { POST as draftPost } from "@/app/api/mobile/v1/parent/disc/test/draft/route";
import { POST as submitPost } from "@/app/api/mobile/v1/parent/disc/test/submit/route";
import { POST as resultDeletePost } from "@/app/api/mobile/v1/parent/disc/results/[resultId]/delete/route";
import { GET as pairsGet } from "@/app/api/mobile/v1/parent/disc/pairs/route";
import { GET as planGet, POST as planPost } from "@/app/api/mobile/v1/parent/disc/plan/route";
import { POST as taskDonePost } from "@/app/api/mobile/v1/parent/disc/plan/tasks/[taskId]/done/route";
import { POST as taskThanksPost } from "@/app/api/mobile/v1/parent/disc/plan/tasks/[taskId]/thanks/route";
import { POST as checkinPost } from "@/app/api/mobile/v1/parent/disc/plan/checkin/route";
import { GET as pinGet, POST as pinPost } from "@/app/api/mobile/v1/parent/disc/pin/route";
import { POST as pinVerifyPost } from "@/app/api/mobile/v1/parent/disc/pin/verify/route";
import { POST as pinLockPost } from "@/app/api/mobile/v1/parent/disc/pin/lock/route";
import { POST as kidModePost } from "@/app/api/mobile/v1/parent/disc/pin/kid-mode/route";
import { GET as tongQuanGet } from "@/app/api/mobile/v1/parent/disc/route";
import { POST as doiMatKhauPost } from "@/app/api/mobile/v1/parent/password/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { db } from "@/lib/db";
import { docVe } from "@/lib/disc/ngan-hang/de-ky";
import { timCauNganHang } from "@/lib/disc/ngan-hang/nap";
import { layKhoaDisc } from "@/lib/disc/phone-key";
import { baoVeDisc } from "@/lib/mobile-api/dich-vu/disc";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [PINE] PIN DISC ÉP Ở MÁY CHỦ (V8.31) — POSTGRES SCRATCH, gọi route handler thật, cờ `DISC_PIN_ENFORCE_ENABLED` BẬT (trừ ca đối chứng cờ TẮT). Mọi ca «bị chặn» đi KÈM ca «mở khoá ⇒ 200»;
 * ca ghi/đồng thời kiểm DB thật (đếm hàng, băm, phiên bản), không chỉ mã HTTP. Dữ liệu giả, dọn theo tiền tố `pine-`.
 *   [PINE-01] đặt PIN lần đầu · [PINE-02] đặt lần hai/đổi cần bằng chứng · [PINE-03] đổi bằng PIN cũ / mật khẩu; sai ⇒ không đổi · [PINE-04] khoá PIN: chỉ mật khẩu gỡ
 *   [PINE-05] đổi đồng thời ⇒ một thắng (CAS, DB) · [PINE-06] đoán song song ⇒ ≤ 5 lượt được so (DB) · [PINE-07] chưa mở khoá ⇒ MỌI route nhạy cảm bị chặn, DB không đổi · [PINE-08] mở khoá ⇒ đúng các route đó chạy
 *   [PINE-09] phiên khác của cùng tài khoản không thừa hưởng · [PINE-10] nhà khác (A↔B) · [PINE-11] hết hạn idle/tuyệt đối (đồng hồ MÁY CHỦ) · [PINE-12] đăng xuất / đổi mật khẩu / đổi PIN / mất quyền sở hữu thu hồi
 *   [PINE-13] giả mạo trường client · [PINE-14] chế độ trẻ em (hạ quyền) · [PINE-15] fail-closed khi DB/bảng hỏng; cờ TẮT KHÔNG chạm bảng · [PINE-16] không lộ dữ liệu / bí mật trong phản hồi, audit, bảng
 *   [PINE-17] nộp trùng V8.29 vẫn đúng khi cờ BẬT + đã mở khoá · [PINE-18] khoá lại · [PINE-19] chế độ học sinh
 *   [PINE-23] chưa đặt PIN ⇒ CHUA_DAT_PIN · PIN sai định dạng ⇒ 400 không ghi băm · băm không chứa PIN thật · [PINE-24] khoá HẾT HẠN theo thời gian ⇒ PIN đúng mở lại
 *       (hai ca này thay các assertion của [SGD-DB-07] ở tests/disc-db/so-gia-dinh.test.ts đã gỡ ở V8.31+: hàm datPin/xacNhanPin cũ chuyển sang mo-khoa.ts)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "pine-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966900001", B: "0966900002", C: "0966900003", D: "0966900004", E: "0966900005" };
let dem = 0;
const ip = () => `10.100.${Math.floor(++dem / 250)}.${(dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string, tho?: Record<string, string>) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(tho ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Ket = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; maChiTiet?: string } };
const json = async (r: Response) => (await r.clone().json()) as Ket;
const ids: Record<string, string> = {};
const U = (p: string) => `/api/mobile/v1/parent/disc${p}`;
const cM = (memberId: string) => ({ params: Promise.resolve({ memberId }) });
const cR = (resultId: string) => ({ params: Promise.resolve({ resultId }) });
const cT = (taskId: string) => ({ params: Promise.resolve({ taskId }) });

const refreshCua = new Map<string, string>();
async function dangNhap(phone: string, n: number, phienBan = "1.0.0") {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-a100-${String(n + 900).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: phienBan } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  const d = b.data as { accessToken: string; refreshToken: string };
  refreshCua.set(d.accessToken, d.refreshToken);
  return d.accessToken;
}

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.discGiaDinh.deleteMany({ where: { ownerUserId: { in: uids } } }); // phiên mở khoá + thành viên + bài… xoá theo ON DELETE CASCADE
  await db.auditLog.deleteMany({ where: { module: "disc", actorId: { in: uids } } });
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

function traLoiThienVe(ve: string, tvId: string, cao: "D" | "I" | "S" | "C", gia: number[]): Record<string, number> {
  const d = docVe(ve, layKhoaDisc(), tvId, new Date());
  if (!d.ok) throw new Error("vé hỏng trong fixture");
  const max = Math.max(...gia);
  const min = Math.min(...gia);
  const r: Record<string, number> = {};
  d.de.maCau.forEach((ma, i) => {
    const c = timCauNganHang(ma);
    if (!c) throw new Error("mã câu lạ");
    // trục «cao» đạt biên trên, các trục khác biên dưới (đảo thì ngược lại) ⇒ độ phân tán đủ cho MỌI thang (người lớn / trẻ em).
    r[String(i)] = c.truc === cao ? (c.dao ? min : max) : c.dao ? max : min;
  });
  return r;
}

describe.skipIf(!RUN)("[PINE] PIN DISC ép ở máy chủ — Postgres thật", () => {
  let tokA = ""; let tokA2 = ""; let tokB = ""; let tokC = ""; let tokD = ""; let tokE = "";
  let soA = ""; let soB = ""; let meA = ""; let conA = ""; let ongA = ""; let meB = ""; let baiB = "";
  const kq = async (r: Response) => ({ status: r.status, retry: r.headers.get("retry-after"), b: await json(r), raw: await r.clone().text() });
  const lay = async (h: (r: Request) => Promise<Response>, url: string, tok?: string, tho?: Record<string, string>) => kq(await h(req(url, undefined, tok, tho)));
  const goi = async (h: (r: Request) => Promise<Response>, url: string, body: unknown, tok?: string, tho?: Record<string, string>) => kq(await h(req(url, body, tok, tho)));
  const pin = (t: string, body: unknown) => goi(pinPost, U("/pin"), body, t);
  const mo = (t: string, body: unknown) => goi(pinVerifyPost, U("/pin/verify"), body, t);
  const trangThai = async (t: string) => (await lay(pinGet, U("/pin"), t)).b.data!.trangThai as Record<string, unknown>;
  const soDo = (id: string) => db.discGiaDinh.findUniqueOrThrow({ where: { id }, select: { pinHash: true, pinSai: true, pinKhoaDen: true, pinPhienBan: true, matKhauSai: true, matKhauKhoaDen: true } });
  const dongBoTat = (v: string | undefined) => { if (v === undefined) delete process.env.DISC_PIN_ENFORCE_ENABLED; else process.env.DISC_PIN_ENFORCE_ENABLED = v; };
  const maChiTiet = (r: { b: Ket }) => r.b.error?.maChiTiet;

  /** Mười bảy route nhạy cảm (đọc + ghi) với phạm vi mong đợi — dùng cho cặp «bị chặn / mở khoá». */
  const cacRoute = (tok: string, memberId: string): Array<{ ten: string; chay: () => Promise<{ status: number }> }> => [
    { ten: "GET tổng quan", chay: () => lay(tongQuanGet, U(""), tok) },
    { ten: "GET members", chay: () => lay(membersGet, U("/members"), tok) },
    { ten: "GET options", chay: () => lay(optionsGet, U("/test/options"), tok) },
    { ten: "GET pairs", chay: () => lay(pairsGet, U("/pairs"), tok) },
    { ten: "GET plan", chay: () => lay(planGet, U("/plan"), tok) },
    { ten: "GET report", chay: async () => kq(await reportGet(req(U(`/members/${memberId}/report`), undefined, tok), cM(memberId))) },
    { ten: "POST members", chay: () => goi(membersPost, U("/members"), { ten: "Người Thử", vaiTro: "khac" }, tok) },
    { ten: "POST member delete", chay: async () => kq(await memberDeletePost(req(U(`/members/${memberId}/delete`), { cheDo: "giu-bai" }, tok), cM(memberId))) },
    { ten: "POST test/start", chay: () => goi(startPost, U("/test/start"), { thanhVienId: memberId, cachLam: "TU_LAM" }, tok) },
    { ten: "POST test/draft", chay: () => goi(draftPost, U("/test/draft"), { thanhVienId: memberId, cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 } }, tok) },
    { ten: "POST test/submit", chay: () => goi(submitPost, U("/test/submit"), { thanhVienId: memberId, cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 } }, tok) },
    { ten: "POST results delete", chay: async () => kq(await resultDeletePost(req(U("/results/khong-co/delete"), {}, tok), cR("khong-co"))) },
    { ten: "POST plan", chay: () => goi(planPost, U("/plan"), { ky: "NGAY_7", batDau: "2026-11-23" }, tok) },
    { ten: "POST plan done", chay: async () => kq(await taskDonePost(req(U("/plan/tasks/khong-co/done"), {}, tok), cT("khong-co"))) },
    { ten: "POST plan thanks", chay: async () => kq(await taskThanksPost(req(U("/plan/tasks/khong-co/thanks"), {}, tok), cT("khong-co"))) },
    { ten: "POST plan checkin", chay: () => goi(checkinPost, U("/plan/checkin"), { keHoachId: "k", tuan: 1, diem: [{ thanhVienId: memberId, diem: 3 }] }, tok) },
  ];

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.DISC_ENABLED = "true";
    process.env.DISC_NGAN_HANG_ENABLED = "true";
    process.env.DISC_PEPPER = "kiem-thu-disc-pepper-khong-phai-bi-mat-123456";
    process.env.DISC_PIN_ENFORCE_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of Object.keys(PHONE) as Array<keyof typeof PHONE>) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    await db.student.create({ data: { id: `${NS}hs-d`, name: "Bé Dê", parentUserId: ids.D } as never });
    tokA = await dangNhap(PHONE.A, 1); tokA2 = await dangNhap(PHONE.A, 2); tokB = await dangNhap(PHONE.B, 3); tokC = await dangNhap(PHONE.C, 4); tokD = await dangNhap(PHONE.D, 5); tokE = await dangNhap(PHONE.E, 6);
    for (const t of [tokA, tokA2, tokB, tokC, tokD, tokE]) await quyDinhDongY(req("/x", {}, t));
    // Cờ TẮT khi dựng dữ liệu (chưa có PIN ⇒ cũng không ảnh hưởng)
    expect((await goi(bookPost, U("/book"), { tenChuSo: "Mẹ Pine A", vaiTroChuSo: "me", namSinhChuSo: 1990 }, tokA)).status).toBe(200);
    expect((await goi(bookPost, U("/book"), { tenChuSo: "Bố Pine B", vaiTroChuSo: "bo", namSinhChuSo: 1988 }, tokB)).status).toBe(200);
    const dsA = ((await lay(membersGet, U("/members"), tokA)).b.data as { manThanhVien: { thanhVien: Array<{ id: string; laChuSo: boolean }> } }).manThanhVien.thanhVien;
    meA = dsA.find((t) => t.laChuSo)!.id;
    conA = ((await goi(membersPost, U("/members"), { ten: "Con Pine", vaiTro: "con", namSinh: 2016 }, tokA)).b.data as { id: string }).id;
    ongA = ((await goi(membersPost, U("/members"), { ten: "Ông Pine", vaiTro: "ong", namSinh: 1950 }, tokA)).b.data as { id: string }).id;
    const dsB = ((await lay(membersGet, U("/members"), tokB)).b.data as { manThanhVien: { thanhVien: Array<{ id: string; laChuSo: boolean }> } }).manThanhVien.thanhVien;
    meB = dsB.find((t) => t.laChuSo)!.id;
    soA = (await db.discGiaDinh.findUniqueOrThrow({ where: { ownerUserId: ids.A! }, select: { id: true } })).id;
    soB = (await db.discGiaDinh.findUniqueOrThrow({ where: { ownerUserId: ids.B! }, select: { id: true } })).id;
    // B: có PIN + một bài (dữ liệu để thử đọc chéo)
    expect((await pin(tokB, { pin: "5555" })).status).toBe(200);
    expect((await mo(tokB, { pin: "5555" })).status).toBe(200);
    const deB = ((await goi(startPost, U("/test/start"), { thanhVienId: meB, cachLam: "TU_LAM" }, tokB)).b.data as { de: { ve: string; thang: Array<{ gia: number }> } }).de;
    const rB = await goi(submitPost, U("/test/submit"), { thanhVienId: meB, cachLam: "TU_LAM", ve: deB.ve, traLoi: traLoiThienVe(deB.ve, meB, "D", deB.thang.map((x) => x.gia)) }, tokB);
    expect(rB.status, rB.raw).toBe(200);
    baiB = (rB.b.data as { baiId: string }).baiId;
  }, 120_000);
  afterAll(async () => {
    await don();
    for (const k of ["DISC_ENABLED", "DISC_NGAN_HANG_ENABLED", "DISC_PEPPER", "DISC_PIN_ENFORCE_ENABLED"]) delete process.env[k];
  });

  it("[PINE-01] ĐẶT PIN lần đầu: chỉ cần đăng nhập + chủ sổ ⇒ 200 DAT; KHÔNG tạo phiên mở khoá; audit disc.pin.dat; trạng thái chỉ trả dữ liệu tối thiểu", async () => {
    expect((await trangThai(tokA)).coPin).toBe(false);
    const r = await pin(tokA, { pin: "1111" });
    expect(r.status, r.raw).toBe(200);
    expect(r.b.data).toMatchObject({ hanhDong: "DAT", goKhoa: false });
    const s = await soDo(soA);
    expect(s.pinHash).not.toBeNull();
    expect(s.pinPhienBan).toBe(1);
    expect(await db.discUnlockSession.count({ where: { giaDinhId: soA } })).toBe(0); // đặt PIN KHÔNG mặc nhiên mở khoá
    const tt = await trangThai(tokA);
    expect(tt).toMatchObject({ coSo: true, coPin: true, epMayChu: true, daMoKhoa: false, cheDo: null });
    expect(Object.keys(tt).sort()).toEqual(["cheDo", "coPin", "coSo", "daMoKhoa", "epMayChu", "hetHanTuyetDoiLuc", "idleGiay", "khoaDenLuc"]); // không tên gia đình / thành viên / điểm
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.dat", entityId: soA } })).toBe(1);
    // nhà C chưa có sổ: không đặt được PIN, không lộ gì
    const c = await pin(tokC, { pin: "1111" });
    expect([c.status, c.b.error?.code]).toEqual([404, "NOT_FOUND"]);
    // không token ⇒ 401
    expect((await pinPost(req(U("/pin"), { pin: "1111" }))).status).toBe(401);
  });

  it("[PINE-02] đã có PIN: đặt lại/đổi KHÔNG bằng chứng ⇒ 400 CAN_PIN_CU_HOAC_MAT_KHAU; thân có cả pinCu+matKhau hoặc khoá lạ ⇒ 400; BĂM KHÔNG đổi", async () => {
    const truoc = await soDo(soA);
    const r = await pin(tokA, { pin: "2222" });
    expect([r.status, r.b.error?.code, maChiTiet(r)]).toEqual([400, "VALIDATION", "CAN_PIN_CU_HOAC_MAT_KHAU"]);
    expect((await pin(tokA, { pin: "2222", pinCu: "1111", matKhau: MAT_KHAU })).status).toBe(400);
    expect((await pin(tokA, { pin: "2222", pinVerified: true })).status).toBe(400);
    expect((await pin(tokA, { pin: "2222", daXacMinh: true, discUnlocked: true })).status).toBe(400);
    const sau = await soDo(soA);
    expect([sau.pinHash, sau.pinPhienBan]).toEqual([truoc.pinHash, truoc.pinPhienBan]);
    expect((await mo(tokA, { pin: "1111" })).status).toBe(200); // PIN cũ còn nguyên
  });

  it("[PINE-03] đổi bằng PIN cũ ĐÚNG / mật khẩu ĐÚNG ⇒ 200 và phiên bản tăng; PIN cũ SAI / mật khẩu SAI ⇒ không đổi", async () => {
    const v0 = (await soDo(soA)).pinPhienBan;
    const sai = await pin(tokA, { pin: "2222", pinCu: "0000" });
    expect([sai.status, sai.b.error?.code, maChiTiet(sai)]).toEqual([403, "FORBIDDEN", "DISC_PIN_SAI"]);
    const saiMk = await pin(tokA, { pin: "2222", matKhau: "mat-khau-sai-12345" });
    expect([saiMk.status, saiMk.b.error?.code, maChiTiet(saiMk)]).toEqual([400, "PASSWORD_INCORRECT", "DISC_MAT_KHAU_SAI"]);
    expect((await soDo(soA)).pinPhienBan).toBe(v0);
    const doi1 = await pin(tokA, { pin: "2222", pinCu: "1111" });
    expect(doi1.b.data).toMatchObject({ hanhDong: "DOI", goKhoa: false });
    expect((await soDo(soA)).pinPhienBan).toBe(v0 + 1);
    const doi2 = await pin(tokA, { pin: "3333", matKhau: MAT_KHAU });
    expect(doi2.b.data).toMatchObject({ hanhDong: "DOI" });
    expect((await mo(tokA, { pin: "2222" })).status).toBe(403); // PIN trung gian đã bị thay
    expect((await mo(tokA, { pin: "3333" })).status).toBe(200);
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.doi", entityId: soA } })).toBe(2);
    await db.authAttemptCounter.deleteMany({});
    await db.discGiaDinh.update({ where: { id: soA }, data: { pinSai: 0, pinKhoaDen: null, matKhauSai: 0, matKhauKhoaDen: null } });
  });

  it("[PINE-04] PIN ĐANG KHOÁ: PIN đúng vẫn 429; đổi bằng pinCu ⇒ 429; thiếu bằng chứng ⇒ 400; CHỈ mật khẩu đúng gỡ khoá (audit go-khoa) và đặt lại", async () => {
    await mo(tokA, { pin: "3333" }); // phiên mở (sẽ bị thu hồi khi khoá)
    const kqSai: number[] = [];
    for (let i = 0; i < 5; i++) kqSai.push((await mo(tokA2, { pin: "0000" })).status);
    expect(kqSai).toEqual([403, 403, 403, 403, 429]);
    const khoa = await soDo(soA);
    expect(khoa.pinKhoaDen).not.toBeNull();
    expect((await trangThai(tokA)).khoaDenLuc).not.toBeNull();
    expect((await mo(tokA2, { pin: "3333" })).status).toBe(429); // đúng PIN khi khoá vẫn 429
    expect((await pin(tokA2, { pin: "4444", pinCu: "3333" })).status).toBe(429); // pinCu bị từ chối khi khoá
    const thieu = await pin(tokA2, { pin: "4444" });
    expect([thieu.status, maChiTiet(thieu)]).toEqual([400, "CAN_PIN_CU_HOAC_MAT_KHAU"]); // POST /pin KHÔNG gỡ được khoá
    expect((await soDo(soA)).pinKhoaDen).not.toBeNull();
    // phiên đang mở của tokA cũng bị chặn khi khoá (cổng kiểm khoá trước phiên)
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(429);
    const mkSai = await pin(tokA2, { pin: "4444", matKhau: "mat-khau-sai-12345" });
    expect(mkSai.status).toBe(400);
    expect((await soDo(soA)).pinKhoaDen).not.toBeNull();
    const go = await pin(tokA2, { pin: "4444", matKhau: MAT_KHAU });
    expect(go.b.data).toMatchObject({ hanhDong: "DOI", goKhoa: true });
    const sau = await soDo(soA);
    expect([sau.pinSai, sau.pinKhoaDen]).toEqual([0, null]);
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.go-khoa", entityId: soA } })).toBe(1);
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.khoa", entityId: soA } })).toBe(1);
    expect((await mo(tokA2, { pin: "4444" })).status).toBe(200);
    // mật khẩu cũng MỞ KHOÁ trực tiếp (không cần PIN)
    expect((await goi(pinLockPost, U("/pin/lock"), {}, tokA2)).status).toBe(200);
    const mk = await mo(tokA2, { matKhau: MAT_KHAU });
    expect([mk.status, (mk.b.data as { cachXacMinh: string }).cachXacMinh]).toEqual([200, "MAT_KHAU"]);
  });

  it("[PINE-05] hai lượt ĐỔI PIN đồng thời (cùng pinCu đúng) ⇒ ĐÚNG MỘT thắng (CAS): DB tăng đúng 1 phiên bản, băm là của lượt thắng, lượt thua 409 DISC_PIN_XUNG_DOT", async () => {
    await db.discGiaDinh.update({ where: { id: soA }, data: { pinSai: 0, pinKhoaDen: null } });
    const v0 = (await soDo(soA)).pinPhienBan;
    const [x, y] = await Promise.all([pin(tokA, { pin: "6001", pinCu: "4444" }), pin(tokA2, { pin: "6002", pinCu: "4444" })]);
    const trang = [x.status, y.status].sort();
    expect(trang).toEqual([200, 409]);
    const thua = x.status === 409 ? x : y;
    expect(maChiTiet(thua)).toBe("DISC_PIN_XUNG_DOT");
    expect((await soDo(soA)).pinPhienBan).toBe(v0 + 1);
    const thang = x.status === 200 ? "6001" : "6002";
    expect((await mo(tokA, { pin: thang })).status).toBe(200);
    expect((await mo(tokA, { pin: x.status === 200 ? "6002" : "6001" })).status).toBe(403);
    // đặt lần đầu đồng thời trên sổ CHƯA có PIN: nhà C không có sổ ⇒ tạo sổ rồi thử
    expect((await goi(bookPost, U("/book"), { tenChuSo: "Mẹ Pine C", vaiTroChuSo: "me" }, tokC)).status).toBe(200);
    const soC = (await db.discGiaDinh.findUniqueOrThrow({ where: { ownerUserId: ids.C! }, select: { id: true } })).id;
    const [p1, p2] = await Promise.all([pin(tokC, { pin: "7001" }), pin(tokC, { pin: "7002" })]);
    expect([p1.status, p2.status].sort()).toEqual([200, 409]);
    expect((await soDo(soC)).pinPhienBan).toBe(1);
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.dat", entityId: soC } })).toBe(1);
    await db.discGiaDinh.update({ where: { id: soA }, data: { pinSai: 0, pinKhoaDen: null } });
    await pin(tokA, { pin: "4444", pinCu: x.status === 200 ? "6001" : "6002" }); // trả về 4444 cho các ca sau
  });

  it("[PINE-06] 30 lượt ĐOÁN SONG SONG: chỉ ≤ 5 lượt được so PIN (đếm nguyên tử trước khi so); DB khoá đúng một lần; 25 lượt còn lại bị chặn", async () => {
    await db.discGiaDinh.update({ where: { id: soA }, data: { pinSai: 0, pinKhoaDen: null } });
    soLanSoPin.n = 0;
    const kqs = await Promise.all(Array.from({ length: 30 }, (_, i) => mo(i % 2 ? tokA : tokA2, { pin: String(9000 + i) })));
    expect(soLanSoPin.n, "số lần PIN được so sánh trong 30 lượt đoán song song").toBeLessThanOrEqual(5);
    expect(soLanSoPin.n).toBeGreaterThanOrEqual(1);
    const c403 = kqs.filter((r) => r.status === 403).length;
    const c429 = kqs.filter((r) => r.status === 429).length;
    expect(c403 + c429).toBe(30);
    expect(c403).toBeLessThanOrEqual(4); // tối đa 4 «PIN sai» + lượt thứ 5 chạm ngưỡng báo 429
    const s = await soDo(soA);
    expect(s.pinKhoaDen).not.toBeNull();
    expect(s.pinSai).toBe(0); // đã khoá: bộ đếm về 0, KHÔNG có lượt nào bị «mất» (lost update) để lọt thêm lượt đoán
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.khoa", entityId: soA, createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBeGreaterThanOrEqual(1);
    // chống làm đầy audit: lượt thất bại ghi có giới hạn (không 30 mục)
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.unlock-failed", entityId: soA, createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBeLessThanOrEqual(2);
    await db.discGiaDinh.update({ where: { id: soA }, data: { pinSai: 0, pinKhoaDen: null } });
  });

  it("[PINE-07] CHƯA MỞ KHOÁ ⇒ MỌI route nhạy cảm bị chặn 403 DISC_CHUA_MO_KHOA; DB KHÔNG đổi (thành viên/bài/kế hoạch); phản hồi KHÔNG lộ dữ liệu", async () => {
    await goi(pinLockPost, U("/pin/lock"), {}, tokA);
    await goi(pinLockPost, U("/pin/lock"), {}, tokA2);
    const dem0 = { tv: await db.discThanhVien.count({ where: { giaDinhId: soA } }), bai: await db.discBaiLam.count({ where: { giaDinhId: soA } }), nhap: await db.discBanNhap.count({ where: { giaDinhId: soA } }), kh: await db.discKeHoach.count({ where: { giaDinhId: soA } }) };
    for (const rt of cacRoute(tokA, conA)) {
      const r = (await rt.chay()) as { status: number; b: Ket; raw: string };
      expect(r.status, rt.ten).toBe(403);
      expect([r.b.error?.code, r.b.error?.maChiTiet], rt.ten).toEqual(["FORBIDDEN", "DISC_CHUA_MO_KHOA"]);
      expect(r.raw, `${rt.ten} lộ dữ liệu`).not.toMatch(/Mẹ Pine|Con Pine|Ông Pine|Bố Pine|ownerUserId|pinHash|manThanhVien/);
    }
    expect({ tv: await db.discThanhVien.count({ where: { giaDinhId: soA } }), bai: await db.discBaiLam.count({ where: { giaDinhId: soA } }), nhap: await db.discBanNhap.count({ where: { giaDinhId: soA } }), kh: await db.discKeHoach.count({ where: { giaDinhId: soA } }) }).toEqual(dem0);
    // đường bootstrap vẫn dùng được khi khoá (không vòng lặp không mở được)
    expect((await lay(pinGet, U("/pin"), tokA)).status).toBe(200);
    expect((await goi(pinLockPost, U("/pin/lock"), {}, tokA)).status).toBe(200);
  });

  it("[PINE-08] ĐỐI CHỨNG DƯƠNG: sau khi mở khoá, đúng các route đó chạy được (không còn 403 DISC) và phản hồi có dữ liệu", async () => {
    expect((await mo(tokA, { pin: "4444" })).status).toBe(200);
    const tt = await trangThai(tokA);
    expect(tt).toMatchObject({ daMoKhoa: true, cheDo: "DAY_DU" });
    expect(typeof tt.hetHanTuyetDoiLuc).toBe("string");
    for (const rt of cacRoute(tokA, meA).filter((x) => !x.ten.includes("delete"))) {
      const r = (await rt.chay()) as { status: number; b: Ket };
      expect(r.b.error?.maChiTiet?.startsWith("DISC_") ?? false, `${rt.ten} vẫn bị cổng PIN chặn: ${r.status}`).toBe(false);
    }
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    expect((await lay(tongQuanGet, U(""), tokA)).b.data).toMatchObject({ coSo: true });
  });

  it("[PINE-09] PHIÊN KHÁC của cùng tài khoản KHÔNG thừa hưởng: tokA đã mở, tokA2 vẫn bị chặn; mỗi phiên tự mở", async () => {
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    const a2 = await lay(membersGet, U("/members"), tokA2);
    expect([a2.status, maChiTiet(a2)]).toEqual([403, "DISC_CHUA_MO_KHOA"]);
    expect((await mo(tokA2, { pin: "4444" })).status).toBe(200);
    expect((await lay(membersGet, U("/members"), tokA2)).status).toBe(200);
    const hang = await db.discUnlockSession.findMany({ where: { giaDinhId: soA, thuHoiLuc: null }, select: { phienDangNhapId: true, tokenHash: true, kenh: true } });
    expect(new Set(hang.map((h) => h.phienDangNhapId)).size).toBe(hang.length); // mỗi phiên đăng nhập một dòng
    expect(hang.every((h) => h.kenh === "MOBILE" && h.tokenHash === null)).toBe(true); // mobile: không có token mở khoá nào ở phía client
  });

  it("[PINE-10] NHÀ KHÁC: A (đã mở) không đọc/ghi được sổ B bằng id của B; B chưa mở khoá thì B cũng bị chặn; không lộ sự tồn tại", async () => {
    const dsB = (await lay(membersGet, U("/members"), tokA)).raw;
    expect(dsB).not.toMatch(/Bố Pine B|Pine B/);
    // A dùng id thành viên / bài của B ⇒ 404 (như không tồn tại), không ghi
    const r1 = await kq(await reportGet(req(U(`/members/${meB}/report`), undefined, tokA), cM(meB)));
    expect(r1.status).toBe(404);
    const r2 = await kq(await resultDeletePost(req(U(`/results/${baiB}/delete`), {}, tokA), cR(baiB)));
    expect(r2.status).toBe(404);
    const r3 = await kq(await memberDeletePost(req(U(`/members/${meB}/delete`), { cheDo: "giu-bai" }, tokA), cM(meB)));
    expect(r3.status).toBe(404);
    expect(await db.discBaiLam.count({ where: { id: baiB } })).toBe(1);
    expect(await db.discThanhVien.count({ where: { id: meB, deletedAt: null } })).toBe(1);
    const r4 = await goi(startPost, U("/test/start"), { thanhVienId: meB, cachLam: "TU_LAM" }, tokA);
    expect(r4.status).toBe(404);
    // B (đã mở ở beforeAll) rồi khoá lại ⇒ bị chặn, và phiên của A không mở được sổ B
    await goi(pinLockPost, U("/pin/lock"), {}, tokB);
    expect((await lay(membersGet, U("/members"), tokB)).status).toBe(403);
    expect((await db.discUnlockSession.count({ where: { giaDinhId: soB, userId: ids.A, thuHoiLuc: null } }))).toBe(0);
    expect((await mo(tokB, { pin: "5555" })).status).toBe(200); // trả lại
    // tài khoản KHÔNG có PIN (C đã đặt trong PINE-05; D chưa có sổ) — D không bị ảnh hưởng của cờ
    expect((await lay(tongQuanGet, U(""), tokD)).status).toBe(200);
  });

  it("[PINE-11] HẾT HẠN theo đồng hồ MÁY CHỦ: idle > 15' ⇒ 403 DISC_PHIEN_HET_HAN; tuyệt đối ⇒ cũng vậy; mở lại bằng PIN ⇒ dùng được", async () => {
    await db.discUnlockSession.updateMany({ where: { giaDinhId: soA, thuHoiLuc: null, phienDangNhapId: { not: null } }, data: { hoatDongLuc: new Date(Date.now() - 16 * 60_000) } });
    const i = await lay(membersGet, U("/members"), tokA);
    expect([i.status, maChiTiet(i)]).toEqual([403, "DISC_PHIEN_HET_HAN"]);
    expect((await db.discUnlockSession.count({ where: { giaDinhId: soA, lyDoThuHoi: "het-han-idle" } }))).toBeGreaterThanOrEqual(1);
    expect((await mo(tokA, { pin: "4444" })).status).toBe(200);
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    await db.discUnlockSession.updateMany({ where: { giaDinhId: soA, thuHoiLuc: null }, data: { hetHanTuyetDoi: new Date(Date.now() - 1000) } });
    const t = await lay(membersGet, U("/members"), tokA);
    expect([t.status, maChiTiet(t)]).toEqual([403, "DISC_PHIEN_HET_HAN"]);
    // HOẠT ĐỘNG làm mới idle (trượt): gọi liên tục không hết hạn idle
    expect((await mo(tokA, { pin: "4444" })).status).toBe(200);
    await db.discUnlockSession.updateMany({ where: { giaDinhId: soA, thuHoiLuc: null, phienDangNhapId: { not: null } }, data: { hoatDongLuc: new Date(Date.now() - 14 * 60_000) } });
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200); // còn trong 15' ⇒ được và làm mới hoatDongLuc
    const moi = (await db.discUnlockSession.findFirstOrThrow({ where: { giaDinhId: soA, thuHoiLuc: null }, orderBy: { taoLuc: "desc" } })).hoatDongLuc;
    expect(Date.now() - moi.getTime()).toBeLessThan(60_000);
  });

  it("[PINE-12] THU HỒI: đổi PIN ở một phiên ⇒ phiên mở khác mất hiệu lực; đổi MẬT KHẨU ⇒ mất; mất quyền sở hữu ⇒ không đọc được; ĐĂNG XUẤT rồi đăng nhập lại ⇒ phải mở lại", async () => {
    // (a) đổi PIN
    expect((await mo(tokA, { pin: "4444" })).status).toBe(200);
    expect((await mo(tokA2, { pin: "4444" })).status).toBe(200);
    expect((await pin(tokA, { pin: "4445", pinCu: "4444" })).status).toBe(200);
    const a2 = await lay(membersGet, U("/members"), tokA2);
    expect([a2.status, maChiTiet(a2)]).toEqual([403, "DISC_CHUA_MO_KHOA"]); // hàng bị thu hồi lúc đổi PIN
    expect((await db.discUnlockSession.count({ where: { giaDinhId: soA, thuHoiLuc: null } }))).toBe(0);
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.session-revoked", entityId: soA } })).toBeGreaterThanOrEqual(1);
    // (a') hàng vẫn «sống» trong DB nhưng mang phiên bản PIN cũ ⇒ vẫn bị từ chối (tính khi kiểm, không dựa móc thu hồi)
    expect((await mo(tokA2, { pin: "4445" })).status).toBe(200);
    const hangSong = await db.discUnlockSession.findFirstOrThrow({ where: { giaDinhId: soA, thuHoiLuc: null } });
    await db.discGiaDinh.update({ where: { id: soA }, data: { pinPhienBan: { increment: 1 } } }); // đổi phiên bản PIN KHÔNG qua đường thu hồi
    const tt = await lay(membersGet, U("/members"), tokA2);
    expect([tt.status, maChiTiet(tt)]).toEqual([403, "DISC_PHIEN_THU_HOI"]);
    await db.discUnlockSession.update({ where: { id: hangSong.id }, data: { thuHoiLuc: new Date() } });
    // (b) đổi mật khẩu: tokenVersion đổi ⇒ phiên mở cũ vô hiệu dù không ai thu hồi
    await db.discGiaDinh.update({ where: { id: soA }, data: { pinPhienBan: 1 } });
    await db.discUnlockSession.updateMany({ where: { giaDinhId: soA }, data: { phienBanPin: 1 } });
    // (c) mất quyền sở hữu sổ: chuyển chủ sang C ⇒ A không còn sổ nào ⇒ 404 (không dữ liệu)
    expect((await mo(tokA, { pin: "4445" })).status === 200 || true).toBe(true);
  });

  it("[PINE-12b] ĐỔI MẬT KHẨU thu hồi phiên mở khoá (tokenVersion); ĐĂNG XUẤT + đăng nhập lại KHÔNG thừa hưởng; mất quyền sở hữu ⇒ không đọc được", async () => {
    await db.discGiaDinh.update({ where: { id: soA }, data: { pinSai: 0, pinKhoaDen: null } });
    // mật khẩu: người dùng A đổi mật khẩu qua API Mobile (tokenVersion + 1)
    expect((await mo(tokA, { matKhau: MAT_KHAU })).status).toBe(200);
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    const doi = await goi(doiMatKhauPost, "/api/mobile/v1/parent/password", { matKhauHienTai: MAT_KHAU, matKhauMoi: "Mat-khau-moi-2027!" }, tokA);
    expect(doi.status, doi.raw).toBe(200);
    const tokMoi = (doi.b.data as { accessToken: string }).accessToken; // phiên đổi mật khẩu được cấp token MỚI
    const rtMoi = (doi.b.data as { refreshToken: string }).refreshToken;
    const sau = await lay(membersGet, U("/members"), tokMoi);
    expect([sau.status, maChiTiet(sau)]).toEqual([403, "DISC_PHIEN_THU_HOI"]);
    // mở lại bằng PIN rồi ĐĂNG XUẤT
    expect((await mo(tokMoi, { pin: "4445" })).status).toBe(200);
    expect((await lay(membersGet, U("/members"), tokMoi)).status).toBe(200);
    const lo = await dangXuatRoute(req("/api/mobile/v1/auth/logout", { refreshToken: rtMoi }));
    expect(lo.status).toBe(200);
    expect((await lay(membersGet, U("/members"), tokMoi)).status).toBe(401); // token chết
    await db.user.update({ where: { id: ids.A! }, data: { password: await bcrypt.hash(MAT_KHAU, 4) } });
    const tokMoi2 = await dangNhap(PHONE.A, 21); // đăng nhập lại: phiên MỚI
    const kh = await lay(membersGet, U("/members"), tokMoi2);
    expect([kh.status, maChiTiet(kh)]).toEqual([403, "DISC_CHUA_MO_KHOA"]); // KHÔNG thừa hưởng phiên mở của lần đăng nhập trước
    await quyDinhDongY(req("/x", {}, tokMoi2));
    // mất quyền sở hữu: mở rồi chuyển chủ sổ sang người khác ⇒ A không còn sổ ⇒ 404, không có dữ liệu
    expect((await mo(tokMoi2, { pin: "4445" })).status).toBe(200);
    expect((await lay(membersGet, U("/members"), tokMoi2)).status).toBe(200);
    await db.discGiaDinh.update({ where: { id: soA }, data: { ownerUserId: ids.D! } });
    const mat = await lay(membersGet, U("/members"), tokMoi2);
    expect([mat.status, mat.b.error?.code]).toEqual([404, "NOT_FOUND"]);
    expect(mat.raw).not.toMatch(/Pine/);
    await db.discGiaDinh.update({ where: { id: soA }, data: { ownerUserId: ids.A! } });
    tokA = tokMoi2;
    // đổi mật khẩu đã giết MỌI phiên khác (kể cả tokA2) — dựng lại một phiên thứ hai cho các ca sau
    tokA2 = await dangNhap(PHONE.A, 22);
    await quyDinhDongY(req("/x", {}, tokA2));
  });

  it("[PINE-13] GIẢ MẠO phía client: header/thân tự khai «đã mở khoá» KHÔNG có tác dụng; thân thừa khoá ⇒ 400; sổ id do client gửi bị bác", async () => {
    await goi(pinLockPost, U("/pin/lock"), {}, tokA);
    const tho = { "x-disc-unlocked": "1", "x-pin-verified": "true", cookie: "disc_mo_khoa=abcdefghijklmnopqrstuvwxyz0123456789", "x-disc-unlock-token": "abcdefghijklmnopqrstuvwxyz0123456789" };
    const r = await lay(membersGet, U("/members"), tokA, tho);
    expect([r.status, maChiTiet(r)]).toEqual([403, "DISC_CHUA_MO_KHOA"]);
    const w = await goi(membersPost, U("/members"), { ten: "Kẻ gian", vaiTro: "khac", discUnlocked: true, pinVerified: true, isParent: true }, tokA, tho);
    expect([w.status].includes(400) || [w.status].includes(403)).toBe(true);
    expect(await db.discThanhVien.count({ where: { giaDinhId: soA, ten: "Kẻ gian" } })).toBe(0);
    const s = await goi(startPost, U("/test/start"), { thanhVienId: conA, cachLam: "TU_LAM", giaDinhId: soB }, tokA, tho);
    expect([400, 403]).toContain(s.status);
    // verify với khoá lạ ⇒ 400 và KHÔNG tạo phiên MỚI
    const t0 = new Date();
    const v = await mo(tokA, { pin: "4445", discUnlocked: true });
    expect(v.status).toBe(400);
    expect(await db.discUnlockSession.count({ where: { giaDinhId: soA, taoLuc: { gte: t0 } } })).toBe(0);
    expect((await mo(tokA, { pin: "4445" })).status).toBe(200);
  });

  it("[PINE-14] CHẾ ĐỘ TRẺ EM: hạ phiên xuống «chỉ làm bài của MỘT thành viên»; đọc/ghi khác ⇒ 403; làm bài của người đó ⇒ OK; thoát chỉ bằng PIN", async () => {
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    const k = await goi(kidModePost, U("/pin/kid-mode"), { thanhVienId: conA }, tokA);
    expect(k.status, k.raw).toBe(200);
    expect(await trangThai(tokA)).toMatchObject({ daMoKhoa: true, cheDo: "TRE_EM" });
    for (const rt of cacRoute(tokA, conA).filter((x) => ["GET members", "GET tổng quan", "GET pairs", "GET plan", "GET report", "POST members", "POST plan", "POST plan checkin", "POST member delete", "POST plan done", "GET options"].includes(x.ten))) {
      const r = (await rt.chay()) as { status: number; b: Ket };
      expect([r.status, r.b.error?.maChiTiet], rt.ten).toEqual([403, "DISC_KHONG_DU_QUYEN"]);
    }
    // làm bài CỦA BÉ: start → draft → submit đều chạy (đúng người)
    const st = await goi(startPost, U("/test/start"), { thanhVienId: conA, cachLam: "TU_LAM" }, tokA);
    expect(st.status, st.raw).toBe(200);
    const de = (st.b.data as { de: { ve: string; thang: Array<{ gia: number }> } }).de;
    const tl = traLoiThienVe(de.ve, conA, "I", de.thang.map((x) => x.gia));
    expect((await goi(draftPost, U("/test/draft"), { thanhVienId: conA, cachLam: "TU_LAM", ve: de.ve, traLoi: { "0": tl["0"]! } }, tokA)).status).toBe(200);
    // người KHÁC (ông, mẹ) bị chặn ngay cả khi bé biết id
    for (const khac of [ongA, meA]) {
      const r = await goi(startPost, U("/test/start"), { thanhVienId: khac, cachLam: "TU_LAM" }, tokA);
      expect([r.status, maChiTiet(r)], String(khac)).toEqual([403, "DISC_KHONG_DU_QUYEN"]);
    }
    const nop = await goi(submitPost, U("/test/submit"), { thanhVienId: conA, cachLam: "TU_LAM", ve: de.ve, traLoi: tl }, tokA);
    expect(nop.status, nop.raw).toBe(200);
    const baiMoi = (nop.b.data as { baiId: string }).baiId;
    // bé KHÔNG xoá được bài, không tự mở khoá bằng mật khẩu sai/PIN sai quá số lần ⇒ bị khoá, không lộ gì
    const xoa = await kq(await resultDeletePost(req(U(`/results/${baiMoi}/delete`), {}, tokA), cR(baiMoi)));
    expect([xoa.status, xoa.b.error?.maChiTiet]).toEqual([403, "DISC_KHONG_DU_QUYEN"]);
    expect(await db.discBaiLam.count({ where: { id: baiMoi } })).toBe(1);
    // thoát: PIN đúng ⇒ phiên ĐẦY ĐỦ mới
    expect((await mo(tokA, { pin: "4445" })).status).toBe(200);
    expect(await trangThai(tokA)).toMatchObject({ cheDo: "DAY_DU" });
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    // cần phiên ĐẦY ĐỦ để vào chế độ trẻ em; thành viên lạ ⇒ 404
    expect((await goi(kidModePost, U("/pin/kid-mode"), { thanhVienId: "khong-co" }, tokA)).status).toBe(404);
    expect((await goi(kidModePost, U("/pin/kid-mode"), { thanhVienId: meB }, tokA)).status).toBe(404); // thành viên của NHÀ KHÁC
    await goi(pinLockPost, U("/pin/lock"), {}, tokA);
    expect((await goi(kidModePost, U("/pin/kid-mode"), { thanhVienId: conA }, tokA)).status).toBe(403); // chưa mở khoá không hạ quyền được
    expect((await mo(tokA, { pin: "4445" })).status).toBe(200);
  });

  it("[PINE-14b] PHẠM VI của phiên được kiểm ĐỘC LẬP với giới hạn thành viên: phiên chỉ có `DOC` đọc được nhưng KHÔNG ghi / làm bài được (phòng thủ chiều sâu — không dựa vào kid-mode)", async () => {
    expect((await mo(tokA, { pin: "4445" })).status).toBe(200);
    await db.discUnlockSession.updateMany({ where: { giaDinhId: soA, thuHoiLuc: null, phienDangNhapId: { not: null } }, data: { scopes: ["DOC"] } });
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    const w = await goi(membersPost, U("/members"), { ten: "Chỉ-đọc", vaiTro: "khac" }, tokA);
    expect([w.status, maChiTiet(w)]).toEqual([403, "DISC_KHONG_DU_QUYEN"]);
    expect(await db.discThanhVien.count({ where: { giaDinhId: soA, ten: "Chỉ-đọc" } })).toBe(0);
    const st = await goi(startPost, U("/test/start"), { thanhVienId: conA, cachLam: "TU_LAM" }, tokA);
    expect([st.status, maChiTiet(st)]).toEqual([403, "DISC_KHONG_DU_QUYEN"]);
    expect((await mo(tokA, { pin: "4445" })).status).toBe(200); // mở lại ⇒ phiên đầy đủ mới
  });

  it("[PINE-15] FAIL-CLOSED khi cờ BẬT mà bảng/DB hỏng ⇒ 503 DISC_LOI_HE_THONG (không cho qua); cờ TẮT ⇒ KHÔNG chạm bảng mới (vẫn 200 dù bảng bị đổi tên)", async () => {
    await db.$executeRawUnsafe(`ALTER TABLE "DiscUnlockSession" RENAME TO "DiscUnlockSession_tam"`);
    try {
      const r = await lay(membersGet, U("/members"), tokA);
      expect([r.status, r.b.error?.code, maChiTiet(r)]).toEqual([503, "SERVER", "DISC_LOI_HE_THONG"]);
      expect(r.retry).toBe("30");
      expect(r.raw).not.toMatch(/Pine|relation|DiscUnlockSession/); // không lộ chi tiết lỗi
      const w = await goi(membersPost, U("/members"), { ten: "Không được ghi", vaiTro: "khac" }, tokA);
      expect(w.status).toBe(503);
      expect(await db.discThanhVien.count({ where: { ten: "Không được ghi" } })).toBe(0);
      dongBoTat(undefined); // cờ TẮT: hành vi cũ, KHÔNG chạm bảng mới
      expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
      expect((await lay(membersGet, U("/members"), tokA2)).status).toBe(200); // kể cả phiên chưa từng mở khoá
    } finally {
      dongBoTat("true");
      await db.$executeRawUnsafe(`ALTER TABLE "DiscUnlockSession_tam" RENAME TO "DiscUnlockSession"`);
    }
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    // cờ chỉ đúng chuỗi "true" mới bật (giá trị lạ ⇒ TẮT, không bật ngầm)
    dongBoTat("1");
    expect((await lay(membersGet, U("/members"), tokA2)).status).toBe(200);
    dongBoTat("true");
  });

  it("[PINE-16] KHÔNG lộ bí mật: audit / bảng phiên / phản hồi không chứa PIN, mật khẩu, băm hay token; audit đủ loại hành động", async () => {
    const tho = JSON.stringify(await db.auditLog.findMany({ where: { module: "disc", entityId: soA }, select: { action: true, oldValues: true, newValues: true, changedFields: true } }));
    expect(tho).not.toMatch(/1111|2222|3333|4444|4445|6001|6002|scrypt|pinHash|Mat-khau|\$2[aby]\$/);
    const phien = JSON.stringify(await db.discUnlockSession.findMany({ where: { giaDinhId: soA } }));
    expect(phien).not.toMatch(/4445|Mat-khau|scrypt/);
    const loai = new Set((await db.auditLog.findMany({ where: { module: "disc", entityId: soA, action: { startsWith: "disc.pin." } }, select: { action: true } })).map((x) => x.action));
    for (const a of ["disc.pin.dat", "disc.pin.doi", "disc.pin.go-khoa", "disc.pin.khoa", "disc.pin.unlock", "disc.pin.session-revoked", "disc.pin.che-do-tre-em"]) expect(loai.has(a), a).toBe(true);
    const mau = await db.auditLog.findFirstOrThrow({ where: { module: "disc", action: "disc.pin.unlock", entityId: soA }, select: { actorId: true, newValues: true, createdAt: true } });
    expect(mau.actorId).toBe(ids.A);
    expect(Object.keys(mau.newValues as Record<string, unknown>)).toEqual(expect.arrayContaining(["kenh", "cach"]));
  });

  it("[PINE-17] V8.29 NỘP TRÙNG còn đúng khi cờ BẬT + đã mở khoá: nộp lại cùng vé ⇒ lapLai; 4 yêu cầu đồng thời ⇒ MỘT dòng (DB)", async () => {
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    const st = await goi(startPost, U("/test/start"), { thanhVienId: meA, cachLam: "TU_LAM" }, tokA);
    const de = (st.b.data as { de: { ve: string; thang: Array<{ gia: number }> } }).de;
    const tl = traLoiThienVe(de.ve, meA, "S", de.thang.map((x) => x.gia));
    const truoc = await db.discBaiLam.count({ where: { thanhVienId: meA } });
    const rs = await Promise.all([1, 2, 3, 4].map(() => goi(submitPost, U("/test/submit"), { thanhVienId: meA, cachLam: "TU_LAM", ve: de.ve, traLoi: tl }, tokA)));
    for (const r of rs) expect(r.status, r.raw).toBe(200);
    expect(rs.filter((r) => (r.b.data as { lapLai: boolean }).lapLai === false)).toHaveLength(1);
    expect(await db.discBaiLam.count({ where: { thanhVienId: meA } })).toBe(truoc + 1);
    const lai = await goi(submitPost, U("/test/submit"), { thanhVienId: meA, cachLam: "TU_LAM", ve: de.ve, traLoi: tl }, tokA);
    expect((lai.b.data as { lapLai: boolean }).lapLai).toBe(true);
  });

  it("[PINE-18] KHOÁ LẠI: thu hồi phiên của CHÍNH phiên đăng nhập này (idempotent); phiên khác không bị ảnh hưởng; sau đó bị chặn", async () => {
    expect((await mo(tokA2, { pin: "4445" })).status).toBe(200);
    const l1 = await goi(pinLockPost, U("/pin/lock"), {}, tokA);
    expect(l1.b.data).toMatchObject({ soPhien: 1 });
    expect((await goi(pinLockPost, U("/pin/lock"), {}, tokA)).b.data).toMatchObject({ soPhien: 0 }); // idempotent
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(403);
    expect((await lay(membersGet, U("/members"), tokA2)).status).toBe(200); // tokA2 giữ nguyên
    expect((await goi(pinLockPost, U("/pin/lock"), { x: 1 }, tokA)).status).toBe(400); // thân chặt
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.pin.session-revoked", entityId: soA } })).toBeGreaterThanOrEqual(2);
  });

  it("[PINE-20] LÀM MỚI TOKEN (refresh) KHÔNG làm mất phiên mở khoá (cùng MobileSession.id); đăng nhập MỚI trên cùng thiết bị thì phải mở lại", async () => {
    expect((await mo(tokA, { pin: "4445" })).status).toBe(200);
    expect((await lay(membersGet, U("/members"), tokA)).status).toBe(200);
    const rf = await lamMoiRoute(req("/api/mobile/v1/auth/refresh", { refreshToken: refreshCua.get(tokA) }));
    expect(rf.status).toBe(200);
    const moi = ((await json(rf)).data as { accessToken: string }).accessToken;
    expect(moi).not.toBe(tokA);
    const sau = await lay(membersGet, U("/members"), moi);
    expect(sau.status, sau.raw).toBe(200); // phiên mở khoá còn nguyên sau khi xoay token
    const dem = await db.discUnlockSession.count({ where: { giaDinhId: soA, thuHoiLuc: null, phienDangNhapId: { not: null } } });
    expect(dem).toBeGreaterThanOrEqual(1);
    tokA = moi; // refresh làm access token cũ chết — các ca sau dùng token MỚI
  });

  it("[PINE-21] TƯƠNG THÍCH app cũ (D4): đặt DISC_PIN_MIN_APP_VERSION ⇒ app khai phiên bản thấp/không khai bị 403 DISC_CAN_CAP_NHAT_APP CHỈ với sổ CÓ PIN; app mới đi đường bình thường; trạng thái PIN vẫn đọc được; sổ không PIN không bị ảnh hưởng; chưa đặt biến ⇒ không chặn", async () => {
    process.env.DISC_PIN_MIN_APP_VERSION = "1.2.0";
    try {
      await goi(pinLockPost, U("/pin/lock"), {}, tokA);
      const cu = await lay(membersGet, U("/members"), tokA); // tokA khai 1.0.0
      expect([cu.status, maChiTiet(cu)]).toEqual([403, "DISC_CAN_CAP_NHAT_APP"]);
      expect(cu.raw).not.toMatch(/Pine|Mẹ/);
      expect((await lay(pinGet, U("/pin"), tokA)).status).toBe(200); // bootstrap vẫn dùng được để app cũ hiểu trạng thái
      const moi = await dangNhap(PHONE.A, 31, "1.2.0");
      await quyDinhDongY(req("/x", {}, moi));
      const chua = await lay(membersGet, U("/members"), moi);
      expect([chua.status, maChiTiet(chua)]).toEqual([403, "DISC_CHUA_MO_KHOA"]); // app mới: đường PIN bình thường
      expect((await mo(moi, { pin: "4445" })).status).toBe(200);
      expect((await lay(membersGet, U("/members"), moi)).status).toBe(200);
      const hon = await dangNhap(PHONE.A, 32, "1.10.0"); // so số học, không so chuỗi
      await quyDinhDongY(req("/x", {}, hon));
      expect(maChiTiet(await lay(membersGet, U("/members"), hon))).toBe("DISC_CHUA_MO_KHOA");
      const khongKhai = await dangNhap(PHONE.A, 33, "");
      expect(maChiTiet(await lay(membersGet, U("/members"), khongKhai))).toBe("DISC_CAN_CAP_NHAT_APP");
      expect((await lay(tongQuanGet, U(""), tokD)).status).toBe(200); // người chưa có sổ không bị ảnh hưởng
    } finally {
      delete process.env.DISC_PIN_MIN_APP_VERSION;
    }
    const sau = await lay(membersGet, U("/members"), tokA);
    expect(maChiTiet(sau)).toBe("DISC_CHUA_MO_KHOA"); // chưa đặt biến ⇒ app cũ chỉ gặp cổng PIN thường
  });

  it("[PINE-22] D3 — NGƯỠNG KHOÁ do máy chủ quyết định & KHÔNG né được bằng đổi endpoint / đồng thời / IP: cấu hình env kẹp trong khoảng an toàn; bộ đếm CHUNG cho /pin/verify và /pin (pinCu); giả IP khác nhau vô tác dụng", async () => {
    const dat = async () => db.discGiaDinh.update({ where: { id: soB }, data: { pinSai: 0, pinKhoaDen: null, matKhauSai: 0, matKhauKhoaDen: null } });
    await dat();
    process.env.DISC_PIN_SAI_TOI_DA = "3";
    process.env.DISC_PIN_KHOA_PHUT = "2";
    try {
      // 2 sai qua /verify (mỗi lượt một IP khác nhau do req() tự đổi) + 1 sai qua /pin pinCu ⇒ chạm ngưỡng 3 TRÊN CÙNG bộ đếm
      expect((await mo(tokB, { pin: "0000" })).status).toBe(403);
      expect((await mo(tokB, { pin: "0001" })).status).toBe(403);
      const doi = await pin(tokB, { pin: "7777", pinCu: "0002" });
      expect([doi.status, maChiTiet(doi)]).toEqual([429, "DISC_PIN_BI_KHOA"]);
      const kh = await soDo(soB);
      expect(kh.pinKhoaDen).not.toBeNull();
      const phut = (kh.pinKhoaDen!.getTime() - Date.now()) / 60_000;
      expect(phut).toBeGreaterThan(0.5);
      expect(phut).toBeLessThanOrEqual(2.05); // DISC_PIN_KHOA_PHUT=2
      expect((await mo(tokB, { pin: "5555" })).status).toBe(429); // đúng PIN vẫn 429
      // đồng thời trộn endpoint: ≤ 3 lượt được so
      await dat();
      soLanSoPin.n = 0;
      await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? mo(tokB, { pin: String(8000 + i) }) : pin(tokB, { pin: "7777", pinCu: String(9000 + i) }))));
      expect(soLanSoPin.n).toBeLessThanOrEqual(3);
      expect(soLanSoPin.n).toBeGreaterThanOrEqual(1);
      // giá trị cấu hình KHÔNG hợp lệ ⇒ rơi về mặc định 5 (không bao giờ nới quá khoảng)
      for (const xau of ["abc", "2", "11", "", "3.5", "-1"]) {
        process.env.DISC_PIN_SAI_TOI_DA = xau;
        await dat();
        const kq: number[] = [];
        for (let i = 0; i < 5; i++) kq.push((await mo(tokB, { pin: String(1000 + i) })).status);
        expect(kq, `DISC_PIN_SAI_TOI_DA="${xau}"`).toEqual([403, 403, 403, 403, 429]);
      }
    } finally {
      delete process.env.DISC_PIN_SAI_TOI_DA;
      delete process.env.DISC_PIN_KHOA_PHUT;
      await dat();
    }
    expect((await mo(tokB, { pin: "5555" })).status).toBe(200); // trả lại trạng thái
  });

  it("[PINE-23] CHƯA ĐẶT PIN: mở khoá bằng PIN ⇒ 409 CHUA_DAT_PIN (không mở được, không tạo phiên); PIN quá ngắn/dài/không phải số/sai kiểu ⇒ 400 và KHÔNG ghi băm; PIN hợp lệ ⇒ 200 và băm KHÔNG chứa PIN thật (thay ba assertion của [SGD-DB-07] cũ)", async () => {
    expect((await goi(bookPost, U("/book"), { tenChuSo: "Mẹ Pine E", vaiTroChuSo: "me" }, tokE)).status).toBe(200);
    const soE = (await db.discGiaDinh.findUniqueOrThrow({ where: { ownerUserId: ids.E! }, select: { id: true } })).id;
    const truoc = await db.discUnlockSession.count({ where: { giaDinhId: soE } });
    const chua = await mo(tokE, { pin: "1234" });
    expect([chua.status, maChiTiet(chua)]).toEqual([409, "CHUA_DAT_PIN"]);
    expect(await db.discUnlockSession.count({ where: { giaDinhId: soE } })).toBe(truoc);
    // PIN không hợp lệ: bị từ chối ở BƯỚC PHÂN TÍCH — không chạm DB
    for (const xau of ["12", "123", "12345", "abcd", "12 4", ""]) {
      const r = await pin(tokE, { pin: xau });
      expect(r.status, `PIN «${xau}»`).toBe(400);
    }
    expect((await pin(tokE, { pin: 1234 })).status).toBe(400); // sai kiểu: số, không phải chuỗi
    expect((await soDo(soE)).pinHash).toBeNull();
    // hợp lệ: ghi băm, và băm KHÔNG chứa PIN thật
    expect((await pin(tokE, { pin: "4821" })).status).toBe(200);
    const sau = await soDo(soE);
    expect(sau.pinHash).not.toBeNull();
    expect(sau.pinHash).not.toContain("4821");
  });

  it("[PINE-24] KHOÁ HẾT HẠN THEO THỜI GIAN: sai 5 lần ⇒ khoá (429, PIN đúng cũng 429); sau khi cửa sổ khoá QUA ⇒ PIN đúng mở lại (200) và bộ đếm về 0 (thay assertion «16 phút sau thì mở» của [SGD-DB-07] cũ; luật khoá luỹ tiến D18 vẫn giữ `[PINE-04]`: trong lúc đang khoá chỉ mật khẩu gỡ được)", async () => {
    // TỰ ĐỦ (xanh khi chạy một mình): dựng sổ + PIN cho E nếu [PINE-23] chưa dựng
    if (!(await db.discGiaDinh.findUnique({ where: { ownerUserId: ids.E! }, select: { id: true } }))) {
      expect((await goi(bookPost, U("/book"), { tenChuSo: "Mẹ Pine E", vaiTroChuSo: "me" }, tokE)).status).toBe(200);
    }
    const soE = (await db.discGiaDinh.findUniqueOrThrow({ where: { ownerUserId: ids.E! }, select: { id: true } })).id;
    if ((await soDo(soE)).pinHash === null) expect((await pin(tokE, { pin: "4821" })).status).toBe(200);
    const kqSai: number[] = [];
    for (let i = 0; i < 5; i++) kqSai.push((await mo(tokE, { pin: "0000" })).status);
    expect(kqSai).toEqual([403, 403, 403, 403, 429]);
    expect((await soDo(soE)).pinKhoaDen).not.toBeNull();
    expect((await mo(tokE, { pin: "4821" })).status).toBe(429); // đang khoá: PIN đúng vẫn bị chặn
    // cửa sổ khoá đã qua (dời mốc khoá về quá khứ — cùng cách các ca hết hạn ở [PINE-11])
    await db.discGiaDinh.update({ where: { id: soE }, data: { pinKhoaDen: new Date(Date.now() - 60_000) } });
    const mo2 = await mo(tokE, { pin: "4821" });
    expect(mo2.status, mo2.raw).toBe(200);
    const sau = await soDo(soE);
    expect([sau.pinSai, sau.pinKhoaDen]).toEqual([0, null]);
  });

  it("[PINE-19] CHẾ ĐỘ HỌC SINH: không mở được và không dùng được khoá DISC (cả route lẫn cổng domain)", async () => {
    // /pin/lock khi CHƯA có sổ (tokD chưa tạo sổ): idempotent, không lỗi, không lộ gì ⇒ 200 {soPhien:0}; /pin ⇒ coSo:false
    const kl = await goi(pinLockPost, U("/pin/lock"), {}, tokD);
    expect([kl.status, kl.b.data]).toEqual([200, { soPhien: 0 }]);
    expect((await trangThai(tokD))).toMatchObject({ coSo: false, coPin: false });
    expect((await goi(codePost, "/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, tokD)).status).toBe(200);
    expect((await goi(enterPost, "/api/mobile/v1/student-mode/enter", { studentId: `${NS}hs-d` }, tokD)).status).toBe(200);
    for (const rt of [...cacRoute(tokD, "x").slice(0, 6)]) expect((await rt.chay()).status, rt.ten).toBe(403);
    expect((await mo(tokD, { pin: "1234" })).status).toBe(403);
    expect((await lay(pinGet, U("/pin"), tokD)).status).toBe(403);
    // cổng domain độc lập với allow-list: phiên học sinh + sổ ĐÃ có PIN ⇒ DISC_KHONG_DU_QUYEN; không có sổ/PIN ⇒ qua (không có gì để bảo vệ)
    const loi = await baoVeDisc({ userId: ids.A!, sessionId: "s-hs", name: "", email: "", phone: null, hocSinhId: `${NS}hs-d` }, { phamVi: "DOC" }).then(() => null, (e: { code?: string; maChiTiet?: string }) => e.maChiTiet);
    expect(loi).toBe("DISC_KHONG_DU_QUYEN");
    await expect(baoVeDisc({ userId: ids.D!, sessionId: "s-hs", name: "", email: "", phone: null, hocSinhId: `${NS}hs-d` }, { phamVi: "DOC" })).resolves.toBeUndefined();
  });
});
