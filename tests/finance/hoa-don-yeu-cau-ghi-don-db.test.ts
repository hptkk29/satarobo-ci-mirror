// Ca [YCW-*] — PHỤ HUYNH GỬI FORM QR ⇒ GHI THẲNG VÀO ĐƠN (chủ dự án chốt 03/11/2026) TRÊN POSTGRES THẬT.
//
// Canh những thứ test thuần không chứng minh được (chúng là chuỗi: bản điền sẵn → form → dịch vụ → giao dịch → cột của đơn):
//   · điền sẵn lấy từ ĐƠN → hồ sơ học viên, KHÔNG BAO GIỜ có hai ô CCCD dù hồ sơ có; loại mặc định CÁ NHÂN;
//   · PH gửi ⇒ các ô PH ĐỔI so với bản điền sẵn vào ĐÚNG cột của đơn ngay (cùng giao dịch); ô PH không đụng thì KHÔNG đè lên chỉnh sửa của Sale làm giữa chừng;
//   · ai ghi sau thì thắng (cả hai chiều), địa chỉ có cấu trúc không bị dồn thành một chuỗi khi PH không sửa;
//   · đơn đang DANG_PHAT_HANH ⇒ KHÔNG ghi đơn (dữ liệu PH vẫn nằm trên yêu cầu); nhật ký của đơn chỉ nêu TÊN cột;
//   · SĐT khách (`customerPhone`, chìa đối khớp tiền) không bao giờ bị PH ghi đè.
// Không gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố `fx-ycw-`.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { GioiHanChongDoan } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua";
import { guiThongTinPhuHuynh, moBangToken, taoYeuCau, type KetQuaTao } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-db";

if (!RUN_DB_TESTS) console.warn(`[YCW] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ycw-";
const CS1 = `${T}cs1`;
const DON1 = `${T}don1`;
const HS = `${T}hs`;
const NOW = new Date("2026-11-03T03:00:00.000Z");
const G: GioiHanChongDoan = { toiDaSaiToken: 5, toiDaLanMo: 50, khoaPhut: 15 };
const CCCD_PH = "048123456789";
const CCCD_HS_HOSO = "048999888777"; // CCCD học viên CÓ trong hồ sơ — không bao giờ được điền sẵn
const CCCD_PH_HOSO = "048111222333"; // CCCD ba/mẹ CÓ trong hồ sơ — không bao giờ được điền sẵn

const KT1 = {
  userId: `${T}kt1`,
  isSuperAdmin: false,
  isHoLevel: false,
  orgRoles: [],
  permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS1] }],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Actor;
const ng = { id: KT1.userId, name: "Kế toán YCW" };

async function don() {
  const ids = (await db.hoaDonYeuCauNguoiMua.findMany({ where: { orderId: { startsWith: T } }, select: { id: true } })).map((x) => x.id);
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "HoaDonYeuCauNguoiMua", entityId: { in: ids } }, { entityType: "Order", entityId: { startsWith: T } }] } });
  await db.hoaDonYeuCauNguoiMua.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

async function dungFixture(o: { donData?: Record<string, unknown>; hocVien?: boolean } = {}) {
  await don();
  await db.center.create({ data: { id: CS1, name: "CS1 YCW", slug: CS1, address: "x" } });
  if (o.hocVien) {
    await db.student.create({
      data: {
        id: HS,
        name: "Lê Minh Hồ Sơ",
        dateOfBirth: new Date("2016-05-20T00:00:00.000Z"),
        nationalId: CCCD_HS_HOSO,
        parentName: "Lê Thị Hồ Sơ",
        parentPhone: "0905777666",
        parentEmail: "hoso.ycw@example.com",
        parentNationalId: CCCD_PH_HOSO,
        city: "Đà Nẵng",
        ward: "Hải Châu 1",
        address: "10 Hồ Sơ",
      },
    });
  }
  await db.order.create({
    data: {
      id: DON1,
      code: "ORD-269976-000001",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "Khách hàng YCW",
      customerPhone: "0328545331",
      totalAmount: 5_000_000,
      centerId: CS1,
      ...(o.hocVien ? { studentId: HS } : {}),
      ...(o.donData ?? {}),
    },
  });
}

async function tao(): Promise<Extract<KetQuaTao, { ok: true }>> {
  const r = await taoYeuCau({ actor: KT1, nguoi: ng, orderId: DON1, phamVi: "DON", ttlPhut: 240, now: NOW });
  if (!r.ok) throw new Error(`fixture: ${r.ma}`);
  return r;
}
const mo = async (t: Extract<KetQuaTao, { ok: true }>) => {
  const r = await moBangToken({ id: t.id, token: t.token, gioiHan: G, now: NOW });
  if (!r.ok) throw new Error(`mở: ${r.ma}`);
  return r.yeuCau.dienSan as Record<string, string>;
};
const gui = (t: Extract<KetQuaTao, { ok: true }>, du: Record<string, string>, banDau: Record<string, string>, now: Date = NOW) =>
  guiThongTinPhuHuynh({ id: t.id, token: t.token, gioiHan: G, du, banDau, donY: { phienBanDieuKhoan: "dk-test" }, now });
const donNay = () => db.order.findUniqueOrThrow({ where: { id: DON1 } });

beforeEach(async () => {
  if (RUN_DB_TESTS) await dungFixture();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[YCW-01] điền sẵn khi phụ huynh mở liên kết", () => {
  it("lấy từ ĐƠN rồi hồ sơ học viên (đơn trước, hồ sơ sau); loại CÁ NHÂN; KHÔNG có hai ô CCCD dù hồ sơ có đủ — đối chứng dương: các ô còn lại CÓ", async () => {
    await dungFixture({ hocVien: true, donData: { invoiceBuyerName: "Tên người mua trên đơn" } });
    const o = await mo(await tao());
    expect(o).toMatchObject({
      loai: "CA_NHAN",
      ten: "Tên người mua trên đơn", // ĐƠN thắng hồ sơ
      sdt: "0328545331", // SĐT trên đơn thắng SĐT hồ sơ
      email: "hoso.ycw@example.com", // đơn không có ⇒ hồ sơ
      diaChi: "10 Hồ Sơ, Hải Châu 1, Đà Nẵng",
      tenHocVien: "Lê Minh Hồ Sơ",
      ngaySinhHocVien: "2016-05-20",
    });
    expect("cccd" in o).toBe(false);
    expect("cccdHocVien" in o).toBe(false);
    expect(JSON.stringify(o)).not.toMatch(new RegExp(`${CCCD_HS_HOSO}|${CCCD_PH_HOSO}`));
  });
  it("token SAI ⇒ không có điền sẵn nào (không đọc đơn/hồ sơ khi chưa qua cổng); đối chứng: token đúng ⇒ có", async () => {
    await dungFixture({ hocVien: true });
    const t = await tao();
    const sai = await moBangToken({ id: t.id, token: `${t.token.slice(0, -2)}xx`, gioiHan: G, now: NOW });
    expect(sai.ok).toBe(false);
    expect(JSON.stringify(sai)).not.toContain("Lê Minh Hồ Sơ");
    expect(Object.keys(await mo(t)).length).toBeGreaterThan(0);
  });
  it("đơn đang có CẢ tên đơn vị lẫn MST ⇒ điền sẵn DOANH NGHIỆP (để gửi nguyên không đè thông tin công ty); thiếu MST ⇒ vẫn cá nhân", async () => {
    await dungFixture({ donData: { invoiceCompanyName: "Công ty YCW", invoiceTaxCode: "0401234567", invoiceEmail: "kt.ycw@example.com", customerAddress: "211 Nguyễn Hữu Thọ" } });
    expect(await mo(await tao())).toMatchObject({ loai: "DOANH_NGHIEP", ten: "Công ty YCW", maSoThue: "0401234567", email: "kt.ycw@example.com" });
    await dungFixture({ donData: { invoiceCompanyName: "Công ty chưa có MST" } });
    expect((await mo(await tao())).loai).toBe("CA_NHAN");
  });
});

chay("[YCW-02] gửi ⇒ ghi thẳng vào ĐƠN, chỉ ô PH đổi", () => {
  it("lần đầu (banDau rỗng): mọi ô PH gửi vào ĐÚNG cột; địa chỉ thành MỘT ô (xoá phường/tỉnh); SĐT KHÁCH (`customerPhone`) KHÔNG đổi; yêu cầu vẫn DANG_MO để gửi lại", async () => {
    await dungFixture({ donData: { customerWard: "Phường cũ", customerCity: "Thành phố cũ" } });
    const t = await tao();
    const r = await gui(t, { loai: "CA_NHAN", ten: "Nguyễn Thị Phụ Huynh", cccd: CCCD_PH, diaChi: "114 Hoàng Diệu, Đà Nẵng", email: "ph.ycw@example.com", sdt: "0905 123 456", tenHocVien: "Bé YCW", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321" }, {});
    expect(r).toMatchObject({ ok: true, ghiVaoDon: "DA_GHI" });
    const sau = await donNay();
    expect(sau).toMatchObject({
      invoiceBuyerName: "Nguyễn Thị Phụ Huynh",
      customerCccd: CCCD_PH,
      customerAddress: "114 Hoàng Diệu, Đà Nẵng",
      customerWard: null,
      customerCity: null,
      invoiceEmail: "ph.ycw@example.com",
      invoiceParentPhone: "0905123456",
      invoiceStudentName: "Bé YCW",
      invoiceStudentCccd: "048987654321",
      customerPhone: "0328545331", // ⛔ chìa đối khớp tiền
    });
    expect(sau.invoiceStudentDob?.toISOString().slice(0, 10)).toBe("2016-08-03");
    expect((await db.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id: t.id } })).trangThai).toBe("DANG_MO");
  });

  it("[YCW-02b] PH gửi NGUYÊN bản điền sẵn mà Sale đã sửa ô đó trong lúc PH đang mở form ⇒ chỉnh sửa của Sale GIỮ NGUYÊN; chỉ ô PH thật sự đổi (CCCD, bắt buộc) vào đơn", async () => {
    await dungFixture({ donData: { invoiceBuyerName: "Tên lúc PH mở form", invoiceEmail: "cu@example.com", customerAddress: "Địa chỉ lúc mở" } });
    const t = await tao();
    const banDau = await mo(t); // PH nhìn thấy bản điền sẵn này
    await db.order.update({ where: { id: DON1 }, data: { invoiceBuyerName: "Tên Sale vừa sửa" } }); // Sale sửa giữa chừng
    const r = await gui(t, { ...banDau, cccd: CCCD_PH }, banDau, new Date(NOW.getTime() + 60_000));
    expect(r).toMatchObject({ ok: true, ghiVaoDon: "DA_GHI" });
    expect(await donNay()).toMatchObject({ invoiceBuyerName: "Tên Sale vừa sửa", invoiceEmail: "cu@example.com", customerAddress: "Địa chỉ lúc mở", customerCccd: CCCD_PH });
    // Đối chứng dương: PH THẬT SỰ sửa tên ⇒ tên PH vào đơn (ghi sau thắng), email chưa đụng vẫn giữ.
    const r2 = await gui(t, { ...banDau, cccd: CCCD_PH, ten: "Tên PH sửa lại" }, banDau, new Date(NOW.getTime() + 120_000));
    expect(r2).toMatchObject({ ok: true, ghiVaoDon: "DA_GHI" });
    expect(await donNay()).toMatchObject({ invoiceBuyerName: "Tên PH sửa lại", invoiceEmail: "cu@example.com" });
  });

  it("[YCW-02c] PH không đổi ô nào so với bản điền sẵn (và CCCD đã có ở yêu cầu khác) ⇒ ghiVaoDon = KHONG_DOI: KHÔNG chạm đơn, KHÔNG dòng audit nào trên đơn; `updatedAt` của đơn không đổi", async () => {
    await dungFixture({ donData: { invoiceBuyerName: "Tên đơn", invoiceEmail: "e@example.com", customerAddress: "Địa chỉ đơn dài" } });
    const t = await tao();
    const banDau = await mo(t);
    const truoc = await donNay();
    const r = await gui(t, banDau, banDau);
    expect(r).toMatchObject({ ok: true, ghiVaoDon: "KHONG_DOI" });
    expect(await donNay()).toEqual(truoc);
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: DON1, action: "PHU_HUYNH_GHI_THONG_TIN_NGUOI_MUA" } })).toBe(0);
  });

  it("[YCW-02d] địa chỉ CÓ CẤU TRÚC (phường + tỉnh) KHÔNG bị dồn thành một chuỗi khi PH không sửa ô địa chỉ; PH sửa ô địa chỉ ⇒ thành MỘT ô, xoá phường/tỉnh", async () => {
    await dungFixture({ donData: { customerAddress: "60 Đồng Du", customerWard: "Hải Châu 1", customerCity: "Đà Nẵng" } });
    const t = await tao();
    const banDau = await mo(t);
    expect(banDau.diaChi).toBe("60 Đồng Du, Hải Châu 1, Đà Nẵng");
    await gui(t, { ...banDau, cccd: CCCD_PH }, banDau);
    expect(await donNay()).toMatchObject({ customerAddress: "60 Đồng Du", customerWard: "Hải Châu 1", customerCity: "Đà Nẵng" });
    await gui(t, { ...banDau, cccd: CCCD_PH, diaChi: "9 Lê Duẩn, Đà Nẵng" }, banDau, new Date(NOW.getTime() + 60_000));
    expect(await donNay()).toMatchObject({ customerAddress: "9 Lê Duẩn, Đà Nẵng", customerWard: null, customerCity: null });
  });
});

chay("[YCW-03] AI GHI SAU THÌ THẮNG — PH ↔ Sale, cả hai chiều", () => {
  it("PH gửi sai ⇒ Sale sửa đơn ⇒ Sale thắng; PH gửi lại ô khác ⇒ ô Sale sửa GIỮ (PH không đụng); PH sửa đúng ô đó ⇒ PH thắng lại", async () => {
    await dungFixture({ donData: { invoiceBuyerName: "Tên gốc", invoiceEmail: "goc@example.com" } });
    const t = await tao();
    const banDau = await mo(t);
    await gui(t, { ...banDau, ten: "Tên PH gõ sai", cccd: CCCD_PH }, banDau, new Date(NOW.getTime() + 60_000));
    expect((await donNay()).invoiceBuyerName).toBe("Tên PH gõ sai");
    await db.order.update({ where: { id: DON1 }, data: { invoiceBuyerName: "Tên Sale sửa đúng" } }); // Sale sửa SAU PH
    expect((await donNay()).invoiceBuyerName).toBe("Tên Sale sửa đúng");
    const banDau2 = await mo(t); // PH mở lại: thấy tên đã được Sale sửa
    expect(banDau2.ten).toBe("Tên Sale sửa đúng");
    await gui(t, { ...banDau2, email: "moi@example.com", cccd: CCCD_PH }, banDau2, new Date(NOW.getTime() + 120_000));
    expect(await donNay()).toMatchObject({ invoiceBuyerName: "Tên Sale sửa đúng", invoiceEmail: "moi@example.com" });
    await gui(t, { ...banDau2, ten: "Tên PH sửa lần cuối", cccd: CCCD_PH }, banDau2, new Date(NOW.getTime() + 180_000));
    expect((await donNay()).invoiceBuyerName).toBe("Tên PH sửa lần cuối");
  });

  it("đổi loại: đơn đang là DOANH NGHIỆP, PH đổi sang CÁ NHÂN ⇒ XOÁ tên đơn vị + MST và ghi tên ba/mẹ; PH gửi nguyên (vẫn DOANH NGHIỆP) ⇒ công ty GIỮ NGUYÊN", async () => {
    await dungFixture({ donData: { invoiceCompanyName: "Công ty YCW", invoiceTaxCode: "0401234567", invoiceEmail: "kt.ycw@example.com", customerAddress: "211 Nguyễn Hữu Thọ" } });
    const t = await tao();
    const banDau = await mo(t);
    expect(banDau.loai).toBe("DOANH_NGHIEP");
    expect(await gui(t, banDau, banDau)).toMatchObject({ ok: true, ghiVaoDon: "KHONG_DOI" });
    expect(await donNay()).toMatchObject({ invoiceCompanyName: "Công ty YCW", invoiceTaxCode: "0401234567" });
    await gui(t, { loai: "CA_NHAN", ten: "Nguyễn Văn Cá Nhân", cccd: CCCD_PH, diaChi: banDau.diaChi!, email: banDau.email! }, banDau, new Date(NOW.getTime() + 60_000));
    expect(await donNay()).toMatchObject({ invoiceCompanyName: null, invoiceTaxCode: null, invoiceBuyerName: "Nguyễn Văn Cá Nhân", customerCccd: CCCD_PH });
  });
});

chay("[YCW-04] an toàn của đường ghi", () => {
  it("đơn đang có hoá đơn DANG_PHAT_HANH ⇒ KHÔNG ghi vào đơn (ghiVaoDon = HOA_DON_DANG_PHAT_HANH); dữ liệu PH vẫn nằm trên yêu cầu; đối chứng: hoá đơn NHAP thì vẫn ghi", async () => {
    const t = await tao();
    await db.hoaDonDienTu.create({ data: { id: `${T}hd1`, orderId: DON1, centerId: CS1, trangThai: "DANG_PHAT_HANH", tongTien: 5_000_000, taoBoiId: KT1.userId } });
    const truoc = await donNay();
    const r = await gui(t, { loai: "CA_NHAN", ten: "Nguyễn Thị Chặn", cccd: CCCD_PH, diaChi: "114 Hoàng Diệu, Đà Nẵng" }, {});
    expect(r).toMatchObject({ ok: true, ghiVaoDon: "HOA_DON_DANG_PHAT_HANH" });
    expect(await donNay()).toEqual(truoc);
    expect(JSON.stringify((await db.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id: t.id } })).duLieuGui)).toContain("Nguyễn Thị Chặn");
    await db.hoaDonDienTu.update({ where: { id: `${T}hd1` }, data: { trangThai: "NHAP" } });
    expect(await gui(t, { loai: "CA_NHAN", ten: "Nguyễn Thị Được", cccd: CCCD_PH, diaChi: "114 Hoàng Diệu, Đà Nẵng" }, {}, new Date(NOW.getTime() + 60_000))).toMatchObject({ ghiVaoDon: "DA_GHI" });
    expect((await donNay()).invoiceBuyerName).toBe("Nguyễn Thị Được");
  });

  it("nhật ký của ĐƠN chỉ nêu TÊN cột — không một giá trị tên / CCCD / SĐT / địa chỉ nào; đối chứng dương: tên cột có", async () => {
    const t = await tao();
    await gui(t, { loai: "CA_NHAN", ten: "Nguyễn Thị Nhật Ký YCWX", cccd: CCCD_PH, sdt: "0905123456", diaChi: "114 Hoàng Diệu YCWX, Đà Nẵng" }, {});
    const au = JSON.stringify(await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON1, action: "PHU_HUYNH_GHI_THONG_TIN_NGUOI_MUA" } }));
    for (const v of ["Nhật Ký YCWX", CCCD_PH, "0905123456", "YCWX"]) expect(au, v).not.toContain(v);
    expect(au).toContain("customerCccd");
    expect(au).toContain("invoiceBuyerName");
  });

  it("gửi bị từ chối (liên kết sai / hết hạn) ⇒ đơn KHÔNG đổi; gửi lỗi định dạng ⇒ đơn không đổi", async () => {
    const t = await tao();
    const truoc = await donNay();
    expect((await gui({ ...t, token: "sai-token-khong-dung" }, { loai: "CA_NHAN", ten: "Kẻ gian", cccd: CCCD_PH, diaChi: "114 Hoàng Diệu, Đà Nẵng" }, {})).ok).toBe(false);
    expect(await gui(t, { loai: "CA_NHAN", ten: "Nguyễn Thị Quá Hạn", cccd: CCCD_PH, diaChi: "114 Hoàng Diệu, Đà Nẵng" }, {}, new Date(NOW.getTime() + 241 * 60_000))).toMatchObject({ ok: false });
    expect(await gui(t, { loai: "CA_NHAN", ten: "Nguyễn Thị Lỗi", cccd: "12", diaChi: "114 Hoàng Diệu, Đà Nẵng" }, {})).toMatchObject({ ok: false, ma: "DU_LIEU_SAI" });
    expect(await donNay()).toEqual(truoc);
  });
});
