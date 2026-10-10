"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { resetUserPasswordAction } from "../_actions";

export function ResetPasswordForm({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const res = await resetUserPasswordAction(userId, fd);
      if (!res.ok) {
        setError(res.error ?? "Lỗi đổi mật khẩu");
        toast.error(res.error ?? "Lỗi đổi mật khẩu");
        return;
      }
      toast.success(`Đã đổi mật khẩu cho ${userEmail}`);
      router.push("/users");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-state-warning bg-state-warning-soft p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-state-warning-ink" />
        <div className="text-state-warning-ink">
          <strong>Lưu ý:</strong> User <code>{userEmail}</code> sẽ bị đăng xuất
          khỏi <strong>tất cả thiết bị</strong> sau khi đổi mật khẩu.
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="newPassword">Mật khẩu mới *</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={8}
          maxLength={72}
          placeholder="Tối thiểu 8 ký tự"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Xác nhận mật khẩu *</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          maxLength={72}
          placeholder="Nhập lại mật khẩu mới"
        />
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          <KeyRound className="h-4 w-4" />
          {pending ? "Đang đổi..." : "Đổi mật khẩu"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={pending}
        >
          Huỷ
        </Button>
      </div>
    </form>
  );
}
