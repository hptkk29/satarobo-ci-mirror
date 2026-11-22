"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowDownUp } from "lucide-react";
import { toast } from "sonner";
import { ProductMovementType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRODUCT_MOVEMENT_TYPE_LABEL } from "@/lib/validators/product";
import { adjustStockAction } from "../_actions";

const ADJUSTABLE_TYPES: ProductMovementType[] = [
  "PURCHASE",
  "ADJUSTMENT",
  "DAMAGE",
  "RETURN",
  "TRANSFER_IN",
  "TRANSFER_OUT",
];

export function AdjustStockButton({
  productId,
  currentStock,
}: {
  productId: string;
  currentStock: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<ProductMovementType>("ADJUSTMENT");
  const [quantity, setQuantity] = useState<number>(0);
  const [reason, setReason] = useState("");

  const newStock = currentStock + quantity;
  const wouldGoNegative = newStock < 0;

  function reset() {
    setQuantity(0);
    setReason("");
    setType("ADJUSTMENT");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quantity === 0) {
      toast.error("Số lượng phải khác 0");
      return;
    }
    startTransition(async () => {
      const result = await adjustStockAction({
        productId,
        type,
        quantity,
        reason: reason || null,
      });
      if (result.ok) {
        toast.success(`Tồn kho mới: ${result.newStock}`);
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        size="sm"
      >
        <ArrowDownUp className="h-4 w-4" />
        Điều chỉnh tồn kho
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!isPending) {
            setOpen(o);
            if (!o) reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Điều chỉnh tồn kho — hiện tại {currentStock}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Loại biến động *</Label>
              <Select
                value={type}
                onValueChange={(v) =>
                  setType((v ?? "ADJUSTMENT") as ProductMovementType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTABLE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {PRODUCT_MOVEMENT_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Số lượng (+ = nhập, − = xuất) *</Label>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Tồn kho sau thay đổi: {newStock}
                {wouldGoNegative && (
                  <span className="ml-2 font-bold text-state-danger-ink">
                    ⚠️ Không thể âm
                  </span>
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Lý do (khuyến nghị)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="VD: Nhập hàng từ NCC, hỏng do va đập..."
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Huỷ
              </Button>
              <Button
                type="submit"
                disabled={isPending || wouldGoNegative || quantity === 0}
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Đang lưu..." : "Lưu"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
