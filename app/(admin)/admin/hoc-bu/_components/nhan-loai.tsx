import { StatusPill } from "@/components/admin/ui/status-pill";
import { NHAN_LOAI, type LoaiBuVuot } from "@/lib/hoc-bu/loai-bu-vuot";

// Nhãn "Học bù" / "Học vượt" dùng chung cho bảng Cần bù, danh sách case và chi tiết case (17/11/2026). Màu + CHỮ (không chỉ màu) để đọc được cả khi in / người mù màu.
export function NhanLoai({ loai }: { loai: LoaiBuVuot }) {
  return <StatusPill tone={loai === "VUOT" ? "info" : "muted"}>{NHAN_LOAI[loai]}</StatusPill>;
}
