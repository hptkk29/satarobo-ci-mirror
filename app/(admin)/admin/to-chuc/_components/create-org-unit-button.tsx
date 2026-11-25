"use client";

// P1 · US-05 AC4 — nút "Thêm đơn vị" ở đầu trang, mở form tạo trong Dialog (shadcn).
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  OrgUnitForm,
  type LegalEntityOption,
  type ParentOption,
} from "./org-unit-form";

export function CreateOrgUnitButton({
  parents,
  legalEntities,
}: {
  parents: ParentOption[];
  legalEntities: LegalEntityOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Thêm đơn vị
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Thêm đơn vị tổ chức</DialogTitle>
            <DialogDescription>
              Mở cơ sở/khối vùng mới là THÊM DỮ LIỆU, không sửa code. Mã đơn vị và loại
              đơn vị không đổi được sau khi tạo.
            </DialogDescription>
          </DialogHeader>
          <OrgUnitForm
            parents={parents}
            legalEntities={legalEntities}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
