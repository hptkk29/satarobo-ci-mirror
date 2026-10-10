// app/(admin)/admin/bao-luu/tam-dung-lop/page.tsx — TRUNG TÂM TẠM DỪNG CẢ LỚP (loại CENTER, BR-23).
//
// Quyền `bao-luu:center-pause` (Quản lý cơ sở / Admin). Lớp liệt kê qua `scopedDb` ⇒ chỉ lớp trong tầm nhìn cơ sở. Công tắc `pause.enabled` theo cơ sở của lớp: lớp thuộc cơ sở
// chưa bật thì KHÔNG hiện trong danh sách chọn (chọn rồi mới bị từ chối là lời hứa suông — luật 12); server action vẫn kiểm lại.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/states";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { laBaoLuuBat } from "@/lib/bao-luu/feature";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { vnYmd } from "@/lib/time/vn";
import { FormTamDungLop } from "../_components/form-tam-dung-lop";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tạm dừng cả lớp | Admin Sata Robo" };

export default async function TamDungLopPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fbao-luu%2Ftam-dung-lop");
  if (!(await checkPermission("bao-luu:center-pause"))) redirect("/bao-luu?error=unauthorized");

  const actor = await resolveActor(session.user.id);
  const lop = await scopedDb(actor).class.findMany({
    where: { deletedAt: null, status: "ACTIVE", course: { allowPause: true } },
    orderBy: { name: "asc" },
    take: 300,
    select: {
      id: true, name: true, classCode: true, centerId: true, orgUnitId: true,
      course: { select: { name: true } },
      _count: { select: { enrollments: { where: { deletedAt: null, status: { in: ["ACTIVE", "STUDYING"] } } } } },
    },
  });
  const donVi = new Map<string, boolean>();
  const hienDuoc = [];
  for (const l of lop) {
    const k = l.orgUnitId ?? (l.centerId ? await orgUnitIdForCenter(l.centerId) : null);
    const key = k ?? "";
    if (!donVi.has(key)) donVi.set(key, k ? await laBaoLuuBat(k) : false);
    if (donVi.get(key) && l._count.enrollments > 0) hienDuoc.push({ id: l.id, ten: `${l.classCode ?? l.name} — ${l.course.name}`, soHocVien: l._count.enrollments });
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <Link href="/bao-luu" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Danh sách hồ sơ bảo lưu
      </Link>
      <PageHeader
        title="Tạm dừng cả lớp"
        subtitle="Trung tâm tạm dừng lớp vì lý do của Trung tâm: MỖI học viên đang học nhận một hồ sơ riêng loại Trung tâm, đi thẳng vào bảo lưu. Một em lỗi thì cả lớp không được tạm dừng."
      />
      {hienDuoc.length === 0 ? (
        <EmptyState
          title="Không có lớp nào tạm dừng được."
          description="Chỉ lớp đang chạy, có học viên đang học, thuộc khoá áp dụng bảo lưu và cơ sở đã bật bảo lưu mới hiện ở đây."
        />
      ) : (
        <FormTamDungLop lop={hienDuoc} homNay={vnYmd(new Date())} />
      )}
    </div>
  );
}
