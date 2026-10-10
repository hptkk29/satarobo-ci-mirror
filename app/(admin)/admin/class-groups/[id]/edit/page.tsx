import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { scopedDb } from "@/lib/db-scope";
import { ClassGroupForm } from "../../_components/class-group-form";

export const metadata = { title: "Sửa nhóm lớp | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditClassGroupPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("class_group:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;
  // Nhóm lớp BẮT BUỘC thuộc 1 cơ sở → loại HO khỏi danh sách (types: ["CENTER"]).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const [group, orgUnits] = await Promise.all([
    sdb.classGroup.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        displayCode: true,
        name: true,
        centerId: true,
        orgUnitId: true,
        status: true,
        notes: true,
      },
    }),
    getSelectableOrgUnits(actor, { types: ["CENTER"] }),
  ]);
  if (!group) notFound();

  return (
    <div className="p-6">
      <Link
        href={`/class-groups/${group.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại
      </Link>
      <h1 className="mb-4 text-2xl font-bold">Sửa nhóm lớp: {group.displayCode}</h1>
      <ClassGroupForm
        group={group}
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name, code: o.code }))}
      />
    </div>
  );
}
