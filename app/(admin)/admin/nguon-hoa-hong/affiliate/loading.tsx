// Khung chờ đúng HÌNH của tab "Affiliate" (DESIGN.md §5: skeleton, không spinner giữa màn).
import { KhungSkeleton } from "@/components/admin/nguon-hoa-hong/skeletons";

export default function Loading() {
  return <KhungSkeleton nhan="affiliate" cot={8} dong={6} congTac={false} />;
}
