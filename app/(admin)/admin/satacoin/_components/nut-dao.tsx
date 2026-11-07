"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { reverseCoinTx } from "../_actions";

// Đảo một giao dịch — sổ cái bất biến, đảo = ghi giao dịch ngược. Xác nhận 2 lần bấm.
export function NutDao({ txId, studentId }: { txId: string; studentId: string }) {
  const router = useRouter();
  const [xacNhan, setXacNhan] = useState(false);
  const [dang, start] = useTransition();
  function bam() {
    if (!xacNhan) {
      setXacNhan(true);
      return;
    }
    start(async () => {
      const kq = await reverseCoinTx(txId, studentId);
      if (!kq.ok) {
        toast.error(kq.error ?? "Không đảo được");
        setXacNhan(false);
        return;
      }
      toast.success("Đã đảo giao dịch");
      router.refresh();
    });
  }
  return (
    <button
      type="button"
      onClick={bam}
      onBlur={() => setXacNhan(false)}
      disabled={dang}
      className={
        xacNhan
          ? "inline-flex h-8 items-center gap-1 rounded-md bg-state-danger-soft px-2.5 text-xs font-semibold text-state-danger-ink"
          : "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      }
    >
      <Undo2 className="size-3.5" aria-hidden />
      {dang ? "Đang đảo…" : xacNhan ? "Đảo thật?" : "Đảo"}
    </button>
  );
}
