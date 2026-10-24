"use client";

// components/admin/nguon-hoa-hong/affiliate/sao-chep-link.tsx — nút «Link» của một đối tác: sao chép link giới thiệu ĐANG DÙNG của họ, hoặc dẫn sang tab «Link / QR / Mã» để tạo.
//
// KHÔNG dựng link ở đây (AFF-WEB). Bản cũ ghép `<gốc cứng>/?ref=<mã>` — một tên miền cứng gán cho mọi đối tác, mà link giới thiệu thật nay trỏ về website + trang đích do Admin khai.
// Nút nhận NGUYÊN ĐỊA CHỈ đã dựng ở tầng đọc (`docLinkDangDungTheoDoiTac` → URL cuối của link, đã qua cùng cổng hợp lệ với lúc khách bấm):
//  · `urlCuoi`  ⇒ nút sao chép (có link ĐANG DÙNG ĐƯỢC);
//  · `hrefTao`  ⇒ nút dẫn sang tab tạo link (chưa có link dùng được, người xem được phát link);
//  · không có gì ⇒ KHÔNG vẽ gì: một nút sao chép không có gì để sao chép là lời hứa suông (luật 12).
// Địa chỉ mang token của đối tác, nên nơi gọi chỉ truyền `urlCuoi` khi người xem có `affiliate_links:manage` — ở tầng đọc, không ở đây.
import Link from "next/link";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, NUT_NHO } from "../classes";

export function SaoChepLink({ tenDoiTac, urlCuoi, hrefTao, className }: { tenDoiTac: string; urlCuoi: string | null; hrefTao: string | null; className?: string }) {
  async function chep(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(`Đã sao chép link: ${link}`);
    } catch {
      toast.error(`Không sao chép được — hãy sao chép thủ công: ${link}`);
    }
  }
  if (urlCuoi !== null) {
    return (
      <button
        type="button"
        onClick={() => void chep(urlCuoi)}
        aria-label={`Sao chép link giới thiệu của ${tenDoiTac}`}
        title="Sao chép link giới thiệu đang dùng (URL cuối)"
        className={cn(BTN_OUTLINE, NUT_NHO, "px-2", className)}
      >
        <Copy aria-hidden className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">Link</span>
      </button>
    );
  }
  if (hrefTao !== null) {
    return (
      <Link
        href={hrefTao}
        aria-label={`Tạo link giới thiệu cho ${tenDoiTac}`}
        title="Chưa có link — mở tab Link / QR / Mã để tạo"
        className={cn(BTN_OUTLINE, NUT_NHO, "px-2", className)}
      >
        <Link2 aria-hidden className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">Tạo link</span>
      </Link>
    );
  }
  return null;
}
