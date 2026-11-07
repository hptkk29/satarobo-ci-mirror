"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { toggleLeadShareAction } from "../../actions";

// #11 T1 (câu 10 BGĐ, Kiệt ký spec 10/07) — bật/tắt "dùng chung" lead cho CSKH
// cùng cơ sở. Page.tsx chỉ hiện toggle cho OWNER (assignee) hoặc QL (leads:assign);
// server action tự guard lại (gate ở đây chỉ là UX). Q2: người xem nhờ dùng chung
// chỉ XEM + GHI CHÚ — mutator server chặn qua actorMayMutateLead.

function fmtDate(iso: string): string {
  // timeZone cố định → SSR/client ra cùng chuỗi, tránh hydrate mismatch (BUG-R7-008).
  return new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

export function ShareToggle({
  leadId,
  isShared,
  sharedAt,
}: {
  leadId: string;
  isShared: boolean;
  sharedAt: string | null; // ISO
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await toggleLeadShareAction(leadId, !isShared);
      if (res.ok) {
        toast.success(
          !isShared
            ? "Đã bật dùng chung — CSKH cùng cơ sở xem được lead này"
            : "Đã tắt dùng chung",
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2">
      <Users size={14} className="flex-shrink-0 text-muted-foreground" />
      <label
        htmlFor="lead-share-toggle"
        className="cursor-pointer text-sm font-medium text-foreground"
      >
        Dùng chung cho CSKH cùng cơ sở
      </label>
      <Switch
        id="lead-share-toggle"
        checked={isShared}
        onCheckedChange={toggle}
        disabled={isPending}
        aria-label="Dùng chung cho CSKH cùng cơ sở"
      />
      {isShared && (
        <span className="whitespace-nowrap text-xs font-medium text-state-success-ink">
          Đang dùng chung{sharedAt ? ` từ ${fmtDate(sharedAt)}` : ""}
        </span>
      )}
    </div>
  );
}
