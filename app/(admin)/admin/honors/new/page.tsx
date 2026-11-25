import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { HonorForm } from "@/components/admin/honors/honor-form";

export const metadata = { title: "Thêm vinh danh | Hall of Fame" };

export default async function NewHonorPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("honors:create"))) redirect("/dashboard");

  // Employee ∈ SCOPED_MODELS → dropdown chỉ nhân sự trong tầm nhìn cơ sở của actor.
  const actor = await resolveActor(session.user.id);
  const employees = await scopedDb(actor).employee.findMany({
    where: { isActive: true },
    orderBy: [{ department: "asc" }, { fullName: "asc" }],
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      jobTitle: true,
      department: true,
      avatarUrl: true,
      joinedAt: true,
    },
  });

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Thêm vinh danh</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chọn nhân sự từ danh sách, điền giải thưởng + câu chuyện. Chưa có nhân sự?{" "}
          <Link
            href="/nhan-su/new"
            className="text-primary hover:underline"
          >
            Thêm nhân sự mới
          </Link>
          .
        </p>
      </div>

      <HonorForm mode="create" employees={employees} />
    </div>
  );
}
