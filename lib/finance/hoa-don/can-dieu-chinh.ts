// lib/finance/hoa-don/can-dieu-chinh.ts — hoá đơn ĐÃ XUẤT nào "cần điều chỉnh". THUẦN.
//
// Kế hoạch §2.2 + §5: cờ SUY RA lúc đọc, KHÔNG lưu cột. Lưu cột thì ba đường tiền diện R7
// (`refundPayment`, `adjustPayment`, huỷ đơn) phải thêm một phép ghi — đúng thứ §5 muốn tránh
// ("không chặn, không sửa").
//
// GĐ 8 (quyết định (1) 27/09): hoá đơn sai thì HUỶ (DA_XAC_NHAN → THAY_THE) rồi xuất lại theo luồng
// thường ⇒ một bản DA_XAC_NHAN không bao giờ có "bản thay" — cờ TỰ HẾT đúng lúc bản này bị huỷ (nó
// không còn DA_XAC_NHAN). Tham số `coBanThayThe` cũ vì thế đã gỡ: nó chỉ có thể là false.
//
// 29/09 (chủ dự án chốt) — hai mở rộng:
//   · Q1: yêu cầu hoàn học phí (`RefundRequest`) ĐÃ DUYỆT sau mốc ⇒ cần điều chỉnh. Hoàn đi qua
//     /hoan-tien; chưa CHI thì chưa vào sổ Payment ⇒ ba vế cũ không thấy nó (`hoan-tien-don.ts`).
//     Chi rồi (`chiHoanTien`, 29/09) thì có dòng âm trỏ `adjustmentOfId` ⇒ vế 1 + vế 3 cũng bật.
//   · Q3: bản KHONG_XUAT mang lý do "Đã xuất ngoài hệ thống" — khách CÓ hoá đơn (ở MISA) ⇒ tiền đổi
//     sau lúc đánh dấu cũng phải điều chỉnh. Mốc = `createdAt` (đánh dấu = TẠO bản ghi KHONG_XUAT —
//     `ghiHoaDon`; không đường nào sửa bản đó, "gỡ dấu" là XOÁ). Lý do khác ("Khách không lấy hoá
//     đơn", "Khác: …") KHÔNG bật: không có tờ hoá đơn nào để điều chỉnh.
//     ⚠️ Vế "đơn đã huỷ / hoàn" KHÔNG áp cho KHONG_XUAT: màn cho đánh dấu "Đã xuất ngoài hệ thống"
//     NGAY TRÊN đơn đã huỷ (`hanhDongChoDong` nhánh `donDaHuy`) và không có mốc huỷ đơn để so ⇒ áp
//     vào là bật cờ cho đúng đường thường. Bản DA_XAC_NHAN thì khác: `chotHoaDon` từ chối đơn huỷ,
//     nên đơn huỷ + bản đã xác nhận chắc chắn là huỷ SAU khi xuất.

import { TRANG_THAI_DON_DA_HUY } from "./du-dieu-kien";
import { LY_DO_DA_XUAT_NGOAI } from "./ly-do-khong-xuat";
import { lyDoHoanSauMoc, yeuCauHoanCuaKhoan, type PhamViKhoan, type YeuCauHoanVao } from "./hoan-tien-don";

const VIEC_TIEP_DA_XAC_NHAN = "lập hoá đơn điều chỉnh ở MISA rồi huỷ và tải bản đúng";
const VIEC_TIEP_XUAT_NGOAI = "lập hoá đơn điều chỉnh ở MISA rồi gỡ dấu 'Đã xuất ngoài hệ thống' và tải bản đúng";

export function canDieuChinh(input: {
  hoaDon: {
    trangThai: string;
    xacNhanLuc: Date | null;
    tongTien: number;
    /** Lý do KHONG_XUAT (Q3) — chỉ "Đã xuất ngoài hệ thống" mới hỏi. */
    lyDo: string | null;
    /** Mốc của bản KHONG_XUAT (lúc đánh dấu). */
    createdAt: Date;
  };
  /** Các dòng nối của hoá đơn (`HoaDonKhoan`) — số ròng đã chụp lúc gắn. */
  khoan: readonly { paymentId: string; soTien: number }[];
  /** Số ròng HIỆN TẠI của từng khoản — `soTienRong` trên mọi dòng của đơn. */
  rongHienTai: ReadonlyMap<string, number>;
  /** Mọi dòng `Payment` có `adjustmentOfId` ∈ khoản của hoá đơn. */
  dongTroVao: readonly { adjustmentOfId: string; createdAt: Date; deletedAt: Date | null }[];
  trangThaiDon: string;
  /** Yêu cầu hoàn của ĐƠN (`hoanTheoDon`) — BẮT BUỘC (luật 7): bỏ trống là Q1 câm. */
  yeuCauHoan: readonly YeuCauHoanVao[];
  /**
   * 29/09 — móc dòng đơn / ghi danh của từng khoản trên hoá đơn: chỉ yêu cầu hoàn CHẠM các khoản này mới
   * bật cờ (`yeuCauHoanCuaKhoan`). BẮT BUỘC (luật 7): bỏ trống là cờ quay về theo cả đơn.
   */
  phamViKhoan: readonly PhamViKhoan[];
}): { can: boolean; lyDo: string[] } {
  const { hoaDon } = input;
  const daXacNhan = hoaDon.trangThai === "DA_XAC_NHAN";
  const xuatNgoai = hoaDon.trangThai === "KHONG_XUAT" && hoaDon.lyDo === LY_DO_DA_XUAT_NGOAI;
  if (!daXacNhan && !xuatNgoai) return { can: false, lyDo: [] };

  const lyDo: string[] = [];
  const cuaHoaDon = new Set(input.khoan.map((k) => k.paymentId));
  const moc = daXacNhan ? (hoaDon.xacNhanLuc?.getTime() ?? Number.NEGATIVE_INFINITY) : hoaDon.createdAt.getTime();

  if (
    input.dongTroVao.some(
      (d) => d.deletedAt == null && cuaHoaDon.has(d.adjustmentOfId) && d.createdAt.getTime() > moc,
    )
  ) {
    lyDo.push("Có hoàn tiền / điều chỉnh trên khoản sau khi đã xuất hoá đơn");
  }
  if (daXacNhan && (TRANG_THAI_DON_DA_HUY as readonly string[]).includes(input.trangThaiDon)) {
    lyDo.push("Đơn đã bị huỷ / hoàn sau khi xuất hoá đơn");
  }
  const tongHienTai = input.khoan.reduce((s, k) => s + (input.rongHienTai.get(k.paymentId) ?? 0), 0);
  if (tongHienTai !== hoaDon.tongTien) {
    lyDo.push(
      `Số tiền hiện tại (${tongHienTai.toLocaleString("vi-VN")}đ) khác tổng trên hoá đơn ` +
        `(${hoaDon.tongTien.toLocaleString("vi-VN")}đ)`,
    );
  }
  lyDo.push(...lyDoHoanSauMoc(yeuCauHoanCuaKhoan(input.yeuCauHoan, input.phamViKhoan), moc,daXacNhan ? VIEC_TIEP_DA_XAC_NHAN : VIEC_TIEP_XUAT_NGOAI));
  return { can: lyDo.length > 0, lyDo };
}
