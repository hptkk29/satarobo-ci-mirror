import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as khaoSatGet } from "@/app/api/mobile/v1/students/[studentId]/surveys/route";
import { GET as gopYGet, POST as gopYPost } from "@/app/api/mobile/v1/students/[studentId]/center-feedback/route";
import { POST as khaoSatPost } from "@/app/api/mobile/v1/students/[studentId]/surveys/[surveyId]/responses/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [KS-DB] Khảo sát tháng trên POSTGRES THẬT (OD-16, chủ dự án chốt 19/11/2026: thang 0–10, KHÔNG ẩn danh). Gọi thẳng route handler.
 *   [KS-DB-01] đọc: chỉ khảo sát «mục góp ý» (GENERAL) đang mở, đúng cơ sở của con, KÈM câu hỏi theo thứ tự; khảo sát khác mốc / đã đóng / cơ sở khác KHÔNG hiện; 401 khi chưa đăng nhập
 *   [KS-DB-02] gửi hợp lệ ⇒ ĐÚNG MỘT bản ghi gắn tài khoản của phụ huynh (parentUserId = phiên), npsScore từ câu NPS, answers theo câu; đọc lại thấy ở «đã làm» (DA_GUI) và biến khỏi «đang mở»
 *   [KS-DB-03] gửi lần hai ⇒ 409, KHÔNG thêm bản ghi; gửi sai (NPS 11, RATING 0, thiếu câu, đáp án lạ) ⇒ 400 và KHÔNG ghi gì
 *   [KS-DB-04] KHÔNG tin client: surveyId của mốc khác / đã đóng / cơ sở khác ⇒ 404; `parentUserId` trong thân yêu cầu bị bỏ qua (bản ghi vẫn mang người gửi thật)
 *   [KS-DB-06] HẠN (B-06): còn hạn ⇒ trả `han` (ISO); QUÁ hạn ⇒ biến khỏi «đang mở» và gửi ⇒ 404, KHÔNG ghi; không hạn (NULL) ⇒ hành vi cũ
 *   [GY-DB-01..03] GÓP Ý 0–10 (B-05): ghi `npsScore` + `rating` quy đổi (admin cũ còn đọc được); app cũ (sao 1–5) vẫn chạy với `npsScore` NULL; điểm 11 / -1 / thiếu cả hai ⇒ 400 và không ghi; đọc lại trả `diem`
 *   [KS-DB-05] CÁCH LY NHÀ: nhà B gửi / đọc cho con nhà A ⇒ 404; đối chứng dương: nhà B làm được cho con mình; nhà A thấy lịch sử của mình, KHÔNG thấy của nhà B
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "kstest-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966300001", B: "0966300002" };
let dem = 0;
const ipMoi = () => `10.99.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const ctxHs = (id: string) => ({ params: Promise.resolve({ studentId: id }) });
const ctxKs = (hs: string, ks: string) => ({ params: Promise.resolve({ studentId: hs, surveyId: ks }) });
const ids: Record<string, string> = {};
let qId: Record<string, string> = {};

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, nenTang: "ios", tenMay: "iPhone", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return (b.data as { accessToken: string }).accessToken;
}

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.surveyResponse.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.parentFeedback.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.survey.deleteMany({ where: { title: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

describe.skipIf(!RUN)("[KS-DB] khảo sát tháng — Postgres thật", () => {
  let tokA = "";
  let tokB = "";
  let ksChinh = "";
  let ksMocKhac = "";
  let ksDong = "";
  let ksCoSoKhac = "";
  const traLoiDu = (): Array<{ questionId: string; value: number | string }> => [
    { questionId: qId.nps!, value: 9 },
    { questionId: qId.gv!, value: 5 },
    { questionId: qId.cs!, value: 4 },
    { questionId: qId.lh!, value: 3 },
    { questionId: qId.cp!, value: 4 },
    { questionId: qId.txt!, value: "Máy lạnh phòng 302" },
  ];

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B"] as const) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    await db.center.create({ data: { id: `${NS}cs1`, name: "Cơ sở KS-1", slug: `${NS}cs1`, address: "Địa chỉ 1" } });
    await db.center.create({ data: { id: `${NS}cs2`, name: "Cơ sở KS-2", slug: `${NS}cs2`, address: "Địa chỉ 2" } });
    await db.course.create({ data: { id: `${NS}kh`, name: "Khoá KS", slug: `${NS}kh`, totalSessions: 12 } });
    await db.class.create({ data: { id: `${NS}l1`, name: "Lớp KS", classCode: "KS.L1", courseId: `${NS}kh`, centerId: `${NS}cs1`, status: "ACTIVE", isActive: true, startTime: "18:00", endTime: "19:00" } });
    await db.student.create({ data: { id: `${NS}hs-a`, name: `${NS}An`, parentUserId: ids.A, centerId: `${NS}cs1` } as never });
    await db.student.create({ data: { id: `${NS}hs-b`, name: `${NS}Binh`, parentUserId: ids.B, centerId: `${NS}cs1` } as never });
    for (const k of ["a", "b"]) await db.enrollment.create({ data: { id: `${NS}dk-${k}`, studentId: `${NS}hs-${k}`, classId: `${NS}l1`, courseId: `${NS}kh`, status: "ACTIVE", centerId: `${NS}cs1` } });

    const cauHoi = [
      { text: "Ba mẹ sẵn lòng giới thiệu Sata Robo ở mức nào?", type: "NPS", order: 1 },
      { text: "Thầy cô giảng dạy", type: "RATING", order: 2 },
      { text: "Phòng học, thiết bị", type: "RATING", order: 3 },
      { text: "Liên lạc với ba mẹ", type: "RATING", order: 4 },
      { text: "Cổng phụ huynh này", type: "RATING", order: 5 },
      { text: "Điều ba mẹ muốn trung tâm làm tốt hơn", type: "TEXT", order: 6 },
    ] as const;
    const tao = async (tieuDe: string, data: Record<string, unknown>) =>
      (await db.survey.create({ data: { title: `${NS}${tieuDe}`, milestone: "GENERAL", isActive: true, questions: { create: cauHoi.map((c) => ({ ...c })) }, ...data } as never, select: { id: true } })).id;
    ksChinh = await tao("Khảo sát tháng 11", {});
    ksMocKhac = await tao("Khảo sát giữa khoá", { milestone: "MID_COURSE" });
    ksDong = await tao("Khảo sát đã đóng", { isActive: false });
    ksCoSoKhac = await tao("Khảo sát cơ sở 2", { centerId: `${NS}cs2` });
    const qs = await db.surveyQuestion.findMany({ where: { surveyId: ksChinh }, orderBy: { order: "asc" } });
    qId = { nps: qs[0]!.id, gv: qs[1]!.id, cs: qs[2]!.id, lh: qs[3]!.id, cp: qs[4]!.id, txt: qs[5]!.id };

    tokA = await dangNhap(PHONE.A, 1);
    tokB = await dangNhap(PHONE.B, 2);
    for (const t of [tokA, tokB]) await quyDinhDongY(req("/x", {}, `Bearer ${t}`));
  }, 60_000);
  afterAll(don);

  const doc = async (tok: string, hs: string) => (await json(await khaoSatGet(req("/x", undefined, `Bearer ${tok}`), ctxHs(hs)))).data as { dangMo: Array<{ id: string; tieuDe: string; cauHoi: Array<{ id: string; loai: string; nhan: string }> }>; daLam: Array<{ khaoSatId: string; trangThai: string; diemNps: number | null }> };
  const gui = (tok: string, hs: string, ks: string, than: unknown) => khaoSatPost(req("/x", than, `Bearer ${tok}`), ctxKs(hs, ks));

  it("[KS-DB-01] đọc: chỉ khảo sát GENERAL đang mở của cơ sở con, kèm câu hỏi theo thứ tự; 401 khi chưa đăng nhập", async () => {
    expect((await khaoSatGet(req("/x"), ctxHs(`${NS}hs-a`))).status).toBe(401);
    const d = await doc(tokA, `${NS}hs-a`);
    expect(d.dangMo.map((k) => k.id)).toEqual([ksChinh]); // không có mốc khác / đã đóng / cơ sở 2
    expect(d.dangMo[0]!.cauHoi.map((c) => c.loai)).toEqual(["NPS", "RATING", "RATING", "RATING", "RATING", "TEXT"]);
    expect(d.dangMo[0]!.cauHoi[0]!.nhan).toContain("giới thiệu");
    expect(d.daLam).toEqual([]);
  });

  it("[KS-DB-02] gửi hợp lệ ⇒ ĐÚNG MỘT bản ghi gắn tài khoản người gửi; đọc lại: biến khỏi «đang mở», hiện ở «đã làm»", async () => {
    const r = await gui(tokA, `${NS}hs-a`, ksChinh, { dapAn: traLoiDu() });
    expect(r.status).toBe(200);
    const dong = await db.surveyResponse.findMany({ where: { surveyId: ksChinh, studentId: `${NS}hs-a` } });
    expect(dong).toHaveLength(1);
    expect(dong[0]!.parentUserId).toBe(ids.A); // do máy chủ gắn từ phiên — không ẩn danh
    expect(dong[0]!.npsScore).toBe(9);
    expect(dong[0]!.centerId).toBe(`${NS}cs1`);
    expect(dong[0]!.answers).toMatchObject({ [qId.gv!]: 5, [qId.txt!]: "Máy lạnh phòng 302" });
    const d = await doc(tokA, `${NS}hs-a`);
    expect(d.dangMo).toEqual([]);
    expect(d.daLam.map((x) => [x.khaoSatId, x.trangThai, x.diemNps])).toEqual([[ksChinh, "DA_GUI", 9]]);
  });

  it("[KS-DB-03] gửi lần hai ⇒ 409, không thêm bản ghi; gửi sai ⇒ 400 và không ghi gì", async () => {
    const lai = await gui(tokA, `${NS}hs-a`, ksChinh, { dapAn: traLoiDu() });
    expect([lai.status, (await json(lai)).error?.code]).toEqual([409, "VALIDATION"]);
    expect(await db.surveyResponse.count({ where: { surveyId: ksChinh, studentId: `${NS}hs-a` } })).toBe(1);

    const truoc = await db.surveyResponse.count({ where: { studentId: `${NS}hs-b` } });
    const sai: Array<[string, unknown]> = [
      ["NPS 11", { dapAn: traLoiDu().map((d) => (d.questionId === qId.nps ? { ...d, value: 11 } : d)) }],
      ["RATING 0", { dapAn: traLoiDu().map((d) => (d.questionId === qId.gv ? { ...d, value: 0 } : d)) }],
      ["thiếu câu NPS", { dapAn: traLoiDu().filter((d) => d.questionId !== qId.nps) }],
      ["đáp án lạ", { dapAn: [...traLoiDu(), { questionId: "khong-co", value: 1 }] }],
      ["rỗng", { dapAn: [] }],
    ];
    for (const [ten, than] of sai) expect([ten, (await gui(tokB, `${NS}hs-b`, ksChinh, than)).status]).toEqual([ten, 400]);
    expect(await db.surveyResponse.count({ where: { studentId: `${NS}hs-b` } })).toBe(truoc);
  });

  it("[KS-DB-04] KHÔNG tin client: khảo sát mốc khác / đã đóng / cơ sở khác ⇒ 404; parentUserId trong thân bị bỏ qua", async () => {
    for (const [ten, ks] of [["mốc khác", ksMocKhac], ["đã đóng", ksDong], ["cơ sở khác", ksCoSoKhac], ["không tồn tại", "khong-co"]] as const) {
      expect([ten, (await gui(tokB, `${NS}hs-b`, ks, { dapAn: traLoiDu() })).status]).toEqual([ten, 404]);
    }
    const r = await gui(tokB, `${NS}hs-b`, ksChinh, { dapAn: traLoiDu(), parentUserId: ids.A, anDanh: true });
    expect(r.status).toBe(200);
    const dong = await db.surveyResponse.findFirstOrThrow({ where: { surveyId: ksChinh, studentId: `${NS}hs-b` } });
    expect(dong.parentUserId).toBe(ids.B); // người gửi thật, không phải giá trị client nhét vào
  });

  it("[KS-DB-05] cách ly nhà: B gửi/đọc cho con nhà A ⇒ 404; mỗi nhà chỉ thấy lịch sử của mình", async () => {
    expect((await gui(tokB, `${NS}hs-a`, ksChinh, { dapAn: traLoiDu() })).status).toBe(404);
    expect((await khaoSatGet(req("/x", undefined, `Bearer ${tokB}`), ctxHs(`${NS}hs-a`))).status).toBe(404);
    const a = await doc(tokA, `${NS}hs-a`);
    const b = await doc(tokB, `${NS}hs-b`);
    expect(a.daLam).toHaveLength(1);
    expect(b.daLam).toHaveLength(1);
    expect(a.daLam[0]!.diemNps).toBe(9);
  });
  it("[KS-DB-06] hạn nộp: còn hạn ⇒ có `han`; quá hạn ⇒ biến khỏi «đang mở» và gửi ⇒ 404 không ghi; NULL ⇒ như cũ", async () => {
    const homNay = Date.now();
    const conHan = await db.survey.create({ data: { title: `${NS}Còn hạn`, milestone: "GENERAL", isActive: true, closesAt: new Date(homNay + 3 * 86_400_000), questions: { create: [{ text: "Điểm", type: "NPS", order: 1 }] } } as never, select: { id: true } });
    const quaHan = await db.survey.create({ data: { title: `${NS}Quá hạn`, milestone: "GENERAL", isActive: true, closesAt: new Date(homNay - 60_000), questions: { create: [{ text: "Điểm", type: "NPS", order: 1 }] } } as never, select: { id: true } });
    const d = await doc(tokB, `${NS}hs-b`);
    const mo = d.dangMo as unknown as Array<{ id: string; han: string | null }>;
    expect(mo.find((k) => k.id === conHan.id)?.han).toBe(new Date(homNay + 3 * 86_400_000).toISOString());
    expect(mo.some((k) => k.id === quaHan.id)).toBe(false);
    const qh = await db.surveyQuestion.findFirstOrThrow({ where: { surveyId: quaHan.id } });
    const truoc = await db.surveyResponse.count({ where: { surveyId: quaHan.id } });
    expect((await gui(tokB, `${NS}hs-b`, quaHan.id, { dapAn: [{ questionId: qh.id, value: 8 }] })).status).toBe(404);
    expect(await db.surveyResponse.count({ where: { surveyId: quaHan.id } })).toBe(truoc);
    const ch = await db.surveyQuestion.findFirstOrThrow({ where: { surveyId: conHan.id } });
    expect((await gui(tokB, `${NS}hs-b`, conHan.id, { dapAn: [{ questionId: ch.id, value: 8 }] })).status).toBe(200); // đối chứng dương: còn hạn thì ghi được
  });

  const guiGopY = (tok: string, hs: string, than: unknown) => gopYPost(req("/x", than, `Bearer ${tok}`), ctxHs(hs));
  it("[GY-DB-01] góp ý điểm 0–10 ⇒ ghi npsScore + rating quy đổi; đọc lại trả `diem`", async () => {
    const r = await guiGopY(tokA, `${NS}hs-a`, { diem: 3, chuDe: "Cơ sở vật chất", noiDung: "Phòng học hơi nóng vào buổi chiều" });
    expect(r.status).toBe(200);
    const dong = await db.parentFeedback.findFirstOrThrow({ where: { parentUserId: ids.A, studentId: `${NS}hs-a` } });
    expect([dong.npsScore, dong.rating]).toEqual([3, 2]); // ceil(3/2)=2
    const ds = (await json(await gopYGet(req("/x", undefined, `Bearer ${tokA}`), ctxHs(`${NS}hs-a`)))).data as { daGui: Array<{ diem: number | null; sao: number }> };
    expect(ds.daGui.map((x) => [x.diem, x.sao])).toEqual([[3, 2]]);
  });
  it("[GY-DB-02] app cũ (sao 1–5) vẫn chạy: npsScore NULL, rating giữ nguyên", async () => {
    const r = await guiGopY(tokB, `${NS}hs-b`, { sao: 4, chuDe: "Khác", noiDung: "Bản app cũ vẫn gửi được" });
    expect(r.status).toBe(200);
    const dong = await db.parentFeedback.findFirstOrThrow({ where: { parentUserId: ids.B, studentId: `${NS}hs-b` } });
    expect([dong.npsScore, dong.rating]).toEqual([null, 4]);
  });
  it("[GY-DB-03] điểm 11 / -1 / không điểm ⇒ 400 và không ghi gì", async () => {
    const truoc = await db.parentFeedback.count({ where: { parentUserId: ids.B } });
    for (const [ten, than] of [["11", { diem: 11 }], ["-1", { diem: -1 }], ["lẻ", { diem: 4.5 }], ["thiếu", {}]] as const) {
      const res = await guiGopY(tokB, `${NS}hs-b`, { ...than, chuDe: "Khác", noiDung: "Nội dung đủ dài rồi" });
      expect([ten, res.status]).toEqual([ten, 400]);
    }
    expect(await db.parentFeedback.count({ where: { parentUserId: ids.B } })).toBe(truoc);
  });
});
