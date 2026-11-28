"use client";

// US-03 — form tạo nhóm inline trên trang danh sách (mẫu CreateRoleForm của /roles).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createUserGroupAction } from "../_actions";

export function CreateGroupForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function submit() {
    startTransition(async () => {
      const res = await createUserGroupAction({ name, description });
      if (res.ok) {
        toast.success("Đã tạo nhóm");
        setName("");
        setDescription("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="rounded-lg border bg-muted p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Tạo nhóm mới</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="group-name">Tên nhóm</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nhóm CSKH hè 2026"
            maxLength={100}
          />
        </div>
        <div>
          <Label htmlFor="group-description">Mô tả</Label>
          <Input
            id="group-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Grant ad-hoc, không sửa vai chuẩn"
          />
        </div>
        <div className="flex items-end">
          <Button onClick={submit} disabled={pending || name.trim().length === 0} className="w-full">
            {pending ? "Đang lưu..." : "Tạo nhóm"}
          </Button>
        </div>
      </div>
    </div>
  );
}
