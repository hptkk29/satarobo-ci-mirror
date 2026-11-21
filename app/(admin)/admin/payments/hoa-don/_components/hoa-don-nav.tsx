"use client";

// Thanh điều hướng CẤP 1 của khu Hoá đơn điện tử: Hoá đơn · Cảnh báo & sai sót · Cấu hình (S5b, audit 05 §4.1).
//
// ⚠️ Đây là ĐIỀU HƯỚNG theo URL (mỗi tab là một trang), không phải tablist — nên `aria-current`, không `role="tab"` /
// `aria-selected` (audit 05 G6). Mũi tên ←/→/Home/End chuyển tiêu điểm giữa các tab như một thanh tab thật.
//
// ⚠️ Hình dạng cố ý KHÁC thanh ngăn bên dưới (gạch chân ↔ nút bấm trong khay xám): hai tầng cùng kiểu pill khiến
// người dùng không phân biệt được "đổi khu vực" với "đổi ngăn" (audit 05 §1.7, anti-pattern).
//
// ⚠️ Link dựng từ `KHU_VUC` (mảng literal ở dieu-huong-hoa-don.ts) để `nav-coverage` thấy lối vào; mỗi link MANG cơ sở +
// tháng + sắp xếp đang xem và BỎ dòng chọn / ngăn / trang. Quyền KHÔNG kiểm ở đây — layout (server) truyền `hien`;
// trang đích vẫn tự gác (layout chưa đủ).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { KHU_VUC, hrefKhuVuc, khuVucDangMo, phamViTuQuery, xuLyPhimMuiTen, type KhuVucKey } from "./dieu-huong-hoa-don";

// Cao 40px; màn cảm ứng ≥ 44px (WCAG 2.5.8). Focus là vòng 2px chứ không chỉ đổi màu viền (audit 05 R2).
const TAB =
  "inline-flex items-center whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:py-3.5";
const TAB_MO = "border-primary text-primary-ink";
const TAB_NGHI = "border-transparent text-muted-foreground hover:border-border hover:text-foreground";

export function HoaDonNav({ hien }: { hien: readonly KhuVucKey[] }) {
  const pathname = usePathname();
  const pv = phamViTuQuery(useSearchParams());
  const dangMo = khuVucDangMo(pathname);
  // `moRa` chặn tab chưa có trang (Nhật ký) dù cha có truyền — một tab dẫn tới 404 là lời hứa suông.
  const ds = KHU_VUC.filter((k) => k.moRa && hien.includes(k.key));
  if (ds.length === 0) return null;

  return (
    <nav aria-label="Khu vực hoá đơn" className="mb-4 border-b border-border">
      <ul onKeyDown={xuLyPhimMuiTen} className="-mb-px flex gap-1 overflow-x-auto">
        {ds.map((k) => {
          const mo = dangMo?.key === k.key;
          return (
            <li key={k.key}>
              <Link
                href={hrefKhuVuc(k.key, pv)}
                aria-current={mo ? (dangMo.chinhXac ? "page" : "true") : undefined}
                className={cn(TAB, mo ? TAB_MO : TAB_NGHI)}
              >
                {k.nhan}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
