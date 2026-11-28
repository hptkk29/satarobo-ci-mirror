import Link from "next/link";
import { cn } from "@/lib/utils";
import { hrefTab } from "@/lib/elearning/tab-url";

export type TabKhaiBao = {
  id: string;
  nhan: string;
  /** Số đếm nhỏ cạnh nhãn (vd. số khoá quá hạn). `undefined` = không hiện. */
  dem?: number;
  /** Tham số RIÊNG của tab này, ghi đè `giuLai` (vd. tab "Chưa đọc" mang `status=unread` cho API tải thêm). */
  them?: Readonly<Record<string, string>>;
};

/**
 * Tab điều hướng bằng URL (`?tab=`): MỖI TAB LÀ MỘT LIÊN KẾT THẬT — mở thẳng được, F5 không mất, gửi được cho người khác.
 * Component server (không hook); trang đọc `searchParams` bằng `tabDangMo()`. Không phải `components/ui/tabs.tsx` (state client).
 *
 * `giuLai`: tham số lọc cần mang sang tab khác (`q`, `sort`…). Không bao giờ giữ `page` — xem `hrefTab`.
 */
export function TabNav({
  duongDan,
  tab,
  dangMo,
  giuLai,
  nhanDanhSach,
  className,
}: {
  duongDan: string;
  tab: readonly TabKhaiBao[];
  dangMo: string;
  giuLai?: Readonly<Record<string, string | undefined>>;
  /** Nhãn cho trình đọc màn hình, vd "Khoá của tôi". */
  nhanDanhSach: string;
  className?: string;
}) {
  return (
    <nav aria-label={nhanDanhSach} className={cn("max-w-full overflow-x-auto border-b border-border", className)}>
      <ul className="flex list-none gap-5">
        {tab.map((t) => {
          const mo = t.id === dangMo;
          return (
            <li key={t.id}>
              <Link
                href={hrefTab(duongDan, t.id, { ...giuLai, ...t.them })}
                aria-current={mo ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  mo
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.nhan}
                {t.dem !== undefined && (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{t.dem}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
