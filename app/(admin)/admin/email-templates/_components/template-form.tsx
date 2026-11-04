"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EmailTemplateTrigger } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  EMAIL_TRIGGER_LABEL,
  TRIGGER_VARIABLES,
} from "@/lib/validators/email-template";
import { createTemplateAction, updateTemplateAction } from "../_actions";

export type TemplateFormValue = {
  id?: string;
  code: string;
  name: string;
  description: string;
  trigger: EmailTemplateTrigger;
  isActive: boolean;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  fromName: string;
  replyTo: string;
};

const EMPTY: TemplateFormValue = {
  code: "",
  name: "",
  description: "",
  trigger: "MANUAL",
  isActive: true,
  subject: "",
  bodyText: "",
  bodyHtml: "",
  fromName: "",
  replyTo: "",
};

export function TemplateForm({
  initial = EMPTY,
}: {
  initial?: TemplateFormValue;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [v, setV] = useState<TemplateFormValue>(initial);
  const isEdit = !!initial.id;

  const availableVars = TRIGGER_VARIABLES[v.trigger];

  function update<K extends keyof TemplateFormValue>(
    key: K,
    value: TemplateFormValue[K],
  ) {
    setV((p) => ({ ...p, [key]: value }));
  }

  function insertVar(
    varName: string,
    target: "subject" | "bodyText" | "bodyHtml",
  ) {
    update(target, v[target] + `{{${varName}}}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        code: v.code,
        name: v.name,
        description: v.description || null,
        trigger: v.trigger,
        isActive: v.isActive,
        subject: v.subject,
        bodyText: v.bodyText,
        bodyHtml: v.bodyHtml,
        availableVariables: [],
        fromName: v.fromName || null,
        replyTo: v.replyTo || null,
      };
      const result = isEdit
        ? await updateTemplateAction(initial.id!, payload)
        : await createTemplateAction(payload);

      if (result.ok) {
        toast.success(isEdit ? "Đã cập nhật" : "Đã tạo template");
        if (!isEdit) router.push(`/email-templates/${result.templateId}/edit`);
        else router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      <section className="bg-card border rounded p-4 space-y-3">
        <h2 className="font-semibold">Thông tin chung</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Code *</Label>
            <Input
              value={v.code}
              onChange={(e) => update("code", e.target.value.toUpperCase())}
              placeholder="VD: ORDER_CONFIRMATION_VI"
              required
              disabled={isEdit}
            />
            <div className="text-xs text-muted-foreground mt-1">
              CHỮ HOA + _ + số. Không sửa được sau tạo.
            </div>
          </div>
          <div>
            <Label>Trigger *</Label>
            <Select
              value={v.trigger}
              onValueChange={(val) =>
                update("trigger", (val ?? "MANUAL") as EmailTemplateTrigger)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.values(EmailTemplateTrigger) as EmailTemplateTrigger[]).map(
                  (t) => (
                    <SelectItem key={t} value={t}>
                      {EMAIL_TRIGGER_LABEL[t]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Tên *</Label>
          <Input
            value={v.name}
            onChange={(e) => update("name", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Mô tả</Label>
          <Textarea
            value={v.description}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={v.isActive}
            onCheckedChange={(c) => update("isActive", c)}
          />
          <Label>Hoạt động</Label>
        </div>
      </section>

      {availableVars.length > 0 && (
        <section className="bg-state-info-soft border border-state-info-soft rounded p-4">
          <h3 className="font-semibold text-sm mb-2">
            Biến có sẵn cho trigger {EMAIL_TRIGGER_LABEL[v.trigger]}:
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {availableVars.map((vn) => (
              <code
                key={vn}
                className="px-2 py-0.5 bg-card border rounded text-xs font-mono"
              >
                {`{{${vn}}}`}
              </code>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Render engine đầy đủ trong Sprint 5.13.1. Hiện tại chỉ basic
            substitution.
          </div>
        </section>
      )}

      <section className="bg-card border rounded p-4 space-y-3">
        <h2 className="font-semibold">Tiêu đề + nội dung</h2>
        <div>
          <Label>Tiêu đề email *</Label>
          <Input
            value={v.subject}
            onChange={(e) => update("subject", e.target.value)}
            placeholder="VD: Xác nhận đơn hàng {{order_code}} - Sata Robo"
            required
          />
          {availableVars.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {availableVars.slice(0, 5).map((vn) => (
                <button
                  key={vn}
                  type="button"
                  onClick={() => insertVar(vn, "subject")}
                  className="text-xs px-1.5 py-0.5 border rounded hover:bg-muted"
                >
                  +{vn}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label>
            Body Text (plain — fallback nếu client không render HTML) *
          </Label>
          <Textarea
            value={v.bodyText}
            onChange={(e) => update("bodyText", e.target.value)}
            rows={6}
            required
            placeholder={
              "Chào {{customer_name}},\n\nCảm ơn anh/chị đã đặt đơn {{order_code}} với tổng {{total_amount}} VND..."
            }
          />
        </div>

        <div>
          <Label>Body HTML *</Label>
          <Textarea
            value={v.bodyHtml}
            onChange={(e) => update("bodyHtml", e.target.value)}
            rows={12}
            required
            placeholder={
              "<h2>Xin chào {{customer_name}}</h2>\n<p>Cảm ơn...</p>"
            }
            className="font-mono text-sm"
          />
          <div className="text-xs text-muted-foreground mt-1">
            HTML cần inline CSS. Email client (Gmail/Outlook) không hỗ trợ
            external CSS.
          </div>
        </div>
      </section>

      <section className="bg-card border rounded p-4 space-y-3">
        <h2 className="font-semibold">Tuỳ chọn nâng cao</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>From Name (override env)</Label>
            <Input
              value={v.fromName}
              onChange={(e) => update("fromName", e.target.value)}
              placeholder="Mặc định dùng RESEND_FROM_EMAIL"
            />
          </div>
          <div>
            <Label>Reply-To (override env)</Label>
            <Input
              type="email"
              value={v.replyTo}
              onChange={(e) => update("replyTo", e.target.value)}
              placeholder="Mặc định dùng RESEND_REPLY_TO"
            />
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo template"}
        </Button>
        <Link href="/email-templates">
          <Button type="button" variant="outline">
            Huỷ
          </Button>
        </Link>
      </div>
    </form>
  );
}
