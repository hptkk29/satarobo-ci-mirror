// Công tắc ba chế độ của tab Chính sách: "Cần xử lý (N) | Tất cả | Ma trận". Là ba `<Link>` (điều hướng, không cần JS), trạng thái nằm
// trên URL `?xem=` — chia sẻ link, F5, nút Back đều đúng. Cùng hình với `QueueToggle` của tab Nguồn; không dùng chung vì tab
// Nguồn chỉ có hai chế độ và component đó khoá kiểu `CheDoXem` ở hai giá trị.
import Link from "next/link";

import { hrefVoi, type TruyVan } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

export type CheDoChinhSach = "can-xu-ly" | "tat-ca" | "ma-tran";

export const docCheDoChinhSach = (raw: string | null): CheDoChinhSach => (raw === "tat-ca" || raw === "ma-tran" ? raw : "can-xu-ly");

const MUC = "inline-flex h-8 items-center whitespace-nowrap px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring";

export function CheDoXemChinhSach({
  basePath,
  dangXem,
  soCanXuLy,
  giu,
}: {
  basePath: string;
  dangXem: CheDoChinhSach;
  soCanXuLy: number | null;
  /** Tham số khác phải sống sót (`coSo`). Bộ lọc riêng của từng chế độ KHÔNG giữ: đổi chế độ là về đầu danh sách. */
  giu?: TruyVan;
}) {
  const href = (xem: CheDoChinhSach) => hrefVoi(basePath, { ...giu, xem: xem === "can-xu-ly" ? null : xem });
  const muc = (xem: CheDoChinhSach, nhan: React.ReactNode, tien?: boolean) => (
    <Link
      key={xem}
      href={href(xem)}
      aria-current={dangXem === xem ? "page" : undefined}
      className={cn(MUC, tien && "border-l border-border", dangXem === xem ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:bg-muted")}
    >
      {nhan}
    </Link>
  );
  return (
    <nav aria-label="Chế độ xem" className="inline-flex overflow-hidden rounded-lg border border-border bg-card">
      {muc("can-xu-ly", <>Cần xử lý{soCanXuLy !== null && <span className="ml-1.5 tabular-nums">({soCanXuLy})</span>}</>)}
      {muc("tat-ca", "Tất cả", true)}
      {muc("ma-tran", "Ma trận", true)}
    </nav>
  );
}
