"use client";

// components/admin/nguon-hoa-hong/cuon-tab-nav.tsx — vỏ cuộn ngang của thanh tab ModuleNav.
//
// Vì sao tách khỏi `module-nav.tsx`: ModuleNav nhận `scope` (có hàm — `tabMoDuoc`, `has`…) nên PHẢI là server component; chỉ phần cuộn mới cần trình duyệt. Vỏ này nhận các
// `<Link>` đã dựng sẵn làm `children` (qua được ranh giới client) và làm đúng hai việc:
//   1. DẤU HIỆU "còn tab ngoài màn": mặt nạ mờ ở mép còn nội dung (phải / trái / cả hai), đo bằng số đo THẬT (scrollWidth · clientWidth · scrollLeft) nên chỉ hiện khi thật sự tràn
//      — ở 375px và 768px (sidebar chiếm 256px) năm tab ~510px không vừa; ở màn rộng thì không mờ gì. Trước khi JS chạy, điện thoại (`max-md`) luôn tràn nên đã có mặt nạ mặc định bằng
//      CSS thuần; JS chỉ tinh chỉnh (gỡ khi không tràn, đổi bên khi cuộn).
//   2. Tab ĐANG CHỌN tự vào giữa thanh khi tải trang (tab cuối "Khiếu nại & lịch sử" nằm ngoài màn nếu không). CHỈ gán `scrollLeft` của thanh — `scrollIntoView` cuộn cả TRANG theo chiều dọc.
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export function CuonTabNav({ className, children, ...rest }: React.ComponentProps<"nav">) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const capNhat = () => {
      const tran = nav.scrollWidth - nav.clientWidth > 1;
      const trai = tran && nav.scrollLeft > 1;
      const phai = tran && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
      nav.setAttribute("data-mask", trai && phai ? "ca-hai" : trai ? "trai" : phai ? "phai" : "khong");
    };

    const chon = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (chon && nav.scrollWidth - nav.clientWidth > 1) {
      const n = nav.getBoundingClientRect();
      const t = chon.getBoundingClientRect();
      const trongMan = t.left >= n.left && t.right <= n.right;
      if (!trongMan) {
        const dich = nav.scrollLeft + (t.left - n.left) - (nav.clientWidth - t.width) / 2;
        nav.scrollLeft = Math.min(Math.max(0, dich), nav.scrollWidth - nav.clientWidth);
      }
    }
    capNhat();

    nav.addEventListener("scroll", capNhat, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(capNhat);
    ro?.observe(nav);
    return () => {
      nav.removeEventListener("scroll", capNhat);
      ro?.disconnect();
    };
  }, []);

  return (
    <nav
      ref={ref}
      {...rest}
      className={cn(
        "flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // Mặt nạ 2rem ở mép còn nội dung. Mặc định (chưa hydrate) chỉ điện thoại — luôn tràn; `data-mask` (JS đo) THẮNG vì bộ chọn thuộc tính đặc hiệu hơn media query.
        // ⚠️ Mỗi lớp viết NGUYÊN VĂN: Tailwind quét chuỗi tĩnh, ghép bằng template là lớp không được sinh ra.
        "max-md:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]",
        "data-[mask=phai]:[mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)]",
        "data-[mask=trai]:[mask-image:linear-gradient(to_left,#000_calc(100%_-_2rem),transparent)]",
        "data-[mask=ca-hai]:[mask-image:linear-gradient(to_right,transparent,#000_2rem,#000_calc(100%_-_2rem),transparent)]",
        "data-[mask=khong]:[mask-image:none]",
        className,
      )}
    >
      {children}
    </nav>
  );
}
