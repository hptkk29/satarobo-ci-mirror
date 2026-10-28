"use client";

import { useState, useTransition } from "react";
import type { EmailTemplateTrigger } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { sendTestEmailAction } from "../_actions";

export function TestSendButton({
  templateId,
  trigger,
  currentUserEmail,
}: {
  templateId: string;
  trigger: EmailTemplateTrigger;
  currentUserEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [toEmail, setToEmail] = useState(currentUserEmail ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await sendTestEmailAction({ templateId, toEmail });
      if (result.ok) {
        toast.success("Đã gửi test email — check inbox + /email-logs");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" type="button" onClick={() => setOpen(true)}>
        Gửi test
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gửi test email</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="p-3 bg-state-warning-soft border border-state-warning-soft rounded text-sm">
              Email sẽ gửi với <strong>variables mẫu</strong> (định nghĩa trong
              SAMPLE_VARS). Subject + body sẽ có prefix <code>[TEST]</code>.
              Trigger: <strong>{trigger}</strong>
            </div>
            <div>
              <Label>Email nhận *</Label>
              <Input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Đang gửi..." : "Gửi test"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
