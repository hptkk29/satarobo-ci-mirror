"use client";

// Nút "Dời lớp khác" của MỘT bé đã được đánh VẮNG (PH không đến) — 04/11/2026.
//
// Chủ dự án: bé vắng có thể được dời sang một lớp trial khác; lượt cũ bị huỷ, case cũ hết bé thì tự huỷ. Luật + phép ghi ở
// server (`doiBeVangSangLopKhac`); ở đây chỉ nạp danh sách case đích khi người dùng bấm và gọi action.
//
// Nút chỉ được vẽ khi bên gọi đã xét xong quyền + bé ĐÃ vắng (luật 12: không vẽ nút chắc chắn ăn từ chối).

import type { JSX } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import {
  doiBeVangSangLopKhacAction,
  layCaseDoiLopAction,
  type CaseDoiLop,
} from "../_actions";

export function DoiBeVang({
  trialClassId,
  trialEnrollmentId,
  tenBe,
}: {
  trialClassId: string;
  trialEnrollmentId: string;
  tenBe: string;
}): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mo, setMo] = useState(false);
  const [cases, setCases] = useState<CaseDoiLop[] | null>(null);
  const [chon, setChon] = useState("");

  function moRa() {
    setMo(true);
    if (cases) return;
    startTransition(async () => {
      const res = await layCaseDoiLopAction({ trialClassId });
      if (res.ok) setCases(res.cases);
      else {
        toast.error(res.error);
        setMo(false);
      }
    });
  }

  function doi() {
    if (!chon) {
      toast.error("Chọn case của lớp trial khác");
      return;
    }
    startTransition(async () => {
      const res = await doiBeVangSangLopKhacAction({
        trialClassId,
        trialEnrollmentId,
        toSessionId: chon,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Đã dời ${tenBe} sang lớp trial khác — lượt cũ đã huỷ`);
      setMo(false);
      router.refresh();
    });
  }

  if (!mo) {
    return (
      <button
        type="button"
        onClick={moRa}
        disabled={pending}
        title="Bé vắng (PH không đến): dời sang case của lớp trial khác, huỷ lượt cũ"
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden /> Dời lớp khác
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {pending && !cases ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Đang tải" />
      ) : cases && cases.length === 0 ? (
        <span className="text-xs text-muted-foreground">Chưa có case nào của lớp trial khác để dời sang.</span>
      ) : (
        <select
          value={chon}
          onChange={(e) => setChon(e.target.value)}
          disabled={pending}
          aria-label={`Case đích của ${tenBe}`}
          className="max-w-[16rem] rounded-lg border border-border bg-card px-2 py-1 text-xs"
        >
          <option value="">Chọn case đích…</option>
          {(cases ?? []).map((c) => (
            <option key={c.sessionId} value={c.sessionId}>
              {c.nhan}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={doi}
        disabled={pending || !chon}
        className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
      >
        Dời
      </button>
      <button
        type="button"
        onClick={() => setMo(false)}
        disabled={pending}
        className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        Đóng
      </button>
    </div>
  );
}
