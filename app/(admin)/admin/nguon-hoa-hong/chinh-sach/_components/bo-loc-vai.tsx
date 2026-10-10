"use client";

// Bộ lọc theo VAI hưởng của bảng chính sách: một ô chọn (không phải tám chip chiếm hai hàng). Đổi giá trị là ĐIỀU HƯỚNG (URL là nguồn
// sự thật — `?vai=`), nên F5, chia sẻ link và nút Back đều đúng; component không giữ trạng thái lọc nào riêng.
import { useRouter } from "next/navigation";

import { O_NHAP } from "@/components/admin/nguon-hoa-hong/classes";
import { hrefVoi, type TruyVan } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

export function BoLocVai({
  basePath,
  giu,
  vai,
  dangChon,
  className,
}: {
  basePath: string;
  /** Tham số khác phải sống sót khi đổi vai (`coSo`, `xem`, `trangthai`). `trang` KHÔNG giữ: đổi bộ lọc là về trang 1. */
  giu: TruyVan;
  vai: { code: string; name: string }[];
  dangChon: string | null;
  className?: string;
}) {
  const router = useRouter();
  return (
    <label className={cn("flex items-center gap-2 text-sm font-medium text-muted-foreground", className)}>
      Vai hưởng
      <select
        value={dangChon ?? ""}
        onChange={(e) => router.push(hrefVoi(basePath, { ...giu, vai: e.target.value === "" ? null : e.target.value, trang: null }))}
        className={cn(O_NHAP, "w-56 text-foreground")}
      >
        <option value="">Mọi vai</option>
        {vai.map((v) => (
          <option key={v.code} value={v.code}>
            {v.name}
          </option>
        ))}
      </select>
    </label>
  );
}
