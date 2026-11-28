// Ca [ENG-DC-*] — ĐỐI CHIẾU BÓNG: nghĩa vụ do engine dẫn xuất ↔ hàng chờ hoá đơn đang sống (`dungDongHangCho`), trên
// fixture hình dạng thật: đơn nhiều con · thu trước · hoàn một phần (trước/sau khi xuất) · tách · chuyển nội bộ · tiền mặt ·
// đợt PARTIAL · tiền thừa · đơn huỷ · đủ bốn trạng thái hoá đơn · nghi trùng · loại khoản mơ hồ · thiếu cơ sở.
//
// Mục tiêu: trùng 100% ở ca thường; ca KHÔNG thể trùng thì báo ĐÚNG mã lý do (`khacCoChuDich`), không ép khớp, không giấu.
// Phần cuối chứng minh bộ so SÁNH cắn: sửa tay một bên ⇒ đúng loại chênh lệch.
import { describe, expect, it } from "vitest";
import { LY_DO_DA_XUAT_NGOAI, LY_DO_KHACH_KHONG_LAY } from "../ly-do-khong-xuat";
import { doiChieuBong, NGAN_SANG_TRANG_THAI } from "./doi-chieu-bong";
import {
  chay,
  dongDonKhoaHoc,
  don,
  gatewayMarker,
  giaoDich,
  hoaDon,
  installmentMarker,
  khoan,
  phanBo,
  phieu,
  tienMat,
  type KichBan,
} from "./du-lieu-mau.testdata";

const ngan = (k: KichBan) =>
  chay(k)
    .hangCho.dong.map((d) => d.ngan)
    .sort();
const mong = (k: KichBan, nganMong: string[]) => expect(ngan(k)).toEqual(nganMong.sort()); // fixture phải THẬT SỰ ra ngăn ta nói

// Trạng thái kế toán đã xác nhận — hằng, không gõ literal (lưới `truc-a` [BUOC-6] quét cả tệp test).
const DA_XAC_NHAN = "CONFIRMED";

// ── Các kịch bản ──────────────────────────────────────────────────────────

/** Một lần chuyển khoản 13.464.000 trả cho HAI bé (8.976.000 + 4.488.000), mỗi bé một phiếu đợt 1 riêng. */
const donNhieuCon = (): KichBan => ({
  don: don({
    payments: [
      khoan({ id: "pa", amount: 8_976_000, orderItemId: "i-a", note: gatewayMarker("SEPAY", "FT-NHIEU") }),
      khoan({ id: "pb", amount: 4_488_000, orderItemId: "i-b", note: gatewayMarker("SEPAY", "FT-NHIEU") }),
    ],
    paymentRequests: [
      phieu({ id: "dot-a", orderItemId: "i-a", installmentNo: 1, amountDue: 8_976_000, status: "PAID", allocations: [phanBo("bt1", "dot-a", 8_976_000)] }),
      phieu({ id: "dot-b", orderItemId: "i-b", installmentNo: 1, amountDue: 4_488_000, status: "PAID", allocations: [phanBo("bt1", "dot-b", 4_488_000)] }),
    ],
  }),
  dongDon: [dongDonKhoaHoc("i-a"), dongDonKhoaHoc("i-b")],
  giaoDich: [giaoDich("bt1", "FT-NHIEU", 13_464_000)],
});

/** Thu trước 3.000.000 trên đơn 10.400.000: đợt 1 đã rót đủ, đợt 2 chưa. */
const thuTruoc = (): KichBan => ({
  don: don({
    payments: [khoan({ id: "p-coc", amount: 3_000_000 })],
    paymentRequests: [
      phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "PAID", allocations: [phanBo("bt1", "dot1", 3_000_000)] }),
      phieu({ id: "dot2", installmentNo: 2, amountDue: 7_400_000 }),
    ],
  }),
  giaoDich: [giaoDich("bt1", "FT1", 3_000_000)],
  thuTruoc: ["p-coc"],
});

const hoanChuaXuat = (): KichBan => ({
  don: don({
    payments: [
      tienMat({ id: "goc", amount: 6_000_000 }),
      tienMat({ id: "hoan", amount: -1_000_017, accountantStatus: "REFUNDED", adjustmentOfId: "goc", createdAt: new Date("2026-09-20T03:00:00Z") }),
    ],
  }),
});

const HD_XN = () => hoaDon({ id: "hd1", trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2026-09-12T05:00:00Z"), khoan: [{ paymentId: "goc", soTien: 6_000_000 }] });
const hoanSauXuat = (): KichBan => ({
  don: don({
    payments: [
      tienMat({ id: "goc", amount: 6_000_000 }),
      tienMat({ id: "hoan", amount: -1_234_567, accountantStatus: "REFUNDED", adjustmentOfId: "goc", createdAt: new Date("2026-09-20T03:00:00Z") }),
    ],
    hoaDonDienTu: [HD_XN()],
  }),
});

/**
 * Một lần chuyển khoản 9.530.000 (SEPAY FT-TACH) được TÁCH cho hai bé — ĐÚNG hình dạng `tachKhoanChoCon`
 * (lib/finance/ghi-tien-don.ts): gốc giữ nguyên · dòng đảo ADJUSTMENT trỏ `adjustmentOfId` gốc, không gắn bé, note
 * "Đảo để tách … [tach:<gốc>]" (KHÔNG chép marker ngân hàng) · hai dòng tách chép method/note gốc rồi nối `[tach:<gốc>]`,
 * mỗi dòng một `orderItemId`. Mỗi bé có phiếu đợt 1 riêng đã được rót.
 */
const tach = (): KichBan => ({
  don: don({
    payments: [
      khoan({ id: "goc", amount: 9_530_000, note: gatewayMarker("SEPAY", "FT-TACH") }),
      khoan({ id: "dao", amount: -9_530_000, paymentType: "ADJUSTMENT", adjustmentOfId: "goc", note: "Đảo để tách khoản cho 2 bé [tach:goc]", enrollmentId: "enr1" }),
      khoan({ id: "tach1", amount: 5_000_000, orderItemId: "i-a", note: `${gatewayMarker("SEPAY", "FT-TACH")} [tach:goc]` }),
      khoan({ id: "tach2", amount: 4_530_000, orderItemId: "i-b", note: `${gatewayMarker("SEPAY", "FT-TACH")} [tach:goc]` }),
    ],
    paymentRequests: [
      phieu({ id: "dot-a", orderItemId: "i-a", installmentNo: 1, amountDue: 5_000_000, status: "PAID", allocations: [phanBo("bt-tach", "dot-a", 5_000_000)] }),
      phieu({ id: "dot-b", orderItemId: "i-b", installmentNo: 1, amountDue: 4_530_000, status: "PAID", allocations: [phanBo("bt-tach", "dot-b", 4_530_000)] }),
    ],
  }),
  dongDon: [dongDonKhoaHoc("i-a"), dongDonKhoaHoc("i-b")],
  giaoDich: [giaoDich("bt-tach", "FT-TACH", 9_530_000)],
});

/**
 * Chuyển 2.345.678 từ bé A sang bé B — ĐÚNG hình dạng `chuyenTienGiuaCacBe`: dòng −X (ADJUSTMENT, method `chuyen-noi-bo`,
 * đã xác nhận, gắn bé CHO, KHÔNG `adjustmentOfId`) + dòng +X (PAYMENT, `chuyen-noi-bo`, gắn bé NHẬN), cùng marker `[chuyen:…]`.
 * Gốc của bé cho KHÔNG bị bớt số ròng — chuyển nội bộ không phải tiền mới và cũng không đảo gốc.
 */
const chuyenNoiBo = (): KichBan => ({
  don: don({
    payments: [
      tienMat({ id: "goc", amount: 5_000_000, orderItemId: "i-a" }),
      tienMat({ id: "chuyen-am", amount: -2_345_678, paymentType: "ADJUSTMENT", orderItemId: "i-a", method: "chuyen-noi-bo", accountantStatus: DA_XAC_NHAN, note: "Chuyển cho bé khác cùng đơn — nhập nhầm bé [chuyen:i-a]" }),
      tienMat({ id: "chuyen-duong", amount: 2_345_678, orderItemId: "i-b", method: "chuyen-noi-bo", accountantStatus: DA_XAC_NHAN, note: "Nhận từ bé khác cùng đơn — nhập nhầm bé [chuyen:i-a]" }),
    ],
  }),
  dongDon: [dongDonKhoaHoc("i-a"), dongDonKhoaHoc("i-b")],
});

/** Khách giữ tờ hoá đơn xuất ở MISA (KHONG_XUAT "Đã xuất ngoài hệ thống") rồi được hoàn 1.234.567 SAU lúc đánh dấu. */
const xuatNgoaiHoanSau = (): KichBan => ({
  don: don({
    payments: [
      tienMat({ id: "goc", amount: 6_000_000 }),
      tienMat({ id: "hoan", amount: -1_234_567, accountantStatus: "REFUNDED", adjustmentOfId: "goc", createdAt: new Date("2026-09-20T03:00:00Z") }),
    ],
    hoaDonDienTu: [
      hoaDon({ id: "hd-ngoai", trangThai: "KHONG_XUAT", lyDo: LY_DO_DA_XUAT_NGOAI, xacNhanLuc: null, createdAt: new Date("2026-09-12T04:00:00Z"), khoan: [{ paymentId: "goc", soTien: 6_000_000 }] }),
    ],
  }),
});

/** Đợt 1 = 3.000.000: 1.000.000 tiền mặt + 2.000.000 chuyển khoản. Phiếu nằm PARTIAL vì tiền mặt không sinh phân bổ. */
const tienMatVaDotPartial = (): KichBan => ({
  don: don({
    payments: [tienMat({ id: "tm", amount: 1_000_000 }), khoan({ id: "ck", amount: 2_000_000 })],
    paymentRequests: [
      phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "PARTIAL", allocations: [phanBo("bt1", "dot1", 2_000_000)] }),
      phieu({ id: "dot2", installmentNo: 2, amountDue: 3_000_000 }),
    ],
  }),
  giaoDich: [giaoDich("bt1", "FT1", 2_000_000)],
});

const tienThua = (): KichBan => ({
  don: don({
    payments: [khoan({ id: "ck", amount: 5_500_000 })],
    paymentRequests: [phieu({ id: "dot1", installmentNo: 1, amountDue: 5_000_000, status: "PAID", allocations: [phanBo("bt1", "dot1", 5_000_000)] })],
  }),
  giaoDich: [giaoDich("bt1", "FT1", 5_500_000)],
});

const donHuy = (): KichBan => ({
  don: don({
    status: "CANCELLED",
    payments: [tienMat({ id: "p1", amount: 4_444_444 })],
  }),
});

const dotHuy = (): KichBan => ({
  don: don({
    payments: [khoan({ id: "ck", amount: 3_000_000 })],
    paymentRequests: [phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "VOID", allocations: [phanBo("bt1", "dot1", 3_000_000)] })],
  }),
  giaoDich: [giaoDich("bt1", "FT1", 3_000_000)],
});

const bonTrangThaiHoaDon = (): KichBan => ({
  don: don({
    payments: ["nhap", "xn", "kx", "dph", "loi"].map((id, i) => tienMat({ id, amount: 1_000_003 + i * 17 })),
    hoaDonDienTu: [
      hoaDon({ id: "hd-nhap", trangThai: "NHAP", khoan: [{ paymentId: "nhap", soTien: 1_000_003 }] }),
      hoaDon({ id: "hd-xn", trangThai: "DA_XAC_NHAN", khoan: [{ paymentId: "xn", soTien: 1_000_020 }] }),
      hoaDon({ id: "hd-kx", trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn", khoan: [{ paymentId: "kx", soTien: 1_000_037 }] }),
      hoaDon({ id: "hd-dph", trangThai: "DANG_PHAT_HANH", nguonPhatHanh: "MISA_API", khoan: [{ paymentId: "dph", soTien: 1_000_054 }] }),
      hoaDon({ id: "hd-loi", trangThai: "LOI_PHAT_HANH", nguonPhatHanh: "MISA_API", misaLoiMa: "E1", khoan: [{ paymentId: "loi", soTien: 1_000_071 }] }),
    ],
  }),
});

const nghiTrung = (): KichBan => ({
  don: don({
    payments: [tienMat({ id: "khai", amount: 3_000_000, note: installmentMarker(1) }), khoan({ id: "ck", amount: 3_000_000, note: gatewayMarker("SEPAY", "FT2") })],
    paymentRequests: [phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "PAID", allocations: [phanBo("bt2", "dot1", 3_000_000)] })],
  }),
  giaoDich: [giaoDich("bt2", "FT2", 3_000_000)],
});

const loaiMoHo = (): KichBan => ({
  don: don({ payments: [tienMat({ id: "p1", amount: 2_468_013 })] }),
  dongDon: [dongDonKhoaHoc("i-hp"), dongDonKhoaHoc("i-kit", { type: "PRODUCT" })],
});

const thieuCoSo = (): KichBan => ({ don: don({ centerId: null, center: null, payments: [tienMat({ id: "a" }), tienMat({ id: "b", amount: 1_234_567 })] }) });

const khongLayHoaDonHoanSau = (): KichBan => {
  const k = xuatNgoaiHoanSau();
  return { ...k, don: { ...k.don, hoaDonDienTu: [{ ...k.don.hoaDonDienTu[0]!, lyDo: LY_DO_KHACH_KHONG_LAY }] } };
};

const huyHoaDonSauXuat = (): KichBan => ({
  don: don({
    status: "CANCELLED",
    payments: [tienMat({ id: "goc", amount: 6_000_000 })],
    hoaDonDienTu: [HD_XN()],
  }),
});

// ── Ca trùng 100% ─────────────────────────────────────────────────────────

describe("[ENG-DC-01] trùng 100% trên các ca thường", () => {
  const CA: [string, KichBan, string[], number][] = [
    ["đơn nhiều con (một CK trả hai bé)", donNhieuCon(), ["cho", "cho"], 2],
    ["thu trước, NHU_HOC_PHI (hành vi hiện tại)", thuTruoc(), ["cho"], 1],
    ["hoàn một phần khi khoản gốc CHƯA xuất", hoanChuaXuat(), ["cho"], 1],
    ["tách khoản (gốc bị đảo hết + hai khoản tách)", tach(), ["cho", "cho"], 2],
    ["chuyển nội bộ giữa hai bé", chuyenNoiBo(), ["cho"], 1],
    ["tiền mặt + đợt PARTIAL (thiếu) — hai lần thu khác ngăn", tienMatVaDotPartial(), ["cho", "lech"], 2],
    ["đơn huỷ", donHuy(), ["don-huy"], 1],
    ["đợt huỷ (VOID) có tiền rót vào", dotHuy(), ["don-huy"], 1],
    ["bốn trạng thái hoá đơn (nháp · đã xuất · không xuất · đang/lỗi phát hành)", bonTrangThaiHoaDon(), ["da-xuat", "khong-xuat", "nhap", "phat-hanh", "phat-hanh"], 5],
    ["nghi trùng (lời khai tay + chuyển khoản cùng đơn)", nghiTrung(), ["cho", "lech"], 2],
    ["thiếu cơ sở", thieuCoSo(), [], 0],
    ["KHONG_XUAT \"Khách không lấy hoá đơn\" rồi hoàn sau: không có tờ nào để điều chỉnh ⇒ vẫn ngăn không-xuất", khongLayHoaDonHoanSau(), ["khong-xuat"], 1],
  ];
  it.each(CA)("%s", (_ten, kb, nganMong, soKhop) => {
    mong(kb, nganMong); // fixture ra đúng ngăn
    const { baoCao } = chay(kb);
    expect(baoCao.chenhLech).toEqual([]);
    expect(baoCao.khacCoChuDich).toEqual([]);
    expect(baoCao.trungHoanToan).toBe(true);
    expect(baoCao.soKhop).toBe(soKhop);
  });

  it("đơn nhiều con: engine thấy hai nghĩa vụ THU_TIEN đúng số từng bé; thu trước mang loại THU_TRUOC", () => {
    expect(chay(donNhieuCon()).engine.nghiaVu.map((n) => [n.khoa, n.loai, n.soTien, n.orderItemId])).toEqual([
      ["PAYMENT:pa", "THU_TIEN", 8_976_000, "i-a"],
      ["PAYMENT:pb", "THU_TIEN", 4_488_000, "i-b"],
    ]);
    expect(chay(thuTruoc()).engine.nghiaVu[0]).toMatchObject({ khoa: "PAYMENT:p-coc", loai: "THU_TRUOC", trangThai: "CHO_XUAT" });
  });
  it("thiếu cơ sở: hàng chờ đếm 2 khoản, engine liệt 2 khoản vào 'không sinh' với lý do THIEU_CO_SO", () => {
    const { hangCho, engine } = chay(thieuCoSo());
    expect(hangCho.thieuCoSo).toBe(2);
    expect(engine.thieuCoSo).toBe(2);
    expect(engine.nghiaVu).toEqual([]);
  });
});

// ── Ca KHÔNG thể trùng — báo đúng mã lý do ────────────────────────────────

describe("[ENG-DC-02] ca KHÔNG thể trùng: ghi rõ lý do, không ép khớp", () => {
  it("thu trước + CHO_QUYET (OD-03): engine siết hơn ⇒ ENGINE_SIET_HON/THU_TRUOC_CHO_QUYET, không phải chênh lệch", () => {
    const { baoCao } = chay({ ...thuTruoc(), chinhSachThuTruoc: "CHO_QUYET" });
    expect(baoCao.chenhLech).toEqual([]);
    expect(baoCao.khacCoChuDich).toEqual([expect.objectContaining({ ma: "ENGINE_SIET_HON", lyDo: "THU_TRUOC_CHO_QUYET", khoa: "PAYMENT:p-coc" })]);
    expect(baoCao.trungHoanToan).toBe(false);
  });
  it("tiền thừa: hàng chờ cho xuất (DU), engine chờ người quyết phần dư", () => {
    mong(tienThua(), ["cho"]);
    const { baoCao } = chay(tienThua());
    expect(baoCao.chenhLech).toEqual([]);
    expect(baoCao.khacCoChuDich).toEqual([expect.objectContaining({ ma: "ENGINE_SIET_HON", lyDo: "TIEN_THUA" })]);
  });
  it("loại khoản mơ hồ (đơn vừa khoá học vừa học cụ, khoản không trỏ dòng nào): engine không đoán", () => {
    mong(loaiMoHo(), ["cho"]);
    const { baoCao } = chay(loaiMoHo());
    expect(baoCao.chenhLech).toEqual([]);
    expect(baoCao.khacCoChuDich).toEqual([expect.objectContaining({ ma: "ENGINE_SIET_HON", lyDo: "LOAI_KHOAN_MO_HO" })]);
  });
  it("hoàn một phần SAU khi xuất: hàng chờ bật nhãn 'Cần điều chỉnh' trên khoản gốc; engine có nghĩa vụ DIEU_CHINH_GIAM riêng", () => {
    mong(hoanSauXuat(), ["can-dieu-chinh"]);
    const { baoCao, engine } = chay(hoanSauXuat());
    expect(engine.nghiaVu.map((n) => [n.khoa, n.loai, n.trangThai, n.soTien])).toEqual([
      ["PAYMENT:goc", "THU_TIEN", "DA_XUAT", 4_765_433],
      ["PAYMENT:hoan", "DIEU_CHINH_GIAM", "CHO_QUYET", 1_234_567],
    ]);
    expect(baoCao.chenhLech).toEqual([]);
    expect(baoCao.soKhop).toBe(1);
    expect(baoCao.khacCoChuDich).toEqual([expect.objectContaining({ ma: "DIEU_CHINH_GIAM_KHONG_CO_DONG_RIENG", khoa: "PAYMENT:hoan" })]);
  });
  it("hoàn SAU khi đánh dấu 'Đã xuất ngoài hệ thống': hàng chờ bật 'Cần điều chỉnh', khoản vẫn là KHONG_XUAT, engine có DIEU_CHINH_GIAM (khách CÓ tờ hoá đơn ở MISA)", () => {
    mong(xuatNgoaiHoanSau(), ["can-dieu-chinh"]);
    const { baoCao, engine, hangCho } = chay(xuatNgoaiHoanSau());
    expect(hangCho.dong[0]!.hoaDon?.trangThai).toBe("KHONG_XUAT");
    expect(engine.nghiaVu.map((n) => [n.khoa, n.loai, n.trangThai, n.soTien])).toEqual([
      ["PAYMENT:goc", "THU_TIEN", "KHONG_XUAT", 4_765_433],
      ["PAYMENT:hoan", "DIEU_CHINH_GIAM", "CHO_QUYET", 1_234_567],
    ]);
    expect(baoCao.chenhLech).toEqual([]); // ánh xạ "can-dieu-chinh ⇒ DA_XUAT" vô điều kiện sẽ báo oan ở đây
    expect(baoCao.soKhop).toBe(1);
    expect(baoCao.khacCoChuDich).toEqual([expect.objectContaining({ ma: "DIEU_CHINH_GIAM_KHONG_CO_DONG_RIENG", khoa: "PAYMENT:hoan" })]);
  });
  it("đơn huỷ SAU khi xuất: hàng chờ 'Cần điều chỉnh' vì nguyên nhân engine chưa sinh nghĩa vụ ⇒ CAN_DIEU_CHINH_NGUYEN_NHAN_KHAC", () => {
    mong(huyHoaDonSauXuat(), ["can-dieu-chinh"]);
    const { baoCao } = chay(huyHoaDonSauXuat());
    expect(baoCao.chenhLech).toEqual([]);
    expect(baoCao.khacCoChuDich).toEqual([expect.objectContaining({ ma: "CAN_DIEU_CHINH_NGUYEN_NHAN_KHAC", lyDo: expect.stringMatching(/huỷ/) })]);
  });
});

// ── Bộ so sánh CẮN ────────────────────────────────────────────────────────

describe("[ENG-DC-03] bộ so sánh cắn: sửa tay một bên ⇒ đúng loại chênh lệch", () => {
  const goc = () => chay(donNhieuCon());
  const loai = (b: ReturnType<typeof doiChieuBong>) => b.chenhLech.map((c) => [c.loai, c.khoa]);

  it("nền: trùng hoàn toàn", () => {
    expect(goc().baoCao.trungHoanToan).toBe(true);
  });
  it("engine THIẾU một khoản hàng chờ có ⇒ THIEU_O_NGHIA_VU (kèm lý do 'không sinh' nếu có)", () => {
    const { engine, hangCho } = goc();
    const b = doiChieuBong({ engine: { ...engine, nghiaVu: engine.nghiaVu.filter((n) => n.khoa !== "PAYMENT:pb"), khongSinh: [{ paymentId: "pb", lyDo: "KE_TOAN_TU_CHOI" }] }, hangCho });
    expect(loai(b)).toEqual([["THIEU_O_NGHIA_VU", "PAYMENT:pb"]]);
    expect(b.chenhLech[0]!.thongDiep).toMatch(/KE_TOAN_TU_CHOI/);
  });
  it("engine THỪA một nghĩa vụ hàng chờ không có ⇒ THUA_O_NGHIA_VU", () => {
    const { engine, hangCho } = goc();
    const them = { ...engine.nghiaVu[0]!, khoa: "PAYMENT:ma", nguon: { loai: "PAYMENT" as const, paymentId: "ma" } };
    expect(loai(doiChieuBong({ engine: { ...engine, nghiaVu: [...engine.nghiaVu, them] }, hangCho }))).toEqual([["THUA_O_NGHIA_VU", "PAYMENT:ma"]]);
  });
  it("lệch 1 đồng ⇒ KHAC_SO_TIEN", () => {
    const { engine, hangCho } = goc();
    const nv = engine.nghiaVu.map((n) => (n.khoa === "PAYMENT:pa" ? { ...n, soTien: n.soTien + 1 } : n));
    expect(loai(doiChieuBong({ engine: { ...engine, nghiaVu: nv }, hangCho }))).toEqual([["KHAC_SO_TIEN", "PAYMENT:pa"]]);
  });
  it("lệch trạng thái ⇒ KHAC_TRANG_THAI", () => {
    const { engine, hangCho } = goc();
    const nv = engine.nghiaVu.map((n) => (n.khoa === "PAYMENT:pa" ? { ...n, trangThai: "DA_XUAT" as const } : n));
    expect(loai(doiChieuBong({ engine: { ...engine, nghiaVu: nv }, hangCho }))).toEqual([["KHAC_TRANG_THAI", "PAYMENT:pa"]]);
  });
  it("CHO_QUYET vì lý do KHÔNG nằm trong danh sách 'siết hơn có chủ ý' trên ngăn cho ⇒ vẫn là chênh lệch", () => {
    const { engine, hangCho } = goc();
    const nv = engine.nghiaVu.map((n) => (n.khoa === "PAYMENT:pa" ? { ...n, trangThai: "CHO_QUYET" as const, lyDoChoQuyet: "NGHI_TRUNG" as const } : n));
    expect(loai(doiChieuBong({ engine: { ...engine, nghiaVu: nv }, hangCho }))).toEqual([["KHAC_TRANG_THAI", "PAYMENT:pa"]]);
  });
  it("lệch số khoản thiếu cơ sở ⇒ KHAC_THIEU_CO_SO", () => {
    const { engine, hangCho } = goc();
    expect(loai(doiChieuBong({ engine, hangCho: { ...hangCho, thieuCoSo: 3 } }))).toEqual([["KHAC_THIEU_CO_SO", "THIEU_CO_SO"]]);
  });
  it("engine có điều chỉnh giảm nhưng hàng chờ KHÔNG bật 'Cần điều chỉnh' trên khoản gốc ⇒ DIEU_CHINH_KHONG_CO_CO", () => {
    const { engine, hangCho } = chay(hoanSauXuat());
    const dong = hangCho.dong.map((d) => ({ ...d, ngan: "da-xuat" as const }));
    const b = doiChieuBong({ engine, hangCho: { ...hangCho, dong } });
    expect(loai(b)).toEqual([["DIEU_CHINH_KHONG_CO_CO", "PAYMENT:hoan"]]);
  });
  it("khoản xuất hiện ở hai dòng hàng chờ ⇒ cảnh báo, giữ dòng đầu", () => {
    const { engine, hangCho } = goc();
    const [d0] = hangCho.dong;
    const b = doiChieuBong({ engine, hangCho: { ...hangCho, dong: [d0!, { ...d0!, key: "dot:trung" }] } });
    expect(b.canhBao).toHaveLength(d0!.khoan.length);
  });
  it("nghĩa vụ BILLING: đếm riêng, không so (hàng chờ không có khái niệm này)", () => {
    const { engine, hangCho } = goc();
    const billing = { ...engine.nghiaVu[0]!, khoa: "BILLING:i-a", nguon: { loai: "BILLING" as const, orderItemId: "i-a" } };
    const b = doiChieuBong({ engine: { ...engine, nghiaVu: [...engine.nghiaVu, billing] }, hangCho });
    expect(b.soNghiaVuTheoDong).toBe(1);
    expect(b.chenhLech).toEqual([]);
  });
});

describe("[ENG-DC-04] bảng ngăn → trạng thái phủ MỌI ngăn của hàng chờ", () => {
  it("đúng 8 ngăn, trạng thái hợp lệ", () => {
    expect(Object.keys(NGAN_SANG_TRANG_THAI).sort()).toEqual(["can-dieu-chinh", "cho", "da-xuat", "don-huy", "khong-xuat", "lech", "nhap", "phat-hanh"]);
    expect(new Set(Object.values(NGAN_SANG_TRANG_THAI))).toEqual(new Set(["CHO_XUAT", "CHO_QUYET", "DANG_XU_LY", "DA_XUAT", "KHONG_XUAT"]));
  });
});

describe("[ENG-DC-05] 'engine siết hơn' CHỈ được tha ở ngăn `cho` — ở ngăn khác là chênh lệch THẬT, không bị nuốt thành khác-có-chủ-đích", () => {
  const LY_DO_SIET = ["TIEN_THUA", "LOAI_KHOAN_MO_HO", "THU_TRUOC_CHO_QUYET"] as const;
  /** Engine nói khoản `pa` CHO_QUYET vì `lyDo`; hàng chờ đặt dòng chứa `pa` ở ngăn `ngan`. Các khoản/dòng khác giữ nguyên (đã khớp). */
  const lech = (lyDo: (typeof LY_DO_SIET)[number], nganCuaPa: "cho" | "nhap" | "phat-hanh" | "da-xuat" | "khong-xuat") => {
    const { engine, hangCho } = chay(donNhieuCon());
    const nv = engine.nghiaVu.map((n) => (n.khoa === "PAYMENT:pa" ? { ...n, trangThai: "CHO_QUYET" as const, lyDoChoQuyet: lyDo } : n));
    const dong = hangCho.dong.map((d) => (d.khoan.some((k) => k.id === "pa") ? { ...d, ngan: nganCuaPa } : d));
    return doiChieuBong({ engine: { ...engine, nghiaVu: nv }, hangCho: { ...hangCho, dong } });
  };

  it.each(LY_DO_SIET)("đối chứng DƯƠNG: %s ở ngăn `cho` ⇒ khác-có-chủ-đích ENGINE_SIET_HON, KHÔNG phải chênh lệch", (lyDo) => {
    const b = lech(lyDo, "cho");
    expect(b.chenhLech).toEqual([]);
    expect(b.khacCoChuDich).toEqual([expect.objectContaining({ ma: "ENGINE_SIET_HON", khoa: "PAYMENT:pa", lyDo })]);
  });
  const NGAN_KHAC = ["nhap", "phat-hanh", "da-xuat", "khong-xuat"] as const;
  describe.each(LY_DO_SIET)("lý do siết %s", (lyDo) => {
    it.each(NGAN_KHAC)("hàng chờ đặt khoản ở ngăn `%s` ⇒ KHAC_TRANG_THAI (một chênh lệch thật), không có khác-có-chủ-đích", (ngan) => {
      const b = lech(lyDo, ngan);
      expect(b.chenhLech.map((c) => [c.loai, c.khoa])).toEqual([["KHAC_TRANG_THAI", "PAYMENT:pa"]]);
      expect(b.khacCoChuDich).toEqual([]);
      expect(b.trungHoanToan).toBe(false);
    });
  });
});
