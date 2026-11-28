import Image from "next/image";
import type { CSSProperties } from "react";
import { ANH_KHOA_HOC } from "./anh-khoa-hoc";

type Props = {
  /** Mã ảnh (tên tệp không đuôi) trong public/images/khoa-hoc. */
  h: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  loading?: "lazy" | "eager";
  priority?: boolean;
  /** BẮT BUỘC, ghi ĐÚNG bề rộng hiển thị theo CSS (xem docs/public-redesign/NEN-PUBLIC-V2.md §4c). */
  sizes: string;
  quality?: 75 | 85 | 90;
  "aria-hidden"?: boolean | "true" | "false";
  decoding?: "async" | "auto" | "sync";
};

/**
 * Ảnh của các trang khoá học — cùng quy tắc với `PubAnh` (components/public/pub-design/pub-anh.tsx):
 * `sizes` bắt buộc, quality mặc định 85, width/height là kích thước THẬT của tệp (đo từ public/images/khoa-hoc).
 */
export function Anh({ h, alt = "", className, style, loading, priority, sizes, quality = 85, decoding, ...rest }: Props) {
  const a = ANH_KHOA_HOC[h];
  if (!a) throw new Error(`Anh: không có ảnh "${h}" trong public/images/khoa-hoc`);
  return (
    <Image
      src={`/images/khoa-hoc/${h}.${a.ext}`}
      width={a.w}
      height={a.h}
      alt={alt}
      className={className}
      style={style}
      loading={priority ? undefined : loading}
      priority={priority}
      sizes={sizes}
      quality={quality}
      decoding={decoding}
      aria-hidden={rest["aria-hidden"]}
    />
  );
}
