// Registry quyền — module LMS: chương trình học, khoá dạy, gói học, đề thi,
// câu hỏi, bài tập, tài liệu, đào tạo, khảo sát, ảnh lớp.
// SCORM chưa có permission key v1 riêng (gate qua flag + documents/curriculum).
// Key GIỮ NGUYÊN format v1 `resource:verb` (TS-01).
import type { ModuleDecl } from "./types";

export const lmsModule: ModuleDecl = {
  module: "lms",
  permissions: [
    // --- Curriculum (chương trình học) ---
    { key: "curriculum:view", action: "view" },
    { key: "curriculum:create", action: "create" },
    { key: "curriculum:edit", action: "edit" },
    { key: "curriculum:delete", action: "delete" },

    // --- Courses (khoá dạy) ---
    { key: "courses:view", action: "view" },
    { key: "courses:create", action: "create" },
    { key: "courses:edit", action: "edit" },
    { key: "courses:delete", action: "delete" },

    // --- Course packages (gói học / giá bán) ---
    { key: "course-packages:view", action: "view" },
    { key: "course-packages:edit", action: "edit" },

    // --- Questions (kho câu hỏi) ---
    { key: "questions:view", action: "view" },
    {
      key: "questions:author",
      action: "author",
      description: "Biên soạn câu hỏi mới vào kho toàn hệ thống.",
    },
    { key: "questions:edit", action: "edit" },
    { key: "questions:delete", action: "delete" },

    // --- Exams (đề thi) ---
    { key: "exams:view", action: "view" },
    { key: "exams:create", action: "create" },
    { key: "exams:edit", action: "edit" },
    { key: "exams:grade", action: "grade" },
    { key: "exams:delete", action: "delete" },

    // --- Assignments (bài tập) ---
    { key: "assignments:view", action: "view" },
    { key: "assignments:create", action: "create" },
    { key: "assignments:edit", action: "edit" },
    { key: "assignments:grade", action: "grade" },
    { key: "assignments:delete", action: "delete" },
    {
      key: "assignments:assign-own",
      action: "assign-own",
      description: "GV giao bài từ template có sẵn cho lớp mình phụ trách.",
    },
    {
      key: "assignments:author-own",
      action: "author-own",
      description: "GV tự soạn/xoá đề trong kho bài tập của chính mình.",
    },

    // --- Documents (tài liệu LMS) ---
    { key: "documents:view", action: "view" },
    { key: "documents:upload", action: "upload" },
    { key: "documents:delete", action: "delete" },

    // --- Teaching materials ---
    {
      key: "teaching-materials:view-own-class",
      action: "view-own-class",
      description: "GV xem tài liệu giảng dạy của lớp mình được giao.",
    },

    // --- Training (Đào tạo) ---
    {
      key: "training:manage",
      action: "manage",
      description: "Quản lý cấu hình đào tạo/LMS toàn hệ thống (role TRAINING).",
    },
    {
      // Báo cáo của chức năng nào thì nằm ở domain đó (BGĐ 10/07) —
      // reports:training thuộc domain đào tạo, không phải quyền quản trị hệ thống.
      key: "reports:training",
      action: "training",
      description: "Xem báo cáo đào tạo (lớp/GV/tiến độ) theo cơ sở.",
    },

    // --- Evaluations (khảo sát/đánh giá) ---
    { key: "evaluations:manage", action: "manage" },
    {
      key: "evaluations:view-aggregate",
      action: "view-aggregate",
      description: "Xem kết quả khảo sát dạng tổng hợp (không định danh).",
    },
    {
      key: "evaluations:view-detail",
      action: "view-detail",
      description: "Xem chi tiết từng phiếu khảo sát.",
    },

    // --- Media (ảnh lớp) ---
    { key: "media:view", action: "view" },
    {
      key: "media:upload",
      action: "upload",
      description: "Đăng ảnh lớp tới phụ huynh (qua bước duyệt).",
    },
    {
      key: "media:upload-draft",
      action: "upload-draft",
      description:
        "Đưa ảnh vào KHO của lớp — phụ huynh chưa thấy, giáo viên chọn ảnh gửi sau.",
    },
    {
      key: "media:approve",
      action: "approve",
      description: "Duyệt ảnh lớp trước khi hiện với phụ huynh.",
    },
  ],
};
