// Khung chờ đúng HÌNH của tab "Sổ hoa hồng" (DESIGN.md §5: skeleton, không spinner giữa màn): hàng tab + ScopeBar + công tắc + bảng dày.
import { KhungSkeleton } from "@/components/admin/nguon-hoa-hong/skeletons";

export default function Loading() {
  return <KhungSkeleton nhan="sổ hoa hồng" cot={10} dong={8} />;
}
