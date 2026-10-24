import { redirect } from "next/navigation";
import { FileSpreadsheet, ShieldAlert } from "lucide-react";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";

import { NhapGiaoDichClient } from "./_components/nhap-giao-dich-client";

export const metadata = { title: "Nhập giao dịch cũ · Sata Robo" };

/**
 * NHẬP GIAO DỊCH HỌC PHÍ CŨ từ file "Danh sách đăng ký".
 *
 * Học viên chốt trước ngày hệ thống chạy thì không có khoản thu nào, nên cổng phụ huynh
 * hiện NỢ NGUYÊN dù nhà đã đóng đủ. Màn này đưa số tiền đó vào đúng hồ sơ từng em.
 *
 * ⚠️ VÌ SAO LÀ MÀN HÌNH, KHÔNG PHẢI SCRIPT: file nguồn chứa CCCD học viên, CCCD phụ huynh
 * và địa chỉ nhà ⇒ không commit vào repo được, nên không đi đường script + GitHub
 * workflow như các đợt trước. Ở đây file được đọc NGAY TRONG TRÌNH DUYỆT và chỉ những
 * trường cần thiết mới gửi lên máy chủ (tên, SĐT, tiền, ngày, ghi chú) — ba trường nhạy
 * cảm kia không bao giờ rời máy người nhập.
 */
export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Cùng cổng với ghi nhận khoản thu — đây là hành vi GHI TIỀN.
  const ghiDuoc = await checkPermission("payments:record");

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <header className="min-w-0">
        <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-accent-ink" aria-hidden />
          Nhập giao dịch cũ
        </h1>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Đưa học phí <b className="font-semibold text-foreground">đã đóng trước khi lên hệ
          thống</b> vào đúng hồ sơ từng em, để cổng phụ huynh thôi hiện nợ. Khớp theo{" "}
          <b className="font-semibold text-foreground">số điện thoại phụ huynh + họ tên</b>{" "}
          — mã học viên trong file và mã trên hệ thống là hai hệ đánh số khác nhau.
        </p>
      </header>

      {ghiDuoc ? (
        <NhapGiaoDichClient />
      ) : (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-state-warning bg-state-warning-soft px-4 py-3"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-state-warning-ink" aria-hidden />
          <p className="text-xs leading-relaxed text-state-warning-ink">
            Bạn không có quyền <b className="font-semibold">ghi nhận khoản thu</b>{" "}
            (<code>payments:record</code>) nên không nhập được. Đây là đường ghi tiền vào
            hồ sơ học viên, cố ý gác cùng cổng với màn Thanh toán.
          </p>
        </div>
      )}
    </div>
  );
}
