// Ô NÓI TRƯỚC "mã phiếu gộp của cả nhà sẽ bị huỷ/đóng" — rà vòng 4 (30/09/2026, luật 12).
//
// Dùng chung ở ba màn có thao tác VOID đợt mà trước đây im lặng huỷ mã QR của cả gia đình: miễn
// giảm, thêm con, lưu kế hoạch trả góp. Câu chữ + luật HUỶ/ĐÓNG do `canhBaoTruocVoidDot` (thuần)
// quyết — ô này chỉ VẼ. Mỗi màn tự tính "đợt nào sẽ bị VOID" bằng đúng hàm đường ghi dùng.
//
// Server Component được (không state) — nhưng cả ba chỗ gọi đều là client, nên nó sống trong cây
// client của chúng. Không `"use client"` riêng: không cần.
import { AlertTriangle } from "lucide-react";
import type { CanhBaoTruocPhieu } from "@/lib/finance/soat-phieu-gop";

export function CanhBaoPhieuTruoc({ canhBao }: { canhBao: CanhBaoTruocPhieu | null }) {
  if (!canhBao) return null;
  return (
    // `role="status"`: ô hiện ra theo số người dùng đang gõ / ô đang tick — trình đọc màn hình phải
    // được báo, nhưng không cắt ngang (không phải lỗi).
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-state-warning bg-state-warning-soft px-3 py-2 text-state-warning-ink"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold">{canhBao.tieuDe}</p>
        <p className="text-xs">{canhBao.chiTiet}</p>
      </div>
    </div>
  );
}
