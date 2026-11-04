import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentHome } from "@/lib/portal/student-home";
import { StudentHomeV2 } from "@/components/portal/student/home-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Cổng học sinh | Sata Robo",
  robots: { index: false },
};

// Cổng học sinh — Tổng quan (student-mode). Con đang chọn = ctx.activeStudent (PHƯƠNG ÁN A).
export default async function StudentHomePage() {
  const { studentId } = await requireActiveStudent();
  const data = await getStudentHome(studentId);
  return <StudentHomeV2 data={data} />;
}
