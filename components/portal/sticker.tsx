import Image from "next/image";
import { cn } from "@/lib/utils";
import { STICKER, type TenSticker } from "@/components/portal/sticker-kich-thuoc";

// Sticker robot của Cổng phụ huynh + Cổng học sinh (04/11/2026) — thay icon robot vẽ tay (`RobotMat`) và các icon minh hoạ ở khối «trống».
// Ảnh nằm ở public/portal/sticker/<tên>.webp (WebP trong suốt, ≤40KB mỗi ảnh); kích thước thật lấy từ `STICKER` (sinh tự động) nên
// `width/height` luôn đúng tỉ lệ ⇒ không nhảy bố cục. Là hình TRANG TRÍ: `alt=""` + `aria-hidden`, không bắt chuột/kéo.

export type { TenSticker };

/** `cao` = chiều cao hiển thị (px); chiều rộng suy ra theo tỉ lệ ảnh. */
export function Sticker({ ten, cao = 96, className, uuTien = false }: { ten: TenSticker; cao?: number; className?: string; uuTien?: boolean }) {
  const k = STICKER[ten];
  return (
    <Image
      src={`/portal/sticker/${ten}.webp`}
      alt=""
      aria-hidden="true"
      width={Math.round((cao * k.w) / k.h)}
      height={cao}
      priority={uuTien}
      draggable={false}
      className={cn("pointer-events-none shrink-0 select-none object-contain", className)}
    />
  );
}

/** Khung «chưa có gì»: sticker ở trên, câu chữ ở dưới, căn giữa. Chữ giữ nguyên là nội dung của khung (test/đọc màn hình vẫn thấy). */
export function NoiDungTrong({ ten, cao = 84, className, children }: { ten: TenSticker; cao?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 text-center", className)}>
      <Sticker ten={ten} cao={cao} />
      <div>{children}</div>
    </div>
  );
}
