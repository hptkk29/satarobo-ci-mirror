import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as kiemRoute } from "@/app/api/mobile/v1/parent/checkout/validate/route";
import { GET as ttRoute } from "@/app/api/mobile/v1/parent/orders/[orderId]/payment-status/route";
import { GET as khuRoute } from "@/app/api/mobile/v1/students/[studentId]/learning/areas/route";
import { db } from "@/lib/db";
import { datCongCapQuyen } from "@/lib/mobile-api/dich-vu/don-hang";
import { datTraCuuKhoaBan } from "@/lib/mobile-api/dich-vu/mua-khoa";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [DHM-DB] V8 — trạng thái thanh toán đơn · kiểm trước checkout · khu học tập — Postgres THẬT (không webhook thật, không tiền thật).
 *   [DHM-DB-01] trạng thái suy từ bản ghi: chờ → một phần → đủ (khoản CHỜ kế toán vẫn tính; khoản TỪ CHỐI thì KHÔNG; hoàn tiền là dòng âm); huỷ
 *   [DHM-DB-02] IDOR: đơn của nhà khác / không tồn tại / đơn không nối học viên ⇒ cùng 404; đơn nhiều con chỉ lộ dòng của con mình
 *   [DHM-DB-03] cấp quyền FAIL-CLOSED: cổng chưa nối + dòng Online ⇒ «đã nhận tiền, chờ cấp quyền» (không bao giờ «đã cấp»); cổng báo DA_CAP ⇒ DA_CAP_QUYEN
 *   [DHM-DB-04] checkout validate: id con lạ ⇒ 404; lược đồ strict ⇒ 400; thiếu hồ sơ ⇒ lỗi có cấu trúc; dòng trùng; danh mục chưa có ⇒ COURSE_CATALOG_UNAVAILABLE + hopLe=false; cổng báo ALREADY_OWNED/NOT_FOR_SALE
 *   [DHM-DB-05] khu học tập: có lớp ⇒ offline.coLop; không lớp ⇒ false; online luôn CHUA_MO; con nhà khác ⇒ 404
 *   [DHM-DB-06] CHỈ ĐỌC: không có Order/Payment/dòng nào được tạo/sửa bởi ba endpoint
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "dhm-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.98.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const A = (k: string) => `${NS}${k}`;

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(req("/x", { dinhDanh: phone, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-d000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
  if (r.status !== 200) throw new Error(`đăng nhập ${r.status}`);
  return ((await json(r)).data as { accessToken: string }).accessToken;
}

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.payment.deleteMany({ where: { orderId: { startsWith: NS } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: NS } } });
  await db.order.deleteMany({ where: { id: { startsWith: NS } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[DHM-DB] đơn · checkout · khu học tập — Postgres thật", () => {
  let tA = "";
  let tB = "";
  const ids: Record<string, string> = {};
  const S1 = A("s1"); // A — có lớp, có ngày sinh
  const S2 = A("s2"); // A — không lớp, thiếu ngày sinh
  const S3 = A("s3"); // B
  const tt = (tok: string, oid: string) => ttRoute(req(`/api/mobile/v1/parent/orders/${oid}/payment-status`, undefined, bearer(tok)), { params: Promise.resolve({ orderId: oid }) as never });
  const kiem = (tok: string, than: unknown) => kiemRoute(req("/api/mobile/v1/parent/checkout/validate", than, bearer(tok)));
  const khu = (tok: string, sv: string) => khuRoute(req(`/api/mobile/v1/students/${sv}/learning/areas`, undefined, bearer(tok)), { params: Promise.resolve({ studentId: sv }) as never });
  const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
  const taoDon = async (k: string, tong: number, dong: Array<{ sv: string; loai?: string }>, status = "PENDING_PAYMENT") =>
    db.order.create({
      data: {
        id: A(k), code: `${NS}ORD-${k}`.toUpperCase(), type: "COURSE", status, customerName: "Phụ huynh", customerPhone: "0900000000", totalAmount: tong,
        items: { create: dong.map((d, i) => ({ id: A(`${k}-i${i}`), type: d.loai ?? "COURSE_ENROLLMENT", studentId: d.sv, itemName: "Khoá", unitPrice: tong, totalPrice: tong })) },
      } as never,
    });
  const thu = (k: string, soTien: number, ac: "PENDING" | "CONFIRMED" | "REJECTED" | "REFUNDED", n: string) =>
    db.payment.create({ data: { id: A(`${k}-${n}`), orderId: A(k), amount: soTien, method: "BANK_TRANSFER", paidDate: new Date(), accountantStatus: ac } as never });

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    ids.A = (await db.user.create({ data: { email: `${NS}A@seed.invalid`, name: "Phụ huynh A", phone: "84966700001", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    ids.B = (await db.user.create({ data: { email: `${NS}B@seed.invalid`, name: "Phụ huynh B", phone: "84966700002", password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở DHM", slug: A("cs"), address: "Địa chỉ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá DHM", slug: A("kh"), totalSessions: 12 } });
    await db.class.create({ data: { id: A("l1"), name: "Lớp DHM", classCode: A("l1"), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: S1, name: `${NS}An`, parentUserId: ids.A, centerId: A("cs"), dateOfBirth: new Date("2016-05-05T00:00:00Z") } as never });
    await db.student.create({ data: { id: S2, name: `${NS}Binh`, parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S3, name: `${NS}Cuong`, parentUserId: ids.B, centerId: A("cs"), dateOfBirth: new Date("2015-01-01T00:00:00Z") } as never });
    await db.enrollment.create({ data: { id: A("dk1"), studentId: S1, classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    tA = await dangNhap("0966700001", 1);
    tB = await dangNhap("0966700002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("/x", {}, bearer(t)));
  }, 120_000);
  afterAll(async () => {
    datCongCapQuyen(null);
    datTraCuuKhoaBan(null);
    await don();
  });

  it("[DHM-DB-01] trạng thái suy từ bản ghi: chờ → một phần → đủ; khoản chờ kế toán TÍNH, từ chối KHÔNG; huỷ", async () => {
    await taoDon("o1", 1_000_000, [{ sv: S1 }]);
    const r = await tt(tA, A("o1"));
    expect(r.status).toBe(200);
    let d = (await json(r)).data;
    expect([d.trangThai, d.daNhan, d.conThieu, d.capQuyen.trangThai, d.hoiLaiSauGiay]).toEqual(["CHO_THANH_TOAN", 0, 1_000_000, "KHONG_AP_DUNG", 10]);
    expect(d.gioiHan).toContain("THAT_BAI_CHUA_CO_BAN_GHI");
    await thu("o1", 400_000, "CONFIRMED", "a");
    await thu("o1", 600_000, "REJECTED", "b"); // bị từ chối ⇒ không tính
    d = (await json(await tt(tA, A("o1")))).data;
    expect([d.trangThai, d.daNhan, d.conThieu]).toEqual(["DA_NHAN_MOT_PHAN", 400_000, 600_000]);
    await thu("o1", 600_000, "PENDING", "c"); // chờ kế toán ⇒ vẫn là tiền đã về
    d = (await json(await tt(tA, A("o1")))).data;
    expect([d.trangThai, d.daNhan, d.coKhoanChoKeToan, d.hoiLaiSauGiay]).toEqual(["DA_NHAN_TIEN", 1_000_000, true, null]);
    await thu("o1", -300_000, "REFUNDED", "d"); // hoàn tiền = dòng âm
    d = (await json(await tt(tA, A("o1")))).data;
    expect([d.trangThai, d.daNhan]).toEqual(["DA_NHAN_MOT_PHAN", 700_000]);
    await db.order.update({ where: { id: A("o1") }, data: { status: "CANCELLED" } });
    expect((await json(await tt(tA, A("o1")))).data.trangThai).toBe("DA_HUY");
  });

  it("[DHM-DB-02] IDOR: nhà khác / không tồn tại / đơn không nối học viên ⇒ cùng 404; đơn nhiều con chỉ lộ dòng của con mình", async () => {
    await taoDon("o2", 500_000, [{ sv: S3 }]);
    await taoDon("o3", 500_000, []); // không nối học viên nào
    await taoDon("o4", 800_000, [{ sv: S1 }, { sv: S3 }]); // hai nhà chung một đơn
    const loi = [404, "NOT_FOUND"];
    expect(await ma(await tt(tA, A("o2")))).toEqual(loi);
    expect(await ma(await tt(tA, A("khong-co")))).toEqual(loi);
    expect(await ma(await tt(tA, A("o3")))).toEqual(loi);
    expect(await ma(await tt(tB, A("o1")))).toEqual(loi);
    expect(await ma(await tt(tA, "a".repeat(100)))).toEqual(loi);
    expect((await json(await tt(tB, A("o2")))).data.maDon).toMatch(/O2$/);
    const dA = (await json(await tt(tA, A("o4")))).data;
    expect(dA.dong.map((x: { studentId: string }) => x.studentId)).toEqual([S1]);
    expect(JSON.stringify(dA)).not.toContain(S3);
    const r = await ttRoute(req(`/api/mobile/v1/parent/orders/${A("o1")}/payment-status`), { params: Promise.resolve({ orderId: A("o1") }) as never });
    expect(r.status).toBe(401);
  });

  it("[DHM-DB-03] cấp quyền FAIL-CLOSED; cổng báo DA_CAP ⇒ DA_CAP_QUYEN", async () => {
    await taoDon("o5", 300_000, [{ sv: S1 }]);
    await thu("o5", 300_000, "CONFIRMED", "a");
    // Cổng mặc định, đơn không có dòng Online ⇒ không áp dụng.
    expect((await json(await tt(tA, A("o5")))).data.trangThai).toBe("DA_NHAN_TIEN");
    // Cổng giả: engine chưa nối với dòng Online ⇒ chờ cấp quyền (KHÔNG BAO GIỜ «đã cấp»).
    datCongCapQuyen({ trangThaiCapQuyen: async () => "CHUA_NOI_ENGINE" });
    let d = (await json(await tt(tA, A("o5")))).data;
    expect([d.trangThai, d.capQuyen.trangThai, d.gioiHan.includes("ENGINE_CAP_QUYEN_ONLINE_CHUA_NOI"), d.hoiLaiSauGiay]).toEqual(["DA_NHAN_TIEN_CHO_CAP_QUYEN", "CHUA_NOI_ENGINE", true, 10]);
    datCongCapQuyen({ trangThaiCapQuyen: async () => "LOI_CAN_THU_LAI" });
    expect((await json(await tt(tA, A("o5")))).data.trangThai).toBe("CAP_QUYEN_LOI");
    datCongCapQuyen({ trangThaiCapQuyen: async () => "DA_CAP" });
    d = (await json(await tt(tA, A("o5")))).data;
    expect([d.trangThai, d.hoiLaiSauGiay]).toEqual(["DA_CAP_QUYEN", null]);
    // Chưa đủ tiền thì cổng nói gì cũng không thành «đã cấp».
    await taoDon("o6", 900_000, [{ sv: S1 }]);
    expect((await json(await tt(tA, A("o6")))).data.trangThai).toBe("CHO_THANH_TOAN");
    datCongCapQuyen(null);
  });

  it("[DHM-DB-04] checkout validate", async () => {
    const dong = (sv: string, k = "kh-online-1") => ({ studentId: sv, khoaId: k });
    expect(await ma(await kiem(tA, { dong: [dong(S3)] }))).toEqual([404, "NOT_FOUND"]); // con nhà khác
    expect(await ma(await kiem(tA, { dong: [dong(S1), dong(S3)] }))).toEqual([404, "NOT_FOUND"]); // một id lạ ⇒ cả yêu cầu
    expect(await ma(await kiem(tA, { dong: [dong("khong-co")] }))).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await kiem(tA, { dong: [{ khoaId: "k" }] }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await kiem(tA, { dong: [{ ...dong(S1), gia: 1 }] }))).toEqual([400, "VALIDATION"]);
    expect(await ma(await kiem(tA, { dong: [dong(S1)], tongTien: 0 }))).toEqual([400, "VALIDATION"]);
    const r = await kiemRoute(req("/api/mobile/v1/parent/checkout/validate", { dong: [dong(S1)] }));
    expect(r.status).toBe(401);

    // Hồ sơ tối thiểu của A đủ (tên + SĐT). S2 thiếu ngày sinh ⇒ chỉ là DỮ LIỆU TUỲ CHỌN (không lỗi, không chặn). Danh mục chưa có ⇒ fail-closed.
    let d = (await json(await kiem(tA, { dong: [dong(S1), dong(S2), dong(S1)] }))).data;
    expect(d.hopLe).toBe(false);
    expect(d.chuaKiemDuoc).toEqual(["DANH_MUC_KHOA_ONLINE_CHUA_CO"]);
    const codes = d.loi.map((e: { code: string; scope: string; studentId?: string; field: string }) => [e.code, e.scope, e.studentId ?? null, e.field]);
    expect(codes.filter((c: string[]) => c[3] === "hocVien.ngaySinh")).toEqual([]); // thiếu ngày sinh KHÔNG thành lỗi
    expect(d.thieuTuyChon).toEqual([{ field: "hocVien.ngaySinh", scope: "student", studentId: S2 }]);
    expect(codes.map((c: string[]) => c[0])).toContain("DUPLICATE_LINE");
    expect(codes.map((c: string[]) => c[0])).toContain("COURSE_CATALOG_UNAVAILABLE");
    expect(codes.filter((c: string[]) => c[1] === "parent")).toEqual([]);

    // Cổng danh mục giả (thay engine thật): bán được / không bán / đã có quyền vĩnh viễn.
    datTraCuuKhoaBan(async (k) => (k === "ban" ? { trangThai: "BAN_DUOC" } : k === "khong" ? { trangThai: "KHONG_BAN" } : { trangThai: "DA_CO_QUYEN_VINH_VIEN" }));
    // Hồ sơ tối thiểu đủ + khoá bán được ⇒ hợp lệ DÙ S2 thiếu ngày sinh (không blocker giả).
    d = (await json(await kiem(tA, { dong: [dong(S1, "ban"), dong(S2, "ban")] }))).data;
    expect([d.hopLe, d.loi]).toEqual([true, []]);
    d = (await json(await kiem(tA, { dong: [dong(S1, "ban")] }))).data;
    expect([d.hopLe, d.loi, d.chuaKiemDuoc]).toEqual([true, [], []]);
    d = (await json(await kiem(tA, { dong: [dong(S1, "khong"), dong(S1, "vv")] }))).data;
    expect(d.loi.map((e: { code: string }) => e.code).sort()).toEqual(["ALREADY_OWNED", "COURSE_NOT_FOR_SALE"]);
    expect(d.hopLe).toBe(false);
    datTraCuuKhoaBan(null);
    // Nhiều con cùng một khoá là HỢP LỆ (hai dòng khác studentId).
    datTraCuuKhoaBan(async () => ({ trangThai: "BAN_DUOC" }));
    datTraCuuKhoaBan(null);
    // Điều kiện của KHOÁ (do OnlineCourse quyết qua cổng): cần ngày sinh ⇒ lỗi REQUIRED cho ĐÚNG dòng/học viên; không đủ điều kiện ⇒ COURSE_ELIGIBILITY.
    datTraCuuKhoaBan(async (k, hv) => (k === "tuoi" && !hv.ngaySinh ? { trangThai: "CAN_NGAY_SINH" } : k === "lop" ? { trangThai: "KHONG_DU_DIEU_KIEN", lyDo: "Khoá dành cho lớp 3–5." } : { trangThai: "BAN_DUOC" }));
    d = (await json(await kiem(tA, { dong: [dong(S1, "tuoi"), dong(S2, "tuoi"), dong(S1, "lop")] }))).data;
    expect(d.hopLe).toBe(false);
    const ls = d.loi.map((e: { code: string; studentId?: string; dongIndex?: number }) => [e.code, e.studentId, e.dongIndex]);
    expect(ls).toContainEqual(["REQUIRED", S2, 1]); // chỉ S2 (thiếu ngày sinh) bị đòi, S1 có ngày sinh thì không
    expect(ls).toContainEqual(["COURSE_ELIGIBILITY", S1, 2]);
    expect(ls.filter((x: unknown[]) => x[0] === "REQUIRED" && x[1] === S1)).toEqual([]);
    datTraCuuKhoaBan(null);
    // Phụ huynh thiếu SĐT/tên ⇒ lỗi scope parent
    await db.user.update({ where: { id: ids.A }, data: { name: null } });
    d = (await json(await kiem(tA, { dong: [dong(S1)] }))).data;
    expect(d.loi.map((e: { field: string }) => e.field)).toContain("phuHuynh.ten");
    await db.user.update({ where: { id: ids.A }, data: { name: "Phụ huynh A" } });
  });

  it("[DHM-DB-05] khu học tập", async () => {
    const lay = async (tok: string, sv: string) => (await json(await khu(tok, sv))).data;
    expect(await lay(tA, S1)).toEqual({ offline: { coLop: true, soLop: 1 }, online: { trangThai: "CHUA_MO", soKhoaConHan: 0, soKhoaHetHan: 0 } }); // cờ ELEARNING_ONLINE_ENABLED tắt (mặc định) ⇒ CHUA_MO; trạng thái khi bật: [ONL-P0]
    expect(await lay(tA, S2)).toEqual({ offline: { coLop: false, soLop: 0 }, online: { trangThai: "CHUA_MO", soKhoaConHan: 0, soKhoaHetHan: 0 } });
    expect(await ma(await khu(tA, S3))).toEqual([404, "NOT_FOUND"]);
    await db.enrollment.update({ where: { id: A("dk1") }, data: { status: "CANCELLED" } });
    expect((await lay(tA, S1)).offline.coLop).toBe(false);
    await db.enrollment.update({ where: { id: A("dk1") }, data: { status: "ACTIVE" } });
  });

  it("[DHM-DB-06] CHỈ ĐỌC: không đơn/khoản mới bị tạo bởi ba endpoint", async () => {
    const truoc = [await db.order.count({ where: { id: { startsWith: NS } } }), await db.payment.count({ where: { orderId: { startsWith: NS } } })];
    await tt(tA, A("o1"));
    await kiem(tA, { dong: [{ studentId: S1, khoaId: "x" }] });
    await khu(tA, S1);
    expect([await db.order.count({ where: { id: { startsWith: NS } } }), await db.payment.count({ where: { orderId: { startsWith: NS } } })]).toEqual(truoc);
  });
});
