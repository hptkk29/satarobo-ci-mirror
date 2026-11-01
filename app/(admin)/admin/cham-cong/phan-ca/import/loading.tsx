// app/(admin)/admin/cham-cong/phan-ca/import/loading.tsx — hình của màn import khi dữ liệu chưa về.
//
// Vì sao file này tồn tại: page đọc danh sách nhân sự + 5 dòng nhật ký trước khi vẽ, nên vào màn là
// trắng vài trăm ms. Skeleton mang ĐÚNG hình: tiêu đề → hàng tab module → ba bước → thẻ chọn file.
//
// Thứ tự phải khớp trang thật (`page.tsx`: PageHeader → ModuleNav → PageHelp → ImportWizard, mà
// Stepper là thứ đầu tiên trong ImportWizard). Bỏ hai khối trên cùng là khi dữ liệu về, chỉ báo ba
// bước nhảy xuống cả một khối ~90-140px.
import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton } from "@/components/admin/cham-cong/skeletons";
import { Stepper } from "./_components/stepper";

export default function Loading() {
  return (
    <div className="max-w-6xl">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="mb-4 h-10 w-full rounded-none" />
      <Stepper
        items={[
          { label: "1. Đọc file", state: "current" },
          { label: "2. Ánh xạ & phạm vi", state: "todo" },
          { label: "3. Kết quả", state: "todo" },
        ]}
      />
      <FormSkeleton fields={3} />
    </div>
  );
}
