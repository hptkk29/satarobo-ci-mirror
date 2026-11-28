// lib/cham-cong/xuat-bang.ts — dựng workbook cho module chấm công.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO `exceljs` CHỨ KHÔNG PHẢI `xlsx`
//
// Chủ dự án chốt 25/09/2026: *"thiết kế file Excel dễ hiểu hơn dành cho quản lý, chia ra
// từng ngày, KẺ BẢNG vào cho dễ nhận biết, chia ra từng nhân viên"*.
//
// Đo trước khi quyết: `xlsx@0.18.5` là bản **cộng đồng** của SheetJS — ghi viền/nền/in đậm
// KHÔNG có tác dụng. Thử ghi `border` + `fill` rồi đọc lại: style bị vứt sạch, chỉ còn
// `patternType: "none"`. Định dạng ô là tính năng bản trả phí. Nên "kẻ bảng" là bất khả thi
// với thư viện cũ, không phải chuyện viết thêm mấy dòng.
//
// `exceljs` được chủ dự án duyệt thêm cùng ngày (repo có luật không tự thêm dependency).
// Route xuất bảng công KỲ (`lib/cham-cong/export-xlsx.ts`) vẫn dùng `xlsx` — không đụng tới,
// nó là đường khác và đang chạy tốt.
//
// THUẦN: không DB, không `next/*`, không đọc đồng hồ. Test được không cần dựng server.
import ExcelJS from "exceljs";

export type CotXuat<T> = {
  /** Đúng nhãn cột đang hiện trên màn — lệch là người đối chiếu phải đoán. */
  nhan: string;
  lay: (r: T) => string | number | null | undefined;
  /** Độ rộng cột (ký tự). Mặc định suy từ độ dài nhãn. */
  rong?: number;
  /**
   * Ép ô thành định dạng TEXT. Bắt buộc cho mã nhân viên, số điện thoại, mã ca dạng số
   * ("12", "21") — Excel nuốt số 0 đầu và biến "12" thành số, làm hỏng đúng những cột dùng
   * để đối chiếu.
   */
  chuoi?: boolean;
};

/** Một sheet BẢNG PHẲNG phụ — mỗi dòng một bản ghi (vd nhật ký lượt quét). */
export type BangPhuXuat = {
  ten: string;
  cot: string[];
  dong: (string | number)[][];
  /** Độ rộng riêng cho cột nào cần; cột không khai lấy mặc định 11. */
  rong?: Record<string, number>;
};

/** Một sheet lưới người × ngày (hoặc bất kỳ ma trận nào). */
export type LuoiXuat = {
  ten: string;
  /** Ô trên cùng bên trái, vd "Nhân sự". */
  gocTraiTren: string;
  cotNgay: string[];
  dong: { nhan: string; o: (string | number)[] }[];
};

/**
 * Một KHỐI của sheet "chi tiết theo người": tiêu đề người + bảng từng ngày.
 *
 * Đây là thứ chủ dự án gọi là "chia ra từng nhân viên, chia ra từng ngày": cuộn một mạch,
 * mỗi người một khối có tên + tổng ở trên, rồi bảng ngày kẻ viền bên dưới.
 */
export type KhoiNguoi = {
  /** "NGUYỄN VĂN A · Tư vấn viên · CS1" */
  tieuDe: string;
  /** "Tổng 21,5 công · 157h20 · 2 đi muộn" — dòng tóm tắt dưới tên. */
  tomTat: string;
  cot: string[];
  dong: {
    o: (string | number)[];
    /** Tô nền dòng theo trạng thái — mã ARGB; bỏ trống thì không tô. */
    nen?: string;
  }[];
};

const MAX_TEN_SHEET = 31; // giới hạn cứng của Excel

/** Excel từ chối tên sheet > 31 ký tự hoặc chứa : \ / ? * [ ] — cắt và thay, đừng để nó ném. */
function tenSheetHopLe(s: string): string {
  return s.replace(/[:\\/?*[\]]/g, "-").slice(0, MAX_TEN_SHEET) || "Sheet1";
}

const VIEN = { style: "thin" as const, color: { argb: "FFD0D0D0" } };
const NEN_HEADER = "FFEFEFEF";

function keVien(row: ExcelJS.Row, soCot: number, nen?: string) {
  for (let c = 1; c <= soCot; c++) {
    const cell = row.getCell(c);
    cell.border = { top: VIEN, left: VIEN, bottom: VIEN, right: VIEN };
    if (nen) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: nen } };
  }
}

function dongHeader(ws: ExcelJS.Worksheet, cot: string[]): ExcelJS.Row {
  const r = ws.addRow(cot);
  r.font = { bold: true, size: 10 };
  keVien(r, cot.length, NEN_HEADER);
  return r;
}

/**
 * Workbook chuẩn của module: sheet dữ liệu + (tuỳ chọn) chi tiết theo người / lưới / bảng
 * phụ / chú giải, và LUÔN có sheet `_watermark`.
 *
 * `_watermark` KHÔNG phải trang trí: export dữ liệu nhân sự phải truy được ai lấy, lúc nào,
 * bao nhiêu dòng (Doc 15 — "export nhạy cảm có watermark + audit lại"). Đặt ở sheet riêng để
 * người mở file không xoá nhầm khi dán sang bảng khác.
 */
export function dungWorkbook<T>(input: {
  tieuDe: string;
  cot: CotXuat<T>[];
  dong: readonly T[];
  watermark: string;
  /** Dòng ghi chú in dưới bảng — vd "Bản tạm, số có thể đổi tới khi chốt kỳ." */
  ghiChu?: string[];
  tenSheet?: string;
  luoi?: LuoiXuat[];
  bangPhu?: BangPhuXuat[];
  /** Sheet "chi tiết theo người" — mỗi người một khối, mỗi ngày một dòng. */
  khoiNguoi?: { ten: string; rong?: Record<string, number>; khoi: KhoiNguoi[] };
  /** Cặp [nhãn, giải thích] cho sheet "Chu giai" — để file rời khỏi hệ thống vẫn tự giải thích. */
  chuGiai?: [string, string][];
}): ExcelJS.Workbook {
  const {
    tieuDe,
    cot,
    dong,
    watermark,
    ghiChu = [],
    luoi = [],
    bangPhu = [],
    chuGiai = [],
  } = input;

  const wb = new ExcelJS.Workbook();
  // Mốc thời gian TẤT ĐỊNH: hai lần xuất cùng dữ liệu phải ra cùng tệp, để còn so được.
  wb.created = new Date(0);
  wb.modified = new Date(0);

  // ── Sheet dữ liệu ──────────────────────────────────────────────────────────
  const ws = wb.addWorksheet(tenSheetHopLe(input.tenSheet ?? "Du lieu"));
  ws.addRow([tieuDe]).font = { bold: true, size: 13 };
  ws.addRow([]);
  dongHeader(
    ws,
    cot.map((c) => c.nhan),
  );
  for (const r of dong) {
    const row = ws.addRow(cot.map((c) => c.lay(r) ?? ""));
    keVien(row, cot.length);
    cot.forEach((c, i) => {
      // `numFmt = "@"` (Text) mới là thứ Excel đọc để không tự đổi "0123" thành 123 — kiểu ô
      // thôi thì chưa đủ. Phát hiện bằng lượt cấy lỗi 25/09: ca test kiểm kiểu ô vẫn XANH khi
      // đã gỡ hẳn phần ép định dạng.
      if (c.chuoi) row.getCell(i + 1).numFmt = "@";
    });
  }
  ws.columns = cot.map((c) => ({
    width: c.rong ?? Math.max(10, Math.min(28, c.nhan.length + 2)),
  }));
  ws.views = [{ state: "frozen", ySplit: 3 }];
  if (dong.length > 0) {
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cot.length } };
  }
  ws.addRow([]);
  for (const g of ghiChu) ws.addRow([g]);

  // ── Chi tiết theo người — mỗi người một khối, mỗi ngày một dòng ─────────────
  if (input.khoiNguoi && input.khoiNguoi.khoi.length > 0) {
    const { ten, khoi, rong = {} } = input.khoiNguoi;
    const wsN = wb.addWorksheet(tenSheetHopLe(ten));
    const soCot = Math.max(...khoi.map((k) => k.cot.length));
    for (const k of khoi) {
      const r1 = wsN.addRow([k.tieuDe]);
      r1.font = { bold: true, size: 12 };
      wsN.mergeCells(r1.number, 1, r1.number, soCot);
      const r2 = wsN.addRow([k.tomTat]);
      r2.font = { italic: true, size: 10, color: { argb: "FF555555" } };
      wsN.mergeCells(r2.number, 1, r2.number, soCot);

      dongHeader(wsN, k.cot);
      for (const d of k.dong) keVien(wsN.addRow(d.o), k.cot.length, d.nen);
      wsN.addRow([]); // dòng trống ngăn cách hai người
    }
    wsN.columns = khoi[0].cot.map((h) => ({ width: rong[h] ?? 12 }));
  }

  // ── Lưới người × ngày ──────────────────────────────────────────────────────
  for (const l of luoi) {
    const wsL = wb.addWorksheet(tenSheetHopLe(l.ten));
    dongHeader(wsL, [l.gocTraiTren, ...l.cotNgay]);
    for (const d of l.dong) keVien(wsL.addRow([d.nhan, ...d.o]), l.cotNgay.length + 1);
    wsL.columns = [{ width: 30 }, ...l.cotNgay.map(() => ({ width: 5 }))];
    wsL.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  }

  // ── Bảng phẳng phụ ─────────────────────────────────────────────────────────
  for (const b of bangPhu) {
    const ws2 = wb.addWorksheet(tenSheetHopLe(b.ten));
    dongHeader(ws2, b.cot);
    for (const d of b.dong) keVien(ws2.addRow(d), b.cot.length);
    ws2.columns = b.cot.map((h) => ({ width: b.rong?.[h] ?? 11 }));
    ws2.views = [{ state: "frozen", ySplit: 1 }];
    if (b.dong.length > 0) {
      ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: b.cot.length } };
    }
  }

  // ── Chú giải ───────────────────────────────────────────────────────────────
  if (chuGiai.length > 0) {
    const wsC = wb.addWorksheet("Chu giai");
    dongHeader(wsC, ["Ký hiệu", "Nghĩa"]);
    for (const [k, v] of chuGiai) keVien(wsC.addRow([k, v]), 2);
    wsC.columns = [{ width: 28 }, { width: 92 }];
  }

  const wsW = wb.addWorksheet("_watermark");
  wsW.addRow([watermark]);
  for (const g of ghiChu) wsW.addRow([g]);
  wsW.columns = [{ width: 110 }];

  return wb;
}

/** Tên tệp an toàn: bỏ dấu tiếng Việt và ký tự trình duyệt/OS từ chối. */
export function tenTepAnToan(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
