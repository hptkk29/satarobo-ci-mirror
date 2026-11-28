import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as tongQuanGet } from "@/app/api/mobile/v1/parent/disc/route";
import { POST as bookPost } from "@/app/api/mobile/v1/parent/disc/book/route";
import { GET as membersGet, POST as membersPost } from "@/app/api/mobile/v1/parent/disc/members/route";
import { GET as reportGet } from "@/app/api/mobile/v1/parent/disc/members/[memberId]/report/route";
import { POST as memberDeletePost } from "@/app/api/mobile/v1/parent/disc/members/[memberId]/delete/route";
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
import { POST as pinPost } from "@/app/api/mobile/v1/parent/disc/pin/route";
import { POST as pinVerifyPost } from "@/app/api/mobile/v1/parent/disc/pin/verify/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import * as auditMod from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { docVe } from "@/lib/disc/ngan-hang/de-ky";
import { timCauNganHang } from "@/lib/disc/ngan-hang/nap";
import { layKhoaDisc } from "@/lib/disc/phone-key";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [MDISC-DB] DISC trên app — POSTGRES THẬT, gọi thẳng route handler (KHÔNG chạy HTTP/Next). Dữ liệu GIẢ, dọn theo tiền tố `dsctest-`.
 * ⚠️ Spec này CHƯA TỪNG ĐƯỢC CHẠY (tác giả bị cấm chạy Postgres) — chỉ qua kiểm kiểu ở mức tệp lẻ không có; người vận hành chạy trên DB nháp (`satarobo_vitest` / `mobile_b1_nhap` / `*_test`)
 * và sửa lỗi cú pháp/tiền đề nếu có. Các ca CHẠY NỐI TIẾP (chia sẻ trạng thái sổ của nhà A) như `tests/disc-db/so-gia-dinh.test.ts` — chạy cả tệp, không chạy lẻ từng ca.
 *   [MDISC-DB-01] cờ DISC_ENABLED TẮT ⇒ 404 cho MỌI yêu cầu — kể cả chưa đăng nhập và thân rác (cờ kiểm TRƯỚC xác thực/đọc thân), và KHÔNG ghi gì
 *   [MDISC-DB-02] không token / token rác ⇒ 401 (đọc và ghi)
 *   [MDISC-DB-03] chưa có sổ: tổng quan `coSo:false` + số học viên gợi ý; màn khác ⇒ 404; lập sổ hai lần ⇒ 409 (một tài khoản — một sổ); khoá lạ ⇒ 400
 *   [MDISC-DB-04] thành viên: thêm người lớn; nối học viên CỦA NHÀ KHÁC ⇒ 404; khoá lạ ⇒ 400; chủ sổ không xoá được; xoá BẮT BUỘC chọn chế độ
 *   [MDISC-DB-05] CÁCH LY NHÀ: nhà B đọc/ghi bằng id của nhà A ⇒ cùng 404; phản hồi của B không chứa tên/id của A; đối chứng dương: nhà A làm được với chính id đó
 *   [MDISC-DB-06] làm bài: đề KHÔNG kèm khoá chấm; nháp; thiếu câu / trả lời phẳng / ngoài thang ⇒ 400 và NHÁP CÒN (làm tiếp được); điểm gửi lên bị bác (khoá lạ); vé của người khác ⇒ 400
 *   [MDISC-DB-07] NỘP MỘT LẦN: nộp lại cùng vé ⇒ trả kết quả cũ (`lapLai`), ĐÚNG MỘT dòng DiscBaiLam; hai yêu cầu ĐỒNG THỜI ⇒ vẫn một dòng; nhà khác dùng vé của nhà A ⇒ 404 và không ghi
 *   [MDISC-DB-08] báo cáo cá nhân / thẻ cặp: nội dung có thật sau khi có bài; chưa có bài ⇒ 404; id lạ ở thẻ cặp không lộ; không còn liên kết web
 *   [MDISC-DB-09] kế hoạch: tạo, đánh dấu xong (một lần), cảm ơn, check-in; nhà B không đụng được việc/kế hoạch của A (404)
 *   [MDISC-DB-10] xoá một lần làm / thành viên: chủ xoá được; nhà khác ⇒ 404; chủ sổ ⇒ 409; thiếu chế độ ⇒ 400
 *   [MDISC-DB-11] PIN: sai ⇒ 403; sai tới ngưỡng ⇒ 429 + Retry-After; ĐÚNG khi đang khoá vẫn 429
 *   [MDISC-DB-12] chế độ học sinh (H-S3): phiên đã khoá vào một học sinh ⇒ 403 ở MỌI route DISC (đọc lẫn ghi); đối chứng dương: phụ huynh thường vào được
 *   [MDISC-DB-13] không rò: không SĐT/email/userId/pinHash trong phản hồi của chính chủ; không `href` / `/portal/` ở view-model
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "dsctest-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966700001", B: "0966700002", C: "0966700003" };
let dem = 0;
const ipMoi = () => `10.96.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string, tho?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined && tho === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) },
    body: tho !== undefined ? tho : body === undefined ? undefined : JSON.stringify(body),
  });
type Ket = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; maChiTiet?: string } };
const json = async (r: Response) => (await r.json()) as Ket;
const ids: Record<string, string> = {};
const bearer = (t: string) => `Bearer ${t}`;
const BASE = "/api/mobile/v1/parent/disc";
const U = (p: string) => `${BASE}${p}`;
const cMember = (memberId: string) => ({ params: Promise.resolve({ memberId }) });
const cResult = (resultId: string) => ({ params: Promise.resolve({ resultId }) });
const cTask = (taskId: string) => ({ params: Promise.resolve({ taskId }) });
const homNayVN = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-8000-${String(n + 700).padStart(12, "0")}`, nenTang: "ios", tenMay: "iPhone", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return (b.data as { accessToken: string }).accessToken;
}

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.discGiaDinh.deleteMany({ where: { ownerUserId: { in: uids } } }); // thành viên / bài / nháp / phân tích / kế hoạch xoá theo ON DELETE CASCADE
  await db.auditLog.deleteMany({ where: { module: "disc", actorId: { in: uids } } });
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

/** Câu trả lời KHÔNG phẳng, thiên về MỘT trục (đọc khoá chấm từ vé — CHỈ test được làm vậy, như `tests/disc-db/so-gia-dinh.test.ts`). */
function traLoiThienVe(ve: string, tvId: string, cao: "D" | "I" | "S" | "C", max: number): Record<string, number> {
  const d = docVe(ve, layKhoaDisc(), tvId, new Date());
  if (!d.ok) throw new Error("vé hỏng trong fixture");
  const r: Record<string, number> = {};
  d.de.maCau.forEach((ma, i) => {
    const c = timCauNganHang(ma);
    if (!c) throw new Error("mã câu lạ");
    r[String(i)] = c.truc === cao ? (c.dao ? 1 : max) : c.dao ? Math.max(2, max - 1) : 2;
  });
  return r;
}

type De = { boDe: string; cau: Array<Record<string, unknown>>; thang: Array<{ gia: number }>; ve: string; traLoi: Record<string, number>; tiepTuc: boolean };
const toiDa = (de: De) => de.thang.reduce((m, x) => Math.max(m, x.gia), 0);
type Tv = { id: string; ten: string; laChuSo: boolean; studentId: string | null; boTuLam: string | null };

describe.skipIf(!RUN)("[MDISC-DB] DISC trên app — Postgres thật", () => {
  let tokA = "";
  let tokB = "";
  let tokC = "";
  let meA = "";
  let conA = "";
  let ongA = "";
  let meB = "";
  let baiMeA = "";
  let keHoachA = "";

  const kq = async (r: Response) => ({ status: r.status, retryAfter: r.headers.get("retry-after"), b: await json(r) });
  const lay = async (h: (r: Request) => Promise<Response>, url: string, tok?: string) => kq(await h(req(url, undefined, tok ? bearer(tok) : undefined)));
  const goi = async (h: (r: Request) => Promise<Response>, url: string, body: unknown, tok?: string) => kq(await h(req(url, body, tok ? bearer(tok) : undefined)));
  const danhSachTv = async (tok: string) => ((await lay(membersGet, U("/members"), tok)).b.data as { manThanhVien: { thanhVien: Tv[] } }).manThanhVien.thanhVien;
  const batDau = async (tok: string, thanhVienId: string, cachLam: "TU_LAM" | "GOC_NHIN" = "TU_LAM") => goi(startPost, U("/test/start"), { thanhVienId, cachLam }, tok);
  const nop = (tok: string, thanhVienId: string, ve: string, traLoi: unknown) => goi(submitPost, U("/test/submit"), { thanhVienId, cachLam: "TU_LAM", ve, traLoi }, tok);
  const soBai = (thanhVienId: string) => db.discBaiLam.count({ where: { thanhVienId } });
  const deCua = (r: { b: Ket }) => (r.b.data as { de: De }).de;

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    process.env.DISC_ENABLED = "true";
    process.env.DISC_NGAN_HANG_ENABLED = "true"; // bộ đề do vé mang mã câu riêng (maDe khác nhau mỗi lần) — cần cho ca [MDISC-DB-07]
    process.env.DISC_PEPPER = "kiem-thu-disc-pepper-khong-phai-bi-mat-123456";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B", "C"] as const) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    // Nhà A có MỘT con (sinh 2016 ⇒ lớp 5 ⇒ bộ tiểu học); nhà B, C mỗi nhà một con.
    await db.student.create({ data: { id: `${NS}hs-a`, name: "Bé An Thử", parentUserId: ids.A, dateOfBirth: new Date("2016-05-10T05:00:00Z") } as never });
    await db.student.create({ data: { id: `${NS}hs-b`, name: "Bé Bình Thử", parentUserId: ids.B, dateOfBirth: new Date("2016-05-10T05:00:00Z") } as never });
    await db.center.create({ data: { id: `${NS}cs1`, name: "Cơ sở DISC-1", slug: `${NS}cs1`, address: "Địa chỉ 1" } });
    await db.student.create({ data: { id: `${NS}hs-c`, name: "Bé Cúc Thử", parentUserId: ids.C, centerId: `${NS}cs1` } as never });
    tokA = await dangNhap(PHONE.A, 1);
    tokB = await dangNhap(PHONE.B, 2);
    tokC = await dangNhap(PHONE.C, 3);
    for (const t of [tokA, tokB, tokC]) await quyDinhDongY(req("/x", {}, bearer(t)));
  }, 60_000);
  afterAll(async () => {
    await don();
    delete process.env.DISC_ENABLED;
    delete process.env.DISC_NGAN_HANG_ENABLED;
    delete process.env.DISC_PEPPER;
  });

  it("[MDISC-DB-01] cờ TẮT ⇒ 404 cho mọi yêu cầu — kể cả chưa đăng nhập và thân rác; không ghi gì", async () => {
    process.env.DISC_ENABLED = "false";
    try {
      expect((await lay(tongQuanGet, U(""))).status).toBe(404);
      expect((await lay(tongQuanGet, U(""), tokA)).status).toBe(404);
      expect((await submitPost(req(U("/test/submit"), undefined, undefined, "đây không phải JSON"))).status).toBe(404);
      expect((await submitPost(req(U("/test/submit"), undefined, bearer(tokA), "x".repeat(1000)))).status).toBe(404);
      expect((await goi(bookPost, U("/book"), { tenChuSo: "Mẹ", vaiTroChuSo: "me" }, tokA)).status).toBe(404);
      expect(await db.discGiaDinh.count({ where: { ownerUserId: ids.A } })).toBe(0);
    } finally {
      process.env.DISC_ENABLED = "true";
    }
  });

  it("[MDISC-DB-02] không token / token rác ⇒ 401", async () => {
    expect((await lay(tongQuanGet, U(""))).status).toBe(401);
    expect((await lay(tongQuanGet, U(""), "rac.rac.rac")).status).toBe(401);
    expect((await goi(submitPost, U("/test/submit"), { thanhVienId: "a", cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 } })).status).toBe(401);
    expect((await goi(bookPost, U("/book"), { tenChuSo: "Mẹ", vaiTroChuSo: "me" })).status).toBe(401);
  });

  it("[MDISC-DB-03] chưa có sổ ⇒ coSo:false + số học viên gợi ý; màn khác 404; lập sổ 200 rồi lần hai 409; khoá lạ 400", async () => {
    const t = await lay(tongQuanGet, U(""), tokA);
    expect(t.status).toBe(200);
    expect(t.b.data).toEqual({ coSo: false, soHocVienGoiY: 1 });
    for (const [h, u] of [[membersGet, "/members"], [optionsGet, "/test/options"], [pairsGet, "/pairs"], [planGet, "/plan"]] as const) expect((await lay(h, U(u), tokA)).status, u).toBe(404);

    expect((await goi(bookPost, U("/book"), { tenChuSo: "Mẹ Thử A", vaiTroChuSo: "me", namSinhChuSo: 1990, userId: ids.B }, tokA)).status).toBe(400); // khoá lạ
    const a = await goi(bookPost, U("/book"), { tenChuSo: "Mẹ Thử A", vaiTroChuSo: "me", namSinhChuSo: 1990 }, tokA);
    expect(a.status).toBe(200);
    expect(a.b.data).toMatchObject({ soGoiY: 1 });
    expect((await goi(bookPost, U("/book"), { tenChuSo: "Mẹ Thử A", vaiTroChuSo: "me" }, tokA)).status).toBe(409);
    expect((await goi(bookPost, U("/book"), { tenChuSo: "Bố Thử B", vaiTroChuSo: "bo", goiYHocVien: false }, tokB)).status).toBe(200);
    expect((await lay(tongQuanGet, U(""), tokA)).b.data).toMatchObject({ coSo: true, soThanhVien: 2, coPin: false });
  });

  it("[MDISC-DB-04] thành viên: thêm người lớn; nối học viên nhà khác ⇒ 404; khoá lạ/tên rỗng ⇒ 400; xoá: chủ sổ 409, thiếu chế độ 400, người tạm xoá được", async () => {
    const a0 = await danhSachTv(tokA);
    expect(a0).toHaveLength(2);
    meA = a0.find((t) => t.laChuSo)!.id;
    const con = a0.find((t) => !t.laChuSo)!;
    conA = con.id;
    expect(con.studentId).toBe(`${NS}hs-a`);
    expect(["TH", "THCS"]).toContain(con.boTuLam); // bộ do MÁY CHỦ định tuyến theo lớp suy từ năm sinh

    const ong = await goi(membersPost, U("/members"), { ten: "Ông Ngoại Thử", vaiTro: "ong", namSinh: 1958 }, tokA);
    expect(ong.status).toBe(200);
    expect(ong.b.data).toMatchObject({ moi: true });
    ongA = (ong.b.data as { id: string }).id;

    expect((await goi(membersPost, U("/members"), { ten: "Con người khác", vaiTro: "con", studentId: `${NS}hs-b` }, tokA)).status).toBe(404); // học viên của nhà B
    expect((await goi(membersPost, U("/members"), { ten: "Lạ", vaiTro: "ong", ownerUserId: ids.B }, tokA)).status).toBe(400);
    expect((await goi(membersPost, U("/members"), { ten: "", vaiTro: "ong" }, tokA)).status).toBe(400);

    const tam = (await goi(membersPost, U("/members"), { ten: "Người Tạm", vaiTro: "khac" }, tokA)).b.data as { id: string };
    expect((await kq(await memberDeletePost(req(U(`/members/${meA}/delete`), { cheDo: "giu-bai" }, bearer(tokA)), cMember(meA)))).status).toBe(409); // chủ sổ
    expect((await kq(await memberDeletePost(req(U(`/members/${tam.id}/delete`), {}, bearer(tokA)), cMember(tam.id)))).status).toBe(400); // phải chọn chế độ
    const xoa = await kq(await memberDeletePost(req(U(`/members/${tam.id}/delete`), { cheDo: "xoa-bai" }, bearer(tokA)), cMember(tam.id)));
    expect(xoa.status).toBe(200);
    expect(xoa.b.data).toEqual({ daXoaBai: 0, daGiuBai: 0 });
    expect(await danhSachTv(tokA)).toHaveLength(3);
    meB = (await danhSachTv(tokB)).find((t) => t.laChuSo)!.id;
  });

  it("[MDISC-DB-05] CÁCH LY NHÀ: nhà B dùng id của nhà A ⇒ cùng 404, không rò tên/id; đối chứng dương: A làm được", async () => {
    const bTrenA = [
      await kq(await reportGet(req(U(`/members/${conA}/report`), undefined, bearer(tokB)), cMember(conA))),
      await batDau(tokB, conA),
      await goi(draftPost, U("/test/draft"), { thanhVienId: conA, cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 } }, tokB),
      await goi(membersPost, U("/members"), { id: conA, ten: "Bị chiếm", vaiTro: "con" }, tokB),
      await kq(await memberDeletePost(req(U(`/members/${conA}/delete`), { cheDo: "xoa-bai" }, bearer(tokB)), cMember(conA))),
      await goi(submitPost, U("/test/submit"), { thanhVienId: conA, cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 } }, tokB),
    ];
    // Cả sáu cùng 404 (thành viên không thuộc sổ B được kiểm TRƯỚC vé/thân) — không phân biệt "của nhà khác" với "không tồn tại".
    for (const r of bTrenA) expect([r.status, r.b.error?.code], JSON.stringify(r.b)).toEqual([404, "NOT_FOUND"]);
    expect((await danhSachTv(tokA)).find((t) => t.id === conA)!.ten).not.toBe("Bị chiếm"); // và KHÔNG bị ghi

    // phản hồi của B không chứa gì của A
    const phanHoiB = JSON.stringify([
      (await lay(tongQuanGet, U(""), tokB)).b,
      (await lay(membersGet, U("/members"), tokB)).b,
      (await lay(optionsGet, U("/test/options"), tokB)).b,
    ]);
    for (const x of ["Mẹ Thử A", "Bé An Thử", conA, meA, ongA, ids.A, `${NS}hs-a`]) expect(phanHoiB, x).not.toContain(x);

    // đối chứng dương: A làm được với CHÍNH id đó
    const dc = await batDau(tokA, conA);
    expect(dc.status).toBe(200);
    expect(["TH", "THCS"]).toContain(deCua(dc).boDe); // bộ do MÁY CHỦ chọn theo lớp suy từ năm sinh (đổi theo năm học khi chạy)
  });

  it("[MDISC-DB-06] làm bài: đề không kèm khoá chấm; nháp; thiếu/phẳng/ngoài thang ⇒ 400 và nháp CÒN; điểm gửi lên bị bác; vé người khác ⇒ 400", async () => {
    const s = await batDau(tokA, meA);
    expect(s.status).toBe(200);
    const de = deCua(s);
    expect(de.boDe).toBe("PH");
    expect(de.tiepTuc).toBe(false);
    expect(de.cau.length).toBeGreaterThan(20);
    for (const c of de.cau) expect(Object.keys(c).sort()).toEqual(["noiDung", "viTri"]); // KHÔNG có trục / chiều đảo
    expect(JSON.stringify(s.b)).not.toMatch(/"(truc|dao|diemDon)"/);
    const max = toiDa(de);

    // nháp
    expect((await goi(draftPost, U("/test/draft"), { thanhVienId: meA, cachLam: "TU_LAM", ve: de.ve, traLoi: { "0": 2, "1": 3 } }, tokA)).b.data).toEqual({ daLam: 2 });
    expect((await goi(draftPost, U("/test/draft"), { thanhVienId: meA, cachLam: "TU_LAM", ve: de.ve, traLoi: { "0": 99 } }, tokA)).status).toBe(400); // ngoài lược đồ
    expect((await goi(draftPost, U("/test/draft"), { thanhVienId: meA, cachLam: "TU_LAM", ve: de.ve, traLoi: { "999": 3 } }, tokA)).status).toBe(400); // vị trí ngoài đề
    expect((await goi(draftPost, U("/test/draft"), { thanhVienId: meA, cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 } }, tokA)).status).toBe(409); // vé không khớp nháp
    const tiep = deCua(await batDau(tokA, meA));
    expect([tiep.tiepTuc, tiep.ve, tiep.traLoi]).toEqual([true, de.ve, { "0": 2, "1": 3 }]);

    // nộp sai ⇒ 400 và nháp CÒN NGUYÊN (làm tiếp được)
    const phang = Object.fromEntries(de.cau.map((_, i) => [String(i), Math.ceil(max / 2)]));
    const thieu = { "0": 3, "1": 4 };
    for (const [ten, tl] of [["phẳng", phang], ["thiếu câu", thieu]] as const) {
      const r = await nop(tokA, meA, de.ve, tl);
      expect([r.status, r.b.error?.code], ten).toEqual([400, "VALIDATION"]);
      const lai = deCua(await batDau(tokA, meA));
      expect([lai.tiepTuc, lai.ve], `${ten}: nháp phải còn`).toEqual([true, de.ve]);
    }
    if (max < 7) {
      const vuot = Object.fromEntries(de.cau.map((_, i) => [String(i), 7]));
      expect((await nop(tokA, meA, de.ve, vuot)).status).toBe(400); // 7 qua lược đồ nhưng ngoài thang CỦA BỘ ĐỀ này — domain bác
    }
    // điểm / kết quả do client gửi ⇒ khoá lạ ⇒ 400 (máy chủ không bao giờ nhận điểm)
    const goiDiem = await goi(submitPost, U("/test/submit"), { thanhVienId: meA, cachLam: "TU_LAM", ve: de.ve, traLoi: thieu, diem: { D: 99, I: 0, S: 0, C: 0 } }, tokA);
    expect(goiDiem.status).toBe(400);
    // vé rác ⇒ 400; vé của NGƯỜI KHÁC trong cùng sổ ⇒ 400
    expect((await nop(tokA, meA, "khong-phai-ve-that", thieu)).status).toBe(400);
    const deOng = deCua(await batDau(tokA, ongA));
    expect((await nop(tokA, meA, deOng.ve, thieu)).status).toBe(400);
    expect(await soBai(meA)).toBe(0);
    expect(await soBai(ongA)).toBe(0);
  });

  it("[MDISC-DB-07] NỘP MỘT LẦN: nộp lại cùng vé ⇒ kết quả cũ, ĐÚNG MỘT dòng; đồng thời ⇒ vẫn một dòng; nhà khác dùng vé của A ⇒ 404", async () => {
    const de = deCua(await batDau(tokA, meA)); // làm TIẾP đề dở
    const max = toiDa(de);
    const tl = traLoiThienVe(de.ve, meA, "D", max);
    const r1 = await nop(tokA, meA, de.ve, tl);
    expect(r1.status, JSON.stringify(r1.b)).toBe(200);
    const d1 = r1.b.data as { baiId: string; lapLai: boolean; thanhVienId: string; nhan: string; diem: Record<string, number> };
    expect([d1.lapLai, d1.thanhVienId]).toEqual([false, meA]);
    expect(Object.keys(d1.diem).sort()).toEqual(["C", "D", "I", "S"]);
    baiMeA = d1.baiId;
    expect(await soBai(meA)).toBe(1);
    expect(await db.discBanNhap.count({ where: { thanhVienId: meA } })).toBe(0); // nháp mất cùng giao dịch ghi bài

    // nộp lại CÙNG vé (mất mạng / bấm đúp)
    const r2 = await nop(tokA, meA, de.ve, tl);
    expect(r2.status).toBe(200);
    expect(r2.b.data).toMatchObject({ lapLai: true, baiId: baiMeA, nhan: d1.nhan });
    expect(await soBai(meA)).toBe(1);

    // nhà B dùng vé của A ⇒ thành viên không thuộc sổ B ⇒ 404; không ghi
    expect((await nop(tokB, meA, de.ve, tl)).status).toBe(404);
    expect((await nop(tokB, meB, de.ve, tl)).status).toBe(400); // vé phát cho người khác
    expect(await soBai(meA)).toBe(1);

    // hai yêu cầu ĐỒNG THỜI cho một vé mới ⇒ tối đa MỘT dòng mới
    const de3 = deCua(await batDau(tokA, meA));
    expect(de3.tiepTuc).toBe(false);
    expect(de3.ve).not.toBe(de.ve);
    const tl3 = traLoiThienVe(de3.ve, meA, "C", toiDa(de3));
    const [x, y] = await Promise.all([nop(tokA, meA, de3.ve, tl3), nop(tokA, meA, de3.ve, tl3)]);
    for (const r of [x, y]) expect([200, 409], JSON.stringify(r.b)).toContain(r.status);
    expect([x.status, y.status]).toContain(200);
    expect(await soBai(meA)).toBe(2); // 1 cũ + ĐÚNG 1 mới
    const lanMoi = [x, y].filter((r) => r.status === 200 && (r.b.data as { lapLai: boolean }).lapLai === false);
    expect(lanMoi).toHaveLength(1);

    // người thứ hai (ông ngoại) làm bài để có thẻ cặp / kế hoạch
    const deO = deCua(await batDau(tokA, ongA));
    const rO = await nop(tokA, ongA, deO.ve, traLoiThienVe(deO.ve, ongA, "S", toiDa(deO)));
    expect(rO.status, JSON.stringify(rO.b)).toBe(200);
  });

  it("[MDISC-DB-08] báo cáo cá nhân / thẻ cặp / chọn người: có nội dung thật, chưa có bài ⇒ 404, id lạ không lộ, không còn liên kết web", async () => {
    const rep = await kq(await reportGet(req(U(`/members/${meA}/report`), undefined, bearer(tokA)), cMember(meA)));
    expect(rep.status).toBe(200);
    const baoCao = (rep.b.data as { baoCao: Record<string, unknown> }).baoCao;
    expect(baoCao).toMatchObject({ id: meA, ten: "Mẹ Thử A" });
    expect((baoCao.cot as unknown[]).length).toBe(4);
    expect(JSON.stringify(rep.b)).not.toMatch(/\/portal\/|"href"/);
    // con CHƯA có bài ⇒ 404 (cùng mã với id lạ)
    expect((await kq(await reportGet(req(U(`/members/${conA}/report`), undefined, bearer(tokA)), cMember(conA)))).status).toBe(404);
    expect((await kq(await reportGet(req(U("/members/khong-ton-tai/report"), undefined, bearer(tokA)), cMember("khong-ton-tai")))).status).toBe(404);

    const cap = await lay(pairsGet, U("/pairs"), tokA);
    expect(cap.status).toBe(200);
    const theCap = (cap.b.data as { theCap: { hang: unknown[]; khoa: string | null } }).theCap;
    expect(theCap.khoa).toBeNull();
    expect(theCap.hang).toHaveLength(2);
    expect(JSON.stringify(cap.b)).not.toMatch(/\/portal\/|"href"/);
    const lat = await lay(pairsGet, U("/pairs?a=khong-co&b=cung-khong"), tokA);
    expect(lat.status).toBe(200);
    expect(JSON.stringify(lat.b)).not.toContain("khong-co");
    expect((await lay(pairsGet, U("/pairs?x=1"), tokA)).status).toBe(400);

    const op = (await lay(optionsGet, U("/test/options"), tokA)).b.data as { nguoi: Array<{ id: string; tuLam: { duoc: boolean }; gocNhin: { duoc: boolean; lyDo?: string }; coNhap: boolean }> };
    expect(op.nguoi).toHaveLength(3);
    expect(op.nguoi.find((n) => n.id === meA)!.gocNhin.duoc).toBe(false); // người lớn không có «góc nhìn»
    expect(op.nguoi.find((n) => n.id === conA)!.coNhap).toBe(true); // nháp dở từ ca [05]
  });

  it("[MDISC-DB-09] kế hoạch: tạo, đánh dấu xong một lần, cảm ơn, check-in; nhà B không đụng được (404)", async () => {
    expect((await goi(planPost, U("/plan"), { ky: "NGAY_7", batDau: "2020-01-01" }, tokA)).status).toBe(400); // ngày quá khứ (NGAY_KHONG_HOP_LE)
    const tao = await goi(planPost, U("/plan"), { ky: "NGAY_7", batDau: homNayVN() }, tokA);
    expect(tao.status, JSON.stringify(tao.b)).toBe(200);
    keHoachA = (tao.b.data as { keHoachId: string }).keHoachId;

    const kh = await lay(planGet, U("/plan?tab=NGAY_7"), tokA);
    expect(kh.status).toBe(200);
    expect(JSON.stringify(kh.b)).not.toMatch(/\/portal\/|"href"/);
    expect((await lay(planGet, U("/plan?tab=LA"), tokA)).status).toBe(400);
    const vm = (kh.b.data as { keHoach: { keHoach: { id: string } | null; viecNgay: Array<{ id: string; xong: boolean; cho: { tick: boolean }; coCamOn: boolean }> } }).keHoach;
    expect(vm.keHoach?.id).toBe(keHoachA);

    const viec = vm.viecNgay.find((v) => v.cho.tick);
    if (viec) {
      expect((await kq(await taskDonePost(req(U(`/plan/tasks/${viec.id}/done`), {}, bearer(tokB)), cTask(viec.id)))).status).toBe(404); // nhà B
      const xong = await kq(await taskDonePost(req(U(`/plan/tasks/${viec.id}/done`), {}, bearer(tokA)), cTask(viec.id)));
      expect(xong.status).toBe(200);
      expect((await kq(await taskDonePost(req(U(`/plan/tasks/${viec.id}/done`), {}, bearer(tokA)), cTask(viec.id)))).status).toBe(409); // đã làm
      const camOn = await kq(await taskThanksPost(req(U(`/plan/tasks/${viec.id}/thanks`), {}, bearer(tokA)), cTask(viec.id)));
      expect([200, 409]).toContain(camOn.status); // 409 khi việc không có người nhận
      expect((await kq(await taskThanksPost(req(U(`/plan/tasks/${viec.id}/thanks`), {}, bearer(tokB)), cTask(viec.id)))).status).toBe(404);
    }

    const tvs = await danhSachTv(tokA);
    const diemHoaThuan = tvs.map((t) => ({ thanhVienId: t.id, diem: 4 }));
    expect((await goi(checkinPost, U("/plan/checkin"), { keHoachId: keHoachA, tuan: 1, diem: diemHoaThuan }, tokB)).status).toBe(404); // nhà B
    expect((await goi(checkinPost, U("/plan/checkin"), { keHoachId: keHoachA, tuan: 1, diem: [{ thanhVienId: tvs[0]!.id, diem: 4, ghiChu: "x" }] }, tokA)).status).toBe(400); // khoá lạ lồng nhau
    const ci = await goi(checkinPost, U("/plan/checkin"), { keHoachId: keHoachA, tuan: 1, diem: diemHoaThuan }, tokA);
    expect(ci.status, JSON.stringify(ci.b)).toBe(200);
  });

  it("[MDISC-DB-10] xoá một lần làm: nhà khác 404; chủ 200, xoá lại 404; xoá thành viên giữ bài ⇒ bài về «chưa xếp»", async () => {
    expect((await kq(await resultDeletePost(req(U(`/results/${baiMeA}/delete`), {}, bearer(tokB)), cResult(baiMeA)))).status).toBe(404);
    expect(await db.discBaiLam.count({ where: { id: baiMeA } })).toBe(1);
    const x = await kq(await resultDeletePost(req(U(`/results/${baiMeA}/delete`), {}, bearer(tokA)), cResult(baiMeA)));
    expect(x.status).toBe(200);
    expect(await db.discBaiLam.count({ where: { id: baiMeA } })).toBe(0);
    expect((await kq(await resultDeletePost(req(U(`/results/${baiMeA}/delete`), {}, bearer(tokA)), cResult(baiMeA)))).status).toBe(404); // xoá lại
    // ông ngoại: giữ bài ⇒ thành viên mất, bài còn (thanhVienId NULL)
    const giu = await kq(await memberDeletePost(req(U(`/members/${ongA}/delete`), { cheDo: "giu-bai" }, bearer(tokA)), cMember(ongA)));
    expect(giu.status).toBe(200);
    expect(giu.b.data).toEqual({ daXoaBai: 0, daGiuBai: 1 });
    expect(await db.discBaiLam.count({ where: { giaDinhId: (await db.discGiaDinh.findUnique({ where: { ownerUserId: ids.A }, select: { id: true } }))!.id, thanhVienId: null } })).toBe(1);
  });

  it("[MDISC-DB-11] PIN: sai ⇒ 403; sai tới ngưỡng ⇒ 429 + Retry-After; ĐÚNG khi đang khoá vẫn 429", async () => {
    expect((await goi(pinPost, U("/pin"), { pin: "12" }, tokB)).status).toBe(400);
    expect((await goi(pinPost, U("/pin"), { pin: "4729", them: 1 }, tokB)).status).toBe(400);
    expect((await goi(pinVerifyPost, U("/pin/verify"), { pin: "4729" }, tokB)).status).toBe(409); // chưa đặt PIN
    expect((await goi(pinPost, U("/pin"), { pin: "4729" }, tokB)).status).toBe(200);
    expect((await goi(pinVerifyPost, U("/pin/verify"), { pin: "4729" }, tokB)).status).toBe(200);
    expect((await goi(pinVerifyPost, U("/pin/verify"), { pin: "0000" }, tokB)).status).toBe(403);
    let cuoi = { status: 0, retryAfter: null as string | null };
    for (let i = 0; i < 6 && cuoi.status !== 429; i++) cuoi = await goi(pinVerifyPost, U("/pin/verify"), { pin: "1111" }, tokB);
    expect(cuoi.status).toBe(429);
    expect(Number(cuoi.retryAfter)).toBeGreaterThan(0);
    expect((await goi(pinVerifyPost, U("/pin/verify"), { pin: "4729" }, tokB)).status).toBe(429); // đúng PIN vẫn bị khoá
    expect((await lay(tongQuanGet, U(""), tokB)).b.data).toMatchObject({ coPin: true });
  });

  it("[MDISC-DB-12] chế độ học sinh: phiên đã khoá vào học sinh ⇒ 403 ở MỌI route DISC; đối chứng dương: phụ huynh thường vào được", async () => {
    expect((await lay(tongQuanGet, U(""), tokC)).status).toBe(200); // đối chứng dương (nhà C chưa có sổ ⇒ coSo:false)
    expect((await goi(codePost, "/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, tokC)).status).toBe(200);
    expect((await goi(enterPost, "/api/mobile/v1/student-mode/enter", { studentId: `${NS}hs-c` }, tokC)).status).toBe(200);
    const u = U;
    const dsDoc: Array<[(r: Request) => Promise<Response>, string]> = [[tongQuanGet, u("")], [membersGet, u("/members")], [optionsGet, u("/test/options")], [pairsGet, u("/pairs")], [planGet, u("/plan")]];
    for (const [h, url] of dsDoc) expect((await lay(h, url, tokC)).status, `GET ${url}`).toBe(403);
    const dsGhi: Array<[(r: Request) => Promise<Response>, string, unknown]> = [
      [bookPost, u("/book"), { tenChuSo: "Mẹ", vaiTroChuSo: "me" }],
      [membersPost, u("/members"), { ten: "X", vaiTro: "khac" }],
      [startPost, u("/test/start"), { thanhVienId: "a", cachLam: "TU_LAM" }],
      [draftPost, u("/test/draft"), { thanhVienId: "a", cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 } }],
      [submitPost, u("/test/submit"), { thanhVienId: "a", cachLam: "TU_LAM", ve: "x".repeat(12), traLoi: { "0": 3 } }],
      [planPost, u("/plan"), { ky: "NGAY_7", batDau: homNayVN() }],
      [checkinPost, u("/plan/checkin"), { keHoachId: "k", tuan: 1, diem: [{ thanhVienId: "a", diem: 3 }] }],
      [pinPost, u("/pin"), { pin: "4729" }],
      [pinVerifyPost, u("/pin/verify"), { pin: "4729" }],
    ];
    for (const [h, url, body] of dsGhi) expect((await goi(h, url, body, tokC)).status, `POST ${url}`).toBe(403);
    expect(await db.discGiaDinh.count({ where: { ownerUserId: ids.C } })).toBe(0); // và KHÔNG ghi gì
  });

  it("[MDISC-DB-13] không rò: phản hồi của chính chủ không có SĐT/email/userId/pinHash; không `href`", async () => {
    const phanHoi = JSON.stringify([
      (await lay(tongQuanGet, U(""), tokA)).b,
      (await lay(membersGet, U("/members"), tokA)).b,
      (await lay(optionsGet, U("/test/options"), tokA)).b,
      (await lay(pairsGet, U("/pairs"), tokA)).b,
      (await lay(planGet, U("/plan"), tokA)).b,
    ]);
    for (const x of [PHONE.A, PHONE.A.slice(1), `${NS}A@seed.invalid`, ids.A, "pinHash", "ownerUserId", "nguoiTraLoiId", "\"href\"", "/portal/"]) expect(phanHoi, x).not.toContain(x);
  });

  /**
   * V8.28 — NỘP MỘT LẦN Ở GỐC DOMAIN (`ghi.ts::nopBaiSo`: xoá bản nháp THEO VÉ ngay trong giao dịch ghi bài). Web gọi thẳng; adapter app chỉ dịch kết quả.
   *   [MDISC-WEB-01] nộp cùng một vé HAI lần tuần tự ⇒ lần hai bị từ chối `VE_DA_DUNG`, ĐÚNG MỘT dòng mới
   *   [MDISC-WEB-02] BỐN yêu cầu ĐỒNG THỜI cùng một vé ⇒ đúng một thắng, ba `VE_DA_DUNG`, ĐÚNG MỘT dòng
   *   [MDISC-WEB-03] vé CŨ sau khi phát đề mới (bản nháp bị thay) ⇒ `VE_DA_DUNG`, không ghi; nộp lỗi (thiếu câu) ⇒ bản nháp CÒN, nộp lại đúng thì được
   *   [MDISC-WEB-04] LỖI GIỮA GIAO DỊCH (audit ném sau khi đã xoá nháp + ghi bài) ⇒ cuộn ngược TOÀN BỘ: không bài, không «đã thấy», không audit, bản nháp CÒN đúng vé; thử lại thành công; app: 500 rồi thử lại 200 lapLai:false
   *   [MDISC-MOB-01] app: NĂM yêu cầu đồng thời + một lần thử lại sau «timeout» ⇒ đúng MỘT dòng; mọi phản hồi là 200, đúng một `lapLai:false`, còn lại `lapLai:true` CÙNG baiId
   *   [MDISC-MOB-02] app: sửa thành viên KHÔNG gửi `ghiChu` ⇒ ghi chú giữ nguyên; gửi `ghiChu:null` ⇒ xoá có chủ ý
   */
  it("[MDISC-WEB-01] domain: nộp cùng một vé hai lần tuần tự ⇒ lần hai VE_DA_DUNG, đúng MỘT dòng mới", async () => {
    const { phatDeCho, nopBaiSo } = await import("@/lib/disc/so-gia-dinh/ghi");
    const truoc = await soBai(meA);
    const p = await phatDeCho(ids.A, { thanhVienId: meA, cachLam: "TU_LAM" }, new Date());
    if (!p.ok) throw new Error(`fixture: phát đề thất bại ${JSON.stringify(p)}`);
    const de = p.de;
    const tl = traLoiThienVe(de.ve, meA, "I", toiDa(de as unknown as De));
    const input = { thanhVienId: meA, cachLam: "TU_LAM", ve: de.ve, traLoi: tl };
    const r1 = await nopBaiSo(ids.A, input, new Date());
    const r2 = await nopBaiSo(ids.A, input, new Date());
    expect(r1.ok).toBe(true);
    expect(r2).toMatchObject({ ok: false, loi: "VE_DA_DUNG" });
    expect((await soBai(meA)) - truoc).toBe(1);
  });

  it("[MDISC-WEB-02] domain: bốn yêu cầu ĐỒNG THỜI cùng một vé ⇒ đúng một thắng, còn lại VE_DA_DUNG, đúng MỘT dòng", async () => {
    const { phatDeCho, nopBaiSo } = await import("@/lib/disc/so-gia-dinh/ghi");
    const truoc = await soBai(meA);
    const p = await phatDeCho(ids.A, { thanhVienId: meA, cachLam: "TU_LAM" }, new Date());
    if (!p.ok) throw new Error(`fixture: ${JSON.stringify(p)}`);
    const input = { thanhVienId: meA, cachLam: "TU_LAM", ve: p.de.ve, traLoi: traLoiThienVe(p.de.ve, meA, "S", toiDa(p.de as unknown as De)) };
    const kqs = await Promise.all([1, 2, 3, 4].map(() => nopBaiSo(ids.A, input, new Date())));
    expect(kqs.filter((r) => r.ok)).toHaveLength(1);
    expect(kqs.filter((r) => !r.ok && r.loi === "VE_DA_DUNG")).toHaveLength(3);
    expect((await soBai(meA)) - truoc).toBe(1);
    // LỊCH SỬ không sai: đúng MỘT dòng audit «nộp», mỗi mã câu của đề được ghi «đã thấy» đúng MỘT lần, bản nháp đã mất
    const baiMoi = await db.discBaiLam.findFirst({ where: { thanhVienId: meA }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    expect(await db.auditLog.count({ where: { module: "disc", action: "disc.bai.nop", entityId: baiMoi!.id } })).toBe(1);
    expect(await db.discBanNhap.count({ where: { thanhVienId: meA } })).toBe(0);
    const dv = docVe(p.de.ve, layKhoaDisc(), meA, new Date());
    if (!dv.ok) throw new Error("fixture: vé không đọc lại được");
    const maCau = [...dv.de.maCau];
    expect(await db.discCauDaThay.count({ where: { thanhVienId: meA, maCau: { in: maCau } } })).toBe(new Set(maCau).size);
  });

  it("[MDISC-WEB-04] lỗi giữa giao dịch ⇒ cuộn ngược toàn bộ (không bài / không «đã thấy» / không audit), nháp CÒN đúng vé; thử lại thành công; app: 500 rồi 200 lapLai:false", async () => {
    const { phatDeCho, nopBaiSo } = await import("@/lib/disc/so-gia-dinh/ghi");
    const dem = async () => ({ bai: await soBai(meA), thay: await db.discCauDaThay.count({ where: { thanhVienId: meA } }), nop: await db.auditLog.count({ where: { module: "disc", action: "disc.bai.nop" } }) });
    // — web —
    const p = await phatDeCho(ids.A, { thanhVienId: meA, cachLam: "TU_LAM" }, new Date());
    if (!p.ok) throw new Error(`fixture: ${JSON.stringify(p)}`);
    const input = { thanhVienId: meA, cachLam: "TU_LAM", ve: p.de.ve, traLoi: traLoiThienVe(p.de.ve, meA, "D", toiDa(p.de as unknown as De)) };
    const truoc = await dem();
    const gia = vi.spyOn(auditMod, "writeAudit").mockRejectedValueOnce(new Error("lỗi giả trong giao dịch"));
    await expect(nopBaiSo(ids.A, input, new Date())).rejects.toThrow("lỗi giả trong giao dịch");
    gia.mockRestore();
    expect(await dem()).toEqual(truoc); // cuộn ngược TOÀN BỘ
    expect(await db.discBanNhap.count({ where: { thanhVienId: meA, ve: p.de.ve } })).toBe(1); // bản nháp còn nguyên, vé cũ dùng lại được
    expect((await nopBaiSo(ids.A, input, new Date())).ok).toBe(true);
    const sau = await dem();
    expect([sau.bai - truoc.bai, sau.nop - truoc.nop]).toEqual([1, 1]);
    // — app: cùng domain —
    const de = deCua(await batDau(tokA, meA));
    const tl = traLoiThienVe(de.ve, meA, "S", toiDa(de));
    const t2 = await dem();
    const gia2 = vi.spyOn(auditMod, "writeAudit").mockRejectedValueOnce(new Error("lỗi giả lần hai"));
    const hong = await nop(tokA, meA, de.ve, tl);
    gia2.mockRestore();
    expect(hong.status).toBe(500);
    expect(await dem()).toEqual(t2);
    expect(await db.discBanNhap.count({ where: { thanhVienId: meA, ve: de.ve } })).toBe(1);
    const lai = await nop(tokA, meA, de.ve, tl);
    expect(lai.status, JSON.stringify(lai.b)).toBe(200);
    expect((lai.b.data as { lapLai: boolean }).lapLai).toBe(false); // lần đầu THẬT SỰ ghi (lần 500 đã cuộn ngược)
    expect((await soBai(meA)) - t2.bai).toBe(1);
  });

  it("[MDISC-WEB-03] domain: vé cũ sau khi bản nháp bị thay ⇒ VE_DA_DUNG không ghi; nộp lỗi ⇒ bản nháp còn và nộp lại đúng thì được", async () => {
    const { phatDeCho, nopBaiSo } = await import("@/lib/disc/so-gia-dinh/ghi");
    const truoc = await soBai(meA);
    const p1 = await phatDeCho(ids.A, { thanhVienId: meA, cachLam: "TU_LAM" }, new Date());
    if (!p1.ok) throw new Error(`fixture: ${JSON.stringify(p1)}`);
    const veCu = p1.de.ve;
    // phát đề MỚI ghi đè bản nháp: ép bằng cách xoá nháp rồi phát lại (vé mới khác vé cũ)
    await db.discBanNhap.deleteMany({ where: { thanhVienId: meA } });
    const p2 = await phatDeCho(ids.A, { thanhVienId: meA, cachLam: "TU_LAM" }, new Date());
    if (!p2.ok) throw new Error(`fixture: ${JSON.stringify(p2)}`);
    expect(p2.de.ve).not.toBe(veCu);
    const tlCu = traLoiThienVe(veCu, meA, "C", toiDa(p1.de as unknown as De));
    expect(await nopBaiSo(ids.A, { thanhVienId: meA, cachLam: "TU_LAM", ve: veCu, traLoi: tlCu }, new Date())).toMatchObject({ ok: false, loi: "VE_DA_DUNG" });
    expect((await soBai(meA)) - truoc).toBe(0);
    // nộp thiếu câu ⇒ lỗi chấm, bản nháp VẪN CÒN đúng vé mới
    const thieu = { "0": 3 };
    expect(await nopBaiSo(ids.A, { thanhVienId: meA, cachLam: "TU_LAM", ve: p2.de.ve, traLoi: thieu }, new Date())).toMatchObject({ ok: false, loi: "NOP_BAI_LOI" });
    expect(await db.discBanNhap.count({ where: { thanhVienId: meA, ve: p2.de.ve } })).toBe(1);
    const tl = traLoiThienVe(p2.de.ve, meA, "D", toiDa(p2.de as unknown as De));
    expect((await nopBaiSo(ids.A, { thanhVienId: meA, cachLam: "TU_LAM", ve: p2.de.ve, traLoi: tl }, new Date())).ok).toBe(true);
    expect((await soBai(meA)) - truoc).toBe(1);
  });

  it("[MDISC-MOB-01] app: năm yêu cầu đồng thời + thử lại sau timeout ⇒ đúng MỘT dòng; mọi phản hồi 200, một lapLai:false, còn lại lapLai:true cùng baiId", async () => {
    const truoc = await soBai(meA);
    const de = deCua(await batDau(tokA, meA));
    const tl = traLoiThienVe(de.ve, meA, "I", toiDa(de));
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => nop(tokA, meA, de.ve, tl)));
    for (const r of rs) expect(r.status, JSON.stringify(r.b)).toBe(200);
    const lan = rs.map((r) => r.b.data as { baiId: string; lapLai: boolean });
    expect(lan.filter((x) => !x.lapLai)).toHaveLength(1);
    expect(new Set(lan.map((x) => x.baiId)).size).toBe(1);
    // máy khách «không nhận được phản hồi» và gửi lại sau đó
    const lai = await nop(tokA, meA, de.ve, tl);
    expect(lai.status).toBe(200);
    expect(lai.b.data).toMatchObject({ lapLai: true, baiId: lan[0]!.baiId });
    expect((await soBai(meA)) - truoc).toBe(1);
  });

  it("[MDISC-MOB-03] app: `chu` (chữ viết tắt) của thành viên tên có ngoặc không bắt đầu bằng dấu câu ở màn Thành viên", async () => {
    const them = await goi(membersPost, U("/members"), { ten: "Ông (Ngoại)", vaiTro: "ong", namSinh: 1950 }, tokA);
    expect(them.status, JSON.stringify(them.b)).toBe(200);
    const ds = await danhSachTv(tokA);
    const ong = ds.find((x) => x.id === (them.b.data as { id: string }).id) as (Tv & { chu?: string }) | undefined;
    expect(ong?.chu).toBe("ÔN");
    expect(ds.every((x) => /^[\p{L}\p{N}?]/u.test((x as Tv & { chu: string }).chu))).toBe(true);
  });

  it("[MDISC-MOB-02] app: sửa thành viên KHÔNG gửi ghiChu ⇒ giữ ghi chú; gửi ghiChu:null ⇒ xoá có chủ ý", async () => {
    const them = await goi(membersPost, U("/members"), { ten: "Dì Ghi Chú", vaiTro: "khac", namSinh: 1985 }, tokA);
    expect(them.status, JSON.stringify(them.b)).toBe(200);
    const id = (them.b.data as { id: string }).id;
    await db.discThanhVien.update({ where: { id }, data: { ghiChu: "Thích robot" } });
    const sua = await goi(membersPost, U("/members"), { id, ten: "Dì Ghi Chú Mới", vaiTro: "khac", namSinh: 1985 }, tokA);
    expect(sua.status, JSON.stringify(sua.b)).toBe(200);
    expect((await db.discThanhVien.findUnique({ where: { id }, select: { ghiChu: true, ten: true } }))).toEqual({ ghiChu: "Thích robot", ten: "Dì Ghi Chú Mới" });
    const xoa = await goi(membersPost, U("/members"), { id, ten: "Dì Ghi Chú Mới", vaiTro: "khac", namSinh: 1985, ghiChu: null }, tokA);
    expect(xoa.status).toBe(200);
    expect((await db.discThanhVien.findUnique({ where: { id }, select: { ghiChu: true } }))?.ghiChu).toBeNull();
  });

  it("[MDISC-MCT-01] HTTP: 409 giữ code VALIDATION + THÊM error.maChiTiet (lập sổ lần hai ⇒ SO_DA_TON_TAI; xoá chủ sổ ⇒ KHONG_XOA_CHU_SO); lỗi khác KHÔNG có maChiTiet", async () => {
    const hai = await goi(bookPost, U("/book"), { tenChuSo: "Mẹ Thử A", vaiTroChuSo: "me" }, tokA);
    expect(hai.status).toBe(409);
    expect(hai.b.error).toMatchObject({ code: "VALIDATION", maChiTiet: "SO_DA_TON_TAI" });
    expect(typeof hai.b.error?.message).toBe("string");
    const r = await kq(await memberDeletePost(req(U(`/members/${meA}/delete`), { cheDo: "giu-bai" }, bearer(tokA)), cMember(meA)));
    expect(r.status).toBe(409);
    expect(r.b.error).toMatchObject({ code: "VALIDATION", maChiTiet: "KHONG_XOA_CHU_SO" });
    const khac = await goi(startPost, U("/test/start"), { thanhVienId: "khong-ton-tai", cachLam: "TU_LAM" }, tokA);
    expect(khac.status).toBe(404);
    expect("maChiTiet" in (khac.b.error ?? {})).toBe(false);
  });
});
