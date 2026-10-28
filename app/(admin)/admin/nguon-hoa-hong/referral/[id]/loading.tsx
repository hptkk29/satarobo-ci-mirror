// Khung chờ đúng HÌNH của trang chi tiết referral (DESIGN.md §5: skeleton, không spinner giữa màn).
import { KhungSkeleton } from "@/components/admin/nguon-hoa-hong/skeletons";

export default function Loading() {
  return <KhungSkeleton nhan="chi tiết referral" cot={2} dong={6} congTac={false} />;
}
