// Ca [DHC-*] — dựng DÒNG của màn hoá đơn từ dữ liệu MỘT đơn đã nạp (docs/ke-toan-hoa-don/PLAN.md §4, §10).
//
// Hàm thuần ghép các luật đã có (phanLoaiKhoan · soTienRong · gomLanThu · hanhDongChoDong ·
// nguoiMuaChoDon) thành DTO đưa xuống client. Loader chỉ còn lo truy vấn, nên mọi quyết định "dòng
// này vào ngăn nào, vẽ gì, che gì" kiểm được ở đây không cần DB.
import { describe, it, expect } from "vitest";
import { dungDongHangCho, type DonVaoHangCho } from "./dong-hang-cho";
import { gatewayMarker, installmentMarker } from "@/lib/finance/payment-markers";
import { maskEmail } from "@/lib/utils";
import { bamNguoiMua } from "./bam-nguoi-mua";
import { nguoiMuaChoDon } from "./nguoi-mua";
import { CAU_HOAN_CHAN_XAC_NHAN } from "./hoan-tien-don";
import { LY_DO_DA_XUAT_NGOAI, LY_DO_KHACH_KHONG_LAY } from "./ly-do-khong-xuat";

const khoan = (o: Partial<DonVaoHangCho["payments"][number]> & { id: string }): DonVaoHangCho["payments"][number] => ({
  amount: 3_000_000,
  method: "BANK_TRANSFER",
  note: gatewayMarker("SEPAY", "FT1"),
  paymentType: "PAYMENT",
  accountantStatus: "PENDING",
  enrollmentId: "enr1",
  orderItemId: null,
  recordedById: null,
  adjustmentOfId: null,
  paidDate: new Date("2026-09-10T03:00:00Z"),
  deletedAt: null,
  createdAt: new Date("2026-09-10T03:00:00Z"),
  ...o,
});

const don = (o: Partial<DonVaoHangCho> = {}): DonVaoHangCho => ({
  id: "don1",
  code: "ORD-260910-000001",
  type: "COURSE",
  status: "CONFIRMED",
  centerId: "cs1",
  deletedAt: null,
  center: { code: "CS1", name: "Cơ sở 1" },
  customerName: "Nguyễn Phương Quỳnh Anh",
  customerPhone: "0905123456",
  customerEmail: "phuhuynh@gmail.com",
  customerAddress: "12 Lê Lợi",
  customerWard: null,
  customerCity: "Đà Nẵng",
  customerCccd: null,
  invoiceBuyerName: null,
  invoiceCompanyName: null,
  invoiceTaxCode: null,
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

// Trạng thái kế toán đã xác nhận — hằng, không gõ literal (lưới `truc-a` [BUOC-6] quét cả tệp test).
const DA_XAC_NHAN = "CONFIRMED";

const GD = [
  { id: "bt1", provider: "SEPAY", providerTxnId: "FT1", transferredAt: new Date("2026-09-10T10:00:00Z"), amount: 3_000_000 },
];

type Vao = Parameters<typeof dungDongHangCho>[0];
const vao = (o: Partial<Vao> = {}): Vao => ({
  don: don(),
  giaoDich: GD,
  giaoDichChuaKhop: [],
  userId: "ke-toan",
  coQuyen: true,
  khoOk: true,
  canViewPii: true,
  hangDoi: [],
  gop: [],
  misa: null,
  ...o,
});

describe("[DHC-01] đường vui — một lần chuyển khoản đủ đợt", () => {
  it("một dòng, ngăn 'cho', nhãn đợt, số tiền, ngày theo lịch VN, nút xác nhận chờ tệp", () => {
    const { dong } = dungDongHangCho(vao());
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({
      key: "dot:dot1",
      orderId: "don1",
      maDon: "ORD-260910-000001",
      tenKhach: "Nguyễn Phương Quỳnh Anh",
      ngan: "cho",
      nhanDot: "Đợt 1",
      soTien: 3_000_000,
      ngayThu: "2026-09-10",
      ngayThuLabel: "10/09/2026",
      nguon: "CK",
      khoanIds: ["p1"],
      kyHieuMau: "1C26TSR",
    });
    expect(dong[0]!.hanhDong.xacNhan).toMatchObject({ bat: false, lyDo: expect.stringMatching(/PDF/) });
    expect(dong[0]!.nhan).toBe("Chờ xuất");
    expect(dong[0]!.tone).toBe("warning");
  });

  it("khoan[] mang số RÒNG — khoản gốc đã bị đảo một phần in đúng phần còn lại", () => {
    const d = don({
      payments: [
        khoan({ id: "p1" }),
        khoan({ id: "dao", amount: -1_000_000, paymentType: "ADJUSTMENT", adjustmentOfId: "p1", note: null }),
      ],
    });
    const { dong } = dungDongHangCho(vao({ don: d }));
    const r = dong.find((x) => x.khoanIds.includes("p1"))!;
    expect(r.khoan).toEqual([{ id: "p1", soTien: 2_000_000 }]);
  });
});

describe("[DHC-02] khoản ĐÃ KHOÁ vào hoá đơn không vào hàng chờ — nhưng dòng NHÁP giữ ĐÚNG khoá", () => {
  it("có hoá đơn nháp giữ p1 ⇒ không còn dòng 'cho'; có dòng 'nhap' mang CÙNG khoá dot:dot1", () => {
    const { dong } = dungDongHangCho(
      vao({
        don: don({
          hoaDonDienTu: [
            {
              id: "hd1",
              trangThai: "NHAP",
              kyHieu: "1C26TSR",
              soHoaDon: "127",
              ngayPhatHanh: new Date("2026-09-12T00:00:00Z"),
              tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
              tepPdfTen: "hd.pdf",
              tepXmlTen: null,
              emailNhan: "phuhuynh@gmail.com",
              guiEmailKhach: true,
              xuatTheoSoDaThu: false,
              lyDo: null,
              xacNhanLuc: null,
              tongTien: 3_000_000,
              createdAt: new Date("2026-09-12T01:00:00Z"),
              updatedAt: new Date("2026-09-12T01:00:00Z"),
              khongTrungLyDo: null,
              nguoiMuaHashLucIn: null,
              nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
              xuatTheoSoDaThuLyDo: null,
              guiEmail: [],
              khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
            },
          ],
        }),
      }),
    );
    expect(dong.map((d) => [d.ngan, d.key])).toEqual([["nhap", "dot:dot1"]]);
    expect(dong[0]!.hoaDonNhap).toMatchObject({ id: "hd1", soHoaDon: "127", ngayPhatHanh: "2026-09-12" });
    expect(dong[0]!.hoaDon).toEqual({
      id: "hd1",
      trangThai: "NHAP",
      nguon: "TAI_LEN",
      kyHieu: "1C26TSR",
      soHoaDon: "127",
      ngayPhatHanh: "2026-09-12",
      coPdf: true,
      coXml: false,
    });
    // Đủ tệp + số ⇒ Xác nhận sáng (hành vi GĐ 5 dựa trên chính cờ này).
    expect(dong[0]!.hanhDong.xacNhan.bat).toBe(true);
  });

  it("hoá đơn KHÔNG XUẤT ⇒ ngăn 'khong-xuat', lý do đi kèm", () => {
    const { dong } = dungDongHangCho(
      vao({
        don: don({
          hoaDonDienTu: [
            {
              id: "hd2",
              trangThai: "KHONG_XUAT",
              kyHieu: null,
              soHoaDon: null,
              ngayPhatHanh: null,
              tepPdfKey: null,
              tepPdfTen: null,
              tepXmlTen: null,
              emailNhan: null,
              guiEmailKhach: false,
              xuatTheoSoDaThu: false,
              lyDo: "Đã xuất ngoài hệ thống",
              xacNhanLuc: null,
              tongTien: 3_000_000,
              createdAt: new Date("2026-09-12T01:00:00Z"),
              updatedAt: new Date("2026-09-12T01:00:00Z"),
              khongTrungLyDo: null,
              nguoiMuaHashLucIn: null,
              nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
              xuatTheoSoDaThuLyDo: null,
              guiEmail: [],
              khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
            },
          ],
        }),
      }),
    );
    expect(dong.map((d) => d.ngan)).toEqual(["khong-xuat"]);
    expect(dong[0]!.lyDoKhongXuat).toBe("Đã xuất ngoài hệ thống");
    expect(dong[0]!.hoaDon).toMatchObject({ id: "hd2", trangThai: "KHONG_XUAT", coPdf: false });
    // Không phải nháp ⇒ `hoaDonNhap` trống (action lưu nháp dựa vào đúng cờ này).
    expect(dong[0]!.hoaDonNhap).toBeNull();
    expect(dong[0]!.tone).toBe("muted");
  });
});

describe("[DHC-03] ngăn theo trạng thái lần thu", () => {
  it("THIẾU ⇒ ngăn 'lech', nhãn nói số thiếu", () => {
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
    const { dong } = dungDongHangCho(vao({ don: d }));
    expect(dong[0]).toMatchObject({ ngan: "lech", tone: "danger", nhan: "Thiếu 1.000.000đ" });
  });

  it("đơn đã huỷ ⇒ ngăn 'don-huy'", () => {
    const { dong } = dungDongHangCho(vao({ don: don({ status: "CANCELLED" }) }));
    expect(dong.map((d) => d.ngan)).toEqual(["don-huy"]);
  });

  it("lời khai + chuyển khoản cùng đơn ⇒ dòng lời khai vào 'lech' (nghi trùng)", () => {
    const d = don({
      payments: [khoan({ id: "p1" }), khoan({ id: "khai", note: installmentMarker(1), method: "auto" })],
    });
    const { dong } = dungDongHangCho(vao({ don: d }));
    const khai = dong.find((x) => x.khoanIds.includes("khai"))!;
    expect(khai).toMatchObject({ ngan: "lech", nhan: "Nghi trùng" });
  });

  it("đơn thiếu cơ sở ⇒ KHÔNG ra dòng, đếm riêng", () => {
    const r = dungDongHangCho(vao({ don: don({ centerId: null, center: null }) }));
    expect(r.dong).toEqual([]);
    expect(r.thieuCoSo).toBe(1);
  });
});

describe("[DHC-04] cảnh báo — khoản không xác nhận được không chặn", () => {
  it("khoản CHỜ thiếu ghi danh ⇒ cảnh báo", () => {
    const { dong } = dungDongHangCho(vao({ don: don({ payments: [khoan({ id: "p1", enrollmentId: null })] }) }));
    expect(dong[0]!.hanhDong.canhBao.join(" ")).toMatch(/chưa gắn ghi danh/);
  });

  it("khoản CHỜ do chính kế toán ghi ⇒ cảnh báo AC5", () => {
    const { dong } = dungDongHangCho(vao({ don: don({ payments: [khoan({ id: "p1", recordedById: "ke-toan" })] }) }));
    expect(dong[0]!.hanhDong.canhBao.join(" ")).toMatch(/người khác xác nhận/);
  });

  it("khoản ĐÃ xác nhận thì không nhắc gì", () => {
    const { dong } = dungDongHangCho(
      vao({ don: don({ payments: [khoan({ id: "p1", enrollmentId: null, accountantStatus: DA_XAC_NHAN })] }) }),
    );
    expect(dong[0]!.hanhDong.canhBao.join(" ")).not.toMatch(/ghi danh/);
  });
});

describe("[DHC-05] PII và quyền", () => {
  it("thiếu orders:view-pii ⇒ che SĐT + email; tên không che", () => {
    const { dong } = dungDongHangCho(vao({ canViewPii: false }));
    expect(dong[0]!.tenKhach).toBe("Nguyễn Phương Quỳnh Anh");
    expect(dong[0]!.sdt).not.toBe("0905123456");
    expect(dong[0]!.emailNhan).not.toBe("phuhuynh@gmail.com");
    expect(JSON.stringify(dong[0])).not.toContain("0905123456");
    expect(JSON.stringify(dong[0])).not.toContain("12 Lê Lợi");
  });

  it("không phải kế toán của cơ sở ⇒ mọi nút tắt", () => {
    const { dong } = dungDongHangCho(vao({ coQuyen: false }));
    expect(dong[0]!.hanhDong.taiPhieu).toBe(false);
    expect(dong[0]!.hanhDong.taiLen.bat).toBe(false);
  });

  it("PH có khai thông tin hoá đơn ⇒ cờ coTtHoaDon", () => {
    const { dong } = dungDongHangCho(vao({ don: don({ invoiceCompanyName: "Công ty ABC" }) }));
    expect(dong[0]!.coTtHoaDon).toBe(true);
  });
});

describe("[DHC-KEY] khoá dòng DUY NHẤT trong đơn — `?chon=` / phiếu chờ / action đều `find` theo nó", () => {
  // Đợt 1 = 3.000.000đ. p1 2.000.000đ đã lên hoá đơn "theo số đã thu"; p2 1.000.000đ về SAU cho đúng
  // đợt ấy. Khoá lần thu của hai dòng đều là khoá của đợt 1 ⇒ trước bản vá `find` trả dòng hoá đơn cũ,
  // kế toán không mở được dòng tiền mới và lưu hoá đơn thì bị từ chối ⇒ p2 kẹt hàng chờ vĩnh viễn.
  type HoaDonVao = DonVaoHangCho["hoaDonDienTu"][number];
  const hdCua = (id: string, trangThai: HoaDonVao["trangThai"], paymentId: string, soTien: number): HoaDonVao => ({
    id,
    trangThai,
    kyHieu: "1C26TSR",
    soHoaDon: id === "hdA" ? "101" : "102",
    ngayPhatHanh: new Date("2026-09-12T00:00:00Z"),
    tepPdfKey: `hoa-don/CS1/2026/don1/${id}.pdf`,
    tepPdfTen: `${id}.pdf`,
    tepXmlTen: null,
    emailNhan: null,
    guiEmailKhach: true,
    xuatTheoSoDaThu: true,
    lyDo: "Phụ huynh trả nốt sau",
    xacNhanLuc: null,
    tongTien: soTien,
    createdAt: new Date("2026-09-12T01:00:00Z"),
    updatedAt: new Date("2026-09-12T01:00:00Z"),
    khongTrungLyDo: null,
    nguoiMuaHashLucIn: null,
    nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
    xuatTheoSoDaThuLyDo: null,
    guiEmail: [],
    khoan: [{ paymentId, soTien }],
  });
  const dVoi = (hoaDonDienTu: HoaDonVao[]) =>
    don({
      payments: [
        khoan({ id: "p1", amount: 2_000_000, accountantStatus: DA_XAC_NHAN }),
        khoan({ id: "p2", amount: 1_000_000, note: gatewayMarker("SEPAY", "FT2"), paidDate: new Date("2026-09-15T03:00:00Z") }),
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
      hoaDonDienTu,
    });
  const gd = [
    { ...GD[0]!, amount: 2_000_000 },
    { id: "bt2", provider: "SEPAY", providerTxnId: "FT2", transferredAt: new Date("2026-09-15T10:00:00Z"), amount: 1_000_000 },
  ];
  const khoaTheoKhoan = (dong: { key: string; khoanIds: string[] }[]) =>
    Object.fromEntries(dong.map((d) => [d.khoanIds[0], d.key]));

  it("tiền mới (chờ) + hoá đơn cũ (đã xuất) ⇒ HAI khoá; dòng ĐANG xử lý giữ khoá gốc", () => {
    const { dong } = dungDongHangCho(vao({ don: dVoi([hdCua("hdA", "DA_XAC_NHAN", "p1", 2_000_000)]), giaoDich: gd }));
    expect(dong).toHaveLength(2);
    const k = khoaTheoKhoan(dong);
    expect(k.p1).not.toBe(k.p2);
    expect(k.p2).not.toContain("~");
    expect(k.p1).toBe(`${k.p2}~hdA`);
    // Chính phép tra của màn / action: bấm dòng tiền mới thì ra ĐÚNG dòng tiền mới.
    expect(dong.find((d) => d.key === k.p2)!.khoanIds).toEqual(["p2"]);
  });

  it("tải tệp cho tiền mới (nháp) ⇒ dòng ấy VẪN giữ khoá gốc (`?chon=` + audit phiếu chờ không đứt)", () => {
    const truoc = khoaTheoKhoan(dungDongHangCho(vao({ don: dVoi([hdCua("hdA", "DA_XAC_NHAN", "p1", 2_000_000)]), giaoDich: gd })).dong);
    const sau = khoaTheoKhoan(
      dungDongHangCho(
        vao({ don: dVoi([hdCua("hdA", "DA_XAC_NHAN", "p1", 2_000_000), hdCua("hdB", "NHAP", "p2", 1_000_000)]), giaoDich: gd }),
      ).dong,
    );
    expect(sau.p2).toBe(truoc.p2);
    expect(new Set(Object.values(sau)).size).toBe(2);
  });

  it("chốt xong cả hai ⇒ lần thu MỚI hơn giữ khoá gốc; khoá vẫn duy nhất", () => {
    const k = khoaTheoKhoan(
      dungDongHangCho(
        vao({
          don: dVoi([hdCua("hdA", "DA_XAC_NHAN", "p1", 2_000_000), hdCua("hdB", "DA_XAC_NHAN", "p2", 1_000_000)]),
          giaoDich: gd,
        }),
      ).dong,
    );
    expect(k.p2).not.toContain("~");
    expect(k.p1).toBe(`${k.p2}~hdA`);
  });

  it("đối chứng: KHÔNG trùng thì không gắn đuôi — khoá cũ đứng yên", () => {
    const { dong } = dungDongHangCho(vao());
    expect(dong.map((d) => d.key)).toEqual(["dot:dot1"]);
  });
});

describe("[DHC-17..20] GĐ 8 — cần điều chỉnh · hoá đơn đã huỷ · nút huỷ", () => {
  type HoaDonVao = DonVaoHangCho["hoaDonDienTu"][number];
  const XN = new Date("2026-09-11T02:00:00Z");
  const daXacNhan = (o: Partial<HoaDonVao> = {}): HoaDonVao => ({
    id: "hd1",
    trangThai: "DA_XAC_NHAN",
    kyHieu: "1C26TSR",
    soHoaDon: "127",
    ngayPhatHanh: new Date("2026-09-11T00:00:00Z"),
    tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
    tepPdfTen: "hd.pdf",
    tepXmlTen: null,
    emailNhan: null,
    guiEmailKhach: true,
    xuatTheoSoDaThu: false,
    lyDo: null,
    xacNhanLuc: XN,
    tongTien: 3_000_000,
    createdAt: new Date("2026-09-12T01:00:00Z"),
    updatedAt: new Date("2026-09-12T01:00:00Z"),
    khongTrungLyDo: null,
    nguoiMuaHashLucIn: null,
    nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
    xuatTheoSoDaThuLyDo: null,
    guiEmail: [],
    khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
    ...o,
  });
  const hoan = (createdAt: Date, amount = -1_000_000) =>
    khoan({ id: "hoan", amount, paymentType: "REFUND", adjustmentOfId: "p1", note: null, createdAt, accountantStatus: DA_XAC_NHAN });

  it("[DHC-17a] hoàn tiền SAU khi xuất ⇒ ngăn 'can-dieu-chinh', nhãn đỏ, đủ hai lý do", () => {
    const d = don({ payments: [khoan({ id: "p1", accountantStatus: DA_XAC_NHAN }), hoan(new Date("2026-09-15T02:00:00Z"))], hoaDonDienTu: [daXacNhan()] });
    const r = dungDongHangCho(vao({ don: d })).dong.find((x) => x.hoaDon?.id === "hd1")!;
    expect(r).toMatchObject({ ngan: "can-dieu-chinh", nhan: "Cần điều chỉnh", tone: "danger" });
    expect(r.canDieuChinh).toHaveLength(2);
  });

  it("[DHC-17b] đối chứng: không bút toán nào ⇒ 'da-xuat', không lý do", () => {
    const d = don({ payments: [khoan({ id: "p1", accountantStatus: DA_XAC_NHAN })], hoaDonDienTu: [daXacNhan()] });
    const r = dungDongHangCho(vao({ don: d })).dong[0]!;
    expect(r).toMatchObject({ ngan: "da-xuat", canDieuChinh: [] });
  });

  it("[DHC-17c] đơn bị huỷ sau khi xuất ⇒ 'can-dieu-chinh'", () => {
    const d = don({ status: "CANCELLED", payments: [khoan({ id: "p1", accountantStatus: DA_XAC_NHAN })], hoaDonDienTu: [daXacNhan()] });
    expect(dungDongHangCho(vao({ don: d })).dong.find((x) => x.hoaDon?.id === "hd1")!.ngan).toBe("can-dieu-chinh");
  });

  it("[DHC-17d] bút toán ĐÚNG lúc xác nhận mà không làm lệch số ⇒ vẫn 'da-xuat' (biên)", () => {
    const d = don({ payments: [khoan({ id: "p1", accountantStatus: DA_XAC_NHAN }), hoan(XN, 0)], hoaDonDienTu: [daXacNhan()] });
    expect(dungDongHangCho(vao({ don: d })).dong.find((x) => x.hoaDon?.id === "hd1")!.ngan).toBe("da-xuat");
  });

  it("[DHC-18] khoản CHỈ nằm trong hoá đơn đã huỷ ⇒ trở lại 'cho', mang theo bản đã huỷ; không dòng đã xuất nào", () => {
    const d = don({
      hoaDonDaHuy: [
        { id: "hdA", kyHieu: "1C26TSR", soHoaDon: "127", huyLuc: new Date("2026-09-12T02:00:00Z"), huyLyDo: "Tải nhầm tệp", coTepPdf: true, paymentIds: ["p1"] },
      ],
    });
    const { dong } = dungDongHangCho(vao({ don: d }));
    expect(dong.map((x) => x.ngan)).toEqual(["cho"]);
    expect(dong[0]!.hoaDonDaHuy).toEqual([{ id: "hdA", so: "1C26TSR-127", huyLucLabel: "12/09/2026", lyDo: "Tải nhầm tệp", taiDuoc: true }]);
  });

  it("[DHC-19] nút huỷ: bật trên bản đã xác nhận (có quyền); tắt trên nháp; thiếu quyền ⇒ tắt kèm lý do", () => {
    const xn = don({ payments: [khoan({ id: "p1", accountantStatus: DA_XAC_NHAN })], hoaDonDienTu: [daXacNhan()] });
    expect(dungDongHangCho(vao({ don: xn })).dong[0]!.huy).toEqual({ bat: true });
    const kq = dungDongHangCho(vao({ don: xn, coQuyen: false })).dong[0]!.huy;
    expect(kq.bat).toBe(false);
    expect(kq.lyDo).toMatch(/payments:confirm/);
    const nhap = don({ hoaDonDienTu: [daXacNhan({ trangThai: "NHAP", xacNhanLuc: null })] });
    expect(dungDongHangCho(vao({ don: nhap })).dong[0]!.huy).toEqual({ bat: false });
  });

  it("[DHC-20] tải bản đã huỷ CHỈ khi có quyền + kho sống + có tệp; lý do huỷ theo quyền PII", () => {
    const d = (coTepPdf: boolean) =>
      don({ hoaDonDaHuy: [{ id: "hdA", kyHieu: "1C26TSR", soHoaDon: "127", huyLuc: null, huyLyDo: "MST 0401234567 sai", coTepPdf, paymentIds: ["p1"] }] });
    expect(dungDongHangCho(vao({ don: d(true) })).dong[0]!.hoaDonDaHuy[0]!.taiDuoc).toBe(true);
    expect(dungDongHangCho(vao({ don: d(true), coQuyen: false })).dong[0]!.hoaDonDaHuy[0]!.taiDuoc).toBe(false);
    expect(dungDongHangCho(vao({ don: d(true), khoOk: false })).dong[0]!.hoaDonDaHuy[0]!.taiDuoc).toBe(false);
    expect(dungDongHangCho(vao({ don: d(false) })).dong[0]!.hoaDonDaHuy[0]!.taiDuoc).toBe(false);
    expect(dungDongHangCho(vao({ don: d(true), canViewPii: false })).dong[0]!.hoaDonDaHuy[0]!.lyDo).toBeNull();
  });
});

describe("[DHC-21..25] GĐ 8 — nghi trùng theo CẢ ĐƠN · đơn huỷ nói thật · email của nút Xác nhận", () => {
  type HoaDonVao = DonVaoHangCho["hoaDonDienTu"][number];
  const hd = (o: Partial<HoaDonVao> & { khoan: HoaDonVao["khoan"] }): HoaDonVao => ({
    id: "hd1",
    trangThai: "NHAP",
    kyHieu: "1C26TSR",
    soHoaDon: "130",
    ngayPhatHanh: new Date("2026-09-12T00:00:00Z"),
    tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
    tepPdfTen: "hd.pdf",
    tepXmlTen: null,
    emailNhan: null,
    guiEmailKhach: true,
    xuatTheoSoDaThu: false,
    lyDo: null,
    xacNhanLuc: null,
    tongTien: 3_000_000,
    createdAt: new Date("2026-09-12T01:00:00Z"),
    updatedAt: new Date("2026-09-12T01:00:00Z"),
    khongTrungLyDo: null,
    nguoiMuaHashLucIn: null,
    nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
    xuatTheoSoDaThuLyDo: null,
    guiEmail: [],
    ...o,
  });
  const ck = () => khoan({ id: "p1", accountantStatus: DA_XAC_NHAN });
  const khai = () => khoan({ id: "khai", note: installmentMarker(1), method: "auto" });

  describe("[DHC-30] người mua đổi SAU khi tải phiếu chờ ⇒ bản nháp cảnh báo kiểm lại tờ MISA", () => {
    // Dấu người mua của đơn fixture (không sửa gì) — cùng hàm route phiếu chờ + bước lưu nháp dùng.
    const dauHienTai = bamNguoiMua(nguoiMuaChoDon(don()));
    const CAU = /người mua trên đơn đã đổi sau khi tải phiếu thu chờ/i;
    const nhap = (nguoiMuaHashLucIn: string | null, o: Partial<HoaDonVao> = {}) =>
      dungDongHangCho(
        vao({ don: don({ hoaDonDienTu: [hd({ nguoiMuaHashLucIn, khoan: [{ paymentId: "p1", soTien: 3_000_000 }], ...o })] }) }),
      ).dong.find((x) => x.hoaDon?.id === "hd1")!;

    it("dấu lúc in KHÁC dấu người mua hiện tại ⇒ câu cảnh báo nói việc cần làm (kiểm tờ MISA trước khi xác nhận)", () => {
      const r = nhap(bamNguoiMua({ ...nguoiMuaChoDon(don()), maSoThue: "0401234567" }));
      const cau = r.hanhDong.canhBao.find((c) => CAU.test(c));
      expect(cau).toMatch(/MISA/);
      expect(cau).toMatch(/trước khi xác nhận/);
      // Cảnh báo, KHÔNG chặn — hoá đơn đã nằm ở MISA (bam-nguoi-mua.ts).
      expect(r.hanhDong.xacNhan.bat).toBe(true);
    });

    it("đối chứng: CÙNG dấu ⇒ không cảnh báo", () => {
      expect(nhap(dauHienTai).hanhDong.canhBao.some((c) => CAU.test(c))).toBe(false);
    });

    it("đối chứng: bản nháp cũ KHÔNG có dấu ⇒ không cảnh báo (không bịa ra thay đổi)", () => {
      expect(nhap(null).hanhDong.canhBao.some((c) => CAU.test(c))).toBe(false);
    });

    it("đối chứng: hoá đơn ĐÃ XÁC NHẬN khác dấu ⇒ không cảnh báo ở đây (không còn gì để kiểm trước khi xác nhận)", () => {
      const r = nhap("dau-cu-khac", { trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2026-09-12T02:00:00Z") });
      expect(r.ngan).toBe("da-xuat");
      expect(r.hanhDong.canhBao.some((c) => CAU.test(c))).toBe(false);
    });
  });

  it("[DHC-21] khoản CK đã khoá vào hoá đơn ĐÃ XÁC NHẬN, lời khai còn ở hàng chờ ⇒ lời khai vẫn 'Nghi trùng'", () => {
    const d = don({
      payments: [ck(), khai()],
      hoaDonDienTu: [hd({ trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2026-09-12T02:00:00Z"), khoan: [{ paymentId: "p1", soTien: 3_000_000 }] })],
    });
    const r = dungDongHangCho(vao({ don: d })).dong.find((x) => x.khoanIds.includes("khai"))!;
    expect(r).toMatchObject({ ngan: "lech", nhan: "Nghi trùng" });
  });

  it("[DHC-22] bản nháp giữ RIÊNG lời khai ⇒ Xác nhận TẮT (nói 'trùng'); đã ghi 'không trùng' ⇒ sáng", () => {
    const d = (khongTrungLyDo: string | null) =>
      don({ payments: [khoan({ id: "p1" }), khai()], hoaDonDienTu: [hd({ khongTrungLyDo, khoan: [{ paymentId: "khai", soTien: 3_000_000 }] })] });
    const tat = dungDongHangCho(vao({ don: d(null) })).dong.find((x) => x.hoaDon?.id === "hd1")!;
    expect(tat.hanhDong.xacNhan).toMatchObject({ bat: false, lyDo: expect.stringMatching(/trùng/) });
    expect(tat.hanhDong.ngoaiLe).toMatchObject({ loai: "KHONG_TRUNG", daChon: false });
    const sang = dungDongHangCho(vao({ don: d("Đối chiếu sao kê: khai tay là tiền mặt đợt 1") })).dong.find((x) => x.hoaDon?.id === "hd1")!;
    expect(sang.hanhDong.xacNhan.bat).toBe(true);
    expect(sang.hanhDong.ngoaiLe).toMatchObject({ daChon: true });
    expect(sang.hoaDonNhap!.khongTrungLyDo).toBe("Đối chiếu sao kê: khai tay là tiền mặt đợt 1");
  });

  it("[DHC-23] đơn đã huỷ: dòng hàng chờ nói 'Đơn đã huỷ'; bản nháp KHÔNG xác nhận được (bước chốt sẽ từ chối)", () => {
    const huyCho = dungDongHangCho(vao({ don: don({ status: "CANCELLED" }) })).dong[0]!;
    expect(huyCho.hanhDong.xacNhan.lyDo).toMatch(/Đơn đã huỷ/);
    const nhapHuy = dungDongHangCho(vao({ don: don({ status: "CANCELLED", hoaDonDienTu: [hd({ khoan: [{ paymentId: "p1", soTien: 3_000_000 }] })] }) }))
      .dong.find((x) => x.hoaDon?.id === "hd1")!;
    expect(nhapHuy.hanhDong.xacNhan.bat).toBe(false);
    // Đối chứng: đơn còn sống ⇒ sáng.
    const nhapSong = dungDongHangCho(vao({ don: don({ hoaDonDienTu: [hd({ khoan: [{ paymentId: "p1", soTien: 3_000_000 }] })] }) }))
      .dong.find((x) => x.hoaDon?.id === "hd1")!;
    expect(nhapSong.hanhDong.xacNhan.bat).toBe(true);
    // Nhãn theo ĐƠN, kể cả khi đợt cũng VOID.
    const voidDot = don({
      status: "CANCELLED",
      paymentRequests: [{ id: "dot1", orderItemId: null, installmentNo: 1, amountDue: 3_000_000, status: "VOID", allocations: [{ bankTransactionId: "bt1", paymentRequestId: "dot1", amount: 3_000_000, roundingWaived: 0 }] }],
    });
    expect(dungDongHangCho(vao({ don: voidDot })).dong[0]!.nhan).toBe("Đơn đã huỷ");
  });

  it("[DHC-24] nháp của lần thu THIẾU: có 'xuất theo số đã thu' ⇒ sáng; không ⇒ tắt kèm lối ra; DTO mang phiên bản", () => {
    const thieu = (xuatTheoSoDaThu: boolean) =>
      don({
        payments: [khoan({ id: "p1", amount: 2_000_000 })],
        paymentRequests: [
          { id: "dot1", orderItemId: null, installmentNo: 1, amountDue: 3_000_000, status: "PARTIAL", allocations: [{ bankTransactionId: "bt1", paymentRequestId: "dot1", amount: 2_000_000, roundingWaived: 0 }] },
        ],
        hoaDonDienTu: [
          hd({
            tongTien: 2_000_000,
            xuatTheoSoDaThu,
            xuatTheoSoDaThuLyDo: xuatTheoSoDaThu ? "Phụ huynh không đóng nốt đợt 1" : null,
            khoan: [{ paymentId: "p1", soTien: 2_000_000 }],
          }),
        ],
      });
    const co = dungDongHangCho(vao({ don: thieu(true) })).dong[0]!;
    expect(co.hanhDong.xacNhan.bat).toBe(true);
    expect(co.hoaDonNhap).toMatchObject({ xuatTheoSoDaThu: true, xuatTheoSoDaThuLyDo: "Phụ huynh không đóng nốt đợt 1", phienBan: "2026-09-12T01:00:00.000Z" });
    const khong = dungDongHangCho(vao({ don: thieu(false) })).dong[0]!;
    expect(khong.hanhDong.xacNhan.bat).toBe(false);
    expect(khong.hanhDong.ngoaiLe).toMatchObject({ loai: "THEO_SO_DA_THU", daChon: false });
  });

  it("[DHC-25] nút Xác nhận hứa gửi tới email HIỆN TẠI của đơn (bước chốt chụp lại lúc chốt); đã chốt ⇒ bản chụp", () => {
    const d = (o: Partial<HoaDonVao>) =>
      don({ invoiceEmail: "b1.hoadon@x.vn", hoaDonDienTu: [hd({ khoan: [{ paymentId: "p1", soTien: 3_000_000 }], ...o })] });
    const nhapCu = dungDongHangCho(vao({ don: d({ emailNhan: "a1.cu@x.vn" }) })).dong[0]!;
    expect(nhapCu.emailNhan).toBe("b1.hoadon@x.vn");
    expect(nhapCu.hanhDong.xacNhan.nhan).toContain(maskEmail("b1.hoadon@x.vn"));
    const nhapRong = dungDongHangCho(vao({ don: d({ emailNhan: null }) })).dong[0]!;
    expect(nhapRong.hanhDong.xacNhan.nhan).toContain(maskEmail("b1.hoadon@x.vn"));
    const daChot = dungDongHangCho(vao({ don: d({ trangThai: "DA_XAC_NHAN", emailNhan: "a1.cu@x.vn", xacNhanLuc: new Date("2026-09-12T02:00:00Z") }) })).dong[0]!;
    expect(daChot.emailNhan).toBe("a1.cu@x.vn");
    const kx = dungDongHangCho(vao({ don: d({ trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn", emailNhan: null }) })).dong[0]!;
    expect(kx.emailNhan).toBe("b1.hoadon@x.vn");
  });
});

describe("[DHC-26] GĐ 8 — email của hoá đơn ĐÃ XÁC NHẬN (nút Gửi lại email)", () => {
  type HoaDonVao = DonVaoHangCho["hoaDonDienTu"][number];
  const hd = (o: Partial<HoaDonVao> = {}): HoaDonVao => ({
    id: "hd1",
    trangThai: "DA_XAC_NHAN",
    kyHieu: "1C26TSR",
    soHoaDon: "140",
    ngayPhatHanh: new Date("2026-09-11T00:00:00Z"),
    tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
    tepPdfTen: "hd.pdf",
    tepXmlTen: null,
    emailNhan: "phuhuynh@gmail.com",
    guiEmailKhach: true,
    xuatTheoSoDaThu: false,
    lyDo: null,
    xacNhanLuc: new Date("2026-09-11T02:00:00Z"),
    tongTien: 3_000_000,
    createdAt: new Date("2026-09-11T02:00:00Z"),
    updatedAt: new Date("2026-09-11T02:00:00Z"),
    khongTrungLyDo: null,
    nguoiMuaHashLucIn: null,
    nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
    xuatTheoSoDaThuLyDo: null,
    guiEmail: [],
    khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
    ...o,
  });
  const luotLoi = {
    lanGui: 1,
    toi: "phuhuynh@gmail.com",
    trangThai: "LOI" as const,
    loi: "Resend: mailbox phuhuynh@gmail.com not found",
    emailQueueId: "q1",
    updatedAt: new Date("2026-09-11T03:00:00Z"),
  };
  const ck = () => khoan({ id: "p1", accountantStatus: DA_XAC_NHAN });
  const mot = (d: DonVaoHangCho, o: Partial<Vao> = {}) => {
    const ds = dungDongHangCho(vao({ don: d, ...o })).dong;
    expect(ds).toHaveLength(1);
    return ds[0]!;
  };

  it("có ở CẢ 'da-xuat' lẫn 'can-dieu-chinh'; KHÔNG có ở chờ / nháp / không xuất", () => {
    const daXuat = mot(don({ payments: [ck()], hoaDonDienTu: [hd()] }));
    expect(daXuat.ngan).toBe("da-xuat");
    expect(daXuat.email).toMatchObject({ lanGui: null, guiLai: { bat: true, nhan: "Gửi email cho khách" }, toiMacDinh: "phuhuynh@gmail.com", toiDon: null });

    const hoan = khoan({ id: "hoan", amount: -1_000_000, paymentType: "REFUND", adjustmentOfId: "p1", note: null, createdAt: new Date("2026-09-15T02:00:00Z"), accountantStatus: DA_XAC_NHAN });
    const cdc = dungDongHangCho(vao({ don: don({ payments: [ck(), hoan], hoaDonDienTu: [hd()] }) })).dong.find((x) => x.hoaDon?.id === "hd1")!;
    expect(cdc.ngan).toBe("can-dieu-chinh");
    expect(cdc.email).not.toBeNull();

    expect(mot(don()).email).toBeNull();
    expect(mot(don({ payments: [ck()], hoaDonDienTu: [hd({ trangThai: "NHAP" })] })).email).toBeNull();
    expect(mot(don({ payments: [ck()], hoaDonDienTu: [hd({ trangThai: "KHONG_XUAT", lyDo: "Đã xuất ngoài hệ thống" })] })).email).toBeNull();
  });

  it("lượt mới nhất LỖI + hàng đợi FAILED ⇒ nhãn lỗi, 'Gửi lại email' sáng; hàng đợi PENDING ⇒ tắt vì đang chạy", () => {
    const d = don({ payments: [ck()], hoaDonDienTu: [hd({ guiEmail: [luotLoi] })] });
    const loi = mot(d, { hangDoi: [{ id: "q1", status: "FAILED", sentAt: null, attempts: 3, maxAttempts: 3 }] });
    expect(loi.email).toMatchObject({ lanGui: 1, trangThai: { loai: "LOI" }, guiLai: { bat: true, nhan: "Gửi lại email" } });

    const dang = mot(don({ payments: [ck()], hoaDonDienTu: [hd({ guiEmail: [{ ...luotLoi, trangThai: "DANG_GUI" }] })] }), {
      hangDoi: [{ id: "q1", status: "PENDING", sentAt: null, attempts: 1, maxAttempts: 3 }],
    });
    expect(dang.email?.guiLai).toMatchObject({ bat: false, lyDo: expect.stringMatching(/đang chạy/) });
  });

  it("email đơn chỉ khác hoa/thường + khoảng trắng ⇒ KHÔNG coi là địa chỉ mới", () => {
    const r = mot(don({ invoiceEmail: " PhuHuynh@Gmail.com ", payments: [ck()], hoaDonDienTu: [hd()] }));
    expect(r.email?.toiDon).toBeNull();
    const khac = mot(don({ invoiceEmail: "ketoan.cty@example.com", payments: [ck()], hoaDonDienTu: [hd()] }));
    expect(khac.email?.toiDon).toBe("ketoan.cty@example.com");
  });

  it("thiếu quyền xem thông tin khách ⇒ địa chỉ CHE, không văn bản lỗi nhà cung cấp", () => {
    const r = mot(don({ invoiceEmail: "ketoan.cty@example.com", payments: [ck()], hoaDonDienTu: [hd({ guiEmail: [luotLoi] })] }), {
      canViewPii: false,
      hangDoi: [{ id: "q1", status: "FAILED", sentAt: null, attempts: 3, maxAttempts: 3 }],
    });
    expect(r.email).toMatchObject({
      toiMacDinh: maskEmail("phuhuynh@gmail.com"),
      toiDon: maskEmail("ketoan.cty@example.com"),
      trangThai: { chiTiet: null },
    });
    expect(JSON.stringify(r.email)).not.toContain("phuhuynh@gmail.com");
  });
});

describe("[DHC-27..29] GĐ 8b — khoản chưa gắn ghi danh + câu nói đúng chỗ gắn", () => {
  type HoaDonVao = DonVaoHangCho["hoaDonDienTu"][number];
  const hd = (trangThai: "NHAP" | "DA_XAC_NHAN"): HoaDonVao => ({
    id: "hd1",
    trangThai,
    kyHieu: "1C26TSR",
    soHoaDon: "150",
    ngayPhatHanh: new Date("2026-09-11T00:00:00Z"),
    tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
    tepPdfTen: "hd.pdf",
    tepXmlTen: null,
    emailNhan: null,
    guiEmailKhach: true,
    xuatTheoSoDaThu: false,
    lyDo: null,
    xacNhanLuc: trangThai === "DA_XAC_NHAN" ? new Date("2026-09-11T02:00:00Z") : null,
    tongTien: 3_000_000,
    createdAt: new Date("2026-09-11T02:00:00Z"),
    updatedAt: new Date("2026-09-11T02:00:00Z"),
    khongTrungLyDo: null,
    nguoiMuaHashLucIn: null,
    nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
    xuatTheoSoDaThuLyDo: null,
    guiEmail: [],
    khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
  });
  const mot = (d: DonVaoHangCho, o: Partial<Vao> = {}) => {
    const ds = dungDongHangCho(vao({ don: d, ...o })).dong;
    expect(ds).toHaveLength(1);
    return ds[0]!;
  };

  it("[DHC-27] chỉ khoản CHỜ chưa gắn vào danh sách (số RÒNG); khoản đã gắn / đã xác nhận thì không", () => {
    const chua = mot(don({ payments: [khoan({ id: "p1", enrollmentId: null })] }));
    expect(chua).toMatchObject({ khoanChuaGanGhiDanh: [{ id: "p1", soTien: 3_000_000 }], coTheGanGhiDanh: true });
    expect(mot(don({ payments: [khoan({ id: "p1" })] }))).toMatchObject({ khoanChuaGanGhiDanh: [], coTheGanGhiDanh: false });
    expect(mot(don({ payments: [khoan({ id: "p1", enrollmentId: null, accountantStatus: DA_XAC_NHAN })] })).khoanChuaGanGhiDanh).toEqual([]);
  });

  it("[DHC-28] đã gắn mà CHƯA xác nhận: nói ra ở dòng hoá đơn ĐÃ XUẤT, KHÔNG nói ở dòng nháp (chốt sẽ xác nhận)", () => {
    const CAU = "Khoản 3.000.000đ đã gắn ghi danh nhưng chưa xác nhận — xác nhận ở màn Thanh toán";
    expect(mot(don({ payments: [khoan({ id: "p1" })], hoaDonDienTu: [hd("DA_XAC_NHAN")] })).hanhDong.canhBao).toContain(CAU);
    expect(mot(don({ payments: [khoan({ id: "p1" })], hoaDonDienTu: [hd("NHAP")] })).hanhDong.canhBao).not.toContain(CAU);
  });

  it("[DHC-29] câu chỉ trỏ tới mục 'Gắn ghi danh' khi mục ấy CÓ; thiếu quyền ⇒ câu cũ, mục đóng", () => {
    const co = mot(don({ payments: [khoan({ id: "p1", enrollmentId: null })] }));
    expect(co.hanhDong.canhBao.join(" ")).toMatch(/gắn ở mục "Gắn ghi danh" bên dưới/);
    const khongQuyen = mot(don({ payments: [khoan({ id: "p1", enrollmentId: null })] }), { coQuyen: false });
    expect(khongQuyen.coTheGanGhiDanh).toBe(false);
    expect(khongQuyen.hanhDong.canhBao.join(" ")).not.toMatch(/Gắn ghi danh/);
    const daXuat = mot(don({ payments: [khoan({ id: "p1", enrollmentId: null })], hoaDonDienTu: [hd("DA_XAC_NHAN")] }));
    expect(daXuat.hanhDong.canhBao.join(" ")).toMatch(/"Gắn ghi danh" bên dưới rồi xác nhận khoản ở màn Thanh toán/);
    expect(daXuat.coTheGanGhiDanh).toBe(true);
  });

  it("[DHC-30] ngăn ĐƠN ĐÃ HUỶ: không mở mục gắn, câu không trỏ tới mục ấy; đối chứng: cùng khoản trên đơn còn sống ⇒ mở", () => {
    // Đơn huỷ thì tiền của nó đi đường hoàn/chuyển — gắn ghi danh ở đây là gắn tiền vào một khoá đã bỏ.
    const huy = mot(don({ status: "CANCELLED", payments: [khoan({ id: "p1", enrollmentId: null })] }));
    expect(huy.ngan).toBe("don-huy");
    expect(huy.coTheGanGhiDanh).toBe(false);
    expect(huy.hanhDong.canhBao.join(" ")).not.toMatch(/Gắn ghi danh/);
    const song = mot(don({ payments: [khoan({ id: "p1", enrollmentId: null })] }));
    expect(song.ngan).toBe("cho");
    expect(song.coTheGanGhiDanh).toBe(true);
  });
});

describe("[DHC-31] đơn KIT / THI (PRODUCT · EXAM — không có ghi danh) ⇒ dòng hàng chờ dựng đúng, không sập", () => {
  // Đơn kit/thi không có Enrollment ⇒ khoản luôn `enrollmentId: null`; phiếu thu "toàn đơn" (đợt số 0).
  const donKhong = (type: string, p: DonVaoHangCho["payments"][number]) =>
    don({
      type,
      payments: [p],
      paymentRequests: [
        {
          id: "toan-don",
          orderItemId: null,
          installmentNo: 0,
          amountDue: 1_100_000,
          status: "PAID",
          allocations: [{ bankTransactionId: "bt1", paymentRequestId: "toan-don", amount: 1_100_000, roundingWaived: 0 }],
        },
      ],
    });
  const GD_KIT = [{ ...GD[0]!, amount: 1_100_000 }];

  for (const type of ["PRODUCT", "EXAM"]) {
    it(`${type} chuyển khoản đủ ⇒ MỘT dòng 'Chờ xuất', đúng số, khoá theo giao dịch (phiếu toàn đơn), tải được phiếu chờ`, () => {
      const r = dungDongHangCho(
        vao({ don: donKhong(type, khoan({ id: "p1", amount: 1_100_000, enrollmentId: null })), giaoDich: GD_KIT }),
      );
      expect(r.thieuCoSo).toBe(0);
      expect(r.dong).toHaveLength(1);
      expect(r.dong[0]).toMatchObject({
        ngan: "cho",
        nhan: "Chờ xuất",
        soTien: 1_100_000,
        thieu: 0,
        // Phiếu "thu toàn đơn" (đợt số 0) ⇒ mỗi giao dịch một lần thu (lan-thu.ts luật 4).
        key: "gd:bt1",
        khoanIds: ["p1"],
        khoan: [{ id: "p1", soTien: 1_100_000 }],
        hoaDon: null,
      });
      expect(r.dong[0]!.hanhDong.taiPhieu).toBe(true);
    });
  }

  it("EXAM thu tiền mặt (không giao dịch) ⇒ nguồn 'Tiền mặt / ghi tay', vẫn một dòng", () => {
    const r = dungDongHangCho(
      vao({
        don: donKhong("EXAM", khoan({ id: "p1", amount: 1_100_000, enrollmentId: null, method: "CASH", note: null })),
        giaoDich: [],
      }),
    );
    expect(r.dong.map((d) => [d.ngan, d.nguonLabel, d.soTien])).toEqual([["cho", "Tiền mặt / ghi tay", 1_100_000]]);
  });

  it("đơn kit đã HUỶ ⇒ ngăn 'Đơn đã huỷ' (luật theo trạng thái đơn, không theo loại đơn)", () => {
    const d = { ...donKhong("PRODUCT", khoan({ id: "p1", amount: 1_100_000, enrollmentId: null })), status: "CANCELLED" };
    const r = dungDongHangCho(vao({ don: d, giaoDich: GD_KIT }));
    expect(r.dong.map((x) => [x.ngan, x.nhan])).toEqual([["don-huy", "Đơn đã huỷ"]]);
  });
});

describe("[DHC-30..33] 29/09 — yêu cầu hoàn học phí (Q1) + bản 'Đã xuất ngoài hệ thống' (Q3)", () => {
  type HoaDonVao = DonVaoHangCho["hoaDonDienTu"][number];
  const hd = (o: Partial<HoaDonVao> = {}): HoaDonVao => ({
    id: "hd1",
    trangThai: "NHAP",
    kyHieu: "1C26TSR",
    soHoaDon: "150",
    ngayPhatHanh: new Date("2026-09-11T00:00:00Z"),
    tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
    tepPdfTen: "hd.pdf",
    tepXmlTen: null,
    emailNhan: "phuhuynh@gmail.com",
    guiEmailKhach: true,
    xuatTheoSoDaThu: false,
    lyDo: null,
    xacNhanLuc: null,
    tongTien: 3_000_000,
    createdAt: new Date("2026-09-11T02:00:00Z"),
    updatedAt: new Date("2026-09-11T02:00:00Z"),
    khongTrungLyDo: null,
    nguoiMuaHashLucIn: null,
    nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
    xuatTheoSoDaThuLyDo: null,
    guiEmail: [],
    khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
    ...o,
  });
  const yc = (status: string, lucDuyet: Date | null) => ({
    id: "rr1",
    status,
    soTien: 1_000_000,
    lucDuyet,
    createdAt: new Date("2026-09-10T02:00:00Z"),
    ten: "Bé An",
    phamVi: { orderItemIds: [], enrollmentIds: [] },
  });
  const SAU = new Date("2026-09-20T02:00:00Z");
  const TRUOC = new Date("2026-09-05T02:00:00Z");
  const dongHd = (d: DonVaoHangCho) => dungDongHangCho(vao({ don: d })).dong.find((x) => x.hoaDon?.id === "hd1")!;

  it("[DHC-30] bản NHÁP đủ ô + đơn có yêu cầu hoàn CHỜ / ĐÃ CHI ⇒ Xác nhận tắt với câu chung; TỪ CHỐI ⇒ sáng (đối chứng)", () => {
    const tat = dongHd(don({ hoaDonDienTu: [hd()], yeuCauHoan: [yc("PENDING", null)] }));
    expect(tat.ngan).toBe("nhap");
    expect(tat.hanhDong.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });
    // 29/09 (0b): ĐÃ CHI cũng chặn.
    const daChi = dongHd(don({ hoaDonDienTu: [hd()], yeuCauHoan: [yc("PAID", TRUOC)] }));
    expect(daChi.hanhDong.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });
    const sang = dongHd(don({ hoaDonDienTu: [hd()], yeuCauHoan: [yc("REJECTED", null)] }));
    expect(sang.hanhDong.xacNhan.bat).toBe(true);
  });

  it("[DHC-31] dòng HÀNG CHỜ của đơn có yêu cầu hoàn ⇒ cảnh báo trước khi làm hoá đơn ở MISA; bản ĐÃ CHỐT thì không chặn / không cảnh báo", () => {
    const cho = dungDongHangCho(vao({ don: don({ yeuCauHoan: [yc("APPROVED", SAU)] }) })).dong[0]!;
    expect(cho.ngan).toBe("cho");
    expect(cho.hanhDong.canhBao).toContain(CAU_HOAN_CHAN_XAC_NHAN);
    const daXuat = dongHd(
      don({
        payments: [khoan({ id: "p1", accountantStatus: DA_XAC_NHAN })],
        hoaDonDienTu: [hd({ trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2026-09-11T02:00:00Z") })],
        yeuCauHoan: [yc("PENDING", null)],
      }),
    );
    expect(daXuat.ngan).toBe("da-xuat");
    expect(daXuat.hanhDong.canhBao).not.toContain(CAU_HOAN_CHAN_XAC_NHAN);
  });

  it("[DHC-32] bản ĐÃ XÁC NHẬN + hoàn duyệt SAU xacNhanLuc ⇒ 'can-dieu-chinh' kèm câu; duyệt TRƯỚC ⇒ 'da-xuat'", () => {
    const daXn = (ds: ReturnType<typeof yc>[]) =>
      don({
        payments: [khoan({ id: "p1", accountantStatus: DA_XAC_NHAN })],
        hoaDonDienTu: [hd({ trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2026-09-11T02:00:00Z") })],
        yeuCauHoan: ds,
      });
    const cdc = dongHd(daXn([yc("APPROVED", SAU)]));
    expect(cdc.ngan).toBe("can-dieu-chinh");
    expect(cdc.canDieuChinh).toEqual([expect.stringMatching(/^Đã duyệt hoàn 1\.000\.000đ cho Bé An ngày 20\/09/)]);
    expect(dongHd(daXn([yc("APPROVED", TRUOC)])).ngan).toBe("da-xuat");
  });

  it("[DHC-33] KHONG_XUAT 'Đã xuất ngoài hệ thống' + hoàn SAU lúc đánh dấu ⇒ 'can-dieu-chinh' (không nút huỷ, không email); lý do khác ⇒ 'khong-xuat'", () => {
    const kx = (lyDo: string) =>
      dongHd(don({ hoaDonDienTu: [hd({ trangThai: "KHONG_XUAT", lyDo, tepPdfKey: null, kyHieu: null, soHoaDon: null })], yeuCauHoan: [yc("APPROVED", SAU)] }));
    const ngoai = kx(LY_DO_DA_XUAT_NGOAI);
    expect(ngoai.ngan).toBe("can-dieu-chinh");
    expect(ngoai.nhan).toBe("Cần điều chỉnh");
    expect(ngoai.lyDoKhongXuat).toBe(LY_DO_DA_XUAT_NGOAI);
    expect(ngoai.huy).toEqual({ bat: false });
    expect(ngoai.email).toBeNull();
    expect(ngoai.canDieuChinh).toEqual([expect.stringMatching(/gỡ dấu 'Đã xuất ngoài hệ thống'/)]);
    const khac = kx(LY_DO_KHACH_KHONG_LAY);
    expect(khac.ngan).toBe("khong-xuat");
    expect(khac.canDieuChinh).toEqual([]);
  });

  // 29/09 — CỜ HOÀN THEO KHOẢN, KHÔNG THEO CẢ ĐƠN. Đơn 2 bé: khoản pA của bé A (dòng oi-a, ghi danh gd-a),
  // khoản pB của bé B (oi-b, gd-b), hai ngày thu khác nhau (hai lần thu). Yêu cầu hoàn của bé A.
  describe("[DHC-34] đơn 2 bé — yêu cầu hoàn bé A chỉ cờ / chặn hoá đơn CHỨA khoản bé A", () => {
    const tienMat = (id: string, con: "a" | "b", o: Partial<DonVaoHangCho["payments"][number]> = {}) =>
      khoan({
        id,
        note: null,
        method: "CASH",
        orderItemId: `oi-${con}`,
        enrollmentId: `gd-${con}`,
        paidDate: new Date(con === "a" ? "2026-09-10T03:00:00Z" : "2026-09-12T03:00:00Z"),
        ...o,
      });
    const hoanA = (status: string, lucDuyet: Date | null, phamVi = { orderItemIds: ["oi-a"], enrollmentIds: ["gd-a"] }) => ({
      ...yc(status, lucDuyet),
      phamVi,
    });
    const MO_HO = { orderItemIds: [], enrollmentIds: [] };
    const xn = { trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2026-09-11T02:00:00Z") };
    const hai = (o: Partial<DonVaoHangCho>) =>
      don({
        payments: [tienMat("pA", "a", { accountantStatus: DA_XAC_NHAN }), tienMat("pB", "b", { accountantStatus: DA_XAC_NHAN })],
        paymentRequests: [],
        ...o,
      });
    const dongCua = (d: DonVaoHangCho, hdId: string) => dungDongHangCho(vao({ don: d })).dong.find((x) => x.hoaDon?.id === hdId)!;
    const hdA = (o: Partial<ReturnType<typeof hd>> = {}) => hd({ id: "hdA", khoan: [{ paymentId: "pA", soTien: 3_000_000 }], ...o });
    const hdB = (o: Partial<ReturnType<typeof hd>> = {}) => hd({ id: "hdB", khoan: [{ paymentId: "pB", soTien: 3_000_000 }], ...o });

    it("đã xác nhận + hoàn bé A duyệt SAU ⇒ hoá đơn bé A 'can-dieu-chinh', hoá đơn bé B 'da-xuat'", () => {
      const d = hai({ hoaDonDienTu: [hdA(xn), hdB(xn)], yeuCauHoan: [hoanA("APPROVED", SAU)] });
      expect(dongCua(d, "hdA").ngan).toBe("can-dieu-chinh");
      expect(dongCua(d, "hdB").ngan).toBe("da-xuat");
      expect(dongCua(d, "hdB").canDieuChinh).toEqual([]);
    });

    it("hoá đơn GỘP cả hai bé ⇒ có cờ", () => {
      const gop = hd({ id: "hdG", ...xn, tongTien: 6_000_000, khoan: [{ paymentId: "pA", soTien: 3_000_000 }, { paymentId: "pB", soTien: 3_000_000 }] });
      expect(dongCua(hai({ hoaDonDienTu: [gop], yeuCauHoan: [hoanA("APPROVED", SAU)] }), "hdG").ngan).toBe("can-dieu-chinh");
    });

    it("yêu cầu MƠ HỒ (không móc được bé nào) ⇒ cả đơn: hoá đơn bé B cũng có cờ", () => {
      expect(dongCua(hai({ hoaDonDienTu: [hdB(xn)], yeuCauHoan: [hoanA("APPROVED", SAU, MO_HO)] }), "hdB").ngan).toBe("can-dieu-chinh");
    });

    it("bản NHÁP: hoàn bé A CHỜ ⇒ nháp bé A TẮT Xác nhận, nháp bé B KHÔNG bị chặn vì hoàn", () => {
      const d = hai({
        payments: [tienMat("pA", "a"), tienMat("pB", "b")],
        hoaDonDienTu: [hdA(), hdB({ soHoaDon: "124" })],
        yeuCauHoan: [hoanA("PENDING", null)],
      });
      expect(dongCua(d, "hdA").hanhDong.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });
      const b = dongCua(d, "hdB");
      expect(b.hanhDong.xacNhan.lyDo).not.toBe(CAU_HOAN_CHAN_XAC_NHAN);
      expect(b.hanhDong.canhBao).not.toContain(CAU_HOAN_CHAN_XAC_NHAN);
      // Đối chứng: yêu cầu mơ hồ ⇒ nháp bé B cũng bị chặn.
      const moHo = hai({ payments: [tienMat("pA", "a"), tienMat("pB", "b")], hoaDonDienTu: [hdB()], yeuCauHoan: [hoanA("PENDING", null, MO_HO)] });
      expect(dongCua(moHo, "hdB").hanhDong.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });
    });

    it("hàng chờ: lần thu bé B không mang cảnh báo hoàn; lần thu bé A có", () => {
      const { dong } = dungDongHangCho(
        vao({ don: hai({ payments: [tienMat("pA", "a"), tienMat("pB", "b")], yeuCauHoan: [hoanA("PENDING", null)] }) }),
      );
      const a = dong.find((x) => x.khoanIds.includes("pA"))!;
      const b = dong.find((x) => x.khoanIds.includes("pB"))!;
      expect(a.khoanIds).toEqual(["pA"]);
      expect(a.hanhDong.canhBao).toContain(CAU_HOAN_CHAN_XAC_NHAN);
      expect(b.hanhDong.canhBao).not.toContain(CAU_HOAN_CHAN_XAC_NHAN);
    });
  });
});

// ── Q2 (chủ dự án chốt 29/09) — kế toán GỘP nhiều lần thu của CÙNG MỘT ĐƠN thành MỘT hoá đơn ──────────
// Đợt 1 = 5.000.000đ: chuyển khoản 3.000.000đ + tiền mặt 2.000.000đ ⇒ mặc định HAI dòng (một dòng THIẾU
// 2tr, một dòng tiền mặt `k:`). Tập gộp đến từ khoá dòng (`gop:<thành phần>`), luật đo đủ là CHÍNH
// `gomLanThu` — dòng gộp chỉ là tham số `gop` của hàng chờ.
describe("[DHC-40..46] (Q2) gộp lần thu cùng đơn — hàng chờ", () => {
  const donGop = (o: Partial<DonVaoHangCho> = {}) =>
    don({
      payments: [
        khoan({ id: "p1" }),
        khoan({ id: "cash", amount: 2_000_000, method: "CASH", note: null, paidDate: new Date("2026-09-12T03:00:00Z") }),
      ],
      paymentRequests: [
        {
          id: "dot1",
          orderItemId: null,
          installmentNo: 1,
          amountDue: 5_000_000,
          status: "PARTIAL",
          allocations: [{ bankTransactionId: "bt1", paymentRequestId: "dot1", amount: 3_000_000, roundingWaived: 0 }],
        },
      ],
      ...o,
    });
  const GOP = ["dot:dot1", "k:cash"];

  it("[DHC-40] không gộp: HAI dòng; mỗi dòng liệt kê lần thu KIA của đơn để gộp (chưa chọn), thành phần = chính nó", () => {
    const { dong } = dungDongHangCho(vao({ don: donGop(), gop: [] }));
    expect(dong.map((d) => [d.key, d.ngan, d.soTien])).toEqual([
      ["dot:dot1", "lech", 3_000_000],
      ["k:cash", "cho", 2_000_000],
    ]);
    const ck = dong.find((d) => d.key === "dot:dot1")!;
    expect(ck.thanhPhanGop).toEqual(["dot:dot1"]);
    expect(ck.gopVoi).toEqual([
      { key: "k:cash", ngayThuLabel: "12/09/2026", soTien: 2_000_000, nguonLabel: "Tiền mặt / ghi tay", nhan: "Chờ xuất", daGop: false },
    ]);
    expect(dong.find((d) => d.key === "k:cash")!.gopVoi.map((g) => [g.key, g.nhan, g.daGop])).toEqual([
      ["dot:dot1", "Thiếu 2.000.000đ", false],
    ]);
  });

  it("[DHC-41] gộp hai lần thu ⇒ MỘT dòng khoá gop:…, đủ tiền (DU ⇒ 'Chờ xuất'), khoản = cả tập, tải lên mở", () => {
    const { dong } = dungDongHangCho(vao({ don: donGop(), gop: GOP }));
    expect(dong).toHaveLength(1);
    const d = dong[0]!;
    expect(d).toMatchObject({ key: "gop:dot:dot1+k:cash", ngan: "cho", nhan: "Chờ xuất", soTien: 5_000_000, thieu: 0 });
    expect(d.khoan).toEqual([
      { id: "cash", soTien: 2_000_000 },
      { id: "p1", soTien: 3_000_000 },
    ]);
    expect(d.hanhDong.taiLen.bat).toBe(true);
    expect(d.hanhDong.ngoaiLe).toBeNull();
    // Khối gộp trên dòng gộp: CẢ HAI thành phần, đều đã chọn ⇒ bỏ chọn một cái là tách lại.
    expect(d.thanhPhanGop).toEqual(GOP);
    expect(d.gopVoi.map((g) => [g.key, g.daGop])).toEqual([
      ["dot:dot1", true],
      ["k:cash", true],
    ]);
  });

  it("[DHC-42] gộp xong vẫn THIẾU ⇒ ngăn 'Lệch số', vẫn phải 'Xuất theo số đã thu' như cũ", () => {
    const d = donGop();
    d.paymentRequests[0]!.amountDue = 6_000_000;
    const r = dungDongHangCho(vao({ don: d, gop: GOP })).dong[0]!;
    expect(r).toMatchObject({ key: "gop:dot:dot1+k:cash", ngan: "lech", thieu: 1_000_000, soTien: 5_000_000 });
    expect(r.hanhDong.ngoaiLe?.loai).toBe("THEO_SO_DA_THU");
  });

  it("[DHC-43] không có khối gộp khi: chỉ MỘT lần thu chờ · không phải kế toán đúng cơ sở · đơn đã huỷ", () => {
    expect(dungDongHangCho(vao()).dong[0]!.gopVoi).toEqual([]);
    expect(dungDongHangCho(vao({ don: donGop(), gop: [], coQuyen: false })).dong.every((d) => d.gopVoi.length === 0)).toBe(true);
    const huy = dungDongHangCho(vao({ don: donGop({ status: "CANCELLED" }), gop: [] })).dong;
    expect(huy.length).toBeGreaterThan(0);
    expect(huy.every((d) => d.gopVoi.length === 0 && d.thanhPhanGop.length === 0)).toBe(true);
  });

  it("[DHC-44] lần thu của đợt ĐÃ HUỶ không phải ứng viên gộp (và dòng đó không có khối gộp)", () => {
    const d = donGop();
    d.payments.push(khoan({ id: "p9", note: gatewayMarker("SEPAY", "FT9") }));
    d.paymentRequests.push({
      id: "dot9",
      orderItemId: null,
      installmentNo: 2,
      amountDue: 3_000_000,
      status: "VOID",
      allocations: [{ bankTransactionId: "bt9", paymentRequestId: "dot9", amount: 3_000_000, roundingWaived: 0 }],
    });
    const gd9 = { id: "bt9", provider: "SEPAY", providerTxnId: "FT9", transferredAt: new Date("2026-09-13T10:00:00Z"), amount: 3_000_000 };
    const { dong } = dungDongHangCho(vao({ don: d, gop: [], giaoDich: [...GD, gd9] }));
    expect(dong.find((x) => x.key === "dot:dot9")!.gopVoi).toEqual([]);
    expect(dong.find((x) => x.key === "k:cash")!.gopVoi.map((g) => g.key)).toEqual(["dot:dot1"]);
  });

  it("[DHC-45] khoá gộp chứa thành phần KHÔNG có trong hàng chờ của đơn (đơn khác / đã khoá) ⇒ không gộp gì", () => {
    const { dong } = dungDongHangCho(vao({ don: donGop(), gop: ["dot:dot1", "k:khoan-don-khac"] }));
    expect(dong.map((d) => d.key)).toEqual(["dot:dot1", "k:cash"]);
  });

  it("[DHC-46] sau khi lưu nháp cho tập gộp ⇒ hàng chờ còn MỘT dòng 'nhap' mang ĐÚNG khoá gộp, thành phần không còn hiện riêng", () => {
    const d = donGop({
      hoaDonDienTu: [
        {
          id: "hd1",
          trangThai: "NHAP",
          kyHieu: "1C26TSR",
          soHoaDon: "127",
          ngayPhatHanh: new Date("2026-09-12T00:00:00Z"),
          tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
          tepPdfTen: "hd.pdf",
          tepXmlTen: null,
          emailNhan: "phuhuynh@gmail.com",
          guiEmailKhach: true,
          xuatTheoSoDaThu: false,
          lyDo: null,
          xacNhanLuc: null,
          tongTien: 5_000_000,
          createdAt: new Date("2026-09-12T05:00:00Z"),
          updatedAt: new Date("2026-09-12T05:00:00Z"),
          khongTrungLyDo: null,
          nguoiMuaHashLucIn: null,
          nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
          xuatTheoSoDaThuLyDo: null,
          khoan: [
            { paymentId: "p1", soTien: 3_000_000 },
            { paymentId: "cash", soTien: 2_000_000 },
          ],
          guiEmail: [],
        },
      ],
    });
    // Không truyền tập gộp (kế toán mở lại màn): dòng vẫn là MỘT, cùng khoá lúc còn ở hàng chờ.
    const { dong } = dungDongHangCho(vao({ don: d, gop: [] }));
    expect(dong.map((x) => [x.key, x.ngan, x.soTien])).toEqual([["gop:dot:dot1+k:cash", "nhap", 5_000_000]]);
    expect(dong[0]!.gopVoi).toEqual([]);
    expect(dong[0]!.thanhPhanGop).toEqual([]);
    expect(dong[0]!.hanhDong.xacNhan.bat).toBe(true);
  });
});

describe("[DHC-50] đơn KIT / THI — không có gì để gắn ⇒ không mục/câu 'ghi danh'; khoản chờ nói đúng việc", () => {
  // Chốt 29/09/2026 (`lib/finance/can-ghi-danh.ts`): khoản đơn PRODUCT/EXAM xác nhận được không cần ghi
  // danh. Trước bản vá dòng của đơn kit mời "gắn ở mục Gắn ghi danh" — một đơn không có ghi danh nào.
  const hdXuat = (soTien: number): DonVaoHangCho["hoaDonDienTu"][number] => ({
    id: "hd1",
    trangThai: "DA_XAC_NHAN",
    kyHieu: "1C26TSR",
    soHoaDon: "151",
    ngayPhatHanh: new Date("2026-09-11T00:00:00Z"),
    createdAt: new Date("2026-09-11T01:00:00Z"),
    tepPdfKey: "hoa-don/CS1/2026/don1/u.pdf",
    tepPdfTen: "hd.pdf",
    tepXmlTen: null,
    emailNhan: null,
    guiEmailKhach: true,
    xuatTheoSoDaThu: false,
    lyDo: null,
    xacNhanLuc: new Date("2026-09-11T02:00:00Z"),
    tongTien: soTien,
    updatedAt: new Date("2026-09-11T02:00:00Z"),
    khongTrungLyDo: null,
    nguoiMuaHashLucIn: null,
    nguonPhatHanh: "TAI_LEN", misaLoiMa: null, misaLoiThongDiep: null, misaSoLanGui: 0, misaGuiLuc: null,
    xuatTheoSoDaThuLyDo: null,
    guiEmail: [],
    khoan: [{ paymentId: "p1", soTien }],
  });
  const tienMat = { id: "p1", amount: 1_100_000, enrollmentId: null, method: "CASH", note: null };

  for (const type of ["PRODUCT", "EXAM"]) {
    it(`${type} CHỜ ⇒ không vào mục gắn, không câu 'ghi danh' (bước chốt sẽ xác nhận)`, () => {
      const [d] = dungDongHangCho(vao({ don: don({ type, payments: [khoan(tienMat)] }), giaoDich: [] })).dong;
      expect(d).toMatchObject({ ngan: "cho", khoanChuaGanGhiDanh: [], coTheGanGhiDanh: false });
      expect(d!.hanhDong.canhBao.join(" ")).not.toMatch(/ghi danh/i);
    });

    it(`${type} hoá đơn ĐÃ XUẤT mà khoản còn chờ ⇒ câu 'xác nhận ở màn Thanh toán', không nhắc ghi danh`, () => {
      const [d] = dungDongHangCho(
        vao({ don: don({ type, payments: [khoan(tienMat)], hoaDonDienTu: [hdXuat(1_100_000)] }), giaoDich: [] }),
      ).dong;
      expect(d!.hanhDong.canhBao).toContain("Khoản 1.100.000đ chưa xác nhận — xác nhận ở màn Thanh toán");
      expect(d!.hanhDong.canhBao.join(" ")).not.toMatch(/ghi danh/i);
      expect(d!.coTheGanGhiDanh).toBe(false);
    });
  }

  it("đối chứng dương: CÙNG khoản trên đơn COURSE ⇒ vẫn vào mục gắn + câu 'chưa gắn ghi danh'", () => {
    const [d] = dungDongHangCho(vao({ don: don({ type: "COURSE", payments: [khoan(tienMat)] }), giaoDich: [] })).dong;
    expect(d).toMatchObject({ khoanChuaGanGhiDanh: [{ id: "p1", soTien: 1_100_000 }], coTheGanGhiDanh: true });
    expect(d!.hanhDong.canhBao.join(" ")).toMatch(/chưa gắn ghi danh/);
  });
});

describe("[PHM-08] bước 1 MISA — dòng mang nút + khối phát hành (dây nối dungDongHangCho)", () => {
  type HoaDonVao = DonVaoHangCho["hoaDonDienTu"][number];
  const MISA = { moiTruong: "sandbox" as const };
  const hdMisa = (o: Partial<HoaDonVao> = {}): HoaDonVao => ({
    id: "hd-misa",
    trangThai: "DANG_PHAT_HANH",
    kyHieu: "1C26TSR",
    soHoaDon: null,
    ngayPhatHanh: null,
    tepPdfKey: null,
    tepPdfTen: null,
    tepXmlTen: null,
    emailNhan: "phuhuynh@gmail.com",
    guiEmailKhach: true,
    xuatTheoSoDaThu: false,
    lyDo: null,
    xacNhanLuc: null,
    tongTien: 3_000_000,
    createdAt: new Date("2026-09-30T02:00:00Z"),
    updatedAt: new Date("2026-09-30T02:00:00Z"),
    khongTrungLyDo: null,
    nguoiMuaHashLucIn: null,
    nguonPhatHanh: "MISA_API", misaLoiMa: null, misaLoiThongDiep: "Hết giờ", misaSoLanGui: 1, misaGuiLuc: new Date("2026-09-30T02:00:00Z"),
    xuatTheoSoDaThuLyDo: null,
    guiEmail: [],
    khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
    ...o,
  });

  it("cấu hình MISA truyền vào ⇒ dòng chờ của cơ sở dùng MISA có nút sáng; đối chứng: misa null ⇒ không hiện", () => {
    const co = dungDongHangCho(vao({ misa: MISA })).dong[0]!;
    expect(co.ngan).toBe("cho");
    expect(co.phatHanhMisa).toMatchObject({ hien: true, bat: true, moiTruong: "sandbox" });
    expect(dungDongHangCho(vao({ misa: null })).dong[0]!.phatHanhMisa.hien).toBe(false);
  });

  it("bản DANG_PHAT_HANH ⇒ ngăn 'phat-hanh', khoản KHÔNG còn ở hàng chờ, khối misa + nhãn 'Đang phát hành'", () => {
    const { dong } = dungDongHangCho(vao({ misa: MISA, don: don({ hoaDonDienTu: [hdMisa()] }) }));
    expect(dong.map((d) => d.ngan)).toEqual(["phat-hanh"]);
    expect(dong[0]!.nhan).toBe("Đang phát hành");
    expect(dong[0]!.misa).toMatchObject({ trangThai: "DANG_PHAT_HANH", hoaDonId: "hd-misa", thongDiep: "Hết giờ", kiemTraLai: { bat: true } });
    expect(dong[0]!.hoaDon).toMatchObject({ trangThai: "DANG_PHAT_HANH", nguon: "MISA_API" });
  });

  it("bản LOI_PHAT_HANH mô phỏng ⇒ nhãn 'Lỗi phát hành · mô phỏng', tone danger, nút phát hành lại + bỏ", () => {
    const { dong } = dungDongHangCho(
      vao({ misa: MISA, don: don({ hoaDonDienTu: [hdMisa({ trangThai: "LOI_PHAT_HANH", nguonPhatHanh: "MISA_GIA_LAP", misaLoiMa: "X" })] }) }),
    );
    expect(dong[0]).toMatchObject({ ngan: "phat-hanh", nhan: "Lỗi phát hành · mô phỏng", tone: "danger" });
    expect(dong[0]!.misa).toMatchObject({ moPhong: true, loiMa: "X", phatHanhLai: { bat: true }, boLamTay: { bat: true } });
  });
});
