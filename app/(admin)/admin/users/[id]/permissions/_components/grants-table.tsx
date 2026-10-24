"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, Check, Ban, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { getActionMeta } from "@/lib/auth/action-labels";
import { updateGrantAction, removeGrantAction } from "../_actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export interface GrantRow {
  id: string;
  action: string;
  grant: "ALLOW" | "DENY";
  reason: string | null;
  createdAt: Date;
  grantor: { name: string | null; email: string | null };
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function GrantsTable({ grants }: { grants: GrantRow[] }) {
  const [editing, setEditing] = useState<GrantRow | null>(null);
  const [deleting, setDeleting] = useState<GrantRow | null>(null);

  if (grants.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/50 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Chưa có quyền override nào — user dùng quyền mặc định theo role.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Quyền
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Loại
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lý do
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Người grant
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ngày tạo
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grants.map((g) => {
                const meta = getActionMeta(g.action);
                return (
                  <tr key={g.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3">
                      <div className="text-xs text-muted-foreground">{meta.category}</div>
                      <div className="font-medium text-foreground">{meta.label}</div>
                      <code className="text-[10px] text-muted-foreground">{g.action}</code>
                    </td>
                    <td className="px-4 py-3">
                      <GrantBadge grant={g.grant} />
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      {g.reason ? (
                        <p className="text-xs italic text-muted-foreground">{g.reason}</p>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <div>{g.grantor.name ?? "—"}</div>
                      <div className="text-muted-foreground">{g.grantor.email ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                      {formatDate(g.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(g)}
                          title="Sửa"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(g)}
                          title="Xoá"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-state-danger-ink hover:bg-state-danger-soft hover:text-state-danger-ink"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      <EditGrantDialog grant={editing} onClose={() => setEditing(null)} />
      <DeleteGrantDialog grant={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

export function GrantBadge({ grant }: { grant: "ALLOW" | "DENY" }) {
  if (grant === "ALLOW") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-state-success-soft bg-state-success-soft px-2.5 py-0.5 text-xs font-semibold text-state-success-ink">
        <Check className="h-3 w-3" />
        ALLOW
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-state-danger-soft bg-state-danger-soft px-2.5 py-0.5 text-xs font-semibold text-state-danger-ink">
      <Ban className="h-3 w-3" />
      DENY
    </span>
  );
}

function EditGrantDialog({
  grant,
  onClose,
}: {
  grant: GrantRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!grant) return null;
  const meta = getActionMeta(grant.action);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!grant) return;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateGrantAction(grant.id, fd);
      if (res.ok) {
        toast.success("Đã cập nhật quyền override");
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi cập nhật");
      }
    });
  }

  return (
    <Dialog open={!!grant} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sửa quyền override</DialogTitle>
          <DialogDescription>
            {meta.category} · <strong>{meta.label}</strong>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Loại</Label>
            <div className="flex gap-2">
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-border p-3 text-sm has-checked:border-state-success has-checked:bg-state-success-soft">
                <input
                  type="radio"
                  name="grant"
                  value="ALLOW"
                  defaultChecked={grant.grant === "ALLOW"}
                  className="peer sr-only"
                />
                <Check className="h-4 w-4 text-state-success-ink" />
                <span className="font-semibold text-state-success-ink">ALLOW</span>
              </label>
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-border p-3 text-sm has-checked:border-state-danger has-checked:bg-state-danger-soft">
                <input
                  type="radio"
                  name="grant"
                  value="DENY"
                  defaultChecked={grant.grant === "DENY"}
                  className="peer sr-only"
                />
                <Ban className="h-4 w-4 text-state-danger-ink" />
                <span className="font-semibold text-state-danger-ink">DENY</span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Lý do (tuỳ chọn)</Label>
            <Textarea
              id="reason"
              name="reason"
              defaultValue={grant.reason ?? ""}
              maxLength={500}
              rows={3}
              placeholder="Ví dụ: Cấp tạm thời cho dự án X"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Huỷ
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Lưu thay đổi
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteGrantDialog({
  grant,
  onClose,
}: {
  grant: GrantRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!grant) return null;
  const meta = getActionMeta(grant.action);

  function onConfirm() {
    if (!grant) return;
    startTransition(async () => {
      const res = await removeGrantAction(grant.id);
      if (res.ok) {
        toast.success("Đã xoá quyền override");
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi xoá");
      }
    });
  }

  return (
    <Dialog open={!!grant} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Xoá quyền override?</DialogTitle>
          <DialogDescription>
            <strong>{meta.category}</strong> · {meta.label} ({grant.grant}) sẽ
            bị xoá. User trở về quyền mặc định theo role + bị đăng xuất khỏi
            mọi thiết bị.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Huỷ
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Xoá grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
