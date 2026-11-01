"use client";

import { courseGroups, type Course } from "../_data/courses-pricing";

const allCourses: Course[] = courseGroups.flatMap((group) => group.courses);

export const getCourseById = (productCode: string): Course | null =>
  allCourses.find((course) => course.id === productCode) ?? null;

export const getCourseValue = (productCode: string): string =>
  getCourseById(productCode)?.value ?? "";

export interface CourseSelectionPayload {
  productCode: string;
  courseValue: string;
  yearIndex?: number;
}

export const selectCourse = (
  productCode: string,
  extra: Record<string, unknown> = {},
): void => {
  const course = getCourseById(productCode);
  if (!course) return;

  const payload: CourseSelectionPayload = {
    productCode,
    courseValue: course.value,
    ...(extra as object),
  };

  try {
    sessionStorage.setItem("sata-selected-age-course", JSON.stringify(payload));
  } catch {
    // Ignore storage issues; the event still updates the current page.
  }

  window.dispatchEvent(new CustomEvent("sata-course-selected", { detail: payload }));
};

export interface AgeCourseOption {
  label: string;
  grade: string;
  productCode: string;
  courseName: string;
  yearIndex: number;
  courseValue: string;
}

export const ageCourseOptions: AgeCourseOption[] = [
  { label: "Sata3", grade: "Lớp 1-2", productCode: "Sata3", courseName: "Ươm Mầm Tài Năng", yearIndex: 0 },
  { label: "Sata4", grade: "Lớp 3-4", productCode: "Sata4", courseName: "Bứt Phá Giới Hạn", yearIndex: 1 },
  { label: "Sata5", grade: "Lớp 5", productCode: "Sata5", courseName: "Khơi Nguồn Sáng Tạo", yearIndex: 2 },
  { label: "Sata6", grade: "Lớp 6-7", productCode: "Sata6", courseName: "Chinh Phục Đấu Trường", yearIndex: 3 },
  { label: "Sata7", grade: "Lớp 8", productCode: "Sata7", courseName: "Kiến Tạo Tương Lai", yearIndex: 4 },
].map((option) => ({
  ...option,
  courseValue: getCourseValue(option.productCode),
}));

export const isValidCourseSelection = (payload: unknown): payload is CourseSelectionPayload => {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.courseValue === "string" &&
    Boolean(p.courseValue) &&
    allCourses.some((course) => course.value === p.courseValue) &&
    (p.yearIndex === undefined ||
      (Number.isInteger(p.yearIndex) &&
        (p.yearIndex as number) >= 0 &&
        (p.yearIndex as number) <= 4))
  );
};

export const readStoredCourseSelection = (): CourseSelectionPayload | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("sata-selected-age-course");
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidCourseSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
