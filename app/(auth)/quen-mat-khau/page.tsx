import type { Metadata } from "next";
import { KhungXacThuc } from "@/components/public/xac-thuc/khung-xac-thuc";
import { TranhQuenMatKhau } from "@/components/public/xac-thuc/tranh-quenmatkhau";
import { BuocProvider, ThanhBuoc } from "@/components/public/xac-thuc/buoc-xac-thuc";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Quên mật khẩu",
  description: "Nhận mã xác thực qua Zalo hoặc email để đặt lại mật khẩu tài khoản Sata Robo.",
  alternates: { canonical: "https://satarobo.vn/quen-mat-khau" },
  robots: { index: false, follow: true },
};

// Giao diện CHÉP từ artifact "Forgot" (CSS: pub-design/xac-thuc.css). Thanh bước: artifact có 3 mục "Tài khoản · Xác minh · Mật khẩu mới";
// luồng thật gộp xác minh + mật khẩu mới vào một màn nên mục 2 đặt tên "Mã & mật khẩu mới", mục 3 "Hoàn tất".
export default function ForgotPasswordPage() {
  return (
    <KhungXacThuc tranh={<TranhQuenMatKhau />}>
      <BuocProvider>
        <ThanhBuoc ten="Các bước đặt lại mật khẩu" nhan={["Tài khoản", "Mã & mật khẩu mới", "Hoàn tất"]} />
        <ResetForm />
      </BuocProvider>
    </KhungXacThuc>
  );
}
