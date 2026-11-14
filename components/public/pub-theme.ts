/**
 * Chủ đề sáng/tối của giao diện public — MỘT nguồn cho script chống nháy, nút đổi và test.
 * Lựa chọn của khách lưu ở localStorage `sata-theme`; CHƯA chọn ⇒ SÁNG (chủ dự án chốt 04/11/2026: «mặc định là màu sáng nhẹ, không theo hệ thống» —
 * KHÔNG đọc `prefers-color-scheme` ở bất kỳ đâu). Class `.theme-light` / `.theme-dark` nằm trên phần tử gốc `.page`.
 */
export const PUB_THEME_KEY = "sata-theme";
export type PubTheme = "light" | "dark";

export function docChuDe(raw: string | null | undefined): PubTheme | null {
  return raw === "dark" || raw === "light" ? raw : null;
}

/** Chủ đề hiệu lực: đã lưu (light/dark) thì theo đã lưu; chưa lưu hoặc giá trị lạ ⇒ sáng. Không phụ thuộc hệ điều hành. */
export function chuDeHieuLuc(daLuu: string | null | undefined): PubTheme {
  return docChuDe(daLuu) ?? "light";
}

/**
 * Script chạy NGAY khi trình duyệt phân tích xong phần tử gốc `.page` (đặt làm con đầu tiên của nó), trước
 * khi vẽ ⇒ không nháy sáng→tối. Viết bằng dấu backtick và không dùng `<`, `>`, `&`, `'`, `"` vì React
 * escape nội dung chữ của <script> (không dùng dangerouslySetInnerHTML).
 */
export const PUB_THEME_SCRIPT =
  "try{var t=localStorage.getItem(`" +
  PUB_THEME_KEY +
  "`)===`dark`?`dark`:`light`;" +
  "var r=document.currentScript.parentElement;r.classList.remove(`theme-light`,`theme-dark`);r.classList.add(`theme-`+t)}catch(e){}";

const goc = () => document.querySelector<HTMLElement>(".sr-pub");

/** Đặt chủ đề lên phần tử gốc đang có trên trang (nếu có) và lưu lựa chọn. */
export function datChuDe(theme: PubTheme): void {
  const root = goc();
  if (root) {
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(`theme-${theme}`);
  }
  try {
    window.localStorage.setItem(PUB_THEME_KEY, theme);
  } catch {
    /* chế độ riêng tư: bỏ qua */
  }
}

/**
 * Áp lại chủ đề hiệu lực lên `.page` ngay sau khi gắn. Cần vì khi cây được dựng lại ở phía trình duyệt
 * (vd điều hướng mềm tới trang gọi `notFound()`), phần tử gốc mới sinh ra với `theme-light` và
 * <script> chống nháy KHÔNG chạy lại (React không thực thi script do nó tạo ở client).
 */
export function dongBoChuDeDaLuu(): void {
  try {
    const root = goc();
    if (!root) return;
    const hieuLuc = chuDeHieuLuc(window.localStorage.getItem(PUB_THEME_KEY));
    if (!root.classList.contains(`theme-${hieuLuc}`)) {
      root.classList.remove("theme-light", "theme-dark");
      root.classList.add(`theme-${hieuLuc}`);
    }
  } catch {
    /* bỏ qua */
  }
}
