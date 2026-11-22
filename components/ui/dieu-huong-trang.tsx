"use client";

// THANH ĐIỀU HƯỚNG TRANG — Đầu · Trước · 4 [5] 6 · Sau · Cuối.
//
// BẢN CLIENT — cho bảng cắt trang ở client (`PhanTrangBang`, `BangPhanTrang`): truyền
// `onDoi`, mỗi nút là `<button>`.
//
// Cắt ở DB, điều hướng bằng URL (`/admin/students`…) thì dùng `DieuHuongTrangLink` —
// SERVER component, mỗi nút là `<Link>` thật. Xem ghi chú ở file đó về lý do phải tách.

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { LOP_NUT as NUT, LOP_NUT_DANG_XEM as NUT_DANG_XEM, NGAN, dayTrang } from "@/lib/ui/day-trang";
import { cn } from "@/lib/utils";

export function DieuHuongTrang({
  trang,
  soTrang,
  onDoi,
  className,
}: {
  trang: number;
  soTrang: number;
  /**
   * ⚠️ CỐ Ý KHÔNG có `hrefCua` ở bản client. Truyền hàm từ Server Component sang Client
   * Component là Next ném lúc chạy (sự cố 12/08/2026, digest 28380953). Dùng URL thì gọi
   * `DieuHuongTrangLink` — và vì prop này không tồn tại ở đây nữa, `tsc` bắt được ngay.
   */
  onDoi: (trang: number) => void;
  className?: string;
}) {
  if (soTrang <= 1) return null;
  const ht = Math.min(Math.max(1, trang), soTrang);

  function O({
    den,
    tat,
    nhan,
    con,
    dangXem,
  }: {
    den: number;
    tat?: boolean;
    nhan: string;
    con: React.ReactNode;
    dangXem?: boolean;
  }) {
    return (
      <button
        type="button"
        disabled={tat}
        aria-label={nhan}
        aria-current={dangXem ? "page" : undefined}
        onClick={() => !tat && onDoi(den)}
        className={dangXem ? NUT_DANG_XEM : NUT}
      >
        {con}
      </button>
    );
  }

  return (
    <nav aria-label="Điều hướng trang" className={cn("flex flex-wrap items-center gap-1", className)}>
      <O den={1} tat={ht === 1} nhan="Trang đầu" con={<ChevronsLeft className="h-4 w-4" />} />
      <O den={ht - 1} tat={ht === 1} nhan="Trang trước" con={<ChevronLeft className="h-4 w-4" />} />

      {dayTrang(ht, soTrang).map((o, i) =>
        o === NGAN ? (
          <span key={`ngan-${i}`} className="px-1 text-sm text-muted-foreground" aria-hidden>
            {NGAN}
          </span>
        ) : (
          <O key={o} den={o} nhan={`Trang ${o}`} dangXem={o === ht} con={o} />
        ),
      )}

      <O den={ht + 1} tat={ht === soTrang} nhan="Trang sau" con={<ChevronRight className="h-4 w-4" />} />
      <O
        den={soTrang}
        tat={ht === soTrang}
        nhan="Trang cuối"
        con={<ChevronsRight className="h-4 w-4" />}
      />
    </nav>
  );
}
