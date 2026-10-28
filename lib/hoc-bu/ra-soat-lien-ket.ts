// lib/hoc-bu/ra-soat-lien-ket.ts — LIÊN KẾT từ một phát hiện của checker tới màn quản trị đúng. THUẦN (không DB, không React).
//
// Màn "Rà soát dữ liệu" chỉ ĐỌC: mỗi phát hiện chỉ dẫn người quản lý tới chỗ họ tự xử lý bằng giao diện có sẵn (có audit, có kiểm quyền). KHÔNG có nút tự sửa ở đây —
// sửa hàng loạt chỉ đi qua `scripts/hoc-bu-sua-du-lieu.ts` (dry-run + `--expect`) do chủ dự án chạy.
//
// Chỉ trả liên kết khi BIẾT chắc đường dẫn tồn tại: case (`/hoc-bu/case/<id>`) và hồ sơ học viên (`/students/<id>/edit`). Còn lại rơi về tab của màn Học bù — một liên kết
// chung còn hơn một liên kết đoán mò dẫn tới 404 (luật 12: affordance phải nói thật).
import type { Finding } from "@/lib/hoc-bu/toan-ven";

export type LienKet = { href: string; nhan: string };

const DEN_HOC_BU = "/hoc-bu";

export function lienKetPhatHien(f: Finding): LienKet[] {
  const out: LienKet[] = [];
  if (f.thucThe === "MakeupCase") out.push({ href: `${DEN_HOC_BU}/case/${encodeURIComponent(f.id)}`, nhan: "Mở case" });
  const hocVien = f.lienQuan?.hocVien;
  // `students/[id]` KHÔNG có page.tsx — chỉ `students/[id]/edit` (các màn khác cũng link thẳng tới `/edit`).
  if (hocVien) out.push({ href: `/students/${encodeURIComponent(hocVien)}/edit`, nhan: "Hồ sơ học viên" });
  if (out.length === 0) {
    // Dòng cần bù / điểm danh gốc: chưa có đường tới từng dòng — chỉ tới tab chứa nó.
    out.push({ href: f.thucThe === "MakeupNeed" || f.thucThe === "Attendance" ? `${DEN_HOC_BU}?tab=can-bu` : DEN_HOC_BU, nhan: "Màn Học bù" });
  }
  return out;
}
