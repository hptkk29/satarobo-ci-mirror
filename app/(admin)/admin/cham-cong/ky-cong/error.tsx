"use client";

// app/(admin)/admin/cham-cong/ky-cong/error.tsx — màn kỳ công vỡ thì nói rõ SỐ ĐÃ CHỐT KHÔNG MẤT.
//
// Vì sao file này tồn tại: lỗi ở đúng màn chốt sổ dễ bị hiểu là "mất sổ lương tháng này". Số đã
// chốt nằm trong `AttendancePeriod.summaryJson`, không phải trong màn — nói câu đó ngay trên màn
// lỗi để không ai đi chốt lại lần hai.
import { RouteError } from "@/components/admin/cham-cong/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      what="kỳ công — số đã chốt không mất"
      backHref="/cham-cong"
      backLabel="Về bảng công ngày"
    />
  );
}
