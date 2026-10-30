"use client";

// components/admin/nguon-hoa-hong/vi-sao-sheet.tsx — NGĂN "Vì sao con số này" (06 §2.3, §7 "WhyDrawer"): Sheet bên phải mở từ MỘT dòng sổ.
//
// Dữ liệu tải KHI MỞ (`moViSaoAction`), không nhét sẵn cho 50 dòng — giống Sheet "Gán nguồn". Mỗi lần mở là một lần tải mới và luôn bắt đầu từ chính dòng
// được bấm. Ngăn đọc ẢNH CHỤP trên dòng sổ (không tính lại từ chính sách hôm nay).
//
// Bốn trạng thái: đang tải (khung `role="status"`) · lỗi (câu tiếng Việt + "Thử lại"; dòng ngoài tầm nhìn nói y như dòng không tồn tại) · sẵn sàng.
// Esc đóng (base-ui lo). Hàm gọi máy chủ được TIÊM (`mo`) — mặc định là Server Action; test dựng bằng hàm giả.
//
// `dieuHuongHang`: nút này là một dòng của bảng sổ ⇒ nhận ↑/↓ của `TbodyDieuHuong`.
//
// `hanhDong`: CHỖ NEO hành động theo dòng, vẽ ở chân ngăn SAU khi căn cứ đã tải (người ta chỉ khiếu nại một con số sau khi đã đọc căn cứ của nó). Hiện chưa ai gắn;
// track Khiếu nại cắm nút "Khiếu nại dòng này" qua prop `hanhDong` của `BangSo` — không sửa ngăn này. Không truyền ⇒ không vẽ gì (không khung rỗng).
import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { moViSaoAction } from "@/app/(admin)/admin/nguon-hoa-hong/so/_actions";
import type { ViSaoDayDu } from "@/lib/hoa-hong/vi-sao-day-du";
import type { KetQuaMoViSao } from "@/lib/hoa-hong/vi-sao-ket-qua";
import { BTN_OUTLINE } from "./classes";
import { ViSaoNoiDung } from "./vi-sao-noi-dung";

type Mo = (entryId: string) => Promise<KetQuaMoViSao>;
const MO_MAC_DINH: Mo = (entryId) => moViSaoAction({ entryId });

type Trang = { loai: "dang-tai" } | { loai: "loi"; thongBao: string } | { loai: "san-sang"; du: ViSaoDayDu };

export function ViSaoSheet({
  entryId,
  moTa,
  children,
  triggerClassName,
  triggerAriaLabel,
  title,
  dieuHuongHang = false,
  hanhDong,
  mo = MO_MAC_DINH,
}: {
  entryId: string;
  /** Dòng phụ dưới tiêu đề khi mở ("Lê Thị Phương Liên · Sale"). */
  moTa: string;
  children: ReactNode;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  title?: string;
  dieuHuongHang?: boolean;
  /** Chỗ neo hành động theo dòng, vẽ ở chân ngăn khi đã tải xong. */
  hanhDong?: ReactNode;
  mo?: Mo;
}) {
  const [open, setOpen] = useState(false);
  const [dangXem, setDangXem] = useState(entryId);
  const [trang, setTrang] = useState<Trang>({ loai: "dang-tai" });

  async function tai(id: string) {
    setDangXem(id);
    setTrang({ loai: "dang-tai" });
    let r: KetQuaMoViSao;
    try {
      r = await mo(id);
    } catch {
      r = { ok: false, error: "Không tải được ngăn này. Thử lại sau ít giây." };
    }
    setTrang(r.ok ? { loai: "san-sang", du: r.du } : { loai: "loi", thongBao: r.error });
  }

  function doiMo(moMoi: boolean) {
    setOpen(moMoi);
    if (moMoi) void tai(entryId);
  }

  return (
    <Sheet open={open} onOpenChange={doiMo}>
      <SheetTrigger aria-label={triggerAriaLabel} title={title} className={triggerClassName} data-nut-hang={dieuHuongHang ? "" : undefined}>
        {children}
      </SheetTrigger>
      {/* `admin-scope` TRÊN CHÍNH PANEL: panel render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">Vì sao con số này</SheetTitle>
          {/* Sau khi tải: người + vai của DÒNG ĐANG XEM (đổi theo "Xem dòng này"); trước đó: mô tả của dòng được bấm. */}
          <SheetDescription className="truncate">{trang.loai === "san-sang" ? `${trang.du.tomTat.nguoiHuong} · vai ${trang.du.tomTat.vai}` : moTa}</SheetDescription>
        </SheetHeader>
        {trang.loai === "dang-tai" && (
          <div role="status" aria-live="polite" className="space-y-3 px-5 py-5">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Đang tải căn cứ của con số…
            </span>
            {Array.from({ length: 6 }).map((_, i) => (
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
            <button type="button" className={BTN_OUTLINE} onClick={() => void tai(dangXem)}>
              Thử lại
            </button>
          </div>
        )}
        {trang.loai === "san-sang" && <ViSaoNoiDung du={trang.du} dangXem={dangXem} onXemDong={(id) => void tai(id)} />}
        {trang.loai === "san-sang" && hanhDong && dangXem === entryId && (
          // Chỉ khi đang xem CHÍNH dòng được bấm: sau "Xem dòng này" (sang dòng gốc/điều chỉnh) nút neo vẫn nói về dòng ban đầu — nói dối.
          <div data-cho-neo-hanh-dong="" className="border-t border-border px-5 py-4">
            {hanhDong}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
