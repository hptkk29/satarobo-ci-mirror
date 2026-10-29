// components/admin/cham-cong/me-nav.tsx — cụm "Của tôi" của nhân viên.
//
// Vì sao file này tồn tại: lịch ca, đơn của tôi và chấm công là việc của CHÍNH người đăng nhập,
// không phải việc quản lý khối — nên chúng không dùng ModuleNav (không khối, không kỳ) và cũng
// không có ScopeBar. Tách hẳn hàng tab riêng để nhân viên không lạc vào màn quản lý và ngược lại.
//
// `?month=` phải được mang theo: người đang xem tháng 08 mà bấm "Đơn của tôi" rồi quay lại thì
// tháng phải còn nguyên. CẢ HAI tab đi qua `hrefWith` — gắn `month` cho riêng tab Lịch ca là
// vẫn rơi tham số, vì chuyến đi làm mất tháng là chuyến SANG "Đơn của tôi" rồi quay lại.
//
// Href là chuỗi literal NẰM NGAY SAU `href:` — `components/admin/nav-coverage.test.ts` quét đúng
// chuỗi ở vị trí đó để biết route còn lối vào (2 route này đã rời sidebar). Nên `hrefWith` gọi ở
// chỗ render, KHÔNG gói literal vào trong lời gọi hàm hay vào một hằng đặt tên khác.
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { BTN_OUTLINE, TAB, TAB_ACTIVE, TAB_IDLE } from "./classes";

export type MeNavKey = "lich-ca" | "cua-toi";

export function MeNav({ active, month }: { active: MeNavKey; month?: string | null }) {
  const tabs: { key: MeNavKey; label: string; href: string }[] = [
    { key: "lich-ca", label: "Lịch ca", href: "/cham-cong/lich-ca" },
    { key: "cua-toi", label: "Đơn của tôi", href: "/don-tu/cua-toi" },
  ];

  return (
    <div className="mb-4 flex items-end justify-between gap-3 border-b border-border">
      {/* `min-w-0`: ô flex mặc định `min-width:auto` nên hàng tab từ chối co xuống dưới bề rộng
          nội dung, `overflow-x-auto` không kích hoạt, và nút "Chấm công" (`shrink-0`) bị đẩy ra
          ngoài — ở 375px nó ĐÈ LÊN tab "Đơn của tôi" (đo trên test 06/09). Cùng một bệnh với
          lưới hai cột ở màn Ghi chú lịch. */}
      <nav aria-label="Điều hướng cá nhân" className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={hrefWith(t.href, { month })}
              aria-current={isActive ? "page" : undefined}
              className={cn(TAB, isActive ? TAB_ACTIVE : TAB_IDLE)}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Link href="/cham-cong/checkin" className={cn(BTN_OUTLINE, "mb-2 shrink-0")}>
        <Clock aria-hidden className="h-4 w-4" />
        Chấm công
      </Link>
    </div>
  );
}
