import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { HolidayForm } from "../../_components/holiday-form";
import { DeleteHolidayButton } from "../../_components/delete-button";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function EditHolidayPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveActor(session.user.id);

  // Ngày nghỉ = vận hành → áp được cho cả HO (default scope, gồm HO).
  // Cách ly cơ sở (A0-04): Holiday ∈ SCOPED_MODELS — sdb.findUnique null-filter record
  // ngoài tầm nhìn. Ngày nghỉ TOÀN HỆ THỐNG (centerId=null) → chỉ SUPER_ADMIN/HO sửa
  // (khớp chính sách trong _actions.ts) — center-level mở link cũ sẽ thấy 404.
  const sdb = scopedDb(actor);
  const [holiday, orgUnits] = await Promise.all([
    sdb.holiday.findUnique({ where: { id } }),
    getSelectableOrgUnits(actor),
  ]);

  if (!holiday) notFound();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/holidays"
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
          </Link>
          <h1 className="text-3xl font-black text-foreground">
            Sửa ngày nghỉ:{" "}
            <span className="font-bold text-primary">{holiday.name}</span>
          </h1>
        </div>
        <DeleteHolidayButton id={holiday.id} name={holiday.name} />
      </div>

      <HolidayForm
        holiday={{
          id: holiday.id,
          name: holiday.name,
          date: holiday.date,
          endDate: holiday.endDate,
          orgUnitId: holiday.orgUnitId,
          type: holiday.type,
          note: holiday.note,
          attendanceEffect: holiday.attendanceEffect,
          coefficient: holiday.coefficient,
          briefMode: holiday.briefMode,
          briefText: holiday.briefText,
        }}
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
      />
    </div>
  );
}
