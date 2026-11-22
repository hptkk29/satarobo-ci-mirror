import { Clock, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { isElearningEnabled } from "@/lib/flags";
import { traChungNhan } from "@/lib/elearning/certificate-verify";
import { choPhepTraChungNhan } from "@/lib/elearning/certificate-verify-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";

/**
 * EL-16 — TRANG XÁC MINH CHỨNG NHẬN. Công khai, không đăng nhập.
 *
 * ⚠️ Vị trí tệp là một phần của thiết kế: nó nằm ở `app/(elearning)/xac-thuc/`, tức
 * cùng nhóm route nhưng NGOÀI segment `elearning/`. Mọi thứ dưới `elearning/` đi qua
 * layout gác `auth()` + hồ sơ nhân sự; đặt trang này vào đó là dựng một trang công
 * khai rồi khoá nó lại. `decideRoute()` trả `next` cho `/xac-thuc/*` chứ không
 * rewrite, đúng vì lý do này.
 *
 * Người đọc trang này là người NGOÀI: một phụ huynh, một đoàn kiểm tra, một nhà
 * tuyển dụng. Họ không biết Sata Robo dùng phần mềm gì, và họ chỉ cần một câu trả
 * lời. Vì vậy trang không có thanh điều hướng, không có lối vào hệ thống, và không
 * mời họ đăng nhập.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Xác minh chứng nhận đào tạo — Sata Robo",
  // ⚠️ `noindex` bắt buộc. Địa chỉ mang một token bí mật; để công cụ tìm kiếm lập
  // chỉ mục là biến "chỉ ai cầm QR mới tra được" thành "tra Google là ra".
  robots: { index: false, follow: false },
};

// Màu chỉ bổ sung: mỗi trạng thái luôn có BIỂU TƯỢNG + CÂU CHỮ (`kq.cauTrangThai`).
const MAU: Record<string, string> = {
  VALID: "border-state-success/40 bg-state-success-soft text-state-success-ink",
  EXPIRED: "border-state-warning/40 bg-state-warning-soft text-state-warning-ink",
  REVOKED: "border-state-danger/40 bg-state-danger-soft text-state-danger-ink",
};

const ICON: Record<string, typeof ShieldCheck> = {
  VALID: ShieldCheck,
  EXPIRED: Clock,
  REVOKED: ShieldAlert,
};

function Khung({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10 sm:px-6">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">{children}</div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Công ty Cổ phần Công nghệ Giáo dục Sata Robo
      </p>
    </main>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Cờ chung OFF ⇒ ẩn HOÀN TOÀN (đặc tả §4.8, mức rollback 1). Cổng cờ ở `decideRoute()` chỉ chạy trên
  // host e-learning; host công khai / host lạ (localhost, test) để `/xac-thuc/*` lọt tới đây, nên chính trang
  // phải tự hỏi — không thì cờ OFF vẫn trả họ tên + mã nhân viên cho bất kỳ ai cầm token.
  if (!isElearningEnabled()) notFound();

  // Giới hạn tần suất theo IP — đứng TRƯỚC mọi truy vấn và đếm cả lượt trượt (xem certificate-verify-limit.ts).
  // Vượt ngưỡng ⇒ KHÔNG tra DB, KHÔNG đọc `params`, không lộ gì về token. (RSC không đặt được mã 429, nên trả
  // một trang nói thẳng "thử lại sau"; trang noindex nên bot tìm kiếm không lưu nó.)
  if (!(await choPhepTraChungNhan(ipChoRateLimit(await headers())))) {
    return (
      <Khung>
        <h1 className="text-xl font-bold">Tra cứu quá nhanh</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Có quá nhiều lượt tra cứu từ địa chỉ mạng của bạn trong một phút. Hãy đợi ít phút rồi thử lại.
        </p>
      </Khung>
    );
  }

  const { token } = await params;
  const kq = await traChungNhan(token);

  if (!kq) {
    return (
      <Khung>
        <h1 className="text-xl font-bold">Không tìm thấy chứng nhận</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Mã tra cứu không đúng hoặc đã bị thay đổi. Kiểm tra lại mã QR trên bản
          chứng nhận, hoặc liên hệ phòng Đào tạo của Sata Robo.
        </p>
        {/*
          ⚠️ Câu chữ CỐ Ý không phân biệt "token sai" với "chứng nhận không tồn tại".
          Phân biệt ra là dựng một cái máy dò: người thử token biết được cái nào tồn
          tại. Ở một trang công khai, đó là toàn bộ giá trị của việc token ngẫu nhiên.
        */}
      </Khung>
    );
  }

  const ngay = (d: Date) =>
    d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <Khung>
      <h1 className="text-xl font-bold">Chứng nhận đào tạo nội bộ</h1>

      <div
        className={`mt-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-semibold ${
          MAU[kq.trangThai] ?? MAU.VALID
        }`}
      >
        {(() => {
          const Icon = ICON[kq.trangThai] ?? ShieldCheck;
          return <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />;
        })()}
        <span>{kq.cauTrangThai}</span>
      </div>

      {kq.trangThai === "REVOKED" ? (
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
          {/*
            Bản PDF đã in ra vẫn còn trong tay người ta và trông vẫn hợp lệ. Trang này
            là nguồn sự thật — phải nói thẳng ra, nếu không người tra cứu sẽ tin tờ
            giấy và nghĩ trang web hỏng.
          */}
          Bản in hoặc tệp PDF đã phát trước đó không còn giá trị. Trang tra cứu này là
          nguồn thông tin đúng.
        </p>
      ) : null}

      <dl className="mt-6 divide-y divide-border text-sm">
        {/* ĐÚNG 5 trường + mã chứng nhận. Không phòng ban, không điểm, không lịch sử
            học, không danh sách khoá khác. Thêm một dòng ở đây là nới quyền cho cả
            internet, không phải cho một vai nào cả. */}
        <div className="py-3 first:pt-0 last:pb-0">
          <dt className="text-sm text-muted-foreground">Họ và tên</dt>
          <dd className="font-medium">{kq.hoTen}</dd>
        </div>
        <div className="py-3 first:pt-0 last:pb-0">
          <dt className="text-sm text-muted-foreground">Mã nhân viên</dt>
          <dd className="font-medium">{kq.maNhanVien}</dd>
        </div>
        <div className="py-3 first:pt-0 last:pb-0">
          <dt className="text-sm text-muted-foreground">Khoá đào tạo</dt>
          <dd className="font-medium">{kq.tenKhoa}</dd>
        </div>
        <div className="py-3 first:pt-0 last:pb-0">
          <dt className="text-sm text-muted-foreground">Ngày cấp</dt>
          <dd className="font-medium">{ngay(kq.ngayCap)}</dd>
        </div>
        <div className="py-3 first:pt-0 last:pb-0">
          <dt className="text-sm text-muted-foreground">Số hiệu</dt>
          <dd className="font-mono text-sm">{kq.maChungNhan}</dd>
        </div>
      </dl>
    </Khung>
  );
}
