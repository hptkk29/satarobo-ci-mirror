"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approveStatementAction, reopenStatementAction, chotKyHoaHongAction } from "../actions";

export function StatementActions({
  period,
  status,
  // 27/08/2026 — quyền `commission_periods:manage`, tính ở Server Component cha.
  // KHÔNG kiểm quyền tại đây: đây là client, mọi thứ ở đây chỉ là trang trí. Cổng
  // thật nằm trong ba Server Action; prop này chỉ để không vẽ nút bấm không được.
  canChotKy,
}: {
  period: string;
  status: string;
  canChotKy: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(ok);
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  return (
    <div className="flex justify-end gap-2">
      <a
        href={`/api/admin/crm/commission-export?period=${period}`}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        Export Excel
      </a>
      {!canChotKy ? null : status !== "APPROVED" ? (
        <>
          {/* Tính lại kỳ chưa duyệt từ sổ tiền — ghi đè cả kỳ nên bấm nhiều lần vô hại. */}
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => chotKyHoaHongAction(period, `Chốt lại kỳ ${period} qua UI`),
                "Đã tính lại kỳ",
              )
            }
          >
            Tính lại
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => approveStatementAction(period, "Duyệt qua UI"), "Đã duyệt")}
          >
            Duyệt
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => reopenStatementAction(period, "Mở lại qua UI"), "Đã mở lại")}
        >
          Mở lại
        </Button>
      )}
    </div>
  );
}
