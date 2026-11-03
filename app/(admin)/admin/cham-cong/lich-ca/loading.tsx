// Khung chờ của "Lịch ca của tôi" — giữ nguyên hình: tab cụm "Của tôi" + thanh tháng + bảng 8 cột.
// Không dùng vòng xoay giữa màn: đổi tháng là màn nhảy, người dùng tưởng bấm hụt rồi bấm lại.
import { Skeleton } from "@/components/ui/skeleton";
import { MeNav } from "@/components/admin/cham-cong/me-nav";
import { TableSkeleton } from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <MeNav active="lich-ca" />
      <Skeleton aria-busy aria-label="Đang tải…" className="mb-4 h-12 w-full rounded-xl" />
      <TableSkeleton cols={8} rows={12} />
    </div>
  );
}
