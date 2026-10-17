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
  // 11/10/2026 (nghiệm thu bảo lưu, ô B5; chủ dự án chốt: "QLCS thấy và sửa được `pause.minDays` của cơ sở mình"). `pause.minDays` là khoá bảo lưu DUY NHẤT
  // Quản lý cơ sở sửa được (`qlcsSuaDuoc`) và NÓ NẰM Ở TAB NÀY — trước bản vá tab đòi `settings:view` nên QLCS có quyền ghi (server cho) mà không có đường bấm
  // tới (giao diện nói KHÔNG, server nói CÓ — luật 12). Vào được tab KHÔNG nghĩa là thấy 20+ khoá còn lại: chế độ cơ sở lọc theo `qlcsSuaDuoc`, và `[QT-B5-01]`
  // ghim rằng tab này chỉ để lộ đúng `pause.minDays` cho cấp cơ sở. Giá trị TOÀN HỆ vẫn chỉ Quản trị tối cao (settings:edit).
  "hoc-vien": "settings:view-center",
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
  // (29/09 → 09/10/2026) Tab "Máy POS" (quyền `payments:import-pos`, chủ dự án chốt Q-D) đã DỜI về mục "Máy POS quẹt
  // thẻ" của màn Cơ sở — khai máy ⇒ cơ sở thuộc nhóm "tiền về đâu" cạnh tài khoản nhận tiền, không phải một tham số cấu
  // hình. Hệ quả: `payments:import-pos` KHÔNG còn mở "Cấu hình vận hành" trên sidebar (sidebar suy quyền từ bảng này).
  // Lối vào cũ `?tab=may-pos` vẫn sống — xem `duongTabDaDoi`.
};

/**
 * Tab TỰ QUẢN quyền ghi: nội dung riêng (`noiDungRieng`) mà action của nó tự hỏi quyền — KHÔNG
 * phụ thuộc `settings:edit`. Dải "Bạn chỉ có quyền xem" + câu "mỗi lần lưu phải ghi lý do" của
 * màn nói về Ô CẤU HÌNH CHUNG, nên người chỉ thấy các tab này không được đọc chúng: Kế toán HO
 * vào tab Máy POS thêm / sửa / tắt máy được trong khi dải vàng nói "chỉ xem" (luật 12). `[QT-06]`
 * (Tab Máy POS đã dời về màn Cơ sở 09/10/2026; lý lẽ còn nguyên cho tab tự quản quyền ghi còn lại.)
 */
export const TAB_TU_QUAN_QUYEN_GHI: ReadonlySet<TabId> = new Set<TabId>(["nick-zalo"]);

/** Người xem có thấy ÍT NHẤT một tab mà quyền sửa đi theo `settings:edit` không. */
export function coTabTheoQuyenSuaChung(tabDuocXem: Iterable<TabId>): boolean {
  for (const t of tabDuocXem) if (!TAB_TU_QUAN_QUYEN_GHI.has(t)) return true;
  return false;
}

/**
 * Tab đã DỜI khỏi trang này ⇒ nơi chúng dời tới. Giữ link cũ (bookmark, chuông, tài liệu) hoạt động thay vì rơi về tab đầu
 * hay 404.
 *
 * `may-pos` ⇒ `/centers` (09/10/2026): khai máy POS nay là mục "Máy POS quẹt thẻ" của MỖI cơ sở. Đích là danh sách cơ sở
 * chứ không một cơ sở cụ thể vì link cũ không mang cơ sở nào.
 *
 * ⚠️ Trang PHẢI hỏi hàm này TRƯỚC cổng quyền theo tab: sau khi gỡ tab, Kế toán Hội sở không còn giữ tab nào ⇒ cổng đá họ về
 * dashboard, không bao giờ tới `/centers`. Ca `[HN2-MP-W05]`.
 */
const TAB_DA_DOI_CHO: Readonly<Record<string, string>> = { "may-pos": "/centers" };

export function duongTabDaDoi(tab: string | undefined): string | null {
  if (!tab || !Object.prototype.hasOwnProperty.call(TAB_DA_DOI_CHO, tab)) return null;
  return TAB_DA_DOI_CHO[tab] ?? null;
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
      "Chọn ngày quay lại xa hơn mức này (tính từ ngày bắt đầu bảo lưu, theo tháng lịch) sẽ bị từ chối. " +
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
      "Một hồ sơ được gia hạn nhiều nhất bấy nhiêu lần. Vượt mức này phải trình Ban Giám đốc/Tổng Giám đốc xử lý ngoại lệ.",
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
      "Số ngày lịch phụ huynh có để phản hồi, kể từ ngày Trung tâm gửi thông báo chính thức. Đồng hồ chỉ chạy SAU khi đã ghi gửi thông báo. Hết hạn mà phụ huynh chưa phục học hoặc gia hạn thì chuyển sang Nghỉ học – Hết quyền lợi bảo lưu.",
    donVi: "ngày lịch",
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
  "shift.soPhepBat": {
    tab: "cham-cong",
    ten: "Bật sổ phép năm",
    giaiThich: "Bật thì duyệt đơn nghỉ phép sẽ trừ quỹ phép của người đó, huỷ đơn thì hoàn lại. Tắt (mặc định) thì đơn nghỉ duyệt như cũ, sổ không đổi. Mức quỹ đầu kỳ do quản lý ghi ở màn Sổ phép.",
  },
  "shift.soPhepMaLoai": {
    tab: "cham-cong",
    ten: "Loại nghỉ trừ quỹ phép",
    giaiThich: "Mã trong danh mục Loại nghỉ (mặc định NGHI_PHEP). Các loại nghỉ khác không đụng tới quỹ.",
  },
  "shift.soPhepPhutMotNgay": {
    tab: "cham-cong",
    ten: "Một ngày phép bằng bao nhiêu phút",
    giaiThich: "Nghỉ cả ngày trừ ngần này phút cho mỗi ngày làm việc trong đơn; nghỉ nửa buổi / theo giờ trừ đúng số phút nghỉ trong ca.",
    donVi: "phút",
  },
  "shift.soPhepChoAm": {
    tab: "cham-cong",
    ten: "Cho ứng phép",
    giaiThich: "Tắt (mặc định): quỹ không đủ thì không duyệt được đơn nghỉ phép. Bật: duyệt được, quỹ âm và hiện ở mục cần rà soát.",
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
    // Đo 11/10/2026: KHÔNG có nơi đọc khoá này (và `leaveDaysPerYear`) — màn hình đang hứa một bộ cấp phép tự động
    // không tồn tại (luật 12). Nói thật cho tới khi HR chốt chính sách (P2.1B, `docs/cham-cong/PHASE-2-TRANG-THAI.md`).
    giaiThich: "CHƯA CÓ HIỆU LỰC: hệ thống chưa tự cộng phép (chờ HR chốt chính sách). Quỹ phép hiện ghi tay ở màn Sổ phép.",
    donVi: "ngày",
  },
  "shift.leaveDaysPerYear": {
    tab: "cham-cong",
    ten: "Phép năm tối đa",
    giaiThich: "CHƯA CÓ HIỆU LỰC: hệ thống chưa tự cộng phép nên chưa có trần để áp (chờ HR chốt chính sách).",
    donVi: "ngày/năm",
  },
  "shift.ipCheDo": {
    tab: "cham-cong",
    ten: "Kiểm mạng (IP) khi chấm công",
    giaiThich:
      "So IP của lượt chấm với danh sách mạng của điểm chấm (khai ở màn Điểm chấm công). Điểm chưa khai danh sách, người đang làm từ xa / công tác / chấm ngoài địa điểm đã duyệt, và lượt không đọc được IP thì không bao giờ bị chặn.",
    canThan: true,
    chon: [
      { giaTri: "OFF", nhan: "Tắt", hauQua: "Không kiểm mạng — như trước đây." },
      { giaTri: "OBSERVE", nhan: "Chỉ ghi nhận", hauQua: "Ghi lại lượt nào sẽ bị chặn nếu siết; không ai thấy gì, không chặn ai." },
      { giaTri: "WARNING", nhan: "Cảnh báo", hauQua: "Lượt ngoài mạng vẫn ghi nhưng gắn cờ cho quản lý rà; người chấm thấy cảnh báo." },
      { giaTri: "ENFORCE", nhan: "Siết", hauQua: "Lượt ngoài mạng của điểm đã khai danh sách bị từ chối. Chỉ bật khi đã có phê duyệt vận hành." },
    ],
  },
  "shift.thietBiCheDo": {
    tab: "cham-cong",
    ten: "Kiểm thiết bị chấm công",
    giaiThich: "Ghi nhận máy nào được dùng để chấm công và (khi siết) chặn máy đã thu hồi / báo mất.",
    canThan: true,
    chon: [
      { giaTri: "OFF", nhan: "Tắt", hauQua: "Không ghi nhận thiết bị nào — như trước đây." },
      {
        giaTri: "OBSERVE",
        nhan: "Chỉ theo dõi",
        hauQua: "Ghi nhận thiết bị, gắn cờ lượt chấm từ máy lạ / máy đã thu hồi để quản lý rà, KHÔNG chặn ai.",
      },
      {
        giaTri: "ENFORCE",
        nhan: "Siết",
        hauQua: "Chặn lượt chấm từ máy đã thu hồi / báo mất. Chỉ bật sau khi đã chạy “Chỉ theo dõi” đủ lâu.",
      },
    ],
  },
  "shift.thietBiToiDa": {
    tab: "cham-cong",
    ten: "Số thiết bị tin cậy tối đa mỗi người",
    giaiThich: "Duyệt thêm quá số này thì phải thu hồi bớt máy cũ trước.",
    donVi: "thiết bị",
  },
  "shift.thietBiTuTinCayDauTien": {
    tab: "cham-cong",
    ten: "Máy đầu tiên tự được tin cậy",
    giaiThich: "Bật: máy đầu tiên một người dùng để chấm công tự được tin cậy; từ máy thứ hai phải chờ quản lý duyệt.",
  },
  "shift.thietBiChoPhepKhanCap": {
    tab: "cham-cong",
    ten: "Khi siết: vẫn cho chấm từ máy chưa duyệt",
    giaiThich: "Bật: máy chưa duyệt vẫn chấm được nhưng lượt bị gắn cờ để rà. Tắt: máy chưa duyệt bị chặn (máy thu hồi / báo mất luôn bị chặn khi siết).",
  },
  "shift.xacNhanCongBat": {
    tab: "cham-cong",
    ten: "Bật xác nhận công + khiếu nại công",
    giaiThich:
      "Bật thì nhân sự xác nhận bảng công tháng hoặc gửi khiếu nại; còn khiếu nại chưa kết luận thì không chốt được kỳ (cấp Hội sở vượt được kèm lý do). Tắt (mặc định) thì không có gì thay đổi.",
  },
  "shift.phanCongNhanLopBat": {
    tab: "cham-cong",
    ten: "Bật phân công theo buổi + xác nhận nhận lớp (thù lao parttime)",
    giaiThich:
      "Bật thì từ ngày 15/10/2026: duyệt đơn dạy thay sẽ giao buổi cho người dạy thay và chờ họ xác nhận nhận lớp; duyệt đơn " +
      "nghỉ huỷ phân công của buổi; buổi mới tạo được dựng sẵn phân công từ giáo viên/trợ giảng của lớp. Chưa tính tiền gì. " +
      "Tắt (mặc định) thì mọi luồng chạy y như trước.",
    canThan: true,
  },

  "shift.parttimeTreVaoPhut": {
    tab: "cham-cong",
    ten: "Phân công parttime: vào muộn bao nhiêu phút vẫn coi là đúng giờ",
    giaiThich:
      "So với giờ PHẢI CÓ MẶT của buổi (giờ bắt đầu trừ thời gian chuẩn bị theo quy định thù lao). Chỉ đổi cách GẮN NHÃN " +
      "bằng chứng trên màn Phân công buổi (\"Đi muộn\" hay không); không trừ tiền, không đổi công. Mặc định 0: muộn 1 phút cũng ghi nhận.",
    donVi: "phút",
  },
  "shift.parttimeVeSomPhut": {
    tab: "cham-cong",
    ten: "Phân công parttime: ra sớm bao nhiêu phút vẫn coi là đủ buổi",
    giaiThich:
      "So với giờ KẾT THÚC của buổi. Chỉ đổi cách GẮN NHÃN bằng chứng (\"Ra sớm\" hay không); không trừ tiền, không đổi công. " +
      "Mặc định 0.",
    donVi: "phút",
  },

  "shift.znsBat": {
    tab: "zalo",
    ten: "Gửi Zalo cho nhân sự về chấm công",
    giaiThich:
      "Mời xác nhận bảng công và báo khiếu nại công đã xử lý qua Zalo, bên cạnh chuông trong ứng dụng. Chỉ bật khi " +
      "hai mẫu tin bên dưới đã được Zalo duyệt; mẫu nào để trống thì loại tin đó không gửi.",
  },
  "shift.znsMauMoiXacNhan": {
    tab: "zalo",
    ten: "Mẫu tin: mời xác nhận bảng công",
    giaiThich: "Mẫu cần đúng hai tham số ten, ky. Để trống thì không gửi.",
    canThan: true,
  },
  "shift.znsMauKhieuNai": {
    tab: "zalo",
    ten: "Mẫu tin: khiếu nại công đã xử lý",
    giaiThich: "Mẫu cần đúng ba tham số ten, ky, ket_qua. Để trống thì không gửi.",
    canThan: true,
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
  // ── Nguồn lead & engine hoa hồng mới [08/10/2026] ──────────────────────────────────────────
  "nguon.enabled": {
    tab: "khach-hang",
    ten: "Quản lý nguồn khách (công tắc tổng)",
    giaiThich:
      "Bật thì mọi phiếu khách tạo ra đều được ghi nguồn gốc (khách đến từ đâu, ai giới thiệu), " +
      "và hiện thêm mục Nguồn lead ở menu. Tắt thì không ghi gì mới, nhãn nguồn vẫn như cũ. Bốn công " +
      "tắc con bên dưới chỉ có tác dụng khi công tắc tổng đang bật. Phiếu tạo lúc còn tắt sẽ KHÔNG " +
      "tự có nguồn: hoa hồng của chúng tính theo «không rõ nguồn» (mức thấp nhất) và mục Đổi nguồn " +
      "cũng chưa nhận chúng. Hiện chưa có công cụ bù hàng loạt, nên hỏi người phụ trách trước khi bật.",
    canThan: true,
  },
  "nguon.autoAttribution": {
    tab: "khach-hang",
    ten: "Tự quy nguồn theo tín hiệu có sẵn",
    giaiThich:
      "Bật thì hệ thống tự đoán nguồn của phiếu từ mã chiến dịch, Page hay đường dẫn khách đi vào. " +
      "Tắt thì chỉ ghi nguồn do người nhập chọn. Chỉ có tác dụng khi công tắc tổng quản lý nguồn bật.",
  },
  "nguon.pageMapping": {
    tab: "khach-hang",
    ten: "Quy nguồn theo Page Facebook",
    giaiThich:
      "Bật thì khách nhắn vào một Page đã khai trong bảng nguồn theo Page sẽ được gắn đúng nguồn của " +
      "Page đó. Page chưa khai thì vào hàng chờ xem tay. Chỉ có tác dụng khi công tắc tổng bật.",
  },
  "nguon.referral": {
    tab: "khach-hang",
    ten: "Ghi người giới thiệu và mã giới thiệu",
    giaiThich:
      "Bật thì phiếu khách ghi được người giới thiệu (nhân viên, phụ huynh cũ, cộng tác viên). Mã " +
      "giới thiệu đến sau chỉ được ghi lại để tham khảo, KHÔNG giành mất nguồn gốc đã có. Chỉ có tác " +
      "dụng khi công tắc tổng bật.",
  },
  "nguon.manualReview": {
    tab: "khach-hang",
    ten: "Đưa ca không tự quy được vào hàng chờ xem tay",
    giaiThich:
      "Bật thì những phiếu hệ thống không dám tự quyết nguồn (nhãn lạ, mã giới thiệu mơ hồ) nằm chờ " +
      "người xem và chọn nguồn đúng. Tắt thì các ca đó ghi là nguồn không rõ. Chỉ có tác dụng khi " +
      "công tắc tổng bật.",
  },
  "nguon.epChonNguon": {
    tab: "khach-hang",
    ten: "Chặn nhãn nguồn lạ khi nhập Excel (bật riêng từng cơ sở)",
    giaiThich:
      "Bật cho một cơ sở thì nhập từ Excel gặp nhãn nguồn lạ sẽ báo lỗi và không cho xác nhận (thay vì ghi " +
      "vào hàng chờ xem tay). Ô Nhập khách hàng KHÔNG phụ thuộc cờ này: khi công tắc tổng «Quản lý nguồn khách» " +
      "bật, ô đó luôn bắt chọn nguồn từ danh mục nguồn. Chỉ quản trị tối cao đổi được, quản lý cơ sở không tự bật hay gỡ.",
    canThan: true,
  },
  "nguon.cuaSoGhiCongNgay": {
    tab: "khach-hang",
    ten: "Cửa sổ ghi công nguồn",
    giaiThich:
      "Từ lúc phiếu khách vào, khoản thu đến trong chừng này ngày thì mới sinh hoa hồng thu hút " +
      "khách cho nguồn. Quá hạn thì phiếu vẫn giữ nguyên nguồn gốc nhưng không sinh hoa hồng thu hút.",
    donVi: "ngày",
  },
  "nguon.nhomNhanSuMacDinh": {
    tab: "khach-hang",
    ten: "Nguồn mặc định của nhân sự giới thiệu",
    giaiThich:
      "Khi chỉ biết khách do một nhân sự giới thiệu mà không ai chọn rõ nguồn (ví dụ cột Mã nhân viên giới thiệu trong Excel), " +
      "phiếu được ghi vào nguồn có mã này. Phải là nguồn đang hoạt động và là loại nguồn cần chọn nhân sự giới thiệu. " +
      "Khi người nhập chọn rõ một nguồn thì giữ đúng nguồn đã chọn, cài đặt này không đổi nó.",
  },
  "nguon.bangNguonTheoPage": {
    tab: "khach-hang",
    ten: "Bảng nguồn theo Page Facebook",
    giaiThich:
      "Mỗi dòng gắn mã một Page với nhóm nguồn (và chiến dịch nếu có). Sửa tạm ở đây cho tới khi có " +
      "màn riêng. Gõ sai tên trường sẽ bị từ chối chứ không bị bỏ qua lặng lẽ.",
  },
  "hoaHong.engineBat": {
    tab: "hoa-hong",
    ten: "Engine hoa hồng mới",
    giaiThich:
      "Bật thì hệ thống tự tính và ghi sổ hoa hồng theo kỳ mới, và hiện các màn Chính sách, Sổ, Kỳ, " +
      "Khiếu nại. Tắt thì engine không ghi gì và các màn đó ẩn; sổ hoa hồng cũ vẫn chạy như hôm nay. " +
      "Đây là CÔNG TẮC TỔNG của tiền: tắt cũng dừng hoa hồng của đối tác Affiliate đã có người hưởng " +
      "(tắt «Affiliate / người giới thiệu» thì KHÔNG dừng được tiền). " +
      "Chưa đổi kỳ nào sang sổ mới — mốc kỳ được đặt riêng khi chuyển đổi.",
    canThan: true,
  },
  "affiliate.enabled": {
    tab: "khach-hang",
    ten: "Affiliate / người giới thiệu",
    giaiThich:
      "Bật thì module Nguồn Lead & Hoa hồng nhận và ghi nhận khách do đối tác giới thiệu (link, mã QR, biểu mẫu trên " +
      "website đối tác) và có thêm các tab Affiliate, Campaign, Website. Tắt thì ngừng nhận khách giới thiệu MỚI " +
      "(khách điền biểu mẫu vẫn được lưu như lead thường, không ghi công cho đối tác nào; ô chọn người giới thiệu " +
      "không đưa đối tác ra). Cờ này KHÔNG bật và cũng KHÔNG dừng việc tính tiền: hoa hồng đã có người hưởng vẫn do " +
      "«Engine hoa hồng mới» quyết — muốn dừng tiền hãy tắt công tắc đó. Chỉ có tác dụng khi công tắc tổng " +
      "«Quản lý nguồn khách» đang bật.",
  },
  "hoaHong.xuatLuongBat": {
    tab: "hoa-hong",
    ten: "Cho xuất bảng chi hoa hồng",
    giaiThich:
      "Bật thì ở màn Kỳ, kế toán có thể xuất bảng chi (tệp Excel) cho kỳ đã khoá và đánh dấu đã chi. Tắt thì kỳ dừng ở " +
      "“đã khoá”: số hoa hồng vẫn khoá được nhưng không ai xuất bảng chi ra khỏi hệ thống. Xuất xong không xuất lại được " +
      "cùng một khoản, nên chỉ bật khi đã sẵn sàng chi trong kỳ lương.",
    canThan: true,
  },
  "hoaHong.kyCutover": {
    tab: "hoa-hong",
    ten: "Mốc chuyển sang hoa hồng mới",
    giaiThich:
      "Kỳ (tháng) mà từ đó hoa hồng tính theo sổ mới; các kỳ trước chỉ xem, không tính lại. Để trống nghĩa là chưa chuyển. " +
      "Mốc này KHÔNG sửa ở đây: đặt, dời hoặc gỡ ở trang «Chuyển sang hoa hồng mới» (nút «Mở trang chuyển hoa hồng» ngay đầu tab). " +
      "Trang đó cho xem trước tác động, kiểm các điều kiện (bảng kê cũ đã duyệt, so bóng hai engine, di trú nguồn), chặn dời mốc " +
      "khi sổ mới đã có dòng, và ghi nhật ký người đặt, lý do, bằng chứng đã xem.",
    canThan: true,
  },
  "hoaHong.vatTheoNgay": {
    tab: "hoa-hong",
    ten: "Thuế VAT của học phí theo ngày",
    giaiThich:
      "Mỗi dòng là một mốc: từ ngày nào thì học phí chịu thuế VAT bao nhiêu (ví dụ 0,08 là 8%). Hoa hồng tính trên số tiền " +
      "SAU khi đã bỏ VAT. Để trống nghĩa là chưa có VAT, tính trên toàn bộ số tiền khách đóng. Sửa ở đây chỉ áp cho khoản thu " +
      "mới — dòng hoa hồng đã ghi không bị tính lại, và khoản hoàn dùng đúng mức VAT của khoản thu gốc.",
    canThan: true,
  },
  "hoaHong.soThangDoiSoat": {
    tab: "hoa-hong",
    ten: "Đối soát hoa hồng hằng tuần: số tháng quét lại",
    giaiThich:
      "Mỗi tuần hệ thống rà lại hoa hồng của chừng này tháng gần nhất để phát hiện dữ liệu đã đổi sau khi tính (ví dụ đổi người " +
      "phụ trách của khách). Đặt 0 để tắt đối soát hằng tuần; khi bấm Tính kỳ vẫn rà đủ.",
    donVi: "tháng",
  },
  "hoaHong.nguongDuyetHaiCap": {
    tab: "hoa-hong",
    ten: "Điều chỉnh hoa hồng từ mức này trở lên cần hai người duyệt",
    giaiThich:
      "Khiếu nại hoặc đổi nguồn làm thay đổi số tiền hoa hồng từ mức này trở lên (hoặc vượt giới hạn hợp lý của giao dịch) phải có HAI người duyệt, " +
      "khác nhau và khác người đề xuất. Dưới mức này một người duyệt là đủ. 10.000.000 là mức khởi điểm, chỉnh được (tối đa 2.147.483.647). " +
      "Các điều chỉnh thuộc CÙNG một khiếu nại hoặc CÙNG một lần đổi nguồn được cộng chung rồi mới so với mức này — chia nhỏ ra nhiều ô không né được. Mỗi đề xuất ghi lại mức đang áp dụng lúc lập, " +
      "nên đổi ở đây không làm đề xuất đã lập đổi cách duyệt. Nếu giá trị này bị nhập sai, hệ thống yêu cầu hai người duyệt cho đến khi sửa.",
    donVi: "đồng",
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
  "billing.scopePurchaseEnabled": {
    tab: "tien",
    ten: "Thu học phí theo phạm vi học",
    giaiThich:
      "Bật thì đơn MỚI của cơ sở được mua 12, 24, 36 hoặc 48 buổi mỗi lần đóng, và không còn chia " +
      "nhiều đợt. Đơn đã tạo trước đó giữ cách thu cũ. Chưa nên bật khi tờ trình chưa ký.",
    canThan: true,
  },
  "pricing.policyDateBasis": {
    tab: "tien",
    ten: "Giá tính theo ngày nào",
    giaiThich:
      "Quyết định chính sách giá của ngày nào được áp cho đơn. Đổi mục này có thể làm số tiền in trên " +
      "mã QR khác số tiền thực thu.",
    canThan: true,
    chon: [
      {
        giaTri: "ORDER_CREATED",
        nhan: "Ngày tạo đơn",
        hauQua:
          "Số tiền in trên mã QR cố định từ lúc phát. Đơn tạo cuối kỳ khuyến mãi vẫn giữ giá cũ " +
          "dù phụ huynh chuyển tiền sau khi kỳ khuyến mãi đã hết.",
      },
      {
        giaTri: "PAYMENT_RECEIVED",
        nhan: "Ngày tiền về tài khoản",
        hauQua:
          "Đúng theo tờ trình nhưng hệ thống CHƯA có phần tính lại giá lúc tiền về. Tiền về sau hạn " +
          "sẽ không khớp mã QR đã in và kế toán phải xử lý tay.",
      },
    ],
  },
  "pricing.oddSessionsRule": {
    tab: "tien",
    ten: "Giá khi mua số buổi lẻ",
    giaiThich:
      "Số buổi không phải 12, 24, 36 hay 48 không có sẵn mức giảm. Chọn cách tính để người lập đơn " +
      "không phải tự đoán.",
    canThan: true,
    chon: [
      {
        giaTri: "MANUAL",
        nhan: "Người duyệt tự nhập mức giảm",
        hauQua:
          "Mỗi đơn lẻ cần người có quyền duyệt nhập phần trăm giảm; chậm hơn nhưng không có giá nào " +
          "được áp mà không ai nhìn qua.",
      },
      {
        giaTri: "NO_DISCOUNT",
        nhan: "Không giảm",
        hauQua:
          "Giá bằng đơn giá niêm yết nhân số buổi, không giảm. Nhanh nhưng phụ huynh mua 30 buổi trả " +
          "đắt hơn người mua 24 buổi theo đơn giá.",
      },
      {
        giaTri: "LOWER_TIER",
        nhan: "Lấy mức giảm của mốc thấp hơn gần nhất",
        hauQua:
          "Mua 30 buổi được mức của 24 buổi. Dễ hiểu với phụ huynh nhưng cho giảm ngay cả khi chưa " +
          "đạt mốc kế tiếp.",
      },
    ],
  },
  "enrollment.lateEntryMaxLessons": {
    tab: "hoc-vien",
    ten: "Vào lớp trễ được học bù miễn phí",
    giaiThich:
      "Học viên đóng trọn gói vào lớp khi lớp đã dạy quá số bài này thì quản lý cơ sở phải chọn học " +
      "vượt hoặc chuyển lớp; từ số này trở xuống thì được học bù miễn phí.",
    donVi: "bài",
  },
  "enrollment.catchUpMaxSessions": {
    tab: "hoc-vien",
    ten: "Trần học vượt cho gói không trọn",
    giaiThich:
      "Gói 12, 24, 36 buổi vào lớp giữa chừng chỉ được học vượt tối đa số bài này. Bài đã qua nhiều " +
      "hơn thì xử lý theo mục “Khi số bài đã qua vượt trần” bên dưới.",
    donVi: "bài",
  },
  "enrollment.catchUpOverCapPolicy": {
    tab: "hoc-vien",
    ten: "Khi số bài đã qua vượt trần học vượt",
    giaiThich:
      "Quyết định bài nào bị bỏ khi học viên vào lớp trễ hơn trần học vượt. Bài bị bỏ vẫn nằm trong " +
      "số buổi đã mua và không được hoàn tiền.",
    canThan: true,
    chon: [
      {
        giaTri: "KEEP_LATEST",
        nhan: "Bỏ bài cũ nhất, học vượt các bài gần nhất",
        hauQua:
          "Học viên vẫn được học vượt đến mức trần, chỉ mất các bài đầu. Vào trễ thêm một bài chỉ " +
          "mất thêm một bài.",
      },
      {
        giaTri: "DROP_ALL",
        nhan: "Bỏ toàn bộ bài đã qua",
        hauQua:
          "Vào lớp trễ hơn trần một bài là mất hết quyền học vượt: vào ở bài 19 được 6 bài nhưng vào " +
          "ở bài 20 thì không được bài nào.",
      },
    ],
  },
  "enrollment.catchUpMaxLessonsPerSession": {
    tab: "hoc-vien",
    ten: "Số bài tối đa trong một buổi học vượt",
    giaiThich:
      "Một buổi học vượt dạy gộp tối đa số bài này. Tăng lên thì cần ít buổi hơn nhưng mỗi buổi dài " +
      "và nặng hơn cho học viên.",
    donVi: "bài mỗi buổi",
  },
  "enrollment.renewalGraceSessions": {
    tab: "hoc-vien",
    ten: "Buổi ân hạn sau khi hết quyền học",
    giaiThich:
      "Học viên hết số buổi đã mua vẫn được học thêm số buổi này trong lúc chờ phụ huynh đóng tiếp. " +
      "Hết ân hạn mà chưa đóng thì chuyển sang giữ chỗ.",
    donVi: "buổi",
  },
  "enrollment.graceCountsTowardNextPurchase": {
    tab: "hoc-vien",
    ten: "Buổi ân hạn trừ vào gói mua tiếp",
    giaiThich:
      "Bật thì các buổi đã học trong thời gian ân hạn được tính vào gói mua tiếp, tức học viên nhận " +
      "ít buổi mới hơn. Tắt thì ân hạn là quà tặng và gói mới tính đủ số buổi.",
    canThan: true,
  },
  "enrollment.seatHoldDays": {
    tab: "hoc-vien",
    ten: "Giữ chỗ sau khi hết ân hạn",
    giaiThich:
      "Sau khi hết ân hạn, chỗ của học viên trong lớp được giữ thêm số ngày này chờ phụ huynh đóng " +
      "tiếp. Hết hạn giữ chỗ thì học viên rời lớp.",
    donVi: "ngày",
  },
  "enrollment.entitlementTrigger": {
    tab: "hoc-vien",
    ten: "Lúc nào học viên được cấp quyền học",
    giaiThich:
      "Quyết định học viên được xếp lớp ngay khi tiền về hay phải chờ kế toán xác nhận. Hoa hồng " +
      "luôn chờ kế toán xác nhận dù chọn cách nào.",
    canThan: true,
    chon: [
      {
        giaTri: "PAYMENT_PAID",
        nhan: "Khi tiền về đủ",
        hauQua:
          "Học viên vào học sớm nhất có thể. Nếu kế toán sau đó từ chối khoản thu thì phải thu hồi " +
          "quyền học đã cấp.",
      },
      {
        giaTri: "ACCOUNTANT_CONFIRMED",
        nhan: "Khi kế toán xác nhận",
        hauQua:
          "Không bao giờ cấp quyền cho khoản tiền chưa được duyệt, nhưng học viên phải chờ kế toán " +
          "mới được xếp lớp.",
      },
    ],
  },
  "enrollment.catchUpMaxStudentsPerGroup": {
    tab: "hoc-vien",
    ten: "Sĩ số tối đa một nhóm học bù hoặc học vượt",
    giaiThich:
      "Chỉ có tác dụng khi bật “Thu học phí theo phạm vi học”. Số học viên tối đa trong một nhóm học " +
      "bù hoặc học vượt. Đặt 0 là không giới hạn sĩ số — đó là giá trị mặc định, vì chưa có con số " +
      "thật từ ban lãnh đạo.",
    donVi: "học viên",
  },
  "enrollment.minClassSessionsToAdmit": {
    tab: "hoc-vien",
    ten: "Lớp còn ít buổi thì không nhận học viên mới",
    giaiThich:
      "Chỉ có tác dụng khi bật “Thu học phí theo phạm vi học”. Lớp còn dưới số buổi này thì không xếp " +
      "thêm học viên mới vào, và học viên được hẹn lớp khai giảng sau. Đặt 0 là nhận vào bất kể lớp " +
      "còn bao nhiêu buổi.",
    donVi: "buổi",
  },
  "enrollment.transferMaxLessonGap": {
    tab: "hoc-vien",
    ten: "Chuyển lớp lệch bao nhiêu bài thì phải chờ duyệt",
    giaiThich:
      "Chỉ có tác dụng khi bật “Thu học phí theo phạm vi học”. Lớp mới đi trước hoặc sau học viên " +
      "quá số bài này thì yêu cầu chuyển lớp phải chờ người có quyền duyệt; từ số này trở xuống thì " +
      "không cần duyệt thêm.",
    donVi: "bài",
  },
  "enrollment.entitlementGateMode": {
    tab: "hoc-vien",
    ten: "Khi học viên đã hết quyền học",
    giaiThich:
      "Chỉ có tác dụng khi bật “Thu học phí theo phạm vi học”. Quyết định điểm danh và lịch học có " +
      "chặn học viên đã dùng hết số buổi đã mua (kể cả ân hạn) hay không. Trước khi bật “Thu học phí " +
      "theo phạm vi học” ở một cơ sở thật, mục này phải ở “Chặn điểm danh”: nếu còn để “Chỉ cảnh báo” " +
      "thì học viên đã hết số buổi vẫn học không giới hạn mà không ai được báo. Mức cảnh báo chỉ dùng " +
      "để đo trên môi trường thử.",
    canThan: true,
    chon: [
      {
        giaTri: "OFF",
        nhan: "Không kiểm tra",
        hauQua:
          "Hệ thống không nói gì khi học viên học quá số buổi đã mua. Học viên học không giới hạn và " +
          "không ai được báo.",
      },
      {
        giaTri: "WARN",
        nhan: "Chỉ cảnh báo",
        hauQua:
          "Điểm danh vẫn ghi được, hệ thống chỉ cảnh báo cho giáo vụ. Học viên KHÔNG tự rời lớp khi hết " +
          "ân hạn — đây là chế độ đo.",
      },
      {
        giaTri: "ENFORCE",
        nhan: "Chặn điểm danh",
        hauQua:
          "Hết số buổi và hết ân hạn thì hệ thống chặn điểm danh, học viên chuyển sang giữ chỗ. Chỉ " +
          "bật khi giáo vụ đã biết và phụ huynh đã được báo trước.",
      },
    ],
  },
  "pricing.sameTimeChildOrder": {
    tab: "tien",
    ten: "Thứ tự các con chọn sẵn khi mua cùng lúc",
    giaiThich:
      "Chỉ có tác dụng khi bật “Thu học phí theo phạm vi học”. Khi một đơn có nhiều con mua cùng lúc, " +
      "đây là thứ tự được chọn sẵn trên màn tạo đơn; phụ huynh chọn lại được và người bán ghi lại lựa " +
      "chọn đó. Khác với mục “Ưu đãi anh chị em áp cho con nào” (quyết định ai được giảm ở nhà đã có " +
      "con đang học).",
    canThan: true,
    chon: [
      {
        giaTri: "LOWER_VALUE_FIRST",
        nhan: "Dòng có giá niêm yết thấp xếp là con thứ nhất",
        hauQua:
          "Con thứ nhất là con có học phí niêm yết thấp hơn trong đơn, nên phần cộng thêm cho con thứ " +
          "hai rơi vào dòng đắt hơn và nhà được giảm nhiều tiền hơn.",
      },
      {
        giaTri: "HIGHER_VALUE_FIRST",
        nhan: "Dòng có giá niêm yết cao xếp là con thứ nhất",
        hauQua:
          "Con thứ nhất là con có học phí niêm yết cao hơn, nên phần cộng thêm rơi vào dòng rẻ hơn và " +
          "nhà được giảm ít tiền hơn so với cách còn lại.",
      },
    ],
  },
  "orders.paymentDueDays": {
    tab: "tien",
    ten: "Hạn thanh toán đơn mua theo phạm vi học",
    giaiThich:
      "Chỉ có tác dụng khi bật “Thu học phí theo phạm vi học”. Số ngày kể từ lúc tạo đơn để hệ thống " +
      "ghi hạn trả tiền và nhắc nợ. Chỉ dùng để nhắc: quá hạn KHÔNG làm đổi giá đã báo cho phụ huynh.",
    donVi: "ngày",
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
