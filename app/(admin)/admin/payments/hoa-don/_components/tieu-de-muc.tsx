// Đầu NỘI DUNG của một trang trong khu Hoá đơn (S5b). <h1> thuộc về layout ("Hoá đơn điện tử"); trang chỉ có mô tả
// ngắn (+ tiêu đề mục <h2> khi trang không tự nói được mình là gì) và lối sang trang phụ. Server-safe, không state.
// `[&_a]:…` ở vùng hành động: liên kết phụ thấp 18–20px (WCAG 2.5.8 đòi ≥ 24px; 44px khi cảm ứng) — đặt ở khung chứa để mọi lối vào phụ hưởng chung.
import type { ReactNode } from "react";

export function TieuDeMuc({ tieuDe, moTa, hanhDong }: { tieuDe?: string; moTa: ReactNode; hanhDong?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {tieuDe ? <h2 className="text-base font-semibold text-foreground">{tieuDe}</h2> : null}
        <p className="text-sm text-muted-foreground">{moTa}</p>
      </div>
      {hanhDong ? <div className="flex flex-wrap items-center gap-3 sm:shrink-0 [&_a]:inline-flex [&_a]:min-h-6 [&_a]:items-center [&_a]:pointer-coarse:min-h-11">{hanhDong}</div> : null}
    </div>
  );
}
