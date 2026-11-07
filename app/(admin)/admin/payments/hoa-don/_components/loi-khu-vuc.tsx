"use client";

// Trạng thái LỖI dùng chung cho các trang con của khu Hoá đơn (S5b, DESIGN.md §5): nói rõ màn nào hỏng, có đường
// thử lại, in `digest` để người dùng đọc cho kỹ thuật. `error.tsx` của từng trang chỉ truyền tiêu đề + câu mô tả —
// trước đây mọi trang con (kể cả Cấu hình) cùng rơi vào câu "không tải được danh sách hoá đơn" của bàn chứng từ.
// Vì `error.tsx` nằm DƯỚI layout, tiêu đề / thanh tab / thanh phạm vi vẫn còn nguyên khi trang lỗi: bấm tab khác để thoát.
import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/admin/ui/states";

export function LoiKhuVuc({
  error,
  reset,
  tieuDe,
  moTa,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  tieuDe: string;
  moTa: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={tieuDe}
      description={
        <>
          <p>{moTa}</p>
          {error.digest ? (
            <p className="mt-2">
              Mã lỗi:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{error.digest}</code>
            </p>
          ) : null}
        </>
      }
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" onClick={reset}>
            Thử lại
          </Button>
          <Link href="/payments" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Về màn Thanh toán
          </Link>
        </div>
      }
    />
  );
}
