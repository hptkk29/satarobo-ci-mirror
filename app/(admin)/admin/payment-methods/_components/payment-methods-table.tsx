"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PaymentMethod, PaymentMethodType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { togglePaymentMethodActiveAction } from "../_actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

const TYPE_LABEL: Record<PaymentMethodType, string> = {
  CASH: "Tiền mặt",
  BANK_TRANSFER: "Chuyển khoản",
  VNPAY: "VNPAY",
  TINGEE: "Tingee",
  COD: "COD",
  WALLET: "Ví điện tử",
};

export function PaymentMethodsTable({
  methods,
  centerNames,
}: {
  methods: PaymentMethod[];
  /** id cơ sở → tên, để cột "Cơ sở" khỏi in ra cuid. */
  centerNames: Record<string, string>;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmTarget, setConfirmTarget] = useState<PaymentMethod | null>(
    null,
  );

  function onConfirm() {
    if (!confirmTarget) return;
    const id = confirmTarget.id;
    const wasActive = confirmTarget.isActive;
    startTransition(async () => {
      const result = await togglePaymentMethodActiveAction(id);
      if (result.ok) {
        toast.success(wasActive ? "Đã vô hiệu hoá" : "Đã kích hoạt");
        setConfirmTarget(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Thứ tự</TableHead>
                <TableHead>Mã</TableHead>
                <TableHead>Tên</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Cơ sở</TableHead>
                <TableHead>Cho phép</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {methods.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Chưa có phương thức nào
                  </TableCell>
                </TableRow>
              ) : (
                methods.map((pm) => {
                  const flags = [
                    pm.canBuyCourse && "Khoá",
                    pm.canBuyPackage && "Gói",
                    pm.canBuyExam && "Thi",
                    pm.canBuyProduct && "Sản phẩm",
                    pm.canDeposit && "Nạp",
                  ]
                    .filter(Boolean)
                    .join(", ");
  
                  return (
                    <TableRow key={pm.id}>
                      <TableCell className="tabular-nums">
                        {pm.displayOrder}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {pm.code}
                      </TableCell>
                      <TableCell className="font-medium">{pm.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {TYPE_LABEL[pm.type] ?? pm.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {/* Cột này là câu trả lời trực quan cho "ai nhìn thấy phương
                            thức nào": dòng "Dùng chung" hiện ở mọi cơ sở, dòng có tên
                            cơ sở CHỈ hiện ở cơ sở đó. */}
                        {pm.centerId ? (
                          <span className="font-medium text-foreground">
                            {centerNames[pm.centerId] ?? pm.centerId}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Dùng chung</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {flags || "—"}
                      </TableCell>
                      <TableCell>
                        {pm.isActive ? (
                          <Badge className="bg-state-success-soft text-state-success-ink hover:bg-state-success-soft-hover">
                            Hoạt động
                          </Badge>
                        ) : (
                          <Badge className="bg-muted text-foreground hover:bg-muted">
                            Tắt
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/payment-methods/${pm.id}/edit`}>
                            <Button variant="outline" size="sm">
                              <Pencil className="h-3.5 w-3.5" />
                              Sửa
                            </Button>
                          </Link>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => setConfirmTarget(pm)}
                          >
                            {pm.isActive ? "Tắt" : "Bật"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>

      <Dialog
        open={!!confirmTarget}
        onOpenChange={(o) => !isPending && !o && setConfirmTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmTarget?.isActive
                ? "Vô hiệu hoá phương thức?"
                : "Kích hoạt phương thức?"}
            </DialogTitle>
            <DialogDescription>
              <strong>{confirmTarget?.name}</strong> ({confirmTarget?.code})
              {confirmTarget?.isActive
                ? " sẽ không xuất hiện trong form thanh toán."
                : " sẽ xuất hiện trở lại trong form thanh toán."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmTarget(null)}
              disabled={isPending}
            >
              Huỷ
            </Button>
            <Button type="button" onClick={onConfirm} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmTarget?.isActive ? "Vô hiệu hoá" : "Kích hoạt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
