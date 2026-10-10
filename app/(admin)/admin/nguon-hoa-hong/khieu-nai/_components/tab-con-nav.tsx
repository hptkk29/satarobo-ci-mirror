// Công tắc bốn tab con của tab "Khiếu nại & lịch sử": Khiếu nại | Đổi nguồn | Lịch sử chính sách | Nhật ký. Là các `<Link>` (điều hướng, không cần JS), trạng thái nằm trên URL
// `?con=` — chia sẻ link, F5, nút Back đều đúng. Chỉ liệt kê tab con người xem MỞ ĐƯỢC (cùng `tabConUngVien` với cổng của page): không vẽ tab mà bấm vào là báo không có quyền.
import Link from "next/link";

import { hrefVoi } from "@/lib/nguon-hoa-hong/url";
import { NHAN_TAB_CON, type TabCon } from "@/lib/nguon-hoa-hong/tab-con-khieu-nai";
import { cn } from "@/lib/utils";

const MUC = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring";

export function TabConNav({ basePath, ungVien, dangXem, soCanXuLy }: { basePath: string; ungVien: readonly TabCon[]; dangXem: TabCon; soCanXuLy: number | null }) {
  return (
    <nav aria-label="Phần của tab" className="max-w-full overflow-x-auto">
      <div className="inline-flex overflow-hidden rounded-lg border border-border bg-card">
        {ungVien.map((t, i) => (
          <Link
            key={t}
            href={hrefVoi(basePath, { con: t === "khieu-nai" ? null : t })}
            aria-current={dangXem === t ? "page" : undefined}
            className={cn(MUC, i > 0 && "border-l border-border", dangXem === t ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:bg-muted")}
          >
            {NHAN_TAB_CON[t]}
            {t === "khieu-nai" && soCanXuLy !== null && soCanXuLy > 0 && <span className="tabular-nums">({soCanXuLy})</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}
