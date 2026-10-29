// Quản trị PHÁP NHÂN của Cây tổ chức (24/10/2026) — thiết kế: docs/ke-toan-hoa-don/THIET-KE-PHAP-NHAN-VA-KY-HIEU.md §A.
// Quyền: `centers:edit` (SUPER_ADMIN) — cùng cổng với màn Cây tổ chức; mọi action kiểm lại quyền ở server.
// Chỉ ĐỌC ở đây; ghi đi qua `_actions.ts` → `lib/org/legal-entity-admin.ts` (một transaction + audit mỗi thao tác).
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { PageHeader } from "@/components/admin/ui/page-header";
import { docDanhSachPhapNhan, docDonViVaPhapNhan, docLichSuPhapNhan } from "@/lib/org/legal-entity-admin";
import { QuanLyPhapNhan } from "./_components/quan-ly-phap-nhan";

export const metadata = { title: "Pháp nhân | Admin" };
export const dynamic = "force-dynamic";

export default async function PhapNhanPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fto-chuc%2Fphap-nhan");
  if (!(await checkAnyPermission(PAGE_GATES["/to-chuc/phap-nhan"]))) redirect("/dashboard?error=unauthorized");

  const [danhSach, donVi, lichSu] = await Promise.all([docDanhSachPhapNhan(), docDonViVaPhapNhan(), docLichSuPhapNhan()]);

  return (
    <div>
      <PageHeader
        title="Pháp nhân"
        subtitle="Các công ty phát hành hoá đơn và đứng tên thu tiền. Gắn mỗi cơ sở vào đúng pháp nhân — màn Cấu hình ký hiệu hoá đơn dùng quan hệ này để tự chọn pháp nhân."
        actions={
          <Link href="/to-chuc" className="text-sm font-medium text-primary hover:underline">
            ← Về Cây tổ chức
          </Link>
        }
      />
      <QuanLyPhapNhan
        danhSach={danhSach.map((p) => ({ id: p.id, taxCode: p.taxCode, legalName: p.legalName, address: p.address, isPrimary: p.isPrimary, isActive: p.isActive, daXoa: p.deletedAt != null, tacDong: p.tacDong }))}
        donVi={donVi}
        lichSu={lichSu}
      />
    </div>
  );
}
