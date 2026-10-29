"use client";

// Ranh giới lỗi của cả module (một chỗ ở gốc segment phủ năm tab + chi tiết nguồn). Thân ở
// `components/admin/nguon-hoa-hong/route-error.tsx`. Khung admin (sidebar) vẫn giữ vì nằm trong layout.
import { RouteError } from "@/components/admin/nguon-hoa-hong/route-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} />;
}
