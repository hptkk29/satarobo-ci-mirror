// Registry quyền — module Học viên: hồ sơ, ghi danh, điểm danh HV, hoàn thành khoá,
// học bạ, SataCoin. Key GIỮ NGUYÊN format v1 `resource:verb` (TS-01).
import type { ModuleDecl } from "./types";

export const studentsModule: ModuleDecl = {
  module: "students",
  permissions: [
    // --- Students (hồ sơ học viên) ---
    {
      key: "students:view-all",
      action: "view-all",
      // US-03/TS-02 — trường nhạy cảm cho DENY cấp trường (tên cột THẬT trên Student).
      sensitiveFields: ["parentPhone"],
    },
    { key: "students:view-own-class", action: "view-own-class" },
    { key: "students:create", action: "create" },
    { key: "students:edit", action: "edit" },
    {
      key: "students:change-code",
      action: "change-code",
      description: "Sửa mã học viên (audit + reason bắt buộc).",
    },
    { key: "students:delete", action: "delete" },
    {
      key: "students:import",
      action: "import",
      description: "Import danh sách học viên từ file.",
    },

    // --- Enrollments (ghi danh) ---
    { key: "enrollments:view-all", action: "view-all" },
    { key: "enrollments:view-own", action: "view-own" },
    { key: "enrollments:create", action: "create" },
    { key: "enrollments:edit", action: "edit" },
    {
      key: "enrollments:transfer",
      action: "transfer",
      description: "Chuyển học viên sang lớp khác.",
    },
    { key: "enrollments:cancel", action: "cancel" },
    { key: "enrollments:delete", action: "delete" },
    {
      key: "enrollments:override-progress",
      action: "override-progress",
      description:
        "Xếp học viên vào lớp đã học quá tiến độ cho phép (màn Chuyển đổi đơn). " +
        "Chỉ Quản trị tối cao. KHÔNG vượt được sĩ số lớp — lớp đầy thì không ai thêm được.",
    },

    // --- Attendance (điểm danh học viên) ---
    { key: "attendance:view", action: "view" },
    { key: "attendance:mark", action: "mark" },
    {
      key: "attendance:edit",
      action: "edit",
      description: "Sửa/hồi tố điểm danh (cửa sổ 7 ngày ép ở call-site).",
    },

    // --- Completions (hoàn thành khoá) ---
    { key: "completions:manage", action: "manage" },
    {
      key: "completions:propose-own",
      action: "propose-own",
      description: "GV đề xuất hoàn thành khoá cho lớp mình (không tự xác nhận).",
    },

    // --- Report cards (học bạ) ---
    { key: "report-cards:manage", action: "manage" },
    {
      key: "report-cards:review",
      action: "review",
      description: "Duyệt/phát hành/thu hồi học bạ.",
    },

    // --- SataCoin ---
    {
      key: "satacoin:manage",
      action: "manage",
      description: "Cộng/trừ SataCoin thưởng cho học viên.",
    },

    // --- Bảo lưu học viên (08/10/2026, docs/bao-luu/spec.md §C) ---
    { key: "bao-luu:view", action: "view", description: "Xem hồ sơ bảo lưu và dòng thời gian sự kiện." },
    { key: "bao-luu:create", action: "create", description: "Lập hồ sơ bảo lưu, đề nghị gia hạn, báo phục học, huỷ hồ sơ chưa bắt đầu." },
    { key: "bao-luu:approve", action: "approve", description: "Duyệt/từ chối hồ sơ bảo lưu, lùi ngày bắt đầu, xác nhận lớp phục học. Không duyệt hồ sơ do chính mình lập." },
    { key: "bao-luu:extend", action: "extend", description: "Duyệt gia hạn bảo lưu. Không duyệt gia hạn do chính mình đề nghị." },
    { key: "bao-luu:exception", action: "exception", description: "Vượt trần thời hạn, ngoại lệ, khôi phục hồ sơ đã chấm dứt — bắt buộc lý do (chỉ BGĐ)." },
    { key: "bao-luu:center-pause", action: "center-pause", description: "Bảo lưu do Trung tâm (một học viên hoặc cả lớp)." },
    { key: "bao-luu:settings", action: "settings", description: "Sửa tham số bảo lưu (pause.*)." },
    { key: "bao-luu:refund-request", action: "refund-request", description: "Sinh yêu cầu hoàn học phí chưa sử dụng gửi Kế toán." },
  ],
};
