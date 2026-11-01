import { NutVeTrangChinh } from "@/components/not-found/nut-ve-trang-chinh";

export const metadata = { title: "Không tìm thấy trang" };

// Trang 404 tiếng Việt dùng chung (trước đây rơi vào default Next "This page could
// not be found"). Link "về trang chính" tuỳ theo subdomain đang truy cập — chọn ở TRÌNH DUYỆT.
//
// ⛔ KHÔNG import `next/headers` / `cookies()` ở đây [lỗi 500 slug lạ, 30/10/2026]: trang này được render
// trong ngữ cảnh TĨNH khi `notFound()` bắn từ route ISR (`/tin-tuc/<x>`, `/tuyen-dung/<x>`, `/vinh-danh/<x>`),
// và một API động ở đó làm cả route lỗi "Page changed from static to dynamic at runtime" ⇒ 500.
// Lưới: lib/routing/dich-den-404.test.ts ([NF404-W1]).
export default function NotFound() {
  // <div> chứ KHÔNG <main>: 404 render BÊN TRONG layout route group (public đã có
  // <main class="flex-1"> bao ngoài) — 2 <main> lồng nhau là HTML sai chuẩn và làm
  // locator('main') của e2e smoke trúng 2 phần tử (strict mode).
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="bg-gradient-to-r from-orange-500 to-purple-700 bg-clip-text text-7xl font-extrabold tracking-tight text-transparent">
          404
        </p>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Không tìm thấy trang</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          Trang bạn tìm không tồn tại hoặc đã được di chuyển. Kiểm tra lại đường dẫn
          hoặc quay về trang chính.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <NutVeTrangChinh />
        </div>
      </div>
    </div>
  );
}
