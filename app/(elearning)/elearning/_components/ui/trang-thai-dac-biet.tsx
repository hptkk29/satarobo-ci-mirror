import { Ban, CalendarX2, CloudOff, FileQuestion, Inbox, Lock, ShieldCheck, ToggleLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Trạng thái đặc biệt của khu e-learning (thiết kế `NvTrangThai` / `QtTrangThai`): những màn người dùng gặp khi có gì đó chặn.
 * Nguyên tắc của thiết kế: MỖI MÀN NÓI RÕ BƯỚC TIẾP THEO — nên mỗi kiểu có câu giải thích mặc định, và hành động do CHỖ GỌI
 * truyền vào (liên kết/nút thật). Component KHÔNG tự bịa đường dẫn: một nút trỏ tới trang chưa tồn tại là lời hứa suông (luật 12).
 *
 * Màu không đứng một mình: biểu tượng luôn đi kèm tiêu đề chữ. `loi-tai` là `role="alert"`, còn lại `role="status"`.
 */
export type KieuTrangThai =
  | "chan-cua-vao"
  | "can-xac-nhan"
  | "chua-duoc-giao"
  | "loi-tai"
  | "chua-san-sang"
  | "qua-han"
  | "thieu-quyen"
  | "chua-co-du-lieu"
  | "dang-tat";

type Khuon = { icon: typeof Ban; tieuDe: string; moTa: string };

/** Câu chữ mặc định — lấy từ bản thiết kế. Chỗ gọi nên truyền `moTa` cụ thể hơn khi biết (vd tên mục thiếu quyền). */
export const KHUON_TRANG_THAI: Record<KieuTrangThai, Khuon> = {
  "chan-cua-vao": {
    icon: Ban,
    tieuDe: "Chưa mở được khu đào tạo",
    moTa: "Tài khoản chưa có hồ sơ nhân sự, hoặc khu đào tạo đang tạm tắt. Báo phòng Nhân sự để được thêm hồ sơ.",
  },
  "can-xac-nhan": {
    icon: ShieldCheck,
    tieuDe: "Cần xác nhận trước khi bắt đầu",
    moTa: "Đọc và xác nhận chính sách theo dõi học tập trước khi học bài đầu tiên.",
  },
  "chua-duoc-giao": {
    icon: Inbox,
    tieuDe: "Bạn chưa được giao khoá nào",
    moTa: "Khi phòng Đào tạo hoặc quản lý giao khoá, khoá sẽ hiện ở đây kèm hạn hoàn thành.",
  },
  "loi-tai": {
    icon: CloudOff,
    tieuDe: "Không tải được trang này",
    moTa: "Có thể do mạng chập chờn. Tiến độ của bạn đã được lưu.",
  },
  "chua-san-sang": {
    icon: FileQuestion,
    tieuDe: "Bài kiểm tra chưa có đề",
    moTa: "Người soạn chưa gắn đề cho bài này. Báo với Đào tạo để họ hoàn thiện.",
  },
  "qua-han": {
    icon: CalendarX2,
    tieuDe: "Khoá đã quá hạn",
    moTa: "Liên hệ phòng Đào tạo nếu cần gia hạn.",
  },
  "thieu-quyen": {
    icon: Lock,
    tieuDe: "Bạn không có quyền vào mục này",
    moTa: "Mục này cần quyền mà tài khoản của bạn chưa có. Báo quản trị hệ thống nếu bạn cho rằng đây là nhầm lẫn.",
  },
  "chua-co-du-lieu": {
    icon: Inbox,
    tieuDe: "Chưa có dữ liệu",
    moTa: "Khi có dữ liệu mới, danh sách sẽ hiện ở đây.",
  },
  "dang-tat": {
    icon: ToggleLeft,
    tieuDe: "Tính năng đang tắt",
    moTa: "Tính năng này đang được tắt ở cấu hình hệ thống.",
  },
};

export function TrangThaiDacBiet({
  kieu,
  tieuDe,
  moTa,
  hanhDong,
  className,
}: {
  kieu: KieuTrangThai;
  /** Ghi đè tiêu đề mặc định. */
  tieuDe?: string;
  /** Ghi đè mô tả mặc định bằng câu cụ thể hơn (bắt buộc nói rõ bước tiếp theo). */
  moTa?: React.ReactNode;
  /** Liên kết/nút THẬT. Không truyền thì không vẽ — không có nút trỏ vào hư không. */
  hanhDong?: React.ReactNode;
  className?: string;
}) {
  const k = KHUON_TRANG_THAI[kieu];
  const Icon = k.icon;
  return (
    <section
      role={kieu === "loi-tai" ? "alert" : "status"}
      data-kieu={kieu}
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center gap-2 rounded-2xl border border-border bg-card px-6 py-10 text-center",
        className,
      )}
    >
      <span aria-hidden className="mb-1 inline-flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <h2 className="text-base font-medium text-foreground">{tieuDe ?? k.tieuDe}</h2>
      <p className="text-sm leading-5 text-muted-foreground">{moTa ?? k.moTa}</p>
      {hanhDong ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{hanhDong}</div> : null}
    </section>
  );
}
