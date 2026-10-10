// app/(admin)/admin/nguon-hoa-hong/so/_components/loc-ky.tsx — dải "đang lọc theo kỳ" của hàng chờ tab Sổ (đến từ link "Xem ở tab Sổ" của tab Kỳ).
//
// Server component thuần. Bộ lọc `?ky=` đổi PHẠM VI của mọi con số trên trang (danh sách, "Cần xử lý (N)", chip loại — cùng một điều kiện, `phamViChung`) nên phải nói ra bằng chữ
// và có đường thoát: hai con số cùng nhãn "Cần xử lý" mà khác phạm vi không được tồn tại (luật 12b).
import Link from "next/link";
import { Filter } from "lucide-react";

import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";

export function LocKy({ ky, coSo, hrefBo }: { ky: string; coSo: string | null; hrefBo: string }) {
  return (
    <p role="status" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-primary-soft/40 px-3 py-2 text-sm text-foreground">
      <span className="inline-flex items-center gap-2 font-medium">
        <Filter aria-hidden className="h-4 w-4 shrink-0 text-primary-ink" />
        Đang chỉ xem hàng chờ chặn khoá kỳ {kyHienThi(ky)}
        {coSo ? ` · ${coSo}` : ""}
      </span>
      <Link href={hrefBo} className="font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        Bỏ lọc kỳ
      </Link>
    </p>
  );
}
