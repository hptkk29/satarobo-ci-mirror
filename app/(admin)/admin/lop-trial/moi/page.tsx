// app/(admin)/admin/lop-trial/moi/page.tsx — GĐ2. Tạo lớp trải nghiệm.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { layLuaChonTaoLop } from "../_lib/queries";
import { layCauHinhKhung } from "@/lib/trial/khung-gio-db";
import { vnTodayUtc } from "@/lib/trial/service";
import { vnYmd } from "@/lib/time/vn";
import { CreateForm } from "../_components/create-form";
import { BulkForm } from "../_components/bulk-form";

export const dynamic = "force-dynamic";

type Kieu = "ngay" | "ky";

export default async function TaoLopTrialPage({
  searchParams,
}: {
  searchParams: Promise<{ kieu?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Trang này CHỈ để ghi → gác bằng quyền ghi, không phải trials:view.
  //
  // 22/09/2026 — đổi sang `trials:create-class`: Sale vẫn có `trials:manage` (họ cần nó để
  // thêm case + xếp học viên), nên cổng cũ ở đây không chặn được ai. Gác CẢ TRANG chứ
  // không chỉ giấu nút: trên thanh địa chỉ ai cũng gõ được `/lop-trial/moi`.
  if (!(await checkPermission("trials:create-class"))) redirect("/lop-trial");

  const actor = await resolveActor(session.user.id);
  // 28/08 — form chỉ còn CƠ SỞ + KHOÁ. Không nạp giáo viên/phòng/cấu hình số buổi nữa:
  // ba thứ đó chuyển xuống khối "Thêm buổi học" ở trang chi tiết lớp.
  // `courses` KHÔNG còn dùng: ô "Khoá trải nghiệm" đã gỡ khỏi cả hai form theo chốt
  // 22/09/2026 vòng 2 (QLCS mở lớp chưa biết học viên nào sẽ vào, nên chưa biết khoá).
  const { centers } = await layLuaChonTaoLop(actor);
  // Khung giờ đọc ở SERVER rồi truyền xuống — ô chọn trên form phải bày đúng thứ server
  // sẽ nhận. "Hôm nay" cũng tính ở server theo lịch VN: để client đọc đồng hồ máy là máy
  // đặt sai múi giờ sẽ mở lớp nhầm ngày.
  const cauHinhKhung = await layCauHinhKhung();
  const homNay = vnYmd(vnTodayUtc());
  // Hai cách mở lớp là HAI việc thay thế nhau, không phải việc chính + phụ lục. Chọn
  // bằng tham số URL (không phải state client) để link thẳng được tới "cả kỳ" và nút
  // Back của trình duyệt đi đúng chỗ.
  const kieu: Kieu = (await searchParams).kieu === "ky" ? "ky" : "ngay";

  const coSoMacDinh =
    (session.user.centerId && centers.some((c) => c.id === session.user.centerId)
      ? session.user.centerId
      : centers[0]?.id) ?? "";

  return (
    // Trần bề rộng + căn giữa nằm ở `lop-trial/layout.tsx` — dùng chung mọi màn Lớp Trial.
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          href="/lop-trial"
          className="-ml-1 inline-flex h-8 items-center gap-1 rounded-md px-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Lớp trải nghiệm
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Mở lớp trải nghiệm</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Mỗi lớp là một ngày và một khung giờ. Sale chọn lớp theo ngày hẹn khách, rồi
              thêm case trong đúng khung giờ đó.
            </p>
          </div>

          <nav
            aria-label="Cách mở lớp"
            className="inline-flex shrink-0 rounded-lg border border-border bg-muted p-0.5"
          >
            {(
              [
                ["ngay", "Một ngày", "/lop-trial/moi"],
                ["ky", "Cả kỳ", "/lop-trial/moi?kieu=ky"],
              ] as const
            ).map(([k, nhan, href]) => (
              <Link
                key={k}
                href={href}
                aria-current={kieu === k ? "page" : undefined}
                className={`inline-flex h-8 items-center rounded-md px-4 text-sm font-medium transition-colors duration-150 pointer-coarse:h-10 ${
                  kieu === k
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {nhan}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {kieu === "ky" ? (
        <BulkForm
          centers={centers}
          coSoMacDinh={coSoMacDinh}
          cauHinhKhung={cauHinhKhung}
          homNay={homNay}
        />
      ) : (
        // `coSoCuaToi` — cơ sở của CHÍNH người đang mở màn, để form đặt mặc định (chủ dự
        // án 18/09: "set mặc định cơ sở là cơ sở của sale đó nhưng vẫn có thể chọn cơ sở
        // khác"). Bản cũ mặc định `centers[0]` = cơ sở ĐẦU BẢNG CHỮ CÁI.
        <CreateForm
          centers={centers}
          coSoCuaToi={session.user.centerId ?? null}
          cauHinhKhung={cauHinhKhung}
          homNay={homNay}
        />
      )}
    </div>
  );
}
