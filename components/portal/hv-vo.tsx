import { PortalAppearanceProvider } from "@/components/portal/appearance-provider";
import { HvShell } from "@/components/portal/hv-shell";
import { docHvVo } from "@/lib/portal/hv-du-lieu";

// Vỏ Cổng học sinh phía máy chủ: nạp số liệu cho menu bên / thanh trên (SataCoin, tin mới, việc cần làm) rồi bọc thân trang.
// Dùng role "parent" cho bộ chọn giao diện: bảng màu Cổng học sinh dùng token --sr-* chung của .portal-v2 (sáng/tối), không dùng màu nhấn riêng.
export async function HvVo({ studentId, ten, children }: { studentId: string; ten: string; children: React.ReactNode }) {
  const vo = await docHvVo(studentId, ten);
  return (
    <PortalAppearanceProvider role="parent" className="portal-v2 min-h-screen bg-background text-foreground">
      <HvShell {...vo}>{children}</HvShell>
    </PortalAppearanceProvider>
  );
}
