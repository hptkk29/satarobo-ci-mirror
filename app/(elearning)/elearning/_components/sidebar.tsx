"use client";

// Thanh bên khu học tập nội bộ — CHỈ VẼ. Quyền nằm ở `menu.ts` (hàm thuần) + `can()` ở layout/trang.
//
// Hai thứ chia sẻ giữa bản cố định (desktop) và bản trong ngăn kéo (điện thoại): `SidebarContent`. Khu làm việc
// đang mở suy từ ĐƯỜNG DẪN (không lưu state) ⇒ F5, quay lại, mở link từ thông báo đều ra đúng khu, và không có
// trạng thái nào để lệch với trang đang xem.
import { usePathname } from "next/navigation";
import {
  Award,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  FileText,
  Gauge,
  GraduationCap,
  Grid3x3,
  LayoutDashboard,
  Library,
  ListChecks,
  PencilRuler,
  Send,
  ShieldCheck,
  Settings2,
  Workflow,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { khuDangMo, mucDangMo, type BieuTuong, type KhuId, type KhuMenu } from "./menu";
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
  "cham-bai": ClipboardCheck,
  "cham-thi": ClipboardList,
  "yeu-cau": CalendarClock,
  "co-so": Building2,
  "bao-cao": BarChart3,
  "phong-ban": Building2,
  "ket-qua": ClipboardCheck,
  "ma-tran": Grid3x3,
  "hieu-qua": Gauge,
  "tu-dong": Workflow,
  "danh-gia": ListChecks,
  "thong-bao": Bell,
};

const ICON_KHU: Record<KhuId, LucideIcon> = {
  "hoc-tap": BookOpen,
  "dao-tao": PencilRuler,
  "co-so": Building2,
  "bao-cao": BarChart3,
  "quan-tri": Settings2,
};

export function SidebarContent({
  khu,
  thuGon = false,
  onToggleThuGon,
  onNavigate,
}: {
  khu: KhuMenu[];
  /** Chỉ biểu tượng — chỉ dùng ở bản cố định trên desktop. Bản ngăn kéo luôn đầy đủ. */
  thuGon?: boolean;
  onToggleThuGon?: () => void;
  /** Đóng ngăn kéo khi bấm một mục. */
  onNavigate?: () => void;
}) {
  const duongDan = usePathname() ?? "/elearning";
  // Đang ở trang một BÀI: rời đi bằng tải trang đầy đủ để bộ đo đọc/xem kịp gửi nhịp cuối (xem `lien-ket.tsx`).
  const toanTrang = laTrangBai(duongDan);
  const idKhu = khuDangMo(khu, duongDan);
  const dangMo = mucDangMo(khu, duongDan);
  const khuHienTai = khu.find((k) => k.id === idKhu) ?? khu[0];
  if (!khuHienTai) return null;
  const nhieuKhu = khu.length > 1;

  return (
    <div className="flex h-full flex-col bg-card">
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2 border-b border-border px-4",
          thuGon && "justify-center px-2",
        )}
      >
        <LienKet
          toanTrang={toanTrang}
          href="/elearning"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Học tập nội bộ — trang tổng quan"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          {thuGon ? null : (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-foreground">Học tập nội bộ</span>
              <span className="block truncate text-xs text-muted-foreground">Sata Robo</span>
            </span>
          )}
        </LienKet>
      </div>

      <nav aria-label="Điều hướng khu học tập" className="flex-1 overflow-y-auto px-2 py-3">
        {nhieuKhu ? (
          <div className="mb-3">
            {thuGon ? null : (
              <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Khu làm việc
              </p>
            )}
            <ul className="space-y-0.5">
              {khu.map((k) => {
                const Icon = ICON_KHU[k.id];
                const dich = k.muc[0]?.href ?? "/elearning";
                const mo = k.id === idKhu;
                return (
                  <li key={k.id}>
                    <LienKet
                      toanTrang={toanTrang}
                      href={dich}
                      onClick={onNavigate}
                      aria-current={mo ? "true" : undefined}
                      title={thuGon ? k.nhan : undefined}
                      aria-label={thuGon ? `Khu ${k.nhan}` : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring lg:min-h-10",
                        thuGon && "justify-center px-0",
                        mo
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {thuGon ? null : (
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{k.nhan}</span>
                        </span>
                      )}
                    </LienKet>
                  </li>
                );
              })}
            </ul>
            <div className="mx-2 mt-3 border-t border-border" />
          </div>
        ) : null}

        <p
          className={cn(
            "px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
            thuGon && "sr-only",
          )}
        >
          {khuHienTai.nhan}
        </p>
        <ul className="space-y-0.5">
          {khuHienTai.muc.map((m) => {
            const Icon = ICON[m.bieuTuong];
            const mo = dangMo?.href === m.href && dangMo.khu === khuHienTai.id;
            return (
              <li key={m.href}>
                <LienKet
                  toanTrang={toanTrang}
                  href={m.href}
                  onClick={onNavigate}
                  aria-current={mo ? "page" : undefined}
                  title={thuGon ? m.nhan : undefined}
                  aria-label={thuGon ? m.nhan : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring lg:min-h-10",
                    thuGon && "justify-center px-0",
                    mo
                      ? "bg-primary-soft font-semibold text-primary-ink"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {thuGon ? null : <span className="min-w-0 truncate">{m.nhan}</span>}
                </LienKet>
              </li>
            );
          })}
        </ul>
      </nav>

      {onToggleThuGon ? (
        <div className="hidden shrink-0 border-t border-border p-2 lg:block">
          <button
            type="button"
            onClick={onToggleThuGon}
            aria-pressed={thuGon}
            aria-label={thuGon ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
            title={thuGon ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
            className={cn(
              "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              thuGon && "justify-center px-0",
            )}
          >
            {thuGon ? (
              <ChevronsRight className="h-4 w-4" aria-hidden />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" aria-hidden />
                <span>Thu gọn</span>
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
