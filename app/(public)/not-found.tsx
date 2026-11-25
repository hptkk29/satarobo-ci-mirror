import { Khoi404 } from "@/components/not-found/khoi-404";

export const metadata = { title: "Không tìm thấy trang" };

// 404 của `notFound()` bắn từ trang public: render BÊN TRONG layout nhóm (thanh trên + chân trang +
// `<main>` đã có) nên chỉ cần thân trang. URL không khớp route nào thì dùng `app/not-found.tsx`.
//
// ⛔ KHÔNG đọc API động của request ở đây (xem lưới [NF404-W] trong lib/routing/dich-den-404.test.ts).
export default function NotFoundPublic() {
  return <Khoi404 />;
}
