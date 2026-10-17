"use client";

// Lỗi ở màn Hoá đơn điện tử — nói rõ màn nào hỏng, có đường thử lại và đường về màn Thanh toán
// (màn liền kề của kế toán), in `digest` để người dùng đọc cho kỹ thuật (DESIGN.md §5).
import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/admin/ui/states";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="Không tải được danh sách hoá đơn điện tử"
      description={
        <>
          <p>Máy chủ báo lỗi khi đọc các lần thu. Thử lại; nếu vẫn lỗi, gửi mã dưới đây cho kỹ thuật.</p>
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
