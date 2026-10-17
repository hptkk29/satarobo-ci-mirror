"use client";

// P1 · US-05 AC4 — thao tác trên MỘT node của cây: Sửa · Thêm đơn vị con · Xoá mềm.
//
// Cụm nút này nằm TRONG <summary> của node (xem page.tsx) nên phải chặn hành vi mặc
// định của summary: click bất kỳ đâu trong summary sẽ đóng/mở nhánh. `preventDefault`
// ở lớp bọc giữ cho việc bấm nút không làm cây nhảy.
//
// Xoá dùng mẫu 2-click (quy ước bảng dữ liệu admin) — bấm lần 1 đổi thành "Xác nhận
// xoá?", lần 2 mới gọi action. Service tự chặn nếu còn đơn vị con đang sống.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteOrgUnitAction } from "../_actions";
import {
  OrgUnitForm,
  type EditableUnit,
  type LegalEntityOption,
  type ParentOption,
} from "./org-unit-form";

export function OrgUnitRowActions({
  unit,
  parents,
  legalEntities,
}: {
  unit: EditableUnit;
  parents: ParentOption[];
  legalEntities: LegalEntityOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function onDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteOrgUnitAction(unit.id);
      if (res.ok) {
        toast.success(`Đã xoá đơn vị ${unit.code}`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
      setConfirmDelete(false);
    });
  }

  return (
    <div
      className="flex shrink-0 items-center gap-1"
      onClick={(e) => e.preventDefault()}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setEditOpen(true)}
        title="Sửa đơn vị"
      >
        <Pencil className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">Sửa</span>
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setAddChildOpen(true)}
        title="Thêm đơn vị con"
      >
        <Plus className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">Đơn vị con</span>
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={pending}
        className="text-state-danger-ink hover:bg-state-danger-soft"
        title="Xoá mềm đơn vị"
      >
        <Trash2 className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">
          {confirmDelete ? "Xác nhận xoá?" : "Xoá"}
        </span>
      </Button>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Sửa đơn vị {unit.code} · {unit.name}
            </DialogTitle>
            <DialogDescription>
              Đổi đơn vị cha sẽ tính lại đường dẫn (path) của cả nhánh con trong một
              giao dịch. Mã đơn vị không sửa được ở màn này.
            </DialogDescription>
          </DialogHeader>
          <OrgUnitForm
            unit={unit}
            parents={parents}
            legalEntities={legalEntities}
            onDone={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={addChildOpen} onOpenChange={setAddChildOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Thêm đơn vị con của {unit.code}</DialogTitle>
            <DialogDescription>
              Đơn vị cha đã chọn sẵn là {unit.code} · {unit.name}.
            </DialogDescription>
          </DialogHeader>
          <OrgUnitForm
            parents={parents}
            legalEntities={legalEntities}
            defaultParentId={unit.id}
            onDone={() => setAddChildOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
