// Hàm THUẦN của khu Tin tức (giao diện public mới, 02/11/2026) — không đụng DB, không React.
// Test: `tin-tuc-thuan.test.ts` ([PUB-C-01..]).

/** Số bài hiện ra mỗi lần ở danh sách (nút "Xem thêm bài viết"). */
export const SO_BAI_MOI_LAN = 9;

/**
 * Một bài ở danh sách. MỌI trường đều là chuỗi/số đã chuẩn bị ở SERVER (ngày đã định dạng,
 * thời gian đọc đã tính) để truyền xuống client không kéo theo `content` và không lệch múi giờ
 * giữa server với trình duyệt (lỗi hydrate).
 */
export interface TinTucItem {
  slug: string;
  title: string;
  excerpt: string;
  coverImage: string | null;
  category: string | null;
  /** `dd/mm/yyyy` theo múi giờ Việt Nam; rỗng khi bài chưa có ngày đăng. */
  ngay: string;
  phutDoc: number;
  noiBat: boolean;
}

export interface ChuyenMuc {
  /** Khoá lọc = đúng chữ chuyên mục lưu trong DB (quản trị nhập tự do, vd "Kiến thức"). */
  key: string;
  label: string;
  soBai: number;
}

/** `dd/mm/yyyy` ở múi giờ Việt Nam — cố định múi để server và trình duyệt không lệch ngày. */
export function dinhDangNgay(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(d);
}

/**
 * Thứ tự chuyên mục của thiết kế (News.dc.html): Sự kiện · Khoá học mới · Ưu đãi · Cuộc thi Robotics · Góc phụ huynh.
 * Chuyên mục của repo trùng nhãn (không phân biệt hoa thường / dấu / "khoá"–"khóa") đứng đầu theo đúng thứ tự này;
 * chuyên mục khác của repo (nhập tự do) đứng sau, nhiều bài trước.
 */
export const THU_TU_CHUYEN_MUC_THIET_KE = ["Sự kiện", "Khoá học mới", "Ưu đãi", "Cuộc thi Robotics", "Góc phụ huynh"] as const;

function khoaSoKhop(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const HANG_THIET_KE = new Map(THU_TU_CHUYEN_MUC_THIET_KE.map((t, i) => [khoaSoKhop(t), i]));

/**
 * Chuyên mục có bài (gộp theo chữ đã `trim`, không phân biệt hoa thường), xếp theo {@link THU_TU_CHUYEN_MUC_THIET_KE}
 * rồi tới chuyên mục khác (nhiều bài trước, hoà thì theo tên). Bài không có chuyên mục không tạo tab — chúng vẫn
 * nằm ở tab "Tất cả".
 */
export function chuyenMucCoBai(items: readonly Pick<TinTucItem, "category">[]): ChuyenMuc[] {
  const dem = new Map<string, ChuyenMuc>();
  for (const it of items) {
    const label = it.category?.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase("vi");
    const cu = dem.get(key);
    if (cu) cu.soBai += 1;
    else dem.set(key, { key, label, soBai: 1 });
  }
  const hang = (c: ChuyenMuc) => HANG_THIET_KE.get(khoaSoKhop(c.label)) ?? Number.POSITIVE_INFINITY;
  return [...dem.values()].sort(
    (a, b) => hang(a) - hang(b) || b.soBai - a.soBai || a.label.localeCompare(b.label, "vi"),
  );
}

/** Lọc theo khoá chuyên mục của {@link chuyenMucCoBai}; `null` = tất cả. */
export function locTheoChuyenMuc<T extends Pick<TinTucItem, "category">>(
  items: readonly T[],
  key: string | null,
): T[] {
  if (key === null) return [...items];
  return items.filter((it) => it.category?.trim().toLocaleLowerCase("vi") === key);
}

/** Phần đang hiện ra sau `soLan` lần bấm "Xem thêm" (lần 1 = 1 trang). */
export function phanDangHien<T>(items: readonly T[], soLan: number): T[] {
  return items.slice(0, Math.max(1, soLan) * SO_BAI_MOI_LAN);
}

/** 3 bài mới nhất cho khối thẻ nổi "MỚI" ở đầu trang (ít hơn 3 thì lấy đủ số có; `items` đã xếp mới → cũ). */
export function baiChoFeed<T>(items: readonly T[]): T[] {
  return items.slice(0, 3);
}

// ---------------------------------------------------------------------------------------------
// Mục lục bài viết
// ---------------------------------------------------------------------------------------------

/** Bỏ dấu tiếng Việt → chữ thường, gạch nối: "Học viên thể hiện ra sao?" → "hoc-vien-the-hien-ra-sao". */
export function taoIdMuc(text: string): string {
  const id = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "muc";
}

/** Bộ cấp id KHÔNG trùng: lần 2 của cùng một tiêu đề thành "…-2", lần 3 "…-3". */
export function boCapIdMuc(): (text: string) => string {
  const daDung = new Map<string, number>();
  return (text) => {
    const goc = taoIdMuc(text);
    const n = (daDung.get(goc) ?? 0) + 1;
    daDung.set(goc, n);
    return n === 1 ? goc : `${goc}-${n}`;
  };
}

export interface MucLuc {
  id: string;
  text: string;
}

/** Bỏ cú pháp markdown inline khỏi chữ tiêu đề (đậm, nghiêng, mã, liên kết, ảnh). */
function boCuPhapInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Các tiêu đề cấp 2 (`## …`) của bài markdown, bỏ qua dòng nằm trong khối mã. DÙNG CÙNG
 * {@link boCapIdMuc} với plugin gắn `id` cho thẻ h2 (`rehype-id-muc.ts`) — hai bên lệch nhau là
 * mục lục bấm không tới đâu.
 */
export function tachMucLuc(markdown: string): MucLuc[] {
  const capId = boCapIdMuc();
  const ra: MucLuc[] = [];
  let trongMa = false;
  for (const dong of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(dong)) {
      trongMa = !trongMa;
      continue;
    }
    if (trongMa) continue;
    const m = /^ {0,3}##(?!#)\s+(.+?)\s*$/.exec(dong);
    if (!m) continue;
    const text = boCuPhapInline(m[1]);
    if (!text) continue;
    ra.push({ id: capId(text), text });
  }
  return ra;
}

/** Địa chỉ trang tag; tag có dấu / ký tự đặc biệt phải mã hoá. */
export function duongDanTag(tag: string): string {
  return `/tin-tuc/tag/${encodeURIComponent(tag)}`;
}

/** Giải mã tham số tag của URL; ký tự `%` lẻ (hoặc đã được giải mã sẵn) không được làm trang nổ lỗi. */
export function giaiMaTag(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}
