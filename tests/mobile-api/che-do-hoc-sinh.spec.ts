import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as meGet } from "@/app/api/mobile/v1/auth/me/route";
import { POST as lamMoiRoute } from "@/app/api/mobile/v1/auth/refresh/route";
import { GET as thongBaoGet } from "@/app/api/mobile/v1/notifications/route";
import { GET as profileGet } from "@/app/api/mobile/v1/parent/profile/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as modeGet } from "@/app/api/mobile/v1/student-mode/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as doiMaPost } from "@/app/api/mobile/v1/student-mode/code/change/route";
import { GET as nhatKyGet } from "@/app/api/mobile/v1/student-mode/log/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { POST as exitPost } from "@/app/api/mobile/v1/student-mode/exit/route";
import { POST as forgotPost } from "@/app/api/mobile/v1/student-mode/forgot/route";
import { GET as billingGet } from "@/app/api/mobile/v1/students/[studentId]/billing/route";
import { GET as contactGet } from "@/app/api/mobile/v1/students/[studentId]/contact/route";
import { GET as giftsGet } from "@/app/api/mobile/v1/students/[studentId]/gifts/route";
import { GET as scheduleGet } from "@/app/api/mobile/v1/students/[studentId]/schedule/route";
import { GET as overviewGet } from "@/app/api/mobile/v1/students/[studentId]/overview/route";
import { POST as yeuCauPost } from "@/app/api/mobile/v1/students/[studentId]/requests/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [HSM-DB] CHẾ ĐỘ HỌC SINH ép ở MÁY CHỦ (H-S3) trên POSTGRES THẬT. Gọi thẳng route handler.
 *   [HSM-DB-01] tạo mã thoát: mã dễ đoán ⇒ 400, hai lần nhập lệch ⇒ 400; vào chế độ khi CHƯA có mã ⇒ 409; vào con nhà khác ⇒ 404
 *   [HSM-DB-02] đã khoá vào con A1: xem lịch/quà của A1 ⇒ 200; tài chính, yêu cầu, hồ sơ ba mẹ, thông báo, /auth/me ⇒ 403; sang con A2 (anh/chị/em) ⇒ 403; vào lần hai / tạo mã ⇒ 403
 *   [HSM-DB-03] chế độ SỐNG QUA LÀM MỚI TOKEN (cùng dòng phiên): token mới vẫn bị khoá; thoát bằng mã đúng ⇒ phụ huynh dùng lại được tài chính
 *   [HSM-DB-04] sai mã 5 lần ⇒ 429 khoá; mã ĐÚNG trong lúc khoá vẫn 429 (không dò được); chưa thoát được
 *   [HSM-DB-05] «quên mã»: mật khẩu sai ⇒ 400 và vẫn bị khoá; mật khẩu đúng ⇒ thoát
 *   [HSM-DB-08] V8.45 liên hệ cho học sinh: GET /students/:id/contact mở cho HS (ba khoá chữ, đúng cơ sở, không zalo/tel); /overview vẫn 403
 *   [HSM-DB-06] thoát khi không ở chế độ học sinh ⇒ 200 và KHÔNG đếm lần sai (không lộ trạng thái mã)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "hsmtest-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966500001", B: "0966500002", C: "0966500003", D: "0966500004" };
let dem = 0;
const ipMoi = () => `10.97.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const ctxHs = (id: string) => ({ params: Promise.resolve({ studentId: id }) });
const ids: Record<string, string> = {};

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-8000-${String(n + 500).padStart(12, "0")}`, nenTang: "ios", tenMay: "iPhone", phienBanApp: "1.0.0" } }));
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return b.data as { accessToken: string; refreshToken: string };
}

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.hocSinhCheDoNhatKy.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.hocSinhMaThoat.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.notification.deleteMany({ where: { studentId: { startsWith: NS } } }).catch(() => undefined);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

describe.skipIf(!RUN)("[HSM-DB] chế độ học sinh ép ở máy chủ — Postgres thật", () => {
  let tokA = "";
  let refA = "";
  let tokB = "";
  let tokC = "";
  let tokD = "";
  const bearer = (t: string) => `Bearer ${t}`;
  const exit = (t: string, ma: string) => exitPost(req("/api/mobile/v1/student-mode/exit", { ma }, bearer(t)));
  const trangThai = async (t: string) => (await json(await modeGet(req("/api/mobile/v1/student-mode", undefined, bearer(t)))));

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B", "C", "D"] as const) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    await db.center.create({ data: { id: `${NS}cs1`, name: "Cơ sở HSM-1", slug: `${NS}cs1`, address: "Địa chỉ 1" } });
    // CS2 thật (mã "CS2" quyết định chữ giờ mở cửa/tên cơ sở); DB nháp có thể đã có sẵn cơ sở mã "CS2" ⇒ dùng lại, không tạo trùng khoá duy nhất.
    const cs2 = (await db.center.findUnique({ where: { code: "CS2" }, select: { id: true } })) ?? (await db.center.create({ data: { id: `${NS}cs2`, code: "CS2", name: "Cơ sở HSM-2", slug: `${NS}cs2`, address: "Địa chỉ 2" }, select: { id: true } }));
    ids.cs2 = cs2.id;
    await db.student.create({ data: { id: `${NS}c1`, name: `${NS}c1`, parentUserId: ids.C, centerId: ids.cs2 } as never });
    await db.student.create({ data: { id: `${NS}d1`, name: `${NS}d1`, parentUserId: ids.D, centerId: `${NS}cs1` } as never }); // cơ sở KHÔNG mã (mã lạ/trống)
    for (const [k, owner] of [["a1", "A"], ["a2", "A"], ["b1", "B"]] as const) await db.student.create({ data: { id: `${NS}${k}`, name: `${NS}${k}`, parentUserId: ids[owner], centerId: `${NS}cs1` } as never });
    const a = await dangNhap(PHONE.A, 1);
    const b = await dangNhap(PHONE.B, 2);
    tokA = a.accessToken;
    refA = a.refreshToken;
    tokB = b.accessToken;
    tokC = (await dangNhap(PHONE.C, 3)).accessToken;
    tokD = (await dangNhap(PHONE.D, 4)).accessToken;
    for (const t of [tokA, tokB, tokC, tokD]) await quyDinhDongY(req("/x", {}, bearer(t)));
  }, 60_000);
  afterAll(don);

  it("[HSM-DB-01] mã thoát: dễ đoán / lệch ⇒ 400; vào khi chưa có mã ⇒ 409; vào con nhà khác ⇒ 404", async () => {
    const code = (t: string, ma: string, xacNhan: string) => codePost(req("/api/mobile/v1/student-mode/code", { ma, xacNhan }, bearer(t)));
    const vao = (t: string, studentId: string) => enterPost(req("/api/mobile/v1/student-mode/enter", { studentId }, bearer(t)));
    expect((await vao(tokA, `${NS}a1`)).status).toBe(409); // chưa có mã ⇒ ba mẹ sẽ không thoát được ⇒ không cho vào
    expect((await code(tokA, "1234", "1234")).status).toBe(400); // dễ đoán
    expect((await code(tokA, "4729", "4720")).status).toBe(400); // hai lần lệch
    expect((await code(tokA, "47a9", "47a9")).status).toBe(400); // không phải 4 chữ số
    expect((await code(tokA, "4729", "4729")).status).toBe(200);
    expect((await code(tokA, "5831", "5831")).status).toBe(409); // đã có mã ⇒ không tạo đè
    expect(await db.hocSinhMaThoat.count({ where: { parentUserId: ids.A } })).toBe(1);
    expect((await vao(tokA, `${NS}b1`)).status).toBe(404); // con nhà khác
    expect((await trangThai(tokA)).data).toMatchObject({ dangHocSinh: false, hocSinhId: null, coMaThoat: true });
  });

  it("[HSM-DB-02] đã khoá vào A1: lịch/quà của A1 ⇒ 200; tài chính/yêu cầu/hồ sơ/thông báo/me ⇒ 403; sang A2 ⇒ 403; vào lần hai ⇒ 403", async () => {
    const r = await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: `${NS}a1` }, bearer(tokA)));
    expect(r.status).toBe(200);
    expect((await trangThai(tokA)).data).toMatchObject({ dangHocSinh: true, hocSinhId: `${NS}a1` });
    const hs = await db.mobileSession.findFirstOrThrow({ where: { userId: ids.A, thuHoiLuc: null } });
    expect(hs.hocSinhId).toBe(`${NS}a1`); // ghi ở PHIÊN (máy chủ), không phải ở app

    const a1 = ctxHs(`${NS}a1`);
    const t = bearer(tokA);
    // Cổng chế độ học sinh đọc ĐƯỜNG DẪN THẬT của yêu cầu — dựng URL đúng như app gọi.
    expect((await scheduleGet(req(`/api/mobile/v1/students/${NS}a1/schedule`, undefined, t), a1)).status).toBe(200);
    expect([200, 404]).toContain((await giftsGet(req(`/api/mobile/v1/students/${NS}a1/gifts`, undefined, t), a1)).status); // 404 khi cờ SataCoin tắt — KHÔNG phải 403: cổng chế độ học sinh cho qua
    expect((await json(await billingGet(req(`/api/mobile/v1/students/${NS}a1/billing`, undefined, t), a1))).error?.code).toBe("FORBIDDEN");
    expect((await billingGet(req(`/api/mobile/v1/students/${NS}a1/billing`, undefined, t), a1)).status).toBe(403);
    expect((await yeuCauPost(req(`/api/mobile/v1/students/${NS}a1/requests`, { loai: "khac", ghiChu: "Thử gửi yêu cầu khi đang ở chế độ học sinh" }, t), a1)).status).toBe(403);
    expect((await profileGet(req("/api/mobile/v1/parent/profile", undefined, t))).status).toBe(403);
    expect((await thongBaoGet(req("/api/mobile/v1/notifications", undefined, t))).status).toBe(403);
    expect((await meGet(req("/api/mobile/v1/auth/me", undefined, t))).status).toBe(403);
    // Anh/chị/em: cùng loại đường dẫn hợp lệ nhưng sang con khác của CHÍNH nhà này.
    const a2 = await scheduleGet(req(`/api/mobile/v1/students/${NS}a2/schedule`, undefined, t), ctxHs(`${NS}a2`));
    expect(a2.status).toBe(403);
    expect((await json(a2)).error?.message).toContain("học viên khác");
    expect((await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: `${NS}a2` }, t))).status).toBe(403);
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "5831", xacNhan: "5831" }, t))).status).toBe(403);
  });

  it("[HSM-DB-03] SỐNG QUA LÀM MỚI TOKEN: token mới vẫn bị khoá; thoát bằng mã đúng ⇒ tài chính dùng lại được", async () => {
    const lm = await lamMoiRoute(req("/api/mobile/v1/auth/refresh", { refreshToken: refA }));
    expect(lm.status).toBe(200);
    const moi = (await json(lm)).data as { accessToken: string };
    tokA = moi.accessToken;
    expect((await trangThai(tokA)).data).toMatchObject({ dangHocSinh: true, hocSinhId: `${NS}a1` });
    // V8.1: KHUNG TỐI THIỂU sau khởi động lại — chỉ đúng con đang khoá, không lộ hồ sơ ba mẹ / anh chị em.
    const khung = ((await trangThai(tokA)).data?.hocSinh ?? {}) as Record<string, unknown>;
    expect(Object.keys(khung).sort()).toEqual(["centerName", "classCode", "courseName", "id", "name"]);
    expect(khung.id).toBe(`${NS}a1`);
    const txt = JSON.stringify((await trangThai(tokA)).data);
    expect(txt).not.toContain(`${NS}a2`); // anh/chị/em
    expect(txt).not.toMatch(/@|quyDinh|phone|email/);
    expect((await billingGet(req(`/api/mobile/v1/students/${NS}a1/billing`, undefined, bearer(tokA)), ctxHs(`${NS}a1`))).status).toBe(403);

    expect((await exit(tokA, "4729")).status).toBe(200);
    expect((await trangThai(tokA)).data).toMatchObject({ dangHocSinh: false, hocSinhId: null, hocSinh: null });
    expect((await billingGet(req(`/api/mobile/v1/students/${NS}a1/billing`, undefined, bearer(tokA)), ctxHs(`${NS}a1`))).status).not.toBe(403);
    expect((await scheduleGet(req(`/api/mobile/v1/students/${NS}a2/schedule`, undefined, bearer(tokA)), ctxHs(`${NS}a2`))).status).toBe(200); // phụ huynh lại xem được con khác
    const nk = await db.hocSinhCheDoNhatKy.findMany({ where: { parentUserId: ids.A }, orderBy: { taoLuc: "asc" }, select: { loai: true } });
    expect(nk.map((x) => x.loai)).toEqual(expect.arrayContaining(["TAO_MA", "VAO", "THOAT_DUNG_MA"]));
  });

  it("[HSM-DB-04] sai mã 5 lần ⇒ khoá 429; mã ĐÚNG trong lúc khoá vẫn 429; vẫn bị khoá", async () => {
    expect((await codePost(req("/api/mobile/v1/student-mode/code", { ma: "7351", xacNhan: "7351" }, bearer(tokB)))).status).toBe(200);
    expect((await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: `${NS}b1` }, bearer(tokB)))).status).toBe(200);
    const kq: number[] = [];
    for (let i = 0; i < 5; i++) kq.push((await exit(tokB, "0000")).status);
    expect(kq.slice(0, 4)).toEqual([400, 400, 400, 400]);
    expect(kq[4]).toBe(429); // lần thứ 5 chạm ngưỡng ⇒ khoá
    expect((await exit(tokB, "7351")).status).toBe(429); // mã đúng nhưng đang khoá: không dò được
    expect((await trangThai(tokB)).data).toMatchObject({ dangHocSinh: true });
  });

  it("[HSM-DB-05] quên mã: mật khẩu sai ⇒ 400 vẫn khoá; mật khẩu đúng ⇒ thoát", async () => {
    const quen = (matKhau: string) => forgotPost(req("/api/mobile/v1/student-mode/forgot", { matKhau }, bearer(tokB)));
    expect((await quen("sai-mat-khau")).status).toBe(400);
    expect((await trangThai(tokB)).data).toMatchObject({ dangHocSinh: true });
    expect((await quen(MAT_KHAU)).status).toBe(200);
    expect((await trangThai(tokB)).data).toMatchObject({ dangHocSinh: false, hocSinhId: null });
  });

  it("[HSM-DB-06] thoát khi KHÔNG ở chế độ học sinh ⇒ 200 và không đếm lần sai", async () => {
    const truoc = await db.hocSinhMaThoat.findUniqueOrThrow({ where: { parentUserId: ids.A }, select: { soLanSai: true, khoaDen: true } });
    expect((await exit(tokA, "9999")).status).toBe(200);
    const sau = await db.hocSinhMaThoat.findUniqueOrThrow({ where: { parentUserId: ids.A }, select: { soLanSai: true, khoaDen: true } });
    expect(sau).toEqual(truoc);
  });

  it("[HSM-DB-07] V8.19 (B-ST2) đổi mã + nhật ký: mã cũ sai đếm chung; mã mới = mã cũ / dễ đoán / lệch ⇒ 400; đổi được ⇒ thoát bằng mã MỚI; nhật ký chỉ của mình; chế độ học sinh ⇒ 403", async () => {
    const doi = (t: string, maCu: string, ma: string, xacNhan = ma) => doiMaPost(req("/api/mobile/v1/student-mode/code/change", { maCu, ma, xacNhan }, bearer(t)));
    const nhatKy = (t: string) => nhatKyGet(req("/api/mobile/v1/student-mode/log", undefined, bearer(t)));
    expect((await doi(tokA, "4729", "4729")).status).toBe(400); // trùng mã cũ
    expect((await doi(tokA, "4729", "1234")).status).toBe(400); // dễ đoán
    expect((await doi(tokA, "4729", "5831", "5832")).status).toBe(400); // lệch xác nhận
    const truoc = (await db.hocSinhMaThoat.findUniqueOrThrow({ where: { parentUserId: ids.A }, select: { soLanSai: true } })).soLanSai;
    expect((await doi(tokA, "0000", "5831")).status).toBe(400); // mã hiện tại sai
    expect((await db.hocSinhMaThoat.findUniqueOrThrow({ where: { parentUserId: ids.A }, select: { soLanSai: true } })).soLanSai).toBe(truoc + 1); // đếm sai CHUNG với màn thoát
    expect((await doiMaPost(req("/api/mobile/v1/student-mode/code/change", { maCu: "4729", ma: "5831", xacNhan: "5831", them: 1 }, bearer(tokA)))).status).toBe(400); // trường lạ
    expect((await doi(tokA, "4729", "5831")).status).toBe(200);
    expect((await doi(tokA, "4729", "6942")).status).toBe(400); // mã cũ không còn đúng
    // vào chế độ học sinh rồi: không đổi mã / không đọc nhật ký được
    expect((await enterPost(req("/api/mobile/v1/student-mode/enter", { studentId: `${NS}a1` }, bearer(tokA)))).status).toBe(200);
    expect((await doi(tokA, "5831", "6942")).status).toBe(403);
    expect((await nhatKy(tokA)).status).toBe(403);
    expect((await exit(tokA, "4729")).status).toBe(400); // mã CŨ không thoát được nữa
    expect((await exit(tokA, "5831")).status).toBe(200); // mã MỚI thoát được
    const r = await nhatKy(tokA);
    expect(r.status).toBe(200);
    const muc = ((await json(r)).data as { muc: Array<{ loai: string; hocSinhId: string | null; tenCon: string | null }> }).muc;
    expect(muc.map((m) => m.loai)).toEqual(expect.arrayContaining(["DOI_MA", "VAO"]));
    expect(muc.find((m) => m.loai === "VAO")).toMatchObject({ hocSinhId: `${NS}a1` });
    expect(JSON.stringify(muc)).not.toMatch(/maBam|4729|5831|matKhau/);
    // phụ huynh B không thấy nhật ký của A
    const rb = await json(await nhatKy(tokB));
    expect(((rb.data as { muc: Array<{ hocSinhId: string | null }> }).muc).some((m) => m.hocSinhId === `${NS}a1`)).toBe(false);
    expect((await nhatKyGet(req("/api/mobile/v1/student-mode/log"))).status).toBe(401);
  });

  it("[HSM-DB-08] V8.45 LIÊN HỆ CHO HỌC SINH: HS gọi được /contact của CHÍNH mình (đúng ba khoá chữ, đúng cơ sở của em, không zalo/tel); /overview VẪN 403; em của nhà khác ⇒ 403; phụ huynh (ngoài chế độ) gọi con nhà khác ⇒ 404", async () => {
    const vao = (t: string, studentId: string) => enterPost(req("/api/mobile/v1/student-mode/enter", { studentId }, bearer(t)));
    const taoMa = (t: string) => codePost(req("/api/mobile/v1/student-mode/code", { ma: "4729", xacNhan: "4729" }, bearer(t)));
    expect((await taoMa(tokC)).status).toBe(200);
    expect((await taoMa(tokD)).status).toBe(200);
    // đối chứng ÂM trước khi vào chế độ: phụ huynh gọi con NHÀ KHÁC ⇒ 404 (cổng sở hữu của `chayTheoHocVien`)
    expect((await contactGet(req(`/api/mobile/v1/students/${NS}d1/contact`, undefined, bearer(tokC)), ctxHs(`${NS}d1`))).status).toBe(404);
    expect((await vao(tokC, `${NS}c1`)).status).toBe(200);
    expect((await vao(tokD, `${NS}d1`)).status).toBe(200);

    const goiC = await contactGet(req(`/api/mobile/v1/students/${NS}c1/contact`, undefined, bearer(tokC)), ctxHs(`${NS}c1`));
    expect(goiC.status).toBe(200);
    const raw = JSON.stringify(await goiC.clone().json());
    const c = (await json(goiC)).data as Record<string, unknown>;
    expect(Object.keys(c).sort()).toEqual(["gioMoCua", "soHien", "tenCoSo"]);
    expect(c).toMatchObject({ soHien: "0837.312.860", tenCoSo: "Cơ sở 2 - Hoàng Diệu" });
    expect(raw).not.toMatch(/zalo|https?:|tel:|0837312860/i);

    // cơ sở KHÁC ⇒ nội dung KHÁC: em ở cơ sở không mã thấy tenCoSo null (không mượn tên cơ sở của em khác)
    const d = (await json(await contactGet(req(`/api/mobile/v1/students/${NS}d1/contact`, undefined, bearer(tokD)), ctxHs(`${NS}d1`)))).data as Record<string, unknown>;
    expect(d.tenCoSo).toBeNull();
    expect(d.soHien).toBe("0837.312.860");

    // cổng chế độ học sinh: /overview của chính em VẪN bị chặn; /contact của em nhà khác bị chặn (khoá theo em đang vào)
    expect((await overviewGet(req(`/api/mobile/v1/students/${NS}c1/overview`, undefined, bearer(tokC)), ctxHs(`${NS}c1`))).status).toBe(403);
    expect((await contactGet(req(`/api/mobile/v1/students/${NS}d1/contact`, undefined, bearer(tokC)), ctxHs(`${NS}d1`))).status).toBe(403);
    // ra khỏi chế độ: phụ huynh vẫn gọi được con MÌNH, bản đầy đủ ở /overview không đổi (đường của phụ huynh không bị ảnh hưởng)
    expect((await exit(tokC, "4729")).status).toBe(200);
    expect((await contactGet(req(`/api/mobile/v1/students/${NS}c1/contact`, undefined, bearer(tokC)), ctxHs(`${NS}c1`))).status).toBe(200);
  });
});
