// Hàm THUẦN của khu Tuyển dụng (giao diện public mới, 02/11/2026) — không đụng DB, không React.
// Test: `viec-lam-thuan.test.ts` ([PUB-C-1x]).

export type BieuTuong = "sach" | "nguoi" | "chat" | "sao";

/** Một vị trí ở danh sách — MỌI trường đã chuẩn bị ở server (ngày đã định dạng, lương đã ghép chữ). */
export interface ViTriItem {
  slug: string;
  title: string;
  boPhan: string | null;
  diaDiem: string | null;
  hinhThuc: string | null;
  luong: string | null;
  tomTat: string;
  /** `dd/mm/yyyy` — null khi tin không đặt hạn nộp. */
  hanNop: string | null;
  bieuTuong: BieuTuong;
}

export interface TabLoc {
  key: string;
  label: string;
}

interface LuongNguon {
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryNote: string | null;
}

/** Chữ mức lương — cùng thứ tự ưu tiên với trang cũ: chữ tự do → khoảng min–max → ghi chú. */
export function dinhDangLuong(j: LuongNguon): string | null {
  if (j.salary) return j.salary;
  if (j.salaryMin && j.salaryMax) {
    return `${j.salaryMin.toLocaleString("vi-VN")} – ${j.salaryMax.toLocaleString("vi-VN")} VND`;
  }
  return j.salaryNote ?? null;
}

/** Rút gọn mô tả thành một dòng (gộp khoảng trắng, cắt có dấu …). */
export function tomTatMoTa(text: string, max = 160): string {
  const gon = text.replace(/\s+/g, " ").trim();
  return gon.length > max ? `${gon.slice(0, max - 1)}…` : gon;
}

/** Tách mô tả (văn bản thường, quản trị gõ nhiều dòng) thành các đoạn; bỏ dòng trống và gạch đầu dòng. */
export function tachDoan(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((d) => d.replace(/^\s*[-•*]\s+/, "").trim())
    .filter(Boolean);
}

function khongDau(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Vị trí làm việc trực tiếp với lớp học (giáo viên, trợ giảng, giáo vụ…) — có bước "dạy thử". */
export function laViTriGiangDay(title: string, boPhan: string | null): boolean {
  return /giao vien|tro giang|giang vien|giao vu/.test(khongDau(`${title} ${boPhan ?? ""}`));
}

/**
 * Biểu tượng ở đầu mỗi dòng vị trí — suy từ tên vị trí/bộ phận (quản trị nhập tự do nên chỉ là
 * gợi ý hình ảnh, không mang nghĩa nghiệp vụ). Mặc định "sao".
 */
export function bieuTuongViTri(title: string, boPhan: string | null): BieuTuong {
  const s = khongDau(`${title} ${boPhan ?? ""}`);
  if (/giao vien|tro giang|giang vien|dao tao|giao vu|giao trinh/.test(s)) return "sach";
  if (/tu van|tuyen sinh|sale|kinh doanh|cham soc|le tan|nhan su/.test(s)) return "nguoi";
  if (/marketing|content|truyen thong|telesale|fanpage|quang cao/.test(s)) return "chat";
  return "sao";
}

/**
 * Tab lọc từ các giá trị có thật trong dữ liệu (giữ thứ tự xuất hiện đầu tiên). Ít hơn 2 giá trị
 * khác nhau thì KHÔNG có gì để lọc ⇒ trả mảng rỗng (không vẽ bộ lọc thừa).
 */
export function tabLocTuDuLieu(values: readonly (string | null | undefined)[]): TabLoc[] {
  const thay = new Map<string, TabLoc>();
  for (const v of values) {
    const label = v?.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase("vi");
    if (!thay.has(key)) thay.set(key, { key, label });
  }
  return thay.size >= 2 ? [...thay.values()] : [];
}

/** Lọc hai chiều độc lập (hình thức, địa điểm); `null` = không lọc chiều đó. */
export function locViTri<T extends Pick<ViTriItem, "hinhThuc" | "diaDiem">>(
  items: readonly T[],
  hinhThuc: string | null,
  diaDiem: string | null,
): T[] {
  const so = (a: string | null, b: string | null) => a === null || (b?.trim().toLocaleLowerCase("vi") ?? "") === a;
  return items.filter((it) => so(hinhThuc, it.hinhThuc) && so(diaDiem, it.diaDiem));
}

export interface BuocUngTuyen {
  so: string;
  tieuDe: string;
  moTa: string;
}

/**
 * Quy trình ứng tuyển ở trang chi tiết. KHÔNG hứa số ngày phản hồi (artifact để "[3–5] ngày" là chỗ
 * giữ chỗ chưa có số thật) và KHÔNG nhắc "form bên cạnh" (chưa có form nhận hồ sơ — chỉ email/điện
 * thoại). Bước "Dạy thử" chỉ có với vị trí giảng dạy.
 */
export function cacBuocUngTuyen(giangDay: boolean): BuocUngTuyen[] {
  const buoc: Omit<BuocUngTuyen, "so">[] = [
    { tieuDe: "Nộp hồ sơ", moTa: "Gửi CV qua email" },
    { tieuDe: "Sàng lọc", moTa: "Nhân sự xem hồ sơ" },
    { tieuDe: "Phỏng vấn", moTa: "Tại cơ sở" },
  ];
  if (giangDay) buoc.push({ tieuDe: "Dạy thử", moTa: "Một buổi ngắn với lớp" });
  buoc.push({ tieuDe: "Nhận việc", moTa: "Đào tạo hội nhập" });
  return buoc.map((b, i) => ({ so: String(i + 1).padStart(2, "0"), ...b }));
}

/** Tiêu đề thư ứng tuyển cho một vị trí cụ thể. */
export function tieuDeThuUngTuyen(title: string): string {
  return `Ứng tuyển: ${title}`;
}

/** Tiêu đề thư gửi CV chủ động (khi chưa chọn vị trí) — đúng mẫu artifact. */
export const TIEU_DE_THU_CHU_DONG = "[Ứng tuyển] Vị trí - Cơ sở - Họ tên";
