// app/(admin)/admin/lop-trial/layout.tsx
//
// Khung chung của màn "Lớp Trial". CỐ Ý không gác quyền ở đây: gate đặt ở từng page
// (rẻ vì `resolveActor` cache theo request) để không phụ thuộc thứ tự chạy layout/page,
// và để mỗi page tự quyết redirect đi đâu.
//
// 28/08/2026 — GỠ thanh tab. Màn từng có hai mặt phẳng ("Lớp trải nghiệm" V2 và "Lịch
// hẹn học thử" V1); mặt phẳng V1 đã bị gỡ khỏi hệ thống nên chỉ còn một, mà một tab thì
// không phải tab — nó là một cái nhãn thừa chiếm chỗ và mời người dùng đi tìm cái thứ hai.
import type { ReactNode } from "react";
import { PageHelp } from "@/components/admin/ui/page-help";

export const metadata = { title: "Lớp Trial | Admin" };

export default function LopTrialLayout({ children }: { children: ReactNode }) {
  return (
    // 23/09 — CĂN GIỮA; điện thoại không thêm lề ngang (khung admin đã có lề 16px). Trước đó khung neo trái: ở màn siêu
    // rộng mọi thứ dồn về mép trái, bên phải là một vùng trống rộng gấp nhiều lần nội dung.
    <div className="mx-auto w-full max-w-6xl py-4 sm:p-6 2xl:max-w-7xl">
      <h1 className="mb-1 text-2xl font-bold text-foreground">Lớp Trial</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Quản lý cơ sở mở lớp theo ngày + khung giờ → mỗi Sale thêm case của mình → xếp học
        viên vào case → điểm danh.
      </p>

      <PageHelp>
        {/* 23/09 — hai câu cũ ("tạo lớp chỉ cần cơ sở và khoá", "thêm học viên là em học
            toàn bộ buổi") nói ngược với màn theo khung ngay bên dưới: lớp nay mở theo ngày +
            khung, và bé chưa chọn case thì nằm ở khối "Chưa xếp case". Câu thứ hai VẪN ĐÚNG
            cho lớp cũ — nên nói theo loại lớp, không xoá. */}
        <p>
          <strong>Lớp theo khung giờ:</strong> Quản lý cơ sở mở lớp theo ngày + khung giờ.
          Trong khung đó, mỗi Sale <strong>thêm case</strong> của mình (giờ, phòng, giáo
          viên) rồi xếp học viên vào case. Bé chưa chọn case nằm ở khối{" "}
          <strong>Chưa xếp case</strong> và chưa ai điểm danh được.
        </p>
        <p className="mt-2">
          <strong>Lớp cũ (không có khung giờ):</strong> thêm một học viên vào lớp là em đó
          học <strong>toàn bộ buổi</strong> của lớp, kể cả buổi tạo sau.
        </p>
        <p className="mt-2">
          Đổi lịch hoặc huỷ một buổi phải <strong>ghi lý do</strong> — lý do đó được gửi
          thẳng cho giáo viên phụ trách buổi.
        </p>
      </PageHelp>

      <div className="mt-4">{children}</div>
    </div>
  );
}
