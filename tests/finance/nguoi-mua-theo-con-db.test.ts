// tests/finance/nguoi-mua-theo-con-db.test.ts — [NMCDB-*] «con ứng viên» làm người mua hoá đơn, trên Postgres THẬT (kế toán 17/11/2026).
//
// Gọi THẲNG `napConChoNguoiMua` — phần KHÔNG thuần mà test thuần không chạm được: mốc áp dụng đọc từ cài đặt, hồ sơ học viên (tên/CCCD khi đơn chưa lưu), và «đơn đã có phiếu thu / hoá đơn
// phát hành TRƯỚC mốc». Fixture mang hình dạng ca thật (đơn một con, đơn hai con, đơn có phiếu thu cũ, đơn có hoá đơn cũ/mới). Ngày tuyệt đối 2699 (luật 19 — không đọc đồng hồ thật).
//
//   mốc TẮT (cài đặt rỗng)        : mọi đơn ⇒ null
//   mốc 2699-11-17 (giờ VN)       :
//     don-mot-con          1 học viên có tên + CCCD ở hồ sơ, chưa có chứng từ   ⇒ CON (tên + CCCD lấy từ hồ sơ)
//     don-hddt-cu          hoá đơn tạo TRƯỚC mốc                                ⇒ null (giữ ba/mẹ)
//     don-phieu-cu         phiếu thu phát hành TRƯỚC mốc                        ⇒ null
//     don-hddt-moi         hoá đơn tạo SAU mốc                                  ⇒ CON (chứng từ mới không đóng băng)
//     don-hai-con          dòng đơn của hai học viên khác nhau                  ⇒ null
//     don-khai-them        có khai thêm em                                      ⇒ null
//     don-ten-tren-don     chưa gắn học viên, Sale đã gõ tên + CCCD con         ⇒ CON (giá trị TRÊN ĐƠN)
//     don-ten-tren-don-thang  gắn học viên nhưng đơn đã lưu tên khác hồ sơ      ⇒ CON mang tên TRÊN ĐƠN (đơn thắng hồ sơ)
// Chạy: `pnpm test:finance-db`. KHÔNG `resetDb()`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { clearSettingsCache } from "@/lib/settings/service";
import { napThongTinCon, napConChoMotDon, orderItemIdsCuaKhoan } from "@/lib/finance/hoa-don/nap-con-nguoi-mua";
import { conChoChungTu, type BenNguoiMua } from "@/lib/finance/hoa-don/nguoi-mua-theo-con";

if (!RUN_DB_TESTS) console.warn(`[NMCDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-nmcdb-";
const KHOA = "hoaDon.nguoiMuaTheoConTuNgay";
const CS = `${T}cs`;
const HS_A = `${T}hs-a`;
const HS_B = `${T}hs-b`;
const d = (k: string) => `${T}${k}`;
const DON = ["don-hai-con-rieng", "don-mot-con", "don-hddt-cu", "don-phieu-cu", "don-hddt-moi", "don-hai-con", "don-khai-them", "don-ten-tren-don", "don-ten-tren-don-thang"].map(d);
/** Con ứng viên CẢ ĐƠN của mỗi đơn (màn đơn): đơn một con ra con, đơn nhiều con ra null. */
const napConChoNguoiMua = async (ids: readonly string[]): Promise<Map<string, BenNguoiMua | null>> => {
  const m = await napThongTinCon(ids);
  return new Map(ids.map((id) => [id, conChoChungTu(m.get(id) ?? null)]));
};
const TRUOC_MOC = new Date("2699-11-10T03:00:00.000Z");
const SAU_MOC = new Date("2699-11-20T03:00:00.000Z");

async function don() {
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: { in: DON } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: DON } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: DON } } });
  await db.order.deleteMany({ where: { id: { in: DON } } });
  await db.student.deleteMany({ where: { id: { in: [HS_A, HS_B] } } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.systemSetting.deleteMany({ where: { key: KHOA } });
  clearSettingsCache();
}

const datMoc = async (v: string) => {
  await db.systemSetting.upsert({ where: { key: KHOA }, create: { key: KHOA, valueJson: v }, update: { valueJson: v } });
  clearSettingsCache();
};

const taoDon = (k: string, o: { studentId?: string | null; khaiThem?: boolean; invoiceStudentName?: string; invoiceStudentCccd?: string } = {}) =>
  db.order.create({
    data: {
      id: d(k),
      code: `ORD-269931-${String(DON.indexOf(d(k)) + 700).padStart(6, "0")}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh",
      customerPhone: "0999000888",
      totalAmount: 5_000_000,
      centerId: CS,
      studentId: o.studentId ?? null,
      invoiceStudentName: o.invoiceStudentName ?? null,
      invoiceStudentCccd: o.invoiceStudentCccd ?? null,
      invoiceHocVienThem: o.khaiThem ? [{ ten: "Em thứ hai", ngaySinh: null, cccd: null }] : undefined,
    },
  });
const dong = (k: string, studentId: string | null) =>
  db.orderItem.create({
    data: { id: d(`${k}-i-${studentId ?? "x"}`), orderId: d(k), type: "COURSE_ENROLLMENT", itemName: "Sata 4", quantity: 1, unitPrice: 1_000_000, totalPrice: 1_000_000, studentId },
  });
const khoanTheoDong = (k: string, ma: string, orderItemId: string) =>
  db.payment.create({
    data: { id: d(`${k}-${ma}`), orderId: d(k), orderItemId, amount: 500_000, method: "sepay", paidDate: SAU_MOC, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS },
  });
const hddt = (k: string, createdAt: Date) =>
  db.hoaDonDienTu.create({ data: { id: d(`${k}-hd`), orderId: d(k), centerId: CS, trangThai: "NHAP", tongTien: 1_000_000, taoBoiId: "fx", createdAt } });
const phieuThu = async (k: string, issuedAt: Date) => {
  await db.payment.create({
    data: { id: d(`${k}-p`), orderId: d(k), amount: 1_000_000, method: "sepay", paidDate: issuedAt, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS },
  });
  await db.receipt.create({ data: { id: d(`${k}-r`), code: `RCP-FX-${k}`, paymentId: d(`${k}-p`), issuedAt } });
};

describe.skipIf(!RUN_DB_TESTS)("[NMCDB] con ứng viên làm người mua — Postgres thật", () => {
  beforeAll(async () => {
    await don();
    await db.center.create({ data: { id: CS, code: "FXNMC", name: "CS fixture NMC", slug: `${T}slug`, address: "x" } });
    await db.student.create({ data: { id: HS_A, name: "Trần Nam Khôi", nationalId: "064218014477", centerId: CS } });
    await db.student.create({ data: { id: HS_B, name: "Em Khác", centerId: CS } });

    // Đơn HAI CON riêng: mỗi bé một dòng đơn, mỗi dòng một khoản (chủ dự án 17/11: mỗi chứng từ một bé).
    await taoDon("don-hai-con-rieng", {});
    await dong("don-hai-con-rieng", HS_A);
    await dong("don-hai-con-rieng", HS_B);
    await khoanTheoDong("don-hai-con-rieng", "pa", d("don-hai-con-rieng-i-" + HS_A));
    await khoanTheoDong("don-hai-con-rieng", "pb", d("don-hai-con-rieng-i-" + HS_B));
    await taoDon("don-mot-con", { studentId: HS_A });
    await dong("don-mot-con", HS_A);
    await taoDon("don-hddt-cu", { studentId: HS_A });
    await hddt("don-hddt-cu", TRUOC_MOC);
    await taoDon("don-phieu-cu", { studentId: HS_A });
    await phieuThu("don-phieu-cu", TRUOC_MOC);
    await taoDon("don-hddt-moi", { studentId: HS_A });
    await hddt("don-hddt-moi", SAU_MOC);
    await taoDon("don-hai-con", { studentId: HS_A });
    await dong("don-hai-con", HS_A);
    await dong("don-hai-con", HS_B);
    await taoDon("don-khai-them", { studentId: HS_A, khaiThem: true });
    await taoDon("don-ten-tren-don", { invoiceStudentName: "Bé Do Sale Gõ", invoiceStudentCccd: "048000000077" });
    await taoDon("don-ten-tren-don-thang", { studentId: HS_A, invoiceStudentName: "Tên Đã Lưu Trên Đơn" });
  });
  afterAll(async () => {
    await don();
  });

  it("[NMCDB-01] cài đặt RỖNG (mặc định) ⇒ luật TẮT: mọi đơn ⇒ null, kể cả đơn một con đủ tên + CCCD", async () => {
    await db.systemSetting.deleteMany({ where: { key: KHOA } });
    clearSettingsCache();
    const kq = await napConChoNguoiMua(DON);
    expect(kq.size).toBe(DON.length);
    expect([...kq.values()].every((v) => v === null)).toBe(true);
  });

  it("[NMCDB-02] đặt mốc ⇒ đơn một con, chưa có chứng từ ⇒ CON với tên + CCCD LẤY TỪ HỒ SƠ học viên", async () => {
    await datMoc("2699-11-17");
    const kq = await napConChoNguoiMua(DON);
    expect(kq.get(d("don-mot-con"))).toEqual({ hoTen: "Trần Nam Khôi", cccd: "064218014477" });
  });

  it("[NMCDB-03] đơn ĐÃ có hoá đơn hoặc phiếu thu phát hành TRƯỚC mốc ⇒ null (giữ ba/mẹ)", async () => {
    await datMoc("2699-11-17");
    const kq = await napConChoNguoiMua(DON);
    expect(kq.get(d("don-hddt-cu"))).toBeNull();
    expect(kq.get(d("don-phieu-cu"))).toBeNull();
  });

  it("[NMCDB-04] chứng từ phát hành SAU mốc KHÔNG đóng băng đơn — kẻo tờ đầu in con rồi tờ sau (đợt trả tiếp) lại in ba/mẹ", async () => {
    await datMoc("2699-11-17");
    const kq = await napConChoNguoiMua(DON);
    expect(kq.get(d("don-hddt-moi"))).toEqual({ hoTen: "Trần Nam Khôi", cccd: "064218014477" });
  });

  it("[NMCDB-05] đơn hai học viên khác nhau, hoặc có khai thêm em ⇒ null (một tờ không đứng tên hai bé)", async () => {
    await datMoc("2699-11-17");
    const kq = await napConChoNguoiMua(DON);
    expect(kq.get(d("don-hai-con"))).toBeNull();
    expect(kq.get(d("don-khai-them"))).toBeNull();
  });

  it("[NMCDB-06] giá trị đã LƯU TRÊN ĐƠN thắng hồ sơ; đơn chưa gắn học viên mà Sale đã gõ tên con vẫn dùng được", async () => {
    await datMoc("2699-11-17");
    const kq = await napConChoNguoiMua(DON);
    expect(kq.get(d("don-ten-tren-don"))).toEqual({ hoTen: "Bé Do Sale Gõ", cccd: "048000000077" });
    // tên trên đơn thắng, CCCD rơi về hồ sơ (đơn chưa lưu CCCD)
    expect(kq.get(d("don-ten-tren-don-thang"))).toEqual({ hoTen: "Tên Đã Lưu Trên Đơn", cccd: "064218014477" });
  });

  it("[NMCDB-07] cài đặt hỏng (không phải ngày) ⇒ coi như TẮT, không đoán ngày", async () => {
    await db.systemSetting.upsert({ where: { key: KHOA }, create: { key: KHOA, valueJson: "hôm qua" }, update: { valueJson: "hôm qua" } });
    clearSettingsCache();
    const kq = await napConChoNguoiMua(DON);
    expect([...kq.values()].every((v) => v === null)).toBe(true);
  });

  it("[NMCDB-09] ĐƠN HAI CON: mỗi chứng từ một bé — khoản của bé A ⇒ thông tin A (hồ sơ, có CCCD); của bé B ⇒ thông tin B; GỘP hai khoản ⇒ null; cả đơn ⇒ null", async () => {
    await datMoc("2699-11-17");
    const don = d("don-hai-con-rieng");
    const kq = (await napThongTinCon([don])).get(don) ?? null;
    const ids = (pid: string) => orderItemIdsCuaKhoan([d(`don-hai-con-rieng-${pid}`)]);
    expect(await ids("pa")).toEqual([d("don-hai-con-rieng-i-" + HS_A)]);
    expect(conChoChungTu(kq, await ids("pa"))).toEqual({ hoTen: "Trần Nam Khôi", cccd: "064218014477" });
    expect(conChoChungTu(kq, await ids("pb"))).toEqual({ hoTen: "Em Khác", cccd: null });
    expect(conChoChungTu(kq, [...(await ids("pa")), ...(await ids("pb"))])).toBeNull();
    expect(conChoChungTu(kq)).toBeNull();
    // đường đi một chặng của loader: truyền dòng đơn của khoản
    expect(await napConChoMotDon(don, undefined, await ids("pa"))).toEqual({ hoTen: "Trần Nam Khôi", cccd: "064218014477" });
    expect(await napConChoMotDon(don, undefined, await ids("pb"))).toEqual({ hoTen: "Em Khác", cccd: null });
  });

  it("[NMCDB-10] đơn hai con đã có chứng từ phát hành TRƯỚC mốc ⇒ MỌI bé giữ ba/mẹ (không tách người mua giữa chừng)", async () => {
    await datMoc("2699-11-17");
    const don = d("don-hai-con-rieng");
    await hddt("don-hai-con-rieng", TRUOC_MOC);
    try {
      const ids = await orderItemIdsCuaKhoan([d("don-hai-con-rieng-pa")]);
      expect(await napConChoMotDon(don, undefined, ids)).toBeNull();
    } finally {
      await db.hoaDonDienTu.deleteMany({ where: { orderId: don } });
    }
  });

  it("[NMCDB-08] rỗng ⇒ Map rỗng, không tốn câu tra", async () => {
    expect((await napConChoNguoiMua([])).size).toBe(0);
  });
});
