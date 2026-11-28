// tests/finance/gia-dinh-thu-tu.test.ts — ĐỌC dữ kiện gia đình + lịch sử mua từ POSTGRES THẬT, rồi chạy phần thuần. `[GDD-DB-*]`.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Hoặc:  DATABASE_URL=…/satarobo_test_dxc DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/gia-dinh-thu-tu.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng dữ liệu của mình (chạy MỘT MÌNH vẫn xanh — luật 18).
// Ngày TUYỆT ĐỐI (luật 19). Bộ đọc CHỈ ĐỌC: ca [GDD-DB-09] chụp các bảng trước/sau.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { xacDinhGiaDinh, xetThuTuChoDong } from "@/lib/pricing/gia-dinh-thu-tu";
import { docDauVaoGiaDinh, docLichSuGiaDinh } from "@/lib/pricing/gia-dinh-thu-tu-db";

if (!RUN_DB_TESTS) console.warn(`[GDD-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const T = "fx-gdd-";
const CUA_SO = cuaSoHieuLucPL02();
const d = (s: string) => new Date(`${s}+07:00`);
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
let CS1 = "";
let dem = 0;

const U1 = `${T}u1`;
const U2 = `${T}u2`;
const U3 = `${T}u3`;
const SDT = "0399888701";
const SDT_84 = "84399888701";
const SDT_PLUS = "+84399888701";

async function dungUser(id: string, phone: string | null, role: "PARENT" | "SALES_CSM" = "PARENT") {
  await db.user.create({ data: { id, name: `${T}${id}`, email: `${id}@example.test`, phone, role, roles: [role] } });
}
async function dungHv(id: string, o: { parentUserId?: string | null; p1?: string | null; p2?: string | null; xoa?: boolean } = {}) {
  await db.student.create({
    data: { id, name: `${T}${id}`, centerId: CS1, status: "ACTIVE", parentUserId: o.parentUserId ?? null, parentPhone: o.p1 ?? null, parent2Phone: o.p2 ?? null, deletedAt: o.xoa ? d("2026-09-01T00:00:00") : null },
  });
}
async function dungDon(o: {
  id: string;
  studentId: string | null;
  tao: string;
  soBuoi?: number | null;
  status?: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED";
  phone?: string;
  tien?: { luc: string; trangThai?: "PENDING" | "CONFIRMED" | "REJECTED" }[];
  soDot?: number;
}) {
  await db.order.create({
    data: {
      id: o.id,
      code: `ORD-2699-GD-${++dem}-${o.id.slice(-6)}`,
      type: "COURSE",
      status: o.status ?? "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: o.phone ?? SDT,
      totalAmount: 1_000_000,
      subtotal: 1_000_000,
      centerId: CS1,
      createdAt: d(o.tao),
    },
  });
  const itemId = `${o.id}-it`;
  await db.orderItem.create({
    data: {
      id: itemId,
      orderId: o.id,
      type: "COURSE_ENROLLMENT",
      itemName: "Sata 3",
      quantity: 1,
      unitPrice: 1_000_000,
      totalPrice: 1_000_000,
      discountAmount: 0,
      studentId: o.studentId,
      status: "ACTIVE",
      metadata: (o.soBuoi === undefined || o.soBuoi === null ? {} : { soBuoi: o.soBuoi }) as Prisma.InputJsonValue,
    },
  });
  for (const t of o.tien ?? []) {
    await db.payment.create({
      data: {
        orderId: o.id,
        orderItemId: itemId,
        amount: 500_000,
        method: "cash",
        paidDate: d(t.luc),
        saleStatus: "RECORDED",
        accountantStatus: t.trangThai ?? "CONFIRMED",
        centerId: CS1,
        createdAt: d(t.luc),
        updatedAt: d(t.luc),
      },
    });
  }
  for (let i = 1; i <= (o.soDot ?? 0); i++) await db.orderInstallment.create({ data: { orderId: o.id, soDot: i, amount: 500_000 } });
}

async function donDep() {
  const ids = (await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Order" WHERE "id" LIKE ${`${T}%`}`).map((x) => x.id);
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderInstallment.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.$executeRaw`DELETE FROM "Order" WHERE "id" = ANY(${ids})`;
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.user.deleteMany({ where: { id: { startsWith: T } } });
}

const tuyen = (r: ReturnType<typeof xacDinhGiaDinh>) => (r.trangThai === "CHO_XAC_MINH" ? r.lyDo.map((l) => l.ma).sort() : r.trangThai);

describe.skipIf(!RUN_DB_TESTS)("[GDD-DB] gia đình + lịch sử mua đọc từ Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    await db.course.upsert({ where: { id: KHOA }, create: { id: KHOA, name: "Sata 3 (fixture)", slug: KHOA, price: 10_560_000, totalSessions: 48 }, update: {} });
    await db.class.upsert({ where: { id: LOP }, create: { id: LOP, name: "Lớp (fixture)", courseId: KHOA, centerId: CS1, status: "ACTIVE", maxStudents: 12 }, update: {} });
  });
  beforeEach(async () => {
    await donDep();
  });
  afterAll(async () => {
    await donDep();
    await db.class.deleteMany({ where: { id: LOP } });
    await db.course.deleteMany({ where: { id: KHOA } });
  });

  it("[GDD-DB-01] hồ sơ phụ huynh rõ ràng, hai con ⇒ XAC_DINH, khoá = id tài khoản; SĐT khác định dạng giữa tài khoản và hồ sơ học viên vẫn khớp", async () => {
    await dungUser(U1, SDT_84);
    await dungHv(`${T}a`, { parentUserId: U1, p1: SDT });
    await dungHv(`${T}b`, { parentUserId: U1, p1: SDT_PLUS });
    const vao = await docDauVaoGiaDinh(`${T}a`);
    expect(xacDinhGiaDinh(vao!)).toEqual({ trangThai: "XAC_DINH", khoaGiaDinh: U1, hocVienIds: [`${T}a`, `${T}b`] });
  });

  it("[GDD-DB-02] học viên chưa liên kết phụ huynh ⇒ CHUA_LIEN_KET; học viên không tồn tại / đã xoá mềm ⇒ null", async () => {
    await dungHv(`${T}c`, { p1: SDT });
    expect(tuyen(xacDinhGiaDinh((await docDauVaoGiaDinh(`${T}c`))!))).toEqual(["CHUA_LIEN_KET_PHU_HUYNH"]);
    await dungHv(`${T}x`, { parentUserId: null, xoa: true });
    expect(await docDauVaoGiaDinh(`${T}x`)).toBeNull();
    expect(await docDauVaoGiaDinh(`${T}khong-co`)).toBeNull();
  });

  it("[GDD-DB-03] hai tài khoản phụ huynh cùng SĐT (khác dạng 84… / 0…) ⇒ TRUNG_HO_SO_PHU_HUYNH", async () => {
    await dungUser(U1, SDT);
    await dungUser(U2, SDT_84);
    await dungHv(`${T}a`, { parentUserId: U1, p1: SDT });
    expect(tuyen(xacDinhGiaDinh((await docDauVaoGiaDinh(`${T}a`))!))).toEqual(["TRUNG_HO_SO_PHU_HUYNH"]);
  });

  it("[GDD-DB-04] tài khoản trùng SĐT nhưng KHÔNG phải phụ huynh (nhân viên) không làm hồ sơ bị coi là trùng", async () => {
    await dungUser(U1, SDT);
    await dungUser(U2, SDT_84, "SALES_CSM");
    await dungHv(`${T}a`, { parentUserId: U1, p1: SDT });
    expect(tuyen(xacDinhGiaDinh((await docDauVaoGiaDinh(`${T}a`))!))).toBe("XAC_DINH");
  });

  it("[GDD-DB-05] học viên thuộc HỒ SƠ KHÁC hoặc CHƯA liên kết nhưng cùng SĐT phụ huynh (dạng +84…) ⇒ HOC_VIEN_KHAC_HO_SO_CUNG_SDT; học viên đã xoá mềm bị bỏ qua", async () => {
    await dungUser(U1, SDT);
    await dungUser(U3, "0399888702");
    await dungHv(`${T}a`, { parentUserId: U1, p1: SDT });
    await dungHv(`${T}k1`, { parentUserId: U3, p1: SDT_PLUS });
    await dungHv(`${T}k2`, { parentUserId: null, p2: SDT_84 });
    await dungHv(`${T}k3`, { parentUserId: U3, p1: SDT, xoa: true });
    const vao = (await docDauVaoGiaDinh(`${T}a`))!;
    expect(vao.hocVienKhacHoSoCungSdt.map((h) => h.studentId).sort()).toEqual([`${T}k1`, `${T}k2`]);
    expect(tuyen(xacDinhGiaDinh(vao))).toEqual(["HOC_VIEN_KHAC_HO_SO_CUNG_SDT"]);
  });

  it("[GDD-DB-06] parentUserId trỏ tới tài khoản không phải phụ huynh hoặc đã xoá ⇒ HO_SO_PHU_HUYNH_KHONG_TIM_THAY", async () => {
    await dungUser(U1, SDT, "SALES_CSM");
    await dungHv(`${T}a`, { parentUserId: U1 });
    expect(tuyen(xacDinhGiaDinh((await docDauVaoGiaDinh(`${T}a`))!))).toEqual(["HO_SO_PHU_HUYNH_KHONG_TIM_THAY"]);
    await db.user.update({ where: { id: U1 }, data: { role: "PARENT", roles: ["PARENT"], deletedAt: d("2026-09-02T00:00:00") } });
    expect(tuyen(xacDinhGiaDinh((await docDauVaoGiaDinh(`${T}a`))!))).toEqual(["HO_SO_PHU_HUYNH_KHONG_TIM_THAY"]);
  });

  it("[GDD-DB-07] lịch sử: ánh xạ đúng số buổi · trả góp · hiệu lực · ngày tiền về (bỏ khoản bị TỪ CHỐI, giữ khoản chờ kế toán); đơn đang xét bị loại; đơn khách vãng lai khớp theo SĐT", async () => {
    await dungHv(`${T}a`, { parentUserId: null });
    await dungDon({ id: `${T}o1`, studentId: `${T}a`, tao: "2026-09-05T09:00:00", soBuoi: 24, tien: [{ luc: "2026-09-20T10:00:00" }, { luc: "2026-09-21T10:00:00", trangThai: "REJECTED" }, { luc: "2026-09-22T10:00:00", trangThai: "PENDING" }] });
    await dungDon({ id: `${T}o2`, studentId: `${T}a`, tao: "2026-09-06T09:00:00", soBuoi: 48, soDot: 2, status: "CANCELLED" });
    await dungDon({ id: `${T}o3`, studentId: null, tao: "2026-09-07T09:00:00", phone: SDT_84 });
    await dungDon({ id: `${T}ohientai`, studentId: `${T}a`, tao: "2026-10-01T09:00:00", soBuoi: 12 });
    await dungDon({ id: `${T}o4`, studentId: `${T}a`, tao: "2026-09-08T09:00:00", soBuoi: 48, soDot: 1 }); // MỘT dòng kế hoạch ≠ "nhiều đợt"
    const r = await docLichSuGiaDinh({ hocVienIds: [`${T}a`], sdtGiaDinh: [SDT], orderIdDangXet: `${T}ohientai`, cuaSo: CUA_SO });
    const theo = (id: string) => r.lichSu.find((l) => l.orderId === id)!;
    expect(r.lichSu.map((l) => l.orderId).sort()).toEqual([`${T}o1`, `${T}o2`, `${T}o3`, `${T}o4`]);
    expect(theo(`${T}o4`)).toMatchObject({ soBuoi: 48, traGopNhieuDot: false });
    expect(theo(`${T}o1`)).toMatchObject({ studentId: `${T}a`, soBuoi: 24, traGopNhieuDot: false, conHieuLuc: true });
    expect(theo(`${T}o1`).ngayTienVe.map((x) => x.toISOString()).sort()).toEqual([d("2026-09-20T10:00:00").toISOString(), d("2026-09-22T10:00:00").toISOString()]);
    expect(theo(`${T}o2`)).toMatchObject({ soBuoi: 48, traGopNhieuDot: true, conHieuLuc: false });
    expect(theo(`${T}o3`)).toMatchObject({ studentId: null, soBuoi: null });
  });

  it("[GDD-DB-08] 'đang học từ trước' từ ghi danh THẬT: ACTIVE tạo trước 01/09 ⇒ CO; COMPLETED ⇒ KHONG_RO; ACTIVE tạo trong đợt mà đã có đơn ⇒ KHONG; học viên không ghi danh ⇒ KHONG", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) await dungHv(`${T}${id}`, { parentUserId: null });
    const gd = (hv: string, status: "ACTIVE" | "COMPLETED", ngay: string) =>
      db.enrollment.create({ data: { id: `${T}gd-${hv}`, studentId: `${T}${hv}`, classId: LOP, courseId: KHOA, status, createdAt: d(ngay) } });
    await gd("a", "ACTIVE", "2026-06-01T09:00:00");
    await gd("b", "COMPLETED", "2026-03-01T09:00:00");
    await gd("c", "ACTIVE", "2026-09-10T09:00:00");
    await gd("e", "ACTIVE", "2026-09-10T09:00:00");
    await dungDon({ id: `${T}oc`, studentId: `${T}c`, tao: "2026-09-12T09:00:00", soBuoi: 12 });
    await dungDon({ id: `${T}oe`, studentId: `${T}e`, tao: "2026-09-12T09:00:00", soBuoi: 12, status: "CANCELLED" }); // đơn huỷ không làm 'đã mua trong đợt'
    const r = await docLichSuGiaDinh({ hocVienIds: [`${T}a`, `${T}b`, `${T}c`, `${T}d`, `${T}e`], sdtGiaDinh: [], orderIdDangXet: `${T}khong-co`, cuaSo: CUA_SO });
    expect(Object.fromEntries(r.cacCon.map((c) => [c.studentId.slice(T.length), c.dangHocTuTruoc]))).toEqual({ a: "CO", b: "KHONG_RO", c: "KHONG", d: "KHONG", e: "KHONG_RO" });
  });

  it("[GDD-DB-09] ĐẦU-CUỐI từ DB: cùng dữ liệu, hai cơ sở thứ tự cho hai đáp án khác nhau (ví dụ Q1 của tài liệu); bộ đọc KHÔNG ghi gì", async () => {
    await dungUser(U1, SDT);
    await dungHv(`${T}a`, { parentUserId: U1, p1: SDT });
    await dungHv(`${T}b`, { parentUserId: U1, p1: SDT });
    // A: tạo 05/09, tiền về 20/09 · B: tạo 10/09, tiền về 12/09
    await dungDon({ id: `${T}oa`, studentId: `${T}a`, tao: "2026-09-05T09:00:00", soBuoi: 36, tien: [{ luc: "2026-09-20T10:00:00" }] });
    await dungDon({ id: `${T}ob`, studentId: `${T}b`, tao: "2026-09-10T09:00:00", soBuoi: 12, tien: [{ luc: "2026-09-12T10:00:00" }] });
    const chup = async () => JSON.stringify([await db.order.count(), await db.orderItem.count(), await db.payment.count(), await db.student.count(), await db.user.count(), await db.auditLog.count()]);
    const truoc = await chup();

    const gd = xacDinhGiaDinh((await docDauVaoGiaDinh(`${T}b`))!);
    expect(gd.trangThai).toBe("XAC_DINH");
    if (gd.trangThai !== "XAC_DINH") return;
    const ls = await docLichSuGiaDinh({ hocVienIds: gd.hocVienIds, sdtGiaDinh: [SDT], orderIdDangXet: `${T}onew`, cuaSo: CUA_SO });
    const dong = { orderItemId: `${T}onew-it`, orderId: `${T}onew`, studentId: `${T}b`, soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") };
    const hang = (coSo: "NGAY_TAO_DON" | "NGAY_TIEN_VE") => {
      const r = xetThuTuChoDong({ coSo, cuaSo: CUA_SO, dong, cacConGiaDinh: ls.cacCon, lichSu: ls.lichSu, cungDon: [], phuHuynhChon: null });
      return r.trangThai === "XAC_DINH" ? r.thuTuCon : r;
    };
    expect(hang("NGAY_TAO_DON"), "A tạo đơn trước ⇒ B là con thứ hai").toBe(2);
    expect(hang("NGAY_TIEN_VE"), "B tiền về trước ⇒ B là con thứ nhất").toBe(1);
    expect(await chup(), "bộ đọc không được ghi").toBe(truoc);
  });
});
