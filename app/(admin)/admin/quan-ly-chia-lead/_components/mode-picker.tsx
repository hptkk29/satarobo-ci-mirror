"use client";
// Ô chọn CHẾ ĐỘ CHIA của một cơ sở.
//
// 30/08/2026 — dời từ màn `/leads/cau-hinh-chia` (đã xoá) về đây. Xoá màn cũ mà không
// mang ô này theo là bỏ luôn khả năng đổi chế độ: `LeadAssignmentConfig.mode` vẫn điều
// khiển đường chia, chỉ là không còn chỗ nào sửa được — cấu hình chết mà vẫn có hiệu lực.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setCenterAssignModeAction } from "../../leads/actions";

const NHAN: { ma: string; ten: string; giai: string }[] = [
  {
    ma: "ROUND_ROBIN",
    ten: "Luân phiên đều lượt",
    giai: "Chia theo sổ lượt — ai ít lượt nhất nhận trước. Mọi cơ sở đang dùng chế độ này.",
  },
  {
    ma: "CLOSE_RATE",
    ten: "Theo tỷ lệ chốt",
    giai: "Cân theo tải đang giữ và tỷ lệ chốt 30 ngày. KHÔNG tiêu lượt của sổ.",
  },
  {
    ma: "MANUAL",
    ten: "Quản lý giao tay",
    giai: "Tắt hẳn chia tự động — mọi lead vào ở trạng thái Chưa phân công.",
  },
];

export function ModePicker({
  centerId,
  mode,
  canEdit,
}: {
  centerId: string;
  mode: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const hienTai = NHAN.find((n) => n.ma === mode) ?? NHAN[0];

  if (!canEdit) {
    // Không có quyền thì vẫn PHẢI thấy chế độ đang chạy: bảng lượt bên dưới chỉ đọc
    // đúng khi biết nó đang được engine nào nuôi.
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">Chế độ chia</p>
        <p className="text-sm font-semibold text-foreground">{hienTai.ten}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hienTai.giai}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Chế độ chia</span>
        <select
          value={mode}
          disabled={pending}
          onChange={(e) => {
            const moi = e.target.value;
            start(async () => {
              const res = await setCenterAssignModeAction(centerId, moi);
              if (!res.ok) {
                toast.error(res.error ?? "Không đổi được chế độ");
                return;
              }
              toast.success("Đã đổi chế độ chia");
              router.refresh();
            });
          }}
          className="w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
        >
          {NHAN.map((n) => (
            <option key={n.ma} value={n.ma}>
              {n.ten}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">{hienTai.giai}</p>
      {mode !== "ROUND_ROBIN" && (
        <p className="mt-2 text-xs font-medium text-state-warning-ink">
          ⚠️ Chế độ này KHÔNG tiêu lượt của sổ — cột &quot;Lượt đã nhận&quot; bên dưới sẽ
          đứng yên trong khi lead vẫn được chia.
        </p>
      )}
    </div>
  );
}
