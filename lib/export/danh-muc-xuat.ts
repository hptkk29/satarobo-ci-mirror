// lib/export/danh-muc-xuat.ts — DANH MỤC mọi đường xuất dữ liệu. THUẦN: không DB, không React.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ FILE NÀY
//
// Trước 27/09/2026 mỗi đường xuất tự gác bằng một quyền khác nhau (`leads:export`,
// `payments:manage`, `students:view-all`, `classes:view-all`…). Hệ quả đo được: quyền để
// XEM một màn cũng là quyền để TẢI VỀ toàn bộ dữ liệu màn đó — hai việc rất khác nhau.
// Xem thì ở trong hệ thống, còn tệp thì rời khỏi hệ thống, chuyển tiếp được, không thu hồi
// được. Và không ai trả lời được câu "ai đang xuất được những gì" mà không đọc 14 file.
//
// Chủ dự án chốt 27/09/2026:
//   · mỗi nơi xuất phải phân quyền TƯỜNG MINH — vai nào xuất được phần nào;
//   · CHỈ quản trị tối cao được phân quyền đó (tab đặt sau `settings:view`, mà quyền này
//     KHÔNG vai nào trong `seed-roles.ts` được cấp ⇒ thực tế chỉ SUPER_ADMIN);
//   · nơi nào CHƯA phân quyền thì CHỈ quản trị tối cao xuất được.
//
// ─────────────────────────────────────────────────────────────────────────────
// `noiDung` KHÔNG PHẢI TRANG TRÍ
//
// Người phân quyền phải biết tệp đó chứa gì mới quyết được có giao cho Sale hay không.
// Một dòng "Xuất danh sách lead" không nói được rằng tệp có SĐT và email phụ huynh.
// Vì vậy mỗi màn khai `noiDung` (tệp có gì) và `nhayCam` (loại dữ liệu cần cân nhắc), và
// màn cấu hình in ra ĐÚNG những dòng đó cạnh ô chọn vai.
//
// ⚠️ `noiDung` phải khớp tệp THẬT. Sửa cột của một đường xuất thì sửa dòng ở đây cùng lượt —
// một mô tả sai còn tệ hơn không có mô tả, vì người ta phân quyền dựa vào nó.
//
// ─────────────────────────────────────────────────────────────────────────────
// `vaiMacDinh` — VÌ SAO KHÔNG ĐỂ RỖNG HẾT
//
// Luật của chủ dự án là "chưa phân quyền ⇒ chỉ admin". Với 8 đường xuất MỚI thì mặc định
// rỗng, đúng luật, khoá sẵn. Nhưng 14 đường ĐANG CHẠY trên prod thì để rỗng nghĩa là sáng
// hôm sau kế toán không chốt được kỳ và Sale không lấy được sổ chia lead — một đợt siết
// quyền hoá thành một sự cố vận hành mà không ai xin.
//
// Nên `vaiMacDinh` của các đường ĐÃ CÓ = đúng những vai đang xuất được HÔM NAY, đo từ
// `prisma/seed-roles.ts` ngày 27/09/2026 (parse theo cấu trúc `{ action: "…" }`, KHÔNG grep
// văn xuôi — chú thích trong seed nhắc tên quyền mà không cấp nó, bẫy đã ghi ở CLAUDE.md
// mục `audit-logs:view`). Đây là MẶC ĐỊNH, không phải thẩm quyền: admin sửa lại thì giá trị
// trong `SystemSetting` thắng. Đúng triết lý registry của repo — "default lấy đúng giá trị
// đang hardcode hiện tại, additive, không đổi hành vi khi DB trống".
//
// ⚠️ `vaiMacDinh` KHÔNG thay `quyenGoc`. Hai cổng CỘNG DỒN: vai phải nằm trong danh sách
// xuất VÀ vẫn phải có quyền đọc dữ liệu đó. Bỏ `quyenGoc` là biến ô tích trên màn cấu hình
// thành đường vòng qua cách ly cơ sở.

/** Nhóm để xếp màn cấu hình — theo việc của người vận hành, không theo module mã nguồn. */
export type NhomXuat = "nhan-su" | "khach-hang" | "day-hoc" | "tien" | "he-thong";

export type ManXuat = {
  /** Khoá bền — đi vào `SystemSetting`, ĐỪNG đổi sau khi đã lên prod. */
  ma: string;
  ten: string;
  nhom: NhomXuat;
  /** Màn người dùng bấm nút, để admin biết đang phân quyền cho chỗ nào. */
  man: string;
  /**
   * Quyền ĐỌC dữ liệu, vẫn bắt buộc và CỘNG DỒN với danh sách vai.
   * `null` = đường xuất không có quyền đọc riêng (cổng duy nhất là danh sách vai).
   */
  quyenGoc: string | null;
  /**
   * Câu mô tả cổng đọc khi `quyenGoc` là `null` VÌ route tự kiểm bằng logic phức hợp
   * (nhiều quyền, hoặc kiểm theo TỪNG cơ sở) — không phải vì màn không có cổng đọc.
   *
   * ⚠️ Hai ca `null` đó khác nhau hoàn toàn với người phân quyền, và màn cấu hình in ra hai
   * câu khác nhau. Gộp chúng là để giao diện nói "ô tích là cổng duy nhất" trong khi còn
   * một cổng nữa — đúng loại affordance nói dối luật 12 cấm.
   */
  quyenGocGhiChu?: string;
  /** Tệp đó chứa gì — in nguyên văn trên màn cấu hình. */
  noiDung: string[];
  /** Loại dữ liệu cần cân nhắc trước khi giao. Rỗng = không có gì đặc biệt. */
  nhayCam: string[];
  /** Vai xuất được khi admin chưa đụng tới. Rỗng = CHỈ quản trị tối cao. */
  vaiMacDinh: string[];
};

export const NHAN_NHOM: Record<NhomXuat, string> = {
  "nhan-su": "Nhân sự & chấm công",
  "khach-hang": "Khách hàng & lead",
  "day-hoc": "Lớp & học viên",
  tien: "Tiền & hoa hồng",
  "he-thong": "Hệ thống",
};

const m = (x: ManXuat): ManXuat => x;

export const MAN_XUAT: ManXuat[] = [
  // ── Nhân sự & chấm công ────────────────────────────────────────────────────
  m({
    ma: "nhan-su",
    ten: "Hồ sơ nhân sự",
    nhom: "nhan-su",
    man: "/admin/nhan-su",
    quyenGoc: "employees:view-all",
    noiDung: [
      "Mã NV · họ tên · chức danh · bộ phận · cơ sở · trạng thái · ngày vào làm · quản lý trực tiếp · vai trò hệ thống",
      "Email và số điện thoại",
      "Ngạch lương · bậc lương · mức đóng BHXH — chỉ khi người xuất có quyền xem lương",
      "Ngày sinh · giới tính · loại hợp đồng · ngày nghỉ việc · địa chỉ · liên hệ khẩn cấp · ghi chú — chỉ khi có quyền xem thông tin cá nhân",
      "Số CCCD KHÔNG bao giờ có trong tệp, kể cả với quản trị tối cao",
    ],
    nhayCam: ["Lương", "Thông tin cá nhân"],
    vaiMacDinh: ["HO_HR", "CENTER_HR"],
  }),
  m({
    ma: "cham-cong-ky",
    ten: "Bảng công kỳ (đã chốt)",
    nhom: "nhan-su",
    man: "/admin/cham-cong",
    quyenGoc: "hr_attendance:export",
    noiDung: [
      "Số công chốt của từng nhân sự trong một kỳ tháng",
      "Kỳ chưa chốt thì tệp là BẢN TẠM và tự ghi rõ điều đó",
    ],
    nhayCam: ["Công làm căn cứ tính lương"],
    vaiMacDinh: ["HO_ACCOUNTANT", "CENTER_MANAGER", "CENTER_ACCOUNTANT"],
  }),
  m({
    ma: "phan-ca-thang",
    ten: "Lưới phân ca tháng",
    nhom: "nhan-su",
    man: "/admin/cham-cong/phan-ca",
    // `null` vì route kiểm cổng XEM màn (`hr_attendance:assign` hoặc `hr_attendance:view`) theo
    // ĐÚNG khối xin xuất — hai quyền mang scope CENTER, hỏi không kèm cơ sở là luôn false.
    quyenGoc: null,
    quyenGocGhiChu:
      "Ai xem được lưới phân ca của một khối (quyền hr_attendance:assign hoặc hr_attendance:view tại khối đó) thì xuất được lưới của khối đó.",
    noiDung: [
      "Lưới người × ngày của một khối trong một tháng: mã ca từng ngày, đúng như màn Lưới phân ca",
      "Cột Công / Nghỉ đếm theo cùng luật với màn (mọi mã làm việc = 1; X, P = nghỉ)",
      "Sheet chú giải: giờ và số công của từng mã ca có mặt trong tháng",
    ],
    nhayCam: ["Lịch làm việc từng người"],
    vaiMacDinh: ["HO_HR", "CENTER_HR", "CENTER_MANAGER", "HO_ACCOUNTANT", "CENTER_ACCOUNTANT"],
  }),
  m({
    ma: "cham-cong-thang",
    ten: "Bảng công tháng (lưới ngày)",
    nhom: "nhan-su",
    man: "/admin/cham-cong/bang-cong-thang",
    // `null` vì route kiểm `hr_attendance:export` theo TỪNG cơ sở trong danh sách xin xuất
    // (quyền này mang scope CENTER, hỏi không kèm cơ sở là luôn trả false cho vai cấp cơ sở).
    quyenGoc: null,
    quyenGocGhiChu:
      "Quyền chấm công (hr_attendance:export) kiểm theo TỪNG cơ sở — cơ sở không có quyền bị loại khỏi tệp và ghi rõ trong sheet chú giải.",
    noiDung: [
      "Lưới người × ngày: mã ca từng ngày và trạng thái ngày đó",
      "Tổng công · số ngày đi làm · thiếu lượt quét · đi muộn · về sớm · tổng vi phạm",
      "Sheet chi tiết theo người: từng ngày kèm giờ vào/ra thực tế",
      "Xuất được nhiều cơ sở một lượt — cơ sở không có quyền bị loại và ghi rõ trong sheet chú giải",
    ],
    nhayCam: ["Giờ vào/ra từng người", "Công làm căn cứ tính lương"],
    vaiMacDinh: ["HO_ACCOUNTANT", "CENTER_MANAGER", "CENTER_ACCOUNTANT"],
  }),

  // ── Khách hàng & lead ──────────────────────────────────────────────────────
  m({
    ma: "lead",
    ten: "Danh sách lead",
    nhom: "khach-hang",
    man: "/admin/leads",
    quyenGoc: "leads:export",
    noiDung: [
      "Tên phụ huynh · SĐT · email · tên con · tuổi con",
      "Trạng thái phễu · nguồn · UTM source/medium/campaign · cơ sở · người phụ trách · ghi chú · ngày đăng ký",
      "Người không có quyền xem thông tin liên hệ thì tên/SĐT/email bị che (vd 09xx…456)",
    ],
    nhayCam: ["Liên hệ phụ huynh"],
    vaiMacDinh: ["CENTER_MANAGER"],
  }),
  m({
    ma: "lead-chuyen-doi",
    ten: "Lead đã chuyển đổi",
    nhom: "khach-hang",
    man: "/admin/dashboard-qlcs",
    quyenGoc: "leads:export",
    noiDung: [
      "Những lead đã thành học viên trong kỳ, kèm mốc thời gian chuyển đổi",
      "Thông tin liên hệ bị che với người không có quyền xem",
    ],
    nhayCam: ["Liên hệ phụ huynh"],
    vaiMacDinh: ["CENTER_MANAGER"],
  }),
  m({
    ma: "so-chia-lead",
    ten: "Sổ chia lead",
    nhom: "khach-hang",
    man: "/admin/leads/so-chia",
    quyenGoc: "lead_pool:manage",
    noiDung: [
      "Từng lượt chia: thời gian · lead · SĐT · cơ sở · người nhập · chia cho ai · nguồn",
      "Có tiêu lượt hay không, và số lượt còn lại sau khi chia",
    ],
    nhayCam: ["Liên hệ phụ huynh"],
    vaiMacDinh: ["CENTER_MANAGER"],
  }),
  m({
    ma: "mau-nhap-lead",
    ten: "Mẫu nhập lead (tệp trống)",
    nhom: "khach-hang",
    man: "/admin/leads/import",
    quyenGoc: "leads:create",
    noiDung: [
      "Chỉ có dòng tiêu đề để điền vào rồi nhập lên: khoá quan tâm · cơ sở · tuổi con",
      "KHÔNG chứa dữ liệu khách hàng nào",
    ],
    nhayCam: [],
    vaiMacDinh: ["HO_MARKETING", "HO_SALE", "CENTER_MANAGER", "CENTER_SALES_CSM"],
  }),

  // ── Lớp & học viên ─────────────────────────────────────────────────────────
  m({
    ma: "lop-hoc",
    ten: "Danh sách lớp & buổi học",
    nhom: "day-hoc",
    man: "/admin/classes",
    // `null` vì route nhận CẢ HAI đường: quản lý xem toàn cơ sở, hoặc giáo viên xem lớp
    // mình dạy. Khai cứng `classes:view-all` ở đây là chặn giáo viên xuất lớp của chính họ.
    quyenGoc: null,
    quyenGocGhiChu:
      "Quản lý xem lớp toàn cơ sở (classes:view-all), hoặc giáo viên với lớp mình dạy (classes:view-own) — route tự kiểm.",
    noiDung: [
      "Lớp: mã · tên · cơ sở · giáo viên · sĩ số · trạng thái · lịch học",
      "Buổi học: ngày · trạng thái (chưa dạy / đang dạy / đã dạy / huỷ)",
      "Ghi danh của từng lớp kèm trạng thái học viên",
    ],
    nhayCam: [],
    vaiMacDinh: [
      "HO_ACCOUNTANT",
      "HO_HR",
      "CENTER_HR",
      "HO_MARKETING",
      "TRAINING",
      "CENTER_MANAGER",
      "CENTER_CLASS_MANAGER",
      "CENTER_SALES_CSM",
      "CENTER_ACCOUNTANT",
    ],
  }),
  m({
    ma: "tien-do-hoc-vien",
    ten: "Báo cáo tiến độ học viên",
    nhom: "day-hoc",
    man: "/admin/students",
    quyenGoc: "students:view-all",
    noiDung: [
      "Tiến độ một học viên trong một lớp: buổi đã học · điểm danh · nhận xét",
    ],
    nhayCam: ["Nhận xét về trẻ"],
    vaiMacDinh: [
      "HO_ACCOUNTANT",
      "HO_HR",
      "CENTER_HR",
      "HO_MARKETING",
      "CENTER_MANAGER",
      "CENTER_CLASS_MANAGER",
      "CENTER_SALES_CSM",
      "CENTER_ACCOUNTANT",
    ],
  }),
  m({
    ma: "elearning-tuan-thu",
    ten: "Báo cáo tuân thủ e-learning",
    nhom: "day-hoc",
    man: "/admin/e-learning",
    quyenGoc: "elearning:report:export",
    noiDung: [
      "Một lượt giao bài: đã giao · hoàn thành đúng hạn · hoàn thành trễ · đang học · chưa học",
      "Tỉ lệ đúng hạn, kèm phần bị loại khỏi mẫu số (đã thu hồi, tạm dừng đồng hồ)",
    ],
    nhayCam: [],
    vaiMacDinh: ["HO_HR", "TRAINING", "CENTER_MANAGER", "AUDITOR"],
  }),

  // ── Tiền & hoa hồng ────────────────────────────────────────────────────────
  m({
    ma: "hoa-hong",
    ten: "Bảng kê hoa hồng",
    nhom: "tien",
    man: "/admin/crm/hoa-hong",
    quyenGoc: "payments:manage",
    noiDung: [
      "Bảng kê một kỳ: từng dòng hoa hồng, người nhận, tỉ lệ và số tiền",
    ],
    nhayCam: ["Thu nhập của nhân sự"],
    vaiMacDinh: ["HO_ACCOUNTANT", "CENTER_ACCOUNTANT"],
  }),

  // ── Hệ thống ───────────────────────────────────────────────────────────────
  m({
    ma: "audit-log",
    ten: "Sổ vết thao tác",
    nhom: "he-thong",
    man: "/admin/audit-log",
    quyenGoc: "audit-logs:view",
    noiDung: [
      "Ai làm gì, lúc nào, trên bản ghi nào — toàn hệ thống",
      "Giá trị trước/sau của thao tác, nên tệp có thể chứa dữ liệu của mọi module",
    ],
    nhayCam: ["Vết thao tác toàn hệ thống", "Có thể chứa thông tin cá nhân"],
    // `audit-logs:view` hiện KHÔNG vai nào được cấp (đo 13/09 và lại 27/09) ⇒ để rỗng là
    // đúng hiện trạng, không phải bỏ sót. Xem CLAUDE.md mục `audit-logs:view`.
    vaiMacDinh: [],
  }),
  m({
    ma: "tai-khoan-phu-huynh",
    ten: "Tài khoản phụ huynh",
    nhom: "he-thong",
    man: "/admin/students/tai-khoan",
    quyenGoc: "students:view-all",
    noiDung: [
      "Danh sách tài khoản phụ huynh: tên · SĐT đăng nhập · con đang học · trạng thái kích hoạt",
    ],
    nhayCam: ["Liên hệ phụ huynh"],
    vaiMacDinh: ["CENTER_MANAGER", "CENTER_SALES_CSM"],
  }),
  m({
    ma: "bao-cao-trial-sale",
    ten: "Báo cáo học thử theo Sale",
    nhom: "khach-hang",
    man: "/admin/bao-cao/trial-sale",
    quyenGoc: "leads:view-all",
    noiDung: [
      "Theo từng Sale: số lead giao · số buổi học thử · số chốt · tỉ lệ chuyển đổi",
    ],
    nhayCam: ["Hiệu suất cá nhân"],
    vaiMacDinh: ["CENTER_MANAGER"],
  }),
  // ── Bảy màn NHẬP-LẠI-ĐƯỢC (thêm 27/09/2026) ──────────────────────────────
  //
  // Bảy màn này có đường NHẬP mà chưa có đường XUẤT. Tệp xuất ra dùng được luôn làm tệp
  // nhập vào (khoá cột trùng khít `columnHints` của màn nhập — `lib/export/nhap-lai.ts`).
  //
  // ⚠️ `vaiMacDinh: []` — CHỈ quản trị tối cao, đúng luật "chưa phân quyền thì chỉ admin".
  // Đây là đường xuất MỚI nên không có hành vi cũ nào để giữ, và một tệp nhập-lại-được là
  // tệp SỬA HÀNG LOẠT được: giao nó cho ai là quyết định có chủ đích, không phải mặc định.
  m({
    ma: "co-so",
    ten: "Danh mục cơ sở",
    nhom: "he-thong",
    man: "/admin/centers",
    quyenGoc: "centers:view",
    noiDung: [
      "Tên · slug · địa chỉ · phường · quận · tỉnh/TP · SĐT · email · Google Maps · giờ làm việc · quản lý · mô tả · đang hoạt động · thứ tự",
      "Nhập lại được ngay vào /admin/centers/import (upsert theo slug)",
      "Chỉ gồm cơ sở người xuất được nhìn",
    ],
    nhayCam: [],
    vaiMacDinh: [],
  }),
  m({
    ma: "phong-hoc",
    ten: "Danh mục phòng học",
    nhom: "he-thong",
    man: "/admin/rooms",
    quyenGoc: "rooms:view",
    noiDung: [
      "Tên · mã · slug cơ sở · sức chứa · thiết bị · trạng thái · ghi chú · thứ tự",
      "Nhập lại được ngay vào /admin/rooms/import (upsert theo cơ sở + mã phòng)",
    ],
    nhayCam: [],
    vaiMacDinh: [],
  }),
  m({
    ma: "lich-nghi",
    ten: "Lịch nghỉ / ngày đặc biệt",
    nhom: "nhan-su",
    man: "/admin/holidays",
    quyenGoc: "holidays:view",
    noiDung: [
      "Tên · ngày bắt đầu · ngày kết thúc · slug cơ sở (rỗng = toàn hệ thống) · loại · ghi chú",
      "Nhập lại được ngay vào /admin/holidays/import",
    ],
    nhayCam: [],
    vaiMacDinh: [],
  }),
  m({
    ma: "hoc-cu",
    ten: "Danh mục học cụ",
    nhom: "he-thong",
    man: "/admin/inventory/items",
    quyenGoc: "inventory:view",
    noiDung: [
      "Mã hàng · tên · mô tả · danh mục · đơn vị · giá/đơn vị · nhà cung cấp · ngưỡng tối thiểu · tags · đang dùng · ghi chú",
      "Nhập lại được ngay vào /admin/inventory/items/import (upsert theo mã hàng)",
    ],
    nhayCam: ["Giá mua và nhà cung cấp"],
    vaiMacDinh: [],
  }),
  m({
    ma: "cau-hoi",
    ten: "Ngân hàng câu hỏi",
    nhom: "day-hoc",
    man: "/admin/questions",
    quyenGoc: "questions:view",
    noiDung: [
      "Mã · loại · đề bài · độ khó · tags · khoá · phiên bản khung · điểm · thời gian · đáp án",
      "Bốn lựa chọn A–D kèm cột đánh dấu đáp án đúng, giải thích, công khai hay không",
      "Nhập lại được ngay vào /admin/questions/import (upsert theo mã câu hỏi)",
    ],
    nhayCam: ["Đáp án đúng của đề thi"],
    vaiMacDinh: [],
  }),
  m({
    ma: "hoc-vien",
    ten: "Danh sách học viên",
    nhom: "day-hoc",
    man: "/admin/students",
    quyenGoc: "students:view-all",
    noiDung: [
      "Mã HS · họ tên · ngày sinh · giới tính · lớp · trường",
      "Phụ huynh chính và phụ huynh 2: tên · SĐT · email · quan hệ",
      "Địa chỉ · phường · quận · tỉnh/TP · cơ sở mong muốn · ngày đăng ký · trạng thái",
      "Nhóm máu · dị ứng · ghi chú sức khoẻ · ghi chú nội bộ",
      "Nhập lại được ngay vào /admin/students/import (upsert theo mã HS)",
      "Số CCCD phụ huynh KHÔNG có trong tệp",
    ],
    nhayCam: ["Liên hệ phụ huynh", "Thông tin sức khoẻ của trẻ"],
    vaiMacDinh: [],
  }),
  m({
    ma: "lop-trial",
    ten: "Lớp trải nghiệm",
    nhom: "khach-hang",
    man: "/admin/lop-trial",
    quyenGoc: "trials:view",
    noiDung: [
      "Slug cơ sở · ngày · giờ bắt đầu · giờ kết thúc · tên lớp",
      "Nhập lại được ngay vào /admin/lop-trial/import để mở lớp hàng loạt",
    ],
    nhayCam: [],
    vaiMacDinh: [],
  }),
  // ── Năm đường xuất BÁO CÁO (thêm 27/09/2026, đợt 2) ───────────────────────
  //
  // Khác bảy màn trên: tệp này để ĐỌC và gửi đi, không để nhập lại, nên tiêu đề là nhãn
  // tiếng Việt (cờ `tieuDeLaKhoa: false` ở `lib/export/bo-xuat.ts`).
  //
  // Cả năm `vaiMacDinh: []` — chỉ quản trị tối cao. Bốn trong năm chạm tiền hoặc chạm quyền,
  // và không màn nào trong số này trước đây có đường xuất, nên không có hành vi cũ phải giữ.
  m({
    ma: "cong-no",
    ten: "Công nợ học phí",
    nhom: "tien",
    man: "/admin/cong-no",
    quyenGoc: "payments:view",
    noiDung: [
      "Từng ghi danh: học viên · khoá · học phí · đã thu (kế toán xác nhận) · đã ghi nhận (Sale nhập) · CHỜ xác nhận · còn nợ",
      "Ghi danh chưa chốt giá hiện thành chữ “chưa chốt giá”, KHÔNG phải số 0 — đó là nhóm cần người xử lý",
      "Sheet phụ: nhóm tuổi nợ quá hạn, cộng theo TỪNG ĐỢT trả góp còn phải thu",
      "Số liệu dựng bằng đúng hàm màn /cong-no dùng (getDebtRows), nên tệp và màn không lệch",
    ],
    nhayCam: ["Công nợ của từng gia đình"],
    vaiMacDinh: [],
  }),
  m({
    ma: "ghi-danh",
    ten: "Danh sách ghi danh",
    nhom: "day-hoc",
    man: "/admin/enrollments",
    quyenGoc: "enrollments:view-all",
    noiDung: [
      "Mã HS · học viên · phụ huynh · mã lớp · lớp · cơ sở · trạng thái · học phí đã chốt · ngày đăng ký · ngày bắt đầu học",
    ],
    nhayCam: ["Học phí từng học viên"],
    vaiMacDinh: [],
  }),
  m({
    ma: "tai-khoan",
    ten: "Tài khoản đăng nhập & vai trò",
    nhom: "he-thong",
    man: "/admin/users",
    quyenGoc: "users:manage",
    noiDung: [
      "Tên · email đăng nhập · số điện thoại · vai trò (hợp của mọi vai) · cơ sở · hồ sơ nhân sự · mã NV · đang hoạt động · ngày tạo",
      "Số quyền cấp riêng của từng người — cột này đáng soát bằng tay",
      "KHÔNG chứa mật khẩu hay mã xác thực nào",
    ],
    nhayCam: ["Danh sách người có quyền vào hệ thống"],
    vaiMacDinh: [],
  }),
  m({
    ma: "quyen-vai",
    ten: "Ma trận vai × quyền",
    nhom: "he-thong",
    man: "/admin/roles",
    quyenGoc: "roles:manage",
    noiDung: [
      "MỘT DÒNG = MỘT CẶP (vai, quyền) — lọc và pivot được trong Excel",
      "Mã vai · tên vai · quyền · phạm vi (toàn hệ thống / theo cơ sở / theo lớp / của chính mình / được phân công) · số người đang giữ vai",
      "Vai chưa được cấp quyền nào vẫn có một dòng, ghi rõ “(chưa cấp quyền nào)”",
      "Đọc từ RoleDef/RolePermission trong DB — tức nguồn hệ thống THỰC SỰ dùng để chặn, không phải file seed",
    ],
    nhayCam: ["Bản đồ phân quyền toàn hệ thống"],
    vaiMacDinh: [],
  }),
  m({
    ma: "buoi-hoc",
    ten: "Buổi học",
    nhom: "day-hoc",
    man: "/admin/sessions",
    quyenGoc: "sessions:view",
    noiDung: [
      "Ngày VÀ GIỜ buổi học · mã lớp · lớp · cơ sở · nội dung buổi · trạng thái (chưa dạy / đang dạy / đã dạy / huỷ)",
      "Số lượt điểm danh ĐÃ GHI — đây không phải số em có mặt",
    ],
    nhayCam: [],
    vaiMacDinh: [],
  }),
];

/** Tra cứu theo mã. `undefined` = mã lạ, và người gọi PHẢI coi đó là từ chối. */
export function timManXuat(ma: string): ManXuat | undefined {
  return MAN_XUAT.find((x) => x.ma === ma);
}

/** Nhóm lại để vẽ màn cấu hình — giữ đúng thứ tự khai trong `NHAN_NHOM`. */
export function manXuatTheoNhom(): { nhom: NhomXuat; ten: string; man: ManXuat[] }[] {
  return (Object.keys(NHAN_NHOM) as NhomXuat[])
    .map((n) => ({ nhom: n, ten: NHAN_NHOM[n], man: MAN_XUAT.filter((x) => x.nhom === n) }))
    .filter((g) => g.man.length > 0);
}
