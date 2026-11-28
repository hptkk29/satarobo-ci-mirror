import { ExternalLink } from "lucide-react";

/**
 * Lối đi sang màn dựng ĐỀ THI / KHUNG CHẤM từ trình soạn bài (thiết kế: "Mở Đề thi ↗", "Mở Khung chấm ↗"). Mở TAB MỚI để không bỏ dở bài đang soạn; đích là route
 * thật (`/elearning/de-thi`, `/elearning/khung-cham`) — không vẽ lối đi tới màn chưa có.
 */
export function LienKetMo({ href, nhan }: { href: string; nhan: string }) {
  return (
    <p className="pt-1 text-center">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-9 items-center gap-1.5 rounded px-2 text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {nhan}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">(mở trong tab mới)</span>
      </a>
    </p>
  );
}
