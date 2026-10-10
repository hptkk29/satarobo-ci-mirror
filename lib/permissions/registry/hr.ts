// Registry quyền — module Nhân sự: hồ sơ nhân viên, chấm công QR, bảng lương.
// sensitiveFields đối chiếu EMPLOYEE_GATED_FIELDS (lib/auth/permissions.ts) —
// dùng tên field THẬT của model Employee, không dùng tên gợi ý chung chung.
// Key GIỮ NGUYÊN format v1 `resource:verb` (TS-01).
import type { ModuleDecl } from "./types";

export const hrModule: ModuleDecl = {
  module: "hr",
  permissions: [
    // --- Employees ---
    { key: "employees:view-all", action: "view-all" },
    { key: "employees:view-public", action: "view-public" },
    { key: "employees:create", action: "create" },
    { key: "employees:edit", action: "edit" },
    { key: "employees:delete", action: "delete" },
    {
      key: "employees:view-salary",
      action: "view-salary",
      // = EMPLOYEE_GATED_FIELDS.salary
      sensitiveFields: ["salaryRank", "salaryLevel", "bhxhBase"],
      description: "Xem nhóm trường lương của nhân viên.",
    },
    {
      key: "employees:view-personal",
      action: "view-personal",
      // = EMPLOYEE_GATED_FIELDS.personal
      sensitiveFields: [
        "dateOfBirth",
        "gender",
        "contractType",
        "managerId",
        "endDate",
        "nationalId",
        "address",
        "emergencyContact",
        "notes",
      ],
      description: "Xem nhóm trường cá nhân/hợp đồng của nhân viên.",
    },

    // --- HR attendance (chấm công QR) ---
    {
      key: "hr_attendance:checkin",
      action: "checkin",
      description: "Tự chấm công vào/ra (self-action của mọi nhân viên).",
    },
    { key: "hr_attendance:view", action: "view" },
    {
      key: "hr_attendance:adjust",
      action: "adjust",
      description: "Chỉnh bản ghi công + duyệt yêu cầu chỉnh công.",
    },
    // --- Module chấm công v3 (L1 · 06/09/2026) — kế hoạch §5 ---
    {
      key: "hr_attendance:assign",
      action: "assign",
      description: "Khung ca tuần, lưới tháng, import lịch phân ca (QLCS, Nhân sự HO).",
    },
    {
      key: "hr_attendance:approve",
      action: "approve",
      description: "Duyệt đơn nghỉ / đổi ca / chỉnh công của cơ sở (QLCS).",
    },
    {
      key: "hr_attendance:close-period",
      action: "close-period",
      description: "Chốt / mở lại kỳ công của cơ sở (QLCS, Kế toán).",
    },
    {
      key: "hr_attendance:export",
      action: "export",
      description: "Xuất bảng công tổng hợp Excel.",
    },
    {
      key: "hr_attendance:config",
      action: "config",
      description: "Danh mục mã ca, điểm chấm công, loại nghỉ, ngày lễ + hệ số công.",
    },

    // --- Payroll ---
    { key: "payroll:view", action: "view" },
    { key: "payroll:edit", action: "edit" },
  ],
};
