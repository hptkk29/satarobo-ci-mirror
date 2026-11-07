// Dữ liệu mẫu + bộ chạy cho test của engine S3 (KHÔNG phải mã chạy thật — không ai ngoài `*.test.ts` được import tệp này;
// lưới `[ENG-LUOI-04]` canh cả hai điều đó).
//
// Hình dạng dữ liệu THẬT, không tròn trịa: học phí 8.976.000 / 4.488.000 (đo từ hoá đơn 1C26MNV-13 và đợt 1 của nó), tiền thu
// trước 3.000.000 trên đơn 10.400.000, hoàn 1.234.567, tiền thừa 500.000, đợt 1 nhận 2.000.000 trong 3.000.000. Số tròn trong
// fixture là dấu hiệu fixture xấu (luật đọc số).
import { gatewayMarker, installmentMarker } from "@/lib/finance/payment-markers";
import { dungDongHangCho, type DonVaoHangCho } from "../dong-hang-cho";
import type { GiaoDichVao } from "../lan-thu";
import { doiChieuBong } from "./doi-chieu-bong";
import { phanLoaiNghiaVu, type DauVaoPhanLoai, type DongDonNghiaVu } from "./phan-loai-nghia-vu";

export { gatewayMarker, installmentMarker };

type Khoan = DonVaoHangCho["payments"][number];
type Phieu = DonVaoHangCho["paymentRequests"][number];
type HoaDon = DonVaoHangCho["hoaDonDienTu"][number];

const NGAY_THU = new Date("2026-09-10T03:00:00Z");

export const khoan = (o: Partial<Khoan> & { id: string }): Khoan => ({
  amount: 3_000_000,
  method: "BANK_TRANSFER",
  note: gatewayMarker("SEPAY", "FT1"),
  paymentType: "PAYMENT",
  accountantStatus: "PENDING",
  enrollmentId: "enr1",
  orderItemId: null,
  recordedById: null,
  adjustmentOfId: null,
  paidDate: NGAY_THU,
  deletedAt: null,
  createdAt: NGAY_THU,
  ...o,
});

/** Khoản TIỀN MẶT: không marker, không giao dịch ngân hàng. */
export const tienMat = (o: Partial<Khoan> & { id: string }): Khoan => khoan({ method: "CASH", note: null, ...o });

export const phieu = (o: Partial<Phieu> & { id: string; installmentNo: number; amountDue: number }): Phieu => ({
  orderItemId: null,
  status: "PENDING",
  allocations: [],
  ...o,
});

export const phanBo = (bankTransactionId: string, paymentRequestId: string, amount: number, roundingWaived = 0) => ({
  bankTransactionId,
  paymentRequestId,
  amount,
  roundingWaived,
});

export const hoaDon = (o: Partial<HoaDon> & { id: string; khoan: { paymentId: string; soTien: number }[] }): HoaDon => ({
  trangThai: "DA_XAC_NHAN",
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
  xacNhanLuc: new Date("2026-09-12T05:00:00Z"),
  tongTien: o.khoan.reduce((s, k) => s + k.soTien, 0),
  createdAt: new Date("2026-09-12T04:00:00Z"),
  updatedAt: new Date("2026-09-12T05:00:00Z"),
  khongTrungLyDo: null,
  nguoiMuaHashLucIn: null,
  xuatTheoSoDaThuLyDo: null,
  nguonPhatHanh: "TAI_LEN",
  misaLoiMa: null,
  misaLoiThongDiep: null,
  misaSoLanGui: 0,
  misaGuiLuc: null,
  guiEmail: [],
  ...o,
});

export const don = (o: Partial<DonVaoHangCho> = {}): DonVaoHangCho => ({
  id: "don-an-01",
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
  invoiceCustomerCode: null,
  invoiceEmail: null,
  payments: [],
  paymentRequests: [],
  hoaDonDienTu: [],
  hoaDonDaHuy: [],
  yeuCauHoan: [],
  ...o,
});

export const giaoDich = (id: string, providerTxnId: string, amount: number): GiaoDichVao => ({
  id,
  provider: "SEPAY",
  providerTxnId,
  transferredAt: new Date("2026-09-10T10:00:00Z"),
  amount,
});

export const dongDonKhoaHoc = (id: string, o: Partial<DongDonNghiaVu> = {}): DongDonNghiaVu => ({
  id,
  type: "COURSE_ENROLLMENT",
  trangThai: "ACTIVE",
  usedValue: null,
  ...o,
});

export type KichBan = {
  don: DonVaoHangCho;
  dongDon?: DongDonNghiaVu[];
  giaoDich?: GiaoDichVao[];
  giaoDichChuaKhop?: { amount: number }[];
  thuTruoc?: string[];
  chinhSachThuTruoc?: DauVaoPhanLoai["chinhSachThuTruoc"];
  cheDo?: DauVaoPhanLoai["cheDo"];
};

/** Chạy CẢ HAI bên trên cùng một đơn rồi đối chiếu — đúng cách một cron shadow sẽ làm. */
export function chay(k: KichBan) {
  const gd = k.giaoDich ?? [];
  const chuaKhop = k.giaoDichChuaKhop ?? [];
  const hangCho = dungDongHangCho({
    don: k.don,
    giaoDich: gd,
    giaoDichChuaKhop: chuaKhop,
    userId: "ke-toan",
    coQuyen: true,
    khoOk: true,
    canViewPii: true,
    hangDoi: [],
    gop: [],
    misa: null,
    vin: null,
    phapNhanKyUsb: new Set<string>(),
    nhaCungCapDaChon: new Map<string, string>(),
    cauHinhCoSo: [],
    homNay: "2026-10-20",
  });
  const engine = phanLoaiNghiaVu({
    don: k.don,
    dongDon: k.dongDon ?? [],
    giaoDich: gd,
    giaoDichChuaKhop: chuaKhop,
    thuTruocPaymentIds: new Set(k.thuTruoc ?? []),
    chinhSachThuTruoc: k.chinhSachThuTruoc ?? "NHU_HOC_PHI",
    cheDo: k.cheDo ?? "THEO_KHOAN_THU",
  });
  return { hangCho, engine, baoCao: doiChieuBong({ engine, hangCho }) };
}
