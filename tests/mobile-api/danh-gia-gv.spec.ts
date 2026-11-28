import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { GET as dgGet, POST as dgPost } from "@/app/api/mobile/v1/students/[studentId]/teacher-evaluations/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [DGGV] V8.20 — H-Danh-gia: học sinh đánh giá giáo viên qua mobile (route-handler + Postgres thật; lõi dùng chung với web `lib/eval/danh-gia-gv-hoc-sinh.ts`):
 *   [DGGV-01] cờ EVAL_V2 tắt ⇒ dangMo=false, không khối; bật ⇒ đợt + câu hỏi + giáo viên CHƯA đánh giá (không đáp án/không dữ liệu người khác)
 *   [DGGV-02] gửi: sao 1–5 + text; thiếu câu bắt buộc/sao ngoài khoảng/câu lạ ⇒ 400; đợt đóng ⇒ 409; GV không dạy con ⇒ 422; gửi lại ⇒ 409 DA_DANH_GIA; sau khi gửi khối biến mất
 *   [DGGV-03] IDOR: con nhà khác 404 (GET + POST); không token 401; trường lạ 400
 *   [DGGV-04] chế độ học sinh: đúng con ⇒ GET/POST được; con anh/chị/em ⇒ 403
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "dggv-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (method: string, body?: unknown, auth?: string) =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const A = (k: string) => `${NS}${k}`;
const rq = (method: string, sid: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost/api/mobile/v1/students/${sid}/teacher-evaluations`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (s: string) => ({ params: Promise.resolve({ studentId: s }) as never });

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.evalAnswer.deleteMany({ where: { response: { round: { name: { startsWith: NS } } } } });
  await db.evalResponse.deleteMany({ where: { round: { name: { startsWith: NS } } } });
  await db.evaluationRound.deleteMany({ where: { name: { startsWith: NS } } });
  await db.evalQuestion.deleteMany({ where: { form: { title: { startsWith: NS } } } });
  await db.evalForm.deleteMany({ where: { title: { startsWith: NS } } });
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[DGGV] học sinh đánh giá giáo viên (mobile)", () => {
  let tA = "";
  let tB = "";
  const ids: Record<string, string> = {};
  let dot = "";
  let q: { sao: string; chon: string; text: string };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.EVAL_V2_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, sdt: string, vai: "PARENT" | "TEACHER") => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: vai === "TEACHER" ? "Cô Lan" : `PH ${k}`, phone: sdt, password: hash, role: vai, roles: [vai] } as never, select: { id: true } })).id);
    await mk("A", "84966960001", "PARENT");
    await mk("B", "84966960002", "PARENT");
    const gv = await mk("gv", "84966960003", "TEACHER");
    await mk("gv2", "84966960004", "TEACHER");
    await db.center.create({ data: { id: A("cs"), name: "CS đánh giá", slug: A("cs"), address: "Đ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá ĐG", slug: A("kh"), totalSessions: 12 } });
    await db.class.create({ data: { id: A("l1"), name: "Lớp Robot", classCode: A("l1"), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00", teacherId: gv } as never });
    for (const [k, ph] of [["s1", "A"], ["s2", "A"], ["s3", "B"]] as const) await db.student.create({ data: { id: A(k), name: `Bé ${k}`, parentUserId: ids[ph], centerId: A("cs") } as never });
    await db.enrollment.create({ data: { id: A("dk1"), studentId: A("s1"), classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never }); // s2: chưa học ⇒ không đủ điều kiện
    await db.enrollment.create({ data: { id: A("dk3"), studentId: A("s3"), classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    const form = await db.evalForm.create({ data: { title: `${NS}form`, scope: "TEACHER_EVAL", status: "ACTIVE" } as never });
    const mkq = (type: string, label: string, order: number, required: boolean, options?: unknown) => db.evalQuestion.create({ data: { formId: form.id, type, label, order, required, ...(options ? { options } : {}) } as never });
    const qs = await mkq("STAR_RATING", "Thầy/cô dạy dễ hiểu?", 1, true);
    const qc = await mkq("RADIO", "Em thích điều gì nhất?", 2, false, ["Bài thực hành", "Trò chơi", "Giải thích"]);
    const qt = await mkq("TEXTBOX", "Góp ý thêm", 3, false);
    q = { sao: qs.id, chon: qc.id, text: qt.id };
    dot = (await db.evaluationRound.create({ data: { formId: form.id, scope: "TEACHER_EVAL", name: `${NS}dot`, status: "OPEN", opensAt: new Date(Date.now() - 86_400_000), closesAt: new Date(Date.now() + 86_400_000) } as never })).id;
    const dn = async (sdt: string, nn: number) => {
      const r = await dangNhapRoute(req("POST", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9c00-${String(nn).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966960001", 1);
    tB = await dn("0966960002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", {}, bearer(t)));
  }, 120_000);
  afterAll(async () => {
    await don();
    delete process.env.EVAL_V2_ENABLED;
  }, 120_000);

  const gui = (tok: string, sid: string, body: unknown) => dgPost(rq("POST", sid, body, bearer(tok)), ctx(sid));
  const tot = (o: Record<string, unknown> = {}) => ({ dotId: dot, ghiDanhId: A("dk1"), giaoVienId: ids.gv, traLoi: [{ cauHoiId: q.sao, soSao: 5 }, { cauHoiId: q.chon, luaChon: ["Trò chơi"] }, { cauHoiId: q.text, vanBan: "Cô dạy rất vui" }], ...o });

  it("[DGGV-01] cờ tắt ⇒ dangMo=false; bật ⇒ đợt + câu hỏi + giáo viên chưa đánh giá; con chưa học ⇒ rỗng", async () => {
    process.env.EVAL_V2_ENABLED = "false";
    const tat = await json(await dgGet(rq("GET", A("s1"), undefined, bearer(tA)), ctx(A("s1"))));
    expect(tat.data).toEqual({ dangMo: false, khoi: [] });
    expect((await gui(tA, A("s1"), tot())).status).toBe(404);
    process.env.EVAL_V2_ENABLED = "true";
    const bat = await json(await dgGet(rq("GET", A("s1"), undefined, bearer(tA)), ctx(A("s1"))));
    expect(bat.data.dangMo).toBe(true);
    expect(bat.data.khoi).toHaveLength(1);
    const k = bat.data.khoi[0];
    expect(k).toMatchObject({ dotId: dot });
    expect(k.cauHoi.map((c: { loai: string }) => c.loai)).toEqual(["STAR_RATING", "RADIO", "TEXTBOX"]);
    expect(k.cauHoi[1].luaChon).toEqual(["Bài thực hành", "Trò chơi", "Giải thích"]);
    expect(k.giaoVien).toEqual([{ ghiDanhId: A("dk1"), giaoVienId: ids.gv, tenGiaoVien: "Cô Lan", tenLop: "Lớp Robot", vaiTro: "GV" }]);
    expect(JSON.stringify(bat.data)).not.toMatch(/studentId|phone|email|seed\.invalid/i);
    expect((await json(await dgGet(rq("GET", A("s2"), undefined, bearer(tA)), ctx(A("s2"))))).data.khoi).toEqual([]); // con chưa ghi danh
  });

  it("[DGGV-02] gửi: sai dữ liệu ⇒ 400/422; đúng ⇒ 200; gửi lại ⇒ 409; khối biến mất; đợt đóng ⇒ 409", async () => {
    expect((await gui(tA, A("s1"), tot({ traLoi: [{ cauHoiId: q.chon, luaChon: ["Trò chơi"] }] }))).status).toBe(400); // thiếu sao (bắt buộc)
    expect((await gui(tA, A("s1"), tot({ traLoi: [{ cauHoiId: q.sao, soSao: 6 }] }))).status).toBe(400); // sao ngoài 1–5 (schema)
    expect((await gui(tA, A("s1"), tot({ traLoi: [{ cauHoiId: "khong-co", soSao: 3 }] }))).status).toBe(400); // câu lạ
    const gvLa = await gui(tA, A("s1"), tot({ giaoVienId: ids.gv2 }));
    expect([gvLa.status, (await json(gvLa)).error?.code]).toEqual([422, "KHONG_DUOC_DANH_GIA"]); // GV không dạy con
    expect((await gui(tA, A("s1"), tot({ dotId: "dot-la" }))).status).toBe(404);
    const ok = await gui(tA, A("s1"), tot());
    expect([ok.status, (await json(ok)).data]).toEqual([200, { daGui: true }]);
    const dong = await db.evalResponse.findMany({ where: { roundId: dot }, select: { studentId: true, teacherId: true, enrollmentId: true } });
    expect(dong).toEqual([{ studentId: A("s1"), teacherId: ids.gv, enrollmentId: A("dk1") }]); // OD-16: ghi danh tính (không ẩn danh)
    const lai = await gui(tA, A("s1"), tot());
    expect([lai.status, (await json(lai)).error?.code]).toEqual([409, "DA_DANH_GIA"]);
    expect(await db.evalResponse.count({ where: { roundId: dot } })).toBe(1); // không nhân đôi
    expect((await json(await dgGet(rq("GET", A("s1"), undefined, bearer(tA)), ctx(A("s1"))))).data.khoi).toEqual([]); // đã đánh giá xong
    await db.evaluationRound.update({ where: { id: dot }, data: { closesAt: new Date(Date.now() - 1000) } });
    const dongDot = await gui(tB, A("s3"), tot({ ghiDanhId: A("dk3") }));
    expect([dongDot.status, (await json(dongDot)).error?.code]).toEqual([409, "DOT_DA_DONG"]);
    await db.evaluationRound.update({ where: { id: dot }, data: { closesAt: new Date(Date.now() + 86_400_000) } });
  });

  it("[DGGV-03] IDOR + xác thực: con nhà khác 404; không token 401; trường lạ 400; ghi danh của con khác ⇒ 422", async () => {
    expect((await dgGet(rq("GET", A("s1"), undefined, bearer(tB)), ctx(A("s1")))).status).toBe(404);
    expect((await gui(tB, A("s1"), tot())).status).toBe(404);
    expect((await dgGet(rq("GET", A("s1")), ctx(A("s1")))).status).toBe(401);
    expect((await gui(tB, A("s3"), tot({ them: 1, ghiDanhId: A("dk3") }))).status).toBe(400);
    const cheo = await gui(tB, A("s3"), tot({ ghiDanhId: A("dk1") })); // dùng ghi danh của con nhà A cho con mình
    expect([cheo.status, (await json(cheo)).error?.code]).toEqual([422, "KHONG_DUOC_DANH_GIA"]);
    expect(await db.evalResponse.count({ where: { roundId: dot, studentId: A("s3") } })).toBe(0);
  });

  it("[DGGV-04] chế độ học sinh: đúng con GET/POST được; con anh/chị/em 403", async () => {
    expect((await codePost(req("POST", { ma: "4729", xacNhan: "4729" }, bearer(tA)))).status).toBe(200);
    expect((await enterPost(req("POST", { studentId: A("s1") }, bearer(tA)))).status).toBe(200);
    expect((await dgGet(rq("GET", A("s1"), undefined, bearer(tA)), ctx(A("s1")))).status).toBe(200);
    expect((await dgGet(rq("GET", A("s2"), undefined, bearer(tA)), ctx(A("s2")))).status).toBe(403); // anh/chị/em
    expect((await gui(tA, A("s2"), tot())).status).toBe(403);
    await db.evalResponse.deleteMany({ where: { roundId: dot, studentId: A("s1") } });
    expect((await gui(tA, A("s1"), tot())).status).toBe(200); // học sinh tự gửi cho chính mình
  });
});
