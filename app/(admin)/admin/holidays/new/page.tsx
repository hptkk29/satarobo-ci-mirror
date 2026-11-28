import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { HolidayForm } from "../_components/holiday-form";

export const dynamic = "force-dynamic";

export default async function NewHolidayPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Ngày nghỉ = vận hành → áp được cho cả HO (default scope, gồm HO).
  const actor = await resolveActor(session.user.id);
  const orgUnits = await getSelectableOrgUnits(actor);

  return (
    <div>
      <Link
        href="/holidays"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
      </Link>
      <h1 className="mb-6 text-3xl font-black text-foreground">Thêm ngày nghỉ</h1>
      <HolidayForm orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))} />
    </div>
  );
}
