// lib/settings/nhan-van-hanh.ts — lớp NGÔN NGỮ NGƯỜI VẬN HÀNH cho trang Cấu hình vận hành.
//
// ── VÌ SAO CÓ FILE NÀY ───────────────────────────────────────────────────────────────────
// `registry.ts` đặt tên theo cách người viết mã nghĩ: `group: "cron"`, nhãn mang "SLA-0",
// "rate-limit", "signed URL", "idempotency", "geofence", "cutover", "Template ID". Người dùng
// trang này là quản trị hệ thống của trung tâm — họ không biết cron là gì, và họ KHÔNG thể
// đoán. Một tham số mà người có quyền đổi không hiểu nghĩa thì hoặc là không ai đụng tới, hoặc
// là bị đổi sai; cả hai đều tệ hơn là không có tham số.
//
// Nên: registry giữ nguyên (nó là hợp đồng kỹ thuật, và `key` vẫn là thứ tra được trong nhật
// ký kiểm toán), còn file này khai CÁI TÊN VÀ CÂU GIẢI THÍCH mà con người đọc.
//
// ── HAI LUẬT CỦA FILE NÀY ────────────────────────────────────────────────────────────────
// 1. MỌI key trong `SETTINGS` phải có một dòng ở đây. Thiếu một dòng thì tham số đó rơi khỏi
//    giao diện — không lỗi, không cảnh báo, chỉ là người vận hành không bao giờ thấy nó nữa.
//    `nhan-van-hanh.test.ts` khoá lại cả hai chiều.
// 2. `giaiThich` trả lời "đổi cái này thì CHUYỆN GÌ XẢY RA", không phải "cái này là gì". Câu
//    "Ngưỡng sắp hết khoá" không giúp ai quyết định; câu "còn bao nhiêu buổi thì học viên hiện
//    lên danh sách cần gọi tái tục" thì có.
//
// THUẦN: không DB, không React. Test không cần dựng gì.

import { SETTING_KEYS, type SettingKey } from "./registry";

/**
 * Các tab của trang, theo đúng thứ tự hiện ra.
 *
 * ⚠️ `ten` phải NGẮN — một hoặc hai từ. Đo 13/09: bản đầu đặt nhãn đầy đủ ("Thông báo điện
 * thoại", "Đăng nhập & mã xác thực"…) thì 11 tab cần ~1553px, tức KHÔNG BAO GIỜ vừa một
 * hàng kể cả trên màn 1440 — thanh tab cuộn ngang và tab đầu bị cắt cụt giữa chữ. Câu đầy
 * đủ nằm ở `moTa`, hiện ngay dưới thanh tab khi tab đó đang mở, nên không mất thông tin gì.
 *
 * Chia theo CÔNG VIỆC của người vận hành, không theo module mã nguồn. Ví dụ mọi thứ liên quan
 * tới tin Zalo gửi phụ huynh nằm chung một tab, dù trong mã chúng thuộc ba nhóm khác nhau
 * (`chat`, `zalo`, `student`) — người đi chỉnh "tin nhắn cho phụ huynh" không việc gì phải
 * biết ranh giới module.
 */
export const TAB_CAU_HINH = [
  {
    id: "thong-bao-day",
    ten: "Thông báo đẩy",
    moTa: "Thông báo hiện trên màn hình khoá điện thoại của nhân viên.",
  },
  {
    id: "zalo",
    ten: "Tin Zalo",
    moTa: "Các loại tin nhắn Zalo hệ thống gửi cho phụ huynh. Mỗi tin gửi đi đều tốn phí.",
  },
  {
    id: "dang-nhap",
    ten: "Đăng nhập",
    moTa: "Mã xác thực gửi qua Zalo khi đăng nhập hoặc kích hoạt tài khoản.",
  },
  {
    id: "hoc-vien",
    ten: "Học viên",
    moTa: "Các mốc để hệ thống tự nhắc: sắp hết khoá, hay vắng, sinh nhật, bảo lưu.",
  },
  {
    id: "lop-gv",
    ten: "Lớp & giáo viên",
    moTa: "Sĩ số, tải dạy và những gì phụ huynh được xem.",
  },
  {
    id: "cham-cong",
    ten: "Chấm công",
    moTa: "Quy định chấm công, đi muộn, nghỉ phép và đăng ký ca.",
  },
  {
    id: "khach-hang",
    ten: "Khách hàng",
    moTa: "Chống trùng khách, hoa hồng, và các mốc thời gian bị coi là chậm xử lý.",
  },
  {
    id: "tien",
    ten: "Thanh toán",
    moTa: "Nhắc công nợ, mã QR chuyển khoản và cách đối khớp tiền về.",
  },
  {
    id: "nhac-tu-dong",
    ten: "Nhắc tự động",
    moTa: "Hệ thống tự nhắc trước bao lâu, và bảng việc cần xử lý hiện thế nào.",
  },
  {
    id: "cong-ty",
    ten: "Công ty",
    moTa: "Số điện thoại, email và các khối nội dung hiện trên website.",
  },
  {
    id: "nang-cao",
    ten: "Nâng cao",
    moTa: "Ít khi phải đụng tới. Hỏi bên kỹ thuật trước khi đổi.",
  },
  {
    id: "phuong-thuc-tt",
    ten: "Phương thức thanh toán",
    moTa:
      "Tiền mặt, chuyển khoản, cổng online — khai theo từng cơ sở hoặc dùng chung cho cả " +
      "hệ thống. Tài khoản ngân hàng dựng mã QR nằm ngay trong từng phương thức.",
  },
  {
    id: "may-pos",
    ten: "Máy POS",
    moTa:
      "Máy quẹt thẻ SmartPOS Techcombank đặt ở cơ sở nào. Giao dịch thẻ của máy chưa khai " +
      "không tự khớp được với phiếu thu.",
  },
  {
    id: "nick-zalo",
    ten: "Nick Zalo CRM",
    moTa:
      "Giao từng nick Zalo cho một người. Nick đã giao thì chỉ người đó và quản lý cơ sở " +
      "đọc được; nick chưa giao thì cả cơ sở đều thấy.",
  },
  {
    id: "quyen-xuat",
    ten: "Quyền xuất dữ liệu",
    moTa:
      "Vai nào tải được tệp của màn nào. Mỗi màn ghi rõ tệp của nó chứa gì để cân nhắc " +
      "trước khi giao. Màn chưa giao cho vai nào thì chỉ quản trị tối cao tải được.",
  },
  {
    id: "hoa-hong",
    ten: "Hoa hồng",
    moTa:
      "Khoản chi cho nhân sự khi có học viên mới, tái tục, chuyển trung tâm hoặc bán thiết " +
      "bị. Thêm bớt được, không cần lập trình viên.",
  },
] as const;

export type TabId = (typeof TAB_CAU_HINH)[number]["id"];

/**
 * Quyền mở từng tab.
 *
 * ⚠️ KHÔNG có giá trị mặc định, và đó là chủ đích (luật 7): khai `Record` ĐỦ khiến `tsc`
 * bắt người thêm tab mới phải NÓI RÕ ai mở được nó. Một mặc định ở đây nghĩa là tab mới
 * lặng lẽ thừa hưởng quyền của tab khác — với một màn cấu hình toàn hệ thống thì đó là
 * cách mở quyền mà không ai nhận ra.
 *
 * Phần lớn tab là cấu hình TOÀN HỆ THỐNG ⇒ `settings:view`, thực tế là Quản trị tối cao.
 * Tab nào thuộc việc của CƠ SỞ thì khai quyền riêng của module đó, để quản lý cơ sở vào
 * được đúng phần của mình mà không thấy các tab còn lại.
 */
export const QUYEN_TAB: Record<TabId, string> = {
  "thong-bao-day": "settings:view",
  zalo: "settings:view",
  "dang-nhap": "settings:view",
  "hoc-vien": "settings:view",
  "lop-gv": "settings:view",
  "cham-cong": "settings:view",
  "khach-hang": "settings:view",
  // ⚠️ 24/09/2026 — QUYỀN RIÊNG cho tab này, và đó là CẢ ĐIỂM của cơ chế quyền-theo-tab:
  // nới MỘT tab không kéo theo 13 tab kia.
  //
  // Chủ dự án chốt 22/09: trần số đợt / số ưu đãi thì Quản lý cơ sở chỉnh được. Tab này
  // chứa 13 khoá chính sách TIỀN (trần đợt, trần ưu đãi, nhắc nợ, làm tròn, hạn QR, ưu đãi
  // anh em) — KHÔNG khoá bí mật nào (OTP / mẫu tin ZNS / khoá VAPID nằm ở tab khác).
  //
  // Vào được tab KHÔNG có nghĩa sửa được giá trị TOÀN CỤC: canEditGlobal vẫn đòi
  // settings:edit (chỉ Quản trị tối cao). QLCS chỉ ghi được phần CỦA CƠ SỞ MÌNH, và cổng
  // thật nằm ở setCenterSetting — đòi vai quản lý tại ĐÚNG orgUnitId đang sửa (ca [QCS-03]).
  tien: "settings:view-center",
  "nhac-tu-dong": "settings:view",
  "cong-ty": "settings:view",
  "nang-cao": "settings:view",
  "phuong-thuc-tt": "settings:view",
  "hoa-hong": "settings:view",
  // `settings:view` = chỉ Quản trị tối cao (đo 27/09/2026: KHÔNG vai nào trong
  // `seed-roles.ts` được cấp quyền này, nên chỉ SUPER_ADMIN mở được qua nhánh bypass của
  // `can()` v2). Đó chính là chốt "chỉ admin được phân quyền" — nới quyền này là nới luôn
  // ai được quyết ai xuất được dữ liệu gì.
  "quyen-xuat": "settings:view",
  "nick-zalo": "zalocrm:manage-nick",
  // 29/09/2026 (chủ dự án chốt Q-D, docs/pos-the-smartpos.md) — khai máy POS ⇒ cơ sở là việc
  // của Kế toán HO: cùng quyền gác màn import file thẻ. Gác bằng `settings:view` là chính
  // người import KHÔNG khai được máy, và mọi giao dịch kẹt ở "Thiết bị chưa gán cơ sở".
  "may-pos": "payments:import-pos",
};

/**
 * Tab TỰ QUẢN quyền ghi: nội dung riêng (`noiDungRieng`) mà action của nó tự hỏi quyền — KHÔNG
 * phụ thuộc `settings:edit`. Dải "Bạn chỉ có quyền xem" + câu "mỗi lần lưu phải ghi lý do" của
 * màn nói về Ô CẤU HÌNH CHUNG, nên người chỉ thấy các tab này không được đọc chúng: Kế toán HO
 * vào tab Máy POS thêm / sửa / tắt máy được trong khi dải vàng nói "chỉ xem" (luật 12). `[QT-06]`
 */
export const TAB_TU_QUAN_QUYEN_GHI: ReadonlySet<TabId> = new Set<TabId>(["may-pos", "nick-zalo"]);

/** Người xem có thấy ÍT NHẤT một tab mà quyền sửa đi theo `settings:edit` không. */
export function coTabTheoQuyenSuaChung(tabDuocXem: Iterable<TabId>): boolean {
  for (const t of tabDuocXem) if (!TAB_TU_QUAN_QUYEN_GHI.has(t)) return true;
  return false;
}

export interface NhanVanHanh {
  tab: TabId;
  /** Tên người vận hành đọc. Viết như một câu nói, không phải như tên biến. */
  ten: string;
  /** Đổi cái này thì chuyện gì xảy ra. Một hoặc hai câu. */
  giaiThich: string;
  /** Đơn vị in cạnh ô nhập: "phút", "ngày", "học viên"… Bỏ trống với bật/tắt và văn bản. */
  donVi?: string;
  /** true = đổi sai gây hậu quả rộng hoặc tốn tiền ⇒ giao diện gắn dấu nhắc. */
  canThan?: boolean;
  /**
   * Tham số chỉ nhận MỘT TRONG VÀI giá trị định trước ⇒ màn cấu hình vẽ danh sách chọn.
   *
   * ⚠️ Vì sao cần: trình sửa suy kiểu ô nhập từ GIÁ TRỊ (`kieuCuaGiaTri`), nên một tham số
   * dạng chữ ra ô chữ TRẮNG. Với `billing.siblingTarget` thì đó là mời quản lý gõ tay một
   * mã như `HOC_PHI_THAP_HON` rồi đọc một câu lỗi kỹ thuật khi gõ sai — affordance nói dối
   * (luật 12). Có danh sách thì không gõ sai được, và mỗi lựa chọn nói luôn hệ quả của nó.
   *
   * `giaTri` phải KHỚP KHÍT với `z.enum` của khoá trong registry. Lưới `[CFG-T05]` canh
   * việc đó — khai lệch một chữ là quản lý chọn xong rồi bị máy chủ từ chối.
   */
  chon?: readonly { giaTri: string; nhan: string; hauQua?: string }[];
}

const N: Readonly<Record<SettingKey, NhanVanHanh>> = {
  // ── Thông báo điện thoại ───────────────────────────────────────────────────────────────
  "push.webPushEnabled": {
    tab: "thong-bao-day",
    ten: "Bật thông báo trên điện thoại",
    giaiThich:
      "Tắt thì không ai nhận được gì ngoài chuông trong trang quản trị. Bật xong mỗi người " +
      "vẫn phải tự vào Cài đặt bấm “Bật thông báo” một lần trên máy của mình.",
    canThan: true,
  },
  "push.tienToDuocDay": {
    tab: "thong-bao-day",
    ten: "Loại thông báo được đẩy",
    giaiThich: "Chọn bằng bảng công tắc bên dưới.",
  },

  // ── Tin Zalo cho phụ huynh ─────────────────────────────────────────────────────────────
  "zalo.znsLive": {
    tab: "zalo",
    ten: "Gửi tin Zalo thật",
    giaiThich:
      "Tắt thì hệ thống vẫn ghi sổ “đã gửi” nhưng không gửi gì và không tốn tiền — dùng khi " +
      "chạy thử. Bật là tin đi tới điện thoại phụ huynh thật.",
    canThan: true,
  },
  "zalo.znsTemplateOtp": {
    tab: "zalo",
    ten: "Mẫu tin: mã xác thực",
    giaiThich:
      "Số hiệu mẫu tin đã được Zalo duyệt, nhập trong dấu nháy kép. Đặt số của mẫu chưa duyệt " +
      "là mọi tin loại này hỏng hết. Để trống thì không gửi.",
    canThan: true,
  },
  "zalo.znsTemplateAccount": {
    tab: "zalo",
    ten: "Mẫu tin: cấp tài khoản cho phụ huynh",
    giaiThich: "Cùng quy tắc với mẫu mã xác thực. Để trống thì không gửi.",
    canThan: true,
  },
  "zalo.znsAccountEnabled": {
    tab: "zalo",
    ten: "Gửi tin báo đã cấp tài khoản",
    giaiThich: "Tin báo cho phụ huynh biết tài khoản cổng phụ huynh đã sẵn sàng.",
  },
  "zalo.znsTemplateBirthday": {
    tab: "zalo",
    ten: "Mẫu tin: chúc mừng sinh nhật",
    giaiThich: "Cùng quy tắc với mẫu mã xác thực. Để trống thì không gửi.",
    canThan: true,
  },
  "student.birthdayZnsEnabled": {
    tab: "zalo",
    ten: "Gửi tin chúc mừng sinh nhật học viên",
    giaiThich:
      "Tắt chỉ ngưng tốn tiền tin nhắn — phần nhắc việc cho tư vấn, quản lý cơ sở và giáo " +
      "viên vẫn chạy như thường.",
  },
  "chat.znsNotifyEnabled": {
    tab: "zalo",
    ten: "Báo phụ huynh khi có tin nhắn mới trong nhóm lớp",
    giaiThich:
      "Chỉ nhắn khi phụ huynh đã lâu không mở tin. Các mốc thời gian nằm ngay bên dưới.",
  },
  "chat.znsTemplateNewMessage": {
    tab: "zalo",
    ten: "Mẫu tin: có tin nhắn mới",
    giaiThich: "Cùng quy tắc với mẫu mã xác thực. Để trống thì không gửi.",
    canThan: true,
  },
  "chat.znsUnreadMinutes": {
    tab: "zalo",
    ten: "Tin thường: chưa đọc bao lâu thì nhắn Zalo",
    giaiThich: "Hạ số này xuống là phụ huynh bị nhắn sớm hơn và nhiều hơn.",
    donVi: "phút",
  },
  "chat.znsAnnouncementUnreadMinutes": {
    tab: "zalo",
    ten: "Thông báo của lớp: chưa đọc bao lâu thì nhắn Zalo",
    giaiThich: "Tách riêng với tin thường để thông báo quan trọng được nhắc sớm hơn nếu cần.",
    donVi: "phút",
  },
  "chat.znsCooldownMinutes": {
    tab: "zalo",
    ten: "Mỗi phụ huynh chỉ nhận 1 tin cho mỗi nhóm lớp trong",
    giaiThich:
      "Cái chặn “bão tin nhắn”: lớp trao đổi sôi nổi cũng chỉ sinh một tin trong khoảng này. " +
      "Hạ xuống là số tin gửi đi và tiền tin nhắn tăng theo.",
    donVi: "phút",
    canThan: true,
  },
  "chat.znsMaxPerRun": {
    tab: "zalo",
    ten: "Số tin tối đa mỗi lượt gửi tự động",
    giaiThich:
      "Lưới chặn hoá đơn bất ngờ khi có sự cố. Phần vượt không mất, nó chờ lượt sau.",
    donVi: "tin",
    canThan: true,
  },

  // ── Đăng nhập & mã xác thực ────────────────────────────────────────────────────────────
  "otp.ttlMinutes": {
    tab: "dang-nhap",
    ten: "Mã xác thực dùng được trong",
    giaiThich: "Quá thời gian này người dùng phải xin mã mới.",
    donVi: "phút",
  },
  "otp.maxAttempts": {
    tab: "dang-nhap",
    ten: "Nhập sai tối đa",
    giaiThich: "Quá số lần này thì mã đó bị huỷ, phải xin mã khác.",
    donVi: "lần",
  },
  "otp.resendCooldownSec": {
    tab: "dang-nhap",
    ten: "Phải chờ bao lâu mới xin lại mã",
    giaiThich: "Đặt quá ngắn thì một người bấm nhiều lần là tốn nhiều tin.",
    donVi: "giây",
  },
  "otp.dailyLimit": {
    tab: "dang-nhap",
    ten: "Mỗi số điện thoại xin tối đa",
    giaiThich: "Chặn một số bị dùng để rút tiền tin nhắn của trung tâm.",
    donVi: "mã/ngày",
  },
  "otp.ipMaxPerHour": {
    tab: "dang-nhap",
    ten: "Mỗi máy khách xin tối đa",
    giaiThich:
      "Áp cho trang công khai, nơi người lạ cũng bấm được. Không liên quan tới nhân viên " +
      "đăng nhập trong nội bộ.",
    donVi: "mã/giờ",
  },
  "otp.globalDailyCap": {
    tab: "dang-nhap",
    ten: "Cả hệ thống gửi tối đa",
    giaiThich: "Chạm trần thì người xin mã nhận thông báo thử lại sau.",
    donVi: "mã/ngày",
  },
  "otp.globalKillSwitch": {
    tab: "dang-nhap",
    ten: "Vượt ngưỡng này thì tự ngắt gửi mã",
    giaiThich:
      "Lưới cuối cùng. Đây là con số để CHẶN sự cố, nên phải cao hơn mức trần ở trên.",
    donVi: "mã/ngày",
    canThan: true,
  },

  // ── Học viên ───────────────────────────────────────────────────────────────────────────
  "student.nearEndThreshold": {
    tab: "hoc-vien",
    ten: "Còn bao nhiêu buổi thì coi là sắp hết khoá",
    giaiThich: "Học viên tới mốc này sẽ hiện ở danh sách cần gọi tái tục.",
    donVi: "buổi",
  },
  "student.renewalWindowDays": {
    tab: "hoc-vien",
    ten: "Học xong rồi vẫn tính là còn cơ hội tái tục trong",
    giaiThich: "Quá thời gian này hệ thống ngưng nhắc tư vấn gọi lại.",
    donVi: "ngày",
  },
  "student.absenceUrgentThresholdDays": {
    tab: "hoc-vien",
    ten: "Phụ huynh báo vắng trước bao nhiêu ngày thì coi là gấp",
    giaiThich: "Báo sát ngày hơn mức này sẽ hiện màu cảnh báo để xếp lịch bù kịp.",
    donVi: "ngày",
  },
  "student.frequentAbsentThreshold": {
    tab: "hoc-vien",
    ten: "Vắng bao nhiêu buổi thì coi là hay vắng",
    giaiThich: "Học viên hay vắng sẽ hiện ở danh sách cảnh báo rủi ro để chăm sóc sớm.",
    donVi: "buổi",
  },
  "student.frequentAbsentWindow": {
    tab: "hoc-vien",
    ten: "Xét “hay vắng” trong bao nhiêu buổi gần nhất",
    giaiThich:
      "Đi cùng số ở trên. Ví dụ 3 buổi vắng trong 5 buổi gần nhất thì bị coi là hay vắng.",
    donVi: "buổi",
  },
  "student.birthdayAlertDaysBefore": {
    tab: "hoc-vien",
    ten: "Báo trước buổi tổ chức sinh nhật",
    giaiThich: "Để giáo viên và cơ sở kịp chuẩn bị quà, bánh.",
    donVi: "ngày",
  },
  "student.birthdayLookaheadDays": {
    tab: "hoc-vien",
    ten: "Quét trước danh sách sinh nhật sắp tới",
    giaiThich: "Khoảng thời gian hệ thống nhìn về phía trước để lên danh sách.",
    donVi: "ngày",
  },
  "student.birthdayLookbackDays": {
    tab: "hoc-vien",
    ten: "Buổi tổ chức được lùi sớm nhất trước ngày sinh nhật",
    giaiThich:
      "Sinh nhật ít khi rơi đúng buổi học, nên hệ thống chọn buổi gần nhất TRƯỚC ngày đó, " +
      "nhưng không sớm hơn số ngày này.",
    donVi: "ngày",
  },
  "risk.careTaskDueDays": {
    tab: "hoc-vien",
    ten: "Hạn xử lý một việc chăm sóc học viên",
    giaiThich: "Quá hạn thì việc đó chuyển sang màu quá hạn trên bảng việc.",
    donVi: "ngày",
  },
  "enrollment.suspendMaxMonths": {
    tab: "hoc-vien",
    ten: "Bảo lưu tối đa",
    giaiThich:
      "Chọn ngày quay lại xa hơn mức này (tính từ ngày bấm Bảo lưu, theo tháng lịch) sẽ bị từ chối. " +
      "Để trống ngày quay lại thì không có gì để so.",
    donVi: "tháng",
  },
  "pause.enabled": {
    tab: "hoc-vien",
    ten: "Bảo lưu học viên",
    giaiThich:
      "Bật thì hiện nút Bảo lưu và nhận hồ sơ bảo lưu theo quy chế SR.QD.236. Tắt thì nút ẩn và hệ thống từ chối mọi thao tác mới (hồ sơ đang chạy giữ nguyên). Bật riêng từng cơ sở được.",
    canThan: true,
  },
  "pause.minDays": {
    tab: "hoc-vien",
    ten: "Thời gian bảo lưu tối thiểu",
    giaiThich:
      "Hồ sơ ngắn hơn mức này bị từ chối. 0 nghĩa là không quy định tối thiểu.",
    donVi: "ngày",
  },
  "pause.extendTimes": {
    tab: "hoc-vien",
    ten: "Số lần gia hạn tối đa",
    giaiThich:
      "Một hồ sơ được gia hạn nhiều nhất bấy nhiêu lần. Vượt mức này chỉ còn đường ngoại lệ của Ban giám đốc.",
    donVi: "lần",
  },
  "pause.extendMaxMonths": {
    tab: "hoc-vien",
    ten: "Mỗi lần gia hạn tối đa",
    giaiThich:
      "Một lần gia hạn dài nhất bấy nhiêu tháng. Tổng thời gian không vượt trần bảo lưu cộng một lần gia hạn.",
    donVi: "tháng",
  },
  "pause.maxPerEnrollment": {
    tab: "hoc-vien",
    ten: "Số lần bảo lưu do phụ huynh mỗi ghi danh",
    giaiThich:
      "Hồ sơ bị từ chối hoặc rút lại không tính. Đã bắt đầu bảo lưu thì tính, kể cả khi học lại sau một ngày.",
    donVi: "lần",
  },
  "pause.backdateMaxSessions": {
    tab: "hoc-vien",
    ten: "Lùi ngày bắt đầu tối đa",
    giaiThich:
      "Quản lý được lùi ngày bắt đầu về buổi nghỉ đầu tiên, nhưng không quá số buổi học này của lớp. Các buổi trong khoảng lùi không tính vắng.",
    donVi: "buổi",
  },
  "pause.remindBeforeDays": {
    tab: "hoc-vien",
    ten: "Nhắc Sale trước hạn bảo lưu",
    giaiThich:
      "Trước ngày hết hạn bấy nhiêu ngày hệ thống tạo việc nhắc Sale liên hệ phụ huynh, và nhắc lại đúng ngày hết hạn.",
    donVi: "ngày",
  },
  "pause.escalateAfterDays": {
    tab: "hoc-vien",
    ten: "Leo thang quản lý",
    giaiThich:
      "Quá hạn bảo lưu bấy nhiêu ngày mà chưa ai ghi nhận liên hệ thì báo lên quản lý trung tâm.",
    donVi: "ngày",
  },
  "pause.noticeResponseDays": {
    tab: "hoc-vien",
    ten: "Hạn phản hồi sau thông báo chính thức",
    giaiThich:
      "Đồng hồ chỉ chạy SAU khi đã ghi gửi thông báo chính thức. Hết hạn mà phụ huynh chưa phản hồi thì chấm dứt quyền lợi bảo lưu.",
    donVi: "ngày",
  },
  "pause.maxOverdueDebtDays": {
    tab: "hoc-vien",
    ten: "Chặn duyệt khi còn nợ quá hạn",
    giaiThich:
      "Ghi danh có khoản đến hạn mà quá hạn lâu hơn mức này thì chưa duyệt bảo lưu được. Kiểm lại ngay lúc duyệt, không chỉ lúc lập hồ sơ.",
    donVi: "ngày",
  },
  "pause.medicalProofDays": {
    tab: "hoc-vien",
    ten: "Ốm đau cần minh chứng",
    giaiThich:
      "Bảo lưu vì ốm đau dự kiến dài hơn mức này thì bắt buộc đính kèm minh chứng.",
    donVi: "ngày",
  },
  "pause.resumeLessonTolerance": {
    tab: "hoc-vien",
    ten: "Độ lệch buổi khi phục học",
    giaiThich:
      "Chỉ gợi ý lớp mà buổi hiện tại lệch buổi đã dừng không quá mức này. Lớp đã đủ sĩ số vẫn nhận.",
    donVi: "buổi",
  },
  "pause.effectiveDate": {
    tab: "hoc-vien",
    ten: "Ngày hiệu lực quy chế bảo lưu",
    giaiThich:
      "Dạng YYYY-MM-DD. Hạn của các ca bảo lưu thoả thuận trước quy chế được tính từ ngày này cộng trần bảo lưu. Để trống nghĩa là chưa khai.",
  },
  "makeup.crossCenterEnabled": {
    tab: "hoc-vien",
    ten: "Cho học bù ở cơ sở khác",
    giaiThich:
      "Tắt thì học viên chỉ được xếp bù trong chính cơ sở của mình. Bật giúp linh hoạt cho " +
      "phụ huynh nhưng giáo viên sẽ gặp học viên lạ trong lớp.",
  },

  // ── Lớp & giáo viên ────────────────────────────────────────────────────────────────────
  "class.minStudents.default": {
    tab: "lop-gv",
    ten: "Sĩ số tối thiểu khi mở lớp",
    giaiThich: "Giá trị gợi ý sẵn khi tạo lớp mới; từng lớp vẫn sửa riêng được.",
    donVi: "học viên",
  },
  "class.maxStudents.default": {
    tab: "lop-gv",
    ten: "Sĩ số tối đa khi mở lớp",
    giaiThich: "Giá trị gợi ý sẵn khi tạo lớp mới; từng lớp vẫn sửa riêng được.",
    donVi: "học viên",
  },
  "teacher.overloadHoursPerWeek": {
    tab: "lop-gv",
    ten: "Dạy quá bao nhiêu giờ một tuần thì báo quá tải",
    giaiThich: "Chỉ để cảnh báo khi phân công, không chặn.",
    donVi: "giờ/tuần",
  },
  "homework.showScoreToParent": {
    tab: "lop-gv",
    ten: "Cho phụ huynh xem điểm bài tập và bài kiểm tra",
    giaiThich:
      "Tắt thì phụ huynh vẫn thấy con đã nộp bài hay chưa, chỉ không thấy điểm số.",
  },
  "trial.locGvTheoCaLamViec": {
    tab: "lop-gv",
    ten: "Chỉ hiện giáo viên có ca làm trùm hết buổi học thử",
    giaiThich:
      "Bật thì khi xếp một buổi học thử, ô chọn giáo viên chỉ còn những người mà ca làm hôm " +
      "đó trùm hết khung giờ của buổi — ai vào muộn hơn hoặc về sớm hơn đều không hiện. Tắt " +
      "thì hiện mọi giáo viên như trước. Đổi xong có thể chờ tới 5 phút mới ăn ở mọi máy.",
    canThan: true,
  },
  // ── Khung giờ mở lớp trải nghiệm, theo thứ (chủ dự án 22/09/2026) ─────────────────────
  //
  // Bảy ô, mỗi thứ một ô. Viết nhãn bằng vòng lặp thì ngắn hơn, nhưng ở TỆP NHÃN thì
  // ngược lại là đúng: đây là chỗ người vận hành đọc, và một nhãn sinh tự động không bao
  // giờ nói được "thứ 2 trung tâm nghỉ" — thứ duy nhất họ cần biết khi thấy ô trống.
  "trial.khungGio.t2": {
    tab: "lop-gv",
    ten: "Khung giờ mở lớp trải nghiệm — Thứ 2",
    giaiThich:
      'Gõ dạng "17:30-21:00". Nhiều khung trong ngày thì ngăn bằng dấu phẩy: ' +
      '"08:00-11:30, 14:00-17:30". Để TRỐNG nghĩa là thứ 2 không mở lớp trải nghiệm — ' +
      "mặc định đang để trống. Quản lý chỉ mở được lớp nằm gọn trong một khung ở đây.",
  },
  "trial.khungGio.t3": {
    tab: "lop-gv",
    ten: "Khung giờ mở lớp trải nghiệm — Thứ 3",
    giaiThich:
      'Mặc định "17:30-21:00" theo giờ giáo viên đi làm buổi tối. Để trống là thứ 3 không ' +
      "mở lớp trải nghiệm.",
  },
  "trial.khungGio.t4": {
    tab: "lop-gv",
    ten: "Khung giờ mở lớp trải nghiệm — Thứ 4",
    giaiThich: 'Mặc định "17:30-21:00". Để trống là thứ 4 không mở lớp trải nghiệm.',
  },
  "trial.khungGio.t5": {
    tab: "lop-gv",
    ten: "Khung giờ mở lớp trải nghiệm — Thứ 5",
    giaiThich: 'Mặc định "17:30-21:00". Để trống là thứ 5 không mở lớp trải nghiệm.',
  },
  "trial.khungGio.t6": {
    tab: "lop-gv",
    ten: "Khung giờ mở lớp trải nghiệm — Thứ 6",
    giaiThich: 'Mặc định "17:30-21:00". Để trống là thứ 6 không mở lớp trải nghiệm.',
  },
  "trial.khungGio.t7": {
    tab: "lop-gv",
    ten: "Khung giờ mở lớp trải nghiệm — Thứ 7",
    giaiThich:
      'Mặc định "08:00-11:30, 14:00-17:30" — sáng và chiều, nghỉ trưa ở giữa. Lớp mở vắt ' +
      "qua giờ nghỉ trưa sẽ bị từ chối, phải mở hai lớp riêng.",
  },
  "trial.khungGio.cn": {
    tab: "lop-gv",
    ten: "Khung giờ mở lớp trải nghiệm — Chủ nhật",
    giaiThich:
      'Mặc định "08:00-11:30, 14:00-17:30" — sáng và chiều, nghỉ trưa ở giữa. Lớp mở vắt ' +
      "qua giờ nghỉ trưa sẽ bị từ chối, phải mở hai lớp riêng.",
  },
  "trial.gvMienLocTheoCa": {
    tab: "lop-gv",
    ten: "Giáo viên luôn hiện dù hôm đó không có ca",
    giaiThich:
      "Ngoại lệ cho mục ngay bên trên: những người này luôn chọn được, kể cả ngày họ không " +
      "đăng ký ca nào. Chọn bằng bảng tên ở cuối tab này. Đổi xong có thể chờ tới 5 phút mới " +
      "ăn ở mọi máy.",
  },
  "lms.mediaSignedUrlTtl": {
    tab: "lop-gv",
    ten: "Đường xem ảnh/video của lớp còn mở trong",
    giaiThich:
      "Hết hạn thì phụ huynh tải lại trang là xem tiếp được. Để dài là đường link bị chuyển " +
      "ra ngoài vẫn mở được lâu.",
    donVi: "giây",
  },

  // ── Chấm công & ca làm ─────────────────────────────────────────────────────────────────
  "shift.toleranceMinutes": {
    tab: "cham-cong",
    ten: "Chấm công lệch trong khoảng này vẫn tính đúng giờ",
    giaiThich:
      "Áp cho cả quét sớm lẫn quét muộn. Đây là dung sai kỹ thuật cho việc đồng hồ máy quét " +
      "và giờ ca lệch nhau chút ít, không phải mức cho phép đi muộn.",
    donVi: "phút",
  },
  "shift.otLamTronPhut": {
    tab: "cham-cong",
    ten: "Làm tròn phút tăng ca được trả",
    giaiThich: "Phút OT được trả làm tròn xuống bội số này (vd 15 ⇒ 2h25 thành 2h15). Để 0 là trả đúng phút làm thật trong khung đã duyệt.",
    donVi: "phút",
  },
  "shift.congTacCheDo": {
    tab: "cham-cong",
    ten: "Ngày đi công tác tính công thế nào",
    giaiThich: "DU_CONG: đơn công tác đã duyệt thì ngày đó đủ công theo ca, không cần quét. CO_CHAM_CONG: vẫn phải chấm công (ở đâu cũng được), thiếu lượt thì báo như ngày thường.",
  },
  "shift.chamNgoaiDungSaiPhut": {
    tab: "cham-cong",
    ten: "Dung sai khung giờ làm từ xa / chấm ngoài địa điểm",
    giaiThich: "Đơn duyệt 14:00–16:00 thì được chấm ngoài văn phòng từ 13:30 tới 16:30 (với 30 phút). Ngoài khung đó áp lại luật vị trí bình thường.",
    donVi: "phút",
  },
  "shift.otQuyDoi": {
    tab: "cham-cong",
    ten: "Tăng ca quy đổi thành gì",
    giaiThich: "TRA_TIEN: OT được trả tiền, không sinh nghỉ bù (mặc định). NGHI_BU: phút OT được trả cộng vào quỹ nghỉ bù của người đó thay cho tiền.",
  },
  "shift.lamNgayNghiQuyDoi": {
    tab: "cham-cong",
    ten: "Làm ngày nghỉ / ngày lễ quy đổi thành gì",
    giaiThich: "TRA_TIEN: phút làm ngày nghỉ / lễ theo đơn được trả tiền, không sinh nghỉ bù (mặc định). NGHI_BU: phút đó cộng vào quỹ nghỉ bù. Áp cho đơn duyệt SAU khi đổi — đơn đã duyệt giữ cách tính lúc duyệt.",
  },
  "shift.nghiBuTyLe": {
    tab: "cham-cong",
    ten: "Tỉ lệ quy đổi sang nghỉ bù",
    giaiThich: "1 = mỗi phút làm thêm đổi một phút nghỉ bù; 1,5 = mỗi phút đổi 1,5 phút. Chỉ dùng khi đã chọn quy đổi sang nghỉ bù.",
    donVi: "lần",
  },
  "shift.lateGraceMinutes": {
    tab: "cham-cong",
    ten: "Muộn quá bao nhiêu phút thì gắn dấu đi muộn",
    giaiThich: "Chỉ là dấu hiệu để quản lý nhìn thấy, chưa trừ gì.",
    donVi: "phút",
  },
  "shift.latePenaltyGraceMinutes": {
    tab: "cham-cong",
    ten: "Muộn quá bao nhiêu phút thì tính là một lần trễ",
    giaiThich: "Đây mới là con số dùng để trừ điểm nội quy.",
    donVi: "phút",
    canThan: true,
  },
  "shift.penaltyLatePercent": {
    tab: "cham-cong",
    ten: "Mỗi lần trễ trừ",
    giaiThich: "Trừ vào phần điểm nội quy của tháng.",
    donVi: "% nội quy",
    canThan: true,
  },
  "shift.penaltyAbsentPercent": {
    tab: "cham-cong",
    ten: "Mỗi ngày nghỉ không phép trừ",
    giaiThich: "Chỉ tính cho ngày nghỉ mà quản lý đã xác nhận là không phép.",
    donVi: "% nội quy",
    canThan: true,
  },
  "shift.earlyArrivalMinutes": {
    tab: "cham-cong",
    ten: "Nhắc có mặt trước giờ vào ca",
    giaiThich: "Chỉ để nhắc trong tin nhắc lịch, không trừ gì.",
    donVi: "phút",
  },
  "shift.emergencyMonthlyLimit": {
    tab: "cham-cong",
    ten: "Số lần đăng ký ca khẩn mỗi tháng",
    giaiThich: "Hết lượt thì phải nhờ quản lý xếp tay.",
    donVi: "lần",
  },
  "shift.proposalWindow": {
    tab: "cham-cong",
    ten: "Khoảng ngày được đăng ký ca cho tháng sau",
    giaiThich:
      "Ví dụ từ ngày 25 đến ngày 28 hằng tháng. Ngoài khoảng này nhân viên không tự đăng ký " +
      "được nữa.",
  },
  "shift.geofenceRadiusMeters": {
    tab: "cham-cong",
    ten: "Phải đứng cách điểm quét tối đa",
    giaiThich: "Quét xa hơn khoảng này bị từ chối. Nới rộng là chấm công hộ nhau dễ hơn.",
    donVi: "mét",
    canThan: true,
  },
  "shift.managerEditWindowDays": {
    tab: "cham-cong",
    ten: "Quản lý được sửa bảng công trong vòng",
    giaiThich: "Quá hạn thì phải nhờ cấp cao hơn. Tính từ ngày công cần sửa.",
    donVi: "ngày",
  },
  "shift.weeklyOffDays": {
    tab: "cham-cong",
    ten: "Ngày nghỉ cố định hằng tuần",
    giaiThich:
      "Viết bằng số trong dấu ngoặc vuông: 0 là Chủ nhật, 1 là thứ Hai, … 6 là thứ Bảy. " +
      "Ví dụ [1] nghĩa là nghỉ thứ Hai.",
  },
  "shift.maxLogsPerDay": {
    tab: "cham-cong",
    ten: "Mỗi người quét tối đa",
    giaiThich: "Vượt thì vẫn ghi nhận nhưng được đánh dấu để quản lý kiểm lại.",
    donVi: "lượt/ngày",
  },
  "shift.pairingMaxGapMinutes": {
    tab: "cham-cong",
    ten: "Ghép lượt vào với lượt ra trong khoảng",
    giaiThich:
      "Hệ thống dùng con số này để đoán một lượt quét thuộc ca nào. Đặt quá rộng thì hai ca " +
      "sát nhau dễ bị ghép nhầm.",
    donVi: "phút quanh giờ ca",
  },
  "shift.duplicateTapMinutes": {
    tab: "cham-cong",
    ten: "Hai lượt quét cách nhau dưới mức này coi là bấm nhầm",
    giaiThich: "Lượt thứ hai không được tính, tránh một người quét hai lần thành vào rồi ra.",
    donVi: "phút",
  },
  "shift.briefNoteHourVN": {
    tab: "cham-cong",
    ten: "Giờ gửi tin nhắc lịch ngày mai",
    giaiThich: "Theo giờ Việt Nam, viết bằng số từ 0 đến 23. Ví dụ 19 là 7 giờ tối.",
    donVi: "giờ",
  },
  "shift.requestNoticeDays": {
    tab: "cham-cong",
    ten: "Báo nghỉ hoặc đổi ca trước ít nhất",
    giaiThich: "Nộp sát hơn vẫn nộp được nhưng đơn bị đánh dấu nộp muộn.",
    donVi: "ngày",
  },
  "shift.leaveAccrualPerMonth": {
    tab: "cham-cong",
    ten: "Mỗi tháng cộng thêm phép năm",
    giaiThich: "Áp cho nhân sự chính thức.",
    donVi: "ngày",
  },
  "shift.leaveDaysPerYear": {
    tab: "cham-cong",
    ten: "Phép năm tối đa",
    giaiThich: "Trần của cả năm, cộng dồn không vượt quá số này.",
    donVi: "ngày/năm",
  },

  // ── Khách hàng & tư vấn ────────────────────────────────────────────────────────────────
  "crm.dedupWindowDays": {
    tab: "khach-hang",
    ten: "Hai phiếu cùng số điện thoại trong bao lâu thì coi là một khách",
    giaiThich:
      "Ngăn một khách điền form nhiều lần biến thành nhiều đầu việc. Đặt quá ngắn thì tư vấn " +
      "nhận trùng; quá dài thì khách quay lại sau vài tháng bị gộp vào hồ sơ cũ.",
    donVi: "ngày",
  },
  "export.vaiTheoMan": {
    tab: "quyen-xuat",
    ten: "Vai được xuất dữ liệu theo từng màn",
    giaiThich:
      "Ma trận bên dưới là nơi sửa — dòng này không hiện thành ô nhập vì nó là một bảng, " +
      "không phải một giá trị. Bỏ hết ô tích của một màn nghĩa là chỉ quản trị tối cao tải " +
      "được màn đó.",
    canThan: true,
  },
  "crm.commissionPolicies": {
    tab: "hoa-hong",
    ten: "Chính sách hoa hồng",
    giaiThich:
      "Toàn bộ khoản chi hoa hồng, khai theo bốn trục: ai nhận · khi nào · loại đơn nào · " +
      "tính thế nào. Bảng bên dưới là nơi sửa — dòng này không hiện thành ô nhập vì nó là " +
      "một danh sách, không phải một con số.",
    canThan: true,
  },
  "crm.commissionMaxTotalRate": {
    tab: "khach-hang",
    ten: "Trần tổng hoa hồng",
    giaiThich:
      "Viết dạng thập phân: 0.09 nghĩa là 9%. Đã gồm cả phần của giáo viên dạy buổi trải " +
      "nghiệm. Hạ trần KHÔNG xoá những dòng hoa hồng đã sinh trước đó.",
    // Không phải "%" — ô này nhận 0.09 chứ không nhận 9. Ghi đơn vị là "%" ở đây đúng là cách
    // mời người ta gõ 9 và nhân mười lần tiền hoa hồng lên.
    donVi: "phần đơn vị (0.09 = 9%)",
    canThan: true,
  },
  "crm.trialMaxSessions": {
    tab: "khach-hang",
    ten: "Mỗi khách được học thử tối đa",
    giaiThich: "Quá số buổi này thì ca trải nghiệm chuyển sang chờ quyết định.",
    donVi: "buổi",
  },
  "crm.sla.respondMinutes": {
    tab: "khach-hang",
    ten: "Chưa trả lời tin nhắn của khách quá",
    giaiThich: "Quá mốc này thì hiện cảnh báo chậm xử lý cho tư vấn và quản lý.",
    donVi: "phút",
  },
  "crm.sla.handoverMinutes": {
    tab: "khach-hang",
    ten: "Chưa bàn giao khách cho tư vấn quá",
    giaiThich: "Tính từ lúc khách được xác nhận là có nhu cầu thật.",
    donVi: "phút",
  },
  "crm.sla.assignMinutes": {
    tab: "khach-hang",
    ten: "Chưa phân công tư vấn viên quá",
    giaiThich: "Tính từ lúc phiếu khách hàng về hệ thống.",
    donVi: "phút",
  },
  "crm.sla.contactMinutes": {
    tab: "khach-hang",
    ten: "Phân công rồi mà chưa liên hệ khách quá",
    giaiThich: "Đây là mốc hay bị vi phạm nhất; hạ xuống là số cảnh báo tăng mạnh.",
    donVi: "phút",
  },
  "crm.sla.silentMinutes": {
    tab: "khach-hang",
    ten: "Khách im lặng chưa ai xử lý quá",
    giaiThich: "Dành cho khách đã liên hệ được nhưng sau đó không ai động vào nữa.",
    donVi: "phút",
  },
  "sla.leadIdleHours": {
    tab: "khach-hang",
    ten: "Khách mới hoặc vừa phân công mà không có hoạt động quá",
    giaiThich: "Quá mốc này thì hiện ở danh sách khách bị bỏ quên.",
    donVi: "giờ",
  },
  "intake.saleFormRateLimitMax": {
    tab: "khach-hang",
    ten: "Một máy nhập tối đa",
    giaiThich:
      "Áp cho màn Nhập khách hàng. Đặt quá thấp thì nhân viên nhập liệu nhanh sẽ bị chặn oan.",
    donVi: "phiếu/phút",
  },
  "intake.alertFailedPerHour": {
    tab: "khach-hang",
    ten: "Một nguồn khách lỗi bao nhiêu phiếu trong 1 giờ thì báo động",
    giaiThich: "Nguồn khách hỏng nghĩa là tiền quảng cáo đang chảy mà phiếu không về.",
    donVi: "phiếu",
  },
  "intake.alertSilentHours": {
    tab: "khach-hang",
    ten: "Nguồn khách vốn chạy đều mà im quá",
    giaiThich: "Im lặng bất thường thường là dấu hiệu kết nối với nguồn đã đứt.",
    donVi: "giờ",
  },
  "public.leadRateLimitMax": {
    tab: "khach-hang",
    ten: "Form đăng ký trên website nhận tối đa",
    giaiThich: "Tính theo từng máy khách, chặn người gửi phá.",
    donVi: "lượt",
  },
  "public.leadRateLimitWindowMs": {
    tab: "khach-hang",
    ten: "…trong khoảng thời gian",
    giaiThich: "Đi cùng con số ngay trên. Viết bằng phần nghìn giây: 60000 là 1 phút.",
    donVi: "phần nghìn giây",
  },

  // ── Tiền & thanh toán ──────────────────────────────────────────────────────────────────
  "orders.maxInstallments": {
    tab: "tien",
    ten: "Số đợt tối đa mỗi con",
    giaiThich:
      "Chia quá số này thì đơn VẪN LƯU ĐƯỢC nhưng vào hàng chờ Quản lý cơ sở duyệt, và " +
      "KHÔNG xuất được mã QR cho tới khi có người duyệt. Phiếu CỌC không tính vào đây — " +
      "cọc + 4 đợt là hợp lệ khi để số này là 4. Đếm theo TỪNG CON: đơn hai con, mỗi con " +
      "4 đợt thì vẫn trong hạn mức.",
    donVi: "đợt",
  },
  "orders.maxDiscountItems": {
    tab: "tien",
    ten: "Số ưu đãi tối đa trên một dòng đơn",
    giaiThich:
      "Đếm số KHOẢN ưu đãi chồng lên MỘT dòng (một con), không phải tổng mức bớt — muốn " +
      "siết số tiền thì dùng ô ngay dưới. Chồng quá số này thì đơn vào hàng chờ duyệt và " +
      "chưa xuất được mã QR. Đơn hai con, mỗi con một ưu đãi khác nhau, vẫn hợp lệ khi để " +
      "số này là 1.",
    donVi: "ưu đãi",
  },
  "orders.maxDiscountPercent": {
    tab: "tien",
    ten: "Giảm giá theo % tối đa cho một ưu đãi",
    giaiThich:
      "Áp cho TỪNG ưu đãi trên một dòng đơn, tính trên tạm tính của chính dòng đó. " +
      "Một dòng có thể chồng nhiều ưu đãi và các mức % CỘNG DỒN, nên hạ số này không " +
      "chặn được tổng mức bớt — nó chỉ chặn một ưu đãi đơn lẻ quá lớn. Sale gõ vượt " +
      "trần thì đơn không lưu được, kèm thông báo chỉ rõ dòng nào khoản nào.",
    donVi: "%",
  },
  "finance.debtReminderDaysBefore": {
    tab: "tien",
    ten: "Nhắc đóng đợt 2 trước hạn",
    giaiThich: "Hệ thống tự nhắc kế toán và tư vấn trước ngày đến hạn từng này ngày.",
    donVi: "ngày",
  },
  "payment.roundingToleranceVnd": {
    tab: "tien",
    ten: "Lệch tối đa bao nhiêu vẫn coi là khớp tiền",
    giaiThich:
      "Dùng khi đối chiếu tiền chuyển khoản về với số phải thu. Nới rộng là những khoản " +
      "thiếu nhỏ sẽ được tự đánh dấu đã thu đủ.",
    donVi: "đồng",
    canThan: true,
  },
  "payment.qrTtlMinutes": {
    tab: "tien",
    ten: "Mã QR chuyển khoản còn dùng được trong",
    giaiThich: "Hết hạn thì phụ huynh mở lại trang để lấy mã mới.",
    donVi: "phút",
  },

  // ── Nhắc tự động ───────────────────────────────────────────────────────────────────────
  "cron.renewalReminderMinDays": {
    tab: "nhac-tu-dong",
    ten: "Nhắc tái tục — bắt đầu từ",
    giaiThich: "Tính ngược từ ngày học viên hết khoá.",
    donVi: "ngày trước khi hết khoá",
  },
  "cron.renewalReminderMaxDays": {
    tab: "nhac-tu-dong",
    ten: "Nhắc tái tục — sớm nhất là",
    giaiThich: "Phải lớn hơn số ở trên, nếu không sẽ không nhắc được ai.",
    donVi: "ngày trước khi hết khoá",
  },
  "cron.renewalReminderIdempotencyDays": {
    tab: "nhac-tu-dong",
    ten: "Không nhắc lại cùng một người trong",
    giaiThich: "Tránh một phụ huynh nhận nhắc tái tục nhiều lần trong cùng đợt.",
    donVi: "ngày",
  },
  "cron.classReminderMinHours": {
    tab: "nhac-tu-dong",
    ten: "Nhắc buổi học — bắt đầu từ",
    giaiThich: "Tính ngược từ giờ vào học.",
    donVi: "giờ trước buổi",
  },
  "cron.classReminderMaxHours": {
    tab: "nhac-tu-dong",
    ten: "Nhắc buổi học — sớm nhất là",
    giaiThich:
      "Phải lớn hơn số ở trên, nếu không sẽ không còn khoảng nào để nhắc và phụ huynh không " +
      "nhận được tin nào cả.",
    donVi: "giờ trước buổi",
  },
  "dashboard.pendingItemLimit": {
    tab: "nhac-tu-dong",
    ten: "Mỗi nhóm việc cần xử lý hiện tối đa",
    giaiThich: "Chỉ đổi cách hiển thị trên trang chủ quản trị, không đổi số việc thật.",
    donVi: "dòng",
  },
  "dashboard.pendingStaleDays": {
    tab: "nhac-tu-dong",
    ten: "Việc tồn quá bao nhiêu ngày thì coi là quá hạn",
    giaiThich: "Việc quá hạn được đẩy lên đầu và đổi màu.",
    donVi: "ngày",
  },

  // ── Thông tin công ty ──────────────────────────────────────────────────────────────────
  "contact.hotlines": {
    tab: "cong-ty",
    ten: "Số điện thoại hiện trên website",
    giaiThich:
      "Một số duy nhất cho cả công ty (không còn khai theo từng cơ sở). Sai một chữ số là " +
      "khách gọi vào số lạ — kiểm lại trước khi lưu. Lưu ý: ô này CHƯA được nối vào " +
      "website; số đang hiện lấy từ mã nguồn.",
    canThan: true,
  },
  "contact.emails": {
    tab: "cong-ty",
    ten: "Email hiện trên website",
    giaiThich: "Một địa chỉ cho khách liên hệ, một địa chỉ cho ứng viên tuyển dụng.",
  },
  "content.internalAwards": {
    tab: "cong-ty",
    ten: "Danh sách giải thưởng hiện trên trang khoá học",
    giaiThich: "Đổi ở đây là trang công khai đổi theo ngay, không cần bên kỹ thuật.",
  },
  "content.gifts": {
    tab: "cong-ty",
    ten: "Bộ quà tặng hiện khi đăng ký",
    giaiThich: "Tổng giá trị quà in trên trang được tính từ danh sách này.",
  },
  "content.commitments": {
    tab: "cong-ty",
    ten: "Cam kết với phụ huynh hiện trên website",
    giaiThich: "Đây là nội dung mang tính cam kết — đổi nên có người duyệt.",
    canThan: true,
  },

  // ── Nâng cao ───────────────────────────────────────────────────────────────────────────
  "storage.presignTtlSec": {
    tab: "nang-cao",
    ten: "Thời gian cho phép tải tệp lên",
    giaiThich:
      "Tính từ lúc bấm chọn tệp. Mạng chậm mà đặt ngắn quá thì tải ảnh lớn hay bị hỏng giữa " +
      "chừng.",
    donVi: "giây",
  },
  "billing.flexV1Enabled": {
    tab: "tien",
    ten: "Thu học phí linh hoạt (công nợ theo từng con)",
    giaiThich:
      "Bật thì mỗi con trên một đơn có công nợ riêng, và cả nhà quét MỘT mã QR in sẵn số tiền. " +
      "Phụ huynh chuyển ĐÚNG số thì hệ thống tự chia cho từng con; chuyển thừa hoặc thiếu thì " +
      "tiền không được ghi nhận và kế toán hoàn lại. Có thể bật riêng cho từng cơ sở.",
    canThan: true,
  },
  "billing.hoaDonEnabled": {
    tab: "tien",
    ten: "Màn Hoá đơn điện tử cho kế toán",
    giaiThich:
      "Bật thì kế toán thấy màn Hoá đơn điện tử: tải phiếu thu, tải tệp hoá đơn đã xuất ở MISA " +
      "lên, bấm xác nhận để hệ thống gửi hoá đơn cho khách qua email. Sale tải được hoá đơn ở " +
      "trang đơn. Tắt thì màn ẩn đi, nhưng những khoản đã có hoá đơn vẫn bị khoá (không từ chối, " +
      "không tách được) — tắt KHÔNG xoá hoá đơn nào.",
    canThan: true,
  },
  "hoaDon.misaPhatHanh": {
    tab: "tien",
    ten: "Phát hành hoá đơn qua MISA (tự động)",
    giaiThich:
      "Bật thì trên màn Hoá đơn điện tử có thêm nút \"Phát hành qua MISA\": hệ thống gửi hoá đơn sang MISA " +
      "meInvoice, ký số bằng HSM và tự lưu số, ký hiệu, tệp PDF/XML — kế toán không phải gõ lại ở MISA. " +
      "Hoá đơn phát hành là chứng từ thuế THẬT, không xoá được. Chỉ có tác dụng khi màn Hoá đơn điện tử " +
      "đang bật và đã cài kết nối MISA. Tắt thì nút ẩn; kế toán vẫn làm tay ở MISA rồi tải tệp lên như cũ.",
    canThan: true,
  },

  // ── Ưu đãi anh chị em: quản lý tự cài [F3 · 22/09/2026] ────────────────────────────
  "billing.siblingAutoEnabled": {
    tab: "tien",
    ten: "Tự tính ưu đãi anh chị em học cùng",
    giaiThich:
      "Bật thì khi một nhà có từ hai con học, hệ thống tự trừ học phí cho con thứ hai trở " +
      "đi theo các mức bên dưới. Tắt thì người bán vẫn gõ tay từng khoản giảm như trước — " +
      "tắt KHÔNG xoá những khoản đã giảm cho các đơn cũ.",
    canThan: true,
  },
  "billing.siblingPercentSecond": {
    tab: "tien",
    ten: "Mức giảm cho con thứ hai",
    giaiThich:
      "Trừ bao nhiêu phần trăm học phí của con được xếp là con thứ hai trong nhà. Đặt 0 là " +
      "con thứ hai không được giảm gì.",
    donVi: "%",
    canThan: true,
  },
  "billing.siblingPercentThird": {
    tab: "tien",
    ten: "Mức giảm cho con thứ ba trở lên",
    giaiThich:
      "Trừ bao nhiêu phần trăm học phí của con thứ ba và các con sau nữa. Nhà có hai con thì " +
      "mức này không dùng tới.",
    donVi: "%",
    canThan: true,
  },
  "billing.siblingTarget": {
    tab: "tien",
    ten: "Ưu đãi anh chị em áp cho con nào",
    giaiThich:
      "Trong một nhà, ai được xếp là con thứ hai. Đổi mục này là đổi xem NHÀ NÀO được giảm " +
      "bao nhiêu, nên hãy xem lại vài đơn đang chạy sau khi đổi.",
    canThan: true,
    chon: [
      {
        giaTri: "HOC_PHI_THAP_HON",
        nhan: "Con có học phí thấp hơn",
        hauQua:
          "Nhà giảm ít tiền hơn. Thêm một con học khoá đắt hơn thì ưu đãi CHUYỂN sang con " +
          "đang học, tức con cũ bỗng được giảm thêm.",
      },
      {
        giaTri: "GHI_DANH_SAU",
        nhan: "Con đăng ký sau",
        hauQua:
          "Con vào sau luôn là con được giảm; các con đang học không bao giờ bị tính lại. " +
          "Nhà giảm nhiều tiền hơn khi con vào sau học khoá đắt.",
      },
    ],
  },
  "billing.siblingStacksFullPay": {
    tab: "tien",
    ten: "Cho cộng dồn với ưu đãi đóng trọn khoá",
    giaiThich:
      "Bật thì một con vừa được giảm vì có anh chị em, vừa được giảm vì đóng trọn khoá. Tắt " +
      "thì con đã có ưu đãi đóng trọn khoá sẽ không nhận thêm ưu đãi anh chị em.",
    canThan: true,
  },
  "billing.lateDiscountAbsorb": {
    tab: "tien",
    ten: "Giảm giá phát sinh muộn thì trừ vào đợt thu nào",
    giaiThich:
      "Khi thêm một con làm con đang học được giảm thêm, phần giảm đó phải trừ vào các đợt " +
      "chưa thu. Đợt nào ĐÃ nhận tiền thì không bao giờ bị sửa. Lưu ý đợt gần nhất thường " +
      "đã phát mã QR và đã nhắn cho phụ huynh — sửa số của nó là phải nói lại với họ.",
    canThan: true,
    chon: [
      {
        giaTri: "DOT_XA_NHAT",
        nhan: "Đợt có hạn muộn nhất, trừ dần về trước",
        hauQua:
          "Đợt gần nhất giữ nguyên số phụ huynh đã nhận, nên không phải giải thích lại. " +
          "Phụ huynh hưởng ưu đãi ở lần đóng sau.",
      },
      {
        giaTri: "CHIA_DEU",
        nhan: "Chia đều theo tỷ lệ các đợt chưa thu",
        hauQua:
          "Mọi đợt chưa thu đều giảm một phần. Đổi lại, đợt gần nhất cũng đổi số nên phải " +
          "nhắn lại cho phụ huynh.",
      },
      {
        giaTri: "DOT_GAN_NHAT",
        nhan: "Đợt có hạn sớm nhất, trừ dần về sau",
        hauQua:
          "Phụ huynh hưởng ngay lần đóng tới. Đổi lại, đúng cái đợt vừa phát mã QR bị sửa " +
          "số, nên chắc chắn phải nhắn lại.",
      },
    ],
  },

  "orgScope.cutoverEnabled": {
    tab: "nang-cao",
    ten: "Chuyển cách phân chia dữ liệu sang sơ đồ tổ chức mới",
    giaiThich:
      "Ảnh hưởng tới việc AI NHÌN THẤY DỮ LIỆU CỦA CƠ SỞ NÀO. Chỉ bật khi bên kỹ thuật xác " +
      "nhận đã đối soát xong, và bật ngoài giờ làm việc.",
    canThan: true,
  },

  // ── Tham số của các trục CHỈ CÓ trên nhánh `test`, bổ sung khi hợp nhất 16/09/2026 ──
  // Hộp thư đa kênh · ngân sách gửi ra · ZaloCRM · ngưỡng lead treo. (Trục gọi điện OmiCall
  // đã gỡ 06/10/2026.)
  // Thiếu một dòng ở đây thì tham số rơi khỏi giao diện mà KHÔNG báo lỗi — luật 1 đầu file.

  // ── Lead treo ──
  "crm.staleLeadWarnDays": {
    donVi: "ngày",
    tab: "khach-hang",
    ten: "Bao nhiêu ngày không liên hệ thì cảnh báo vàng",
    giaiThich:
      "Phiếu chưa được gọi/nhắn quá số ngày này hiện dấu vàng trong danh sách. Đặt quá ngắn thì " +
      "gần như phiếu nào cũng vàng và người dùng thôi nhìn cảnh báo.",
  },
  "crm.staleLeadDangerDays": {
    donVi: "ngày",
    tab: "khach-hang",
    ten: "Bao nhiêu ngày không liên hệ thì cảnh báo đỏ",
    giaiThich:
      "Như trên nhưng mức nặng hơn. Phải lớn hơn mốc vàng, không thì không còn hai mức để phân biệt.",
  },

  // ── Hộp thư đa kênh ──
  "inbox.messengerLive": {
    tab: "khach-hang",
    ten: "Trả lời Messenger thật",
    giaiThich:
      "Tắt thì tin soạn trong hộp thư chỉ lưu lại, khách KHÔNG nhận được gì. Bật là tin tới " +
      "Messenger của khách thật.",
    canThan: true,
  },
  "inbox.zaloOaLive": {
    tab: "khach-hang",
    ten: "Trả lời Zalo OA thật",
    giaiThich:
      "Tắt thì tin chỉ lưu sổ, khách không nhận. Bật là tin đi ra qua tài khoản Zalo OA của công ty.",
    canThan: true,
  },
  "inbox.zaloCaNhanLive": {
    tab: "khach-hang",
    ten: "Trả lời Zalo cá nhân (ZaloCRM) thật",
    giaiThich:
      "Tắt thì tin chỉ lưu sổ. Bật là tin gửi đi từ chính nick Zalo cá nhân của cơ sở — khách " +
      "thấy tin đến từ số nhân viên, không phải từ trang công ty.",
    canThan: true,
  },
  "messenger.sendLive": {
    tab: "khach-hang",
    ten: "Gửi Messenger thật ra khách",
    giaiThich:
      "Công tắc chung cho mọi đường gửi Messenger. Tắt là mô phỏng: có sổ, không có tin.",
    canThan: true,
  },

  // ── Duyệt ảnh/video buổi học ──
  "media.reviewDeadlineOffsetDays": {
    donVi: "ngày",
    tab: "lop-gv",
    ten: "Hạn duyệt ảnh sau buổi dạy (ngày)",
    giaiThich:
      "Đếm từ ngày dạy. Đặt 0 là phải duyệt ngay trong ngày; đặt dài thì ảnh nằm chờ lâu và " +
      "phụ huynh thấy muộn.",
  },
  "media.reviewDeadlineHour": {
    donVi: "giờ",
    tab: "lop-gv",
    ten: "Giờ hết hạn duyệt ảnh trong ngày",
    giaiThich:
      "Quá giờ này (giờ Việt Nam) của ngày hạn thì thư mục ảnh bị tính là trễ và người quản lý " +
      "cơ sở nhận cảnh báo.",
  },

  // ── Ngân sách gửi ra ──
  "outbound.zaloMonthlyCapVnd": {
    donVi: "đ",
    tab: "tien",
    ten: "Trần chi phí tin Zalo mỗi tháng (đ)",
    giaiThich:
      "Chạm trần là ngừng gửi tin Zalo tới hết tháng — kể cả tin nhắc học phí. Đặt 0 là tắt hẳn.",
    canThan: true,
  },
  "outbound.aiGradingMonthlyCapVnd": {
    donVi: "đ",
    tab: "tien",
    ten: "Trần chi phí chấm điểm AI mỗi tháng (đ)",
    giaiThich:
      "Chạm trần là bài nộp chuyển về chấm tay tới hết tháng. Đặt 0 là tắt hẳn chấm AI.",
    canThan: true,
  },
  "outbound.znsUnitCostVnd": {
    donVi: "đ",
    tab: "tien",
    ten: "Giá ước tính một tin ZNS (đ)",
    giaiThich:
      "Chỉ dùng để TRỪ DẦN vào trần ở trên, không phải giá nhà mạng thu. Đặt sai thì trần chạm " +
      "sớm hoặc muộn hơn thực tế.",
  },
  "outbound.warnAtPercent": {
    donVi: "%",
    tab: "tien",
    ten: "Dùng tới bao nhiêu phần trăm trần thì cảnh báo",
    giaiThich:
      "Tới mức này thì màn Tích hợp hiện cảnh báo để còn kịp xử lý trước khi bị chặn.",
  },

  // ── ZaloCRM ──
  "zalocrm.idleAlertHours": {
    donVi: "giờ",
    tab: "khach-hang",
    ten: "Khách chờ trả lời bao nhiêu giờ thì báo động",
    giaiThich:
      "Hội thoại Zalo chưa ai trả lời quá số giờ này sẽ kêu. Đặt quá ngắn thì chuông kêu suốt " +
      "ngoài giờ làm và người trực thôi để ý.",
  },
  "zalocrm.orgCodes": {
    tab: "nang-cao",
    ten: "Ánh xạ cơ sở sang mã tổ chức ZaloCRM",
    giaiThich:
      "Khoá là mã cơ sở bên này, giá trị là mã tổ chức bên máy chủ ZaloCRM. Khai sai hoặc đảo " +
      "chiều là tin của cơ sở này chạy vào cơ sở kia, và không có dòng lỗi nào báo.",
    canThan: true,
  },

};

export const NHAN_VAN_HANH = N;

/** Nhãn của một key. Ném nếu thiếu — thiếu nghĩa là tham số đó biến mất khỏi giao diện. */
export function nhanCuaKey(key: SettingKey): NhanVanHanh {
  const n = N[key];
  if (!n) throw new Error(`Thiếu nhãn vận hành cho setting "${key}"`);
  return n;
}

/** Danh sách key thuộc một tab, giữ nguyên thứ tự khai trong `SETTINGS`. */
export function keyCuaTab(tab: TabId): SettingKey[] {
  return SETTING_KEYS.filter((k) => N[k]?.tab === tab);
}
