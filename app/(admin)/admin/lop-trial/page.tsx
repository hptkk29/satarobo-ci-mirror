// app/(admin)/admin/lop-trial/page.tsx — GĐ2. Danh sách lớp trải nghiệm.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Upload } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { layDanhSachLop } from "./_lib/queries";
import { ClassFilterChips } from "./_components/class-filter-chips";
import { SearchForm } from "./_components/search-form";
import { ClassTable } from "./_components/class-table";
import { NutXuat } from "@/components/admin/nut-xuat";

export const dynamic = "force-dynamic";

export default async function LopTrialPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("trials:view"))) redirect("/dashboard");

  const { status, q } = await searchParams;
  // 22/09/2026 — MỞ LỚP là khoá RIÊNG: Sale có `trials:manage` (thêm case, xếp học viên)
  // nhưng KHÔNG được mở lớp. Giấu nút theo đúng khoá mà trang `/lop-trial/moi` đang gác
  // — giấu theo khoá khác là nút biến mất với người được phép, hoặc còn đó với người
  // bấm vào sẽ bị đá ra (luật 12 — nút là một lời hứa).
  const canCreate = await checkPermission("trials:create-class");

  const actor = await resolveActor(session.user.id);
  const rows = await layDanhSachLop(actor, status, q);

  return (
    <div className="space-y-4">
      {/* 28/08/2026 — GỠ khối "Cấu hình số buổi (mặc định)".
          Chủ dự án: form tạo lớp nhập thẳng số buổi nào cũng được, nên một "số buổi
          mặc định" cấp hệ thống chỉ còn là ô người dùng phải đọc rồi bỏ qua. Bảng
          `TrialProgramConfig` và cột `TrialClassV2.configId` GIỮ NGUYÊN (2 pha —
          bỏ cột trên bảng có dữ liệu prod là việc của đợt drop riêng, luật cứng #4). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ClassFilterChips current={status} q={q} />
        {canCreate && (
          <div className="flex items-center gap-2">
            {/* Lối vào import giấu theo CÙNG khoá với nút "Tạo lớp" — cổng thật nằm ở
                `/api/admin/import/trial-classes`, đây chỉ là chuyện đừng bày một lối đi
                mà người bấm sẽ bị từ chối. */}
            <NutXuat ma="lop-trial" />
            <Link
              href="/lop-trial/import"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              <Upload className="h-4 w-4" /> Nhập Excel
            </Link>
            <Link
              href="/lop-trial/moi"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              <Plus className="h-4 w-4" /> Tạo lớp
            </Link>
          </div>
        )}
      </div>

      <SearchForm
        action="/lop-trial"
        placeholder="Tìm theo tên lớp hoặc mã lớp…"
        defaultValue={q}
        hidden={{ status }}
      />

      {/* 23/09 — nút "Huỷ lớp" gác bằng khoá MỞ lớp, đúng khoá `cancelLopTrialClassAction`
          hỏi. Bản trước truyền `trials:manage` — khoá của MỌI Sale — nên Sale thấy nút mà
          bấm thì bị server từ chối (luật 12). */}
      <ClassTable rows={rows} canHuyLop={canCreate} />
    </div>
  );
}
