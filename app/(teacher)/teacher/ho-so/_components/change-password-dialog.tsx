// app/(teacher)/teacher/ho-so/_components/change-password-dialog.tsx — #06 (L6).
//
// Dialog "Đổi mật khẩu" — bản teacher MỎNG (shadcn thuần) TÁI DÙNG action
// changePassword của admin settings (app/(admin)/admin/settings/actions):
// action tự gate self-service (auth() + chỉ đọc/ghi CHÍNH userId trong session,
// verify mật khẩu hiện tại bằng bcrypt) → KHÔNG viết action mới, không nới quyền.
// Không import thẳng ChangePasswordForm của admin vì form đó dùng input trần +
// màu admin (#7C3AED) — site GV chuẩn shadcn Input/Label/Button + toast sonner.
"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword } from "@/app/(admin)/admin/settings/actions";

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  /** Đóng dialog thì xoá sạch field — không giữ mật khẩu trong state. */
  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setShowCurrent(false);
      setShowNext(false);
    }
  }

  function submit() {
    // Chặn sớm phía client — server (action) vẫn validate lại đầy đủ bằng Zod.
    if (!current) {
      toast.error("Nhập mật khẩu hiện tại");
      return;
    }
    if (next.length < 8) {
      toast.error("Mật khẩu mới tối thiểu 8 ký tự");
      return;
    }
    if (next !== confirm) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }
    // Action nhận FormData (giữ nguyên contract của admin settings).
    const fd = new FormData();
    fd.set("currentPassword", current);
    fd.set("newPassword", next);
    fd.set("confirmPassword", confirm);
    startTransition(async () => {
      const res = await changePassword(fd);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Đã cập nhật mật khẩu");
        handleOpenChange(false);
      }
    });
  }

  return (
    <>
      {/* Dialog controlled (open/onOpenChange) theo pattern site GV — không DialogTrigger. */}
      <Button variant="outline" onClick={() => setOpen(true)}>
        <KeyRound className="mr-1.5 h-4 w-4" /> Đổi mật khẩu
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Đổi mật khẩu</DialogTitle>
            <DialogDescription>
              Nhập mật khẩu hiện tại để xác nhận, sau đó đặt mật khẩu mới (tối
              thiểu 8 ký tự).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">Mật khẩu hiện tại</Label>
              <PasswordInput
                id="pw-current"
                value={current}
                disabled={pending}
                show={showCurrent}
                onToggleShow={() => setShowCurrent((v) => !v)}
                onChange={setCurrent}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-next">Mật khẩu mới</Label>
              <PasswordInput
                id="pw-next"
                value={next}
                disabled={pending}
                show={showNext}
                onToggleShow={() => setShowNext((v) => !v)}
                onChange={setNext}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">Xác nhận mật khẩu mới</Label>
              <Input
                id="pw-confirm"
                type="password"
                value={confirm}
                disabled={pending}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Đang lưu…" : "Cập nhật mật khẩu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Input mật khẩu có nút hiện/ẩn (Eye/EyeOff) — shadcn Input + nút absolute. */
function PasswordInput({
  id,
  value,
  disabled,
  show,
  onToggleShow,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  show: boolean;
  onToggleShow: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        className="pr-10"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={onToggleShow}
        aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
