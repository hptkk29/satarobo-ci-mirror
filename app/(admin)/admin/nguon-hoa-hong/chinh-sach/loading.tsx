// Khung chờ đúng HÌNH của tab "Chính sách" (DESIGN.md §5: skeleton, không spinner giữa màn).
import { KhungSkeleton } from "@/components/admin/nguon-hoa-hong/skeletons";

export default function Loading() {
  return <KhungSkeleton nhan="chính sách" cot={6} dong={6} congTac={false} />;
}
