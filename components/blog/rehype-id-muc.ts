import { boCapIdMuc } from "@/components/blog/tin-tuc-thuan";

// Plugin rehype gắn `id` cho thẻ <h2> của bài viết để mục lục (`tachMucLuc`) bấm nhảy tới được.
// Chạy SAU `rehype-sanitize` (sanitize thêm tiền tố `user-content-` vào id có sẵn). Viết tay, đi
// qua cây hast thô, để khỏi thêm thư viện (`rehype-slug`) và khỏi phụ thuộc số lần React render
// (bộ đếm trong component sẽ lệch khi StrictMode gọi hàm hai lần).

interface NutHast {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: NutHast[];
}

function layChu(nut: NutHast): string {
  if (nut.type === "text") return nut.value ?? "";
  return (nut.children ?? []).map(layChu).join("");
}

function duyet(nut: NutHast, capId: (text: string) => string): void {
  if (nut.type === "element" && nut.tagName === "h2") {
    const text = layChu(nut).replace(/\s+/g, " ").trim();
    if (text) nut.properties = { ...(nut.properties ?? {}), id: capId(text) };
  }
  for (const con of nut.children ?? []) duyet(con, capId);
}

export function rehypeIdMuc() {
  return (cay: unknown): void => {
    // Mỗi lần xử lý một tài liệu có bộ cấp id RIÊNG (id "-2" tính theo từng bài).
    duyet(cay as NutHast, boCapIdMuc());
  };
}
