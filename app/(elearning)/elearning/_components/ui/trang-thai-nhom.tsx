import { cn } from "@/lib/utils";
import {
  LOP_CHAM,
  LOP_CHU,
  nhomCoMat,
  type NhomMau,
} from "@/lib/elearning/nhom-mau-trang-thai";

/**
 * Chấm màu + chữ của một trạng thái. Màu KHÔNG BAO GIỜ đứng một mình (luật 12, DESIGN.md §3): luôn kèm nhãn chữ —
 * chấm chỉ là điểm nhấn, người dùng mù màu vẫn đọc được trạng thái.
 */
export function ChamTrangThai({
  nhom,
  nhan,
  className,
}: {
  nhom: NhomMau;
  nhan: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] leading-[18px]", LOP_CHU[nhom], className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", LOP_CHAM[nhom])} />
      {nhan}
    </span>
  );
}

/**
 * Chấm màu THUẦN cho dòng gọn trên điện thoại: chỉ còn chấm, nên nhãn chữ chuyển thành `sr-only` (trình đọc màn hình vẫn
 * nghe "Trễ hạn"); người nhìn đối chiếu chấm với chú thích màu ở đầu danh sách.
 */
export function ChamMau({ nhom, nhan, className }: { nhom: NhomMau; nhan: string; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0", className)}>
      <span aria-hidden className={cn("size-2.5 rounded-full", LOP_CHAM[nhom])} />
      <span className="sr-only">{nhan}</span>
    </span>
  );
}

/**
 * Chú thích màu ở đầu danh sách gọn trên điện thoại: mỗi dòng chỉ còn chấm, nên phải có chỗ giải nghĩa chấm. Chỉ liệt
 * kê nhóm CÓ MẶT trong danh sách (một chú thích kể màu không xuất hiện là nhiễu).
 */
export function ChuThichTrangThai({
  cac,
  className,
}: {
  /** Nhóm màu của MỌI dòng đang hiển thị (có thể trùng). */
  cac: readonly NhomMau[];
  className?: string;
}) {
  const co = nhomCoMat(cac);
  if (co.length === 0) return null;
  return (
    <ul
      aria-label="Chú thích màu trạng thái"
      className={cn(
        "flex list-none flex-wrap gap-x-3.5 gap-y-1.5 rounded-[10px] bg-muted px-3 py-2.5 text-xs leading-4 text-muted-foreground",
        className,
      )}
    >
      {co.map((n) => (
        <li key={n.id} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", LOP_CHAM[n.id])} />
          {n.nhan}
        </li>
      ))}
    </ul>
  );
}
