// Cổng phụ huynh — mục «Hoá đơn» trong trang Học phí (03/11/2026). TOÀN BỘ phần THUẦN: hoá đơn nào được hiện cho
// phụ huynh, ai là chủ của nó, dòng hiển thị, đường tải. Không DB, không `server-only` ⇒ test được không cần Postgres.
// Phần chạm DB nằm ở `hoa-don-phu-huynh.ts`; route tải nằm ở `app/(portal)/portal/hoa-don/[hoaDonId]/tai-ve/route.ts`.
//
// Luật (chủ dự án 03/11/2026): kế toán XUẤT hoá đơn ⇒ hoá đơn hiện sang cho phụ huynh XEM + TẢI.
//   · CHỈ bản `DA_XAC_NHAN` (đã chốt, còn hiệu lực). `NHAP` (chưa chốt) · `THAY_THE` (đã huỷ) · `KHONG_XUAT` (không có tờ) ·
//     `DANG_PHAT_HANH` · `LOI_PHAT_HANH` (chưa thành) đều KHÔNG được hiện.
//   · KHÔNG bao giờ hiện bản `MISA_GIA_LAP` (mô phỏng, không có giá trị pháp lý — cổng GIA_LAP).
//   · CHỈ hiện cho đơn CÓ NHU CẦU hoá đơn (chủ dự án 03/11/2026): phụ huynh đã tự khai thông tin người mua (form QR);
//     không khai = không có nhu cầu ⇒ không hiện mục «Hoá đơn», không chuông, không tải được (route trả 404).
//   · Chủ của hoá đơn = phụ huynh có CON gắn với hoá đơn qua một trong hai đường: (a) đơn của hoá đơn là đơn của con
//     (`Order.studentId`), hoặc (b) một khoản thu còn hiệu lực của hoá đơn thuộc ghi danh của con. Hai đường vì đơn nhiều
//     con có thể không có `Order.studentId`, còn khoản thu chưa gắn ghi danh thì chỉ còn đường (a).
//
// ⚠️ Danh sách loại trừ KHÔNG viết theo kiểu "bỏ NHAP, THAY_THE…": viết theo kiểu ĐƯỢC PHÉP DUY NHẤT một trạng thái. Thêm
// trạng thái mới vào enum mà quên ở đây thì mặc định là KHÔNG hiện cho phụ huynh (fail-closed).

import type { Prisma } from "@prisma/client";
import { daKhaiHoaDon, type DonChoHoaDon } from "@/lib/finance/hoa-don/nguoi-mua";

/** Trạng thái DUY NHẤT được hiện cho phụ huynh. */
export const TRANG_THAI_HIEN_CHO_PH = "DA_XAC_NHAN" as const;

/** Nguồn phát hành KHÔNG bao giờ hiện cho phụ huynh. */
export const NGUON_KHONG_HIEN_CHO_PH = "MISA_GIA_LAP" as const;

/** Hoá đơn (trạng thái + nguồn) có được hiện cho phụ huynh không. Fail-closed trên giá trị lạ. */
export function hoaDonHienChoPhuHuynh(h: { trangThai: string; nguonPhatHanh: string }): boolean {
  return h.trangThai === TRANG_THAI_HIEN_CHO_PH && h.nguonPhatHanh !== NGUON_KHONG_HIEN_CHO_PH;
}

/** Bốn cột `Order.invoice*` mà «khách đã khai người mua» đọc (cùng tập với `daKhaiHoaDon`). */
export type DonChoNhuCau = Pick<DonChoHoaDon, "invoiceBuyerName" | "invoiceCompanyName" | "invoiceTaxCode" | "invoiceEmail">;

/**
 * ĐƠN CÓ NHU CẦU HOÁ ĐƠN không — nghĩa: người mua ĐÃ ĐƯỢC KHAI RIÊNG cho hoá đơn (ít nhất một trong bốn cột
 * `invoiceBuyerName` / `invoiceCompanyName` / `invoiceTaxCode` / `invoiceEmail` có chữ).
 *
 * MỘT định nghĩa, hỏi lại `daKhaiHoaDon` của lõi hoá đơn thay vì chép điều kiện: các cột đó cố ý KHÔNG được sao chép sẵn
 * từ hồ sơ/lead/khách đặt đơn (xem lời dặn đầu `nguoiMuaChoDon`) — trống nghĩa là "chưa ai khai riêng", rơi về `customer*` khi
 * xuất — nên bản sao tự động `customerName`, `customerEmail`, `invoiceStudent…`, `invoiceParentPhone` KHÔNG làm đơn thành "có nhu cầu".
 * Form QR công khai (đang ở luồng Invoice Hub) sẽ ghi vào đúng các cột này nên khi nó ra mắt cổng này không phải sửa.
 *
 * ⚠️ Giới hạn đã biết: cột không ghi lại AI khai. Kế toán/Sale bấm Lưu khối «Người mua trên hoá đơn» ở trang đơn cũng ghi các
 * cột này ⇒ coi như có nhu cầu. Muốn phân biệt tuyệt đối cần một cột dấu riêng do form QR ghi (cần migration — chờ chủ dự án).
 */
export function coNhuCauHoaDon(don: DonChoNhuCau): boolean {
  return daKhaiHoaDon({
    customerName: null,
    customerPhone: null,
    customerEmail: null,
    customerAddress: null,
    customerWard: null,
    customerCity: null,
    customerCccd: null,
    // Mã khách hàng (hub/16) là ô đối chiếu của kế toán, tự điền từ mã học viên — KHÔNG phải «khách đã khai người mua», nên không tính vào nhu cầu.
    invoiceCustomerCode: null,
    ...don,
  });
}

/** Điều kiện Prisma (lọc thô theo DB) cho `coNhuCauHoaDon` — luôn kèm kiểm lại bằng hàm thuần ở nơi đọc. */
export const WHERE_DON_CO_NHU_CAU: Prisma.OrderWhereInput = {
  OR: [
    { invoiceBuyerName: { not: "" } },
    { invoiceCompanyName: { not: "" } },
    { invoiceTaxCode: { not: "" } },
    { invoiceEmail: { not: "" } },
  ],
};

/**
 * Điều kiện Prisma: hoá đơn nào của các con `studentIds` được hiện cho phụ huynh. Dùng cho CẢ danh sách lẫn tra
 * một hoá đơn để tải (`hoaDonId`) — MỘT nguồn, để hai nơi không lệch nhau (lệch = tải được thứ danh sách không hiện).
 *
 * `studentIds` rỗng ⇒ điều kiện KHÔNG BAO GIỜ khớp (`id: { in: [] }`) chứ không rơi về "mọi hoá đơn".
 */
export function whereHoaDonPhuHuynh(studentIds: readonly string[], hoaDonId?: string): Prisma.HoaDonDienTuWhereInput {
  const ids = [...studentIds];
  if (ids.length === 0) return { id: { in: [] } };
  return {
    ...(hoaDonId ? { id: hoaDonId } : {}),
    trangThai: TRANG_THAI_HIEN_CHO_PH,
    nguonPhatHanh: { not: NGUON_KHONG_HIEN_CHO_PH },
    // CHỈ đơn CÓ NHU CẦU (phụ huynh đã khai người mua). Đơn không nhu cầu ⇒ hoá đơn không bao giờ hiện / tải được.
    AND: [{ order: { deletedAt: null, AND: [WHERE_DON_CO_NHU_CAU] } }],
    OR: [
      { order: { studentId: { in: ids }, deletedAt: null } },
      {
        khoan: {
          some: {
            hieuLuc: true,
            payment: { deletedAt: null, enrollment: { studentId: { in: ids }, deletedAt: null } },
          },
        },
      },
    ],
  };
}

/**
 * Điều kiện Prisma: các ĐƠN của các con `studentIds` mà phụ huynh CÓ NHU CẦU hoá đơn (đơn của con, hoặc có khoản thu thuộc
 * ghi danh của con; bỏ đơn đã xoá/huỷ/hoàn). Dùng quyết định có vẽ mục «Hoá đơn» hay không.
 */
export function whereDonCoNhuCauCuaCon(studentIds: readonly string[]): Prisma.OrderWhereInput {
  const ids = [...studentIds];
  if (ids.length === 0) return { id: { in: [] } };
  return {
    deletedAt: null,
    status: { notIn: ["CANCELLED", "REFUNDED"] },
    AND: [WHERE_DON_CO_NHU_CAU],
    OR: [
      { studentId: { in: ids } },
      { payments: { some: { deletedAt: null, enrollment: { studentId: { in: ids }, deletedAt: null } } } },
    ],
  };
}

export type HoaDonTho = {
  id: string;
  soHoaDon: string | null;
  kyHieu: string | null;
  /** `@db.Date` — nửa đêm UTC của ngày phát hành. */
  ngayPhatHanh: Date | null;
  xacNhanLuc: Date | null;
  tongTien: number;
  coPdf: boolean;
  coXml: boolean;
  /** Tên khoá từ các khoản thu gắn ghi danh (có thể rỗng). */
  tenKhoaTuKhoan: readonly (string | null)[];
  /** Tên các dòng hàng của đơn — dự phòng khi khoản thu chưa gắn ghi danh. */
  tenDongDon: readonly string[];
};

export type HoaDonHienThi = {
  id: string;
  /** `Hoá đơn số 000127` — không bịa số khi chưa có. */
  tieuDe: string;
  /** `Ký hiệu 1C26TSR · Phát hành 12/09/2026` */
  phu: string;
  /** Tên khoá/dòng hàng; null khi không suy được. */
  khoa: string | null;
  tongTien: number;
  /** Link tải — null khi không có tệp tương ứng hoặc kho tệp chưa sẵn sàng. */
  /** Tải về (ép tải). */
  hrefPdf: string | null;
  /** Xem PDF (mở tab mới, không ép tải) — cùng route, `xem=1`. */
  hrefXemPdf: string | null;
  hrefXml: string | null;
  /** Có tệp nhưng kho chưa cấu hình ⇒ màn nói thật thay vì vẽ nút tải sẽ 503. */
  tepDangChuanBi: boolean;
};

const hai = (n: number) => String(n).padStart(2, "0");

/** `ngayPhatHanh` là cột DATE (nửa đêm UTC) ⇒ đọc phần UTC, KHÔNG đổi múi giờ (đổi sang VN vẫn đúng ngày, nhưng UTC mới là nghĩa của cột). */
export function nhanNgayHoaDon(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${hai(d.getUTCDate())}/${hai(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Ngày chốt (timestamptz) theo lịch VN — dự phòng khi hoá đơn không có ngày phát hành. */
function ngayVnTuLuc(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const vn = new Date(d.getTime() + 7 * 3_600_000);
  return `${hai(vn.getUTCDate())}/${hai(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`;
}

/** Đường tải trên host portal — một chỗ để nút và test cùng dùng. */
export function duongDanTaiHoaDon(hoaDonId: string, loai: "pdf" | "xml", xem = false): string {
  return `/portal/hoa-don/${encodeURIComponent(hoaDonId)}/tai-ve?loai=${loai}${xem && loai === "pdf" ? "&xem=1" : ""}`;
}

/** Gom tên khoá: bỏ trống/trùng, giữ thứ tự, tối đa 3 tên (còn lại ghi "+N"). */
export function tomTenKhoa(tenKhoan: readonly (string | null)[], tenDong: readonly string[]): string | null {
  const gom = (xs: readonly (string | null)[]) => {
    const thay: string[] = [];
    for (const x of xs) {
      const t = (x ?? "").trim();
      if (t && !thay.includes(t)) thay.push(t);
    }
    return thay;
  };
  const ds = gom(tenKhoan);
  const dung = ds.length > 0 ? ds : gom(tenDong);
  if (dung.length === 0) return null;
  if (dung.length <= 3) return dung.join(" · ");
  return `${dung.slice(0, 3).join(" · ")} · +${dung.length - 3}`;
}

export function dungHoaDonHienThi(h: HoaDonTho, khoOk: boolean): HoaDonHienThi {
  const ngay = nhanNgayHoaDon(h.ngayPhatHanh) ?? ngayVnTuLuc(h.xacNhanLuc);
  const phu = [h.kyHieu ? `Ký hiệu ${h.kyHieu}` : null, ngay ? `Phát hành ${ngay}` : null].filter(Boolean).join(" · ");
  return {
    id: h.id,
    tieuDe: h.soHoaDon ? `Hoá đơn số ${h.soHoaDon}` : "Hoá đơn điện tử",
    phu,
    khoa: tomTenKhoa(h.tenKhoaTuKhoan, h.tenDongDon),
    tongTien: h.tongTien,
    hrefPdf: h.coPdf && khoOk ? duongDanTaiHoaDon(h.id, "pdf") : null,
    hrefXemPdf: h.coPdf && khoOk ? duongDanTaiHoaDon(h.id, "pdf", true) : null,
    hrefXml: h.coXml && khoOk ? duongDanTaiHoaDon(h.id, "xml") : null,
    tepDangChuanBi: (h.coPdf || h.coXml) && !khoOk,
  };
}

/** Tên tệp tải về: `hoa-don-<ký hiệu>-<số>.pdf`; thiếu số/ký hiệu thì dùng tên tệp đã lưu. */
export function tenTepTaiVe(h: {
  kyHieu: string | null;
  soHoaDon: string | null;
  loai: "pdf" | "xml";
  tenDaLuu: string | null;
}): string {
  if (h.kyHieu && h.soHoaDon) return `hoa-don-${h.kyHieu}-${h.soHoaDon}.${h.loai}`;
  return h.tenDaLuu ?? `hoa-don.${h.loai}`;
}

/**
 * Trang Học phí có HAI nguồn hoá đơn cho phụ huynh: mục «Hoá đơn» theo nhu cầu (`docMucHoaDon`) và khối «Hoá đơn điện tử» của Invoice Hub S10
 * (cờ theo cơ sở). Khi cả hai bật, CÙNG một `HoaDonDienTu` hiện hai lần. Hoá đơn đã nằm ở khối Hub thì bỏ khỏi mục theo nhu cầu; mục chỉ còn
 * trạng thái rỗng («sẽ hiện ở đây khi hệ thống xuất xong») mà Hub đang có dòng ⇒ ẩn hẳn, kẻo nằm cạnh một hoá đơn đã xuất. Hub không có dòng nào ⇒ giữ nguyên.
 */
export function boHoaDonTrungKhoiHub<T extends { id: string }>(
  muc: { bat: boolean; items: readonly T[] },
  idTrongKhoiHub: ReadonlySet<string>,
): { bat: boolean; items: T[] } {
  const items = muc.items.filter((h) => !idTrongKhoiHub.has(h.id));
  return { bat: muc.bat && (items.length > 0 || idTrongKhoiHub.size === 0), items };
}
