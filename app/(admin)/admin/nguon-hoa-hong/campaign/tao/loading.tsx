// Khung chờ của biểu mẫu Tạo campaign (đúng hình: tiêu đề + hàng tab + liên kết quay lại + các mục có nhãn và ô).
import { FormNguonSkeleton } from "@/components/admin/nguon-hoa-hong/form-nguon-skeleton";

export default function Loading() {
  return <FormNguonSkeleton nhan="biểu mẫu tạo campaign" />;
}
