// components/cham-cong/ui/shift-code-chip.tsx — mã ca của MỘT ô lịch, kèm nguồn của ô.
//
// Vì sao file này tồn tại: lưới phân ca cũ nhuộm nền ô bằng 4 lớp màu Tailwind rời (ngoài token)
// và chỉ nói nguồn qua `title` — người mù màu (và ảnh chụp đen trắng gửi kế toán) không phân biệt
// được ô "sửa tay" với ô "từ đơn đổi ca". Nay mỗi nguồn có KÝ HIỆU MỘT CHỮ đọc được + nhãn đầy đủ
// trong `aria-label`, dùng lại y hệt ở lưới tháng, khung ca tuần, bảng công ngày và lịch ca site GV.
//
// Thư mục này site GV mount chung ⇒ CHỈ token `:root` (state-*, muted, card, border, foreground).
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type ShiftSource = "PATTERN" | "IMPORT" | "MANUAL" | "SWAP" | "LEAVE" | "HOLIDAY";

/**
 * `mark` = ký hiệu 1 chữ hiện trên chip; `label` = phần đuôi của `aria-label`.
 * PATTERN/IMPORT là nguồn "bình thường" nên không đeo ký hiệu — chỉ 4 nguồn CAN THIỆP mới nổi lên.
 */
const SOURCE: Record<ShiftSource, { mark: string | null; label: string; cls: string }> = {
  PATTERN: { mark: null, label: "theo khung ca", cls: "border-border bg-card text-foreground" },
  IMPORT: { mark: null, label: "từ file import", cls: "border-border bg-card text-foreground" },
  MANUAL: {
    mark: "T",
    label: "sửa tay",
    cls: "border-state-warning-soft bg-state-warning-soft text-state-warning-ink",
  },
  SWAP: {
    mark: "Đ",
    label: "từ đơn đổi ca",
    cls: "border-state-info-soft bg-state-info-soft text-state-info-ink",
  },
  LEAVE: {
    mark: "N",
    label: "nghỉ phép",
    cls: "border-state-success-soft bg-state-success-soft text-state-success-ink",
  },
  HOLIDAY: {
    mark: "L",
    label: "ngày lễ",
    cls: "border-state-danger-soft bg-state-danger-soft text-state-danger-ink",
  },
};

const NEUTRAL = "border-border bg-card text-muted-foreground";
const FOREIGN = "border-dashed border-border bg-muted text-muted-foreground";

export function ShiftCodeChip({
  code,
  source,
  foreignUnit,
  size = "md",
  className,
  gio,
}: {
  code: string | null;
  source?: ShiftSource;
  /**
   * Định nghĩa ca dạng một dòng — `motDongGioCa()` trong `lib/cham-cong/gio-ca.ts`.
   *
   * Chốt 25/09/2026: QLCS đứng trước lưới toàn `CG` `CS` `HC` phải mở màn Cấu hình mới biết
   * mã nào mấy giờ. Chip là component DUY NHẤT vẽ mã ca (10 màn, cả site GV), nên cắm ở đây
   * là mọi màn cùng được — rê chuột một ô là ra giờ vào/ra.
   *
   * Tuỳ chọn: màn chưa nạp danh mục thì chip vẫn chạy như cũ, chỉ không có phần giờ.
   */
  gio?: string | null;
  /** Ô thuộc khối khác (người CS2 mượn sang lịch CS1): chỉ đọc, không sửa được ở màn này. */
  foreignUnit?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const src = source ? SOURCE[source] : null;
  // Ô của khối khác luôn mang màu trung tính + viền đứt: người xem thấy ngay "không phải việc của tôi".
  const tone = foreignUnit ? FOREIGN : code ? (src?.cls ?? NEUTRAL) : NEUTRAL;

  const label =
    (code ? `Ca ${code}` : "Chưa xếp ca") +
    (code && src ? `, ${src.label}` : "") +
    (foreignUnit ? `, thuộc khối ${foreignUnit} — chỉ xem` : "");

  // Giờ ca xuống DÒNG RIÊNG trong tooltip: `title` ngắt dòng bằng ký tự xuống dòng, và gộp
  // một dòng dài thì phần "sửa tay / đơn đổi ca" bị đẩy ra xa, đúng chỗ hay đọc hụt.
  const tip = code && gio ? [label, gio].join(String.fromCharCode(10)) : label;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 font-mono font-semibold tabular-nums",
        size === "sm" ? "h-6 text-xs" : "h-7 text-sm",
        tone,
        className,
      )}
      aria-label={code && gio ? `${label}. ${gio}` : label}
      title={tip}
    >
      <span>{code ?? "—"}</span>
      {code && src?.mark && !foreignUnit && (
        <span aria-hidden className="font-sans text-[10px] leading-none">
          {src.mark}
        </span>
      )}
      {foreignUnit && (
        <>
          <ArrowRight aria-hidden className="h-3 w-3" />
          <span className="font-sans text-[10px] leading-none">{foreignUnit}</span>
        </>
      )}
    </span>
  );
}

const LEGEND: { source: ShiftSource; text: string }[] = [
  { source: "PATTERN", text: "theo khung ca" },
  { source: "IMPORT", text: "từ file import" },
  { source: "MANUAL", text: "sửa tay" },
  { source: "SWAP", text: "đơn đổi ca" },
  { source: "LEAVE", text: "nghỉ phép" },
  { source: "HOLIDAY", text: "ngày lễ" },
];

/** Chú giải 7 chip mẫu — đặt dưới lưới phân ca để ký hiệu T/Đ/N/L không phải đoán. */
export function SourceLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground", className)}>
      <span className="font-semibold text-foreground">Nguồn ô:</span>
      {LEGEND.map((l) => (
        <span key={l.source} className="inline-flex items-center gap-1.5">
          <ShiftCodeChip code="S" source={l.source} size="sm" />
          {l.text}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <ShiftCodeChip code="S" foreignUnit="CS2" size="sm" />
        khối khác, chỉ xem
      </span>
    </div>
  );
}
