// lap-rap-3d-link.tsx — Nút "Lắp ráp 3D" của một bài ở tab "Tài liệu học phần".
//
// Mở tài liệu lắp ráp ZMROBO mà Đào tạo đã gắn cho bài, trong TAB MỚI. Chỉ là một liên kết ngoài:
// không đi qua SCORM, không cấp tiến độ, không ghi điểm danh/hoàn thành, và KHÔNG gắn mã học viên/lớp,
// token hay cookie vào đường dẫn — GV mở đúng thứ Đào tạo đã lưu, không hơn.
//
// An toàn: dù lúc lưu đã kiểm, ở đây kiểm LẠI bằng cùng validator (dữ liệu có thể vào DB bằng đường
// khác). Không hợp lệ ⇒ không dựng nút (không dựng href từ chuỗi chưa kiểm).
import { Box, ExternalLink } from "lucide-react";
import { safeAssemblyManualUrl } from "@/lib/lms/assembly-manual";

export type LapRap3dView = {
  url: string;
  setName: string | null;
  modelName: string | null;
};

export function LapRap3dLink({ manual }: { manual: LapRap3dView | null }) {
  const href = safeAssemblyManualUrl(manual?.url);
  if (!manual || !href) return null;

  const ten = [manual.setName, manual.modelName].filter(Boolean).join(" · ");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={ten ? `Lắp ráp 3D — ${ten}` : "Lắp ráp 3D"}
      aria-label={ten ? `Lắp ráp 3D: ${ten} (mở tab mới)` : "Lắp ráp 3D (mở tab mới)"}
      className="inline-flex items-center gap-1 rounded-md border border-primary-soft px-2.5 py-1.5 text-xs font-medium text-primary-ink hover:bg-primary-soft-hover dark:border-primary"
    >
      <Box className="h-3.5 w-3.5" aria-hidden /> Lắp ráp 3D
      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}
