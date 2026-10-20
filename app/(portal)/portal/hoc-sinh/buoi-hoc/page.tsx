import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";
import { StudentBuoiHocPage } from "@/components/portal/student/buoi-hoc-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Buổi học | Sata Robo",
  robots: { index: false },
};

export default async function StudentBuoiHocRoute() {
  const { studentId } = await requireActiveStudent();
  const data = await getStudentSessionsView(studentId);
  return <StudentBuoiHocPage data={data} />;
}
