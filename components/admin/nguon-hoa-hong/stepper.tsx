"use client";

// components/admin/nguon-hoa-hong/stepper.tsx — THANH BƯỚC của builder chính sách (06 §5.2): nằm ngang ở trên, bấm lùi tự do,
// đi tiến chỉ khi bước hiện tại hợp lệ (luật nằm ở NƠI GỌI qua `choPhepDen` — thanh bước không tự quyết hợp lệ là gì).
//
// Số thứ tự CÓ mang thông tin (đây là một quy trình có thứ tự, không phải "section number" trang trí), nên giữ.
// Bước có lỗi hiện dấu chấm than + chữ "có lỗi" cho trình đọc màn hình — màu không phải nghĩa duy nhất (PRODUCT.md).
// Nút bước ≥ 44px chiều cao vùng chạm (tablet). Cuộn ngang khi hẹp, bước đang đứng luôn được cuộn vào tầm nhìn.
import { useEffect, useRef } from "react";
import { Check, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

export type BuocStepper = { khoa: string; nhan: string };

export function Stepper<K extends string>({
  buoc,
  dangO,
  daXong,
  coLoi,
  onChon,
  khoa,
}: {
  buoc: readonly { khoa: K; nhan: string }[];
  dangO: K;
  /** Bước đã đi qua và hợp lệ. */
  daXong: ReadonlySet<K>;
  /** Bước đang mang lỗi hiển thị. */
  coLoi: ReadonlySet<K>;
  onChon: (khoa: K) => void;
  /** Khoá cả thanh (chế độ chỉ đọc không cần đi bước, nhưng vẫn cho xem từng bước). */
  khoa?: boolean;
}) {
  const hienTai = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    hienTai.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [dangO]);

  return (
    <nav aria-label="Các bước soạn chính sách" className="relative mb-5 overflow-x-auto">
      <ol className="flex min-w-max items-stretch gap-1">
        {buoc.map((b, i) => {
          const dang = b.khoa === dangO;
          const xong = daXong.has(b.khoa);
          const loi = coLoi.has(b.khoa);
          return (
            <li key={b.khoa} className="flex">
              <button
                type="button"
                ref={dang ? hienTai : undefined}
                onClick={() => onChon(b.khoa)}
                disabled={khoa}
                aria-current={dang ? "step" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  dang ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  loi && !dang && "border-state-danger-ink/50 text-state-danger-ink",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    dang ? "bg-primary text-primary-foreground" : xong ? "bg-state-success-soft text-state-success-ink" : loi ? "bg-state-danger-soft text-state-danger-ink" : "bg-muted text-muted-foreground",
                  )}
                >
                  {loi && !dang ? <TriangleAlert className="h-3 w-3" /> : xong && !dang ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {b.nhan}
                {loi && <span className="sr-only"> — có lỗi cần sửa</span>}
                {xong && !loi && !dang && <span className="sr-only"> — đã xong</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
