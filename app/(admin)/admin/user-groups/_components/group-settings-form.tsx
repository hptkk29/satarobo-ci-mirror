"use client";

// US-03 — sửa tên/mô tả nhóm (không đụng thành viên/grant — hai panel riêng).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateUserGroupAction } from "../_actions";

export function GroupSettingsForm({
  groupId,
  initialName,
  initialDescription,
}: {
  groupId: string;
  initialName: string;
  initialDescription: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  const dirty = name !== initialName || description !== initialDescription;

  function submit() {
    startTransition(async () => {
      const res = await updateUserGroupAction(groupId, { name, description });
      if (res.ok) {
        toast.success("Đã lưu thay đổi");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
        <Settings2 className="h-5 w-5 text-muted-foreground" /> Thông tin nhóm
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="edit-group-name">Tên nhóm</Label>
          <Input
            id="edit-group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </div>
        <div>
          <Label htmlFor="edit-group-description">Mô tả</Label>
          <Input
            id="edit-group-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button
            onClick={submit}
            disabled={pending || !dirty || name.trim().length === 0}
            variant="outline"
          >
            {pending ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </div>
      </div>
    </section>
  );
}
