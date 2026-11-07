"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

/**
 * DISC N2 — ngoại lệ có chủ đích cho phụ huynh CHƯA có học viên.
 *
 * Layout portal thay THÂN bằng «chưa liên kết học viên» khi `children_.length === 0` (page gọi
 * `requireActiveStudent` → redirect ⇒ không được render). Phụ huynh tạo bởi luồng nhận DISC chưa có học
 * viên nào nên không mở được `/portal/disc`. Ở đây: `choPhepDisc` (cờ DISC bật ∧ PARENT, do layout tính
 * ở SERVER) + đoạn đầu của URL dưới `/portal` là `disc` ⇒ render page; mọi đoạn khác ⇒ thông báo như cũ.
 *
 * Vì sao client: layout portal KHÔNG render lại khi điều hướng mềm, nên chọn theo đường dẫn ở server sẽ
 * kẹt ở thông báo khi bấm menu DISC. `useSelectedLayoutSegment` đọc theo cây route đã rewrite
 * (`/disc` trên host portal ⇒ đoạn `disc`).
 */
export function duocXemKhiChuaCoCon(doanDau: string | null, choPhepDisc: boolean): boolean {
  return choPhepDisc && doanDau === "disc";
}

export function KhungChuaLienKet({
  choPhepDisc,
  thongBao,
  children,
}: {
  choPhepDisc: boolean;
  thongBao: ReactNode;
  children: ReactNode;
}) {
  const doanDau = useSelectedLayoutSegment();
  return <>{duocXemKhiChuaCoCon(doanDau, choPhepDisc) ? children : thongBao}</>;
}
