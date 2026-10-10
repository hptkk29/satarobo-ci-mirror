import Link from "next/link";
import { BookOpenText, ChevronRight, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phần "giải thích cách dùng" của một trang admin — THU LẠI theo mặc định.
 *
 * VÌ SAO CÓ. 42 trang admin đang in một đoạn văn xuôi dài ngay dưới tiêu đề (dài nhất
 * 222 ký tự). Người vận hành đọc nó đúng MỘT lần rồi phải lướt qua nó mỗi ngày, trong
 * khi thứ họ cần là bảng dữ liệu bên dưới. Tệ hơn, nhiều đoạn là ghi chú cho người viết
 * code lọt ra giao diện: "= khoá upsert", "skipDuplicates", "autoEnforced",
 * "Verify Recharts wrappers hoạt động đúng".
 *
 * ⇒ Tiêu đề trang chỉ giữ một dòng NGẮN nói trang này là gì. Phần hướng dẫn nằm ở đây,
 * đóng sẵn, mở bằng một cú bấm — và trỏ sang bài hướng dẫn đầy đủ ở /huong-dan.
 *
 * Dùng `<details>` gốc chứ không phải state React: nó hoạt động trước khi JS chạy, giữ
 * được trạng thái khi in trang, và không tốn một client component cho mỗi trang admin.
 */
export function PageHelp({
  children,
  guideSlug,
  label = "Hướng dẫn dùng trang này",
  className,
}: {
  /** Nội dung hướng dẫn. Viết cho NGƯỜI VẬN HÀNH — không ghi chú kỹ thuật. */
  children: React.ReactNode;
  /** Slug bài ở /huong-dan; có thì hiện link "Xem bài đầy đủ". */
  guideSlug?: string;
  label?: string;
  className?: string;
}) {
  return (
    <details className={cn("group mb-4 rounded-xl border border-border bg-card", className)}>
      {/* `pointer-coarse:min-h-11` — đo 13/09: `py-2.5` cho ra 40px, dưới sàn 44px của
          PRODUCT.md. Chỉ đặt sàn CHIỀU CAO và chỉ khi dùng ngón tay, nên bố cục của 42
          trang đang dùng thành phần này không đổi một pixel nào trên máy có chuột. */}
      <summary className="flex min-h-0 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <CircleHelp className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        {label}
        <ChevronRight
          className="ml-auto h-4 w-4 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden
        />
      </summary>
      <div className="border-t border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        {children}
        {guideSlug && (
          <Link
            href={`/huong-dan/${guideSlug}`}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <BookOpenText className="h-4 w-4" aria-hidden />
            Xem bài hướng dẫn đầy đủ
          </Link>
        )}
      </div>
    </details>
  );
}
