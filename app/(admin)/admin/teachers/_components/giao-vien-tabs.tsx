// Thanh tab của mục "Giáo viên" (chốt 25/10/2026): màn Rank là màn CON của mục này, không còn mục riêng ở sidebar.
// `href` là chuỗi literal — lưới `nav-coverage` quét literal để biết màn nào có lối vào. Mỗi tab chỉ vẽ khi trang báo người xem MỞ ĐƯỢC
// màn đó (luật 12): danh sách cần `employees:view-all`, Rank cần `parttime_rank:view` ở ít nhất một cơ sở.
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TAB, TAB_ACTIVE, TAB_IDLE } from "@/components/admin/cham-cong/classes";

const DANH_SACH = { href: "/teachers", nhan: "Danh sách giáo viên" } as const;
const RANK = { href: "/teachers/rank", nhan: "Rank & chứng nhận" } as const;

export function GiaoVienTabs({ active, danhSach, rank }: { active: "danh-sach" | "rank"; danhSach: boolean; rank: boolean }) {
  const tabs: { key: "danh-sach" | "rank"; href: string; nhan: string }[] = [];
  if (danhSach) tabs.push({ ...DANH_SACH, key: "danh-sach" });
  if (rank) tabs.push({ ...RANK, key: "rank" });
  // Một tab duy nhất thì không cần thanh tab — tiêu đề trang đã nói người xem đang ở đâu.
  if (tabs.length < 2) return null;
  return (
    <div className="mb-5 border-b border-border">
      <nav aria-label="Mục giáo viên" className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} aria-current={active === t.key ? "page" : undefined} className={cn(TAB, active === t.key ? TAB_ACTIVE : TAB_IDLE)}>
            {t.nhan}
          </Link>
        ))}
      </nav>
    </div>
  );
}
