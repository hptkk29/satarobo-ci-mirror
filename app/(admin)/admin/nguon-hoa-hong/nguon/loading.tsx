// Khung chờ đúng HÌNH của tab Nguồn: tiêu đề + hàng tab + ScopeBar + công tắc + bảng 44px (DESIGN.md §5).
import { KhungSkeleton } from "@/components/admin/nguon-hoa-hong/skeletons";

export default function Loading() {
  return <KhungSkeleton nhan="nguồn lead" cot={7} dong={8} />;
}
