// Module dùng chung — NHÓM khoá học theo danh mục cho dropdown (optgroup).
// Dùng cho cả form tạo/sửa LỚP và form tạo/sửa LEAD để KHỎI LỆCH. Pure (không
// import db) → client component import được.

export type CourseCategoryKey = "LUYEN_THI_ROBOSIM" | "LAP_TRINH_ROBOT";

export const COURSE_CATEGORY_LABEL: Record<CourseCategoryKey, string> = {
  LUYEN_THI_ROBOSIM: "Khoá luyện thi RoboSim",
  LAP_TRINH_ROBOT: "Khoá lập trình Robot",
};

const CATEGORY_ORDER: CourseCategoryKey[] = ["LUYEN_THI_ROBOSIM", "LAP_TRINH_ROBOT"];

export type TeachableCourse = {
  id: string;
  name: string;
  category: CourseCategoryKey | null;
};

export type CourseOptGroup = {
  label: string;
  options: { value: string; label: string }[];
};

/**
 * Nhóm danh sách khoá (isTeachable) theo 2 danh mục, khoá chưa gán danh mục gom
 * vào "Khác" ở cuối. Bỏ nhóm rỗng.
 */
export function groupTeachableCourses(courses: TeachableCourse[]): CourseOptGroup[] {
  const groups: CourseOptGroup[] = CATEGORY_ORDER.map((cat) => ({
    label: COURSE_CATEGORY_LABEL[cat],
    options: courses
      .filter((c) => c.category === cat)
      .map((c) => ({ value: c.id, label: c.name })),
  }));

  const other = courses.filter(
    (c) => c.category !== "LUYEN_THI_ROBOSIM" && c.category !== "LAP_TRINH_ROBOT",
  );
  if (other.length > 0) {
    groups.push({ label: "Khác", options: other.map((c) => ({ value: c.id, label: c.name })) });
  }

  return groups.filter((g) => g.options.length > 0);
}
