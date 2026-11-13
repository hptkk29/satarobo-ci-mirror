"use client";

import { Moon, Sun } from "lucide-react";
import { usePortalAppearance } from "@/components/portal/appearance-provider";

// Nút bật/tắt nhanh Sáng ↔ Tối ở topbar. Tinh chỉnh đầy đủ (màu nhấn, chế độ
// "Hệ thống") nằm ở /portal/giao-dien.
//
// Đang ở chế độ "Hệ thống" mà bấm nút → chốt cứng sang chế độ NGƯỢC với hiện tại,
// đúng thứ người dùng nhìn thấy và mong đợi.
export function PortalThemeToggle() {
  const { mounted, isDark, setTheme } = usePortalAppearance();

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={
        isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"
      }
      className="grid size-10 place-items-center rounded-xl text-foreground transition-colors hover:bg-muted"
    >
      {/* Trước khi mount chưa đọc được localStorage → luôn vẽ Sun để khớp SSR. */}
      {mounted && isDark ? (
        <Moon className="size-5" />
      ) : (
        <Sun className="size-5" />
      )}
    </button>
  );
}
