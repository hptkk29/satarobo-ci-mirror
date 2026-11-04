// Nhãn trạng thái kết nối AI. Component THUẦN HIỂN THỊ (dùng được ở server lẫn client).
//
// LUẬT XANH: màu xanh chỉ do cờ `xanh` / `dat` quyết định — những cờ mà `ket-noi-thuan.ts` chỉ bật khi có bằng chứng PASS còn hạn. Component KHÔNG tự
// suy xanh từ tên nhãn: truyền `nhan="CONNECTED"` mà `xanh={false}` vẫn ra màu trung tính. Mặc định (thiếu cờ) = KHÔNG xanh. Trạng thái không chỉ mã hoá bằng
// màu: nhãn luôn có chữ (DESIGN.md — Accessibility).
import { cn } from "@/lib/utils";
import type { KetQuaTinhTrang, MucTang, NhanKetNoi, TangKiemChung } from "@/lib/ai-lead/dich-vu/ket-noi-thuan";

export type Tone = "success" | "warning" | "danger" | "info" | "muted";

const LOP_TONE: Record<Tone, string> = {
  success: "bg-state-success-soft text-state-success-ink",
  warning: "bg-state-warning-soft text-state-warning-ink",
  danger: "bg-state-danger-soft text-state-danger-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-muted-foreground",
};

export const CHU_NHAN: Record<NhanKetNoi, string> = {
  UNVERIFIED: "Chưa xác minh",
  CONNECTED: "Đã kết nối",
  E2E_VERIFIED: "Đã kiểm chứng đầu-cuối",
  PROD_LIVE_VERIFIED: "Đã chạy thật trên PROD",
  STALE: "Mất nhịp",
  DEGRADED: "Suy giảm",
  DISCONNECTED: "Đã ngắt",
  INCOMPATIBLE: "Không tương thích",
  PAUSED: "Tạm dừng",
  BLOCKED: "Bị chặn",
};

const TONE_KHONG_XANH: Record<NhanKetNoi, Tone> = {
  UNVERIFIED: "muted",
  // Ba nhãn xanh: nếu cờ `xanh` không bật thì rơi về trung tính, không phải cảnh báo.
  CONNECTED: "muted",
  E2E_VERIFIED: "muted",
  PROD_LIVE_VERIFIED: "muted",
  STALE: "warning",
  DEGRADED: "warning",
  DISCONNECTED: "danger",
  INCOMPATIBLE: "danger",
  PAUSED: "info",
  BLOCKED: "danger",
};

function Vien({ tone, children, ...rest }: { tone: Tone; children: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex max-w-full items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        LOP_TONE[tone],
        rest.className,
      )}
    >
      {children}
    </span>
  );
}

/** Nhãn TỔNG HỢP của một agent / một Page. */
export function NhanTong({ ketQua, className }: { ketQua: Pick<KetQuaTinhTrang, "nhan" | "xanh">; className?: string }) {
  const tone: Tone = ketQua.xanh === true ? "success" : TONE_KHONG_XANH[ketQua.nhan];
  return (
    <Vien tone={tone} data-nhan={ketQua.nhan} data-xanh={ketQua.xanh === true ? "true" : "false"} className={className}>
      {CHU_NHAN[ketQua.nhan]}
    </Vien>
  );
}

export const CHU_MUC: Record<MucTang, string> = {
  DAT: "Đạt",
  HET_HAN: "Hết hạn",
  CHUA_CHAY: "Chưa chạy",
  CHI_GIA_LAP: "Chỉ giả lập",
  THAT_BAI: "Thất bại",
  BI_CHAN: "Bị chặn",
  BLOCKED_BY_AGENT_TEAM: "Chờ đội Agent",
  BLOCKED_BY_OWNER: "Chờ chủ dự án",
  CHO_CHU_KY: "Chờ chữ ký",
  KHONG_AP_DUNG: "Không áp dụng",
};

const TONE_MUC: Record<MucTang, Tone> = {
  DAT: "muted", // chỉ thành xanh khi `dat === true`
  HET_HAN: "warning",
  CHUA_CHAY: "muted",
  CHI_GIA_LAP: "muted",
  THAT_BAI: "danger",
  BI_CHAN: "danger",
  BLOCKED_BY_AGENT_TEAM: "info",
  BLOCKED_BY_OWNER: "info",
  CHO_CHU_KY: "warning",
  KHONG_AP_DUNG: "muted",
};

/** Nhãn MỘT TẦNG (L1–L4). Xanh ⇔ `dat === true`. */
export function NhanTang({ tang, className }: { tang: Pick<TangKiemChung, "muc" | "dat">; className?: string }) {
  const tone: Tone = tang.dat === true ? "success" : TONE_MUC[tang.muc];
  return (
    <Vien tone={tone} data-muc={tang.muc} data-xanh={tang.dat === true ? "true" : "false"} className={className}>
      {CHU_MUC[tang.muc]}
    </Vien>
  );
}

export function NhanDon({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  // Đường dành cho nhãn KHÔNG phải trạng thái kết nối (môi trường, bật/tắt…). Cấm `success` ở đây: xanh chỉ đến từ bằng chứng.
  const t: Tone = tone === "success" ? "muted" : tone;
  return (
    <Vien tone={t} className={className}>
      {children}
    </Vien>
  );
}

/**
 * Nhãn trạng thái của HỒ SƠ (không phải trạng thái kết nối): đủ năm tông, chữ dùng bậc `-ink` (đo ≥ 4,5:1 trên nền soft).
 * Thay `StatusPill` dùng chung cho màn AI Lead — StatusPill tô chữ bằng `--state-*` gốc (cam #f59e0b trên nền nhạt chỉ 1,9:1; axe: color-contrast serious).
 * Xanh ở đây nghĩa là «đã tạo lead / trong hạn» — KHÔNG liên quan luật xanh của kết nối (`NhanDon` vẫn cấm `success`).
 */
export function ViTrang({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Vien tone={tone} className={cn("shrink-0", className)}>
      {children}
    </Vien>
  );
}
