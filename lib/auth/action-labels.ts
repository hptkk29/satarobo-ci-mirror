// Vietnamese labels cho Action strings dạng "<resource>:<verb>".
// Dùng cho UI per-user permission grants — convert raw action sang
// label tiếng Việt + category để group hiển thị.

const RESOURCE_LABELS: Record<string, string> = {
  employees: "Nhân sự",
  users: "Tài khoản",
  classes: "Lớp học",
  students: "Học viên",
  leads: "Khách hàng tiềm năng",
  honors: "Vinh danh",
  news: "Tin tức",
  blog: "Blog",
  recruitment: "Tuyển dụng",
  jobs: "Tin tuyển dụng",
  centers: "Cơ sở",
  enrollments: "Đăng ký lớp",
  sessions: "Buổi học",
  attendance: "Điểm danh",
  curriculum: "Giáo trình",
  curriculums: "Giáo trình",
  courses: "Khoá học",
  exams: "Đề thi",
  questions: "Câu hỏi đề thi",
  rooms: "Phòng học",
  kits: "Học cụ",
  inventory: "Kho",
  documents: "Tài liệu",
  marketing: "Marketing",
  "site-content": "Nội dung trang web",
  "course-packages": "Gói khoá học",
  holidays: "Ngày nghỉ",
  assignments: "Bài tập",
  payroll: "Bảng lương",
  "audit-logs": "Audit logs",
  settings: "Cài đặt",
  roles: "Vai trò",
  // Phase 5.6 — Financial
  payments: "Phương thức thanh toán",
  orders: "Đơn hàng",
  // 27/08 — khai QC / quản lý phụ trách cơ sở (người hưởng hoa hồng QC 1% + QL TT 2%).
  "commission-assignee": "Người hưởng hoa hồng theo cơ sở",
  // Phase 5.7 — Vouchers
  // Chat realtime (US-05)
  chat: "Tin nhắn (chat)",
  // Hộp thư đa kênh — hội thoại với KHÁCH ngoài hệ (khác `chat` nội bộ).
  inbox: "Hộp thư đa kênh",
  // Ứng dụng ZaloCRM nhúng (nick Zalo CÁ NHÂN) — khác cả `inbox` (Zalo OA của công ty)
  // lẫn `chat` (nội bộ). Nhãn phải nói rõ "Zalo CRM" chứ không phải "Zalo", kẻo người
  // cấp quyền tưởng đang mở/đóng hộp thư Zalo OA.
  zalocrm: "Zalo CRM (nick cá nhân)",
  media: "Ảnh lớp học",
};

const VERB_LABELS: Record<string, string> = {
  "view-all": "Xem tất cả",
  "view-own": "Xem của mình",
  "view-public": "Xem (công khai)",
  "view-salary": "Xem lương",
  "view-personal": "Xem thông tin cá nhân",
  "view-financial": "Xem tài chính",
  "view-own-class": "Xem lớp của mình",
  reply: "Trả lời",
  create: "Tạo mới",
  edit: "Chỉnh sửa",
  delete: "Xoá",
  manage: "Quản lý toàn quyền",
  settings: "Cấu hình",
  import: "Nhập file",
  export: "Xuất file",
  approve: "Phê duyệt",
  publish: "Xuất bản",
  archive: "Lưu trữ",
  assign: "Phân công",
  transfer: "Chuyển lớp",
  cancel: "Huỷ",
  upload: "Đăng ảnh (tới phụ huynh)",
  // 11/08 — tách khỏi `upload`: chỉ đưa ảnh vào KHO của lớp, giáo viên mới gửi PH.
  // Không có nhãn thì màn cấp quyền per-user hiện "upload-draft" thô, rất dễ cấp
  // nhầm sang `media:upload` (= đăng thẳng tới phụ huynh).
  "upload-draft": "Đưa ảnh vào kho (chưa gửi phụ huynh)",
  movement: "Nhập/Xuất",
  audit: "Kiểm kho",
  mark: "Đánh dấu",
  view: "Xem",
  author: "Soạn",
  grade: "Chấm điểm",
  // Chat realtime (US-05)
  read: "Đọc tin",
  send: "Gửi tin",
  announce: "Gửi thông báo",
  moderate: "Gỡ tin vi phạm",
  admin: "Quản trị hội thoại",
  // Tích hợp ZaloCRM (S6). Verb `use` gộp cả mở màn lẫn nhắn khách — bên trong iframe
  // là ứng dụng ngoài, repo này không gác được từng thao tác, nên tách `view`/`reply`
  // sẽ là quyền GIẢ. Nhãn nói đúng phạm vi đó để người cấp quyền không hiểu là "chỉ xem".
  use: "Sử dụng (mở màn + nhắn khách)",
};

export function getActionMeta(action: string): {
  label: string;
  category: string;
  rawVerb: string;
} {
  const [resource, ...verbParts] = action.split(":");
  const verb = verbParts.join(":");

  const category = RESOURCE_LABELS[resource] ?? resource;
  const label = VERB_LABELS[verb] ?? verb;

  return { label, category, rawVerb: verb };
}

/**
 * Group actions theo category (resource) — sort tiếng Việt theo locale "vi".
 * Trả về Map insertion-ordered (sorted) → iterate ổn định.
 */
export function groupActionsByCategory(
  actions: readonly string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const action of actions) {
    const { category } = getActionMeta(action);
    if (!map.has(category)) map.set(category, []);
    map.get(category)!.push(action);
  }
  const sorted = new Map<string, string[]>();
  for (const cat of [...map.keys()].sort((a, b) => a.localeCompare(b, "vi"))) {
    sorted.set(cat, map.get(cat)!.sort());
  }
  return sorted;
}
