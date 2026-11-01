// app/(admin)/admin/nguon-hoa-hong/affiliate/_components/nhan-danh-muc.tsx — ô «Nhãn» của bảng đối tác: tối đa N pill, phần dư gộp «+K» (tên đầy đủ ở `title`). Nhãn đã ngừng vẫn hiện (đối tác cũ giữ nhãn) nhưng mờ hơn.
import { PILL } from "@/components/admin/nguon-hoa-hong/classes";
import type { MucDanhMuc } from "@/lib/affiliate/doc-doi-tac";
import { cn } from "@/lib/utils";

export function NhanDanhMuc({ nhan, toiDa }: { nhan: MucDanhMuc[]; toiDa: number }) {
  if (nhan.length === 0) return <span className="text-muted-foreground">—</span>;
  const hien = nhan.slice(0, toiDa);
  const du = nhan.slice(toiDa);
  return (
    <span className="flex items-center gap-1.5">
      {hien.map((n) => (
        <span key={n.id} className={cn(PILL, "max-w-[7rem] truncate bg-muted", n.dangDung ? "text-foreground" : "text-muted-foreground")} title={n.dangDung ? n.ten : `${n.ten} (đã ngừng)`}>
          {n.ten}
        </span>
      ))}
      {du.length > 0 && (
        <span className={cn(PILL, "bg-muted text-muted-foreground")} title={du.map((n) => n.ten).join(", ")}>
          +{du.length}
        </span>
      )}
    </span>
  );
}
