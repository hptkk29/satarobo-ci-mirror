// lib/cham-cong/mau-import-phan-ca.ts — dựng FILE MẪU cho màn "Import lịch phân ca".
//
// Vì sao file mẫu KHÔNG được để trống: lúc áp, ô trống KHÔNG phải "bỏ qua".
//   · Tab KHUNG CA CỐ ĐỊNH — ô trống ⇒ XOÁ khung ca của người đó ở thứ đó (`import-core.ts`,
//     nhánh `!code` → `shiftWeeklyPattern.deleteMany`).
//   · Tab LỊCH Tmm-yyyy — ô trống của người ĐÃ ÁNH XẠ ⇒ huỷ ca đang có ở ngày đó (lệnh XOA);
//     chỉ ca do đơn đã duyệt / sửa tay được giữ.
// Một mẫu rỗng nộp nguyên xi sẽ xoá sạch lịch tháng của cả cơ sở. Nên mẫu được đổ sẵn lịch
// ĐANG CÓ trên hệ thống: nộp lại không sửa gì ⇒ 0 ô mới, 0 ô huỷ; người xếp chỉ đổi ô cần đổi.
//
// Người có ca CHỊU CÔNG Ở KHỐI KHÁC (kiêm nhiệm — trên Sheet gốc là hai dòng, một con trỏ
// D1/D2) KHÔNG đưa vào file: một dòng đơn lẻ ở khối này sẽ làm lệch cách gộp ô con trỏ
// (`mergePointerCells`). Không có trong file ⇒ import không đụng tới họ; tên họ được nêu ở tab
// HƯỚNG DẪN để người xếp biết sửa họ trên lưới.
//
// Bố cục tab bám đúng `lib/cham-cong/sheet-parse.ts` — test `[MIP-*]` đọc ngược file này bằng
// chính `parseWorkbook`, nên lệch bố cục là đỏ.
//
// THUẦN: không DB, không `next/*`, không đọc đồng hồ.
import ExcelJS from "exceljs";

export type NguoiMau = {
  /** Tên hiển thị trên Sheet — cũng là khoá ánh xạ ở bước 2 của màn import. */
  ten: string;
  /** Họ tên đầy đủ (cột C của tab khung ca). */
  hoTen: string;
  vaiTro: string;
  sdt: string | null;
  /** 0 = CN … 6 = T7 → mã ca hiện hành (null = chưa có khung). */
  khung: Record<number, string | null>;
  /** ngày trong tháng → mã ca hiện hành (null = chưa xếp). */
  o: Record<number, string | null>;
};

// Cố ý KHÔNG có "công" và "lần chấm/ngày": đó là cấu hình của hệ thống (sửa ở màn Danh mục ca), file mẫu
// mà mang cả hai thì người xếp sửa trong file sẽ tưởng import đổi được chúng — import không đọc tab này.
export type MaCaMau = { code: string; name: string; gio: string };

export type DauVaoMau = {
  /** "YYYY-MM" */
  ky: string;
  /** "CS1" | "CS2" | "HO" */
  donVi: "CS1" | "CS2" | "HO";
  /** Nhãn khối cho người đọc: "CS2 · Cơ sở Hoàng Diệu". */
  nhanKhoi: string;
  nguoi: NguoiMau[];
  /** Người bị loại vì có ca chịu công ở khối khác. */
  nguoiKiemNhiem: string[];
  maCa: MaCaMau[];
};

const TEN_THU: [number, string][] = [
  [1, "T2"],
  [2, "T3"],
  [3, "T4"],
  [4, "T5"],
  [5, "T6"],
  [6, "T7"],
  [0, "CN"],
];

const NHAN_DON_VI: Record<DauVaoMau["donVi"], string> = { CS1: "Cơ sở 1", CS2: "Cơ sở 2", HO: "HO" };

const VIEN = { style: "thin" as const, color: { argb: "FFD0D0D0" } };
const NEN_TIEU_DE = "FFEFEFEF";
const NEN_NHAP = "FFFFF8E1";

function keVien(row: ExcelJS.Row, soCot: number, nen?: string) {
  for (let c = 1; c <= soCot; c++) {
    const cell = row.getCell(c);
    cell.border = { top: VIEN, left: VIEN, bottom: VIEN, right: VIEN };
    if (nen) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: nen } };
  }
}

/** Cột Excel (1-based) → chữ cái: 1→A, 27→AA. */
function cotChu(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const TEN_TAB_MA_CA = "DANH MỤC CA";

/** Ô nhập mã ca: ép TEXT (mã "12" không bị nuốt thành số) + danh sách thả xuống theo tab mã ca. */
function oMaCa(cell: ExcelJS.Cell, ma: string | null, soMaCa: number) {
  cell.value = ma ?? null;
  cell.numFmt = "@";
  cell.alignment = { horizontal: "center" };
  if (soMaCa > 0) {
    cell.dataValidation = {
      type: "list",
      allowBlank: true,
      // Tham chiếu sang tab mã ca — chuỗi liệt kê thẳng bị Excel cắt ở 255 ký tự.
      formulae: [`'${TEN_TAB_MA_CA}'!$A$2:$A$${soMaCa + 1}`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Mã ca lạ",
      error: "Mã này không có trong tab DANH MỤC CA — các ô mang mã lạ sẽ bị bỏ qua khi import.",
    };
  }
}

export function dungFileMauImport(v: DauVaoMau): ExcelJS.Workbook {
  const [nam, thang] = v.ky.split("-").map(Number);
  const soNgay = new Date(Date.UTC(nam, thang, 0)).getUTCDate();
  const wb = new ExcelJS.Workbook();
  const soMaCa = v.maCa.length;

  // ── HƯỚNG DẪN ─────────────────────────────────────────────────────────────
  const hd = wb.addWorksheet("HƯỚNG DẪN");
  hd.columns = [{ width: 4 }, { width: 120 }];
  const dongHd = (stt: string, chu: string, dam = false) => {
    const r = hd.addRow([stt, chu]);
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    r.getCell(1).alignment = { vertical: "top" };
    if (dam) r.font = { bold: true };
    return r;
  };
  dongHd("", `FILE MẪU IMPORT LỊCH PHÂN CA — ${v.nhanKhoi} — tháng ${String(thang).padStart(2, "0")}/${nam}`, true).font = {
    bold: true,
    size: 13,
  };
  dongHd("", "File này đã được điền sẵn lịch ĐANG CÓ trên hệ thống. Bạn chỉ sửa những ô cần đổi rồi import lại.");
  hd.addRow([]);
  dongHd("", "CÁCH NHẬP", true);
  dongHd("1.", "Tab LỊCH: mỗi hàng là một người, mỗi cột là một ngày trong tháng. Gõ MÃ CA vào ô (CG, CS, HC…). Danh sách mã hợp lệ ở tab DANH MỤC CA — bấm vào ô sẽ có mũi tên chọn mã.");
  dongHd("2.", "Tab KHUNG CA CỐ ĐỊNH: ca lặp lại hằng tuần của từng người (T2…CN). Chỉ sửa khi muốn đổi khung tuần; không đổi khung thì để nguyên và BỎ TICK “Khung ca cố định” ở bước 2 khi import.");
  dongHd("3.", "Ngày nghỉ: nhập mã X (nghỉ) hoặc P (phép) — đúng như quy ước trên Sheet. Không dùng chữ khác (“nghỉ”, “off”…), mã lạ sẽ bị bỏ qua.");
  dongHd("4.", "Thêm nhân sự mới: thêm một hàng ở cuối bảng, điền STT (số), Họ và tên, Đơn vị (đúng cơ sở của file này), Vai trò. Tên phải trùng nhân sự trên hệ thống — bước 2 của màn import sẽ gợi ý để bạn xác nhận.");
  dongHd("5.", "KHÔNG đổi tên tab (LỊCH Tmm-yyyy, KHUNG CA CỐ ĐỊNH, DANH MỤC CA), KHÔNG xoá hàng tiêu đề, KHÔNG chèn cột, KHÔNG gộp ô. Lưu dạng .xlsx.");
  hd.addRow([]);
  dongHd("", "⚠ ĐIỀU DỄ NHẦM NHẤT", true);
  dongHd(
    "•",
    "Ô TRỐNG KHÔNG PHẢI “BỎ QUA”. Ô trống ở tab LỊCH sẽ HUỶ ca hiện có của người đó ở ngày ấy; ô trống ở tab KHUNG CA sẽ XOÁ khung ca ở thứ ấy. Vì vậy đừng xoá hàng/ô rồi import — muốn giữ nguyên thì để nguyên mã. Ca do đơn đã duyệt hoặc do quản lý sửa tay trên lưới thì luôn được giữ, file không đè.",
  );
  dongHd("•", "Muốn người nào KHÔNG bị import đụng tới: xoá cả HÀNG của người đó khỏi file (không có trong file ⇒ không bị đụng).");
  dongHd("•", "Chạy lại cùng một file là an toàn (idempotent): hệ thống chỉ ghi phần khác nhau.");
  hd.addRow([]);
  dongHd("", "CÁC BƯỚC TRÊN HỆ THỐNG", true);
  dongHd("a.", "Mở Chấm công → Phân ca → Import (đúng cơ sở của file). Chọn file, bấm “Đọc file”.");
  dongHd("b.", "Bước 2: xác nhận tên trong file ↔ nhân sự trên hệ thống (tên trùng thì tự khớp). Chọn kỳ cần áp.");
  dongHd("c.", "Bấm “Áp vào hệ thống”. Bước 3 hiện bảng đối chiếu số ô theo từng mã — “khớp toàn bộ” là đúng như file.");
  if (v.nguoiKiemNhiem.length > 0) {
    hd.addRow([]);
    dongHd("", "KHÔNG CÓ TRONG FILE NÀY (có ca chịu công ở cơ sở khác — sửa trực tiếp trên lưới phân ca):", true);
    dongHd("", v.nguoiKiemNhiem.join(", "));
  }

  // ── KHUNG CA CỐ ĐỊNH ──────────────────────────────────────────────────────
  const kc = wb.addWorksheet("KHUNG CA CỐ ĐỊNH");
  kc.addRow([`KHUNG CA CỐ ĐỊNH — ${v.nhanKhoi}`]).font = { bold: true, size: 12 };
  kc.addRow(["Ca lặp lại hằng tuần. Ô trống = xoá khung ca ở thứ đó (xem tab HƯỚNG DẪN)."]);
  const tdKc = ["STT", "Tên hiển thị", "Họ và tên đầy đủ", "Đơn vị", "Vai trò", "SĐT", ...TEN_THU.map(([, t]) => t)];
  const hKc = kc.addRow(tdKc);
  hKc.font = { bold: true, size: 10 };
  keVien(hKc, tdKc.length, NEN_TIEU_DE);
  kc.columns = [
    { width: 6 },
    { width: 24 },
    { width: 28 },
    { width: 11 },
    { width: 16 },
    { width: 14 },
    ...TEN_THU.map(() => ({ width: 7 })),
  ];
  v.nguoi.forEach((n, i) => {
    const r = kc.addRow([i + 1, n.ten, n.hoTen, NHAN_DON_VI[v.donVi], n.vaiTro, null, ...TEN_THU.map(() => null)]);
    // SĐT dạng TEXT — Excel nuốt số 0 đầu.
    r.getCell(6).numFmt = "@";
    r.getCell(6).value = n.sdt;
    TEN_THU.forEach(([wd], k) => oMaCa(r.getCell(7 + k), n.khung[wd] ?? null, soMaCa));
    keVien(r, tdKc.length);
    for (let k = 0; k < TEN_THU.length; k++) {
      r.getCell(7 + k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEN_NHAP } };
    }
  });
  kc.views = [{ state: "frozen", xSplit: 3, ySplit: 3 }];

  // ── LỊCH Tmm-yyyy ─────────────────────────────────────────────────────────
  const ten = `LỊCH T${String(thang).padStart(2, "0")}-${nam}`;
  const lich = wb.addWorksheet(ten);
  lich.addRow([`LỊCH PHÂN CA THÁNG ${String(thang).padStart(2, "0")}/${nam} — ${v.nhanKhoi}`]).font = { bold: true, size: 12 };
  lich.addRow(["Tháng:", thang, "Năm:", nam]);
  const ngayCot = Array.from({ length: soNgay }, (_, i) => i + 1);
  const tdLich = ["STT", "Họ và tên", "Đơn vị", "Vai trò", ...ngayCot, "Tổng công", "Nghỉ/Phép"];
  const hLich = lich.addRow(tdLich);
  hLich.font = { bold: true, size: 10 };
  keVien(hLich, tdLich.length, NEN_TIEU_DE);
  hLich.getCell(1).alignment = { horizontal: "center" };
  ngayCot.forEach((d) => {
    const wd = new Date(Date.UTC(nam, thang - 1, d)).getUTCDay();
    const c = hLich.getCell(4 + d);
    c.alignment = { horizontal: "center" };
    // Cuối tuần tô nhạt để mắt dóng được cột — số ngày vẫn là SỐ (parser đọc `Number(header)`).
    if (wd === 0 || wd === 6) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E3E3" } };
  });
  lich.columns = [
    { width: 6 },
    { width: 26 },
    { width: 11 },
    { width: 16 },
    ...ngayCot.map(() => ({ width: 5 })),
    { width: 10 },
    { width: 10 },
  ];
  const cotNgayDau = cotChu(5);
  const cotNgayCuoi = cotChu(4 + soNgay);
  v.nguoi.forEach((n, i) => {
    const r = lich.addRow([i + 1, n.ten, NHAN_DON_VI[v.donVi], n.vaiTro]);
    ngayCot.forEach((d) => oMaCa(r.getCell(4 + d), n.o[d] ?? null, soMaCa));
    const ma = ngayCot.map((d) => n.o[d]).filter((x): x is string => !!x);
    const nghi = ma.filter((c) => c === "X" || c === "P").length;
    const rng = `${cotNgayDau}${r.number}:${cotNgayCuoi}${r.number}`;
    // Công thức để cột tổng tự cập nhật khi người xếp sửa ô; `result` là giá trị lúc xuất.
    r.getCell(5 + soNgay).value = {
      formula: `COUNTA(${rng})-COUNTIF(${rng},"X")-COUNTIF(${rng},"P")`,
      result: ma.length - nghi,
    };
    r.getCell(6 + soNgay).value = { formula: `COUNTIF(${rng},"X")+COUNTIF(${rng},"P")`, result: nghi };
    keVien(r, tdLich.length);
    r.getCell(1).alignment = { horizontal: "center" };
    for (const d of ngayCot) {
      r.getCell(4 + d).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEN_NHAP } };
    }
  });
  lich.views = [{ state: "frozen", xSplit: 4, ySplit: 3 }];

  // ── DANH MỤC CA ───────────────────────────────────────────────────────────
  const dm = wb.addWorksheet(TEN_TAB_MA_CA);
  const tdDm = ["Mã ca", "Tên ca", "Giờ làm việc"];
  const hDm = dm.addRow(tdDm);
  hDm.font = { bold: true, size: 10 };
  keVien(hDm, tdDm.length, NEN_TIEU_DE);
  dm.columns = [{ width: 10 }, { width: 32 }, { width: 28 }];
  for (const m of v.maCa) {
    const r = dm.addRow([m.code, m.name, m.gio || "—"]);
    r.getCell(1).numFmt = "@";
    keVien(r, tdDm.length);
  }

  return wb;
}
