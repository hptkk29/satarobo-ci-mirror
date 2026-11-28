import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as bookPost } from "@/app/api/mobile/v1/parent/disc/book/route";
import { GET as membersGet } from "@/app/api/mobile/v1/parent/disc/members/route";
import { POST as startPost } from "@/app/api/mobile/v1/parent/disc/test/start/route";
import { POST as submitPost } from "@/app/api/mobile/v1/parent/disc/test/submit/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { GET as robotGet } from "@/app/api/mobile/v1/students/[studentId]/personality-robot/route";
import { db } from "@/lib/db";
import { docVe } from "@/lib/disc/ngan-hang/de-ky";
import { timCauNganHang } from "@/lib/disc/ngan-hang/nap";
import { layKhoaDisc } from "@/lib/disc/phone-key";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [ROBOT-DB] `GET /students/:studentId/personality-robot` — Postgres thật, gọi thẳng route handler (V8.24: route này là route DUY NHẤT chưa có spec nào import; service/DTO đã có unit + HTTP 3219).
 *   [ROBOT-DB-01] cờ DISC_ENABLED TẮT ⇒ 404 (kể cả đã đăng nhập, đúng học viên)
 *   [ROBOT-DB-02] không token ⇒ 401; học viên của nhà KHÁC / id lạ ⇒ cùng 404
 *   [ROBOT-DB-03] chưa làm DISC (kể cả đã có sổ + thành viên) ⇒ 200 `coRobot:false` (KHÔNG bịa); em chưa làm KHÔNG nhận kết quả của anh/chị/em đã làm
 *   [ROBOT-DB-04] sau khi làm bài (thiên về D): `coRobot:true`, nguồn SO_GIA_DINH, nhóm chính D, bốn cột 0–100; KHÔNG có điểm thô/vé/id/tên người khác trong nhà
 *   [ROBOT-DB-05] phụ huynh nhà khác gọi bằng id của em ⇒ 404 và phản hồi không chứa dữ liệu của nhà A
 *   [ROBOT-DB-06] chế độ học sinh: khoá em của MÌNH ⇒ 200 và thấy robot của chính em; khoá em A mà gọi em khác ⇒ 403; đối chứng dương: phụ huynh thường gọi được
 *   [ROBOT-DB-07] không rò: không SĐT/email/userId/pinHash trong phản hồi
 *   [ROBOT-DB-08] SEC-17: nguồn LỊCH SỬ DISC cũ chỉ nhận lượt đã được CHÍNH phụ huynh NHẬN (CLAIMED + claimedUserId) — lượt công khai chưa nhận / của người khác / đã xoá mềm KHÔNG nuôi Robot dù trùng tên con
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "robtest-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966800001", B: "0966800002" };
let dem = 0;
const ipMoi = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Ket = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const json = async (r: Response) => (await r.json()) as Ket;
const ids: Record<string, string> = {};
const bearer = (t: string) => `Bearer ${t}`;
const U = (p: string) => `/api/mobile/v1/parent/disc${p}`;
const ctx = (studentId: string) => ({ params: Promise.resolve({ studentId }) });
const robot = async (studentId: string, tok?: string) => {
  const r = await robotGet(req(`/api/mobile/v1/students/${studentId}/personality-robot`, undefined, tok ? bearer(tok) : undefined), ctx(studentId));
  return { status: r.status, b: await json(r) };
};

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-8000-${String(n + 800).padStart(12, "0")}`, nenTang: "ios", tenMay: "iPhone", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return (b.data as { accessToken: string }).accessToken;
}

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.discGiaDinh.deleteMany({ where: { ownerUserId: { in: uids } } });
  await db.discSubmission.deleteMany({ where: { idempotencyKey: { startsWith: NS } } }); // SEC-17: lượt DISC giả dựng ở [ROBOT-DB-08] (subjects xoá theo)
  await db.auditLog.deleteMany({ where: { module: "disc", actorId: { in: uids } } });
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

/** Câu trả lời thiên về MỘT trục (đọc khoá chấm từ vé — chỉ test được làm vậy, như `disc.spec.ts`). */
function traLoiThienVe(ve: string, tvId: string, cao: "D" | "I" | "S" | "C", max: number): Record<string, number> {
  const d = docVe(ve, layKhoaDisc(), tvId, new Date());
  if (!d.ok) throw new Error("vé hỏng trong fixture");
  const r: Record<string, number> = {};
  d.de.maCau.forEach((ma, i) => {
    const c = timCauNganHang(ma);
    if (!c) throw new Error("mã câu lạ");
    r[String(i)] = c.truc === cao ? (c.dao ? 1 : max) : c.dao ? max : 1; // trục «cao» ở cực cao, các trục khác ở cực thấp ⇒ chênh lệch rõ (đề trẻ em có thang ngắn)
  });
  return r;
}

describe.skipIf(!RUN)("[ROBOT-DB] personality-robot — Postgres thật", () => {
  let tokA = "";
  let tokA2 = "";
  let tokB = "";
  const AN = `${NS}hs-an`; // nhà A, làm bài DISC
  const BE = `${NS}hs-be`; // nhà A, chưa làm bài
  const CU = `${NS}hs-cu`; // nhà B

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.DISC_ENABLED = "true";
    process.env.DISC_NGAN_HANG_ENABLED = "true";
    process.env.DISC_PEPPER = "kiem-thu-disc-pepper-khong-phai-bi-mat-123456";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B"] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    const sinh = new Date("2016-05-10T05:00:00Z");
    await db.student.create({ data: { id: AN, name: "Bé An Robot", parentUserId: ids.A, dateOfBirth: sinh } as never });
    await db.student.create({ data: { id: BE, name: "Bé Bê Robot", parentUserId: ids.A, dateOfBirth: sinh } as never });
    await db.student.create({ data: { id: CU, name: "Bé Cu Robot", parentUserId: ids.B, dateOfBirth: sinh } as never });
    tokA = await dangNhap(PHONE.A, 1);
    tokA2 = await dangNhap(PHONE.A, 2); // phiên thứ hai của nhà A — dùng cho chế độ học sinh
    tokB = await dangNhap(PHONE.B, 3);
    for (const t of [tokA, tokA2, tokB]) await quyDinhDongY(req("/x", {}, bearer(t)));
  }, 60_000);
  afterAll(async () => {
    await don();
    delete process.env.DISC_ENABLED;
    delete process.env.DISC_NGAN_HANG_ENABLED;
    delete process.env.DISC_PEPPER;
  });

  it("[ROBOT-DB-01] cờ DISC_ENABLED tắt ⇒ 404", async () => {
    process.env.DISC_ENABLED = "false";
    try {
      expect((await robot(AN, tokA)).status).toBe(404);
    } finally {
      process.env.DISC_ENABLED = "true";
    }
  });

  it("[ROBOT-DB-02] không token ⇒ 401; em nhà khác / id lạ ⇒ cùng 404", async () => {
    expect((await robot(AN)).status).toBe(401);
    expect((await robot(CU, tokA)).status).toBe(404);
    expect((await robot(`${NS}khong-co`, tokA)).status).toBe(404);
  });

  it("[ROBOT-DB-03] chưa có kết quả ⇒ coRobot:false (không bịa); em chưa nối không nhận kết quả của anh/chị/em", async () => {
    const truoc = await robot(AN, tokA);
    expect(truoc.status).toBe(200);
    expect(truoc.b.data).toEqual({ coRobot: false, robot: null });
        const sach = await bookPost(req(U("/book"), { tenChuSo: "Mẹ", vaiTroChuSo: "me" }, bearer(tokA)));
    expect(sach.status, JSON.stringify(await json(sach.clone()))).toBe(200);
    // lập sổ tự nối các con của nhà làm thành viên; CHƯA làm bài ⇒ vẫn không có robot
    expect((await robot(AN, tokA)).b.data).toEqual({ coRobot: false, robot: null });
  });

  it("[ROBOT-DB-04] làm bài thiên về D ⇒ coRobot:true, SO_GIA_DINH, nhóm D, bốn cột 0–100; không rò điểm thô/vé/người khác; em chưa làm vẫn không có", async () => {
    const ds = ((await json(await membersGet(req(U("/members"), undefined, bearer(tokA))))).data as { manThanhVien: { thanhVien: Array<{ id: string; studentId: string | null }> } }).manThanhVien.thanhVien;
    const tvAn = ds.find((x) => x.studentId === AN)!.id;
    const bd = await json(await startPost(req(U("/test/start"), { thanhVienId: tvAn, cachLam: "TU_LAM" }, bearer(tokA))));
    expect(bd.ok).toBe(true);
    const de = (bd.data as { de: { ve: string; thang: Array<{ gia: number }> } }).de;
    const toiDa = de.thang.reduce((m, x) => Math.max(m, x.gia), 0);
    const nop = await submitPost(req(U("/test/submit"), { thanhVienId: tvAn, cachLam: "TU_LAM", ve: de.ve, traLoi: traLoiThienVe(de.ve, tvAn, "D", toiDa) }, bearer(tokA)));
    const nopB = await json(nop.clone());
    expect(nop.status, JSON.stringify(nopB)).toBe(200);
    const r = await robot(AN, tokA);
    expect(r.status).toBe(200);
    const d = r.b.data as { coRobot: boolean; robot: { nguon: string; chinh: { ma: string; tenRobot: string }; phu: unknown; thanh: Record<string, number> } };
    expect(d.coRobot).toBe(true);
    expect(d.robot.nguon).toBe("SO_GIA_DINH");
    expect(d.robot.chinh.ma).toBe("D");
    expect(d.robot.chinh.tenRobot.length).toBeGreaterThan(0);
    expect(Object.keys(d.robot.thanh).sort()).toEqual(["C", "D", "I", "S"]);
    for (const v of Object.values(d.robot.thanh)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    const tho = JSON.stringify(r.b);
    expect(tho).not.toContain(de.ve); // không rò vé
    expect(tho).not.toMatch(/traLoi|maCau|diem\b/); // không điểm thô / mã câu
    expect(tho).not.toContain(tvAn); // không id thành viên
    expect(tho).not.toMatch(/Mẹ|Bé Bê/); // không tên người khác trong nhà
    // đối chứng: em BE (cùng nhà, chưa làm bài) KHÔNG nhận kết quả của AN
    expect((await robot(BE, tokA)).b.data).toEqual({ coRobot: false, robot: null });
  });

  it("[ROBOT-DB-05] phụ huynh nhà khác gọi bằng id của em A ⇒ 404, không chứa dữ liệu nhà A", async () => {
    const r = await robot(AN, tokB);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.b)).not.toMatch(/Robot|"D"|coRobot|Bé An/);
    expect((await robot(CU, tokB)).status).toBe(200); // đối chứng dương: em của chính nhà B
  });

  it("[ROBOT-DB-06] chế độ học sinh: khoá em AN ⇒ thấy robot của chính em; gọi em khác ⇒ 403; phụ huynh thường vào được", async () => {
    expect((await robot(AN, tokA)).status).toBe(200); // đối chứng dương
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, bearer(tokA2)))).status).toBe(200);
    expect((await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: AN }, bearer(tokA2)))).status).toBe(200);
    const own = await robot(AN, tokA2);
    expect(own.status).toBe(200);
    expect((own.b.data as { coRobot: boolean }).coRobot).toBe(true);
    expect((await robot(BE, tokA2)).status).toBe(403); // anh/chị/em của chính nhà
  });

  it("[ROBOT-DB-07] không rò SĐT/email/userId/pinHash", async () => {
    const tho = JSON.stringify((await robot(AN, tokA)).b);
    expect(tho).not.toContain(PHONE.A);
    expect(tho).not.toContain(`${NS}A@seed.invalid`);
    expect(tho).not.toContain(ids.A);
    expect(tho).not.toMatch(/pinHash|password/i);
  });

  it("[ROBOT-DB-08] SEC-17: Robot (nguồn lịch sử DISC cũ) chỉ tin lượt đã được CHÍNH phụ huynh NHẬN — lượt công khai chưa nhận / của người khác / đã xoá mềm trùng TÊN con KHÔNG gieo được Robot; đối chứng dương: lượt đã nhận thì có", async () => {
    const SEED = `${NS}gieo`;
    const BE_GIEO = `${NS}hs-gieo`;
    await db.student.create({ data: { id: BE_GIEO, name: "Bé Gieo Robot", parentUserId: ids.A, dateOfBirth: new Date("2016-05-10T05:00:00Z") } as never });
    const NOW = new Date();
    const tao = (hau: string, o: { claimStatus: "PENDING_CLAIM" | "CLAIMED" | "EXPIRED" | "REVOKED"; claimedUserId: string | null; deletedAt?: Date | null }) =>
      db.discSubmission.create({
        data: {
          idempotencyKey: `${SEED}-${hau}`, phoneKey: `${SEED}-pk-${hau}`, consentVersion: "t", consentAt: NOW, engineVersion: "e", reportSnapshot: {}, retainUntil: new Date(NOW.getTime() + 365 * 86400_000),
          claimStatus: o.claimStatus, claimedUserId: o.claimedUserId, claimedAt: o.claimStatus === "CLAIMED" ? NOW : null, deletedAt: o.deletedAt ?? null,
          subjects: { create: [{ role: "STUDENT", fullName: "Bé Gieo Robot", birthYear: 2016, grade: "4", questionSetVersion: "gia-1", result: { diem: { D: 90, I: 10, S: 10, C: 10 }, maBoDe: "tre-em", phienBanBoDe: "1" } }] },
        } as never,
      });
    await tao("chua-nhan", { claimStatus: "PENDING_CLAIM", claimedUserId: null }); // ai đó điền form công khai bằng SĐT phụ huynh + tên con, chưa nhận
    await tao("cua-nguoi-khac", { claimStatus: "CLAIMED", claimedUserId: ids.B! }); // đã được người KHÁC nhận
    await tao("da-xoa", { claimStatus: "CLAIMED", claimedUserId: ids.A!, deletedAt: NOW }); // của A nhưng đã xoá mềm
    // trạng thái KHÁC «đã nhận» dù có chủ (nhận dở / hết hạn / đã bị thu hồi — `claimedUserId` còn đó nhưng KHÔNG phải kết quả hợp lệ của A)
    for (const [hau, st] of [["cho-nhan-co-chu", "PENDING_CLAIM"], ["het-han", "EXPIRED"], ["thu-hoi", "REVOKED"]] as const) await tao(hau, { claimStatus: st, claimedUserId: ids.A! });
    expect((await robot(BE_GIEO, tokA)).b.data, "lượt chưa nhận / của người khác / đã xoá / hết hạn / thu hồi KHÔNG được nuôi Robot").toEqual({ coRobot: false, robot: null });
    await tao("da-nhan", { claimStatus: "CLAIMED", claimedUserId: ids.A! });
    const co = await robot(BE_GIEO, tokA);
    expect(co.status).toBe(200);
    expect((co.b.data as { coRobot: boolean }).coRobot, "ĐỐI CHỨNG DƯƠNG: lượt A đã nhận thì Robot có").toBe(true);
  });
});
