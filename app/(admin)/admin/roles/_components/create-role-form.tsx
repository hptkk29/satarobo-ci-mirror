"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRoleAction } from "../actions";

export function CreateRoleForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");

  function submit() {
    startTransition(async () => {
      const res = await createRoleAction({ code, name, reason });
      if (res.ok) {
        toast.success("Đã tạo role");
        setCode("");
        setName("");
        setReason("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="rounded-lg border bg-muted p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Tạo role mới</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="role-code">Mã (IN HOA)</Label>
          <Input
            id="role-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="CS_LEADER"
          />
        </div>
        <div>
          <Label htmlFor="role-name">Tên</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tổ trưởng cơ sở"
          />
        </div>
        <div>
          <Label htmlFor="role-reason">Lý do</Label>
          <Input
            id="role-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Vì sao tạo role này"
          />
        </div>
        <div className="flex items-end">
          <Button onClick={submit} disabled={pending} className="w-full">
            {pending ? "Đang lưu..." : "Tạo role"}
          </Button>
        </div>
      </div>
    </div>
  );
}
