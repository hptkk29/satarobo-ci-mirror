"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Switch } from "@/components/ui/switch";
import { updateCourseBasics } from "../_actions";

export type CourseBasics = {
  id: string;
  name: string;
  slug: string;
  ageRange: string | null;
  level: string | null;
  price: number | null;
  isActive: boolean;
};

export function CourseBasicsForm({ course }: { course: CourseBasics }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(course.name);
  const [ageRange, setAgeRange] = useState(course.ageRange ?? "");
  const [level, setLevel] = useState(course.level ?? "");
  const [price, setPrice] = useState(course.price != null ? String(course.price) : "");
  const [isActive, setIsActive] = useState(course.isActive);

  function submit() {
    startTransition(async () => {
      const r = await updateCourseBasics(course.id, {
        name,
        ageRange,
        level,
        price,
        isActive,
      });
      if (r.ok) {
        toast.success("Đã lưu thông tin khoá học");
        router.refresh();
      } else {
        toast.error(r.error ?? "Có lỗi xảy ra");
      }
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Thông tin khoá học</h2>

      <div className="space-y-1.5">
        <Label htmlFor="c-name">Tên khoá</Label>
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="c-age">Độ tuổi</Label>
          <Input
            id="c-age"
            value={ageRange}
            onChange={(e) => setAgeRange(e.target.value)}
            placeholder="vd: 6-8 tuổi"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-level">Trình độ</Label>
          <Input
            id="c-level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder="vd: Cơ bản"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="c-price">Giá niêm yết (VND)</Label>
          {/* `updateCourseBasics` vẫn nhận chuỗi số trần như cũ — ô chỉ đổi cách hiển
              thị, không đổi kiểu dữ liệu gửi đi. */}
          <MoneyInput
            id="c-price"
            name="price"
            min={0}
            value={price}
            onValueChange={(v) => setPrice(v === null ? "" : String(v))}
            placeholder="vd: 10000000"
            // Dáng ô của shadcn <Input> để không lệch với các ô còn lại trong form.
            // `pl-` chứ không `px-`: phải chừa lề phải cho chữ "đ".
            className="h-8 border-input bg-transparent py-1 pl-2.5"
          />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <Switch id="c-active" checked={isActive} onCheckedChange={setIsActive} />
          <Label htmlFor="c-active">Đang hoạt động</Label>
        </div>
      </div>

      <div>
        <Button size="sm" onClick={submit} disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Lưu
        </Button>
      </div>
    </div>
  );
}
