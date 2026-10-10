// hub-students-tab.tsx — Tab "Học viên" của Class Hub.
//
// Roster lớp: avatar initials + tên + mã HV / Năm sinh / Trạng thái ghi danh.
// ⚠️ Câu 46: reference TeachUI có cột "Phụ huynh" (parentName + phone) — BỎ HẲN ở
// site GV; chỉ hiện định danh học tập của HV. Tên → hồ sơ
// /teacher/hoc-vien?s=…&classId=… — KÈM classId của chính lớp đang mở, nếu không hồ
// sơ bung ra mọi lớp em đó học và giáo viên mất ngữ cảnh vừa bấm từ đâu ra
// (QA vòng 1, BUG-003).
//
// Đọc roster QUA quan hệ class (đã guard assignedClassIds ở caller) thay vì query
// Enrollment trực tiếp: enrollment dev có centerId=null → scopedDb lọc mất khi truy
// vấn thẳng; đọc qua class khớp cách _count đếm sĩ số (pattern cham-bai).
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import type { Actor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { ENROLLMENT_STATUS } from "@/lib/labels/registry";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "../../_components/ui/empty-state";
import { initialsOf } from "@/lib/ui/initials";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export async function HubStudentsTab({
  actor,
  classId,
}: {
  actor: Actor;
  classId: string;
}) {
  const sdb = scopedDb(actorGiangDay(actor));
  const cls = await sdb.class.findUnique({
    where: { id: classId },
    select: {
      enrollments: {
        // student.deletedAt: hàng rào 2 (07/08) — GV không được thấy HV đã xoá khỏi hệ thống.
        where: {
          status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
          deletedAt: null,
          student: { deletedAt: null },
        },
        // Câu 46: Student CHỈ field định danh học tập — KHÔNG parent*/phone/email.
        select: {
          status: true,
          student: {
            select: {
              id: true,
              name: true,
              studentCode: true,
              avatarUrl: true,
              dateOfBirth: true,
            },
          },
        },
        orderBy: { student: { name: "asc" } },
      },
    },
  });
  const roster = cls?.enrollments ?? [];

  if (roster.length === 0) {
    return (
      <EmptyState icon={GraduationCap} title="Lớp chưa có học viên đang học." />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sĩ số{" "}
        <span className="font-semibold text-foreground">{roster.length}</span>{" "}
        học viên — bấm tên để xem hồ sơ chuyên cần, năng lực và bài tập.
      </p>
      <div className="t-card overflow-hidden">
        <PhanTrangBang cuonNgang
          khoaGhiNho="gv-lop-hoc-vien">
          <table className="min-w-[560px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th scope="col" className="px-5 py-3">
                  Học viên
                </th>
                <th scope="col" className="px-5 py-3">
                  Năm sinh
                </th>
                <th scope="col" className="px-5 py-3">
                  Trạng thái
                </th>
              </tr>
            </thead>
            <tbody>
              {roster.map((e) => {
                const st = e.student;
                return (
                  <tr
                    key={st.id}
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        {st.avatarUrl ? (
                          // Thumbnail nội bộ nhỏ — cùng ngoại lệ <img> như /admin/students.
                          <img
                            src={st.avatarUrl}
                            alt={st.name}
                            className="h-10 w-10 shrink-0 rounded-full border border-border object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">
                            {initialsOf(st.name)}
                          </span>
                        )}
                        <div className="min-w-0">
                          <Link
                            href={`/teacher/hoc-vien?s=${st.id}&classId=${classId}`}
                            className="font-semibold text-foreground outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {st.name}
                          </Link>
                          {st.studentCode && (
                            <p className="text-xs text-muted-foreground">
                              {st.studentCode}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
                      {st.dateOfBirth ? st.dateOfBirth.getUTCFullYear() : "—"}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <Badge variant="outline">
                        {ENROLLMENT_STATUS.label(e.status)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
