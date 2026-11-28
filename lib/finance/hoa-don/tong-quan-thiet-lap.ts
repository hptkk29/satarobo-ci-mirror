// lib/finance/hoa-don/tong-quan-thiet-lap.ts — «Tổng quan thiết lập» của trang Cấu hình hoá đơn: bốn bước, mỗi bước đang ở trạng thái nào và việc cần làm tiếp theo. THUẦN (không DB, không React).
//
// Vì sao có (chủ dự án 05/11/2026: «giao diện khó dùng quá»). Trang Cấu hình xếp 6 khu liền nhau, mỗi khu một hình dạng, và KHÔNG khu nào cho biết «cơ sở này đã phát hành được chưa, việc còn lại là gì».
// Người dùng phải cuộn hết trang rồi tự ghép các dấu «Chưa dùng được» lại. Hàm này gom thành MỘT danh sách ngắn, theo thứ tự nên làm, bằng chữ đời thường; màn chỉ việc vẽ.
//
// Quy tắc nói thật (luật 12): chỉ nói «xong» khi dữ liệu thật nói xong. Phần người xem không có quyền xem thì nói rõ «không xem được», KHÔNG đoán «ổn» hay «thiếu».
import type { MucCanhBao } from "./ket-noi/hien-thi";
import type { KhoaHuongDan } from "./huong-dan";

export type TrangThaiMuc = "xong" | "can-lam" | "luu-y" | "tuy-chon" | "khong-xem-duoc";
export type KhoaMuc = "phap-nhan" | "ket-noi" | "chinh-sach-ky" | "chinh-sach-hoa-don";

export type MucTongQuan = {
  khoa: KhoaMuc;
  buoc: 1 | 2 | 3 | 4;
  tieuDe: string;
  trangThai: TrangThaiMuc;
  /** Một câu đời thường nói trạng thái + việc cần làm. */
  dong: string;
  /** `id` của khu trong trang — nút «Đi tới» cuộn tới đó. */
  neo: string;
  /** Khoá hướng dẫn của bước (biểu tượng «?»). */
  huongDan: Extract<KhoaHuongDan, "buoc-phap-nhan" | "buoc-ket-noi" | "buoc-chinh-sach-ky" | "buoc-chinh-sach-hoa-don">;
};

export type DauVaoTongQuan = {
  /** Pháp nhân PHÁT HÀNH hôm nay của cơ sở (theo cấu hình cơ sở), hoặc câu lỗi nói vì sao chưa xác định được. */
  phapNhan: { ten: string; kyHieu: string | null } | { loi: string };
  /** Cây tổ chức ghi một pháp nhân, cấu hình cơ sở phát hành dưới pháp nhân khác ⇒ câu cảnh báo; không lệch ⇒ `null`. */
  canhBaoLech: string | null;
  /** `null` = người xem không xem được kết nối (chỉ kế toán Hội sở). `nhaCungCap` = tên in ra («VIN-HOADON»), `null` nếu chưa biết. */
  ketNoi: null | { muc: MucCanhBao; nhan: string; chiTiet: string; nhaCungCap: string | null };
  /** `null` = không xem được. `khaiDuHanMuc: null` = người xem thấy trạng thái dừng nhưng không thấy hạn mức. */
  chinhSachKy: null | { tamDung: boolean; suCo: boolean; khaiDuHanMuc: boolean | null };
  /** `null` = khu Chính sách hoá đơn không có trên màn (cờ Hub tắt) ⇒ KHÔNG có dòng bước 4. */
  chinhSachHoaDon: null | { soBanHieuLuc: number };
};

export type TongQuanThietLap = {
  tieuDe: string;
  /** `true` = mọi thứ người xem thấy đều ổn · `false` = còn việc / đang dừng · `null` = phần ổn nhưng còn phần không xem được. */
  sanSang: boolean | null;
  soCanLam: number;
  muc: MucTongQuan[];
};

export function dungTongQuan(v: DauVaoTongQuan): TongQuanThietLap {
  const muc: MucTongQuan[] = [];

  // ── Bước 1 ──
  if ("loi" in v.phapNhan) {
    muc.push({ khoa: "phap-nhan", buoc: 1, tieuDe: "Pháp nhân & ký hiệu", trangThai: "can-lam", dong: `Chưa khai. ${v.phapNhan.loi}`, neo: "phap-nhan-ky-hieu", huongDan: "buoc-phap-nhan" });
  } else {
    const ky = v.phapNhan.kyHieu ? `ký hiệu ${v.phapNhan.kyHieu}` : "chưa có ký hiệu";
    muc.push({
      khoa: "phap-nhan",
      buoc: 1,
      tieuDe: "Pháp nhân & ký hiệu",
      trangThai: v.canhBaoLech ? "luu-y" : "xong",
      dong: v.canhBaoLech ? `Phát hành dưới ${v.phapNhan.ten} · ${ky}. ${v.canhBaoLech}` : `Phát hành dưới ${v.phapNhan.ten} · ${ky}.`,
      neo: "phap-nhan-ky-hieu",
      huongDan: "buoc-phap-nhan",
    });
  }

  // ── Bước 2 ──
  const base2 = { khoa: "ket-noi", buoc: 2, tieuDe: "Kết nối nhà cung cấp", neo: "ket-noi-ky", huongDan: "buoc-ket-noi" } as const;
  if (v.ketNoi === null) {
    muc.push({ ...base2, trangThai: "khong-xem-duoc", dong: "Chỉ kế toán Hội sở xem được phần này." });
  } else {
    const ten = v.ketNoi.nhaCungCap ? `${v.ketNoi.nhaCungCap} · ` : "";
    if (v.ketNoi.muc === "success") muc.push({ ...base2, trangThai: "xong", dong: `${ten}${v.ketNoi.chiTiet}` });
    else if (v.ketNoi.muc === "info") muc.push({ ...base2, trangThai: "luu-y", dong: `${ten}${v.ketNoi.nhan}. Nên khai kết nối ở đây để không phụ thuộc cấu hình trên máy chủ.` });
    else muc.push({ ...base2, trangThai: "can-lam", dong: `${ten}${v.ketNoi.chiTiet}` });
  }

  // ── Bước 3 ──
  const base3 = { khoa: "chinh-sach-ky", buoc: 3, tieuDe: "Tạm dừng & hạn mức ký", neo: "chinh-sach-ky", huongDan: "buoc-chinh-sach-ky" } as const;
  if (v.chinhSachKy === null) {
    muc.push({ ...base3, trangThai: "khong-xem-duoc", dong: "Bạn không có quyền xem phần này." });
  } else if (v.chinhSachKy.tamDung) {
    muc.push({
      ...base3,
      trangThai: "luu-y",
      dong: v.chinhSachKy.suCo ? "Đang tạm dừng ký vì sự cố bảo mật — hoá đơn mới không được gửi cho tới khi bật lại." : "Đang tạm dừng ký — hoá đơn mới không được gửi cho tới khi bật lại.",
    });
  } else if (v.chinhSachKy.khaiDuHanMuc === null) {
    muc.push({ ...base3, trangThai: "xong", dong: "Đang ký bình thường." });
  } else if (v.chinhSachKy.khaiDuHanMuc) {
    muc.push({ ...base3, trangThai: "xong", dong: "Đang ký bình thường · đã khai hạn mức ký tự động." });
  } else {
    muc.push({ ...base3, trangThai: "tuy-chon", dong: "Đang ký bình thường · chưa khai hạn mức. Chỉ cần khi bật ký tự động; kế toán bấm «Phát hành» không bị ảnh hưởng." });
  }

  // ── Bước 4 ──
  if (v.chinhSachHoaDon !== null) {
    const base4 = { khoa: "chinh-sach-hoa-don", buoc: 4, tieuDe: "Chính sách hoá đơn", neo: "cs-tieu-de", huongDan: "buoc-chinh-sach-hoa-don" } as const;
    muc.push(
      v.chinhSachHoaDon.soBanHieuLuc > 0
        ? { ...base4, trangThai: "xong", dong: `${v.chinhSachHoaDon.soBanHieuLuc} chính sách đang hiệu lực.` }
        : { ...base4, trangThai: "tuy-chon", dong: "Chưa có chính sách. Cách lập hoá đơn hiện nay không đổi; chỉ cần khi muốn hệ thống lập hoá đơn tự động theo quy tắc." },
    );
  }

  const soCanLam = muc.filter((m) => m.trangThai === "can-lam").length;
  const dangDung = v.chinhSachKy?.tamDung === true;
  const coPhanKhongXem = muc.some((m) => m.trangThai === "khong-xem-duoc");
  const sanSang = soCanLam > 0 || dangDung ? false : coPhanKhongXem ? null : true;
  const tieuDe = dangDung
    ? "Đang tạm dừng ký — chưa phát hành được"
    : soCanLam > 0
      ? `Còn ${soCanLam} việc cần làm trước khi phát hành`
      : sanSang === null
        ? "Phần bạn xem được đã ổn"
        : "Sẵn sàng phát hành";
  return { tieuDe, sanSang, soCanLam, muc };
}
