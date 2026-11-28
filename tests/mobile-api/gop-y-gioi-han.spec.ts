import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as gopYGet, POST as gopYPost } from "@/app/api/mobile/v1/students/[studentId]/center-feedback/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [GY-RL] B-RL1 — giới hạn tần suất «gửi góp ý» của app (5 lượt / 10 phút / phụ huynh), Postgres thật, gọi thẳng route handler (rate limit THẬT, không mock).
 *   [GY-RL-01] năm góp ý KHÁC NỘI DUNG ⇒ 200; lần thứ sáu ⇒ 429 + `Retry-After` > 0 + mã RATE_LIMITED; KHÔNG ghi dòng thứ sáu
 *   [GY-RL-02] gửi LẠI đúng nội dung vừa gửi (trong 5 phút) ⇒ 200 trungLap — kể cả khi đã chạm trần (thiết kế: bấm lại/mất mạng không bị phạt)
 *   [GY-RL-03] hạn mức theo PHỤ HUYNH: phụ huynh khác không bị ảnh hưởng; học viên nhà khác ⇒ 404; không token ⇒ 401
 *   [GY-RL-04] thân sai (thiếu điểm/sao, chủ đề lạ, nội dung ngắn) ⇒ 400 và KHÔNG tiêu hạn mức
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "gyrl-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966950001", B: "0966950002" };
let dem = 0;
const ipMoi = () => `10.95.0.${(++dem % 250) + 1}`;
const reqRaw = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Ket = { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Ket;
const ids: Record<string, string> = {};
const bearer = (t: string) => `Bearer ${t}`;
const ctx = (studentId: string) => ({ params: Promise.resolve({ studentId }) });
const gui = async (hs: string, tok: string | undefined, body: unknown) => {
  const r = await gopYPost(reqRaw("POST", `/api/mobile/v1/students/${hs}/center-feedback`, body, tok ? bearer(tok) : undefined), ctx(hs));
  return { status: r.status, retryAfter: r.headers.get("retry-after"), b: await json(r) };
};
const dung = (n: string) => ({ diem: 9, chuDe: "Khác", noiDung: `Góp ý kiểm thử số ${n} — ${NS}` });

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(reqRaw("POST", "/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-8000-${String(n + 950).padStart(12, "0")}`, nenTang: "ios", tenMay: "iPhone", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return (b.data as { accessToken: string }).accessToken;
}

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.parentFeedback.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

describe.skipIf(!RUN)("[GY-RL] giới hạn tần suất góp ý — Postgres thật", () => {
  let tokA = "";
  let tokB = "";
  const HA = `${NS}hs-a`;
  const HB = `${NS}hs-b`;

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B"] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.student.create({ data: { id: HA, name: "Bé A", parentUserId: ids.A } as never });
    await db.student.create({ data: { id: HB, name: "Bé B", parentUserId: ids.B } as never });
    tokA = await dangNhap(PHONE.A, 1);
    tokB = await dangNhap(PHONE.B, 2);
    for (const t of [tokA, tokB]) await quyDinhDongY(reqRaw("POST", "/x", {}, bearer(t)));
  }, 60_000);
  afterAll(don);

  it("[GY-RL-04] thân sai ⇒ 400 và KHÔNG tiêu hạn mức (đứng đầu để đếm hạn mức còn nguyên)", async () => {
    for (const than of [{ chuDe: "Khác", noiDung: "đủ dài nhưng thiếu điểm" }, { diem: 9, chuDe: "Chủ đề lạ", noiDung: "đủ dài rồi" }, { diem: 9, chuDe: "Khác", noiDung: "ngắn" }]) expect((await gui(HB, tokB, than)).status).toBe(400);
    expect(await db.parentFeedback.count({ where: { parentUserId: ids.B } })).toBe(0);
  });

  it("[GY-RL-01] năm góp ý khác nội dung ⇒ 200; lần sáu ⇒ 429 + Retry-After; không ghi dòng thứ sáu", async () => {
    for (let i = 1; i <= 5; i++) expect((await gui(HA, tokA, dung(String(i)))).status, `lần ${i}`).toBe(200);
    const sau = await gui(HA, tokA, dung("6"));
    expect(sau.status).toBe(429);
    expect(sau.b.error?.code).toBe("RATE_LIMITED");
    expect(Number(sau.retryAfter)).toBeGreaterThan(0);
    expect(await db.parentFeedback.count({ where: { parentUserId: ids.A } })).toBe(5);
  });

  it("[GY-RL-02] gửi lại đúng nội dung vừa gửi ⇒ 200 trungLap kể cả đã chạm trần", async () => {
    const lai = await gui(HA, tokA, dung("5"));
    expect(lai.status).toBe(200);
    expect(lai.b.data).toMatchObject({ trungLap: true });
    expect(await db.parentFeedback.count({ where: { parentUserId: ids.A } })).toBe(5);
    expect(((await json(await gopYGet(reqRaw("GET", `/api/mobile/v1/students/${HA}/center-feedback`, undefined, bearer(tokA)), ctx(HA)))).data as { daGui: unknown[] }).daGui).toHaveLength(5);
  });

  it("[GY-RL-03] phụ huynh khác không bị ảnh hưởng; học viên nhà khác ⇒ 404; không token ⇒ 401", async () => {
    expect((await gui(HB, tokB, dung("b1"))).status).toBe(200);
    expect((await gui(HA, tokB, dung("b2"))).status).toBe(404); // em của nhà A
    expect((await gui(HA, undefined, dung("b3"))).status).toBe(401);
    expect(await db.parentFeedback.count({ where: { parentUserId: ids.B } })).toBe(1);
  });
});
