// lib/finance/hoa-don/phan-phoi-doc.ts — "hoá đơn ĐÃ PHÁT HÀNH nào được HIỂN THỊ / TẢI cho vai nào". THUẦN: không DB, không đồng hồ, không R2.
// (Invoice Hub S10 — phân phối chỉ-đọc, OD-12 mặc định an toàn. Cờ theo cơ sở `hoaDon.hubPhanPhoi` do LOADER hỏi, không phải hàm này.)
//
// Mặc định an toàn (owner chưa trả lời OD-12 — đổi ở ĐÂY một chỗ, không rải):
//   · PHỤ HUYNH chỉ thấy bản `DA_XAC_NHAN` có tệp PDF và KHÔNG phải bản mô phỏng (`MISA_GIA_LAP`); chỉ tải PDF, không bao giờ XML.
//   · SALE xem được bản `DA_XAC_NHAN` và `THAY_THE` (kèm nhãn «đã thay thế», không có nút tải); chỉ tải PDF; KHÔNG «gửi lại email».
//   · Hoá đơn nháp / đang phát hành / lỗi phát hành / «không xuất» KHÔNG vào danh sách này — chúng là việc của kế toán.
//
// ⚠️ View-model dưới đây CỐ Ý không có: khoá lưu trữ (`tepPdfKey`), hash tệp, mã tra cứu, MST/địa chỉ/email người mua, MST pháp nhân,
// `studentId`, tên học viên, văn bản lỗi nhà cung cấp. Thêm trường vào đây là thêm thứ rò ra trình duyệt — lưới `[PPH-W*]` đếm.

export const TRANG_THAI_DA_PHAT_HANH = "DA_XAC_NHAN" as const;
export const TRANG_THAI_DA_THAY_THE = "THAY_THE" as const;
/** Bản do cổng GIA_LAP sinh — không có giá trị pháp lý, KHÔNG bao giờ tới tay khách và cũng không có nút tải cho Sale. */
export const NGUON_MO_PHONG = "MISA_GIA_LAP" as const;

/** Một hoá đơn như loader đọc ra. `coTepPdf` là CÓ/KHÔNG — khoá tệp không đi vào đây. */
export type HoaDonPhanPhoiVao = {
  id: string;
  trangThai: string;
  nguonPhatHanh: string;
  kyHieu: string | null;
  soHoaDon: string | null;
  /** Cột `@db.Date` — nửa đêm UTC của ngày phát hành. */
  ngayPhatHanh: Date | null;
  tongTien: number;
  coTepPdf: boolean;
};

/** Đường tải PDF — MỘT route cho cả Sale lẫn phụ huynh; mọi quyết định ai-được-tải nằm ở route, không ở chuỗi này. */
export function duongTaiPdf(hoaDonId: string): string {
  return `/api/hoa-don/${encodeURIComponent(hoaDonId)}/tai-pdf`;
}

/**
 * Bản này TẢI ĐƯỢC PDF (cho bất kỳ vai nào dùng route phân phối) không: đã phát hành, có tệp, không phải bản mô phỏng.
 * MỘT vị từ cho nút, danh sách và route (luật 12 — nút hiện ra mà route trả 404 là lời hứa suông).
 */
export function choPhepTaiPdf(hd: Pick<HoaDonPhanPhoiVao, "trangThai" | "nguonPhatHanh" | "coTepPdf">): boolean {
  return hd.trangThai === TRANG_THAI_DA_PHAT_HANH && hd.nguonPhatHanh !== NGUON_MO_PHONG && hd.coTepPdf;
}

/** Sale có THẤY dòng này không (đã phát hành hoặc đã thay thế). */
export function hienChoSale(hd: Pick<HoaDonPhanPhoiVao, "trangThai">): boolean {
  return hd.trangThai === TRANG_THAI_DA_PHAT_HANH || hd.trangThai === TRANG_THAI_DA_THAY_THE;
}

/** Phụ huynh có THẤY dòng này không — đúng bằng điều kiện tải được (không có dòng "thấy mà không tải được"). */
export function hienChoPhuHuynh(hd: Pick<HoaDonPhanPhoiVao, "trangThai" | "nguonPhatHanh" | "coTepPdf">): boolean {
  return choPhepTaiPdf(hd);
}

const ddmmyyyy = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

/** Tên tệp tải về: chỉ chữ-số-gạch từ ký hiệu + số hoá đơn (kế toán gõ tay), KHÔNG mang tên học viên / khách. */
export function tenTepAnToan(kyHieu: string | null, soHoaDon: string | null): string {
  const sach = (s: string | null) => (s ?? "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const ky = sach(kyHieu);
  const so = sach(soHoaDon);
  return ky && so ? `hoa-don-${ky}-${so}.pdf` : "hoa-don.pdf";
}

// ── SALE ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ToneSale = "success" | "muted" | "warning";

export type DongHoaDonSale = {
  id: string;
  kyHieu: string | null;
  soHoaDon: string | null;
  ngayLabel: string | null;
  soTien: number;
  nhan: string;
  tone: ToneSale;
  daThayThe: boolean;
  /** href route tải — `null` ⇒ KHÔNG vẽ nút (route sẽ từ chối). */
  taiPdf: string | null;
  /** Vì sao dòng này không có nút tải (luật 12: nói lý do, đừng để trống). */
  lyDoKhongTai: string | null;
};

export function hienThiChoSale(
  rows: readonly HoaDonPhanPhoiVao[],
  opts: {
    /** `orders:view-pii` — PDF mang tên, MST, địa chỉ người mua; không có quyền này thì xem được dòng nhưng không tải. */
    duocTaiPdf: boolean;
    /** Kho tệp hoá đơn đã cấu hình — không có thì route trả 503. */
    khoOk: boolean;
  },
): DongHoaDonSale[] {
  const ra: DongHoaDonSale[] = [];
  for (const hd of rows) {
    if (!hienChoSale(hd)) continue;
    const daThayThe = hd.trangThai === TRANG_THAI_DA_THAY_THE;
    const moPhong = hd.nguonPhatHanh === NGUON_MO_PHONG;
    const tai = choPhepTaiPdf(hd) && opts.duocTaiPdf && opts.khoOk;
    const lyDoKhongTai = tai
      ? null
      : daThayThe
        ? "Hoá đơn này đã được thay bằng bản khác — đừng gửi bản này cho khách."
        : moPhong
          ? "Bản mô phỏng, không có giá trị pháp lý — đừng gửi khách."
          : !hd.coTepPdf
            ? "Hoá đơn chưa có tệp PDF — báo kế toán."
            : !opts.khoOk
              ? "Kho lưu hoá đơn chưa cấu hình — báo người vận hành."
              : "Cần quyền xem thông tin khách để tải hoá đơn — nhờ kế toán gửi.";
    ra.push({
      id: hd.id,
      kyHieu: hd.kyHieu,
      soHoaDon: hd.soHoaDon,
      ngayLabel: hd.ngayPhatHanh ? ddmmyyyy(hd.ngayPhatHanh) : null,
      soTien: hd.tongTien,
      nhan: daThayThe ? "Đã thay thế" : moPhong ? "Bản mô phỏng" : "Đã phát hành",
      tone: daThayThe ? "muted" : moPhong ? "warning" : "success",
      daThayThe,
      taiPdf: tai ? duongTaiPdf(hd.id) : null,
      lyDoKhongTai,
    });
  }
  return ra;
}

// ── PHỤ HUYNH ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type DongHoaDonPhuHuynh = {
  id: string;
  /** "Hoá đơn số 123" — không mang tên con. */
  tieuDe: string;
  kyHieu: string | null;
  ngayLabel: string | null;
  soTien: number;
  taiPdf: string;
};

export function hienThiChoPhuHuynh(rows: readonly HoaDonPhanPhoiVao[], opts: { khoOk: boolean }): DongHoaDonPhuHuynh[] {
  // Kho chưa cấu hình ⇒ route trả 503 ⇒ không liệt kê (phụ huynh không có ai để "báo người vận hành").
  if (!opts.khoOk) return [];
  return rows
    .filter(hienChoPhuHuynh)
    .map((hd) => ({
      id: hd.id,
      tieuDe: hd.soHoaDon ? `Hoá đơn số ${hd.soHoaDon}` : "Hoá đơn điện tử",
      kyHieu: hd.kyHieu,
      ngayLabel: hd.ngayPhatHanh ? ddmmyyyy(hd.ngayPhatHanh) : null,
      soTien: hd.tongTien,
      taiPdf: duongTaiPdf(hd.id),
    }));
}

// ── SỞ HỮU: hoá đơn này của CON nào ───────────────────────────────────────────────────────────────────────────────

/**
 * Hoá đơn có thuộc phụ huynh này không (và, khi có `conDangChon`, có nằm dưới con đang xem không). THUẦN.
 *
 * Nguồn nối hoá đơn → con, theo thứ tự tin cậy:
 *   1. `conTheoKhoan` — con của CÁC KHOẢN THU nằm trong hoá đơn (`HoaDonKhoan.hieuLuc` → `Payment` → ghi danh / dòng hàng). Cùng đường với phiếu thu phụ huynh đang thấy
 *      ở mục Học phí (`getParentConfirmedPayments`: Payment → Enrollment → Student) nên hoá đơn và biên lai dưới cùng một con khớp nhau (luật 12b).
 *   2. `conTheoDon` — con ghi trên ĐƠN (`Order.studentId` + `OrderItem.studentId`); chỉ dùng khi không khoản nào gắn con (nhiều đơn cũ chưa gắn ghi danh).
 *
 * FAIL-CLOSED:
 *   · không nối được con nào ⇒ ẩn;
 *   · có BẤT KỲ con nào không thuộc phụ huynh này ⇒ ẩn (đơn chở con của người khác thì không phải hoá đơn của riêng ai ở đây — để kế toán gửi tay).
 */
export function hoaDonThuocPhuHuynh(input: {
  conTheoKhoan: readonly (string | null | undefined)[];
  conTheoDon: readonly (string | null | undefined)[];
  /** Mọi con (chưa xoá) của phụ huynh. */
  conCuaPhuHuynh: readonly string[];
  /** Con đang xem; bỏ trống ⇒ chỉ cần thuộc phụ huynh (dùng cho route tải). */
  conDangChon?: string | null;
}): boolean {
  const lay = (a: readonly (string | null | undefined)[]) => new Set(a.filter((x): x is string => typeof x === "string" && x.length > 0));
  const theoKhoan = lay(input.conTheoKhoan);
  const lienKet = theoKhoan.size > 0 ? theoKhoan : lay(input.conTheoDon);
  if (lienKet.size === 0) return false;
  const cua = new Set(input.conCuaPhuHuynh);
  for (const c of lienKet) if (!cua.has(c)) return false;
  if (input.conDangChon === undefined || input.conDangChon === null) return true;
  return lienKet.has(input.conDangChon);
}
