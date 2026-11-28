"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChonNhieu } from "./use-chon-nhieu";

/**
 * Thanh chọn nhiều (HANDOFF §4): ô "Chọn tất cả" · "Đã chọn n" · thao tác hàng loạt (children) · "Bỏ chọn".
 * Ô chọn tất cả có trạng thái `indeterminate` khi mới chọn một phần. Hiện cả khi chưa chọn dòng nào — người dùng phải
 * thấy được lối vào chọn hàng loạt, thao tác (children) thì chỉ vẽ khi đã có dòng được chọn.
 */
export function ThanhChonNhieu({
  chon,
  tenDonVi,
  children,
  className,
}: {
  chon: ChonNhieu;
  /** Tên đơn vị cho nhãn, vd "người học". */
  tenDonVi: string;
  /** Nút thao tác hàng loạt; chỉ hiện khi đã chọn ít nhất một dòng. */
  children?: React.ReactNode;
  className?: string;
}) {
  const coChon = chon.soDangChon > 0;
  return (
    <div
      role="group"
      aria-label={`Chọn nhiều ${tenDonVi}`}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-[10px] border border-border px-3 py-2.5",
        coChon ? "bg-primary-soft" : "bg-card",
        className,
      )}
    >
      <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={chon.trangThai === "tat-ca"}
          indeterminate={chon.trangThai === "mot-phan"}
          onCheckedChange={() => chon.chonTatCa()}
          aria-label={`Chọn tất cả ${tenDonVi} đang hiển thị`}
        />
        Chọn tất cả
      </label>
      <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {coChon ? `Đã chọn ${chon.soDangChon} ${tenDonVi}` : `Chưa chọn ${tenDonVi} nào`}
      </span>
      {chon.chamTran && (
        <span role="alert" className="text-xs text-state-warning-ink">
          Mỗi lượt chọn tối đa {chon.tran} {tenDonVi}.
        </span>
      )}
      {coChon && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          <Button type="button" variant="ghost" size="sm" onClick={() => chon.boChon()}>
            Bỏ chọn
          </Button>
        </div>
      )}
    </div>
  );
}
