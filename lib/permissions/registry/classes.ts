// Registry quyền — module Lớp học: lớp, buổi học, nhóm lớp, phòng, ngày nghỉ,
// duyệt đề xuất chỉnh bài. Key GIỮ NGUYÊN format v1 `resource:verb` (TS-01).
import type { ModuleDecl } from "./types";

export const classesModule: ModuleDecl = {
  module: "classes",
  permissions: [
    // --- Classes ---
    { key: "classes:view-all", action: "view-all" },
    { key: "classes:view-own", action: "view-own" },
    { key: "classes:create", action: "create" },
    { key: "classes:edit", action: "edit" },
    { key: "classes:delete", action: "delete" },

    // --- Class sessions (buổi học) ---
    { key: "sessions:view", action: "view" },
    { key: "sessions:create", action: "create" },
    { key: "sessions:edit", action: "edit" },
    {
      key: "session-feedback:view-all",
      action: "view-all",
      description:
        "Đọc phiếu nhận xét buổi học (StudentSessionFeedback) của mọi học viên trong lớp. CHỈ ĐỌC — tách khỏi sessions:view để mở cho Đào tạo mà không mở module Buổi học.",
    },
    {
      key: "session-feedback:share",
      action: "share",
      description:
        "Lấy phiếu nhận xét buổi học của học viên về để gửi phụ huynh (khối \"Nhận xét buổi học & học bạ\" ở hồ sơ học viên: sao chép chữ + tải PDF). Hẹp hơn view-all: KHÔNG mở các màn điểm danh / lớp / buổi học — dành cho Sale và Quản lý cơ sở.",
    },

    // --- Class groups (nhóm lớp) ---
    { key: "class_group:view-all", action: "view-all" },
    { key: "class_group:create", action: "create" },
    { key: "class_group:edit", action: "edit" },
    { key: "class_group:delete", action: "delete" },

    // --- Rooms (phòng học) ---
    { key: "rooms:view", action: "view" },
    { key: "rooms:edit", action: "edit" },

    // --- Holidays (ngày nghỉ) ---
    { key: "holidays:view", action: "view" },
    { key: "holidays:edit", action: "edit" },

    // --- Lesson change ---
    {
      key: "lesson-change:approve",
      action: "approve",
      description: "Duyệt đề xuất chỉnh bài dạy của GV (LessonChangeRequest).",
    },
  ],
};
