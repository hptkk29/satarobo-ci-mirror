"use client";

// Nút "Xuất Excel" của Lưới phân ca — CHỌN cơ sở trước khi tải (chủ dự án 07/10/2026:
// "nút xuất phải được lựa chọn xuất cho cơ sở nào chứ?").
//
// Danh sách cơ sở do TRANG truyền xuống = đúng những khối người này XEM được lưới (cổng mà route
// cũng kiểm lại theo từng khối) — không bày khối bấm vào chắc chắn bị từ chối (luật 12).
// "Tất cả" chỉ hiện khi có từ HAI khối trở lên.
import { ChevronDown, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const URL_XUAT = "/api/admin/cham-cong/phan-ca/export";

export function duongXuatLuoi(ky: string, coSo: readonly string[]): string {
  return `${URL_XUAT}?ky=${encodeURIComponent(ky)}&coSo=${coSo.map(encodeURIComponent).join(",")}`;
}

export function NutXuatLuoiPhanCa({
  ky,
  kyLabel,
  khoi,
  dangXem,
  className,
}: {
  ky: string;
  /** "tháng 10/2026" */
  kyLabel: string;
  khoi: { id: string; label: string }[];
  /** Khối đang mở trên màn — đánh dấu để người dùng biết. */
  dangXem: string;
  className?: string;
}) {
  if (khoi.length === 0) return null;
  // Tải tệp bằng điều hướng: route trả `Content-Disposition: attachment` nên trang hiện tại giữ nguyên.
  const tai = (coSo: readonly string[]) => {
    window.location.href = duongXuatLuoi(ky, coSo);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className} aria-label={`Xuất Excel lưới phân ca ${kyLabel} — chọn cơ sở`}>
        <FileSpreadsheet className="h-4 w-4" aria-hidden /> Xuất Excel
        <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 min-w-64">
        {/* Group BẮT BUỘC quanh Label: Menu.GroupLabel của base-ui ném lỗi nếu không có Group bọc. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-semibold text-foreground">
            Xuất lưới phân ca {kyLabel}
          </DropdownMenuLabel>
          {khoi.map((k) => (
            <DropdownMenuItem key={k.id} onClick={() => tai([k.id])} className="h-9 text-sm">
              <span className="min-w-0 flex-1 truncate">{k.label}</span>
              {k.id === dangXem && <span className="shrink-0 text-xs text-muted-foreground">đang xem</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {khoi.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => tai(khoi.map((k) => k.id))}
              className={cn("h-9 text-sm font-medium")}
              title="Gộp mọi cơ sở vào MỘT tệp, có cột Cơ sở để lọc"
            >
              Tất cả {khoi.length} cơ sở (một tệp)
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
