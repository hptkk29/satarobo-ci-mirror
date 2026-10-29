// components/cham-cong/ho-so-buoi.tsx — HỒ SƠ BUỔI (tuân thủ buổi dạy): nhận lớp · chấm vào · điểm danh học viên · chấm ra · nhận xét.
// Dùng chung Control Tower (QLCS), "Công việc của tôi" (GV) và thẻ Chấm công ⇒ CHỈ token `:root` (site GV không có `.admin-scope`).
// Chữ đến từ MỘT hàm (`nhanTuanThu`) — màn này không tự suy trạng thái (luật 12b). Không có tiền / phạt ở đây.
// Mỗi bước nói bằng CHỮ + biểu tượng (không chỉ màu); lối tắt dẫn tới màn điểm danh / nhận xét ĐÃ CÓ — trang đích tự kiểm quyền.
import Link from "next/link";
import { CircleCheck, Circle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NhanTuanThu, ToneTuanThu } from "@/lib/parttime/nhan-tuan-thu";

const MAU: Record<ToneTuanThu, string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  muted: "text-muted-foreground",
};
const NEN: Record<ToneTuanThu, string> = {
  success: "bg-state-success-soft text-state-success-ink",
  warning: "bg-state-warning-soft text-state-warning-ink",
  danger: "bg-state-danger-soft text-state-danger-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-muted-foreground",
};
const LOI_TAT = "inline-flex min-h-9 items-center rounded-md border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted pointer-coarse:min-h-11";

export function HoSoBuoi({
  n,
  diemDanhHref,
  nhanXetHref,
  gon = false,
}: {
  n: NhanTuanThu;
  diemDanhHref?: string | null;
  nhanXetHref?: string | null;
  /** Một dòng (Control Tower) thay vì danh sách dọc. */
  gon?: boolean;
}) {
  const buocDiemDanh = n.buoc.find((b) => b.ma === "DIEM_DANH");
  const buocNhanXet = n.buoc.find((b) => b.ma === "NHAN_XET");
  return (
    <div className={cn("min-w-0", gon ? "flex flex-wrap items-center gap-x-3 gap-y-1" : "space-y-2")}>
      <ol aria-label="Hồ sơ buổi" className={cn(gon ? "contents" : "space-y-1")}>
        {n.buoc.map((b) => {
          const Icon = b.xong ? CircleCheck : b.tone === "danger" || b.tone === "warning" ? TriangleAlert : Circle;
          return (
            <li key={b.ma} title={b.chiTiet} className={cn("flex min-w-0 items-center gap-1.5 text-xs", gon ? "" : "text-sm", MAU[b.tone])}>
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="sr-only">{b.xong ? "Xong: " : "Chưa xong: "}</span>
              <span className={cn("tabular-nums", b.xong && b.tone === "success" ? "text-foreground" : "")}>{b.nhan}</span>
              <span className="sr-only">. {b.chiTiet}</span>
            </li>
          );
        })}
      </ol>
      <p className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", NEN[n.tong.tone])}>{n.tong.nhan}</p>
      {(diemDanhHref && buocDiemDanh && !buocDiemDanh.xong) || (nhanXetHref && buocNhanXet && !buocNhanXet.xong) ? (
        <div className="flex flex-wrap gap-2">
          {diemDanhHref && buocDiemDanh && !buocDiemDanh.xong && (
            <Link href={diemDanhHref} className={LOI_TAT}>
              Điểm danh lớp
            </Link>
          )}
          {nhanXetHref && buocNhanXet && !buocNhanXet.xong && !buocNhanXet.choBuocTruoc && (
            <Link href={nhanXetHref} className={LOI_TAT}>
              Nhận xét học viên
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
