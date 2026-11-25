"use client";

import { useSetActiveSite } from "@/components/portal/use-set-active-site";

// Đổi con đang chọn (setActiveSite) rồi mở trang đích (KHÔNG lộ studentId trên
// URL — PHƯƠNG ÁN A). Mặc định mở hồ sơ chi tiết; truyền `href` để vào nơi khác
// theo đúng con vừa chọn (vd Cổng học sinh /portal/hoc-sinh).
export function ChildDetailLink({
  studentId,
  href = "/portal/ho-so-con/chi-tiet",
  errorMessage = "Không mở được hồ sơ con",
  className,
  children,
}: {
  studentId: string;
  href?: string;
  errorMessage?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending, switchTo } = useSetActiveSite();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        switchTo(studentId, {
          onSuccess: (router) => router.push(href),
          errorMessage,
        })
      }
      className={className}
    >
      {children}
    </button>
  );
}
