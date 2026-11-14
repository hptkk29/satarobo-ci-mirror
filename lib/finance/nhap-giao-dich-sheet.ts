// lib/finance/nhap-giao-dich-sheet.ts — đọc sheet đăng ký thành GIAO DỊCH HỌC PHÍ.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI
//
// Học viên chốt trước khi hệ thống chạy thì không có `Payment` nào, nên cổng phụ huynh
// cộng công nợ theo `Enrollment.payments` ra NỢ NGUYÊN — dù nhà đã đóng đủ từ lâu. Nguồn
// sự thật của những khoản đó là file `Satarobo - Danh sách đăng ký.xlsx`.
//
// File này chỉ ĐỌC và CHUẨN HOÁ. Nó không chạm DB, không quyết định ghi gì — để phần luật
// nguy hiểm nhất test được mà không cần database, và để màn xem thử với đường ghi dùng
// CHUNG một phép tính (hai phép tính là hai con số, và người ta sẽ tin con số trên màn).
//
// ─────────────────────────────────────────────────────────────────────────────
// BỐN CÁI BẪY ĐO ĐƯỢC TRONG CHÍNH FILE — mỗi cái một đường mất tiền
//
//  (1) DÒNG TỔNG. 12 dòng không tên/không mã/không tình trạng, chỉ có một ô tiền, cộng
//      lại 1.382.987.666đ = 62% tổng tiền cả file. `Tháng 52026!d16 = 30.322.000đ` đúng
//      bằng tổng 6 dòng phía trên. Nhập nhầm là thổi doanh thu gấp 2,7 lần.
//
//  (2) SHEET LỒNG NHAU. "Tháng 62026" chứa TRỌN "Tháng 52026" (6/6 dòng khớp cả mã lẫn
//      tiền). Nhập cả hai là cộng đôi 30.322.000đ tiền thật.
//
//  (3) MÃ KHÔNG NHẤT QUÁN. `CS1.HV.0031` và `CS1.HV0031` là cùng một em. So chuỗi thô
//      tách một em thành hai, và một nửa tiền rơi vào hồ sơ không tồn tại.
//
//  (4) NHIỀU ĐỢT MỘT EM. 21 em đóng 2 đợt, 3 em đóng 3 đợt. Gộp phải CỘNG DỒN; ghi đè
//      là xoá mất đợt trước.
// ─────────────────────────────────────────────────────────────────────────────

import { canonicalPhone } from "@/lib/phone";

/** Một dòng thô từ XLSX — khoá là nhãn cột trong file. */
export type DongSheet = Record<string, unknown>;

export type GiaoDichSheet = {
  sheet: string;
  /** Số dòng trong sheet — để người soát mở đúng chỗ trong file gốc. */
  dong: number;
  maHV: string | null;
  hoTen: string | null;
  sdt: string | null;
  hocPhi: number;
  ngay: Date | null;
  khoa: string | null;
  coSo: string | null;
  tinhTrang: string;
  ghiChu: string;
  /**
   * Tên SALE ghi trong cột "Sales" — dạng tên gọi ("Diệu", "Nhật Hạ"), không phải tài
   * khoản. Người nhập map 6 tên này sang tài khoản ở màn nhập; xem lib/finance/khop-sale-sheet.ts.
   */
  sale: string | null;
};

/**
 * `CS1.HV0031` · `CS1.HV.31` · `cs1 hv 31` → `CS1.HV.0031`.
 *
 * Đệm 0 cho đủ 4 chữ số vì DB dùng dạng đó (`Student.studentCode`, đo thật: 250/250 bản
 * ghi mang dạng `CS1.HV.0001`). Chuỗi không theo khuôn thì trả null — KHÔNG bịa mã, vì
 * cột mã trong file có chỗ bị gõ ghi chú vào (`"NHẬP TAB THÁNG 8"`).
 */
export function chuanMaHV(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  const m = /^(CS\d+)[.\s]*HV[.\s]*(\d+)$/.exec(s);
  if (!m) return null;
  return `${m[1]}.HV.${String(Number(m[2])).padStart(4, "0")}`;
}

/**
 * SĐT từ sheet → dạng CHUẨN CỦA HỆ THỐNG.
 *
 * ⚠️ ĐO ĐƯỢC 14/09/2026: DB lưu `84905167198`, KHÔNG phải `0905167198`
 * (`select "parentPhone" from "Student"` → `84930000007`…). Bản đầu của file này tự viết
 * một hàm trả `0…` và nó sẽ khớp ĐÚNG 0 DÒNG — sai lặng lẽ, không lỗi, chỉ là "không tìm
 * thấy học viên nào".
 *
 * Nên đây chỉ là lớp mỏng bọc `canonicalPhone` của repo: một định nghĩa SĐT cho cả hệ,
 * không đẻ thêm định nghĩa thứ hai ở tầng nhập liệu.
 */
export function chuanSdtSheet(v: unknown): string | null {
  if (v == null) return null;
  let s = String(v).trim();
  // Excel hay trả số điện thoại thành số thực: 905499860 hoặc "905499860.0".
  if (s.endsWith(".0")) s = s.slice(0, -2);
  if (/^\d{9}$/.test(s)) s = "0" + s; // mất số 0 đầu do ô định dạng NUMBER
  return canonicalPhone(s);
}

/**
 * Tên học viên → dạng SO SÁNH: bỏ dấu, bỏ khoảng trắng thừa, viết hoa.
 *
 * Bỏ dấu vì hai bên gõ khác nhau ("Nguyễn Công Hoàng Khải" ở sheet vs bản ghi hệ thống),
 * và một dấu sai là một em không khớp — trong khi hậu quả của khớp lỏng ở đây bị chặn
 * bằng việc PHẢI khớp CẢ SĐT.
 */
export function chuanTenSoSanh(v: unknown): string {
  if (v == null) return "";
  const s = String(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Tên sheet → NGÀY 1 của tháng nó nói tới. `null` nếu không đọc được.
 *
 * Dùng làm mốc lùi cho 23 dòng thiếu ngày. Vì sao không `new Date()`: báo cáo doanh thu
 * theo tháng, danh sách đơn và cron đều xếp theo `Order.createdAt`; để đồng hồ thật thì
 * học phí tháng 5 hiện thành doanh thu tháng 9. Tháng là dữ liệu CÓ THẬT trong file (tên
 * sheet), ngày trong tháng thì không — nên lấy ngày 1 và nói ra, đừng đoán ngày.
 *
 * "4 số CUỐI là năm": "Tháng 52026" là 5/2026, "Tháng 122026" là 12/2026 — tách kiểu
 * khác thì tháng 12 thành tháng 1.
 */
export function thangCuaSheet(sheet: string): Date | null {
  const s = chuanTenSoSanh(sheet);
  const m = /THANG\s*(\d{1,2})(\d{4})/.exec(s);
  if (!m) return null;
  const thang = Number(m[1]);
  const nam = Number(m[2]);
  if (!Number.isInteger(thang) || thang < 1 || thang > 12) return null;
  if (!Number.isInteger(nam) || nam < 2000 || nam > 2100) return null;
  return new Date(nam, thang - 1, 1);
}

/**
 * Ô "Ngày" của sheet → `Date`, hoặc `null`. KHÔNG BAO GIỜ để `new Date(chuỗi)` tự đoán.
 *
 * ⚠️ ĐO 14/09/2026 trên file thật (136 dòng dùng được): chỉ **59** ô là `Date`; **54** ô
 * là CHUỖI (49 dạng `"13/06/2026"`, 5 dạng `"29/08"` không có năm) và **23** ô trống thật.
 * Bản đầu làm `new Date(String(v))` ⇒ `"13/06/2026"` ra **Invalid Date** ⇒ 54 ngày THẬT
 * bị vứt lặng, màn nhập báo "77 dòng thiếu ngày" trong khi file chỉ trống 23.
 *
 * ⚠️ VÀ NÓ CÒN NGUY HƠN VẺ NGOÀI. Lần này 49/49 chuỗi có ngày > 12 nên JS ném Invalid —
 * rơi một cách THẤY ĐƯỢC. File tháng sau có `"01/07/2026"` thì `new Date` đọc trôi chảy
 * thành **7 tháng 1**: không lỗi, không cảnh báo, học phí tháng 7 nhảy sang tháng 1. Đó
 * là lý do phải TỰ TÁCH `dd/mm/yyyy` — người Việt gõ ngày trước, JS đọc tháng trước.
 *
 * `sheet` dùng để vớt NĂM cho dạng `"29/08"`. Năm là dữ liệu CÓ THẬT ở tên sheet; tên
 * sheet không có năm thì trả `null` chứ KHÔNG lấy năm hiện tại (luật 19 — hàm rơi về
 * đồng hồ thật là ca hẹn giờ nổ).
 */
export function docNgaySheet(v: unknown, sheet: string): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;

  // Số sê-ri Excel (phòng khi `cellDates` không bắt được ô). Mốc 30/12/1899 là quy ước
  // của Excel, kể cả lỗi năm nhuận 1900 mà nó cố tình giữ.
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100_000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  const s = String(v ?? "").trim();
  if (!s) return null;

  const dung = (nam: number, thang: number, ngay: number): Date | null => {
    // `new Date(2026, 12, 32)` KHÔNG ném — nó trả 01/01/2027. Im lặng và sai, nên phải
    // kiểm khoảng TRƯỚC khi dựng.
    if (thang < 1 || thang > 12 || ngay < 1 || ngay > 31) return null;
    if (nam < 2000 || nam > 2100) return null;
    const d = new Date(nam, thang - 1, ngay);
    // Chốt lại: 31/02 lọt qua kiểm khoảng nhưng cuộn sang tháng 3.
    return d.getMonth() === thang - 1 && d.getDate() === ngay ? d : null;
  };

  // ISO `yyyy-mm-dd` — không mơ hồ, đọc thẳng.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return dung(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // `dd/mm/yyyy` · `dd-mm-yyyy` · `dd.mm.yyyy`
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (dmy) return dung(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  // `dd/mm` — năm lấy từ TÊN SHEET.
  const dm = /^(\d{1,2})[/\-.](\d{1,2})$/.exec(s);
  if (dm) {
    const moc = thangCuaSheet(sheet);
    if (!moc) return null;
    return dung(moc.getFullYear(), Number(dm[2]), Number(dm[1]));
  }

  return null;
}

function chuoi(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function tien(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  const s = String(v).replace(/[^\d]/g, "");
  return s ? Number(s) : 0;
}

/**
 * Dòng này có phải DÒNG TỔNG / dòng rác không.
 *
 * FAIL-CLOSED: thiếu tình trạng thì LOẠI, kể cả khi có tên và có tiền. Không biết khoản
 * đã vào tài khoản hay chưa mà vẫn ghi là tự tạo ra một khoản thu không có căn cứ —
 * người nhập sẽ thấy nó ở danh sách bỏ qua và tự quyết.
 */
export function laDongTong(d: {
  maHV: string | null;
  hoTen: string | null;
  tinhTrang: string;
  hocPhi: number;
}): boolean {
  if (d.hocPhi <= 0) return true;
  if (!d.tinhTrang) return true;
  if (!d.maHV && !d.hoTen) return true;
  return false;
}

/** Lấy ô theo nhiều nhãn — header giữa các sheet không đồng nhất. */
function o(d: DongSheet, ...ten: string[]): unknown {
  for (const t of ten) {
    for (const k of Object.keys(d)) {
      if (k.replace(/\s+/g, " ").trim().toLowerCase() === t) {
        const v = d[k];
        if (v != null && String(v).trim() !== "") return v;
      }
    }
  }
  return undefined;
}

export function docDongGiaoDich(
  d: DongSheet,
  sheet: string,
  dong: number,
): GiaoDichSheet | null {
  const maHV = chuanMaHV(o(d, "mã học viên", "mã hv"));
  const hoTen = chuoi(o(d, "họ và tên học viên")) || null;
  const tinhTrang = chuoi(o(d, "tình trạng"));
  const hocPhi = tien(o(d, "học phí"));

  if (laDongTong({ maHV, hoTen, tinhTrang, hocPhi })) return null;

  const ngay = docNgaySheet(o(d, "ngày"), sheet);

  return {
    sheet,
    dong,
    maHV,
    hoTen,
    sdt: chuanSdtSheet(o(d, "số điện thoại")),
    hocPhi,
    ngay,
    khoa: chuoi(o(d, "khoá học đăng ký", "khóa học đăng ký")) || null,
    // ⚠️ "minh" là nhãn cột BỊ GÕ NHẦM ở sheet "Tháng 62026", đúng vị trí cột Cơ sở.
    // Đọc cả hai vì sửa file gốc không phải việc của mã, và bỏ qua thì mất cơ sở của
    // 63 dòng.
    coSo: chuoi(o(d, "cơ sở", "minh")) || null,
    tinhTrang,
    ghiChu: chuoi(o(d, "ghi chú")),
    // Đo 14/09/2026: mọi sheet học phí đều có cột nhãn đúng "Sales", 0/136 dòng để trống.
    sale: chuoi(o(d, "sales", "sale")) || null,
  };
}

export type KetQuaTrungSheet = {
  chuaTron: boolean;
  soDongTrung: number;
  /** Số tiền sẽ bị cộng đôi nếu nhập cả hai sheet. */
  tienCongDoi: number;
};

/**
 * Sheet `nho` có nằm trọn trong sheet `lon` không.
 *
 * Khoá so là (SĐT, tên, số tiền) — KHÔNG có ngày, vì "Tháng 52026" bỏ trống ngày trong
 * khi "Tháng 62026" có; so thêm ngày là bỏ sót đúng cặp cần bắt. Và KHÔNG dùng mã sheet:
 * mã trong file có dòng để trống, còn SĐT+tên là khoá đang dùng ở mọi chỗ khác.
 *
 * Cùng người mà KHÁC tiền thì không phải trùng — đó là hai đợt đóng khác nhau, gộp lại
 * là xoá mất một đợt.
 */
export function sheetChuaTronSheet(
  nho: Array<{ sdt: string | null; hoTen: string | null; hocPhi: number }>,
  lon: Array<{ sdt: string | null; hoTen: string | null; hocPhi: number }>,
): KetQuaTrungSheet {
  const khoa = (x: { sdt: string | null; hoTen: string | null; hocPhi: number }) =>
    `${x.sdt ?? ""}|${chuanTenSoSanh(x.hoTen)}|${x.hocPhi}`;

  const coKhoa = nho.filter((x) => x.sdt || x.hoTen);
  if (coKhoa.length === 0) return { chuaTron: false, soDongTrung: 0, tienCongDoi: 0 };

  const khoaLon = new Set(lon.filter((x) => x.sdt || x.hoTen).map(khoa));
  const trung = coKhoa.filter((x) => khoaLon.has(khoa(x)));

  return {
    chuaTron: trung.length === coKhoa.length,
    soDongTrung: trung.length,
    tienCongDoi: trung.reduce((s, x) => s + x.hocPhi, 0),
  };
}

export type HocVienGop = {
  /** Mã trong SHEET — giữ để soi ngược về dòng gốc. KHÔNG dùng để khớp với hệ thống. */
  maHV: string | null;
  hoTen: string | null;
  /** Dạng chuẩn `84…` — khớp thẳng với `Student.parentPhone`. */
  sdt: string | null;
  tongTien: number;
  soDot: number;
  /** Thiếu SĐT ⇒ không khớp tự động được, phải có người chỉ đúng em. */
  canNguoiXem: boolean;
  /**
   * Sale của ĐỢT ĐẦU — đơn là một, nên người phụ trách cũng phải là một.
   * `null` khi mọi dòng của em đều bỏ trống cột Sales.
   */
  sale: string | null;
  /**
   * Các đợt của em ghi TÊN SALE KHÁC NHAU. Không tự chọn hộ — hiện ra để người nhập
   * biết mình đang gán cả lô cho ai; im lặng lấy dòng đầu là cướp công của người kia.
   */
  saleKhac: boolean;
  giaoDich: GiaoDichSheet[];
};

/**
 * Gộp giao dịch theo HỌC VIÊN — khoá là (SĐT phụ huynh, họ tên). CỘNG DỒN.
 *
 * ⚠️ CHỦ DỰ ÁN CHỐT 14/09/2026: "mã học viên ở sheet KHÁC HOÀN TOÀN mã trên hệ thống, nên
 * nếu lấy đúng thì lấy ở SĐT của phụ huynh, và họ tên." Mã trong sheet vẫn được đọc và
 * giữ lại để soi ngược dòng gốc, nhưng KHÔNG còn là khoá khớp.
 *
 * ⚠️ SĐT MỘT MÌNH KHÔNG ĐỦ. Đo trên file thật: 102 SĐT riêng biệt nhưng 9 SĐT dùng cho
 * HAI em — anh chị em ruột (HOANG VINH KHANG + HOANG BAO THANH cùng `0905167198`, cùng
 * phụ huynh). Gộp theo SĐT là dồn học phí hai em vào một, và em còn lại vẫn hiện nợ
 * nguyên ở cổng phụ huynh — đúng cái bệnh đang đi chữa.
 *
 * Tên so ở dạng BỎ DẤU (`chuanTenSoSanh`) vì hai bên gõ khác nhau. Khớp lỏng ở tên không
 * nguy hiểm vì nó luôn đi kèm SĐT; đo thật: 0 ca tên trùng nhau mà khác SĐT, và cặp
 * (SĐT, tên) ra đúng 115 em — khớp con số đếm bằng mã.
 *
 * Giữ nguyên từng giao dịch trong `giaoDich` để màn xem thử chỉ ra được dòng nào ở sheet
 * nào; một con tổng không giải trình được thì không ai dám bấm.
 */
export function gopTheoHocVien(gd: GiaoDichSheet[]): HocVienGop[] {
  const map = new Map<string, HocVienGop>();

  for (const g of gd) {
    const ten = chuanTenSoSanh(g.hoTen);
    // Thiếu SĐT thì lùi về gộp theo TÊN — và đánh dấu `canNguoiXem` chứ không im lặng
    // coi như đã khớp. Đo thật: 4/136 giao dịch không có SĐT; bỏ chúng là bỏ tiền của
    // một em.
    const khoa = g.sdt ? `${g.sdt}|${ten}` : `NOSDT|${ten}`;
    const cu = map.get(khoa);
    if (cu) {
      cu.tongTien += g.hocPhi;
      cu.soDot += 1;
      cu.giaoDich.push(g);
      cu.hoTen = cu.hoTen ?? g.hoTen;
      cu.maHV = cu.maHV ?? g.maHV;
      const saleMoi = g.sale?.trim() || null;
      if (saleMoi) {
        if (!cu.sale) cu.sale = saleMoi;
        else if (chuanTenSoSanh(cu.sale) !== chuanTenSoSanh(saleMoi)) cu.saleKhac = true;
      }
    } else {
      map.set(khoa, {
        maHV: g.maHV,
        hoTen: g.hoTen,
        sdt: g.sdt,
        tongTien: g.hocPhi,
        soDot: 1,
        canNguoiXem: g.sdt == null,
        sale: g.sale?.trim() || null,
        saleKhac: false,
        giaoDich: [g],
      });
    }
  }

  // Thứ tự ổn định theo khoá — kết quả không được đổi theo thứ tự đọc sheet.
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, v]) => v);
}
