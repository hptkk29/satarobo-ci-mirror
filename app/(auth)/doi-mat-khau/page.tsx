import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { KhungXacThuc } from "@/components/public/xac-thuc/khung-xac-thuc";
import { TranhDangNhap } from "@/components/public/xac-thuc/tranh-dangnhap";
import { ChangePasswordForm } from "./change-form";

export const metadata: Metadata = {
  title: "Đổi mật khẩu",
  robots: { index: false, follow: false },
};

// BGĐ 31/07 — trang đổi MK BẮT BUỘC sau khi được admin cấp/reset mật khẩu.
// Layout admin/teacher redirect về đây khi User.mustChangePassword bật; đổi xong
// cờ tắt → vào lại hệ thống bình thường. Artifact không có bản vẽ riêng cho màn này:
// dùng khung + cột trái của "Login" và các lớp `.fld`/`.inp`/`.btn` của artifact.
export default async function ForceChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true },
  });
  // Không còn bị bắt đổi (hoặc user biến mất) → về khu làm việc.
  if (!user?.mustChangePassword) redirect("/dashboard");

  return (
    <KhungXacThuc tranh={<TranhDangNhap />}>
      <h1>
        Đổi <span className="grad">mật khẩu</span>
      </h1>
      <p style={{ margin: "6px 0 18px", color: "var(--muted)" }}>Vì lý do bảo mật, bạn cần đặt mật khẩu mới trước khi tiếp tục.</p>
      <ChangePasswordForm />
    </KhungXacThuc>
  );
}
