// Nút "Lắp ráp 3D" của MỘT bài trong ca dạy bù — dùng chung admin + site GV (KHÔNG "use client": không state/effect).
//
// Chỉ là liên kết ngoài mở TAB MỚI tới tài liệu ZMROBO mà Đào tạo gắn cho bài: không SCORM, không tiến độ, không điểm danh, và KHÔNG gắn
// mã học viên/lớp/token vào đường dẫn. Kiểm LẠI bằng cùng validator trước khi dựng href (dữ liệu có thể vào DB bằng đường khác); không hợp lệ
// hoặc bài không gắn ⇒ trả null (không dựng nút, không báo lỗi giả).
// ⚠️ Chỉ token `:root` (border/background/foreground/muted): site GV không có `.admin-scope`, nên KHÔNG dùng `primary-soft` / `primary-ink`.
import { Box, ExternalLink } from "lucide-react";
import { safeAssemblyManualUrl } from "@/lib/lms/assembly-manual";
import type { LapRap3dBu } from "@/lib/hoc-bu/lap-rap-3d";

export function NutLapRap3d({ manual, tenBai }: { manual: LapRap3dBu | null; /** Tên bài — để nhiều nút trong một ca có tên đọc-màn-hình khác nhau. */ tenBai?: string }) {
  const href = safeAssemblyManualUrl(manual?.url);
  if (!manual || !href) return null;

  const ten = [manual.setName, manual.modelName].filter(Boolean).join(" · ");
  const dau = tenBai ? `Lắp ráp 3D — ${tenBai}` : "Lắp ráp 3D";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-lap-rap-3d
      title={ten ? `${dau}: ${ten}` : dau}
      aria-label={`${ten ? `${dau}: ${ten}` : dau} (mở tab mới)`}
      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
    >
      <Box className="size-4" aria-hidden /> Lắp ráp 3D
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}
