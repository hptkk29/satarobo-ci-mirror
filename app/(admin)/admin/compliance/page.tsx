import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/auth/permissions";
import { findStudentsDueForRetention, RETENTION_DAYS } from "@/lib/compliance/retention";
import { StudentComplianceActions } from "./_components/student-compliance-actions";
import { formatDateVN } from "@/lib/format/date";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

// C6/NĐ13 — Trang tuân thủ: HV quá hạn lưu trữ + xoá ẩn danh / xuất dữ liệu (SUPER_ADMIN).
export default async function CompliancePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isSuperAdmin(session.user.role)) redirect("/admin/dashboard");

  const due = await findStudentsDueForRetention();

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Tuân thủ dữ liệu (NĐ13)</h1>
        <p className="text-sm text-muted-foreground">
          Học viên đã nghỉ &amp; quá hạn lưu trữ ({Math.round(RETENTION_DAYS / 365)} năm) — rà soát xoá ẩn danh.
          Quyền: xuất dữ liệu (DSAR) &amp; xoá ẩn danh chỉ SUPER_ADMIN.
        </p>
      </div>

      {due.length === 0 ? (
        <p className="text-sm text-muted-foreground">Không có học viên nào quá hạn lưu trữ.</p>
      ) : (
        <PhanTrangBang cuonNgang>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Mã HV</th>
                <th className="py-2">Cập nhật cuối</th>
                <th className="py-2">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {due.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="py-2">{s.studentCode ?? s.id.slice(0, 8)}</td>
                  <td className="py-2">{formatDateVN(s.updatedAt)}</td>
                  <td className="py-2">
                    <StudentComplianceActions studentId={s.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      )}
    </div>
  );
}
