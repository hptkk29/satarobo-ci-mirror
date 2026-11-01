import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ── LƯỚI GHIM MÃ NGUỒN ─────────────────────────────────────────────────────────────────────────
// Luật cần khoá: `generateMetadata` của trang chi tiết công khai CÓ CÙNG điều kiện "đã công khai" với `notFound()` của `page.tsx`.
// Nếu không, mục nháp/đã đóng trả 404 nhưng title/mô tả/ảnh bìa vẫn nằm trong phản hồi (và hiện ở tab trình duyệt).
// Mã TRƯỚC bản vá (/tin-tuc/[slug]): `if (!post) return {};` — chỉ kiểm tồn tại, không kiểm `isPublished`.
// Lỗi này CÓ SẴN nhưng bị CHE: trước khi sửa 404 (#1082) slug nháp trả 500 nên metadata không ra; sửa 404 làm nó lộ (đo 01/11/2026:
// TEST trả 404 kèm tiêu đề bài nháp; bản Next 16.2.6 trước đó trả 500 không kèm).
// Bỏ chú thích trước khi so (chú thích giải thích bản vá chứa đúng chuỗi đang canh).
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
}
function khoiGenerateMetadata(ma: string): string {
  const i = ma.indexOf("export async function generateMetadata");
  expect(i, "không thấy generateMetadata").toBeGreaterThanOrEqual(0);
  const j = ma.indexOf("export default", i);
  expect(j, "không thấy export default sau generateMetadata").toBeGreaterThan(i);
  return ma.slice(i, j);
}
const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[META-PUB] metadata của mục chưa công khai", () => {
  it("[META-PUB-01] /tin-tuc/[slug]: generateMetadata trả {} khi bài chưa xuất bản", () => {
    const m = khoiGenerateMetadata(doc("app/(public)/tin-tuc/[slug]/page.tsx"));
    expect(m).toMatch(/if\s*\(\s*!post\s*\|\|\s*!post\.isPublished\s*\)\s*return\s*\{\s*\}/);
  });

  it("[META-PUB-02] /tuyen-dung/[slug]: generateMetadata trả {} khi tin không còn OPEN", () => {
    const m = khoiGenerateMetadata(doc("app/(public)/tuyen-dung/[slug]/page.tsx"));
    expect(m).toMatch(/if\s*\(\s*!job\s*\|\|\s*job\.status\s*!==\s*"OPEN"\s*\)\s*return\s*\{\s*\}/);
  });

  it("[META-PUB-03] /vinh-danh/[slug]: generateMetadata không sinh tên/giải thưởng khi hồ sơ chưa công khai", () => {
    const m = khoiGenerateMetadata(doc("app/(public)/vinh-danh/[slug]/page.tsx"));
    expect(m).toMatch(/if\s*\(\s*!honor\s*\|\|\s*!honor\.isPublished\s*\)\s*return/);
  });

  it("[META-PUB-04] điều kiện ở generateMetadata trùng điều kiện notFound() của page (không lệch nhau)", () => {
    expect(doc("app/(public)/tin-tuc/[slug]/page.tsx")).toMatch(/if\s*\(\s*!post\s*\|\|\s*!post\.isPublished\s*\)\s*notFound\(\)/);
    expect(doc("app/(public)/tuyen-dung/[slug]/page.tsx")).toMatch(/if\s*\(\s*!job\s*\|\|\s*job\.status\s*!==\s*"OPEN"\s*\)\s*notFound\(\)/);
    expect(doc("app/(public)/vinh-danh/[slug]/page.tsx")).toMatch(/if\s*\(\s*!honor\s*\|\|\s*!honor\.isPublished\s*\)\s*notFound\(\)/);
  });
});
