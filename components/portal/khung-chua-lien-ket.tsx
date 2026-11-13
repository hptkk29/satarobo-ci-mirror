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
 * 08/11/2026 — mở rộng cho «Tủ sách gia đình» + «Sức khỏe cả nhà» (gói miễn phí cho tài khoản chưa có bé): layout tính ở SERVER
 * `doanThem` = các đoạn đầu được phép (`tu-sach`, `suc-khoe`) theo cờ của từng trang; cờ tắt ⇒ đoạn đó KHÔNG có trong mảng ⇒ page không chạy.
 * Hai trang này không đọc dữ liệu con nên không cần `requireActiveStudent`.
 *
 * Vì sao client: layout portal KHÔNG render lại khi điều hướng mềm, nên chọn theo đường dẫn ở server sẽ
 * kẹt ở thông báo khi bấm menu DISC. `useSelectedLayoutSegment` đọc theo cây route đã rewrite
 * (`/disc` trên host portal ⇒ đoạn `disc`).
 */
export function duocXemKhiChuaCoCon(doanDau: string | null, choPhepDisc: boolean, doanThem: readonly string[] = []): boolean {
  if (doanDau === null) return false;
  return (choPhepDisc && doanDau === "disc") || doanThem.includes(doanDau);
}

export function KhungChuaLienKet({
  choPhepDisc,
  doanThem = [],
  thongBao,
  children,
}: {
  choPhepDisc: boolean;
  /** Đoạn đầu URL được xem thêm khi chưa có bé (server tính theo cờ). Mặc định rỗng = chỉ DISC. */
  doanThem?: readonly string[];
  thongBao: ReactNode;
  children: ReactNode;
}) {
  const doanDau = useSelectedLayoutSegment();
  return <>{duocXemKhiChuaCoCon(doanDau, choPhepDisc, doanThem) ? children : thongBao}</>;
}
