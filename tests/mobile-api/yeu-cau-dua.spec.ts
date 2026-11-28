import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web (xem xac-thuc.spec.ts): chặn `@/lib/auth` để mọi đường lỡ gọi `auth()` thật sẽ đỏ.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as yeuCauPost } from "@/app/api/mobile/v1/students/[studentId]/requests/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { TRAN_DON_DANG_CHO } from "@/lib/mobile-api/dich-vu/yeu-cau";

/**
 * [YCR] BR-REQ-01 — «Gửi yêu cầu» của phụ huynh phải NGUYÊN TỬ khi nhiều lượt đến cùng lúc (Postgres thật, gọi thẳng route handler).
 *   [YCR-DB-01] 12 lượt gửi GIỐNG HỆT đồng thời (app gửi lại đua với lượt đầu) ⇒ ĐÚNG MỘT đơn trong DB; đúng một phản hồi `trungLap:false`, còn lại `trungLap:true`
 *   [YCR-DB-02] đang có 9/10 đơn chờ, 5 lượt KHÁC NỘI DUNG đồng thời ⇒ ĐÚNG MỘT thắng (chạm trần 10), bốn lượt còn lại 409; trong DB đúng 10 đơn chờ — không vượt trần
 *   [YCR-DB-03] hai phụ huynh gửi đồng thời không chặn nhau và đơn không lẫn nhà (khoá theo phụ huynh, không toàn cục)
 * File spec riêng ⇒ bộ đếm rate-limit trong bộ nhớ riêng.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "ycrtest-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966300001", B: "0966300002" };
let dem = 0;
const ipMoi = () => `10.89.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: { id: string; trungLap: boolean }; error?: { code: string; message: string } };
const ctx = (id: string) => ({ params: Promise.resolve({ studentId: id }) });
const ids: Record<string, string> = {};

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(
    req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }),
  );
  const b = (await r.json()) as { data?: { accessToken: string } };
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status}`);
  return b.data!.accessToken;
}

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

describe.skipIf(!RUN)("[YCR] gửi yêu cầu đua nhau — Postgres thật", () => {
  let tokA = "";
  let tokB = "";
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B"] as const) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    await db.student.create({ data: { id: `${NS}hs-a`, name: `${NS}An`, parentUserId: ids.A } as never });
    await db.student.create({ data: { id: `${NS}hs-b`, name: `${NS}Binh`, parentUserId: ids.B } as never });
    tokA = await dangNhap(PHONE.A, 1);
    tokB = await dangNhap(PHONE.B, 2);
    for (const t of [tokA, tokB]) await quyDinhDongY(req("/x", {}, `Bearer ${t}`));
  }, 60_000);
  afterAll(don);

  const gui = (tok: string, hs: string, ghiChu: string) => yeuCauPost(req("/x", { loai: "khac", ghiChu }, `Bearer ${tok}`), ctx(hs));
  const dongCho = (hs: string) => db.parentRequest.count({ where: { studentId: hs, status: "PENDING" } });

  it("[YCR-DB-01] 12 lượt giống hệt đồng thời ⇒ ĐÚNG MỘT đơn; đúng một `trungLap:false`", async () => {
    await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
    const kq = await Promise.all(Array.from({ length: 12 }, () => gui(tokA, `${NS}hs-a`, "Con muốn hỏi về lịch học tuần sau")));
    const body = await Promise.all(kq.map(json));
    expect(kq.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(await dongCho(`${NS}hs-a`)).toBe(1);
    expect(body.filter((b) => b.data?.trungLap === false)).toHaveLength(1);
    expect(body.filter((b) => b.data?.trungLap === true)).toHaveLength(11);
    expect(new Set(body.map((b) => b.data?.id)).size).toBe(1); // mọi phản hồi trỏ về CÙNG một đơn
  });

  it("[YCR-DB-02] đang 9/10 đơn chờ, 5 lượt khác nội dung đồng thời ⇒ ĐÚNG MỘT thắng; không vượt trần", async () => {
    await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
    await db.parentRequest.createMany({
      data: Array.from({ length: TRAN_DON_DANG_CHO - 1 }, (_, i) => ({ studentId: `${NS}hs-a`, parentUserId: ids.A!, type: "OTHER" as const, content: `Đơn có sẵn số ${i}`, status: "PENDING" as const })),
    });
    const kq = await Promise.all(Array.from({ length: 5 }, (_, i) => gui(tokA, `${NS}hs-a`, `Yêu cầu khác nhau số ${i} cần trả lời`)));
    const trangThai = kq.map((r) => r.status).sort();
    expect(trangThai).toEqual([200, 409, 409, 409, 409]);
    expect(await dongCho(`${NS}hs-a`)).toBe(TRAN_DON_DANG_CHO);
  });

  it("[YCR-DB-03] hai phụ huynh gửi đồng thời không chặn nhau, đơn không lẫn nhà", async () => {
    await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
    const kq = await Promise.all([gui(tokA, `${NS}hs-a`, "Nhà A hỏi về học bù cuối tháng"), gui(tokB, `${NS}hs-b`, "Nhà B hỏi về học bù cuối tháng"), gui(tokA, `${NS}hs-a`, "Nhà A hỏi về học bù cuối tháng")]);
    expect(kq.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await dongCho(`${NS}hs-a`)).toBe(1);
    expect(await dongCho(`${NS}hs-b`)).toBe(1);
  });
});
