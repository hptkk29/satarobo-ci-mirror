// Ca [ENG-PL-*] — phân loại nghĩa vụ hoá đơn từ dữ liệu SẴN CÓ (engine S3, shadow; audit 02 §9.1).
//
// Luật cần khoá: (1) số tiền = số RÒNG của `Payment`, không bao giờ từ phiếu thu; (2) không đoán loại — mơ hồ ⇒ CHO_QUYET;
// (3) THU_TRUOC chỉ đến từ tín hiệu truyền vào; (4) chuyển nội bộ / lịch sử / từ chối / xoá / đảo hết KHÔNG sinh nghĩa vụ;
// (5) điều chỉnh giảm chỉ khi khoản gốc nằm trong hoá đơn ĐÃ XÁC NHẬN và dòng âm tạo SAU lúc xác nhận; (6) sourceHash ổn định.
import { describe, expect, it } from "vitest";
import { BACKFILL_PAYMENT_MARKER } from "@/lib/finance/payment-markers";
import { LY_DO_DA_XUAT_NGOAI, LY_DO_KHACH_KHONG_LAY, TIEN_TO_LY_DO_KHAC } from "../ly-do-khong-xuat";
import {
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
} from "./du-lieu-mau.testdata";
import { docKhoaNguon, khoaBilling, khoaPayment, phanLoaiNghiaVu, type DauVaoPhanLoai, type NghiaVu } from "./phan-loai-nghia-vu";

type Cho = Partial<Omit<DauVaoPhanLoai, "don">> & { don: DauVaoPhanLoai["don"] };
const pl = (k: Cho) =>
  phanLoaiNghiaVu({
    dongDon: [],
    giaoDich: [],
    giaoDichChuaKhop: [],
    thuTruocPaymentIds: new Set<string>(),
    chinhSachThuTruoc: "NHU_HOC_PHI",
    cheDo: "THEO_KHOAN_THU",
    ...k,
  });
const theoKhoa = (nv: readonly NghiaVu[], id: string) => nv.find((n) => n.khoa === khoaPayment(id));

describe("[ENG-PL-01] khoá nguồn PAYMENT:<id> / BILLING:<orderItemId>", () => {
  it("dựng và đọc ngược", () => {
    expect(khoaPayment("pay-1")).toBe("PAYMENT:pay-1");
    expect(khoaBilling("it-1")).toBe("BILLING:it-1");
    expect(docKhoaNguon("PAYMENT:pay-1")).toEqual({ loai: "PAYMENT", paymentId: "pay-1" });
    expect(docKhoaNguon("BILLING:it:có:hai:chấm")).toEqual({ loai: "BILLING", orderItemId: "it:có:hai:chấm" });
    expect(docKhoaNguon("RECEIPT:x")).toBeNull();
    expect(docKhoaNguon("PAYMENT:")).toBeNull();
  });
});

describe("[ENG-PL-02] loại khoản theo DÒNG ĐƠN mà khoản trỏ tới", () => {
  const dongDon = [
    dongDonKhoaHoc("i-hp"),
    dongDonKhoaHoc("i-goi", { type: "COURSE_PACKAGE" }),
    dongDonKhoaHoc("i-kit", { type: "PRODUCT" }),
    dongDonKhoaHoc("i-thi", { type: "EXAM_REGISTRATION" }),
    dongDonKhoaHoc("i-bu", { type: "MAKEUP_FEE" }),
  ];
  const payments = [
    tienMat({ id: "p-hp", amount: 8_976_000, orderItemId: "i-hp" }),
    tienMat({ id: "p-goi", amount: 3_333_333, orderItemId: "i-goi" }),
    tienMat({ id: "p-kit", amount: 1_851_851, orderItemId: "i-kit" }),
    tienMat({ id: "p-thi", amount: 333_333, orderItemId: "i-thi" }),
    tienMat({ id: "p-bu", amount: 77_777, orderItemId: "i-bu" }),
  ];
  it("COURSE_ENROLLMENT/PACKAGE ⇒ THU_TIEN · PRODUCT ⇒ THU_HOC_CU · EXAM ⇒ THU_LE_PHI_THI · MAKEUP_FEE ⇒ THU_PHI_HOC_BU", () => {
    const { nghiaVu } = pl({ don: don({ payments }), dongDon });
    expect(nghiaVu.map((n) => [n.khoa, n.loai, n.soTien, n.trangThai])).toEqual([
      ["PAYMENT:p-bu", "THU_PHI_HOC_BU", 77_777, "CHO_XUAT"],
      ["PAYMENT:p-goi", "THU_TIEN", 3_333_333, "CHO_XUAT"],
      ["PAYMENT:p-hp", "THU_TIEN", 8_976_000, "CHO_XUAT"],
      ["PAYMENT:p-kit", "THU_HOC_CU", 1_851_851, "CHO_XUAT"],
      ["PAYMENT:p-thi", "THU_LE_PHI_THI", 333_333, "CHO_XUAT"],
    ]);
  });
  it("mang đủ ngữ cảnh: đơn · cơ sở · dòng đơn", () => {
    const n = theoKhoa(pl({ don: don({ payments }), dongDon }).nghiaVu, "p-kit")!;
    expect(n).toMatchObject({ orderId: "don-an-01", maDon: "ORD-260910-000001", centerId: "cs1", orderItemId: "i-kit", nguon: { loai: "PAYMENT", paymentId: "p-kit" }, hoaDonId: null, khoanGocId: null, lyDoChoQuyet: null });
  });
});

describe("[ENG-PL-03] khoản KHÔNG trỏ dòng đơn: suy theo cả đơn CHỈ khi không mơ hồ", () => {
  const p = [tienMat({ id: "p1", amount: 2_468_013 })];
  it.each([
    ["COURSE", "THU_TIEN"],
    ["PACKAGE", "THU_TIEN"],
    ["PRODUCT", "THU_HOC_CU"],
    ["EXAM", "THU_LE_PHI_THI"],
  ])("không có dòng đơn, loại đơn %s ⇒ %s", (type, loai) => {
    expect(theoKhoa(pl({ don: don({ type, payments: p }) }).nghiaVu, "p1")).toMatchObject({ loai, trangThai: "CHO_XUAT" });
  });
  it("loại đơn COMBO (gói gộp chưa tách) ⇒ CHUA_PHAN_LOAI + CHO_QUYET, không bịa", () => {
    expect(theoKhoa(pl({ don: don({ type: "COMBO", payments: p }) }).nghiaVu, "p1")).toMatchObject({ loai: "CHUA_PHAN_LOAI", trangThai: "CHO_QUYET", lyDoChoQuyet: "LOAI_KHOAN_MO_HO" });
  });
  it("mọi dòng đơn cùng một loại ⇒ suy được dù khoản không trỏ dòng nào", () => {
    const r = pl({ don: don({ payments: p }), dongDon: [dongDonKhoaHoc("a"), dongDonKhoaHoc("b", { type: "COURSE_PACKAGE" })] });
    expect(theoKhoa(r.nghiaVu, "p1")).toMatchObject({ loai: "THU_TIEN", trangThai: "CHO_XUAT" });
  });
  it("đơn có cả khoá học lẫn học cụ mà khoản không trỏ dòng nào ⇒ MƠ HỒ ⇒ CHO_QUYET", () => {
    const r = pl({ don: don({ payments: p }), dongDon: [dongDonKhoaHoc("a"), dongDonKhoaHoc("b", { type: "PRODUCT" })] });
    expect(theoKhoa(r.nghiaVu, "p1")).toMatchObject({ loai: "CHUA_PHAN_LOAI", trangThai: "CHO_QUYET", lyDoChoQuyet: "LOAI_KHOAN_MO_HO" });
  });
  it("trỏ tới dòng đơn KHÔNG có trong danh sách (dữ liệu lệch) ⇒ mơ hồ, không rơi về suy theo cả đơn", () => {
    const r = pl({ don: don({ type: "COURSE", payments: [tienMat({ id: "p1", orderItemId: "ma-khong-ton-tai" })] }), dongDon: [dongDonKhoaHoc("a")] });
    expect(theoKhoa(r.nghiaVu, "p1")).toMatchObject({ trangThai: "CHO_QUYET", lyDoChoQuyet: "LOAI_KHOAN_MO_HO" });
  });
  it("dòng đơn có type lạ ⇒ mơ hồ", () => {
    const r = pl({ don: don({ payments: [tienMat({ id: "p1", orderItemId: "a" })] }), dongDon: [dongDonKhoaHoc("a", { type: "LOAI_MOI_CHUA_BIET" })] });
    expect(theoKhoa(r.nghiaVu, "p1")).toMatchObject({ loai: "CHUA_PHAN_LOAI", trangThai: "CHO_QUYET" });
  });
});

describe("[ENG-PL-04] THU_TRUOC chỉ đến từ tín hiệu; bản chất pháp lý (OD-03) là THAM SỐ", () => {
  const d = don({
    payments: [khoan({ id: "p-coc", amount: 3_000_000 })],
    paymentRequests: [
      phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "PAID", allocations: [phanBo("bt1", "dot1", 3_000_000)] }),
      phieu({ id: "dot2", installmentNo: 2, amountDue: 7_400_000 }),
    ],
  });
  const gd = [giaoDich("bt1", "FT1", 3_000_000)];
  it("KHÔNG có tín hiệu ⇒ THU_TIEN (không suy từ hình dạng 2 đợt — đợt trả góp cũ cũng y hệt)", () => {
    expect(theoKhoa(pl({ don: d, giaoDich: gd }).nghiaVu, "p-coc")).toMatchObject({ loai: "THU_TIEN", trangThai: "CHO_XUAT" });
  });
  it("có tín hiệu + NHU_HOC_PHI (hành vi hiện tại) ⇒ THU_TRUOC nhưng vẫn CHO_XUAT", () => {
    const r = pl({ don: d, giaoDich: gd, thuTruocPaymentIds: new Set(["p-coc"]), chinhSachThuTruoc: "NHU_HOC_PHI" });
    expect(theoKhoa(r.nghiaVu, "p-coc")).toMatchObject({ loai: "THU_TRUOC", trangThai: "CHO_XUAT", lyDoChoQuyet: null });
  });
  it("có tín hiệu + CHO_QUYET ⇒ THU_TRUOC chờ người quyết", () => {
    const r = pl({ don: d, giaoDich: gd, thuTruocPaymentIds: new Set(["p-coc"]), chinhSachThuTruoc: "CHO_QUYET" });
    expect(theoKhoa(r.nghiaVu, "p-coc")).toMatchObject({ loai: "THU_TRUOC", trangThai: "CHO_QUYET", lyDoChoQuyet: "THU_TRUOC_CHO_QUYET" });
  });
  it("tín hiệu cho khoản KHÔNG phải học phí (học cụ) không đổi loại của nó", () => {
    const r = pl({ don: don({ type: "PRODUCT", payments: [tienMat({ id: "p-kit" })] }), thuTruocPaymentIds: new Set(["p-kit"]) });
    expect(theoKhoa(r.nghiaVu, "p-kit")!.loai).toBe("THU_HOC_CU");
  });
});

describe("[ENG-PL-05] khoản ĐÃ KHOÁ vào hoá đơn: trạng thái theo hoá đơn", () => {
  const ps = ["nhap", "xn", "kx", "dph", "loi", "la"].map((id, i) => tienMat({ id, amount: 1_000_003 + i * 17 }));
  const hds = [
    hoaDon({ id: "hd-nhap", trangThai: "NHAP", khoan: [{ paymentId: "nhap", soTien: 1_000_003 }] }),
    hoaDon({ id: "hd-xn", trangThai: "DA_XAC_NHAN", khoan: [{ paymentId: "xn", soTien: 1_000_020 }] }),
    hoaDon({ id: "hd-kx", trangThai: "KHONG_XUAT", khoan: [{ paymentId: "kx", soTien: 1_000_037 }] }),
    hoaDon({ id: "hd-dph", trangThai: "DANG_PHAT_HANH", khoan: [{ paymentId: "dph", soTien: 1_000_054 }] }),
    hoaDon({ id: "hd-loi", trangThai: "LOI_PHAT_HANH", khoan: [{ paymentId: "loi", soTien: 1_000_071 }] }),
    hoaDon({ id: "hd-la", trangThai: "TRANG_THAI_LA", khoan: [{ paymentId: "la", soTien: 1_000_088 }] }),
  ];
  it("NHAP/DANG_PHAT_HANH/LOI_PHAT_HANH ⇒ DANG_XU_LY · DA_XAC_NHAN ⇒ DA_XUAT · KHONG_XUAT ⇒ KHONG_XUAT · trạng thái lạ ⇒ CHO_QUYET", () => {
    const r = pl({ don: don({ payments: ps, hoaDonDienTu: hds }) });
    expect(r.nghiaVu.map((n) => [n.khoa, n.trangThai, n.hoaDonId])).toEqual([
      ["PAYMENT:dph", "DANG_XU_LY", "hd-dph"],
      ["PAYMENT:kx", "KHONG_XUAT", "hd-kx"],
      ["PAYMENT:la", "CHO_QUYET", "hd-la"],
      ["PAYMENT:loi", "DANG_XU_LY", "hd-loi"],
      ["PAYMENT:nhap", "DANG_XU_LY", "hd-nhap"],
      ["PAYMENT:xn", "DA_XUAT", "hd-xn"],
    ]);
  });
  it("khoản đã khoá KHÔNG qua phanLoaiKhoan — vẫn sinh nghĩa vụ kể cả khi đã đảo hết (giống hàng chờ: dòng hoá đơn giữ khoản)", () => {
    const r = pl({
      don: don({
        payments: [tienMat({ id: "g", amount: 5_000_000 }), tienMat({ id: "dao", amount: -5_000_000, paymentType: "ADJUSTMENT", adjustmentOfId: "g", createdAt: new Date("2026-08-01T00:00:00Z") })],
        hoaDonDienTu: [hoaDon({ id: "hd", khoan: [{ paymentId: "g", soTien: 5_000_000 }] })],
      }),
    });
    expect(theoKhoa(r.nghiaVu, "g")).toMatchObject({ trangThai: "DA_XUAT", soTien: 0 });
  });
});

describe("[ENG-PL-06] DIEU_CHINH_GIAM: dòng ÂM trỏ khoản gốc trong hoá đơn ĐÃ XÁC NHẬN, tạo SAU lúc xác nhận", () => {
  const goc = tienMat({ id: "goc", amount: 6_000_000 });
  const hdXN = hoaDon({ id: "hd1", trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2026-09-12T05:00:00Z"), khoan: [{ paymentId: "goc", soTien: 6_000_000 }] });
  const hoan = (o: Partial<ReturnType<typeof khoan>> = {}) =>
    khoan({ id: "hoan", amount: -1_234_567, accountantStatus: "REFUNDED", method: "CASH", note: null, adjustmentOfId: "goc", createdAt: new Date("2026-09-20T03:00:00Z"), ...o });

  it("hoàn sau xác nhận ⇒ nghĩa vụ điều chỉnh (độ lớn dương, chờ người quyết — OD-10) + khoản gốc DA_XUAT với số ròng", () => {
    const r = pl({ don: don({ payments: [goc, hoan()], hoaDonDienTu: [hdXN] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")).toMatchObject({ loai: "DIEU_CHINH_GIAM", soTien: 1_234_567, trangThai: "CHO_QUYET", lyDoChoQuyet: "DIEU_CHINH_CHUA_CHOT", khoanGocId: "goc", hoaDonId: "hd1" });
    expect(theoKhoa(r.nghiaVu, "goc")).toMatchObject({ trangThai: "DA_XUAT", soTien: 4_765_433 });
    expect(r.khongSinh).toEqual([]);
  });
  it("hoàn TRƯỚC lúc xác nhận ⇒ số ròng đã nằm trong hoá đơn, không cần điều chỉnh (dòng âm ⇒ không sinh)", () => {
    const r = pl({ don: don({ payments: [goc, hoan({ createdAt: new Date("2026-09-11T03:00:00Z") })], hoaDonDienTu: [hdXN] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")).toBeUndefined();
    expect(r.khongSinh).toEqual([{ paymentId: "hoan", lyDo: "SO_TIEN_AM" }]);
  });
  it.each([["NHAP"], ["DANG_PHAT_HANH"], ["KHONG_XUAT"]])("khoản gốc trong hoá đơn %s (chưa phải ĐÃ XÁC NHẬN) ⇒ không sinh điều chỉnh", (trangThai) => {
    const r = pl({ don: don({ payments: [goc, hoan()], hoaDonDienTu: [{ ...hdXN, trangThai }] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")).toBeUndefined();
  });
  it("dòng âm đã xoá mềm ⇒ không sinh", () => {
    const r = pl({ don: don({ payments: [goc, hoan({ deletedAt: new Date("2026-09-21T00:00:00Z") })], hoaDonDienTu: [hdXN] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")).toBeUndefined();
  });
  it("khoản gốc CHƯA vào hoá đơn nào ⇒ dòng âm chỉ bớt số ròng của gốc, không sinh điều chỉnh", () => {
    const r = pl({ don: don({ payments: [goc, hoan()] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")).toBeUndefined();
    expect(theoKhoa(r.nghiaVu, "goc")).toMatchObject({ soTien: 4_765_433, trangThai: "CHO_XUAT", loai: "THU_TIEN" });
  });
  it("hoá đơn xác nhận không có mốc `xacNhanLuc` ⇒ coi mọi dòng âm là SAU (thà báo thừa — cùng canDieuChinh)", () => {
    const r = pl({ don: don({ payments: [goc, hoan({ createdAt: new Date("2020-01-01T00:00:00Z") })], hoaDonDienTu: [{ ...hdXN, xacNhanLuc: null }] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")!.loai).toBe("DIEU_CHINH_GIAM");
  });
});

describe("[ENG-PL-06b] khách giữ tờ hoá đơn xuất NGOÀI hệ thống (KHONG_XUAT + 'Đã xuất ngoài hệ thống') cũng cần điều chỉnh — cùng canDieuChinh", () => {
  const goc = tienMat({ id: "goc", amount: 6_000_000 });
  const hdNgoai = (lyDo: string | null) =>
    hoaDon({ id: "hd-ngoai", trangThai: "KHONG_XUAT", lyDo, xacNhanLuc: null, createdAt: new Date("2026-09-12T04:00:00Z"), khoan: [{ paymentId: "goc", soTien: 6_000_000 }] });
  const hoan = (createdAt: string) =>
    khoan({ id: "hoan", amount: -1_234_567, accountantStatus: "REFUNDED", method: "CASH", note: null, adjustmentOfId: "goc", createdAt: new Date(createdAt) });

  it("hoàn SAU mốc đánh dấu ⇒ DIEU_CHINH_GIAM gắn hoá đơn KHONG_XUAT; khoản gốc giữ trạng thái KHONG_XUAT", () => {
    const r = pl({ don: don({ payments: [goc, hoan("2026-09-20T03:00:00Z")], hoaDonDienTu: [hdNgoai(LY_DO_DA_XUAT_NGOAI)] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")).toMatchObject({ loai: "DIEU_CHINH_GIAM", soTien: 1_234_567, trangThai: "CHO_QUYET", khoanGocId: "goc", hoaDonId: "hd-ngoai" });
    expect(theoKhoa(r.nghiaVu, "goc")).toMatchObject({ trangThai: "KHONG_XUAT", soTien: 4_765_433 });
  });
  it("hoàn TRƯỚC mốc đánh dấu ⇒ số ròng đã nằm trong tờ khách giữ ⇒ không sinh", () => {
    const r = pl({ don: don({ payments: [goc, hoan("2026-09-11T03:00:00Z")], hoaDonDienTu: [hdNgoai(LY_DO_DA_XUAT_NGOAI)] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")).toBeUndefined();
  });
  it.each([[LY_DO_KHACH_KHONG_LAY], [`${TIEN_TO_LY_DO_KHAC}khách ở xa`], [null]])("lý do %s ⇒ không có tờ nào để điều chỉnh ⇒ không sinh", (lyDo) => {
    const r = pl({ don: don({ payments: [goc, hoan("2026-09-20T03:00:00Z")], hoaDonDienTu: [hdNgoai(lyDo)] }) });
    expect(theoKhoa(r.nghiaVu, "hoan")).toBeUndefined();
    expect(theoKhoa(r.nghiaVu, "goc")).toMatchObject({ trangThai: "KHONG_XUAT" });
  });
});

describe("[ENG-PL-07] KHÔNG sinh nghĩa vụ — kèm lý do", () => {
  it("chuyển nội bộ · nhập lịch sử · kế toán từ chối · xoá mềm · đã đảo hết · dòng âm", () => {
    const r = pl({
      don: don({
        payments: [
          tienMat({ id: "chuyen", amount: 2_345_678, method: "chuyen-noi-bo", note: "Chuyển bé [chuyen:c1]" }),
          tienMat({ id: "su", amount: 1_111_111, note: `${BACKFILL_PAYMENT_MARKER} sheet` }),
          tienMat({ id: "tc", amount: 999_999, accountantStatus: "REJECTED" }),
          tienMat({ id: "xoa", amount: 888_888, deletedAt: new Date("2026-09-15T00:00:00Z") }),
          tienMat({ id: "dao", amount: 9_530_000 }),
          tienMat({ id: "dao-neg", amount: -9_530_000, paymentType: "ADJUSTMENT", adjustmentOfId: "dao", note: null }),
        ],
      }),
    });
    expect(r.nghiaVu).toEqual([]);
    expect(r.khongSinh).toEqual([
      { paymentId: "chuyen", lyDo: "CHUYEN_NOI_BO" },
      { paymentId: "dao", lyDo: "DA_DAO_HET" },
      { paymentId: "dao-neg", lyDo: "KHONG_PHAI_KHOAN_THU" },
      { paymentId: "su", lyDo: "NHAP_LICH_SU" },
      { paymentId: "tc", lyDo: "KE_TOAN_TU_CHOI" },
      { paymentId: "xoa", lyDo: "KHOAN_DA_XOA" },
    ]);
  });
  it("đơn đã xoá ⇒ mọi khoản bị loại (không phải đơn huỷ)", () => {
    const r = pl({ don: don({ deletedAt: new Date("2026-09-30T00:00:00Z"), payments: [tienMat({ id: "p1" })] }) });
    expect(r.nghiaVu).toEqual([]);
    expect(r.khongSinh).toEqual([{ paymentId: "p1", lyDo: "DON_DA_XOA" }]);
  });
  it("đơn thiếu cơ sở ⇒ không nghĩa vụ nào, đếm khoản thiếu cơ sở (không đếm khoản đã bị loại vì lý do khác)", () => {
    const r = pl({ don: don({ centerId: null, center: null, payments: [tienMat({ id: "a" }), tienMat({ id: "b", amount: 1_234_567 }), tienMat({ id: "c", accountantStatus: "REJECTED" })] }) });
    expect(r.nghiaVu).toEqual([]);
    expect(r.thieuCoSo).toBe(2);
    expect(r.khongSinh).toEqual([
      { paymentId: "a", lyDo: "THIEU_CO_SO" },
      { paymentId: "b", lyDo: "THIEU_CO_SO" },
      { paymentId: "c", lyDo: "KE_TOAN_TU_CHOI" },
    ]);
  });
});

describe("[ENG-PL-08] khoản mơ hồ / dư / lệch ⇒ CHO_QUYET, không tự xuất", () => {
  it("nghi trùng: lời khai tay + chuyển khoản cùng đơn", () => {
    const d = don({
      payments: [tienMat({ id: "khai", amount: 3_000_000, note: installmentMarker(1) }), khoan({ id: "ck", amount: 3_000_000, note: gatewayMarker("SEPAY", "FT2") })],
      paymentRequests: [phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "PAID", allocations: [phanBo("bt2", "dot1", 3_000_000)] })],
    });
    const r = pl({ don: d, giaoDich: [giaoDich("bt2", "FT2", 3_000_000)] });
    expect(theoKhoa(r.nghiaVu, "khai")).toMatchObject({ trangThai: "CHO_QUYET", lyDoChoQuyet: "NGHI_TRUNG" });
    expect(theoKhoa(r.nghiaVu, "ck")).toMatchObject({ trangThai: "CHO_XUAT", lyDoChoQuyet: null });
  });
  it("lần thu THIẾU so với đợt (đợt 3.000.000, giao dịch chỉ rót 2.000.000)", () => {
    const d = don({
      payments: [khoan({ id: "ck", amount: 2_000_000 })],
      paymentRequests: [phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "PARTIAL", allocations: [phanBo("bt1", "dot1", 2_000_000)] })],
    });
    expect(theoKhoa(pl({ don: d, giaoDich: [giaoDich("bt1", "FT1", 2_000_000)] }).nghiaVu, "ck")).toMatchObject({ trangThai: "CHO_QUYET", lyDoChoQuyet: "LAN_THU_THIEU" });
  });
  it("đợt đã bị huỷ (VOID) mà tiền đã rót vào", () => {
    const d = don({
      payments: [khoan({ id: "ck", amount: 3_000_000 })],
      paymentRequests: [phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "VOID", allocations: [phanBo("bt1", "dot1", 3_000_000)] })],
    });
    expect(theoKhoa(pl({ don: d, giaoDich: [giaoDich("bt1", "FT1", 3_000_000)] }).nghiaVu, "ck")).toMatchObject({ trangThai: "CHO_QUYET", lyDoChoQuyet: "DOT_DA_HUY" });
  });
  it("tiền THỪA (giao dịch 5.500.000, đợt 5.000.000) ⇒ phần dư chờ người quyết", () => {
    const d = don({
      payments: [khoan({ id: "ck", amount: 5_500_000 })],
      paymentRequests: [phieu({ id: "dot1", installmentNo: 1, amountDue: 5_000_000, status: "PAID", allocations: [phanBo("bt1", "dot1", 5_000_000)] })],
    });
    expect(theoKhoa(pl({ don: d, giaoDich: [giaoDich("bt1", "FT1", 5_500_000)] }).nghiaVu, "ck")).toMatchObject({ trangThai: "CHO_QUYET", lyDoChoQuyet: "TIEN_THUA", soTien: 5_500_000 });
  });
  it("giao dịch ngân hàng KHÔNG có phân bổ (đơn không có phiếu) KHÔNG bị coi là tiền thừa", () => {
    const d = don({ payments: [khoan({ id: "ck", amount: 2_468_013 })] });
    expect(theoKhoa(pl({ don: d, giaoDich: [giaoDich("bt1", "FT1", 2_468_013)] }).nghiaVu, "ck")).toMatchObject({ trangThai: "CHO_XUAT", lyDoChoQuyet: null });
  });
  it("đơn đã huỷ / hoàn ⇒ tiền thật nhưng hoàn hay xuất do người quyết", () => {
    for (const status of ["CANCELLED", "REFUNDED"]) {
      expect(theoKhoa(pl({ don: don({ status, payments: [tienMat({ id: "p1", amount: 4_444_444 })] }) }).nghiaVu, "p1")).toMatchObject({ trangThai: "CHO_QUYET", lyDoChoQuyet: "DON_DA_HUY", soTien: 4_444_444 });
    }
  });
  it("thứ tự lý do: lý do của LẦN THU (nghi trùng) đứng trước loại mơ hồ", () => {
    const d = don({
      type: "COMBO",
      payments: [tienMat({ id: "khai", amount: 3_000_000, note: installmentMarker(1) }), khoan({ id: "ck", amount: 3_000_000, note: gatewayMarker("SEPAY", "FT2") })],
      paymentRequests: [phieu({ id: "dot1", installmentNo: 1, amountDue: 3_000_000, status: "PAID", allocations: [phanBo("bt2", "dot1", 3_000_000)] })],
    });
    expect(theoKhoa(pl({ don: d, giaoDich: [giaoDich("bt2", "FT2", 3_000_000)] }).nghiaVu, "khai")!.lyDoChoQuyet).toBe("NGHI_TRUNG");
  });
});

describe("[ENG-PL-09] số tiền là số RÒNG của Payment — phiếu thu không có tiếng nói", () => {
  const payments = [tienMat({ id: "a", amount: 6_000_000 }), tienMat({ id: "tra", amount: -1_234_567, paymentType: "PAYMENT", accountantStatus: "REFUNDED", adjustmentOfId: "a", note: null }), tienMat({ id: "b", amount: 2_468_013 })];
  const soTien = (phieus: ReturnType<typeof phieu>[]) => Object.fromEntries(pl({ don: don({ payments, paymentRequests: phieus }) }).nghiaVu.map((n) => [n.khoa, n.soTien]));
  it("cùng khoản, phiếu thu hoàn toàn khác nhau (không phiếu · phiếu 1đ · phiếu 9,9 tỷ · hai đợt) ⇒ cùng số tiền", () => {
    const co = soTien([]);
    expect(co).toEqual({ "PAYMENT:a": 4_765_433, "PAYMENT:b": 2_468_013 });
    expect(soTien([phieu({ id: "d1", installmentNo: 1, amountDue: 1 })])).toEqual(co);
    expect(soTien([phieu({ id: "d1", installmentNo: 1, amountDue: 9_999_999_999 })])).toEqual(co);
    expect(soTien([phieu({ id: "d1", installmentNo: 1, amountDue: 3_000_000 }), phieu({ id: "d2", installmentNo: 2, amountDue: 7_400_000, status: "PARTIAL" })])).toEqual(co);
  });
});

describe("[ENG-PL-10] sourceHash ổn định", () => {
  const payments = [tienMat({ id: "a", amount: 6_000_000, orderItemId: "i1" }), tienMat({ id: "b", amount: 2_468_013, orderItemId: "i2" }), khoan({ id: "c", amount: 3_000_001 })];
  const dongDon = [dongDonKhoaHoc("i1"), dongDonKhoaHoc("i2", { type: "PRODUCT" })];
  it("đảo thứ tự khoản / dòng đơn ⇒ kết quả y hệt từng byte", () => {
    const xuoi = pl({ don: don({ payments }), dongDon });
    const nguoc = pl({ don: don({ payments: [...payments].reverse() }), dongDon: [...dongDon].reverse() });
    expect(xuoi.nghiaVu).toHaveLength(3); // không để so hai danh sách rỗng
    expect(nguoc).toEqual(xuoi);
    expect(xuoi.nghiaVu.every((n) => /^[0-9a-f]{32}$/.test(n.sourceHash))).toBe(true);
  });
  it("đổi số ròng của MỘT khoản ⇒ chỉ dấu của khoản đó đổi", () => {
    const truoc = pl({ don: don({ payments }), dongDon });
    const sau = pl({ don: don({ payments: payments.map((p) => (p.id === "b" ? { ...p, amount: 2_468_014 } : p)) }), dongDon });
    expect(truoc.nghiaVu).toHaveLength(3); // vòng dưới không được rỗng
    for (const n of truoc.nghiaVu) {
      const m = theoKhoa(sau.nghiaVu, n.khoa.replace("PAYMENT:", ""))!;
      expect(m.sourceHash === n.sourceHash).toBe(n.khoa !== "PAYMENT:b");
    }
  });
  it("dấu là của NGUỒN, không phải trạng thái: khoản bị khoá vào hoá đơn đổi trạng thái nhưng KHÔNG đổi dấu", () => {
    const chua = theoKhoa(pl({ don: don({ payments }), dongDon }).nghiaVu, "a")!;
    const roi = theoKhoa(pl({ don: don({ payments, hoaDonDienTu: [hoaDon({ id: "hd", khoan: [{ paymentId: "a", soTien: 6_000_000 }] })] }), dongDon }).nghiaVu, "a")!;
    expect(chua.trangThai).toBe("CHO_XUAT");
    expect(roi.trangThai).toBe("DA_XUAT");
    expect(roi.sourceHash).toBe(chua.sourceHash);
  });
  it("đổi loại khoản / dòng đơn ⇒ đổi dấu", () => {
    const a = theoKhoa(pl({ don: don({ payments }), dongDon }).nghiaVu, "b")!;
    const b = theoKhoa(pl({ don: don({ payments }), dongDon: [dongDonKhoaHoc("i1"), dongDonKhoaHoc("i2", { type: "EXAM_REGISTRATION" })] }).nghiaVu, "b")!;
    expect(a.sourceHash).not.toBe(b.sourceHash);
  });
});

describe("[ENG-PL-11] BILLING:<orderItemId> chỉ ở chế độ THEO_KHOAN_THU_VA_DONG_DON và luôn chờ người quyết", () => {
  const dongDon = [dongDonKhoaHoc("i1", { trangThai: "STOPPED", usedValue: 4_321_000 }), dongDonKhoaHoc("i2", { trangThai: "STOPPED", usedValue: 0 }), dongDonKhoaHoc("i3", { trangThai: "ACTIVE", usedValue: 999 })];
  const d = don({ payments: [tienMat({ id: "a", orderItemId: "i1", amount: 5_000_000 })] });
  it("chế độ THEO_KHOAN_THU ⇒ không sinh BILLING", () => {
    expect(pl({ don: d, dongDon, cheDo: "THEO_KHOAN_THU" }).nghiaVu.map((n) => n.khoa)).toEqual(["PAYMENT:a"]);
  });
  it("chế độ có dòng đơn ⇒ chỉ dòng STOPPED có usedValue > 0", () => {
    const r = pl({ don: d, dongDon, cheDo: "THEO_KHOAN_THU_VA_DONG_DON" });
    expect(r.nghiaVu.map((n) => n.khoa)).toEqual(["BILLING:i1", "PAYMENT:a"]);
    expect(r.nghiaVu[0]).toMatchObject({ nguon: { loai: "BILLING", orderItemId: "i1" }, loai: "THU_TIEN", soTien: 4_321_000, trangThai: "CHO_QUYET", lyDoChoQuyet: "LAP_THEO_DONG_CHUA_CHOT", orderItemId: "i1" });
  });
});

describe("[ENG-PL-12] ĐƠN KHÔNG CƠ SỞ không sinh nghĩa vụ NÀO — kể cả trên các đường đi qua TRƯỚC phanLoaiKhoan", () => {
  const goc = tienMat({ id: "goc", amount: 6_000_000 });
  const hdXN = hoaDon({ id: "hd1", trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2026-09-12T05:00:00Z"), khoan: [{ paymentId: "goc", soTien: 6_000_000 }] });
  const hoan = khoan({ id: "hoan", amount: -1_234_567, accountantStatus: "REFUNDED", method: "CASH", note: null, adjustmentOfId: "goc", createdAt: new Date("2026-09-20T03:00:00Z") });
  const khongCoSo = { centerId: null, center: null } as const;

  it("đối chứng DƯƠNG: cùng dữ liệu nhưng CÓ cơ sở ⇒ sinh cả khoản đã khoá lẫn điều chỉnh giảm (cổng không rỗng vì thiếu dữ liệu)", () => {
    const r = pl({ don: don({ payments: [goc, hoan], hoaDonDienTu: [hdXN] }) });
    expect(r.nghiaVu.map((n) => [n.khoa, n.centerId])).toEqual([["PAYMENT:goc", "cs1"], ["PAYMENT:hoan", "cs1"]]);
  });
  it("khoản ĐÃ KHOÁ vào hoá đơn + đơn không cơ sở ⇒ không nghĩa vụ", () => {
    const r = pl({ don: don({ ...khongCoSo, payments: [goc], hoaDonDienTu: [hdXN] }) });
    expect(r.nghiaVu).toEqual([]);
    expect(r.thieuCoSo).toBe(0); // khoản đã khoá không đi qua phanLoaiKhoan nên không bị đếm là thiếu cơ sở
  });
  it("điều chỉnh giảm + đơn không cơ sở ⇒ không nghĩa vụ (kể cả DIEU_CHINH_GIAM)", () => {
    const r = pl({ don: don({ ...khongCoSo, payments: [goc, hoan], hoaDonDienTu: [hdXN] }) });
    expect(r.nghiaVu.filter((n) => n.loai === "DIEU_CHINH_GIAM")).toEqual([]);
    expect(r.nghiaVu).toEqual([]);
  });
  it("BILLING theo dòng đơn (đã dừng học, usedValue > 0) + đơn không cơ sở ⇒ không nghĩa vụ", () => {
    const dongDon = [dongDonKhoaHoc("i1", { trangThai: "STOPPED", usedValue: 4_321_000 })];
    expect(pl({ don: don({ payments: [] }), dongDon, cheDo: "THEO_KHOAN_THU_VA_DONG_DON" }).nghiaVu.map((n) => n.khoa)).toEqual(["BILLING:i1"]); // đối chứng dương
    expect(pl({ don: don({ ...khongCoSo, payments: [] }), dongDon, cheDo: "THEO_KHOAN_THU_VA_DONG_DON" }).nghiaVu).toEqual([]);
  });
});

describe("[ENG-PL-13] biên mốc điều chỉnh: dòng âm tạo ĐÚNG lúc xác nhận / đánh dấu chưa phải 'sau' (so sánh nghiêm `>`)", () => {
  const T = "2026-09-12T05:00:00.000Z";
  const goc = tienMat({ id: "goc", amount: 6_000_000 });
  const hoanLuc = (iso: string) => khoan({ id: "hoan", amount: -1_234_567, accountantStatus: "REFUNDED", method: "CASH", note: null, adjustmentOfId: "goc", createdAt: new Date(iso) });
  const ngayLech = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
  const hdXN = hoaDon({ id: "hd1", trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date(T), khoan: [{ paymentId: "goc", soTien: 6_000_000 }] });
  const hdNgoai = hoaDon({ id: "hd-ngoai", trangThai: "KHONG_XUAT", lyDo: LY_DO_DA_XUAT_NGOAI, xacNhanLuc: null, createdAt: new Date(T), khoan: [{ paymentId: "goc", soTien: 6_000_000 }] });

  it.each([["ĐÃ XÁC NHẬN", hdXN], ["đánh dấu 'Đã xuất ngoài hệ thống'", hdNgoai]] as const)("hoá đơn %s: đồng mốc ⇒ KHÔNG điều chỉnh; trước 1ms ⇒ không; sau 1ms ⇒ CÓ", (_ten, hd) => {
    const pk = (iso: string) => pl({ don: don({ payments: [goc, hoanLuc(iso)], hoaDonDienTu: [hd] }) });
    const dongMoc = pk(T);
    expect(theoKhoa(dongMoc.nghiaVu, "hoan")).toBeUndefined();
    expect(dongMoc.khongSinh).toEqual([{ paymentId: "hoan", lyDo: "SO_TIEN_AM" }]);
    expect(theoKhoa(pk(ngayLech(T, -1)).nghiaVu, "hoan")).toBeUndefined();
    expect(theoKhoa(pk(ngayLech(T, 1)).nghiaVu, "hoan")).toMatchObject({ loai: "DIEU_CHINH_GIAM", hoaDonId: hd.id });
  });
});

describe("[ENG-PL-14] khoản nằm ở HAI hoá đơn: hoá đơn ĐẦU danh sách giữ khoản, nghĩa vụ chỉ MỘT", () => {
  const p = tienMat({ id: "p", amount: 3_000_017 });
  const cu = hoaDon({ id: "hd-cu", trangThai: "NHAP", khoan: [{ paymentId: "p", soTien: 3_000_017 }] });
  const moi = hoaDon({ id: "hd-moi", trangThai: "DA_XAC_NHAN", khoan: [{ paymentId: "p", soTien: 3_000_017 }] });
  it.each([
    ["[cũ, mới]", [cu, moi], "hd-cu", "DANG_XU_LY"],
    ["[mới, cũ]", [moi, cu], "hd-moi", "DA_XUAT"],
  ] as const)("thứ tự %s ⇒ hoá đơn ĐẦU danh sách quyết định hoaDonId + trạng thái; không nhân đôi nghĩa vụ", (_ten, hds, hdId, trangThai) => {
    const r = pl({ don: don({ payments: [p], hoaDonDienTu: [...hds] }) });
    expect(r.nghiaVu).toHaveLength(1);
    expect(r.nghiaVu[0]).toMatchObject({ khoa: "PAYMENT:p", hoaDonId: hdId, trangThai });
  });
});

describe("[ENG-PL-15] sourceHash nhạy với TỪNG thành phần của dấu vân tay nguồn", () => {
  const payments = [tienMat({ id: "a", amount: 6_000_000, orderItemId: "i1" })];
  const dongDon = [dongDonKhoaHoc("i1"), dongDonKhoaHoc("i2")];
  const hashCua = (d: ReturnType<typeof don>, dd = dongDon, id = "a") => theoKhoa(pl({ don: d, dongDon: dd }).nghiaVu, id)!.sourceHash;
  const goc = hashCua(don({ payments }));

  it("đối chứng: cùng dữ liệu ⇒ cùng dấu (ổn định, không phụ thuộc lần chạy)", () => {
    expect(hashCua(don({ payments }))).toBe(goc);
  });
  it("KHÁC ĐƠN (cùng khoản, cùng cơ sở, cùng số) ⇒ dấu khác", () => {
    expect(hashCua(don({ id: "don-an-02", payments }))).not.toBe(goc);
  });
  it("KHÁC CƠ SỞ (cùng khoản, cùng đơn, cùng số) ⇒ dấu khác", () => {
    expect(hashCua(don({ centerId: "cs2", center: { code: "CS2", name: "Cơ sở 2" }, payments }))).not.toBe(goc);
  });
  it("KHÁC DÒNG ĐƠN cùng loại (i1 → i2, cả hai khoá học) ⇒ dấu khác", () => {
    expect(hashCua(don({ payments: [{ ...payments[0]!, orderItemId: "i2" }] }))).not.toBe(goc);
  });
  it("điều chỉnh giảm: KHÁC khoản gốc (g1 → g2, cùng hoá đơn) ⇒ dấu khác", () => {
    const hdXN = hoaDon({ id: "hd1", khoan: [{ paymentId: "g1", soTien: 6_000_000 }, { paymentId: "g2", soTien: 6_000_000 }] });
    const bo = (gocId: string) => don({ payments: [tienMat({ id: "g1", amount: 6_000_000 }), tienMat({ id: "g2", amount: 6_000_000 }), khoan({ id: "hoan", amount: -1_234_567, accountantStatus: "REFUNDED", method: "CASH", note: null, adjustmentOfId: gocId, createdAt: new Date("2026-09-20T03:00:00Z") })], hoaDonDienTu: [hdXN] });
    const h1 = hashCua(bo("g1"), [], "hoan");
    const h2 = hashCua(bo("g2"), [], "hoan");
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
    expect(h1).not.toBe(h2);
  });
});
