// components/admin/nguon-hoa-hong/hang-cho-rong.tsx — HÀNG CHỜ RỖNG = TRẠNG THÁI THÀNH CÔNG (06 §6).
//
// Mỗi tab mở ra ở hàng chờ, nên "rỗng" là kết quả TỐT NHẤT của màn — không phải "không có dữ liệu". Vì vậy không
// dùng `EmptyState` chung (dấu "i" xám nói "chưa có gì"): ở đây là dấu ✓ màu thành công + câu nói đúng phạm vi vừa
// được dọn sạch + đường sang danh sách đầy đủ. Không minh hoạ.
import Link from "next/link";
import { CircleCheck } from "lucide-react";

export function HangChoRong({
  tieuDe,
  moTa,
  hrefTiep,
  nhanTiep,
}: {
  /** Câu in đậm: "Không còn lead nào cần xử lý nguồn". */
  tieuDe: string;
  /**
   * Một câu NÓI ĐÚNG điều vừa sạch. Người gọi viết, không có khuôn chung: bộ lọc theo MỘT lý do mà rỗng thì
   * KHÔNG được nói "mọi lead đều đủ căn cứ" (các lý do khác vẫn còn việc) — khuôn chung sẽ nói dối ở ca đó.
   */
  moTa: string;
  hrefTiep: string;
  nhanTiep: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-state-success-soft text-state-success-ink">
        <CircleCheck aria-hidden className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-foreground">{tieuDe}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{moTa}</p>
      <Link href={hrefTiep} className="mt-4 text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        {nhanTiep}
      </Link>
    </div>
  );
}
