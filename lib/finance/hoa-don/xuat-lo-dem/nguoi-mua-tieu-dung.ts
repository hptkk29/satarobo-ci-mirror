// lib/finance/hoa-don/xuat-lo-dem/nguoi-mua-tieu-dung.ts — NGƯỜI MUA của hoá đơn xuất trong LÔ ĐÊM 23H. THUẦN: không Prisma, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// BỐI CẢNH (BGĐ yêu cầu 03/11/2026; chủ dự án chốt cách làm cùng ngày)
//   Khoản thu mà phụ huynh KHÔNG khai thông tin xuất hoá đơn thì không để treo ở hàng chờ mãi: 23h đêm hệ thống xuất hoá đơn
//   «bán cho người tiêu dùng», MỖI LẦN THU MỘT HOÁ ĐƠN (không gộp nhiều lần thu vào một tờ), người mua ghi:
//     · TÊN      = tên học viên (không phải tên phụ huynh);
//     · ĐỊA CHỈ  = địa chỉ đã khai trên đơn nếu có, KHÔNG có thì TỈNH/THÀNH PHỐ của cơ sở học;
//     · THÔNG TIN ĐƠN HÀNG = phần dòng hàng/khoá học của chính lần thu (không đổi so với luồng bấm tay).
//   «ƯU TIÊN thông tin xuất hoá đơn mà Sale đã nhập»: đơn đã có người khai ô nào ở khối «Người mua trên hoá đơn» (`daKhaiHoaDon`) mà ĐỦ để dựng tờ
//   thì dùng đúng khối đó, KHÔNG ghi đè bằng tên học viên. Đã khai mà CHƯA ĐỦ (vd. ghi tên công ty, thiếu MST) thì KHÔNG xuất trong lô —
//   người đó đã tỏ ý muốn một tờ hoá đơn cụ thể, xuất «người tiêu dùng» thay vào là xuất sai tờ họ cần, và hoá đơn đã phát hành không xoá được.
//
// ⚠️ PHÁP LÝ (docs/ke-toan-hoa-don/hub/audit/09): hoá đơn «bán cho người tiêu dùng» không có MST/CCCD của người mua nên bên mua không dùng nó để
//   khấu trừ chi phí. Phụ huynh nào cần tờ có thông tin riêng phải khai TRƯỚC giờ chạy lô (QR trên đơn) — màn «Lô đêm 23h» nói rõ điều này.
// ─────────────────────────────────────────────────────────────────────────────

import { daKhaiHoaDon, nguoiMuaChoDon, thieuChoHoaDon, type DonChoHoaDon, type NguoiMuaHoaDon } from "../nguoi-mua";

/** Nguồn của khối người mua đã chọn — để báo cáo lô và nhật ký nói đúng "vì sao tờ này ghi như vậy". */
export type NguonNguoiMuaLoDem = "SALE_DA_KHAI" | "TIEU_DUNG";

export type MaBoQuaNguoiMua = "DA_KHAI_CHUA_DU" | "THIEU_TEN_HOC_VIEN" | "THIEU_TINH_THANH";

export type ThamSoTieuDung = {
  /** Tên học viên của lần thu (đã chọn theo `tenHocVienChoLanThu`); `null` = không xác định được. */
  tenHocVien: string | null;
  /** Tỉnh/thành phố của cơ sở học (`Center.city`) — chỉ dùng khi đơn chưa khai địa chỉ. */
  tinhThanh: string | null;
};

export type QuyetNguoiMuaLoDem =
  | { ok: true; nguon: NguonNguoiMuaLoDem; nguoiMua: NguoiMuaHoaDon }
  | { ok: false; ma: MaBoQuaNguoiMua; lyDo: string };

const sach = (s: string | null | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
};

/** Trần độ dài tên người mua trên tờ — nhiều học viên trên cùng một lần thu thì cắt ở ranh giới tên, không cắt giữa một tên. */
export const TRAN_TEN_NGUOI_MUA = 200;

/**
 * Tên học viên in trên tờ của MỘT lần thu: ưu tiên ô «Tên học viên» Sale đã nhập trên đơn (`Order.invoiceStudentName`), thiếu thì tên học viên của
 * từng khoản (không trùng, giữ thứ tự gặp). Nhiều học viên ⇒ nối bằng ", ". Không có tên nào ⇒ `null` (lô BỎ QUA lần thu đó — không bịa tên).
 */
export function tenHocVienChoLanThu(input: { saleDaNhap: string | null; theoKhoan: readonly (string | null | undefined)[] }): string | null {
  const sale = sach(input.saleDaNhap);
  if (sale) return sale.slice(0, TRAN_TEN_NGUOI_MUA);
  const thay: string[] = [];
  const daThay = new Set<string>();
  for (const t of input.theoKhoan) {
    const ten = sach(t);
    if (!ten) continue;
    const khoa = ten.toLocaleLowerCase("vi-VN");
    if (daThay.has(khoa)) continue;
    daThay.add(khoa);
    thay.push(ten);
  }
  if (thay.length === 0) return null;
  let ra = "";
  for (const ten of thay) {
    const them = ra ? `${ra}, ${ten}` : ten;
    if (them.length > TRAN_TEN_NGUOI_MUA) break;
    ra = them;
  }
  return ra || thay[0]!.slice(0, TRAN_TEN_NGUOI_MUA);
}

/**
 * Khối người mua cho MỘT lần thu trong lô đêm. Đọc `don` DƯỚI KHOÁ đơn (máy phát hành gọi lại hàm này trong transaction) nên phụ huynh vừa khai
 * xong giữa lúc lô chạy thì lượt đó thấy ngay và đổi nhánh — không xuất «người tiêu dùng» đè lên tờ họ vừa xin.
 */
export function nguoiMuaChoLoDem(don: DonChoHoaDon, ts: ThamSoTieuDung): QuyetNguoiMuaLoDem {
  const theoDon = nguoiMuaChoDon(don);

  if (daKhaiHoaDon(don)) {
    if (thieuChoHoaDon(theoDon).chan.length === 0) return { ok: true, nguon: "SALE_DA_KHAI", nguoiMua: theoDon };
    return {
      ok: false,
      ma: "DA_KHAI_CHUA_DU",
      lyDo: "Đơn đã khai thông tin xuất hoá đơn nhưng chưa đủ — kế toán bổ sung rồi phát hành, lô đêm không xuất thay",
    };
  }

  const hoTen = sach(ts.tenHocVien);
  if (!hoTen) return { ok: false, ma: "THIEU_TEN_HOC_VIEN", lyDo: "Không xác định được tên học viên của lần thu — kế toán xử lý tay" };
  const diaChi = theoDon.diaChi ?? sach(ts.tinhThanh);
  if (!diaChi) return { ok: false, ma: "THIEU_TINH_THANH", lyDo: "Cơ sở chưa khai tỉnh/thành phố và đơn chưa có địa chỉ — bổ sung ở cấu hình cơ sở" };

  return {
    ok: true,
    nguon: "TIEU_DUNG",
    nguoiMua: {
      hoTen,
      tenDonVi: null,
      maSoThue: null,
      diaChi,
      cccd: null,
      // Email/điện thoại của người đặt đơn vẫn dùng để GỬI tờ hoá đơn cho phụ huynh; chúng không phải "thông tin xuất hoá đơn" nên không có gì để ưu tiên.
      email: theoDon.email,
      dienThoai: theoDon.dienThoai,
      // Mã khách hàng KẾ TOÁN ĐÃ LƯU trên đơn (nếu có) — lô đêm không tự bịa mã.
      maKhachHang: theoDon.maKhachHang,
    },
  };
}

/** Câu một dòng cho báo cáo lô — nói nguồn khối người mua đã chọn. */
export function nhanNguonNguoiMua(n: NguonNguoiMuaLoDem): string {
  return n === "SALE_DA_KHAI" ? "Thông tin Sale/phụ huynh đã khai trên đơn" : "Bán cho người tiêu dùng (tên học viên)";
}
