import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentAssignmentTrack } from "@/lib/portal/student-assignments";
import { StudentBaiTapPage } from "@/components/portal/student/bai-tap-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Bài tập | Sata Robo",
  robots: { index: false },
};

export default async function StudentBaiTapRoute() {
  const { studentId } = await requireActiveStudent();
  const data = await getStudentAssignmentTrack(studentId);
  return <StudentBaiTapPage data={data} />;
}
