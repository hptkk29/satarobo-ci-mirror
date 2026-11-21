// app/(admin)/admin/nguon-hoa-hong/nguon/_components/bo-loc-van-de.tsx — chip lọc hàng chờ theo LÝ DO, kèm số.
//
// Lọc trên URL (`?van-de=`), không ở client (06 §3: bộ lọc quan trọng nằm trên URL). Số ở mỗi chip đến từ
// `demHangChoTheoLyDo` — cùng `whereHangCho` với bảng, nên bấm chip nào số dòng khớp số in trên chip (một lead có
// thể vướng nhiều lý do ⇒ tổng các chip có thể lớn hơn "Tất cả"; đó là đúng, không phải lỗi).
import Link from "next/link";
import { CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/admin/nguon-hoa-hong/classes";
import { LY_DO_HANG_CHO, NHAN_LY_DO, type LyDoHangCho } from "@/lib/nguon/doc-hang-cho";
import { hrefVoi, type TruyVan } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

export function BoLocVanDe({
  basePath,
  giu,
  dangChon,
  theoLyDo,
}: {
  basePath: string;
  /** Tham số phải sống sót khi đổi lý do (`coSo`). `trang` KHÔNG giữ: đổi bộ lọc là về trang 1. */
  giu?: TruyVan;
  dangChon: LyDoHangCho | null;
  theoLyDo: Record<LyDoHangCho, number>;
}) {
  const href = (l: LyDoHangCho | null) => hrefVoi(basePath, { ...giu, "van-de": l, trang: null });
  return (
    <nav aria-label="Lọc theo vấn đề" className="flex flex-wrap items-center gap-2">
      <Link href={href(null)} aria-current={dangChon === null ? "page" : undefined} className={cn(CHIP, dangChon === null ? CHIP_ACTIVE : CHIP_IDLE)}>
        Mọi vấn đề
      </Link>
      {LY_DO_HANG_CHO.map((l) => (
        <Link
          key={l}
          href={href(l)}
          aria-current={dangChon === l ? "page" : undefined}
          className={cn(CHIP, dangChon === l ? CHIP_ACTIVE : CHIP_IDLE)}
        >
          {NHAN_LY_DO[l]}
          <span className="tabular-nums">{theoLyDo[l]}</span>
        </Link>
      ))}
    </nav>
  );
}
