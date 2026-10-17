import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { HonorForm } from "@/components/admin/honors/honor-form";

export const metadata = { title: "Sửa vinh danh | Hall of Fame" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditHonorPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("honors:edit"))) redirect("/dashboard");

  // Honor global → pass-through; Employee ∈ SCOPED_MODELS → dropdown chỉ nhân sự
  // trong tầm nhìn cơ sở của actor (SUPER_ADMIN/HO thấy tất cả).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const { id } = await params;
  const [honor, employees] = await Promise.all([
    sdb.honor.findUnique({
      where: { id },
      include: { employee: { select: { fullName: true } } },
    }),
    sdb.employee.findMany({
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
    }),
  ]);
  if (!honor) notFound();

  const displayName = honor.employee?.fullName ?? honor.fullName ?? "(chưa link)";

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Sửa: {displayName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{honor.awardName}</p>
      </div>

      <HonorForm mode="edit" initial={honor} employees={employees} />
    </div>
  );
}
