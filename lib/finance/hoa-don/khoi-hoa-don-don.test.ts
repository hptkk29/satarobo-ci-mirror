// Ca [KHD-*] — khối "Hoá đơn điện tử" trên trang chi tiết đơn (GĐ 7, docs/ke-toan-hoa-don/PLAN.md §8).
//
// Hàm thuần dựng DTO cho SALE từ dữ liệu một đơn: mỗi lần thu một mục, nhãn nói bằng lời của hoá đơn,
// nút tải CHỈ khi route tải về sẽ cho (luật 12), và DTO không mang thứ gì phải che (email khi thiếu
// `orders:view-pii`, khoá tệp, MST, địa chỉ, văn bản lỗi của nhà cung cấp email).
import { describe, it, expect } from "vitest";
import {
  dungKhoiHoaDonDon,
  trangThaiEmailHoaDon,
  type DonVaoKhoi,
  type HoaDonVaoKhoi,
  type LuotGuiVao,
} from "./khoi-hoa-don-don";
import { gatewayMarker, BACKFILL_PAYMENT_MARKER } from "@/lib/finance/payment-markers";
import { LY_DO_DA_XUAT_NGOAI, LY_DO_KHACH_KHONG_LAY } from "./ly-do-khong-xuat";
import { dungDongHangCho } from "./dong-hang-cho";

const DA_XAC_NHAN_KHOAN = "CONFIRMED"; // hằng — lưới `truc-a` quét cả tệp test

const khoan = (o: Partial<DonVaoKhoi["payments"][number]> & { id: string }): DonVaoKhoi["payments"][number] => ({
  amount: 3_000_000,
  method: "BANK_TRANSFER",
  note: gatewayMarker("SEPAY", "FT1"),
  paymentType: "PAYMENT",
  accountantStatus: DA_XAC_NHAN_KHOAN,
  enrollmentId: "enr1",
  orderItemId: null,
  recordedById: null,
  adjustmentOfId: null,
  paidDate: new Date("2026-09-10T03:00:00Z"),
  deletedAt: null,
  createdAt: new Date("2026-09-10T03:00:00Z"),
  ...o,
});

// Email dài để `maskEmail` thật sự che (≤2 ký tự trước @ thì nó trả nguyên).
const EMAIL = "phuhuynh.quynhanh@gmail.com";

const hoaDon = (o: Partial<HoaDonVaoKhoi> = {}): HoaDonVaoKhoi => ({
  id: "hd1",
  trangThai: "DA_XAC_NHAN",
  kyHieu: "1C26TSR",
  soHoaDon: "123",
  ngayPhatHanh: new Date("2026-09-11T00:00:00Z"),
  tepPdfKey: "hoa-don/CS1/2026/don1/khoa-pdf-bi-mat.pdf",
  tepPdfTen: "hd-123.pdf",
  tepXmlKey: "hoa-don/CS1/2026/don1/khoa-xml-bi-mat.xml",
  tepXmlTen: "hd-123.xml",
  emailNhan: EMAIL,
  guiEmailKhach: true,
  xuatTheoSoDaThu: false,
  lyDo: null,
  khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
  tongTien: 3_000_000,
  xacNhanLuc: new Date("2026-09-11T02:00:00Z"),
  createdAt: new Date("2026-09-11T01:00:00Z"),
  updatedAt: new Date("2026-09-11T02:00:00Z"),
  khongTrungLyDo: null,
  nguoiMuaHashLucIn: null,
  nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
  xuatTheoSoDaThuLyDo: null,
  guiEmail: [],
  taiDuoc: true,
  ...o,
});

const don = (o: Partial<DonVaoKhoi> = {}): DonVaoKhoi => ({
  id: "don1",
  code: "ORD-260910-000001",
  type: "COURSE",
  status: "CONFIRMED",
  centerId: "cs1",
  deletedAt: null,
  center: { code: "CS1", name: "Cơ sở 1" },
  customerName: "Nguyễn Phương Quỳnh Anh",
  customerPhone: "0905123456",
  customerEmail: EMAIL,
  customerAddress: "12 Lê Lợi",
  customerWard: null,
  customerCity: "Đà Nẵng",
  customerCccd: "048123456789",
  invoiceBuyerName: null,
  invoiceCompanyName: "Công ty TNHH Bí Mật",
  invoiceTaxCode: "0401234567",
  invoiceEmail: null,
  payments: [khoan({ id: "p1" })],
  paymentRequests: [
    {
      id: "dot1",
      orderItemId: null,
      installmentNo: 1,
      amountDue: 3_000_000,
      status: "PAID",
      allocations: [{ bankTransactionId: "bt1", paymentRequestId: "dot1", amount: 3_000_000, roundingWaived: 0 }],
    },
  ],
  hoaDonDienTu: [],
  hoaDonDaHuy: [],
  yeuCauHoan: [],
  ...o,
});

const GD = [
  { id: "bt1", provider: "SEPAY", providerTxnId: "FT1", transferredAt: new Date("2026-09-10T10:00:00Z"), amount: 3_000_000 },
];

type Vao = Parameters<typeof dungKhoiHoaDonDon>[0];
const vao = (o: Partial<Vao> = {}): Vao => ({
  don: don(),
  giaoDich: GD,
  hangDoi: [],
  xemPii: true,
  khoOk: true,
  userId: "sale1",
  ...o,
});

const luot = (o: Partial<LuotGuiVao> = {}): LuotGuiVao => ({
  lanGui: 1,
  toi: EMAIL,
  trangThai: "CHO",
  loi: null,
  emailQueueId: "q1",
  updatedAt: new Date("2026-09-11T02:05:00Z"),
  ...o,
});

describe("[KHD-01] nhãn theo trạng thái hoá đơn — lời của SALE, không phải việc của kế toán", () => {
  it("chưa có hoá đơn ⇒ 'Chờ kế toán xuất hoá đơn', số tiền + ngày thu + đợt", () => {
    const { dong } = dungKhoiHoaDonDon(vao());
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({
      trangThai: "CHO",
      nhan: "Chờ kế toán xuất hoá đơn",
      tone: "warning",
      soTien: 3_000_000,
      ngayThuLabel: "10/09/2026",
      nhanDot: "Đợt 1",
      soHoaDon: null,
      taiPdf: null,
      taiXml: null,
      lyDoKhongTai: null,
      email: null,
    });
  });

  it("thiếu tiền đợt ⇒ vẫn là 'chờ', kèm số thiếu (lý do thật hoá đơn chưa ra)", () => {
    const d = don({
      payments: [khoan({ id: "p1", amount: 2_000_000 })],
      paymentRequests: [
        {
          id: "dot1",
          orderItemId: null,
          installmentNo: 1,
          amountDue: 3_000_000,
          status: "PARTIAL",
          allocations: [{ bankTransactionId: "bt1", paymentRequestId: "dot1", amount: 2_000_000, roundingWaived: 0 }],
        },
      ],
    });
    const { dong } = dungKhoiHoaDonDon(vao({ don: d }));
    expect(dong[0]).toMatchObject({ trangThai: "CHO", nhan: "Chờ kế toán xuất hoá đơn · thiếu 1.000.000đ" });
  });

  it("nháp ⇒ 'Kế toán đang xử lý', KHÔNG số hoá đơn, KHÔNG nút tải dù người xem tải được bản đã xác nhận", () => {
    const { dong } = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDienTu: [hoaDon({ trangThai: "NHAP" })] }) }));
    expect(dong[0]).toMatchObject({
      trangThai: "DANG_XU_LY",
      nhan: "Kế toán đang xử lý hoá đơn",
      soHoaDon: null,
      taiPdf: null,
      taiXml: null,
      lyDoKhongTai: null,
      email: null,
    });
  });

  it("không xuất vì khách không lấy ⇒ 'Không xuất hoá đơn' + lý do cố định, KỂ CẢ khi thiếu PII", () => {
    const d = don({ hoaDonDienTu: [hoaDon({ trangThai: "KHONG_XUAT", lyDo: LY_DO_KHACH_KHONG_LAY })] });
    for (const xemPii of [true, false]) {
      const { dong } = dungKhoiHoaDonDon(vao({ don: d, xemPii }));
      expect(dong[0], String(xemPii)).toMatchObject({
        trangThai: "KHONG_XUAT",
        nhan: "Không xuất hoá đơn",
        lyDoKhongXuat: LY_DO_KHACH_KHONG_LAY,
      });
    }
  });

  it("[KHD-01b] 'Đã xuất ngoài hệ thống' ⇒ khách ĐÃ có hoá đơn: nhãn nói vậy, đếm là đã có, không nút tải + lý do", () => {
    // Lý do MẶC ĐỊNH của kế toán cho hoá đơn cũ ở MISA. Bản đầu đọc nó thành "Không xuất hoá đơn" —
    // sale hiểu khách chưa có hoá đơn, nói ngược sự thật (review GĐ 7).
    const d = don({ hoaDonDienTu: [hoaDon({ trangThai: "KHONG_XUAT", lyDo: LY_DO_DA_XUAT_NGOAI, tepPdfKey: null })] });
    const r = dungKhoiHoaDonDon(vao({ don: d })).dong[0]!;
    expect(r).toMatchObject({
      trangThai: "DA_XUAT_NGOAI",
      nhan: "Đã xuất hoá đơn ngoài hệ thống",
      tone: "success",
      taiPdf: null,
      taiXml: null,
      lyDoKhongXuat: null,
    });
    expect(r.lyDoKhongTai).toMatch(/MISA/);
  });

  it("[KHD-01d] (29/09 — Q3) 'Đã xuất ngoài hệ thống' mà tiền đổi sau lúc đánh dấu ⇒ vẫn là ĐÃ XUẤT NGOÀI, nhãn thêm việc đang xem lại; không số, không nút tải", () => {
    // Bản KHONG_XUAT vào ngăn "Cần điều chỉnh" — trước bản vá, khối coi mọi dòng ngăn đó là bản ĐÃ XÁC NHẬN
    // ⇒ in "— · số —" và hứa nút tải cho một bản không có tệp (luật 12).
    const d = don({
      hoaDonDienTu: [hoaDon({ trangThai: "KHONG_XUAT", lyDo: LY_DO_DA_XUAT_NGOAI, xacNhanLuc: null, kyHieu: null, soHoaDon: null })],
      yeuCauHoan: [
        { id: "rr1", status: "APPROVED", soTien: 1_000_000, lucDuyet: new Date("2026-09-20T02:00:00Z"), createdAt: new Date("2026-09-19T02:00:00Z"), ten: "Bé An", phamVi: { orderItemIds: [], enrollmentIds: [] } },
      ],
    });
    const r = dungKhoiHoaDonDon(vao({ don: d })).dong[0]!;
    expect(r).toMatchObject({
      trangThai: "DA_XUAT_NGOAI",
      nhan: "Đã xuất hoá đơn ngoài hệ thống · tiền đã đổi sau khi xuất — kế toán đang xem lại",
      tone: "warning",
      soHoaDon: null,
      taiPdf: null,
      taiXml: null,
    });
    expect(r.lyDoKhongTai).toMatch(/MISA/);
    // Đối chứng: cùng bản, không có hoàn ⇒ nhãn cũ.
    const sach = dungKhoiHoaDonDon(vao({ don: { ...d, yeuCauHoan: [] } })).dong[0]!;
    expect(sach).toMatchObject({ trangThai: "DA_XUAT_NGOAI", nhan: "Đã xuất hoá đơn ngoài hệ thống", tone: "success" });
  });

  it("[KHD-01c] lý do TỰ DO ('Khác: …') chỉ hiện khi có quyền PII — kế toán gõ tay, có thể mang MST", () => {
    const lyDo = "Khác: khách lấy HĐ công ty MST 0401234567";
    const d = don({ hoaDonDienTu: [hoaDon({ trangThai: "KHONG_XUAT", lyDo })] });
    expect(dungKhoiHoaDonDon(vao({ don: d, xemPii: true })).dong[0]!.lyDoKhongXuat).toBe(lyDo);
    const khongPii = dungKhoiHoaDonDon(vao({ don: d, xemPii: false })).dong[0]!;
    expect(khongPii).toMatchObject({ trangThai: "KHONG_XUAT", lyDoKhongXuat: null });
  });

  it("đơn huỷ ⇒ 'Đơn đã huỷ — không xuất hoá đơn', đếm là KHONG_XUAT", () => {
    const { dong } = dungKhoiHoaDonDon(vao({ don: don({ status: "CANCELLED" }) }));
    expect(dong[0]).toMatchObject({ trangThai: "KHONG_XUAT", nhan: "Đơn đã huỷ — không xuất hoá đơn", tone: "muted" });
  });
});

describe("[KHD-02] đã xuất — số trên tờ hoá đơn + nút tải CÙNG luật route", () => {
  it("in ký hiệu · số · ngày phát hành khi tờ hoá đơn KHỚP tiền hiện tại", () => {
    const { dong } = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDienTu: [hoaDon()] }) }));
    expect(dong[0]).toMatchObject({
      trangThai: "DA_XUAT",
      nhan: "Đã xuất hoá đơn",
      tone: "success",
      soHoaDon: "1C26TSR · số 123",
      ngayPhatHanhLabel: "11/09/2026",
      soTien: 3_000_000,
    });
  });

  it("tiền đã đổi SAU khi xuất (GĐ 8 'cần điều chỉnh') ⇒ vẫn đã xuất, nhãn cảnh báo, số tiền là SỐ TRÊN TỜ, vẫn tải được", () => {
    const d = don({ hoaDonDienTu: [hoaDon({ tongTien: 2_900_000 })] });
    const { dong } = dungKhoiHoaDonDon(vao({ don: d }));
    expect(dong[0]).toMatchObject({
      trangThai: "DA_XUAT",
      tone: "warning",
      soTien: 2_900_000,
      soHoaDon: "1C26TSR · số 123",
    });
    expect(dong[0]!.nhan).toMatch(/kế toán đang xem lại/);
    expect(dong[0]!.taiPdf).not.toBeNull();
  });

  it("tải được ⇒ href route tải về cho PDF và XML — KHÔNG khoá tệp", () => {
    const { dong } = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDienTu: [hoaDon()] }) }));
    expect(dong[0]).toMatchObject({
      taiPdf: "/payments/hoa-don/hd1/tai-ve?loai=pdf",
      taiXml: "/payments/hoa-don/hd1/tai-ve?loai=xml",
      lyDoKhongTai: null,
    });
  });

  it("không có KHOÁ tệp XML ⇒ không nút XML (route hỏi `tepXmlKey`, không hỏi tên)", () => {
    const d = don({ hoaDonDienTu: [hoaDon({ tepXmlKey: null, tepXmlTen: "con-ten-mat-khoa.xml" })] });
    const { dong } = dungKhoiHoaDonDon(vao({ don: d }));
    expect(dong[0]!.taiPdf).not.toBeNull();
    expect(dong[0]!.taiXml).toBeNull();
  });

  it("route không cho (taiDuoc=false) ⇒ KHÔNG nút, và NÓI lý do theo quyền PII", () => {
    const d = don({ hoaDonDienTu: [hoaDon({ taiDuoc: false })] });
    const khongPii = dungKhoiHoaDonDon(vao({ don: d, xemPii: false })).dong[0]!;
    expect(khongPii).toMatchObject({ taiPdf: null, taiXml: null });
    expect(khongPii.lyDoKhongTai).toMatch(/quyền xem thông tin khách/);
    const coPii = dungKhoiHoaDonDon(vao({ don: d, xemPii: true })).dong[0]!;
    expect(coPii).toMatchObject({ taiPdf: null, taiXml: null });
    expect(coPii.lyDoKhongTai).toMatch(/ngoài phạm vi/);
  });

  it("kho chưa cấu hình ⇒ route trả 503 ⇒ KHÔNG nút, lý do là kho", () => {
    const { dong } = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDienTu: [hoaDon()] }), khoOk: false }));
    expect(dong[0]).toMatchObject({ taiPdf: null, taiXml: null });
    expect(dong[0]!.lyDoKhongTai).toMatch(/Kho lưu hoá đơn chưa cấu hình/);
  });
});

describe("[KHD-03] trạng thái email của bản đã xác nhận", () => {
  const hd = { trangThai: "DA_XAC_NHAN", guiEmailKhach: true, emailNhan: EMAIL };

  it("bản chưa xác nhận ⇒ không nói gì về email", () => {
    expect(trangThaiEmailHoaDon({ ...hd, trangThai: "NHAP" }, null, null, true, true)).toBeNull();
  });

  it("kế toán bỏ tick ⇒ BO_TICK; khách không email ⇒ KHONG_CO_EMAIL kèm lời dặn gửi Zalo", () => {
    expect(trangThaiEmailHoaDon({ ...hd, guiEmailKhach: false }, null, null, true, true)?.loai).toBe("BO_TICK");
    const k = trangThaiEmailHoaDon({ ...hd, emailNhan: null }, null, null, true, true);
    expect(k).toMatchObject({ loai: "KHONG_CO_EMAIL", tone: "warning" });
    expect(k!.nhan).toMatch(/tải về gửi qua Zalo/);
  });

  it("[KHD-03b] KHÔNG có nút tải ⇒ câu dặn KHÔNG bảo 'tải về' (luật 12) mà bảo nhờ kế toán", () => {
    const k = trangThaiEmailHoaDon({ ...hd, emailNhan: null }, null, null, false, false);
    expect(k!.nhan).not.toMatch(/tải về/);
    expect(k!.nhan).toMatch(/nhờ kế toán/);
    const loi = trangThaiEmailHoaDon(hd, luot({ trangThai: "LOI" }), null, true, false);
    expect(loi!.nhan).not.toMatch(/tải về/);
    // Qua khối: dòng mà route không cho tải cũng không được dặn "tải về".
    const d = don({ hoaDonDienTu: [hoaDon({ emailNhan: null, taiDuoc: false })] });
    const r = dungKhoiHoaDonDon(vao({ don: d, xemPii: false })).dong[0]!;
    expect(r.taiPdf).toBeNull();
    expect(r.email!.nhan).not.toMatch(/tải về/);
    // Đối chứng: tải được thì dặn tải về.
    const r2 = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDienTu: [hoaDon({ emailNhan: null })] }) })).dong[0]!;
    expect(r2.email!.nhan).toMatch(/tải về gửi qua Zalo/);
  });

  it("lượt CHO ⇒ 'Đang chờ gửi'; worker đang thử lại ⇒ nói lần thử", () => {
    expect(trangThaiEmailHoaDon(hd, luot(), null, true, true)?.loai).toBe("CHO_GUI");
    const dang = trangThaiEmailHoaDon(
      hd,
      luot({ trangThai: "DANG_GUI" }),
      { id: "q1", status: "PENDING", sentAt: null, attempts: 1, maxAttempts: 3 },
      true,
      true,
    );
    expect(dang).toMatchObject({ loai: "DANG_GUI", tone: "info" });
    expect(dang!.nhan).toContain("lần 2/3");
  });

  it("hàng đợi SENT ⇒ ĐÃ GỬI kèm giờ VIỆT NAM của `sentAt` (lượt gửi chưa kịp cập nhật vẫn đúng)", () => {
    const e = trangThaiEmailHoaDon(
      hd,
      luot({ trangThai: "DANG_GUI" }),
      { id: "q1", status: "SENT", sentAt: new Date("2026-09-11T02:12:00Z"), attempts: 1, maxAttempts: 3 },
      true,
      true,
    );
    expect(e).toMatchObject({ loai: "DA_GUI", tone: "success" });
    expect(e!.nhan).toBe(`Đã gửi tới ${EMAIL} lúc 09:12 11/09/2026`);
  });

  it("hàng đợi FAILED dù lượt gửi còn DANG_GUI ⇒ LỖI + lời dặn tải về gửi Zalo", () => {
    const e = trangThaiEmailHoaDon(
      hd,
      luot({ trangThai: "DANG_GUI" }),
      { id: "q1", status: "FAILED", sentAt: null, attempts: 3, maxAttempts: 3 },
      true,
      true,
    );
    expect(e).toMatchObject({ loai: "LOI", tone: "danger" });
    expect(e!.nhan).toMatch(/Zalo/);
  });

  it("văn bản lỗi của nhà cung cấp CHỈ hiện khi có quyền xem PII", () => {
    const l = luot({ trangThai: "LOI", loi: `550 mailbox ${EMAIL} unavailable` });
    expect(trangThaiEmailHoaDon(hd, l, null, true, true)?.chiTiet).toContain("550");
    expect(trangThaiEmailHoaDon(hd, l, null, false, true)?.chiTiet).toBeNull();
  });

  it("dựng qua khối: lượt gửi MỚI NHẤT ghép đúng dòng hàng đợi theo id", () => {
    const d = don({ hoaDonDienTu: [hoaDon({ guiEmail: [luot({ lanGui: 2, emailQueueId: "q2", trangThai: "DANG_GUI" })] })] });
    const { dong } = dungKhoiHoaDonDon(
      vao({
        don: d,
        hangDoi: [
          { id: "q1", status: "FAILED", sentAt: null, attempts: 3, maxAttempts: 3 },
          { id: "q2", status: "SENT", sentAt: new Date("2026-09-12T01:00:00Z"), attempts: 1, maxAttempts: 3 },
        ],
      }),
    );
    expect(dong[0]!.email).toMatchObject({ loai: "DA_GUI" });
  });
});

describe("[KHD-04] DTO không mang thứ phải che", () => {
  const dCoDuThu = () =>
    don({
      hoaDonDienTu: [
        hoaDon({
          guiEmail: [luot({ trangThai: "LOI", loi: `550 mailbox ${EMAIL} unavailable` })],
          lyDo: null,
        }),
      ],
    });

  it("thiếu `orders:view-pii` ⇒ email bị che, không lỗi nhà cung cấp, không lý do không xuất", () => {
    const json = JSON.stringify(dungKhoiHoaDonDon(vao({ don: dCoDuThu(), xemPii: false })));
    expect(json).not.toContain(EMAIL);
    expect(json).toContain("ph***************@gmail.com"); // đối chứng: dòng email VẪN có, chỉ bị che
    expect(json).not.toContain("550 mailbox");

    const kx = don({ hoaDonDienTu: [hoaDon({ trangThai: "KHONG_XUAT", lyDo: "Khách lấy HĐ công ty MST 0401234567" })] });
    expect(JSON.stringify(dungKhoiHoaDonDon(vao({ don: kx, xemPii: false })))).not.toContain("0401234567");
  });

  it("đối chứng dương: CÓ quyền ⇒ email đầy đủ + lỗi nhà cung cấp hiện ra", () => {
    const json = JSON.stringify(dungKhoiHoaDonDon(vao({ don: dCoDuThu(), xemPii: true })));
    expect(json).toContain(EMAIL);
    expect(json).toContain("550 mailbox");
  });

  it("KHÔNG BAO GIỜ mang: khoá tệp, MST, địa chỉ, tên đơn vị, CCCD, SĐT, id khoản — kể cả khi có quyền", () => {
    const json = JSON.stringify(dungKhoiHoaDonDon(vao({ don: dCoDuThu(), xemPii: true })));
    for (const cam of [
      "khoa-pdf-bi-mat",
      "khoa-xml-bi-mat",
      "0401234567",
      "12 Lê Lợi",
      "Công ty TNHH Bí Mật",
      "048123456789",
      "0905123456",
      "\"p1\"",
      "hd-123.pdf",
    ]) {
      expect(json, cam).not.toContain(cam);
    }
  });
});

describe("[KHD-05] đơn chưa gắn cơ sở + thứ tự", () => {
  it("không cơ sở ⇒ không dòng nào, nhưng ĐẾM số khoản để khối nói ra", () => {
    const k = dungKhoiHoaDonDon(vao({ don: don({ centerId: null, center: null }) }));
    expect(k).toEqual({ dong: [], thieuCoSo: 1, lichSu: 0 });
  });

  it("[KHD-05b] tiền thu TRƯỚC khi lên hệ thống ⇒ không dòng nào nhưng ĐẾM, để khối không nói 'chưa có khoản thu'", () => {
    // Bản đầu bỏ im lặng nhóm này ⇒ đơn chỉ có tiền cũ hiện "Chưa có khoản thu nào… sau khi tiền về"
    // trong khi sổ tiền cùng trang ghi đã thu (review GĐ 7; GĐ0 đo 122/154 khoản prod thuộc nhóm LOẠI).
    const d = don({
      payments: [
        khoan({ id: "cu1", note: `${BACKFILL_PAYMENT_MARKER} nhập từ sheet` }),
        khoan({ id: "cu2", note: "[sheet:T7-2026#12]" }),
      ],
      paymentRequests: [],
    });
    expect(dungKhoiHoaDonDon(vao({ don: d }))).toEqual({ dong: [], thieuCoSo: 0, lichSu: 2 });
  });

  it("[KHD-05c] khoản LOẠI không phải tiền (kế toán từ chối, bút toán đảo) KHÔNG đếm vào tiền cũ", () => {
    const d = don({
      payments: [khoan({ id: "tc", accountantStatus: "REJECTED", note: null }), khoan({ id: "dao", paymentType: "ADJUSTMENT", note: null })],
      paymentRequests: [],
    });
    expect(dungKhoiHoaDonDon(vao({ don: d }))).toEqual({ dong: [], thieuCoSo: 0, lichSu: 0 });
  });

  it("[KHD-05d] khoá dòng DUY NHẤT — đợt đã xuất theo số đã thu rồi có thêm tiền về cho đúng đợt ấy", () => {
    const d = don({
      payments: [
        khoan({ id: "p1", amount: 2_000_000 }),
        khoan({ id: "p2", amount: 1_000_000, note: gatewayMarker("SEPAY", "FT2"), paidDate: new Date("2026-09-12T03:00:00Z") }),
      ],
      paymentRequests: [
        {
          id: "dot1",
          orderItemId: null,
          installmentNo: 1,
          amountDue: 3_000_000,
          status: "PAID",
          allocations: [
            { bankTransactionId: "bt1", paymentRequestId: "dot1", amount: 2_000_000, roundingWaived: 0 },
            { bankTransactionId: "bt2", paymentRequestId: "dot1", amount: 1_000_000, roundingWaived: 0 },
          ],
        },
      ],
      hoaDonDienTu: [hoaDon({ tongTien: 2_000_000, xuatTheoSoDaThu: true, khoan: [{ paymentId: "p1", soTien: 2_000_000 }] })],
    });
    const gd = [
      { ...GD[0]!, amount: 2_000_000 },
      { id: "bt2", provider: "SEPAY", providerTxnId: "FT2", transferredAt: new Date("2026-09-12T10:00:00Z"), amount: 1_000_000 },
    ];
    // Màn kế toán cũng phải ra hai khoá khác nhau (`khoaDuyNhat` trong dong-hang-cho.ts — trước bản vá
    // hai dòng này cùng một khoá lần thu).
    const goc = dungDongHangCho({ don: d, giaoDich: gd, giaoDichChuaKhop: [], userId: "u", coQuyen: false, khoOk: true, canViewPii: true, hangDoi: [], gop: [], misa: null });
    expect(goc.dong).toHaveLength(2);
    expect(new Set(goc.dong.map((x) => x.key)).size).toBe(2);

    const { dong } = dungKhoiHoaDonDon(vao({ don: d, giaoDich: gd }));
    expect(dong.map((x) => x.trangThai).sort()).toEqual(["CHO", "DA_XUAT"]);
    expect(new Set(dong.map((x) => x.key)).size).toBe(2);
    expect(dong.find((x) => x.trangThai === "DA_XUAT")!.key).toBe("hd:hd1");
  });

  it("lần thu cũ nhất lên trước", () => {
    const d = don({
      payments: [
        khoan({ id: "p2", note: gatewayMarker("SEPAY", "FT2"), paidDate: new Date("2026-09-15T03:00:00Z") }),
        khoan({ id: "p1" }),
      ],
      paymentRequests: [
        {
          id: "dot1",
          orderItemId: null,
          installmentNo: 1,
          amountDue: 3_000_000,
          status: "PAID",
          allocations: [{ bankTransactionId: "bt1", paymentRequestId: "dot1", amount: 3_000_000, roundingWaived: 0 }],
        },
        {
          id: "dot2",
          orderItemId: null,
          installmentNo: 2,
          amountDue: 3_000_000,
          status: "PAID",
          allocations: [{ bankTransactionId: "bt2", paymentRequestId: "dot2", amount: 3_000_000, roundingWaived: 0 }],
        },
      ],
    });
    const gd = [
      ...GD,
      { id: "bt2", provider: "SEPAY", providerTxnId: "FT2", transferredAt: new Date("2026-09-15T10:00:00Z"), amount: 3_000_000 },
    ];
    const { dong } = dungKhoiHoaDonDon(vao({ don: d, giaoDich: gd }));
    expect(dong.map((x) => x.nhanDot)).toEqual(["Đợt 1/2", "Đợt 2/2"]);
  });
});

describe("[KHD-06] hoá đơn đã huỷ đứng trước lần thu (GĐ 8)", () => {
  const huy = (o: Partial<DonVaoKhoi["hoaDonDaHuy"][number]> = {}): DonVaoKhoi["hoaDonDaHuy"][number] => ({
    id: "hd-cu",
    kyHieu: "1C26TSR",
    soHoaDon: "100",
    huyLuc: new Date("2026-09-12T02:00:00Z"),
    huyLyDo: "MST 0401234567 sai",
    coTepPdf: true,
    paymentIds: ["p1"],
    ...o,
  });

  it("chưa có bản mới ⇒ dặn sale ĐỪNG gửi bản cũ; KHÔNG mang lý do huỷ", () => {
    const k = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDaHuy: [huy()] }) }));
    expect(k.dong[0]).toMatchObject({ trangThai: "CHO" });
    expect(k.dong[0]!.huyTruoc).toBe("Hoá đơn 1C26TSR-100 đã huỷ ngày 12/09/2026 — đừng gửi bản cũ cho khách, chờ kế toán xuất lại");
    expect(JSON.stringify(k)).not.toContain("0401234567");
  });

  it("đã có bản mới ⇒ 'Thay cho hoá đơn … đã huỷ'", () => {
    const k = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDienTu: [hoaDon()], hoaDonDaHuy: [huy()] }) }));
    expect(k.dong[0]!.huyTruoc).toBe("Thay cho hoá đơn 1C26TSR-100 đã huỷ ngày 12/09/2026");
  });

  it("đối chứng: không có bản đã huỷ ⇒ không câu nào", () => {
    expect(dungKhoiHoaDonDon(vao()).dong[0]!.huyTruoc).toBeNull();
  });
});

describe("[PHM-K1] bước 1 MISA — khối Hoá đơn của sale", () => {
  it("bản ĐANG / LỖI phát hành ⇒ chỉ 'Đang xuất hoá đơn'; KHÔNG lộ mã lỗi / thông điệp MISA, không nút tải", () => {
    for (const trangThai of ["DANG_PHAT_HANH", "LOI_PHAT_HANH"]) {
      const k = dungKhoiHoaDonDon(
        vao({
          don: don({
            hoaDonDienTu: [
              hoaDon({ trangThai, soHoaDon: null, tepPdfKey: null, tepXmlKey: null, misaLoiMa: "InvalidTaxCode", misaLoiThongDiep: "MST 0401234567 sai" }),
            ],
          }),
        }),
      );
      expect(k.dong).toHaveLength(1);
      expect(k.dong[0]).toMatchObject({ trangThai: "DANG_XU_LY", nhan: "Đang xuất hoá đơn", taiPdf: null });
      expect(JSON.stringify(k)).not.toMatch(/InvalidTaxCode|0401234567 sai/);
    }
  });

  it("bản ĐÃ XÁC NHẬN nguồn MISA_API ⇒ như hoá đơn thường (tải được); MISA_GIA_LAP ⇒ nhãn MÔ PHỎNG", () => {
    const that = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDienTu: [hoaDon({ nguonPhatHanh: "MISA_API" })] }) }));
    expect(that.dong[0]).toMatchObject({ trangThai: "DA_XUAT", nhan: "Đã xuất hoá đơn", tone: "success" });
    expect(that.dong[0]!.taiPdf).toBeTruthy();
    const moPhong = dungKhoiHoaDonDon(vao({ don: don({ hoaDonDienTu: [hoaDon({ nguonPhatHanh: "MISA_GIA_LAP" })] }) }));
    expect(moPhong.dong[0]!.nhan).toMatch(/MÔ PHỎNG — không có giá trị pháp lý/);
    expect(moPhong.dong[0]!.tone).toBe("warning");
  });
});
