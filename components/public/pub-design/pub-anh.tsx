"use client";

import Image, { type ImageProps } from "next/image";
import { KICH_THUOC_ANH } from "./pub-anh-kich-thuoc";
import { ANH_KHOA_HOC } from "@/components/public/khoa-hoc/anh-khoa-hoc";
import { useGhiDeAnh } from "./pub-anh-ghi-de";

/**
 * Ảnh của giao diện public — MỘT cách nhúng cho mọi trang (chống ảnh mờ).
 *
 * Quy tắc (xem docs/public-redesign/NEN-PUBLIC-V2.md):
 *  1. `sizes` BẮT BUỘC (kiểu TS), ghi ĐÚNG bề rộng hiển thị theo CSS (vd `"(max-width: 860px) 100vw, 600px"`).
 *     Thiếu `sizes` thì next/image chỉ sinh srcset 1x/2x theo `width` và ở DPR1 trình duyệt chọn bản 1x rất nhỏ ⇒ mờ.
 *  2. `quality` mặc định 85 (mặc định của next/image là 75; được phép: 75 · 85 · 90 trong `next.config.ts`).
 *  3. width/height lấy từ kích thước THẬT của tệp (`pub-anh-kich-thuoc.ts`, sinh từ dims.json) — KHÔNG gõ tay.
 *  4. Ảnh trên màn hình đầu (LCP) truyền `priority`.
 *
 * ẢNH THAY TỪ ADMIN (04/11/2026): nếu admin/marketing đã thay ảnh này ở `/site-content/anh-public` thì `src` là ảnh mới (đã cắt
 * đúng tỉ lệ ô ở trình duyệt, nằm trên CDN), còn `width`/`height` VẪN là của ô — khung trang không đổi dù ảnh thay có cỡ nào.
 * Đây là component client (đọc context do `PubRoot` thả xuống); props truyền từ server component vẫn phải tuần tự hoá được
 * (đừng truyền hàm `onLoad`… từ server component).
 */
export type PubAnhProps = Omit<ImageProps, "src" | "width" | "height" | "sizes" | "alt"> & {
  /** Mã ảnh của artifact (tên tệp trong `public/pub`, không đuôi), vd `"659c303937fe76b0d2be11b04c59889e"`. */
  id: string;
  alt: string;
  sizes: string;
};

export function PubAnh({ id, alt, sizes, quality = 85, ...rest }: PubAnhProps) {
  const ghiDe = useGhiDeAnh(id);
  const k = KICH_THUOC_ANH[id];
  if (!k) {
    // Mười hai blob của artifact CHỈ nằm ở public/images/khoa-hoc (không có trong public/pub, artifact cũng không có tệp lớn hơn —
    // xem docs/public-redesign/ANH-DO-PHAN-GIAI.md). Linh vật của trang đăng nhập / DISC / chính sách dùng vài mã trong số đó.
    const a = ANH_KHOA_HOC[id];
    if (!a) throw new Error(`PubAnh: không có ảnh "${id}" trong public/pub lẫn public/images/khoa-hoc (chạy lại genanh.mjs sau khi thêm ảnh)`);
    return <Image src={ghiDe?.url ?? `/images/khoa-hoc/${id}.${a.ext}`} width={a.w} height={a.h} alt={alt} sizes={sizes} quality={quality} {...rest} />;
  }
  return <Image src={ghiDe?.url ?? `/pub/${id}.${k[2]}`} width={k[0]} height={k[1]} alt={alt} sizes={sizes} quality={quality} {...rest} />;
}
