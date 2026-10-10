"use client";

// US-03 — thành viên nhóm: thêm qua select tài khoản active, gỡ 2-click (pattern
// confirm-delete của admin). Gỡ là HARD delete → quyền từ grant nhóm mất ngay
// request kế tiếp (AC3 — cache theo request, không cache phiên).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { addGroupMemberAction, removeGroupMemberAction } from "../_actions";

type Member = {
  userId: string;
  name: string;
  email: string | null;
  isActive: boolean;
  addedAt: string;
};

export function GroupMembers({
  groupId,
  members,
  candidates,
}: {
  groupId: string;
  members: Member[];
  candidates: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedUserId, setSelectedUserId] = useState("");
  // 2-click: click 1 đặt confirmId, click 2 mới gỡ thật.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function add() {
    if (!selectedUserId) return;
    startTransition(async () => {
      const res = await addGroupMemberAction(groupId, { userId: selectedUserId });
      if (res.ok) {
        toast.success("Đã thêm thành viên — grant nhóm ăn từ request kế tiếp");
        setSelectedUserId("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function remove(userId: string) {
    if (confirmId !== userId) {
      setConfirmId(userId);
      return;
    }
    startTransition(async () => {
      const res = await removeGroupMemberAction(groupId, userId);
      if (res.ok) {
        toast.success("Đã gỡ khỏi nhóm — quyền mất ngay request kế tiếp");
        setConfirmId(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
        <Users className="h-5 w-5 text-muted-foreground" /> Thành viên ({members.length})
      </h2>

      {members.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Chưa có thành viên. Một người có thể thuộc nhiều nhóm — quyền là hợp của các nguồn,
          DENY thắng.
        </p>
      ) : (
        <ul className="mb-4 divide-y rounded-lg border">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{m.name}</span>
                {m.email && m.email !== m.name && (
                  <span className="ml-2 text-xs text-muted-foreground">{m.email}</span>
                )}
                {!m.isActive && (
                  <Badge variant="outline" className="ml-2">
                    Đã khoá
                  </Badge>
                )}
                <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                  vào nhóm {m.addedAt}
                </span>
              </div>
              <button
                onClick={() => remove(m.userId)}
                disabled={pending}
                className={
                  confirmId === m.userId
                    ? "inline-flex shrink-0 items-center gap-1 rounded-md bg-state-danger-ink px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    : "inline-flex shrink-0 items-center gap-1 text-xs text-state-danger-ink hover:underline disabled:opacity-50"
                }
              >
                <X className="h-3.5 w-3.5" />
                {confirmId === m.userId ? "Bấm lần nữa để gỡ" : "Gỡ"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Native select: danh sách tài khoản active (đã loại PH + người đã trong nhóm).
            Không dùng shadcn Select — base-ui SelectValue hiện value thô (cuid). */}
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          disabled={pending || candidates.length === 0}
          className="h-9 min-w-64 flex-1 rounded-md border border-border bg-card px-2 text-sm focus:border-primary focus:outline-none sm:flex-none"
        >
          <option value="">
            {candidates.length === 0 ? "— Hết tài khoản để thêm —" : "— Chọn tài khoản —"}
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <Button onClick={add} disabled={pending || !selectedUserId} size="sm">
          <UserPlus className="mr-1 h-4 w-4" />
          {pending ? "Đang thêm..." : "Thêm vào nhóm"}
        </Button>
      </div>
    </section>
  );
}
