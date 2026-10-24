// @vitest-environment jsdom
// Hồi quy 07/08/2026 — /admin/curriculums/<id>/edit: sửa tên buổi xong màn hình đứng im,
// phải F5 mới thấy tên mới.
//
// Nguyên nhân: `useState(active)` chỉ nhận giá trị ở lần mount ĐẦU. Action `updateLesson`
// có revalidatePath và component có gọi router.refresh(), nên prop `initialLessons` VỀ
// dữ liệu mới — nhưng state cục bộ không đổi theo nên UI giữ nguyên bản cũ.
//
// Test này mô phỏng đúng chuỗi đó: rerender với prop mới (thứ router.refresh() tạo ra)
// rồi soi DOM. Bỏ bản vá đồng bộ đi là test đỏ.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LessonList, type LessonRow } from "./lesson-list";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Server action — import thật sẽ kéo cả chuỗi prisma vào jsdom.
vi.mock("../_actions", () => ({
  archiveLessonAction: vi.fn(),
  deleteLesson: vi.fn(),
  reorderLessons: vi.fn(),
  setLessonStatusAction: vi.fn(),
  unarchiveLessonAction: vi.fn(),
}));

// Hai dialog chỉ mở khi bấm nút — không thuộc phạm vi test, cắt cho nhẹ.
vi.mock("./lesson-form-dialog", () => ({ LessonFormDialog: () => null }));
vi.mock("./lesson-change-request-dialog", () => ({
  LessonChangeRequestDialog: () => null,
}));

function lesson(over: Partial<LessonRow> = {}): LessonRow {
  return {
    id: "l1",
    curriculumId: "c1",
    order: 1,
    title: "Buổi 1 — tên CŨ",
    description: null,
    content: null,
    duration: 90,
    objectives: [],
    materials: [],
    notes: null,
    teacherGuide: null,
    expectedOutput: null,
    homeworkDefault: null,
    assessmentCriteria: null,
    status: "INCOMPLETE",
    version: 1,
    archivedAt: null,
    openChangeRequests: 0,
    ...over,
  };
}

function renderList(lessons: LessonRow[]) {
  return render(
    <LessonList
      curriculumId="c1"
      initialLessons={lessons}
      canManageTraining
      canAuthor={false}
    />,
  );
}

describe("LessonList — dữ liệu server đổi thì màn hình phải đổi theo", () => {
  it("đổi tên buổi: prop mới về → hiện tên mới, không cần F5", () => {
    const { rerender } = renderList([lesson()]);
    expect(screen.getByText(/tên CŨ/)).toBeTruthy();

    rerender(
      <LessonList
        curriculumId="c1"
        initialLessons={[lesson({ title: "Buổi 1 — tên MỚI" })]}
        canManageTraining
        canAuthor={false}
      />,
    );

    expect(screen.getByText(/tên MỚI/)).toBeTruthy();
    expect(screen.queryByText(/tên CŨ/)).toBeNull();
  });

  it("thêm buổi: danh sách và bộ đếm cùng tăng", () => {
    const { rerender } = renderList([lesson()]);
    expect(screen.getByText(/Bài học \(1\)/)).toBeTruthy();

    rerender(
      <LessonList
        curriculumId="c1"
        initialLessons={[lesson(), lesson({ id: "l2", order: 2, title: "Buổi 2" })]}
        canManageTraining
        canAuthor={false}
      />,
    );

    expect(screen.getByText(/Bài học \(2\)/)).toBeTruthy();
    expect(screen.getByText(/Buổi 2/)).toBeTruthy();
  });

  it("lưu trữ buổi: rời danh sách đang hoạt động, sang mục đã lưu trữ", () => {
    const { rerender } = renderList([lesson()]);
    expect(screen.getByText(/Bài học \(1\)/)).toBeTruthy();

    rerender(
      <LessonList
        curriculumId="c1"
        initialLessons={[lesson({ archivedAt: "2026-08-07T00:00:00.000Z" })]}
        canManageTraining
        canAuthor={false}
      />,
    );

    expect(screen.getByText(/Bài học \(0\)/)).toBeTruthy();
    expect(screen.getByText(/Buổi đã lưu trữ \(1\)/)).toBeTruthy();
  });
});
