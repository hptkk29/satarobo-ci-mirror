// Khung chờ của lưới phân ca. Phải mang ĐÚNG hình của màn thật (tiêu đề → hàng tab → thanh phạm
// vi → 5 thẻ số → lưới người × ngày): đổi khối hay đổi tháng ở đây kéo vài trăm ô, không có khung
// chờ thì màn trắng một nhịp rồi nhảy, người dùng tưởng bấm hụt và bấm lại.
//
// Hai khối đầu (PageHeader + ModuleNav) KHÔNG được bỏ: thiếu chúng thì nội dung tụt xuống
// ~90–140px ngay lúc dữ liệu về — đúng cái nhảy mà bộ skeleton này sinh ra để chặn.
import { Skeleton } from "@/components/ui/skeleton";
import { GridSkeleton, KpiSkeleton, ScopeBarSkeleton } from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-[1400px]">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <Skeleton className="mb-4 h-10 w-full max-w-xl rounded-lg" />
      <ScopeBarSkeleton />
      <KpiSkeleton n={5} />
      <GridSkeleton />
    </div>
  );
}
