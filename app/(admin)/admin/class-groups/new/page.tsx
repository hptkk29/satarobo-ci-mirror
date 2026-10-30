import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { ClassGroupForm } from "../_components/class-group-form";

export const metadata = { title: "Thêm nhóm lớp | Admin" };
export const dynamic = "force-dynamic";

export default async function NewClassGroupPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("class_group:create"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Nhóm lớp BẮT BUỘC thuộc 1 cơ sở (centerId non-null + sinh mã theo center.code)
  // → loại HO khỏi danh sách (types: ["CENTER"]).
  const actor = await resolveActor(session.user.id);
  const orgUnits = await getSelectableOrgUnits(actor, { types: ["CENTER"] });

  return (
    <div className="p-6">
      <Link
        href="/class-groups"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
      </Link>
      <h1 className="mb-4 text-2xl font-bold">Thêm nhóm lớp</h1>
      <ClassGroupForm
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name, code: o.code }))}
      />
    </div>
  );
}
