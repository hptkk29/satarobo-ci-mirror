import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as chatDm } from "@/app/api/mobile/v1/chat/dm/route";
import { POST as chatTin } from "@/app/api/mobile/v1/chat/conversations/[conversationId]/messages/route";
import { POST as pushToken } from "@/app/api/mobile/v1/devices/push-token/route";
import { POST as thongBaoDoc } from "@/app/api/mobile/v1/notifications/read/route";
import { POST as kiemTruoc } from "@/app/api/mobile/v1/parent/checkout/validate/route";
import { POST as taiHoaDon } from "@/app/api/mobile/v1/parent/invoices/[invoiceId]/download-link/route";
import { POST as taoDonOnline } from "@/app/api/mobile/v1/parent/online-orders/route";
import { POST as doiMatKhau } from "@/app/api/mobile/v1/parent/password/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { PATCH as suaHoSo } from "@/app/api/mobile/v1/parent/profile/route";
import { POST as maHocSinh } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as vaoHocSinh } from "@/app/api/mobile/v1/student-mode/enter/route";
import { POST as nguoiDon } from "@/app/api/mobile/v1/students/[studentId]/pickup-contacts/route";
import { POST as tienDo } from "@/app/api/mobile/v1/students/[studentId]/online/courses/[courseId]/lessons/[lessonId]/progress/route";
import { POST as guiYeuCau } from "@/app/api/mobile/v1/students/[studentId]/requests/route";
import { POST as xinVeTaiLen } from "@/app/api/mobile/v1/students/[studentId]/learning/uploads/route";
import { THAN_TOI_DA_BYTE } from "@/lib/mobile-api/cong";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [AUT-G1] V8.17 — XÁC THỰC TRƯỚC, KIỂM THÂN SAU (route handler thật + Postgres thật).
 * Gốc lỗi: 32 route ghi gọi `docThanJson` RỒI MỚI `chayDaDangNhap` ⇒ token đã thu hồi + thân sai trả 400 thay vì 401 TOKEN_REVOKED
 * (và con nhà khác + thân sai trả 400 thay vì 404). Nay thứ tự là cờ → Content-Length → access token → chế độ học sinh → quy định/sở hữu → ĐỌC THÂN → logic.
 *   [AUT-G1-01] không token + thân sai / thân hỏng ⇒ 401 (không bao giờ 400) — mọi họ cổng (đăng nhập · phụ huynh · theo học viên · studentId trong thân)
 *   [AUT-G1-02] token ĐÃ THU HỒI + thân sai ⇒ 401 TOKEN_REVOKED
 *   [AUT-G1-03] token HẾT HẠN + thân sai ⇒ 401 TOKEN_EXPIRED
 *   [AUT-G1-04] token đúng + thân sai ⇒ 400 VALIDATION (đối chứng dương: cổng vẫn nói 400 với người được phép)
 *   [AUT-G1-05] token đúng + học viên nhà khác + thân sai ⇒ 404 (không lộ tồn tại, không 400)
 *   [AUT-G1-06] chế độ học sinh + route tài chính/hồ sơ phụ huynh + thân sai ⇒ 403 (không 400)
 *   [AUT-G1-07] thân quá lớn: Content-Length > trần ⇒ 413 TRƯỚC xác thực (không đọc thân, không chạm DB); chunked không khai độ dài chỉ bị đọc SAU xác thực (chưa đăng nhập ⇒ 401); đăng nhập + chunked quá trần ⇒ 413
 *   [AUT-G1-08] đối chứng dương: yêu cầu đúng token + đúng thân vẫn 200 (hồ sơ, người đón)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "autg1-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.97.0.${(++dem % 250) + 1}`;
const tb = (nn: number, ten: string) => ({ maThietBi: `00000000-0000-4000-9c00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: ten, phienBanApp: "1.0.0" });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];

type Thuc = { token?: string; thanRaw?: string; headers?: Record<string, string>; body?: BodyInit | null; studentId?: string };
type Dong = { ten: string; ho: "dang-nhap" | "phu-huynh" | "hoc-vien" | "trong-than"; chay: (t: Thuc) => Promise<Response> };

function yeuCau(method: string, t: Thuc, thanRaw: string | undefined): Request {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip(), ...(t.token ? { authorization: `Bearer ${t.token}` } : {}), ...(t.headers ?? {}) };
  const init: RequestInit & { duplex?: string } = { method, headers, body: t.body !== undefined ? t.body : thanRaw };
  if (t.body && typeof t.body !== "string") init.duplex = "half";
  return new Request("http://localhost/api/mobile/v1/x", init);
}
const sCtx = (studentId: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ studentId, ...extra }) as never });

describe.skipIf(!RUN)("[AUT-G1] xác thực TRƯỚC, kiểm thân SAU", () => {
  const ids: Record<string, string> = {};
  let tOk = "";
  let tThuHoi = "";
  let tHetHan = "";
  let tHs = "";

  // Mỗi dòng: route ghi đại diện. `thanRaw` do ca test truyền.
  const DONG: Dong[] = [
    { ten: "chat/dm", ho: "dang-nhap", chay: (t) => chatDm(yeuCau("POST", t, t.thanRaw)) },
    { ten: "chat/messages", ho: "dang-nhap", chay: (t) => chatTin(yeuCau("POST", t, t.thanRaw), { params: Promise.resolve({ conversationId: "x" }) as never }) },
    { ten: "parent/password", ho: "dang-nhap", chay: (t) => doiMatKhau(yeuCau("POST", t, t.thanRaw)) },
    { ten: "parent/invoices/download-link", ho: "dang-nhap", chay: (t) => taiHoaDon(yeuCau("POST", t, t.thanRaw), { params: Promise.resolve({ invoiceId: "x" }) as never }) },
    { ten: "parent/online-orders", ho: "phu-huynh", chay: (t) => taoDonOnline(yeuCau("POST", t, t.thanRaw)) },
    { ten: "parent/profile PATCH", ho: "phu-huynh", chay: (t) => suaHoSo(yeuCau("PATCH", t, t.thanRaw)) },
    { ten: "parent/checkout/validate", ho: "phu-huynh", chay: (t) => kiemTruoc(yeuCau("POST", t, t.thanRaw)) },
    { ten: "notifications/read", ho: "phu-huynh", chay: (t) => thongBaoDoc(yeuCau("POST", t, t.thanRaw)) },
    { ten: "devices/push-token", ho: "phu-huynh", chay: (t) => pushToken(yeuCau("POST", t, t.thanRaw)) },
    { ten: "student-mode/code", ho: "phu-huynh", chay: (t) => maHocSinh(yeuCau("POST", t, t.thanRaw)) },
    { ten: "students/pickup-contacts", ho: "hoc-vien", chay: (t) => nguoiDon(yeuCau("POST", t, t.thanRaw), sCtx(t.studentId ?? "")) },
    { ten: "students/requests", ho: "hoc-vien", chay: (t) => guiYeuCau(yeuCau("POST", t, t.thanRaw), sCtx(t.studentId ?? "")) },
    { ten: "students/online/progress", ho: "hoc-vien", chay: (t) => tienDo(yeuCau("POST", t, t.thanRaw), sCtx(t.studentId ?? "", { courseId: "c", lessonId: "l" })) },
    { ten: "students/learning/uploads", ho: "hoc-vien", chay: (t) => xinVeTaiLen(yeuCau("POST", t, t.thanRaw), sCtx(t.studentId ?? "")) },
    { ten: "student-mode/enter (studentId trong thân)", ho: "trong-than", chay: (t) => vaoHocSinh(yeuCau("POST", t, t.thanRaw)) },
  ];
  const THAN_SAI = JSON.stringify({ __khong_hop_le: true });
  const THAN_HONG = "{không phải json";

  async function dn(sdt: string, nn: number, ten: string): Promise<string> {
    const r = await dangNhapRoute(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ dinhDanh: sdt, matKhau: MK, thietBi: tb(nn, ten) }) }));
    const j = await json(r);
    if (!j.data) throw new Error(`đăng nhập ${sdt}: ${JSON.stringify(j.error)}`);
    return (j.data as { accessToken: string }).accessToken;
  }
  async function don() {
    const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
    const uids = us.map((u) => u.id);
    await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
    await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
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
    await mk("A", "84966960001");
    await mk("B", "84966960002");
    ids.sa = (await db.student.create({ data: { id: `${NS}sa`, name: "Bé A", parentUserId: ids.A } as never, select: { id: true } })).id;
    ids.sb = (await db.student.create({ data: { id: `${NS}sb`, name: "Bé B", parentUserId: ids.B } as never, select: { id: true } })).id;
    tOk = await dn("0966960001", 1, "ok");
    tThuHoi = await dn("0966960001", 2, "thuhoi");
    tHetHan = await dn("0966960001", 3, "hethan");
    tHs = await dn("0966960001", 4, "hocsinh");
    for (const t of [tOk, tThuHoi, tHetHan, tHs]) await quyDinhDongY(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}`, "x-forwarded-for": ip() }, body: "{}" }));
    // thu hồi phiên "thuhoi" bằng ĐÚNG điểm thu hồi của dịch vụ; hết hạn phiên "hethan" bằng cách lùi hạn access
    const { thuHoi } = await import("@/lib/mobile-api/xac-thuc/dich-vu");
    const pTh = await db.mobileSession.findFirstOrThrow({ where: { userId: ids.A, tenMay: "thuhoi" }, select: { id: true } });
    expect(await thuHoi(db as never, pTh.id, "nguoi-dung-thu-hoi", new Date())).toBeTruthy();
    await db.mobileSession.updateMany({ where: { userId: ids.A, tenMay: "hethan" }, data: { accessHetHan: new Date(Date.now() - 60_000) } });
    // phiên chế độ học sinh
    const r1 = await maHocSinh(yeuCau("POST", { token: tHs }, JSON.stringify({ ma: "4827", xacNhan: "4827" })));
    expect(r1.status).toBe(200);
    const r2 = await vaoHocSinh(yeuCau("POST", { token: tHs }, JSON.stringify({ studentId: ids.sa })));
    expect(r2.status).toBe(200);
  }, 180_000);
  afterAll(async () => {
    await don();
  }, 180_000);

  const tenHoVien = (d: Dong, ok: boolean) => (d.ho === "hoc-vien" ? { studentId: ok ? ids.sa : ids.sb } : {});

  it("[AUT-G1-01] không token + thân sai/hỏng ⇒ 401 (không bao giờ 400), mọi họ cổng", async () => {
    for (const d of DONG) {
      for (const thanRaw of [THAN_SAI, THAN_HONG, ""]) {
        const r = await d.chay({ thanRaw, ...tenHoVien(d, true) });
        expect([r.status, (await json(r)).error?.code], `${d.ten} ← ${JSON.stringify(thanRaw).slice(0, 20)}`).toEqual([401, "UNAUTHENTICATED"]);
      }
    }
  });

  it("[AUT-G1-02] token ĐÃ THU HỒI + thân sai ⇒ 401 TOKEN_REVOKED", async () => {
    for (const d of DONG) {
      for (const thanRaw of [THAN_SAI, THAN_HONG]) {
        const r = await d.chay({ token: tThuHoi, thanRaw, ...tenHoVien(d, true) });
        expect(await ma(r), `${d.ten}`).toEqual([401, "TOKEN_REVOKED"]);
      }
    }
  });

  it("[AUT-G1-03] token HẾT HẠN + thân sai ⇒ 401 TOKEN_EXPIRED", async () => {
    for (const d of DONG) {
      const r = await d.chay({ token: tHetHan, thanRaw: THAN_SAI, ...tenHoVien(d, true) });
      expect(await ma(r), `${d.ten}`).toEqual([401, "TOKEN_EXPIRED"]);
    }
  });

  it("[AUT-G1-04] ĐỐI CHỨNG DƯƠNG: token đúng + thân sai/hỏng ⇒ 400 VALIDATION", async () => {
    for (const d of DONG) {
      for (const thanRaw of [THAN_SAI, THAN_HONG]) {
        const r = await d.chay({ token: tOk, thanRaw, ...tenHoVien(d, true) });
        expect(await ma(r), `${d.ten} ← ${thanRaw.slice(0, 12)}`).toEqual([400, "VALIDATION"]);
      }
    }
  });

  it("[AUT-G1-05] token đúng + học viên NHÀ KHÁC + thân sai ⇒ 404 (không lộ tồn tại, không 400)", async () => {
    for (const d of DONG.filter((x) => x.ho === "hoc-vien")) {
      const r = await d.chay({ token: tOk, thanRaw: THAN_SAI, studentId: ids.sb });
      expect(await ma(r), d.ten).toEqual([404, "NOT_FOUND"]);
    }
    // studentId nằm TRONG thân: con nhà khác + thân ĐÚNG hình ⇒ 404; con không tồn tại ⇒ cùng 404
    expect(await ma(await vaoHocSinh(yeuCau("POST", { token: tOk }, JSON.stringify({ studentId: ids.sb }))))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await vaoHocSinh(yeuCau("POST", { token: tOk }, JSON.stringify({ studentId: `${NS}khong-co` }))))).toEqual([404, "NOT_FOUND"]);
  });

  it("[AUT-G1-06] chế độ học sinh + route phụ huynh/tài chính + thân sai ⇒ 403 (không 400, không 404)", async () => {
    for (const d of DONG.filter((x) => ["parent/password", "parent/invoices/download-link", "parent/online-orders", "parent/profile PATCH", "parent/checkout/validate", "student-mode/code", "devices/push-token", "notifications/read"].includes(x.ten))) {
      const r = await d.chay({ token: tHs, thanRaw: THAN_SAI });
      expect(await ma(r), d.ten).toEqual([403, "FORBIDDEN"]);
    }
  });

  it("[AUT-G1-07] thân quá lớn: 413 TRƯỚC xác thực nếu khai Content-Length; chunked chỉ đọc SAU xác thực", async () => {
    const khai = { "content-length": String(THAN_TOI_DA_BYTE + 1) };
    // Content-Length quá trần ⇒ 413 dù KHÔNG có token (chặn rẻ, không đọc thân, không chạm DB)
    for (const d of [DONG[0]!, DONG[4]!, DONG[10]!, DONG[14]!]) {
      expect(await ma(await d.chay({ headers: khai, thanRaw: "{}", ...tenHoVien(d, true) })), d.ten).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    }
    // chunked (không khai độ dài) quá trần: chưa đăng nhập ⇒ 401 (thân KHÔNG bị đọc); đăng nhập ⇒ 413 do cắt luồng
    const lon = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          const khoi = new TextEncoder().encode("x".repeat(64 * 1024));
          for (let i = 0; i < 5; i++) c.enqueue(khoi);
          c.close();
        },
      });
    const taoStream = (): Thuc["body"] => lon() as unknown as BodyInit;
    expect(await ma(await DONG[0]!.chay({ body: taoStream() }))).toEqual([401, "UNAUTHENTICATED"]);
    expect(await ma(await DONG[0]!.chay({ token: tThuHoi, body: taoStream() }))).toEqual([401, "TOKEN_REVOKED"]);
    expect(await ma(await DONG[0]!.chay({ token: tOk, body: taoStream() }))).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    expect(await ma(await DONG[10]!.chay({ token: tOk, body: taoStream(), studentId: ids.sb }))).toEqual([404, "NOT_FOUND"]); // nhà khác: sở hữu trước thân
    expect(await ma(await DONG[10]!.chay({ token: tOk, body: taoStream(), studentId: ids.sa }))).toEqual([413, "PAYLOAD_TOO_LARGE"]);
  });

  it("[AUT-G1-08] đối chứng dương: token đúng + thân đúng vẫn làm được", async () => {
    const r1 = await suaHoSo(yeuCau("PATCH", { token: tOk }, JSON.stringify({ diaChi: "12 Đường thử, Đà Nẵng" })));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("cache-control")).toBe("no-store");
    const r2 = await nguoiDon(yeuCau("POST", { token: tOk }, JSON.stringify({ hoTen: "Ông Ngoại", quanHe: "Ông", soDienThoai: "0966960099" })), sCtx(ids.sa));
    // quan hệ hợp lệ lấy từ enum thật — nếu enum khác thì 400 và ca này báo đúng chỗ cần chỉnh
    expect([200, 201]).toContain(r2.status);
  });
});
