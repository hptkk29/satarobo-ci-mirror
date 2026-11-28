import type { TongQuanDaoTao } from "@/lib/elearning/dao-tao-overview";

/**
 * QtTongQuan — phần THUẦN của màn Tổng quan Đào tạo: dải số liệu, danh sách "Cần xử lý", dòng ngày.
 *
 * Tách khỏi trang để test được không cần DB. Mọi con số đến từ `napTongQuanDaoTao` (count thật qua `scopedDb`); hàm ở đây CHỈ sắp xếp/đặt chữ,
 * KHÔNG tính thêm chỉ số nghiệp vụ nào. Khối nào người xem không có quyền thì `tq.<khối>` là `undefined` ⇒ không có ô/dòng tương ứng (không hiện số 0 giả).
 */

export type SacSo = "danger" | "warning" | "mac-dinh";
export type OSo = { nhan: string; so: number; phu?: string; sac: SacSo };
export type DongViec = { tieuDe: string; phu?: string; href: string; nut: string; noiBat: boolean };

const soBai = (n: number, danhTu: string) => `${n} ${danhTu}`;

/** Tối đa 4 ô theo quyền: Bài chờ chấm · Lượt học quá hạn · Lượt giao đang mở · Khoá chờ duyệt. */
export function thongKeTongQuan(tq: TongQuanDaoTao): OSo[] {
  const o: OSo[] = [];
  if (tq.cham) {
    const tong = tq.cham.taoChoCham + tq.cham.thiChoCham;
    o.push({
      nhan: "Bài chờ chấm",
      so: tong,
      phu: tq.cham.taoQuaHanCham > 0 ? `${tq.cham.taoQuaHanCham} bài tập quá hạn chấm` : "không có bài quá hạn chấm",
      sac: tq.cham.taoQuaHanCham > 0 ? "warning" : "mac-dinh",
    });
  }
  if (tq.tienDo) {
    o.push({
      nhan: "Lượt học quá hạn",
      so: tq.tienDo.luotQuaHan,
      phu: `${tq.tienDo.luotDangHoc} lượt đang học`,
      sac: tq.tienDo.luotQuaHan > 0 ? "danger" : "mac-dinh",
    });
  }
  if (tq.giao) o.push({ nhan: "Lượt giao đang mở", so: tq.giao.luotGiaoDangMo, sac: "mac-dinh" });
  if (tq.soan) {
    o.push({
      nhan: "Khoá chờ duyệt",
      so: tq.soan.khoaChoDuyet,
      phu: `${tq.soan.khoaDaDuyet} khoá đã duyệt, chờ xuất bản`,
      sac: "mac-dinh",
    });
  }
  return o;
}

/** Chỉ những việc CÓ số > 0 (danh sách "việc đang chờ" mà rỗng thì nói một câu, không liệt kê dòng 0). Thứ tự = mức gấp: chấm quá hạn → chấm → quá hạn học → duyệt → xuất bản. */
export function dongCanXuLy(tq: TongQuanDaoTao): DongViec[] {
  const v: DongViec[] = [];
  if (tq.cham && tq.cham.taoChoCham > 0) {
    const qua = tq.cham.taoQuaHanCham;
    v.push({
      tieuDe: `${soBai(tq.cham.taoChoCham, "bài tập chờ chấm")}`,
      phu: qua > 0 ? `${qua} bài đã quá hạn chấm` : undefined,
      href: "/elearning/cham-bai-tap",
      nut: "Chấm",
      noiBat: qua > 0,
    });
  }
  if (tq.cham && tq.cham.thiChoCham > 0) {
    v.push({ tieuDe: `${soBai(tq.cham.thiChoCham, "bài thi chờ chấm tay")}`, href: "/elearning/cham-bai", nut: "Chấm", noiBat: false });
  }
  if (tq.tienDo && tq.tienDo.luotQuaHan > 0) {
    v.push({ tieuDe: `${soBai(tq.tienDo.luotQuaHan, "lượt học quá hạn")}`, phu: "Xem theo người và theo khoá ở báo cáo tuân thủ", href: "/elearning/bao-cao", nut: "Xem", noiBat: false });
  }
  if (tq.soan && tq.soan.khoaChoDuyet > 0) {
    v.push({ tieuDe: `${soBai(tq.soan.khoaChoDuyet, "khoá chờ duyệt xuất bản")}`, href: "/elearning/soan-khoa?tab=cho-duyet", nut: "Mở", noiBat: false });
  }
  if (tq.soan && tq.soan.khoaDaDuyet > 0) {
    v.push({ tieuDe: `${soBai(tq.soan.khoaDaDuyet, "khoá đã duyệt, chờ xuất bản")}`, href: "/elearning/soan-khoa?tab=da-duyet", nut: "Mở", noiBat: false });
  }
  return v;
}

/** "Thứ Ba 17/11/2026" theo giờ Việt Nam (ghép từ phần: ICU mỗi máy một kiểu dấu phân cách). */
export function ngayDayDu(d: Date): string {
  const ph = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).formatToParts(d);
  const lay = (t: string) => ph.find((x) => x.type === t)?.value ?? "";
  const thu = lay("weekday");
  const thuHoa = thu ? thu.replace(/(^|\s)(\S)/g, (_m, sp: string, c: string) => sp + c.toLocaleUpperCase("vi-VN")) : "";
  return `${thuHoa} ${lay("day")}/${lay("month")}/${lay("year")}`.trim();
}
