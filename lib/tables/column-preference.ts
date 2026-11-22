// lib/tables/column-preference.ts — G-04: lõi THUẦN của "tuỳ chọn cột kiểu MISA".
//
// Chỉ hai việc, không dính DB, không dính React:
//   · ghép cấu hình đã lưu của MỘT người với danh mục cột của tầng mã (đọc);
//   · nắn danh sách người dùng gửi lên về đúng tập khoá hợp lệ (ghi).
//
// Vì sao bản ghi cần CẢ `visible` lẫn `hidden` chứ không chỉ `visible`: chỉ có
// `visible` thì không phân biệt được "đã tắt có chủ ý" với "chưa từng biết đến".
// Hệ quả nếu gộp làm một: mọi cột thêm vào hệ thống sau này sẽ KHÔNG BAO GIỜ hiện
// ra với người đã lưu cấu hình — họ phải tự mò vào bật, mà không ai nói cho họ biết
// là có cột mới. Hỏng câm.

/** Một cột trong danh mục. Danh mục là HẰNG SỐ TẦNG MÃ, không phải bảng DB:
 *  cột chỉ tồn tại khi có mã vẽ nó, để trong DB thì admin thêm được dòng "cột X"
 *  mà không có cột X nào để hiện. */
export type TableColumnDef = {
  /** Mã định danh CỦA DANH MỤC (không phải tên cột DB) — đổi tên cột DB không
   *  làm hỏng cấu hình người dùng đã lưu. Dấu chấm để phân tầng: `child.*`. */
  key: string;
  label: string;
  /** Nhóm hiển thị trong màn chọn cột (Phụ huynh / Học sinh / …). */
  group: string;
  defaultVisible: boolean;
  /** Thứ tự khi CHƯA có cấu hình, và vị trí chèn khi cột này mới được thêm vào. */
  defaultOrder: number;
  /** true ⇒ giá trị vẫn đi qua che PII ở tầng đọc. Cờ này KHÔNG tự che gì cả —
   *  nó chỉ đánh dấu, việc che nằm ở `lib/lead/pii.ts` (xem lead-columns.test.ts). */
  pii?: boolean;
};

export type ColumnLayout = {
  visible: TableColumnDef[];
  hidden: TableColumnDef[];
};

/** Hình dạng JSON lưu trong `UserTablePreference.columns`. */
export type StoredColumns = {
  v: number;
  visible: string[];
  hidden: string[];
};

/** Phiên bản hình dạng JSON. Bản ghi thiếu `v` hoặc `v` lạ ⇒ coi như CHƯA có cấu
 *  hình (dùng mặc định), để đổi hình dạng sau này không phải migrate JSON. */
export const COLUMNS_SHAPE_VERSION = 1;

const theoThuTuMacDinh = (a: TableColumnDef, b: TableColumnDef) =>
  a.defaultOrder - b.defaultOrder;

export function defaultColumnLayout(catalog: readonly TableColumnDef[]): ColumnLayout {
  const xep = [...catalog].sort(theoThuTuMacDinh);
  return {
    visible: xep.filter((c) => c.defaultVisible),
    hidden: xep.filter((c) => !c.defaultVisible),
  };
}

/** Đọc JSON đã lưu. Trả null cho MỌI ca không đọc được — một dòng JSON hỏng không
 *  được phép làm chết trang danh sách lead. */
function readStoredColumns(raw: unknown): StoredColumns | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;

  const obj = value as Record<string, unknown>;
  if (obj.v !== COLUMNS_SHAPE_VERSION) return null;
  if (!Array.isArray(obj.visible)) return null;
  if (!obj.visible.every((k) => typeof k === "string")) return null;

  const hidden = Array.isArray(obj.hidden)
    ? obj.hidden.filter((k): k is string => typeof k === "string")
    : [];
  return { v: COLUMNS_SHAPE_VERSION, visible: obj.visible as string[], hidden };
}

/**
 * Ghép cấu hình đã lưu với danh mục hiện tại.
 *
 * Quy tắc cấu hình mồ côi (PRD G §7.5), áp ở TẦNG RENDER chứ không ở tầng DB:
 *  · khoá không có trong danh mục → bỏ qua IM LẶNG, giữ nguyên trong DB (cột có thể
 *    đang tạm ẩn sau một cờ tính năng; xoá ngay là mất cấu hình khi cờ bật lại);
 *  · cột có trong danh mục nhưng không ở cả hai mảng → cột MỚI: chèn theo
 *    `defaultVisible`, đúng chỗ theo `defaultOrder` (nối vào cuối thì cột mới rơi
 *    tuốt bên phải màn hình và coi như không có);
 *  · lọc xong còn 0 cột → dùng nguyên bộ mặc định.
 */
export function resolveColumnLayout(
  catalog: readonly TableColumnDef[],
  raw: unknown,
): ColumnLayout {
  const stored = readStoredColumns(raw);
  if (!stored) return defaultColumnLayout(catalog);

  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const daXep = new Set<string>();
  const visible: TableColumnDef[] = [];

  for (const key of stored.visible) {
    const def = byKey.get(key);
    if (!def || daXep.has(key)) continue;
    daXep.add(key);
    visible.push(def);
  }

  const tatCoChuY = new Set(stored.hidden.filter((k) => byKey.has(k)));
  const cotMoi = catalog
    .filter((c) => !daXep.has(c.key) && !tatCoChuY.has(c.key))
    .sort(theoThuTuMacDinh);

  for (const def of cotMoi) {
    if (!def.defaultVisible) continue;
    const at = visible.findIndex((c) => c.defaultOrder > def.defaultOrder);
    if (at === -1) visible.push(def);
    else visible.splice(at, 0, def);
    daXep.add(def.key);
  }

  if (visible.length === 0) return defaultColumnLayout(catalog);

  return {
    visible,
    hidden: catalog.filter((c) => !daXep.has(c.key)).sort(theoThuTuMacDinh),
  };
}

/**
 * Nắn danh sách cột người dùng gửi lên thành bản ghi để lưu.
 *
 * Lưu là dịp TỰ DỌN: khoá lạc bị loại khỏi bản ghi mới, và `hidden` được điền đủ
 * phần danh mục còn lại — nhờ vậy không cần cron dọn rác, và cột thêm vào SAU lần
 * lưu này vẫn được nhận diện là "chưa biết" (không nằm ở cả hai mảng).
 */
export function normalizeColumnsForSave(
  catalog: readonly TableColumnDef[],
  visibleKeys: readonly string[],
): StoredColumns {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const daXep = new Set<string>();
  const visible: string[] = [];

  for (const key of visibleKeys) {
    if (!byKey.has(key) || daXep.has(key)) continue;
    daXep.add(key);
    visible.push(key);
  }

  return {
    v: COLUMNS_SHAPE_VERSION,
    visible,
    hidden: catalog.filter((c) => !daXep.has(c.key)).map((c) => c.key),
  };
}
