import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ChangePasswordForm } from "./change-form";

export const metadata: Metadata = { title: "Đổi mật khẩu" };

// BGĐ 31/07 — trang đổi MK BẮT BUỘC sau khi được admin cấp/reset mật khẩu.
// Layout admin/teacher redirect về đây khi User.mustChangePassword bật; đổi xong
// cờ tắt → vào lại hệ thống bình thường. Card "Waves" đồng bộ login/kich-hoat.
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
    <div className="my-form">
      <div className="login-welcome-row">
        <Image
          src="/brand/logo-satarobo.png"
          alt="Sata Robo"
          width={484}
          height={280}
          priority
          className="mx-auto mb-4 block h-16 w-auto object-contain"
        />
        <h1>Đổi mật khẩu</h1>
        <p>Vì lý do bảo mật, bạn cần đặt mật khẩu mới trước khi tiếp tục.</p>
      </div>

      <ChangePasswordForm />
    </div>
  );
}
