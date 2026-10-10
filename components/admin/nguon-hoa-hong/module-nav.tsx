// components/admin/nguon-hoa-hong/module-nav.tsx — hàng tab đứng đầu MỌI màn của module (06 §4.1).
//
// Hai luật không được phá (cùng hai luật của `components/admin/cham-cong/module-nav.tsx`):
//  1. `href` là CHUỖI LITERAL — `components/admin/nav-coverage.test.ts` quét chuỗi đứng sau `href:` ở `app/` +
//     `components/` để biết route nào còn lối vào. Ghép động là route thành mồ côi và test đỏ. Ca `[NHH-FE-01]`
//     so danh sách này với `TAB_HREF` của lib — lệch là đỏ.
//  2. Tab tự lọc theo quyền ∧ cờ. ModuleNav KHÔNG nằm trong `sidebar.tsx` nên không lưới nào khác bắt dead-link
//     ở đây: hiện tab của màn người ta không vào được là đẩy họ vào trang 404/NoPermission do chính mình vẽ ra.
//     Lọc qua `scope.tabMoDuoc` — MỘT hàm với route gốc và từng page (lib/nguon-hoa-hong/tab.ts).
//
// Số trong pill = hàng chờ THẬT của tab (từ `lib/nguon/doc-hang-cho.ts`); ẩn khi 0, tab chưa có dữ liệu thì
// không truyền (không bao giờ in "0").
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NguonHoaHongScope } from "@/lib/nguon-hoa-hong/scope";
import { CUM_SO_DEM, type TabKey } from "@/lib/nguon-hoa-hong/tab";
import { SO_DEM, TAB, TAB_ACTIVE, TAB_IDLE } from "./classes";
import { CuonTabNav } from "./cuon-tab-nav";

const TABS = [
  { key: "nguon", label: "Nguồn", href: "/nguon-hoa-hong/nguon" },
  { key: "chinh-sach", label: "Chính sách", href: "/nguon-hoa-hong/chinh-sach" },
  { key: "so", label: "Sổ hoa hồng", href: "/nguon-hoa-hong/so" },
  { key: "ky", label: "Kỳ", href: "/nguon-hoa-hong/ky" },
  { key: "khieu-nai", label: "Khiếu nại & lịch sử", href: "/nguon-hoa-hong/khieu-nai" },
] as const satisfies readonly { key: TabKey; label: string; href: string }[];

export function ModuleNav({
  active,
  scope,
  soHangCho,
}: {
  active: TabKey;
  scope: NguonHoaHongScope;
  /** Hàng chờ theo tab. Tab không có số (chưa có dữ liệu) thì không truyền — không in "0". */
  soHangCho: Partial<Record<TabKey, number>>;
}) {
  const hien = TABS.filter((t) => scope.tabMoDuoc(t.key));
  if (hien.length === 0) return null;

  return (
    <div className="mb-4 border-b border-border">
      {/* Thanh tab cuộn ngang: vỏ client `CuonTabNav` (mặt nạ mờ khi còn tab ngoài màn + tab đang chọn tự vào giữa) — ModuleNav vẫn là server component. */}
      <CuonTabNav aria-label="Điều hướng nguồn lead và hoa hồng" className="-mb-px gap-1">
        {hien.map((t) => {
          const so = soHangCho[t.key] ?? 0;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={cn(TAB, t.key === active ? TAB_ACTIVE : TAB_IDLE)}
            >
              {t.label}
              {so > 0 && (
                <span className={SO_DEM} title={`${so} ${CUM_SO_DEM[t.key]}`}>
                  {so}
                  <span className="sr-only"> {CUM_SO_DEM[t.key]}</span>
                </span>
              )}
            </Link>
          );
        })}
      </CuonTabNav>
    </div>
  );
}
