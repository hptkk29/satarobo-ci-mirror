"use client";

// Ranh giới lỗi của MÀN CHI TIẾT hồ sơ (không phủ /cau-hinh, /ket-noi). Không in nội dung lỗi (có thể kèm giá trị cột = PII).
import { ErrorState } from "@/components/admin/ui/states";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Không hiển thị được hồ sơ"
      description="Có lỗi khi hiển thị hồ sơ này. Bấm «Thử lại»; nếu vẫn lỗi, báo bộ phận kỹ thuật."
      action={
        <button type="button" onClick={reset} className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 sm:h-10">
          Thử lại
        </button>
      }
    />
  );
}
