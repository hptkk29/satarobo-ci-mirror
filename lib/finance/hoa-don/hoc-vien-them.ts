// lib/finance/hoa-don/hoc-vien-them.ts — CÁC EM CÒN LẠI của đơn nhiều con trên biểu mẫu QR "thông tin người mua hoá đơn". THUẦN: không DB, không đồng hồ, không `node:crypto`
// ⇒ biểu mẫu CLIENT (phản hồi tức thì) và Server Action (cổng thật) cùng import — MỘT luật, hai nơi gọi.
//
// Vì sao tệp này tồn tại (chủ dự án 09/11/2026, «làm c»): phụ huynh đăng ký cho HAI con trở lên. Ba ô học viên cũ (`tenHocVien` · `ngaySinhHocVien` · `cccdHocVien`,
// → `Order.invoiceStudent*`) chỉ chở được MỘT em. Quyết định: ba ô cũ GIỮ NGUYÊN làm «em thứ nhất» (mọi luồng đang chạy — hợp nhất theo ô, băm xung đột, nhập thay của Sale,
// hộp thoại «Người mua trên hoá đơn», phiếu chờ — không đổi một chữ); các em còn lại nằm ở danh sách này, lưu ở `Order.invoiceHocVienThem` (JSON).
//
// Luật:
//   · Tối đa `TOI_DA_HOC_VIEN_THEM` em THÊM (tổng 6 em/đơn). Quá ⇒ từ chối, không cắt lặng lẽ.
//   · Một dòng HOÀN TOÀN TRỐNG bị bỏ (phụ huynh bấm «Thêm học viên» rồi không điền — không phải lỗi). Dòng có ngày sinh hoặc CCCD mà thiếu TÊN ⇒ lỗi «Nhập họ và tên học viên».
//   · Định dạng từng ô dùng ĐÚNG schema của ba ô học viên cũ (`kiemODon`) — không có bản luật thứ hai.
//   · KHÔNG điền sẵn CCCD (cùng lý do `O_KHONG_DIEN_SAN`: liên kết bị chuyển tiếp không được thành bản sao CCCD của trẻ).
import { chuanHoaO, kiemODon } from "./yeu-cau-nguoi-mua";

export const TOI_DA_HOC_VIEN_THEM = 5;

/** Một em, ĐÃ chuẩn hoá + đã kiểm. `null` = phụ huynh không khai ô đó. */
export type HocVienThem = { ten: string; ngaySinh: string | null; cccd: string | null };
/** Một em ở dạng THÔ trên biểu mẫu (mọi ô là chuỗi, có thể rỗng). */
export type HocVienThemTho = { ten: string; ngaySinh: string; cccd: string };
export type LoiHocVienThem = { ten?: string; ngaySinh?: string; cccd?: string };

/** Trần độ dài MỘT ô thô trước khi chuẩn hoá — chặn gói tin khổng lồ (cùng `TRAN_DO_DAI_THO` của biểu mẫu). */
const TRAN_DO_DAI_THO = 500;

export const THONG_DIEP_HOC_VIEN_THEM = {
  THIEU_TEN: "Nhập họ và tên học viên",
  QUA_NHIEU: `Chỉ nhập được tối đa ${TOI_DA_HOC_VIEN_THEM + 1} học viên cho một hoá đơn`,
} as const;

const chuoi = (v: unknown): string => (typeof v === "string" ? v.slice(0, TRAN_DO_DAI_THO) : "");

/**
 * Đọc giá trị KHÔNG TIN CẬY (JSON từ client) thành danh sách thô. Không phải mảng ⇒ rỗng; phần tử không phải object ⇒ bỏ; khoá lạ ⇒ bỏ.
 * KHÔNG cắt theo `TOI_DA_HOC_VIEN_THEM` ở đây (cắt lặng lẽ là nuốt dữ liệu) — `kiemHocVienThem` từ chối khi quá.
 */
export function docHocVienThemTho(raw: unknown): HocVienThemTho[] {
  if (!Array.isArray(raw)) return [];
  const ra: HocVienThemTho[] = [];
  for (const r of raw.slice(0, TOI_DA_HOC_VIEN_THEM + 10)) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    ra.push({ ten: chuoi(o.ten), ngaySinh: chuoi(o.ngaySinh), cccd: chuoi(o.cccd) });
  }
  return ra;
}

export type KetQuaKiemHocVienThem =
  | { ok: true; ds: HocVienThem[] }
  | { ok: false; /** lỗi THEO CHỈ SỐ trong danh sách thô gửi lên (dòng trống bị bỏ vẫn giữ chỉ số để lỗi khớp đúng khối trên màn) */ theoDong: Record<number, LoiHocVienThem>; chung?: string };

/** Kiểm danh sách thô. Đúng ⇒ danh sách đã chuẩn hoá (dòng trống bị bỏ). Sai ⇒ lỗi theo dòng + lỗi chung (quá số lượng). */
export function kiemHocVienThem(tho: readonly HocVienThemTho[]): KetQuaKiemHocVienThem {
  const ds: HocVienThem[] = [];
  const theoDong: Record<number, LoiHocVienThem> = {};
  let khongTrong = 0;
  tho.forEach((r, i) => {
    const ten = chuanHoaO("tenHocVien", r.ten);
    const ngay = chuanHoaO("ngaySinhHocVien", r.ngaySinh);
    const cccd = chuanHoaO("cccdHocVien", r.cccd);
    if (ten === "" && ngay === "" && cccd === "") return; // dòng trống: bỏ
    khongTrong += 1;
    const loi: LoiHocVienThem = {};
    let tenDung: string | null = null;
    if (ten === "") loi.ten = THONG_DIEP_HOC_VIEN_THEM.THIEU_TEN;
    else {
      const k = kiemODon("tenHocVien", ten);
      if (k.ok) tenDung = k.giaTri;
      else loi.ten = k.loi;
    }
    let ngayDung: string | null = null;
    if (ngay !== "") {
      const k = kiemODon("ngaySinhHocVien", ngay);
      if (k.ok) ngayDung = k.giaTri;
      else loi.ngaySinh = k.loi;
    }
    let cccdDung: string | null = null;
    if (cccd !== "") {
      const k = kiemODon("cccdHocVien", cccd);
      if (k.ok) cccdDung = k.giaTri;
      else loi.cccd = k.loi;
    }
    if (Object.keys(loi).length > 0) theoDong[i] = loi;
    else if (tenDung !== null) ds.push({ ten: tenDung, ngaySinh: ngayDung, cccd: cccdDung });
  });
  const quaNhieu = khongTrong > TOI_DA_HOC_VIEN_THEM;
  if (Object.keys(theoDong).length > 0 || quaNhieu) {
    return { ok: false, theoDong, ...(quaNhieu ? { chung: THONG_DIEP_HOC_VIEN_THEM.QUA_NHIEU } : {}) };
  }
  return { ok: true, ds };
}

/**
 * Đọc lại cột `Order.invoiceHocVienThem` một cách phòng thủ: null / hỏng / sai hình dạng ⇒ `[]` (dữ liệu sửa tay không được làm sập đường công khai hay màn nhân viên).
 * Phần tử sai hình dạng bị bỏ; quá trần thì chỉ giữ `TOI_DA_HOC_VIEN_THEM` phần tử đầu.
 */
export function docHocVienThemLuu(json: unknown): HocVienThem[] {
  if (!Array.isArray(json)) return [];
  const ra: HocVienThem[] = [];
  for (const r of json) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const ten = typeof o.ten === "string" ? chuanHoaO("tenHocVien", o.ten) : "";
    if (ten === "") continue;
    const ngay = typeof o.ngaySinh === "string" ? chuanHoaO("ngaySinhHocVien", o.ngaySinh) : "";
    const cccd = typeof o.cccd === "string" ? chuanHoaO("cccdHocVien", o.cccd) : "";
    ra.push({ ten, ngaySinh: ngay === "" ? null : ngay, cccd: cccd === "" ? null : cccd });
    if (ra.length >= TOI_DA_HOC_VIEN_THEM) break;
  }
  return ra;
}

/** Danh sách rỗng ⇒ `null` (cột trống = «chưa khai thêm em nào», khớp quy ước các cột `invoice*`). */
export const dungHocVienThemLuu = (ds: readonly HocVienThem[]): HocVienThem[] | null => (ds.length > 0 ? ds.map((d) => ({ ten: d.ten, ngaySinh: d.ngaySinh, cccd: d.cccd })) : null);

/** Hai danh sách giống nhau không (so theo thứ tự + từng ô đã chuẩn hoá). Dùng để biết phụ huynh có THẬT SỰ đổi so với bản điền sẵn. */
export function giongHocVienThem(a: readonly HocVienThem[], b: readonly HocVienThem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.ten === b[i]!.ten && x.ngaySinh === b[i]!.ngaySinh && x.cccd === b[i]!.cccd);
}

/**
 * Hợp nhất danh sách phụ huynh VỪA GỬI (`gui`) vào danh sách đang lưu trên đơn (`hienTai`) — cùng tinh thần «ô để trống KHÔNG xoá giá trị đã có» của ba ô học viên cũ:
 * ngày sinh / CCCD phụ huynh không gõ lại (CCCD không bao giờ điền sẵn!) thì GIỮ giá trị đang lưu của CHÍNH em đó.
 * «Chính em đó» = cùng TÊN (so sau chuẩn hoá, không phân biệt hoa thường), KHÔNG theo chỉ số: xoá một khối ở giữa làm các chỉ số trượt, ghép theo chỉ số là gán CCCD của em này cho em khác.
 * Em bị phụ huynh gỡ khỏi danh sách thì bị gỡ (kể cả CCCD của em đó). Hai em trùng tên: mỗi bản lưu chỉ được ghép MỘT lần, theo thứ tự.
 */
export function hopNhatHocVienThem(hienTai: readonly HocVienThem[], gui: readonly HocVienThem[]): HocVienThem[] {
  const daDung = new Set<number>();
  const khoa = (s: string) => s.toLocaleLowerCase("vi");
  return gui.map((g) => {
    const i = hienTai.findIndex((h, idx) => !daDung.has(idx) && khoa(h.ten) === khoa(g.ten));
    if (i >= 0) daDung.add(i);
    const cu = i >= 0 ? hienTai[i]! : null;
    return { ten: g.ten, ngaySinh: g.ngaySinh ?? cu?.ngaySinh ?? null, cccd: g.cccd ?? cu?.cccd ?? null };
  });
}

/**
 * Bản ĐIỀN SẴN cho trang công khai: có tên + ngày sinh, KHÔNG BAO GIỜ có CCCD (xem đầu tệp). Là cổng cuối — không tin nơi gọi.
 * Hệ quả cho `banDau` (phía client gửi lại): CCCD luôn là `null` ở bản điền sẵn, nên mọi CCCD phụ huynh gõ đều được tính là «đổi».
 */
export const dienSanHocVienThem = (ds: readonly HocVienThem[]): HocVienThem[] => ds.map((d) => ({ ten: d.ten, ngaySinh: d.ngaySinh, cccd: null }));

/** Che theo quyền xem thông tin cá nhân: không có `orders:view-pii` ⇒ chỉ còn TÊN (không ngày sinh, không CCCD). */
export const cheHocVienThem = (ds: readonly HocVienThem[], xemPii: boolean): HocVienThem[] =>
  xemPii ? ds.map((d) => ({ ...d })) : ds.map((d) => ({ ten: d.ten, ngaySinh: null, cccd: null }));
