// components/admin/nguon-hoa-hong/link/trang-thai-link-pill.tsx — pill TRẠNG THÁI của một link: Đang hoạt động · Tạm không dùng được · Đã thu hồi. CLIENT-SAFE.
//
// «Đang hoạt động» chỉ khi link thật sự DÙNG ĐƯỢC lúc này. Link còn ACTIVE trong DB mà chuỗi hỏng (campaign tạm dừng, đối tác ngừng, trang đích bị tắt…) hiện «Tạm không dùng được» kèm lý do
// (luật 12: nhãn «hoạt động» cho một link mà khách bấm vào bị từ chối là nhãn nói dối). Bọc `StatusPill`; tông theo thang ngữ nghĩa.
import { StatusPill } from "@/components/admin/ui/status-pill";
import { NHAN_TRANG_THAI_LINK, type TrangThaiLink } from "@/lib/affiliate/ghi-link-dau-vao";
import { cn } from "@/lib/utils";
import { INK_THEO_TONE } from "../trang-thai-nguon-pill";

export function TrangThaiLinkPill({ trangThai, lyDoKhongDung, className }: { trangThai: TrangThaiLink; lyDoKhongDung: string | null; className?: string }) {
  if (trangThai === "REVOKED") {
    return <StatusPill tone="muted" className={cn(INK_THEO_TONE.muted, className)}>{NHAN_TRANG_THAI_LINK.REVOKED}</StatusPill>;
  }
  if (lyDoKhongDung !== null) {
    return (
      <StatusPill tone="warning" className={cn(INK_THEO_TONE.warning, className)}>
        <span title={lyDoKhongDung}>Tạm không dùng được</span>
      </StatusPill>
    );
  }
  return <StatusPill tone="success" className={cn(INK_THEO_TONE.success, className)}>{NHAN_TRANG_THAI_LINK.ACTIVE}</StatusPill>;
}
