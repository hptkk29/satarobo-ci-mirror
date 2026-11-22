"use client";

// Thanh tab CON của tab Cấu hình (S5b, audit 05 §4.1). Hiện chỉ MỘT mục thật: "Pháp nhân & ký hiệu".
//
// ⚠️ Luật 12 (affordance nói thật): tab con CHƯA có chức năng thật KHÔNG được liệt kê. Một thanh tab chỉ có một mục thì
// không có gì để chọn ⇒ thanh tự ẩn (trả null) cho tới khi có từ hai mục thật. Muốn thêm tab con: thêm một dòng vào
// `TAB_CON` KÈM trang thật (và cổng quyền riêng của trang đó) — không thêm dòng "sắp có".
// Link mang cơ sở + tháng như thanh tab cấp 1 (đi khứ hồi không mất phạm vi); `href` là chuỗi literal (nav-coverage).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { phamViTuQuery, xuLyPhimMuiTen } from "../../_components/dieu-huong-hoa-don";
import { queryHoaDon } from "@/lib/finance/hoa-don/loc-hang-cho";

export type TabCon = { key: string; nhan: string; href: string };

export const TAB_CON: readonly TabCon[] = [{ key: "phap-nhan", nhan: "Pháp nhân & ký hiệu", href: "/payments/hoa-don/cau-hinh" }];

const MUC = "rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-2.5";
const MUC_MO = "bg-primary-soft font-semibold text-primary-ink";
const MUC_NGHI = "text-muted-foreground hover:bg-muted";

export function CauHinhTabs({ danhSach = TAB_CON }: { danhSach?: readonly TabCon[] }) {
  const pathname = usePathname();
  const pv = phamViTuQuery(useSearchParams());
  if (danhSach.length < 2) return null;
  const q = queryHoaDon(pv, {});
  return (
    <nav aria-label="Cấu hình hoá đơn" className="mb-4">
      <ul onKeyDown={xuLyPhimMuiTen} className="flex flex-wrap gap-1">
        {danhSach.map((t) => (
          <li key={t.key}>
            <Link
              href={q ? `${t.href}?${q}` : t.href}
              aria-current={pathname === t.href ? "page" : undefined}
              className={cn(MUC, pathname === t.href ? MUC_MO : MUC_NGHI)}
            >
              {t.nhan}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
