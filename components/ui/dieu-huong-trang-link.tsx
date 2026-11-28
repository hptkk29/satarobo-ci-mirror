// THANH TRANG BẢN <Link> — SERVER COMPONENT, cố ý KHÔNG có "use client".
//
// Vì sao tách khỏi `dieu-huong-trang.tsx`:
//   · Bản URL không cần một dòng JS nào — nó chỉ là mấy cái `<Link>`. Bắt nó thành client
//     component là gửi JS xuống trình duyệt cho việc trình duyệt vốn tự làm được.
//   · QUAN TRỌNG HƠN: `hrefCua` là một HÀM. Truyền hàm từ Server Component sang Client
//     Component thì Next ném lúc CHẠY — "Functions cannot be passed directly to Client
//     Components" (sự cố 12/08/2026, digest 28380953). Ở đây hàm được gọi NGAY TRONG lượt
//     render server nên không có ranh giới nào để vượt.
//
// Nhờ tách đôi, bản client (`DieuHuongTrang`) KHÔNG còn nhận `hrefCua` nữa ⇒ truyền nhầm
// là `tsc` báo đỏ, không phải người dùng phát hiện. Đó mới là chỗ vá thật của sự cố này.

import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { LOP_NUT, LOP_NUT_DANG_XEM, NGAN, dayTrang } from "@/lib/ui/day-trang";
import { cn } from "@/lib/utils";

export function DieuHuongTrangLink({
  trang,
  soTrang,
  hrefCua,
  className,
}: {
  trang: number;
  soTrang: number;
  hrefCua: (trang: number) => string;
  className?: string;
}) {
  if (soTrang <= 1) return null;
  const ht = Math.min(Math.max(1, trang), soTrang);

  // Nút ở BIÊN phải là <button disabled>, KHÔNG phải <Link> mờ đi: Link mờ vẫn bấm được
  // và vẫn điều hướng.
  const Tat = ({ nhan, con }: { nhan: string; con: React.ReactNode }) => (
    <button type="button" disabled aria-label={nhan} className={LOP_NUT}>
      {con}
    </button>
  );

  return (
    <nav aria-label="Điều hướng trang" className={cn("flex flex-wrap items-center gap-1", className)}>
      {ht === 1 ? (
        <>
          <Tat nhan="Trang đầu" con={<ChevronsLeft className="h-4 w-4" />} />
          <Tat nhan="Trang trước" con={<ChevronLeft className="h-4 w-4" />} />
        </>
      ) : (
        <>
          <Link href={hrefCua(1)} aria-label="Trang đầu" className={LOP_NUT}>
            <ChevronsLeft className="h-4 w-4" />
          </Link>
          <Link href={hrefCua(ht - 1)} aria-label="Trang trước" className={LOP_NUT}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </>
      )}

      {dayTrang(ht, soTrang).map((o, i) =>
        o === NGAN ? (
          <span key={`ngan-${i}`} className="px-1 text-sm text-muted-foreground" aria-hidden>
            {NGAN}
          </span>
        ) : o === ht ? (
          <span key={o} aria-label={`Trang ${o}`} aria-current="page" className={LOP_NUT_DANG_XEM}>
            {o}
          </span>
        ) : (
          <Link key={o} href={hrefCua(o)} aria-label={`Trang ${o}`} className={LOP_NUT}>
            {o}
          </Link>
        ),
      )}

      {ht === soTrang ? (
        <>
          <Tat nhan="Trang sau" con={<ChevronRight className="h-4 w-4" />} />
          <Tat nhan="Trang cuối" con={<ChevronsRight className="h-4 w-4" />} />
        </>
      ) : (
        <>
          <Link href={hrefCua(ht + 1)} aria-label="Trang sau" className={LOP_NUT}>
            <ChevronRight className="h-4 w-4" />
          </Link>
          <Link href={hrefCua(soTrang)} aria-label="Trang cuối" className={LOP_NUT}>
            <ChevronsRight className="h-4 w-4" />
          </Link>
        </>
      )}
    </nav>
  );
}
