"use client";

// Chọn KHUNG theo khu làm việc của đường dẫn hiện tại (xem khu-lam-viec.ts): người học ⇒ KhungNhanVien (thanh trên + thanh
// dưới), trang quản trị ⇒ AppShell (thanh bên). Một người vừa học vừa quản trị (TRAINING, HO_HR, QL cơ sở) có CÔNG TẮC KHU
// ở menu tài khoản của mỗi khung.
//
// ⚠️ Người KHÔNG có mục quản trị nào mà gõ URL quản trị vẫn nhận khung NHÂN VIÊN (không có thanh bên quản trị) — trang tự từ
// chối bằng `can()`. Khung chỉ quyết định VẼ gì; cổng thật vẫn là `can()` ở trang và Server Action.
import { usePathname } from "next/navigation";
import { AppShell } from "./app-shell";
import { KhungNhanVien, dongVaiTro, type ThongTinNguoi } from "./khung-nhan-vien";
import { khuCuaDuongDan } from "./khu-lam-viec";
import type { KhuMenu } from "./menu";

export function KhungTheoKhu({
  userId,
  userName,
  nguoi,
  phamVi,
  khu,
  children,
}: {
  userId: string;
  userName: string;
  /** Dòng phụ dưới tên (thiết kế: "Giáo viên · CS2") — chỉ khung nhân viên dùng. */
  nguoi?: ThongTinNguoi;
  /** "Phạm vi dữ liệu" ở đáy thanh bên quản trị — suy từ QUYỀN ở layout. */
  phamVi?: string;
  khu: KhuMenu[];
  children: React.ReactNode;
}) {
  const duongDan = usePathname() ?? "/elearning";
  const khuQuanTri = khu.filter((k) => k.id !== "hoc-tap");
  const diemVaoQuanTri = khuQuanTri[0]?.muc[0]?.href;

  if (khuCuaDuongDan(duongDan) === "quan-tri" && khuQuanTri.length > 0) {
    return (
      <AppShell
        userId={userId}
        userName={userName}
        vaiTro={dongVaiTro(nguoi)}
        phamVi={phamVi}
        khu={khuQuanTri}
        chuyenKhu={{ href: "/elearning", nhan: "Sang khu Học tập" }}
      >
        {children}
      </AppShell>
    );
  }
  return (
    <KhungNhanVien
      userId={userId}
      userName={userName}
      nguoi={nguoi}
      khu={khu}
      chuyenKhu={diemVaoQuanTri ? { href: diemVaoQuanTri, nhan: "Sang khu Quản trị" } : undefined}
    >
      {children}
    </KhungNhanVien>
  );
}
