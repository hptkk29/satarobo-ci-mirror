// Khung tab CON của Cấu hình (S5b): thanh tab con (tự ẩn khi chưa có từ hai mục thật) + trang. Không gác quyền, không
// nạp dữ liệu — cổng quyền của từng tab con ở chính trang của nó (CLAUDE.md luật 5).
import { Suspense } from "react";
import { CauHinhTabs } from "./_components/cau-hinh-tabs";

export default function CauHinhLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <CauHinhTabs />
      </Suspense>
      {children}
    </>
  );
}
