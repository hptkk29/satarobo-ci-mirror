// Khung chờ đúng HÌNH của tab "Website & trang đích" (DESIGN.md §5: skeleton, không spinner giữa màn).
import { KhungSkeleton } from "@/components/admin/nguon-hoa-hong/skeletons";

export default function Loading() {
  return <KhungSkeleton nhan="website & trang đích" cot={5} dong={6} congTac={false} />;
}
