import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MUC_CHU } from "./trang-thai-badge";
import type { SacThai } from "@/lib/elearning/dashboard-pure";

/**
 * KHUNG CHUNG CỦA CÁC TRANG QUẢN TRỊ / BÁO CÁO khu học tập.
 *
 * Mỗi trang trước đây tự chọn `max-w-*`, tự vẽ tiêu đề, tự vẽ khối và tự vẽ ô báo — nên hai trang cạnh nhau trên
 * thanh bên trông như hai sản phẩm. Ở đây chỉ có VẺ NGOÀI: không câu truy vấn, không quyền, không nghiệp vụ.
 * Quyền vẫn do từng trang hỏi `can()` như cũ.
 *
 * Mỗi trang có ĐÚNG MỘT `<main>` (trước: 0 — trình đọc màn hình không có đích nhảy), nên trang dùng `TrangQuanTri`
 * đừng tự thêm `<main>`.
 */

export type DoRong = "hep" | "vua" | "rong";
const RONG: Record<DoRong, string> = { hep: "max-w-3xl", vua: "max-w-5xl", rong: "max-w-6xl" };

export function TrangQuanTri({
  rong = "rong",
  children,
  className,
}: {
  /** hep = một cột biểu mẫu · vua = danh sách + biểu mẫu · rong = bảng nhiều cột */
  rong?: DoRong;
  children: React.ReactNode;
  className?: string;
}) {
  return <main className={cn("mx-auto w-full space-y-5 px-4 py-6 sm:px-6", RONG[rong], className)}>{children}</main>;
}

/** Liên kết "← về trang cha" đặt TRÊN tiêu đề của trang chi tiết. Vùng bấm ≥ 24px (WCAG 2.2 · 2.5.8). */
export function QuayLai({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-primary-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}

/**
 * Khối nội dung có tiêu đề (thẻ trắng, viền mảnh, `rounded-xl`). `tieuDe` là `h2`.
 * `sat` = bỏ đệm bên trong, dùng khi nội dung là bảng/danh sách chạy hết chiều ngang thẻ.
 */
export function Khoi({
  tieuDe,
  moTa,
  hanhDong,
  children,
  sat = false,
  id,
  className,
}: {
  tieuDe?: React.ReactNode;
  moTa?: React.ReactNode;
  hanhDong?: React.ReactNode;
  children: React.ReactNode;
  sat?: boolean;
  id?: string;
  className?: string;
}) {
  const idTieuDe = id ? `${id}-tieu-de` : undefined;
  return (
    <section id={id} aria-labelledby={tieuDe ? idTieuDe : undefined} className={cn("rounded-xl border border-border bg-card", className)}>
      {tieuDe ? (
        <header
          className={cn(
            "flex flex-col gap-2 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between",
            sat ? "border-b border-border pb-3" : "pb-0",
          )}
        >
          <div className="min-w-0">
            <h2 id={idTieuDe} className="text-base font-semibold text-foreground">
              {tieuDe}
            </h2>
            {moTa ? <p className="mt-0.5 text-sm text-muted-foreground">{moTa}</p> : null}
          </div>
          {hanhDong ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{hanhDong}</div> : null}
        </header>
      ) : null}
      <div className={cn(sat ? "" : "p-4")}>{children}</div>
    </section>
  );
}

/**
 * Trạng thái RỖNG nằm BÊN TRONG một `Khoi sat` (đã có viền thẻ) — không vẽ thẻ thứ hai lồng trong thẻ.
 * Vẫn nói VÌ SAO rỗng và LÀM GÌ TIẾP (DESIGN.md §5). Dùng `EmptyState` (có viền) khi nó đứng một mình trên trang.
 */
export function KhoiRong({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <Info className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

const ICON_GHI_CHU = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  muted: Info,
} as const;

const NEN_GHI_CHU: Record<SacThai, string> = {
  info: "border-state-info/30 bg-state-info-soft",
  success: "border-state-success/30 bg-state-success-soft",
  warning: "border-state-warning/40 bg-state-warning-soft",
  danger: "border-state-danger/30 bg-state-danger-soft",
  muted: "border-border bg-muted",
};

/**
 * Ô báo trong trang: màu KHÔNG đứng một mình — luôn có biểu tượng + chữ. `danger` là `role="alert"` (đọc ngay),
 * còn lại là `role="status"`.
 */
export function GhiChu({
  sac = "info",
  tieuDe,
  children,
  className,
}: {
  sac?: SacThai;
  tieuDe?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = ICON_GHI_CHU[sac];
  return (
    <div
      role={sac === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", NEN_GHI_CHU[sac], className)}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", MUC_CHU[sac])} aria-hidden />
      <div className="min-w-0 space-y-0.5 text-foreground">
        {tieuDe ? <p className="font-semibold">{tieuDe}</p> : null}
        {children ? <div className="text-foreground/90">{children}</div> : null}
      </div>
    </div>
  );
}

/** Ô số (KPI) — số thật, nhãn rõ; `bam` = đưa tới danh sách đã lọc. */
export function SoLieu({
  nhan,
  so,
  ghiChu,
  sac = "muted",
  href,
}: {
  nhan: string;
  so: React.ReactNode;
  ghiChu?: React.ReactNode;
  sac?: SacThai;
  href?: string;
}) {
  const noiDung = (
    <>
      {/* Nhãn XUỐNG DÒNG, không cắt: thẻ 2 cột ở 375px chỉ rộng ~160px nên "Chấm đúng hạn tháng này" bị `truncate` thành
          "Chấm đúng hạn t…" — mất đúng chữ nói chỉ số này đo cái gì. Con số bên dưới vẫn `truncate` (ngắn, và cắt số là sai hơn cắt chữ). */}
      <span className="block break-words text-xs font-medium text-muted-foreground">{nhan}</span>
      <span
        className={cn(
          "mt-1 block truncate text-2xl font-bold tabular-nums",
          sac === "danger" ? "text-state-danger-ink" : sac === "warning" ? "text-state-warning-ink" : "text-foreground",
        )}
      >
        {so}
      </span>
      {ghiChu ? <span className="mt-0.5 block text-xs text-muted-foreground">{ghiChu}</span> : null}
    </>
  );
  const lop = "min-w-0 rounded-xl border border-border bg-card px-4 py-3";
  return href ? (
    <Link
      href={href}
      className={cn(lop, "block outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {noiDung}
    </Link>
  ) : (
    <div className={lop}>{noiDung}</div>
  );
}

/** Lưới ô số: 2 cột trên điện thoại (không tràn), 4 cột từ `lg`. */
export function LuoiSoLieu({ children, cot = 4 }: { children: React.ReactNode; cot?: 3 | 4 }) {
  return <div className={cn("grid grid-cols-2 gap-3", cot === 4 ? "lg:grid-cols-4" : "sm:grid-cols-3")}>{children}</div>;
}

/** Thẻ "đi tới" — một lối tắt có mô tả. Dùng `<Link href="…" className={LIEN_KET_THE}>` để `href` ở dạng literal. */
export const LIEN_KET_THE =
  "group flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring";

export function MuiTen() {
  return <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />;
}

/** Khung bọc bảng: bo góc, viền, cắt tràn. Bảng vẫn phải nằm trong `<PhanTrangBang>` (lưới `bang-coverage`). */
export const KHUNG_BANG = "overflow-hidden rounded-xl border border-border bg-card";

/** Đầu bảng / ô / dòng — đồng bộ mật độ admin (DESIGN.md §2) nhưng cho phép chữ dài xuống dòng khi cần. */
export const TH_BANG =
  "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
export const TD_BANG = "min-w-[6.5rem] px-4 py-3 align-middle text-sm text-foreground";
export const TR_BANG = "border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40";
export const THEAD_BANG = "border-b border-border bg-muted/40";
