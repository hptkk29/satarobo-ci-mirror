import Link from "next/link";
import { headers } from "next/headers";

export const metadata = { title: "Không tìm thấy trang" };

// Trang 404 tiếng Việt dùng chung (trước đây rơi vào default Next "This page could
// not be found"). Link "về trang chính" tuỳ theo subdomain đang truy cập.
export default async function NotFound() {
  const host = (await headers()).get("host")?.toLowerCase() ?? "";
  const dest = host.startsWith("giaovien.")
    ? { href: "/teacher", label: "Về trang giáo viên" }
    : host.startsWith("hocvien.")
      ? { href: "/portal", label: "Về cổng phụ huynh" }
      : host.startsWith("admin.") || host.startsWith("sale.")
        ? { href: "/dashboard", label: "Về Dashboard" }
        : { href: "/", label: "Về trang chủ" };

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
          <Link
            href={dest.href}
            className="rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {dest.label}
          </Link>
          {dest.href !== "/" && (
            <Link
              href="/"
              className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Về trang chủ
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
