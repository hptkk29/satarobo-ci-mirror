"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { sendManualOrderEmailAction } from "../_actions";

type Props = {
  orderId: string;
  defaultEmail: string | null;
  defaultName: string | null;
  templates: Array<{
    id: string;
    name: string;
    trigger: string;
  }>;
};

export function SendEmailModal({
  orderId,
  defaultEmail,
  defaultName,
  templates,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [templateId, setTemplateId] = useState<string>("");
  const [toEmail, setToEmail] = useState(defaultEmail ?? "");
  const [toName, setToName] = useState(defaultName ?? "");

  useEffect(() => {
    if (open) {
      setToEmail(defaultEmail ?? "");
      setToName(defaultName ?? "");
      setTemplateId(templates[0]?.id ?? "");
    }
  }, [open, defaultEmail, defaultName, templates]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) {
      toast.error("Vui lòng chọn template");
      return;
    }
    if (!toEmail) {
      toast.error("Vui lòng nhập email");
      return;
    }
    startTransition(async () => {
      const result = await sendManualOrderEmailAction({
        orderId,
        templateId,
        toEmail,
        toName: toName || null,
      });
      if (result.ok) {
        toast.success("Đã gửi email — xem /email-logs để verify");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Gửi email
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gửi email cho khách hàng</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div>
              <Label>Template *</Label>
              <Select
                value={templateId}
                onValueChange={(v) => setTemplateId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground">
                      Không có template phù hợp
                    </div>
                  )}
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({t.trigger})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Email người nhận *</Label>
              <Input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Tên người nhận</Label>
              <Input
                value={toName}
                onChange={(e) => setToName(e.target.value)}
              />
            </div>
            <div className="p-2 bg-state-info-soft text-xs text-state-info-ink rounded">
              Email sẽ render variables từ thông tin đơn hàng này. Preview tại{" "}
              <a
                href="/email-templates"
                target="_blank"
                className="underline ml-1"
                rel="noreferrer"
              >
                /email-templates
              </a>
              .
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
                {isPending ? "Đang gửi..." : "Gửi email"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
