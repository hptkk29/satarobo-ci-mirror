"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { luuChoPhepBaoLuuAction } from "../_actions";

// Khoá này có được bảo lưu không (`Course.allowPause`) — Đào tạo tự đặt, danh sách không nằm trong mã (lib/bao-luu/khoa-cho-phep.ts).
// Cổng `canEdit` = `courses:edit`, CÙNG quyền mà action `luuChoPhepBaoLuuAction` hỏi (vẽ bằng quyền này, hỏi quyền khác là lời hứa suông).
export function BaoLuuSection({
  courseId,
  allowPause,
  hoSoChoDuyet,
  hoSoDangBaoLuu,
  canEdit,
}: {
  courseId: string;
  allowPause: boolean;
  hoSoChoDuyet: number;
  hoSoDangBaoLuu: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [bat, setBat] = useState(allowPause);
  const [hoi, setHoi] = useState(false);
  const [pending, start] = useTransition();
  const doi = bat !== allowPause;

  function ghi() {
    start(async () => {
      const kq = await luuChoPhepBaoLuuAction(courseId, { allowPause: bat });
      setHoi(false);
      if (!kq.ok) {
        toast.error(kq.error ?? "Không lưu được");
        return;
      }
      toast.success(bat ? "Đã cho phép bảo lưu khoá này" : "Đã tắt bảo lưu cho khoá này");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Bảo lưu</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Khoá được phép bảo lưu hay không. Khoá tắt: nút «Bảo lưu» ẩn ở hồ sơ học viên, không lập được hồ sơ mới, không tạm dừng cả lớp,
            và hồ sơ đang chờ duyệt bị từ chối khi duyệt. Hồ sơ đang bảo lưu vẫn chạy hết vòng đời.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Switch checked={bat} onCheckedChange={setBat} disabled={!canEdit || pending} aria-label="Cho phép bảo lưu khoá này" />
          {bat ? "Cho bảo lưu" : "Không bảo lưu"}
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Hiện có {hoSoChoDuyet} hồ sơ chờ duyệt và {hoSoDangBaoLuu} hồ sơ đang bảo lưu thuộc khoá này.
      </p>

      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" disabled={pending || !doi} onClick={() => (bat ? ghi() : setHoi(true))}>
            {pending ? "Đang lưu…" : "Lưu cấu hình bảo lưu"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Bạn chỉ có quyền xem cấu hình này.</p>
      )}

      <ConfirmDialog
        open={hoi}
        onOpenChange={setHoi}
        title="Tắt bảo lưu cho khoá này?"
        description={
          <>
            Hồ sơ lập mới sẽ bị chặn. <b>{hoSoChoDuyet}</b> hồ sơ đang chờ duyệt sẽ bị từ chối ở bước duyệt (cần huỷ hoặc từ chối tay).{" "}
            <b>{hoSoDangBaoLuu}</b> hồ sơ đang bảo lưu không bị ảnh hưởng.
          </>
        }
        confirmLabel="Tắt bảo lưu"
        pending={pending}
        onConfirm={ghi}
      />
    </div>
  );
}
