"use client";

// components/admin/nguon-hoa-hong/giai-thich-sheet.tsx — NGĂN «Vì sao không có hoa hồng» (Hướng G): Sheet bên phải mở từ MỘT dòng của góc nhìn «Không đủ điều kiện» (tab Sổ).
//
// Cùng khuôn với `vi-sao-sheet.tsx`: dữ liệu tải KHI MỞ (`moGiaiThichAction`), không nhét sẵn cho 50 dòng; mỗi lần mở là một lần tải mới. Ngăn đọc ẢNH CHỤP trên dòng giải thích
// (không tính lại từ chính sách hôm nay) nên giải thích đúng cả khi chính sách / chủ nguồn / cửa sổ đã đổi sau đó.
//
// Bốn trạng thái: đang tải (`role="status"`) · lỗi (câu tiếng Việt + «Thử lại»; dòng ngoài tầm nhìn nói y như dòng không tồn tại) · sẵn sàng. Esc đóng (base-ui lo).
// Hàm gọi máy chủ được TIÊM (`mo`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { moGiaiThichAction } from "@/app/(admin)/admin/nguon-hoa-hong/so/_actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { GiaiThichMo, KetQuaMoGiaiThich } from "@/lib/hoa-hong/giai-thich-ket-qua";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";

import { BTN_OUTLINE } from "./classes";
import { GiaiThichBang } from "./giai-thich-noi-dung";

type Mo = (id: string) => Promise<KetQuaMoGiaiThich>;
const MO_MAC_DINH: Mo = (id) => moGiaiThichAction({ id });

type Trang = { loai: "dang-tai" } | { loai: "loi"; thongBao: string } | { loai: "san-sang"; du: GiaiThichMo };

/** Thân ngăn khi đã có dữ liệu — tách ra để test dựng thẳng, không cần Sheet. */
export function GiaiThichThan({ du }: { du: GiaiThichMo }) {
  return (
    <div className="space-y-5 px-5 py-5">
      <div>
        <p className="text-xl font-semibold leading-tight tabular-nums text-muted-foreground">{du.nhan.hoaHong}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {du.vai} không phát sinh hoa hồng ở khoản này
          {du.tenHocVien ? ` · ${du.tenHocVien}` : ""} · kỳ {kyHienThi(du.ky)}
        </p>
      </div>
      <GiaiThichBang nhan={du.nhan} />
      {du.nhan.thayThe && <p className="text-sm text-muted-foreground">{du.nhan.thayThe}</p>}
    </div>
  );
}

export function GiaiThichSheet({
  id,
  moTa,
  children,
  triggerClassName,
  triggerAriaLabel,
  title,
  dieuHuongHang = false,
  mo = MO_MAC_DINH,
}: {
  id: string;
  /** Dòng phụ dưới tiêu đề khi mở ("Lê Thị Phương Liên · Người phụ trách nguồn"). */
  moTa: string;
  children: ReactNode;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  title?: string;
  dieuHuongHang?: boolean;
  mo?: Mo;
}) {
  const [open, setOpen] = useState(false);
  const [trang, setTrang] = useState<Trang>({ loai: "dang-tai" });

  async function tai() {
    setTrang({ loai: "dang-tai" });
    let r: KetQuaMoGiaiThich;
    try {
      r = await mo(id);
    } catch {
      r = { ok: false, error: "Không tải được ngăn này. Thử lại sau ít giây." };
    }
    setTrang(r.ok ? { loai: "san-sang", du: r.du } : { loai: "loi", thongBao: r.error });
  }

  function doiMo(moMoi: boolean) {
    setOpen(moMoi);
    if (moMoi) void tai();
  }

  return (
    <Sheet open={open} onOpenChange={doiMo}>
      <SheetTrigger aria-label={triggerAriaLabel} title={title} className={triggerClassName} data-nut-hang={dieuHuongHang ? "" : undefined}>
        {children}
      </SheetTrigger>
      {/* `admin-scope` TRÊN CHÍNH PANEL: panel render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">Vì sao không có hoa hồng</SheetTitle>
          <SheetDescription className="truncate">{trang.loai === "san-sang" ? `${trang.du.nguoiHuong ?? "Chưa rõ người"} · vai ${trang.du.vai}` : moTa}</SheetDescription>
        </SheetHeader>
        {trang.loai === "dang-tai" && (
          <div role="status" aria-live="polite" className="space-y-3 px-5 py-5">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Đang tải lý do…
            </span>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[9rem_1fr] gap-4">
                <div className="h-4 rounded bg-muted" />
                <div className="h-4 rounded bg-muted" />
              </div>
            ))}
          </div>
        )}
        {trang.loai === "loi" && (
          <div role="alert" className="space-y-3 px-5 py-5">
            <p className="text-sm text-state-danger-ink">{trang.thongBao}</p>
            <button type="button" className={BTN_OUTLINE} onClick={() => void tai()}>
              Thử lại
            </button>
          </div>
        )}
        {trang.loai === "san-sang" && <GiaiThichThan du={trang.du} />}
      </SheetContent>
    </Sheet>
  );
}
