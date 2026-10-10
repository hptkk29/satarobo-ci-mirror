// lib/finance/hoa-don/dong-hang-cho.ts — dựng DÒNG của màn hoá đơn từ dữ liệu MỘT đơn đã nạp. THUẦN.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §4 + §10. Ghép các luật đã có — phanLoaiKhoan · soTienRong ·
// gomLanThu · hanhDongChoDong · nguoiMuaChoDon — thành DTO đưa xuống client. Loader
// (`hang-cho.ts`) chỉ còn lo TRUY VẤN; mọi quyết định "vào ngăn nào, vẽ gì, che gì" nằm ở đây và
// kiểm được không cần DB.
//
// ⚠️ Dòng của hoá đơn NHÁP / KHÔNG XUẤT dựng lại bằng CHÍNH `gomLanThu` trên khoản của hoá đơn đó
// (gộp về một nhóm nếu ra nhiều) ⇒ khoá dòng TRÙNG khoá lúc còn ở hàng chờ. Nhờ vậy `?chon=` giữ
// đúng dòng đang chọn sau khi kế toán tải tệp lên (dòng đổi ngăn, không đổi khoá).
// ⚠️ DTO không mang `note`, `content` giao dịch, CCCD, địa chỉ — chỉ những gì màn in ra. Thiếu
// `orders:view-pii` thì SĐT + email bị che TẠI ĐÂY, trước khi rời server.

import { maskEmail, maskPhone } from "@/lib/utils";
import { nguonGiaoDich, soTienRong } from "./nguon-khoan";
import { donCoKhoanNganHang, phanLoaiKhoan, TRANG_THAI_DON_DA_HUY } from "./du-dieu-kien";
import { gomLanThu, gopTuKhoa, lanThuCuaHoaDon, type GiaoDichVao, type LanThu } from "./lan-thu";
import { hanhDongChoDong, hanhDongGuiLai, nutHuyHoaDon, type HanhDongDong, type NutTat } from "./trang-thai-hoa-don";
import {
  chuanEmail,
  luotDangChay,
  trangThaiEmailHoaDon,
  type EmailKhoi,
  type HangDoiVao,
  type LuotGuiVao,
  type ToneDong,
} from "./trang-thai-email";
import { canDieuChinh } from "./can-dieu-chinh";
import { lyDoHoanChanXacNhan, type PhamViKhoan, type YeuCauHoanVao } from "./hoan-tien-don";
import { hoaDonDaHuyCuaLanThu } from "./thay-the";
import { daKhaiHoaDon, nguoiMuaChoDon, thieuChoHoaDon, type DonChoHoaDon } from "./nguoi-mua";
import { bamNguoiMua } from "./bam-nguoi-mua";
import { CAU_HINH_HOA_DON_MAC_DINH, laPhapNhanMisa, phapNhanChoDon } from "./phap-nhan";
import { khoiMisa, nutPhatHanhMisa, type CauHinhMisaDong, type KhoiMisa, type NutPhatHanhMisa } from "./nut-phat-hanh-misa";
import { nhanDotLanThu } from "./nhan-dot";
import { thieuGhiDanh } from "@/lib/finance/can-ghi-danh";

export type DonVaoHangCho = DonChoHoaDon & {
  id: string;
  code: string;
  type: string;
  status: string;
  centerId: string | null;
  deletedAt: Date | null;
  center: { code: string | null; name: string } | null;
  /** MỌI dòng còn sống của đơn (kể cả dòng đảo/hoàn) — `soTienRong` cần đủ. */
  payments: {
    id: string;
    amount: number;
    method: string;
    note: string | null;
    paymentType: string;
    accountantStatus: string;
    enrollmentId: string | null;
    /** 29/09 — dòng đơn (con) của khoản: yêu cầu hoàn chỉ cờ / chặn hoá đơn chứa khoản CÙNG con. */
    orderItemId: string | null;
    recordedById: string | null;
    adjustmentOfId: string | null;
    paidDate: Date;
    deletedAt: Date | null;
    /** GĐ 8 — bút toán hoàn / điều chỉnh tạo SAU `xacNhanLuc` ⇒ hoá đơn "cần điều chỉnh". */
    createdAt: Date;
  }[];
  paymentRequests: {
    id: string;
    orderItemId: string | null;
    installmentNo: number;
    amountDue: number;
    status: "PENDING" | "PARTIAL" | "PAID" | "VOID";
    allocations: { bankTransactionId: string; paymentRequestId: string; amount: number; roundingWaived: number }[];
  }[];
  /** Hoá đơn còn hiệu lực (NHAP / DA_XAC_NHAN / KHONG_XUAT), `khoan` đã lọc hieuLuc. */
  hoaDonDienTu: {
    id: string;
    trangThai: string;
    kyHieu: string | null;
    soHoaDon: string | null;
    ngayPhatHanh: Date | null;
    tepPdfKey: string | null;
    tepPdfTen: string | null;
    tepXmlTen: string | null;
    emailNhan: string | null;
    guiEmailKhach: boolean;
    xuatTheoSoDaThu: boolean;
    lyDo: string | null;
    /** GĐ 8 — mốc so "hoàn / điều chỉnh SAU khi xuất" và tổng trên tờ (can-dieu-chinh.ts). */
    xacNhanLuc: Date | null;
    tongTien: number;
    /** 29/09 (Q3) — mốc của bản KHONG_XUAT "Đã xuất ngoài hệ thống" (lúc đánh dấu = lúc tạo). */
    createdAt: Date;
    /** GĐ 8 — phiên bản của bản nháp (chống sửa chồng khi ghi "không trùng" / xác nhận). */
    updatedAt: Date;
    /** GĐ 8 — kế toán đã ghi "không trùng — vẫn xuất" (lý do); `null` = chưa. */
    khongTrungLyDo: string | null;
    /**
     * Dấu người mua lúc kế toán tải phiếu chờ (`bamNguoiMua`, chụp khi lưu nháp). Khác dấu người mua
     * HIỆN TẠI của đơn ⇒ sale đã sửa người mua sau khi tờ MISA được làm — bản nháp cảnh báo. `null` =
     * bản ghi cũ chưa có dấu (không so được ⇒ không cảnh báo). BẮT BUỘC (luật 7).
     */
    nguoiMuaHashLucIn: string | null;
    /** GĐ 8 — lý do "xuất theo số đã thu" (đi cùng `xuatTheoSoDaThu`). */
    xuatTheoSoDaThuLyDo: string | null;
    /**
     * Bước 1 MISA (30/09) — nguồn bản hoá đơn (`TAI_LEN` · `MISA_API` · `MISA_GIA_LAP`) + trạng thái máy phát
     * hành. BẮT BUỘC (luật 7): loader quên chọn cột là bản mô phỏng hiện như hoá đơn thật.
     */
    nguonPhatHanh: string;
    misaLoiMa: string | null;
    misaLoiThongDiep: string | null;
    misaSoLanGui: number;
    misaGuiLuc: Date | null;
    khoan: { paymentId: string; soTien: number }[];
    /** GĐ 8 — lượt gửi email MỚI NHẤT trước (orderBy lanGui desc, take 1 là đủ). */
    guiEmail: LuotGuiVao[];
  }[];
  /**
   * GĐ 8 — hoá đơn ĐÃ HUỶ (THAY_THE) của đơn, dòng nối đã hết hiệu lực. CHỈ để HIỂN THỊ ("lần thu này
   * từng có hoá đơn X — đã huỷ"): KHÔNG BAO GIỜ khoá khoản, KHÔNG BAO GIỜ sinh dòng.
   * `coTepPdf` thay cho khoá tệp — khoá tệp không đi xuống client.
   */
  hoaDonDaHuy: {
    id: string;
    kyHieu: string | null;
    soHoaDon: string | null;
    huyLuc: Date | null;
    huyLyDo: string | null;
    coTepPdf: boolean;
    paymentIds: string[];
  }[];
  /**
   * 29/09 (Q1) — yêu cầu hoàn học phí của đơn (`hoanTheoDon`, trạng thái `TRANG_THAI_HOAN_CAN_NAP`).
   * Hoàn CHỜ / ĐÃ DUYỆT chưa vào sổ Payment (chỉ bước ĐÃ CHI — `chiHoanTien` — mới ghi) ⇒ không có
   * trường này thì màn không biết tới yêu cầu chưa chi.
   * BẮT BUỘC (luật 7).
   */
  yeuCauHoan: YeuCauHoanVao[];
};

export type NganHangCho =
  | "cho"
  | "lech"
  | "nhap"
  | "phat-hanh"
  | "da-xuat"
  | "khong-xuat"
  | "don-huy"
  | "can-dieu-chinh";
// GĐ 8 — định nghĩa dời sang `trang-thai-email.ts`; giữ đường import cũ cho component.
export type { ToneDong } from "./trang-thai-email";

export type DongHangCho = {
  key: string;
  ngan: NganHangCho;
  nhan: string;
  tone: ToneDong;
  orderId: string;
  maDon: string;
  tenKhach: string;
  sdt: string | null;
  coSo: { ma: string | null; ten: string };
  ngayThu: string;
  ngayThuLabel: string;
  soTien: number;
  nguon: LanThu["nguon"];
  nguonLabel: string;
  nhanDot: string | null;
  thieu: number;
  traTruoc: number;
  ngoaiDot: number;
  tienTha: number;
  khoanIds: string[];
  /** Số RÒNG của từng khoản (`soTienRong`) — phiếu chờ in mỗi khoản một trang theo đúng số này. */
  khoan: { id: string; soTien: number }[];
  coTtHoaDon: boolean;
  emailNhan: string | null;
  kyHieuMau: string | null;
  hanhDong: HanhDongDong;
  hoaDonNhap: {
    id: string;
    kyHieu: string | null;
    soHoaDon: string | null;
    ngayPhatHanh: string | null;
    tepPdfTen: string | null;
    tepXmlTen: string | null;
    guiEmailKhach: boolean;
    /** GĐ 8 — `updatedAt` ISO: action "không trùng" / "xác nhận" gửi lại để ghi có điều kiện. */
    phienBan: string;
    xuatTheoSoDaThu: boolean;
    xuatTheoSoDaThuLyDo: string | null;
    khongTrungLyDo: string | null;
  } | null;
  /** Hoá đơn còn hiệu lực đang giữ lần thu (nháp / đang phát hành / đã xuất / không xuất) — ngăn xử lý in số + tệp. */
  hoaDon: {
    id: string;
    trangThai: "NHAP" | "DA_XAC_NHAN" | "KHONG_XUAT" | "DANG_PHAT_HANH" | "LOI_PHAT_HANH";
    /** Bước 1 MISA — `MISA_GIA_LAP` ⇒ màn gắn nhãn "MÔ PHỎNG — không có giá trị pháp lý". */
    nguon: "TAI_LEN" | "MISA_API" | "MISA_GIA_LAP";
    kyHieu: string | null;
    soHoaDon: string | null;
    ngayPhatHanh: string | null;
    coPdf: boolean;
    coXml: boolean;
  } | null;
  lyDoKhongXuat: string | null;
  /** GĐ 8 — nút "Huỷ hoá đơn" (chỉ bản đã xác nhận). */
  huy: NutTat;
  /** GĐ 8 — lý do hoá đơn đã xác nhận "cần điều chỉnh" (rỗng ⇔ không cần). */
  canDieuChinh: string[];
  /** GĐ 8 — hoá đơn ĐÃ HUỶ đứng ngay trước lần thu này (bản huỷ muộn nhất trước). */
  hoaDonDaHuy: { id: string; so: string; huyLucLabel: string; lyDo: string | null; taiDuoc: boolean }[];
  /**
   * GĐ 8b — khoản CHỜ của lần thu chưa gắn ghi danh (số RÒNG). `coTheGanGhiDanh` = mục "Gắn ghi danh"
   * có trên ngăn không: kế toán đúng cơ sở, không phải ngăn đơn đã huỷ, và còn khoản cần gắn.
   */
  khoanChuaGanGhiDanh: { id: string; soTien: number }[];
  coTheGanGhiDanh: boolean;
  /**
   * GĐ 8 — email của hoá đơn ĐÃ XÁC NHẬN (cả ngăn "Đã xuất" lẫn "Cần điều chỉnh"); `null` ở mọi dòng
   * khác. `toiMacDinh` = địa chỉ chụp lúc chốt; `toiDon` = email HIỆN TẠI của đơn, CHỈ khi khác địa chỉ
   * đó (so không phân biệt hoa/thường). Cả hai che theo quyền xem thông tin khách.
   */
  email: {
    trangThai: EmailKhoi | null;
    lanGui: number | null;
    guiLai: NutTat & { nhan: string };
    toiMacDinh: string | null;
    toiDon: string | null;
  } | null;
  /**
   * Q2 (29/09) — khoá lần thu THÀNH PHẦN của dòng hàng chờ: một khoá khi chưa gộp, cả tập khi là dòng
   * gộp. Rỗng ở dòng đã có hoá đơn / đơn huỷ (không gộp lại được — muốn đổi tập thì gỡ bản nháp).
   * Màn cộng / bớt một khoá vào tập này rồi chọn dòng `khoaGop(tập)`.
   */
  thanhPhanGop: string[];
  /**
   * Q2 — lần thu KHÁC đang chờ của CÙNG đơn có thể gộp vào dòng này (dòng gộp: gồm cả thành phần của nó,
   * `daGop`). Rỗng khi đơn chỉ có một lần thu chờ, người xem không phải kế toán đúng cơ sở, đơn đã huỷ,
   * hoặc dòng không ở hàng chờ. Số liệu của từng mục là của lần thu CHƯA gộp.
   */
  gopVoi: GopVoi[];
  /**
   * Bước 1 MISA (30/09) — nút "Phát hành qua MISA" của dòng hàng chờ (`nutPhatHanhMisa`, một chỗ quyết).
   * Action `phatHanhQuaMisaAction` đọc LẠI đúng trường này trên dòng loader dựng lại.
   */
  phatHanhMisa: NutPhatHanhMisa;
  /** Bước 1 MISA — khối trạng thái của bản ĐANG / LỖI phát hành (ngăn "Phát hành MISA"); `null` ở dòng khác. */
  misa: KhoiMisa | null;
};

export type GopVoi = {
  key: string;
  ngayThuLabel: string;
  soTien: number;
  nguonLabel: string;
  nhan: string;
  daGop: boolean;
};

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const ddmmyyyy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const isoNgay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function nhanVaTone(ngan: NganHangCho, lt: LanThu, trangThaiDon: string): { nhan: string; tone: ToneDong } {
  switch (ngan) {
    case "nhap":
      return { nhan: "Đã tải tệp", tone: "info" };
    case "phat-hanh":
      // Nhãn cụ thể (đang / lỗi / mô phỏng) do `nhanPhatHanh` quyết theo bản hoá đơn — đây là mặc định.
      return { nhan: "Đang phát hành", tone: "info" };
    case "da-xuat":
      return { nhan: "Đã xuất", tone: "success" };
    case "can-dieu-chinh":
      return { nhan: "Cần điều chỉnh", tone: "danger" };
    case "khong-xuat":
      return { nhan: "Không xuất", tone: "muted" };
    case "don-huy":
      // Theo trạng thái ĐƠN trước (GĐ 8): đơn huỷ mà đợt cũng bị VOID vẫn là "Đơn đã huỷ".
      return {
        nhan: trangThaiDon === "REFUNDED" ? "Đơn đã hoàn tiền" : trangThaiDon === "CANCELLED" ? "Đơn đã huỷ" : "Đợt đã huỷ",
        tone: "danger",
      };
    case "lech":
      return lt.trangThai === "NGHI_TRUNG"
        ? { nhan: "Nghi trùng", tone: "danger" }
        : { nhan: `Thiếu ${tien(lt.thieu)}`, tone: "danger" };
    case "cho":
      return { nhan: lt.trangThai === "LOI_KHAI" ? "Khai tay" : "Chờ xuất", tone: "warning" };
    default: {
      // Thêm ngăn mới mà quên nhãn ⇒ tsc đỏ ở đây (GĐ 8 thêm "can-dieu-chinh").
      const chuaXuLy: never = ngan;
      return chuaXuLy;
    }
  }
}

/** Nhãn nguồn tiền của một lần thu — số giao dịch lấy từ chính lần thu. */
function nhanNguon(lt: LanThu, gdTheoId: ReadonlyMap<string, GiaoDichVao>): string {
  if (lt.nguon === "CK") {
    const gd = lt.giaoDichIds.map((id) => gdTheoId.get(id)).filter((g): g is GiaoDichVao => g != null);
    return gd.length === 1 ? `Chuyển khoản · ${gd[0]!.providerTxnId}` : `Chuyển khoản · ${gd.length} giao dịch`;
  }
  return lt.nguon === "LOI_KHAI" ? "Khai tay theo đơn / đợt" : "Tiền mặt / ghi tay";
}

const TRANG_THAI_DONG = ["NHAP", "DA_XAC_NHAN", "KHONG_XUAT", "DANG_PHAT_HANH", "LOI_PHAT_HANH"] as const;
function laTrangThaiDong(t: string): t is (typeof TRANG_THAI_DONG)[number] {
  return (TRANG_THAI_DONG as readonly string[]).includes(t);
}
function laNguon(n: string): n is "TAI_LEN" | "MISA_API" | "MISA_GIA_LAP" {
  return n === "TAI_LEN" || n === "MISA_API" || n === "MISA_GIA_LAP";
}

/** Nhãn dòng của bản ĐANG / LỖI phát hành qua MISA. */
function nhanPhatHanh(hd: { trangThai: string; soHoaDon: string | null; nguonPhatHanh: string }): { nhan: string; tone: ToneDong } {
  const moPhong = hd.nguonPhatHanh === "MISA_GIA_LAP" ? " · mô phỏng" : "";
  if (hd.trangThai === "LOI_PHAT_HANH") return { nhan: `Lỗi phát hành${moPhong}`, tone: "danger" };
  return { nhan: `${hd.soHoaDon ? "Đang tải tệp MISA" : "Đang phát hành"}${moPhong}`, tone: "info" };
}

function nganCua(lt: LanThu): NganHangCho {
  if (lt.trangThai === "DOT_HUY") return "don-huy";
  if (lt.trangThai === "THIEU" || lt.trangThai === "NGHI_TRUNG") return "lech";
  return "cho";
}

export function dungDongHangCho(input: {
  don: DonVaoHangCho;
  /** Giao dịch mà khoản + phân bổ của đơn trỏ tới. */
  giaoDich: readonly GiaoDichVao[];
  /** Giao dịch CHƯA KHỚP mang SĐT của đơn (người gọi bóc sẵn) — để phát hiện nghi trùng. */
  giaoDichChuaKhop: readonly { amount: number }[];
  /** Người đang xem — so AC5 (người ghi nhận không tự xác nhận khoản của mình). */
  userId: string;
  /** `coQuyenKeToanTaiCoSo(actor, don.centerId)` — người gọi giải sẵn. */
  coQuyen: boolean;
  khoOk: boolean;
  canViewPii: boolean;
  /** GĐ 8 — dòng hàng đợi email (CHỈ cột trạng thái) của lượt gửi mới nhất; BẮT BUỘC (luật 7). */
  hangDoi: readonly HangDoiVao[];
  /**
   * Q2 (29/09) — tập khoá lần thu kế toán đang GỘP (`gopTuKhoa` của khoá dòng đang chọn); `[]` = không
   * gộp. Khoá không có trong hàng chờ của đơn (đơn khác, đã khoá hoá đơn) ⇒ `gomLanThu` bỏ qua, và
   * dòng gộp KHÔNG ra ⇒ đường server tìm theo khoá gộp không thấy dòng. BẮT BUỘC (luật 7).
   */
  gop: readonly string[];
  /**
   * Bước 1 MISA (30/09) — `null` khi công tắc `hoaDon.misaPhatHanh` / màn hoá đơn tắt, hoặc chưa cấu hình
   * cổng (`layCongHoaDon()` null). BẮT BUỘC (luật 7): mặc định là quên — và quên thì nút không bao giờ hiện
   * (lỗi CÂM, CLAUDE.md luật 11).
   */
  misa: CauHinhMisaDong | null;
}): { dong: DongHangCho[]; thieuCoSo: number } {
  const { don } = input;
  const qTheoId = new Map(input.hangDoi.map((q) => [q.id, q]));
  const rong = soTienRong(don.payments);
  const khoanTheoId = new Map(don.payments.map((p) => [p.id, p]));
  // Móc con của từng khoản — cho `lyDoHoanChanXacNhan` / `canDieuChinh`. Khoản không thấy ⇒ không móc gì
  // (`hoanAnhHuongKhoan` coi là mơ hồ ⇒ chạm — thà báo thừa).
  const phamViCua = (ids: readonly string[]): PhamViKhoan[] =>
    ids.map((id) => {
      const p = khoanTheoId.get(id);
      return { orderItemId: p?.orderItemId ?? null, enrollmentId: p?.enrollmentId ?? null };
    });
  const daKhoa = new Set(don.hoaDonDienTu.flatMap((h) => h.khoan.map((k) => k.paymentId)));

  const hangCho: typeof don.payments = [];
  const donHuy: typeof don.payments = [];
  let thieuCoSo = 0;
  for (const p of don.payments) {
    if (daKhoa.has(p.id)) continue;
    const pl = phanLoaiKhoan(p, don, rong.get(p.id) ?? 0);
    if (pl.vao === "HANG_CHO") hangCho.push(p);
    else if (pl.vao === "DON_DA_HUY") donHuy.push(p);
    else if (pl.vao === "THIEU_CO_SO") thieuCoSo += 1;
  }
  // Đơn không cơ sở: `phanLoaiKhoan` đã xếp MỌI khoản vào THIEU_CO_SO — không dòng nào, chỉ đếm
  // (số KHOẢN, không phải số đơn) để màn nói ra thay vì để chúng rơi im lặng.
  if (!don.centerId) return { dong: [], thieuCoSo };

  const phanBo = don.paymentRequests.flatMap((r) => r.allocations);
  const dot = don.paymentRequests.map(({ id, installmentNo, amountDue, status }) => ({ id, installmentNo, amountDue, status }));
  const gdTheoId = new Map(input.giaoDich.map((g) => [g.id, g]));
  const vaoLanThu = (ps: readonly typeof don.payments[number][]) =>
    ps.map((p) => ({ id: p.id, rong: rong.get(p.id) ?? 0, nguon: nguonGiaoDich(p.note), paidDate: p.paidDate }));
  // GĐ 8 — nghi trùng theo CẢ ĐƠN: tính trên MỌI dòng (kể cả khoản đã khoá vào hoá đơn) — xem
  // `donCoKhoanNganHang`. Tính trên `hangCho` là lọt đúng ca ORD-260910-000002.
  const coCK = donCoKhoanNganHang(don.payments, don, rong);
  const donDaHuy = (TRANG_THAI_DON_DA_HUY as readonly string[]).includes(don.status);
  const gom = (ps: readonly typeof don.payments[number][], gop: readonly (readonly string[])[] = []) =>
    gomLanThu({
      khoan: vaoLanThu(ps),
      giaoDich: input.giaoDich,
      phanBo,
      dot,
      gop,
      giaoDichChuaKhop: input.giaoDichChuaKhop,
      donCoKhoanNganHang: coCK,
    });

  const nm = nguoiMuaChoDon(don);
  const thieuNguoiMua = thieuChoHoaDon(nm).chan;
  const coTtHoaDon = daKhaiHoaDon(don);
  const kyHieuMau = phapNhanChoDon(don.center?.code, CAU_HINH_HOA_DON_MAC_DINH)?.kyHieu ?? null;
  const dauNguoiMuaHienTai = bamNguoiMua(nm);
  const sdt = nm.dienThoai ? (input.canViewPii ? nm.dienThoai : maskPhone(nm.dienThoai)) : null;
  const che = (email: string | null) => (email ? (input.canViewPii ? email : maskEmail(email)) : null);

  const dung = (
    lt: LanThu,
    ngan: NganHangCho,
    hd: DonVaoHangCho["hoaDonDienTu"][number] | null,
    lyDoCanDieuChinh: string[] = [],
    gopCua: { thanhPhanGop: string[]; gopVoi: GopVoi[] } = { thanhPhanGop: [], gopVoi: [] },
  ): DongHangCho => {
    const chuaXacNhanDuoc: string[] = [];
    // GĐ 8b — khoản chờ chưa gắn ghi danh (chưa gắn thì chưa cấp được phiếu thu). Mục "Gắn ghi danh"
    // chỉ mở cho kế toán đúng cơ sở, và không mở ở ngăn đơn đã huỷ — câu cảnh báo chỉ trỏ tới mục đó
    // khi mục đó CÓ trên màn (luật 12).
    const khoanChuaGanGhiDanh: { id: string; soTien: number }[] = [];
    const moGan = input.coQuyen && ngan !== "don-huy";
    const daChotHoaDon = ngan === "da-xuat" || ngan === "can-dieu-chinh" || ngan === "khong-xuat";
    for (const id of lt.khoanIds) {
      const p = khoanTheoId.get(id);
      if (!p || p.accountantStatus !== "PENDING") continue;
      const so = tien(rong.get(id) ?? p.amount);
      // Đơn KIT / THI (PRODUCT · EXAM) không có ghi danh nào ⇒ không có gì để gắn: không vào mục "Gắn
      // ghi danh", không câu "chưa gắn ghi danh" (`can-ghi-danh.ts`, chốt 29/09/2026).
      if (thieuGhiDanh(p, don.type)) {
        khoanChuaGanGhiDanh.push({ id, soTien: rong.get(id) ?? p.amount });
        chuaXacNhanDuoc.push(
          !moGan
            ? `Khoản ${so} chưa gắn ghi danh — vẫn chờ kế toán xác nhận`
            : daChotHoaDon
              ? `Khoản ${so} chưa gắn ghi danh — gắn ở mục "Gắn ghi danh" bên dưới rồi xác nhận khoản ở màn Thanh toán`
              : `Khoản ${so} chưa gắn ghi danh — gắn ở mục "Gắn ghi danh" bên dưới; chưa gắn thì hoá đơn vẫn chốt được, khoản chờ xác nhận`,
        );
      } else if (p.recordedById && p.recordedById === input.userId) {
        chuaXacNhanDuoc.push(`Khoản ${so} do chính bạn ghi nhận — cần người khác xác nhận khoản`);
      } else if (daChotHoaDon) {
        // Hoá đơn đã chốt mà khoản vẫn chờ: bước chốt không xác nhận lại nữa ⇒ trước đây im lặng. Khoản
        // của đơn kit/thi không có ghi danh ⇒ không nhắc tới ghi danh, chỉ nói đúng việc còn lại.
        chuaXacNhanDuoc.push(
          p.enrollmentId
            ? `Khoản ${so} đã gắn ghi danh nhưng chưa xác nhận — xác nhận ở màn Thanh toán`
            : `Khoản ${so} chưa xác nhận — xác nhận ở màn Thanh toán`,
        );
      }
    }
    // GĐ 8 — nhãn nút Xác nhận phải nói ĐÚNG địa chỉ sẽ nhận: bước chốt chụp lại email của ĐƠN lúc chốt
    // (chot-hoa-don.ts) ⇒ trước khi chốt đọc email HIỆN TẠI của đơn; sau khi chốt, bản chụp là nguồn duy
    // nhất. Bản cũ (`hd?.emailNhan ?? nm.email`) hứa gửi tới một địa chỉ mà bước chốt không dùng.
    const emailNhanThat = hd?.trangThai === "DA_XAC_NHAN" ? hd.emailNhan : nm.email;
    const nhapCho = hd && hd.trangThai === "NHAP" ? hd : null;
    // Người mua đổi SAU khi tải phiếu chờ (bam-nguoi-mua.ts): tờ ở MISA mang thông tin cũ. Cảnh báo, không
    // chặn — chỉ ở bản NHÁP, vì đó là lúc cuối còn kiểm được trước khi xác nhận.
    const nguoiMuaDaDoi =
      nhapCho?.nguoiMuaHashLucIn != null && nhapCho.nguoiMuaHashLucIn !== dauNguoiMuaHienTai
        ? [
            "Thông tin người mua trên đơn đã đổi sau khi tải phiếu thu chờ — kiểm lại tên, MST, địa chỉ, email trên tờ hoá đơn ở MISA trước khi xác nhận",
          ]
        : [];
    const hanhDongGoc = hanhDongChoDong({
      lanThu: {
        trangThai: lt.trangThai,
        thieu: lt.thieu,
        nhanDot: nhanDotLanThu(lt.dotDich, don.paymentRequests),
        canhBao: lt.canhBao,
        nghiTrungVi: lt.nghiTrungVi,
      },
      hoaDonNhap: nhapCho
        ? { coTepPdf: Boolean(nhapCho.tepPdfKey), kyHieu: nhapCho.kyHieu, soHoaDon: nhapCho.soHoaDon, ngayPhatHanh: nhapCho.ngayPhatHanh }
        : null,
      coQuyen: input.coQuyen,
      khoOk: input.khoOk,
      emailNhan: emailNhanThat,
      guiEmailKhach: hd?.guiEmailKhach ?? true,
      thieuNguoiMua,
      khoanChuaXacNhanDuoc: chuaXacNhanDuoc,
      boQuaNghiTrung: hd?.khongTrungLyDo != null,
      xuatTheoSoDaThu: hd?.xuatTheoSoDaThu ?? false,
      donDaHuy,
      // Q1b — chỉ dòng CHƯA chốt (hàng chờ / nháp): bản đã chốt thì việc là "Cần điều chỉnh", không phải chặn.
      // 29/09 — chỉ yêu cầu hoàn CHẠM khoản của chính lần thu này (không theo cả đơn).
      hoanChan: daChotHoaDon ? null : lyDoHoanChanXacNhan(don.yeuCauHoan, phamViCua(lt.khoanIds)),
    });
    const hanhDong: HanhDongDong =
      nguoiMuaDaDoi.length > 0 ? { ...hanhDongGoc, canhBao: [...hanhDongGoc.canhBao, ...nguoiMuaDaDoi] } : hanhDongGoc;
    const nguonLabel = nhanNguon(lt, gdTheoId);
    const { nhan, tone } = ngan === "phat-hanh" && hd ? nhanPhatHanh(hd) : nhanVaTone(ngan, lt, don.status);
    // Bước 1 MISA — nút của dòng hàng chờ + khối trạng thái của bản đang / lỗi phát hành.
    const phatHanhMisa = nutPhatHanhMisa({
      misa: input.misa,
      ngan,
      coQuyen: input.coQuyen,
      phapNhanMisa: laPhapNhanMisa(phapNhanChoDon(don.center?.code, CAU_HINH_HOA_DON_MAC_DINH)),
      thayThe: hoaDonDaHuyCuaLanThu(don.hoaDonDaHuy, lt.khoanIds).length > 0,
      hanhDong,
      thieuNguoiMua,
      nguoiMua: nm,
      hoanChan: daChotHoaDon ? null : lyDoHoanChanXacNhan(don.yeuCauHoan, phamViCua(lt.khoanIds)),
    });
    const misa =
      hd && (hd.trangThai === "DANG_PHAT_HANH" || hd.trangThai === "LOI_PHAT_HANH")
        ? khoiMisa({ hd: { ...hd, trangThai: hd.trangThai }, misa: input.misa, coQuyen: input.coQuyen, thieuNguoiMua, nguoiMua: nm })
        : null;
    // GĐ 8 — email chỉ của bản ĐÃ XÁC NHẬN; cùng luật đọc lượt + hàng đợi với khối của sale.
    const luot = hd?.trangThai === "DA_XAC_NHAN" ? (hd.guiEmail[0] ?? null) : null;
    const hangDoiLuot = luot?.emailQueueId ? (qTheoId.get(luot.emailQueueId) ?? null) : null;
    const email: DongHangCho["email"] =
      hd?.trangThai === "DA_XAC_NHAN"
        ? {
            trangThai: trangThaiEmailHoaDon(hd, luot, hangDoiLuot, input.canViewPii, input.khoOk && Boolean(hd.tepPdfKey)),
            lanGui: luot?.lanGui ?? null,
            guiLai: hanhDongGuiLai({
              trangThaiHoaDon: hd.trangThai,
              coQuyen: input.coQuyen,
              khoOk: input.khoOk,
              dangChay: luot ? luotDangChay(luot, hangDoiLuot) : false,
              coLuot: luot != null,
              emailNhan: hd.emailNhan,
              emailDon: nm.email,
            }),
            toiMacDinh: che(hd.emailNhan),
            toiDon: nm.email && chuanEmail(nm.email) !== chuanEmail(hd.emailNhan) ? che(nm.email) : null,
          }
        : null;
    return {
      key: lt.key,
      ngan,
      nhan,
      tone,
      orderId: don.id,
      maDon: don.code,
      tenKhach: nm.hoTen,
      sdt,
      coSo: { ma: don.center?.code ?? null, ten: don.center?.name ?? "" },
      ngayThu: lt.ngayThu,
      ngayThuLabel: ddmmyyyy(lt.ngayThu),
      soTien: lt.soTien,
      nguon: lt.nguon,
      nguonLabel,
      nhanDot: nhanDotLanThu(lt.dotDich, don.paymentRequests),
      thieu: lt.thieu,
      traTruoc: lt.traTruoc,
      ngoaiDot: lt.ngoaiDot,
      tienTha: lt.tienTha,
      khoanIds: lt.khoanIds,
      khoan: lt.khoanIds.map((id) => ({ id, soTien: rong.get(id) ?? 0 })),
      coTtHoaDon,
      emailNhan: che(emailNhanThat),
      kyHieuMau,
      hanhDong,
      hoaDonNhap: nhapCho
        ? {
            id: nhapCho.id,
            kyHieu: nhapCho.kyHieu,
            soHoaDon: nhapCho.soHoaDon,
            ngayPhatHanh: isoNgay(nhapCho.ngayPhatHanh),
            tepPdfTen: nhapCho.tepPdfTen,
            tepXmlTen: nhapCho.tepXmlTen,
            guiEmailKhach: nhapCho.guiEmailKhach,
            phienBan: nhapCho.updatedAt.toISOString(),
            xuatTheoSoDaThu: nhapCho.xuatTheoSoDaThu,
            xuatTheoSoDaThuLyDo: nhapCho.xuatTheoSoDaThuLyDo,
            khongTrungLyDo: nhapCho.khongTrungLyDo,
          }
        : null,
      hoaDon:
        hd && laTrangThaiDong(hd.trangThai)
          ? {
              id: hd.id,
              trangThai: hd.trangThai,
              nguon: laNguon(hd.nguonPhatHanh) ? hd.nguonPhatHanh : "TAI_LEN",
              kyHieu: hd.kyHieu,
              soHoaDon: hd.soHoaDon,
              ngayPhatHanh: isoNgay(hd.ngayPhatHanh),
              coPdf: Boolean(hd.tepPdfKey),
              coXml: Boolean(hd.tepXmlTen),
            }
          : null,
      lyDoKhongXuat: hd?.trangThai === "KHONG_XUAT" ? hd.lyDo : null,
      huy: nutHuyHoaDon({ trangThaiHoaDon: hd?.trangThai ?? null, coQuyen: input.coQuyen }),
      canDieuChinh: lyDoCanDieuChinh,
      hoaDonDaHuy: hoaDonDaHuyCuaLanThu(don.hoaDonDaHuy, lt.khoanIds).map((h) => ({
        id: h.id,
        so: [h.kyHieu, h.soHoaDon].filter(Boolean).join("-") || "(chưa ghi số)",
        huyLucLabel: h.huyLuc ? ddmmyyyy(h.huyLuc.toISOString()) : "",
        // Lý do do kế toán gõ tay — có thể mang MST / tên công ty ⇒ theo quyền xem thông tin khách.
        lyDo: input.canViewPii ? h.huyLyDo : null,
        // Route tải cho kế toán cơ sở tải MỌI bản (kể cả đã huỷ) — nhưng chỉ khi có tệp + kho sống.
        taiDuoc: input.coQuyen && input.khoOk && h.coTepPdf,
      })),
      email,
      khoanChuaGanGhiDanh,
      coTheGanGhiDanh: moGan && khoanChuaGanGhiDanh.length > 0,
      thanhPhanGop: gopCua.thanhPhanGop,
      gopVoi: gopCua.gopVoi,
      phatHanhMisa,
      misa,
    };
  };

  const dong: DongHangCho[] = [];
  // Q2 — gộp tay. Ứng viên đo trên lần thu CHƯA gộp (số của từng lần thu như kế toán thấy khi chưa gộp);
  // dòng hiển thị dựng bằng CHÍNH `gomLanThu` với tập gộp — gộp xong còn THIẾU thì vẫn là THIẾU.
  const coSoGop = gom(hangCho);
  const hienThi = input.gop.length >= 2 ? gom(hangCho, [input.gop]) : coSoGop;
  // Chỉ kế toán đúng cơ sở, đơn còn sống; đợt đã huỷ không gộp (việc của nó là "Không xuất").
  const ungVien = input.coQuyen && !donDaHuy ? coSoGop.filter((u) => nganCua(u) !== "don-huy") : [];
  const theoKhoaUng = new Map(ungVien.map((u) => [u.key, u]));
  for (const lt of hienThi) {
    const ngan = nganCua(lt);
    const thanhPhan = gopTuKhoa(lt.key).length > 0 ? gopTuKhoa(lt.key) : [lt.key];
    const moGop = ngan !== "don-huy" && ungVien.length >= 2 && thanhPhan.every((k) => theoKhoaUng.has(k));
    const gopVoi: GopVoi[] = moGop
      ? ungVien
          .filter((u) => !(thanhPhan.length === 1 && u.key === thanhPhan[0]))
          .map((u) => ({
            key: u.key,
            ngayThuLabel: ddmmyyyy(u.ngayThu),
            soTien: u.soTien,
            nguonLabel: nhanNguon(u, gdTheoId),
            nhan: nhanVaTone(nganCua(u), u, don.status).nhan,
            daGop: thanhPhan.includes(u.key),
          }))
      : [];
    dong.push(dung(lt, ngan, null, [], { thanhPhanGop: donDaHuy || ngan === "don-huy" ? [] : thanhPhan, gopVoi }));
  }
  for (const lt of gom(donHuy)) dong.push(dung(lt, "don-huy", null));

  // Dòng của hoá đơn còn hiệu lực — dựng lại bằng CHÍNH gomLanThu trên khoản của hoá đơn (cùng hàm
  // bước chốt dựng lại trong transaction — `lanThuCuaHoaDon`).
  for (const hd of don.hoaDonDienTu) {
    const ps = hd.khoan.map((k) => khoanTheoId.get(k.paymentId)).filter((p): p is typeof don.payments[number] => p != null);
    const lt = lanThuCuaHoaDon({
      khoan: vaoLanThu(ps),
      giaoDich: input.giaoDich,
      phanBo,
      dot,
      giaoDichChuaKhop: input.giaoDichChuaKhop,
      donCoKhoanNganHang: coCK,
    });
    if (!lt) continue;
    if (hd.trangThai === "NHAP") {
      dong.push(dung(lt, "nhap", hd));
      continue;
    }
    // Bước 1 MISA — bản đang / lỗi phát hành: việc TỒN của kế toán, ngăn riêng (không phải "đã xuất").
    if (hd.trangThai === "DANG_PHAT_HANH" || hd.trangThai === "LOI_PHAT_HANH") {
      dong.push(dung(lt, "phat-hanh", hd));
      continue;
    }
    // GĐ 8 — bản đã xác nhận mà tiền dưới nó đổi SAU khi xuất (hoàn / điều chỉnh / huỷ đơn) ⇒ ngăn
    // "Cần điều chỉnh": kế toán huỷ rồi xuất lại. Cờ suy ra lúc đọc (§2.2), tự hết khi huỷ.
    const cuaHd = new Set(hd.khoan.map((k) => k.paymentId));
    const cdc = canDieuChinh({
      hoaDon: { trangThai: hd.trangThai, xacNhanLuc: hd.xacNhanLuc, tongTien: hd.tongTien, lyDo: hd.lyDo, createdAt: hd.createdAt },
      khoan: hd.khoan,
      rongHienTai: rong,
      dongTroVao: don.payments
        .filter((p) => p.adjustmentOfId != null && cuaHd.has(p.adjustmentOfId))
        .map((p) => ({ adjustmentOfId: p.adjustmentOfId!, createdAt: p.createdAt, deletedAt: p.deletedAt })),
      trangThaiDon: don.status,
      yeuCauHoan: don.yeuCauHoan,
      phamViKhoan: phamViCua(hd.khoan.map((k) => k.paymentId)),
    });
    const nganThuong: NganHangCho = hd.trangThai === "DA_XAC_NHAN" ? "da-xuat" : "khong-xuat";
    dong.push(dung(lt, cdc.can ? "can-dieu-chinh" : nganThuong, hd, cdc.lyDo));
  }

  khoaDuyNhat(dong);
  return { dong, thieuCoSo };
}

/**
 * Khoá dòng phải DUY NHẤT trong đơn — `?chon=`, route phiếu chờ và `dongCuaLanThu` đều `find` theo nó.
 *
 * Khoá lần thu KHÔNG tự duy nhất: đợt đã xuất hoá đơn theo số đã thu (`xuatTheoSoDaThu`) rồi có thêm
 * tiền về cho ĐÚNG đợt ấy ⇒ dòng hoá đơn cũ và dòng tiền mới cùng `dot:<id>` (review GĐ 7, ca
 * `[DHC-KEY]`). `find` trả dòng hoá đơn cũ ⇒ kế toán bấm dòng mới mà màn mở dòng cũ, lưu hoá đơn thì
 * nhận "Lần thu này đã có hoá đơn" ⇒ khoản mới kẹt trong hàng chờ vĩnh viễn.
 *
 * Chỉ gắn đuôi khi TRÙNG, nên ca thường (không trùng) giữ nguyên khoá cũ. Ai giữ khoá gốc: dòng ĐANG
 * xử lý (chờ/lệch → nháp) trước dòng đã chốt — khoá gốc là thứ nối lượt tải phiếu chờ (audit
 * `TAI_PHIEU_CHO.lanThuKey`) với lúc tạo hoá đơn, và thứ giữ `?chon=` qua bước tải lên; cùng mức thì
 * lần thu MỚI hơn giữ (vừa chốt xong vẫn mở đúng dòng). Đuôi là id hoá đơn / id khoản — ổn định.
 */
function khoaDuyNhat(dong: DongHangCho[]): void {
  const muc = (d: DongHangCho) => (d.ngan === "cho" || d.ngan === "lech" ? 0 : d.ngan === "nhap" ? 1 : 2);
  const thuTu = [...dong].sort((a, b) => muc(a) - muc(b) || b.ngayThu.localeCompare(a.ngayThu));
  const daDung = new Set<string>();
  for (const d of thuTu) {
    if (daDung.has(d.key)) d.key = `${d.key}~${d.hoaDon?.id ?? d.khoanIds[0] ?? ""}`;
    daDung.add(d.key);
  }
}
