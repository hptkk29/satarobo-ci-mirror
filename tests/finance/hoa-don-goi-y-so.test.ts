// Ca [GYD-*] — GỢI Ý SỐ + KIỂM TRÙNG THEO DÃY trên Postgres THẬT (PR3, docs/ke-toan-hoa-don/NANG-CAP-2026-10.md).
//
// Hình dạng dữ liệu = số đo prod 23/10/2026: CS1 ký hiệu 1C26MAI số 2,4,5,6,7,8 (thiếu 1 và 3); CS2 ký hiệu 1C26MNV số
// 13…36 có lỗ, snapshot SAI pháp nhân (MST Sata thay vì New Vision). Thứ phải đo ở DB:
//   · đề xuất = lớn nhất + 1, không lấp lỗ; hoá đơn cũ lưu sai MST vẫn nằm đúng dãy New Vision;
//   · trùng số trong dãy bị chặn kể cả khi chỉ mục DB không thấy (bản huỷ · MST lưu sai · cơ sở khác dùng chung dãy);
//   · hai kế toán cùng lưu MỘT số ⇒ đúng một bên thắng, bên thua nhận TRUNG_SO (không phải "người khác đã xử lý");
//   · gợi ý đọc KHÔNG-SCOPE nhưng chỉ trả SỐ NGUYÊN.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { capNhatHoaDonNhap, LoiGhiHoaDon, taoHoaDonChoLanThu } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { goiYSoChoDay } from "@/lib/finance/hoa-don/goi-y-so-db";
import { CAU_HINH_HOA_DON_MAC_DINH } from "@/lib/finance/hoa-don/phap-nhan";

if (!RUN_DB_TESTS) console.warn(`[GYD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-gys-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const SATA = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "SATA_ROBO")!;
const NV = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "NEW_VISION")!;
// Ký hiệu RIÊNG của bộ này (không đụng dòng nào của bộ khác trong DB dùng chung).
const KY_MAI = "1C99GA1";
const KY_MNV = "1C99GA2";
const DONS = [1, 2, 3, 4].map((i) => `${T}don${i}`);
const PAYS = DONS.map((d) => `${d}-p`);

const TEP = (ten: string) => ({
  khoa: `hoa-don/GYS/2099/${ten}.pdf`,
  ten: `${ten}.pdf`,
  co: 1234,
  sha256: createHash("sha256").update(`fixture:${T}${ten}`).digest("hex"),
});

async function don() {
  const hd = await db.hoaDonDienTu.findMany({ where: { OR: [{ orderId: { in: DONS } }, { centerId: { in: [CS1, CS2] } }] }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "Order", entityId: { in: DONS } }, { entityId: { in: hd.map((h) => h.id) } }] } });
  await db.hoaDonKhoan.deleteMany({ where: { hoaDonId: { in: hd.map((h) => h.id) } } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { in: hd.map((h) => h.id) } } });
  await db.payment.deleteMany({ where: { orderId: { in: DONS } } });
  await db.order.deleteMany({ where: { id: { in: DONS } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS1, code: `${T}CS1`, name: "CS1 fx", slug: `${T}1`, address: "a" } });
  await db.center.create({ data: { id: CS2, code: `${T}CS2`, name: "CS2 fx", slug: `${T}2`, address: "b" } });
  for (const [i, id] of DONS.entries()) {
    await db.order.create({
      data: { id, code: `ORD-299999-0009${i}1`, type: "COURSE", status: "CONFIRMED", customerName: "PH fx", customerPhone: `099900099${i}`, totalAmount: 1000, centerId: i % 2 === 0 ? CS1 : CS2, invoiceEmail: "ph@example.com" },
    });
    await db.payment.create({ data: { id: PAYS[i]!, orderId: id, amount: 1000, method: "BANK_TRANSFER", paidDate: new Date("2099-01-01T03:00:00Z") } });
  }
}

const luuCu = (soHoaDon: string, o: { ky?: string; mst?: string; centerId?: string; trangThai?: "DA_XAC_NHAN" | "THAY_THE" | "NHAP" } = {}) =>
  db.hoaDonDienTu.create({
    data: {
      orderId: DONS[0]!,
      centerId: o.centerId ?? CS1,
      trangThai: o.trangThai ?? "DA_XAC_NHAN",
      kyHieu: o.ky ?? KY_MAI,
      soHoaDon,
      phapNhanMst: o.mst ?? SATA.maSoThue,
      ngayPhatHanh: new Date("2099-01-05T00:00:00Z"),
      tongTien: 0,
      taoBoiId: KT.id,
      ...(o.trangThai === "THAY_THE" ? { huyLyDo: "huỷ fx", huyBoiId: KT.id, huyLuc: new Date("2099-01-06T00:00:00Z") } : {}),
    },
  });

const taoNhap = (o: { i: number; so: string; ky?: string; phapNhan?: typeof SATA; centerId?: string; xacMinhSo?: "XML" | "KE_TOAN_DA_DOI_CHIEU" | "KHONG_CAN" }) =>
  taoHoaDonChoLanThu({
    nguoiGhi: KT,
    orderId: DONS[o.i]!,
    centerId: o.centerId ?? (o.i % 2 === 0 ? CS1 : CS2),
    lanThuKey: `dot:${T}${o.i}`,
    khoan: [{ id: PAYS[o.i]!, soTien: 1000 }],
    loai: {
      trangThai: "NHAP",
      phapNhan: o.phapNhan ?? SATA,
      so: { kyHieu: o.ky ?? KY_MAI, soHoaDon: o.so, ngayPhatHanh: new Date("2099-01-10T00:00:00Z") },
      guiEmailKhach: true,
      pdf: TEP(`p${o.i}-${o.so}`),
      xml: null,
      theoSoDaThu: null,
      tienTha: 0,
      xacMinhSo: o.xacMinhSo ?? "KHONG_CAN",
      xmlTrangThai: "KHONG_CO",
    },
  });

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiGhiHoaDon ? e.ma : String(e);
  }
}

describe.skipIf(!RUN_DB_TESTS)("[GYD] gợi ý số + kiểm trùng theo dãy — Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[GYD-01] đề xuất = lớn nhất + 1, KHÔNG lấp lỗ; dãy chưa có số nào ⇒ CHUA_CO", async () => {
    for (const n of ["2", "4", "5", "6", "7", "8"]) await luuCu(n);
    expect(await goiYSoChoDay({ mst: SATA.maSoThue, kyHieu: KY_MAI, centerId: CS1 })).toEqual({ loai: "CO", so: 9, max: 8, soLuong: 6 });
    expect(await goiYSoChoDay({ mst: SATA.maSoThue, kyHieu: "1C99ZZZ", centerId: CS1 })).toEqual({ loai: "CHUA_CO" });
    expect(await goiYSoChoDay({ mst: SATA.maSoThue, kyHieu: "", centerId: CS1 })).toEqual({ loai: "CHUA_CO" });
  });

  it("[GYD-02] số của hoá đơn ĐÃ HUỶ (THAY_THE) vẫn tính là đã dùng — không đề xuất lại", async () => {
    await luuCu("5");
    await luuCu("6", { trangThai: "THAY_THE" });
    expect(await goiYSoChoDay({ mst: SATA.maSoThue, kyHieu: KY_MAI, centerId: CS1 })).toMatchObject({ loai: "CO", so: 7, max: 6 });
  });

  it("[GYD-03] hoá đơn CŨ của CS2 lưu sai MST (Sata) vẫn nằm đúng dãy New Vision — đề xuất 37, không phải số 1", async () => {
    // Quy tắc sai-pháp-nhân khai theo mã cơ sở THẬT "CS2": dùng cơ sở CS2 có sẵn trong DB, không thì gán mã đó cho fixture.
    const thuc = await db.center.findFirst({ where: { code: "CS2" }, select: { id: true } });
    const cs2 = thuc?.id ?? CS2;
    if (!thuc) await db.center.update({ where: { id: CS2 }, data: { code: "CS2" } });
    try {
      for (const n of ["13", "14", "35", "36"]) await luuCu(n, { ky: "1C26MNV", mst: SATA.maSoThue, centerId: cs2 });
      expect(await goiYSoChoDay({ mst: NV.maSoThue, kyHieu: "1C26MNV", centerId: cs2 })).toMatchObject({ loai: "CO", so: 37, max: 36 });
      expect(await goiYSoChoDay({ mst: SATA.maSoThue, kyHieu: "1C26MNV", centerId: CS1 })).toEqual({ loai: "CHUA_CO" });
    } finally {
      await db.hoaDonDienTu.deleteMany({ where: { kyHieu: "1C26MNV", orderId: DONS[0]! } });
    }
  });

  it("[GYD-04] lưu nháp trùng số trong dãy ⇒ TRUNG_SO, KHÔNG ghi gì (kể cả khi chỉ mục DB không thấy: bản đã huỷ)", async () => {
    await luuCu("20", { trangThai: "THAY_THE" });
    expect(await maLoi(taoNhap({ i: 0, so: "20" }))).toBe("TRUNG_SO");
    expect(await db.hoaDonDienTu.count({ where: { orderId: DONS[0]!, trangThai: "NHAP" } })).toBe(0);
    expect(await db.hoaDonKhoan.count({ where: { paymentId: PAYS[0]! } })).toBe(0);
    // số khác thì lưu được
    expect(await maLoi(taoNhap({ i: 0, so: "21" }))).toBeNull();
  });

  it("[GYD-05] số '0021' và '21' là MỘT số: gõ '0021' khi 21 đã dùng ⇒ TRUNG_SO", async () => {
    await luuCu("21");
    expect(await maLoi(taoNhap({ i: 0, so: "21" }))).toBe("TRUNG_SO");
  });

  it("[GYD-06] HAI cơ sở dùng chung một dãy: cơ sở này thấy số cơ sở kia; gõ trùng bị chặn", async () => {
    expect(await maLoi(taoNhap({ i: 0, so: "30" }))).toBeNull(); // CS1
    expect(await goiYSoChoDay({ mst: SATA.maSoThue, kyHieu: KY_MAI, centerId: CS1 })).toMatchObject({ loai: "CO", so: 31 });
    expect(await maLoi(taoNhap({ i: 1, so: "30" }))).toBe("TRUNG_SO"); // CS2 cùng (MST, ký hiệu)
    expect(await maLoi(taoNhap({ i: 1, so: "31" }))).toBeNull();
  });

  it("[GYD-07] cùng số nhưng KHÁC dãy (khác MST hoặc khác ký hiệu) thì KHÔNG trùng", async () => {
    expect(await maLoi(taoNhap({ i: 0, so: "40" }))).toBeNull();
    expect(await maLoi(taoNhap({ i: 1, so: "40", phapNhan: NV }))).toBeNull();
    expect(await maLoi(taoNhap({ i: 2, so: "40", ky: KY_MNV }))).toBeNull();
  });

  it("[GYD-08] HAI kế toán lưu CÙNG số trong cùng dãy CÙNG LÚC ⇒ đúng một bên thắng, bên thua nhận TRUNG_SO", async () => {
    const kq = await Promise.all([maLoi(taoNhap({ i: 0, so: "50" })), maLoi(taoNhap({ i: 1, so: "50" }))]);
    expect(kq.filter((x) => x === null)).toHaveLength(1);
    expect(kq.filter((x) => x === "TRUNG_SO")).toHaveLength(1);
    expect(await db.hoaDonDienTu.count({ where: { kyHieu: KY_MAI, soHoaDon: "50", trangThai: "NHAP" } })).toBe(1);
  });

  it("[GYD-09] sửa bản nháp: giữ nguyên số của CHÍNH nó thì được; đổi sang số đã dùng bị chặn", async () => {
    await luuCu("60");
    const { id } = await taoNhap({ i: 0, so: "61" });
    const sua = (so: string) =>
      capNhatHoaDonNhap({
        nguoiGhi: KT,
        orderId: DONS[0]!,
        hoaDonId: id,
        so: { kyHieu: KY_MAI, soHoaDon: so, ngayPhatHanh: new Date("2099-01-10T00:00:00Z") },
        guiEmailKhach: true,
        theoSoDaThu: null,
        tienTha: 0,
        xacMinhSo: "KHONG_CAN",
        xmlTrangThai: "KHONG_CO",
        phapNhanMstDuKien: SATA.maSoThue,
      });
    expect(await maLoi(sua("61"))).toBeNull();
    expect(await maLoi(sua("60"))).toBe("TRUNG_SO");
    expect(await maLoi(sua("62"))).toBeNull();
  });

  it("[GYD-10] hai lượt cùng số vào CÙNG dãy chuẩn hoá nhưng KHÁC MST lưu (chỉ mục DB không thấy) ⇒ chỉ khoá tư vấn bắt được: đúng một bên thắng", async () => {
    // CS2 + 1C26MNV: một bản lưu MST New Vision (đúng), một bản lưu MST Sata (sai — kiểu 19 hoá đơn cũ). Hai MST khác
    // nhau nên chỉ mục DB coi là HAI số khác nhau; chỉ phép kiểm theo dãy chuẩn hoá + khoá tư vấn mới xếp hàng được.
    // DB dùng chung (CI) có thể ĐÃ có cơ sở mã "CS2" do bộ khác dựng: mã là UNIQUE nên không gán thêm được, và nếu cứ dùng
    // cơ sở fixture (mã `fx-gys-CS2`) thì quy tắc "CS2 + 1C26MNV ⇒ New Vision" không áp, hai lượt rơi hai khoá khác nhau
    // và CẢ HAI thắng (CI #923 đỏ đúng vì vậy). ⇒ dùng cơ sở mã "CS2" CÓ SẴN; chưa có thì gán mã cho cơ sở fixture.
    const thuc = await db.center.findFirst({ where: { code: "CS2" }, select: { id: true } });
    if (!thuc) await db.center.update({ where: { id: CS2 }, data: { code: "CS2" } });
    const cs2Id = thuc?.id ?? CS2;
    const kq = await Promise.all([
      maLoi(taoNhap({ i: 1, so: "70", ky: "1C26MNV", phapNhan: NV, centerId: cs2Id })),
      maLoi(taoNhap({ i: 3, so: "70", ky: "1C26MNV", phapNhan: SATA, centerId: cs2Id })),
    ]);
    await db.hoaDonKhoan.deleteMany({ where: { paymentId: { in: [PAYS[1]!, PAYS[3]!] } } });
    await db.hoaDonDienTu.deleteMany({ where: { kyHieu: "1C26MNV", orderId: { in: [DONS[1]!, DONS[3]!] } } });
    expect(kq.filter((x) => x === null)).toHaveLength(1);
    expect(kq.filter((x) => x === "TRUNG_SO")).toHaveLength(1);
  });

  it("[GYD-11] D2: cách xác minh số đi vào AUDIT của hoá đơn nháp (lời khai ≠ XML ≠ gõ tay phải phân biệt được về sau)", async () => {
    const cach = ["KE_TOAN_DA_DOI_CHIEU", "XML", "KHONG_CAN"] as const;
    const so = ["81", "82", "83"];
    for (const [k, c] of cach.entries()) {
      const { id } = await taoNhap({ i: 0, so: so[k]!, xacMinhSo: c });
      const nk = await db.auditLog.findFirst({ where: { entityType: "HoaDonDienTu", entityId: id, action: "TAO_HOA_DON_NHAP" }, select: { newValues: true } });
      expect(nk?.newValues).toMatchObject({ soHoaDon: so[k], xacMinhSo: c, xmlTrangThai: "KHONG_CO" });
      await db.hoaDonKhoan.deleteMany({ where: { hoaDonId: id } });
      await db.hoaDonDienTu.delete({ where: { id } });
    }
  });

  it("[GYD-12] SỬA nháp: pháp nhân theo cấu hình của ngày mới KHÁC snapshot ⇒ PHAP_NHAN_DOI, hàng không đổi; cùng pháp nhân ⇒ sửa được + audit SUA có cách xác minh", async () => {
    const { id } = await taoNhap({ i: 0, so: "91" });
    const sua = (mst: string, so: string, xac: "KHONG_CAN" | "KE_TOAN_DA_DOI_CHIEU") =>
      capNhatHoaDonNhap({
        nguoiGhi: KT,
        orderId: DONS[0]!,
        hoaDonId: id,
        so: { kyHieu: KY_MAI, soHoaDon: so, ngayPhatHanh: new Date("2099-02-01T00:00:00Z") },
        guiEmailKhach: true,
        theoSoDaThu: null,
        tienTha: 0,
        xacMinhSo: xac,
        xmlTrangThai: "KHONG_DOC_DUOC",
        phapNhanMstDuKien: mst,
      });
    expect(await maLoi(sua(NV.maSoThue, "92", "KE_TOAN_DA_DOI_CHIEU"))).toBe("PHAP_NHAN_DOI");
    const nguyen = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id }, select: { soHoaDon: true, ngayPhatHanh: true, phapNhanMst: true } });
    expect(nguyen).toMatchObject({ soHoaDon: "91", phapNhanMst: SATA.maSoThue });
    expect(nguyen.ngayPhatHanh?.toISOString().slice(0, 10)).toBe("2099-01-10");
    expect(await maLoi(sua(SATA.maSoThue, "92", "KE_TOAN_DA_DOI_CHIEU"))).toBeNull();
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id }, select: { soHoaDon: true } })).toMatchObject({ soHoaDon: "92" });
    const nk = await db.auditLog.findFirst({ where: { entityType: "HoaDonDienTu", entityId: id, action: "SUA_HOA_DON_NHAP" }, select: { newValues: true, oldValues: true } });
    expect(nk?.newValues).toMatchObject({ soHoaDon: "92", xacMinhSo: "KE_TOAN_DA_DOI_CHIEU", xmlTrangThai: "KHONG_DOC_DUOC" });
    expect(nk?.oldValues).toMatchObject({ soHoaDon: "91" });
    await db.hoaDonKhoan.deleteMany({ where: { hoaDonId: id } });
    await db.hoaDonDienTu.delete({ where: { id } });
  });
});
