import "server-only";
import { db } from "@/lib/db";
import { getStudentClasses, type StudentClass } from "@/lib/portal/learning";
import { hasMediaConsent } from "@/lib/lms/media-consent";
import type { Gender, RoboticsSkill, SkillLevel } from "@prisma/client";

// Portal v2 — hồ sơ chi tiết 1 con (con đang chọn). Gồm phần chỉ-xem (mã HV/lớp/GV)
// + phần phụ huynh sửa được (ngày sinh/khối/trường/sức khoẻ/dị ứng) + kỹ năng.
//
// ⚠️ 06/09/2026 — `Student.notes` KHÔNG BAO GIỜ đi qua cổng phụ huynh nữa.
//
// Cột đó là ô GHI CHÚ NỘI BỘ của nhân viên: màn nhập học viên của admin đặt tên nó đúng
// như vậy (`app/(admin)/admin/students/import/page.tsx:133` — "Ghi chú nội bộ"). Cổng phụ
// huynh vừa IN nguyên văn ra cho phụ huynh đọc, vừa cho họ SỬA ĐÈ lên (ô "Ghi chú khác",
// placeholder "Ghi chú thêm cho trung tâm") — nên một dòng ghi chú nội bộ về hoàn cảnh
// gia đình có thể hiện thẳng cho chính gia đình đó, và ngược lại phụ huynh bấm Lưu hồ sơ
// là xoá trắng ghi chú của nhân viên.
//
// Cố ý KHÔNG xoá dữ liệu và KHÔNG thêm cột mới: chỉ cắt đường đọc/ghi từ portal. Nội dung
// đang có ở lại nguyên vẹn cho phía quản trị. Phụ huynh muốn nhắn gì cho trung tâm thì đi
// qua /portal/yeu-cau — kênh có người nhận và có trạng thái xử lý.

export type ChildSkill = { skill: RoboticsSkill; level: SkillLevel };

export type ChildDetail = {
  id: string;
  name: string;
  studentCode: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  currentGrade: number | null;
  school: string | null;
  healthNotes: string | null;
  allergies: string[];
  classes: StudentClass[];
  skills: ChildSkill[];
  mediaConsent: boolean;
};

// Trường phụ huynh sửa được (đã validate ở action). Ghi trong lib (được phép db trần).
export type ChildProfileEdit = {
  dateOfBirth: Date | null;
  gender: Gender | null;
  currentGrade: number | null;
  school: string | null;
  healthNotes: string | null;
  allergies: string[];
};

export async function updateChildDetail(studentId: string, d: ChildProfileEdit): Promise<void> {
  await db.student.update({
    where: { id: studentId },
    data: {
      dateOfBirth: d.dateOfBirth,
      gender: d.gender,
      currentGrade: d.currentGrade,
      school: d.school,
      healthNotes: d.healthNotes,
      allergies: d.allergies,
      // `notes` KHÔNG nằm ở đây: đó là ghi chú NỘI BỘ của nhân viên, portal không ghi đè.
    },
  });
}

export async function getChildDetail(studentId: string): Promise<ChildDetail | null> {
  const [student, classes, skillRows, mediaConsent] = await Promise.all([
    db.student.findUnique({
      where: { id: studentId },
      select: {
        id: true, name: true, studentCode: true, dateOfBirth: true, gender: true,
        currentGrade: true, school: true, healthNotes: true, allergies: true,
      },
    }),
    getStudentClasses(studentId),
    db.studentSkillAssessment.findMany({
      where: { studentId },
      orderBy: { assessedAt: "desc" },
      select: { skill: true, level: true },
    }),
    hasMediaConsent(studentId).catch(() => false),
  ]);
  if (!student) return null;

  // Mức mới nhất mỗi kỹ năng.
  const seen = new Set<string>();
  const skills: ChildSkill[] = [];
  for (const r of skillRows) {
    if (seen.has(r.skill)) continue;
    seen.add(r.skill);
    skills.push({ skill: r.skill, level: r.level });
  }

  return {
    id: student.id,
    name: student.name,
    studentCode: student.studentCode,
    dateOfBirth: student.dateOfBirth?.toISOString() ?? null,
    gender: student.gender,
    currentGrade: student.currentGrade,
    school: student.school,
    healthNotes: student.healthNotes,
    allergies: student.allergies,
    classes,
    skills,
    mediaConsent,
  };
}
