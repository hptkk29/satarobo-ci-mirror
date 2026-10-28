import { HonorCard } from "./honor-card";
import type { HonorWithEmployee } from "@/lib/honors/honor-view";

interface HonorMasonryGridProps {
  honors: HonorWithEmployee[];
}

// Masonry-style staggered grid dùng CSS columns — đơn giản và responsive.
// Items dài/ngắn khác nhau tự nhiên xếp gọn theo cột.
export function HonorMasonryGrid({ honors }: HonorMasonryGridProps) {
  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 gap-6 space-y-6">
      {honors.map((honor, idx) => (
        <div key={honor.id} className="break-inside-avoid">
          {/* Alternate tall/compact for visual interest */}
          <HonorCard honor={honor} variant={idx % 3 === 0 ? "tall" : "compact"} />
        </div>
      ))}
    </div>
  );
}
