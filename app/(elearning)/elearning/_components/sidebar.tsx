"use client";

// Thanh bên QUẢN TRỊ — dựng theo `03-quan-tri/QtKhoaHoc.html` (`.side`): nền `--side`, rộng 260px, thương hiệu (logo tròn) ở đầu, các mục chia NHÓM có nhãn nhỏ,
// mục đang mở nổi trên nền thẻ với vạch tím bên trái, "Phạm vi dữ liệu" ở đáy. CHỈ VẼ: quyền nằm ở `menu.ts` (hàm thuần) + `can()` ở layout/trang; việc xếp nhóm ở
// `nhom-thanh-ben.ts`.
//
// Hai thứ chia sẻ giữa bản cố định (desktop) và bản trong ngăn kéo (điện thoại): `SidebarContent`. Mục đang mở suy từ ĐƯỜNG DẪN (không lưu state) ⇒ F5, quay lại, mở
// link từ thông báo đều ra đúng mục.
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Award,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  FileText,
  FolderTree,
  Gauge,
  Grid3x3,
  LayoutDashboard,
  Library,
  ListChecks,
  PencilRuler,
  Send,
  ShieldCheck,
  Store,
  Workflow,
  Bell,
  type LucideIcon,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mucDangMo, type BieuTuong, type KhuMenu } from "./menu";
import { nhomThanhBen } from "./nhom-thanh-ben";
import { LienKet, laTrangBai } from "./lien-ket";

const ICON: Record<BieuTuong, LucideIcon> = {
  "tong-quan": LayoutDashboard,
  khoa: BookOpen,
  "chung-nhan": Award,
  "du-lieu": ShieldCheck,
  "chuong-trinh": Library,
  soan: PencilRuler,
  "cau-hoi": FileQuestion,
  "de-thi": FileText,
  "khung-cham": ListChecks,
  "giao-bai": Send,
  "luot-giao": CalendarDays,
  "cham-bai": ClipboardCheck,
  "cham-thi": ClipboardList,
  "yeu-cau": CalendarClock,
  "co-so": Building2,
  "bao-cao": BarChart3,
  "phong-ban": Building2,
  "ket-qua": ClipboardCheck,
  "ma-tran": Grid3x3,
  "nguoi-hoc": Users,
  "hieu-qua": Gauge,
  "tu-dong": Workflow,
  "danh-gia": ListChecks,
  "thong-bao": Bell,
  "khoa-online": Store,
  "danh-muc": FolderTree,
};

export function SidebarContent({
  khu,
  phamVi,
  onNavigate,
}: {
  /** Các khu QUẢN TRỊ người này thấy (đã lọc theo quyền). */
  khu: KhuMenu[];
  /** "Phạm vi dữ liệu" ở đáy thanh bên — do layout suy từ QUYỀN (toàn hệ thống / cơ sở); không truyền ⇒ không vẽ (không bịa phạm vi). */
  phamVi?: string;
  /** Đóng ngăn kéo khi bấm một mục. */
  onNavigate?: () => void;
}) {
  const duongDan = usePathname() ?? "/elearning";
  // Đang ở trang một BÀI: rời đi bằng tải trang đầy đủ để bộ đo đọc/xem kịp gửi nhịp cuối (xem `lien-ket.tsx`).
  const toanTrang = laTrangBai(duongDan);
  const dangMo = mucDangMo(khu, duongDan);
  const nhom = nhomThanhBen(khu);
  if (nhom.length === 0) return null;

  return (
    <div className="flex h-full flex-col gap-0.5 overflow-y-auto bg-[var(--el-side)] px-3 pb-5 pt-4">
      <LienKet
        toanTrang={toanTrang}
        href="/elearning"
        onClick={onNavigate}
        className="flex items-center gap-2.5 rounded-lg px-2 pb-4 pt-1 text-primary-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Cổng Elearning · Sata Robo — trang tổng quan"
      >
        <Image src="/brand/logo-satarobo-tron.png" alt="" width={32} height={32} className="size-8 flex-none rounded-full" />
        <span className="text-[15px] font-medium leading-[18px]">
          Cổng Elearning
          <span className="block text-[13px] font-normal leading-4 text-[color:var(--el-text2)]">Sata Robo</span>
        </span>
      </LienKet>

      <nav aria-label="Quản trị e-learning" className="flex flex-col gap-0.5">
        {nhom.map((g) => (
          <div key={g.nhan ?? "dau"} className="flex flex-col gap-0.5">
            {g.nhan ? <p className="px-2.5 pb-1.5 pt-5 text-xs leading-4 text-muted-foreground">{g.nhan}</p> : null}
            {g.muc.map((m) => {
              const Icon = ICON[m.bieuTuong];
              const mo = dangMo?.href === m.href;
              return (
                <LienKet
                  key={m.href}
                  toanTrang={toanTrang}
                  href={m.href}
                  onClick={onNavigate}
                  aria-current={mo ? "page" : undefined}
                  className={cn(
                    "flex h-[34px] items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring max-[1000px]:h-11",
                    mo
                      ? "bg-card font-medium text-foreground shadow-[inset_2px_0_0_var(--el-fill),0_1px_2px_rgba(0,0,0,0.05)]"
                      : "text-[color:var(--el-text2)] hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="size-[18px] flex-none text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 truncate">{m.nhan}</span>
                </LienKet>
              );
            })}
          </div>
        ))}
      </nav>

      {phamVi ? (
        <div className="mt-auto border-t border-border px-2.5 pt-3 text-[13px] leading-[18px]">
          <span className="block text-xs leading-4 text-muted-foreground">Phạm vi dữ liệu</span>
          {phamVi}
        </div>
      ) : null}
    </div>
  );
}
