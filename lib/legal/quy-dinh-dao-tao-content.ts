// lib/legal/quy-dinh-dao-tao-content.ts — NỘI DUNG + PHIÊN BẢN «Quy định đào tạo học viên» (SR.VH.205).
//
// Phụ huynh có con ĐÃ ĐĂNG KÝ khoá học phải đọc hết và đồng ý MỘT lần trước khi dùng cổng
// (chủ dự án chốt 12/11/2026). Bản dưới đây là bản GÓI GỌN từ văn bản gốc
// `SR.VH.205 - Quy định đào tạo học viên tại Trung Tâm Sata Robo.docx` (5 điều → 5 mục).
//
// ⚠️ KHÔNG import gì chạm DB / `server-only`: màn cổng là Client Component (cùng lý do và khuôn với
// `lib/legal/site-policy-content.ts`). Sổ đồng ý dùng chung bảng `SitePolicyAcceptance` với policyKey riêng.
//
// ⚠️ LUẬT NÂNG PHIÊN BẢN: chữ và `QUY_DINH_PHIEN_BAN` đổi trong CÙNG một commit. NÂNG khi đổi nghĩa vụ
// (học phí, hoàn tiền, nghỉ/bù/bảo lưu…) — mọi phụ huynh sẽ phải đọc và đồng ý lại, TỰ ĐỘNG. KHÔNG nâng khi
// sửa lỗi gõ/định dạng/số điện thoại. Dòng cũ không bao giờ bị sửa hay xoá (bằng chứng «đã đồng ý bản nào»).

/** Khoá loại đồng ý — `SitePolicyAcceptance.policyKey`. Khớp board thiết kế M-Quy-dinh-dong-y. */
export const QUY_DINH_KEY = "quy-dinh-dao-tao";

/**
 * Sổ phiên bản:
 *   · "2026-11-12" — bản gói gọn đầu tiên từ SR.VH.205.
 */
export const QUY_DINH_PHIEN_BAN = "2026-11-12";

export const QUY_DINH_MA_VAN_BAN = "SR.VH.205";
export const QUY_DINH_TIEU_DE = "Quy định đào tạo học viên";

export type MucQuyDinh = { ten: string; dong: readonly string[] };

export const QUY_DINH_MUC: readonly MucQuyDinh[] = [
  {
    ten: "Điều 1. Nội dung đào tạo và học phí",
    dong: [
      "Bên A là Công ty Cổ phần Công nghệ Giáo dục Sata Robo; Bên B là phụ huynh có con học tại các trung tâm của Bên A.",
      "Một khoá học gồm 48 buổi, chia 4 học phần (12 buổi/học phần), 1 buổi mỗi tuần, 90 phút/buổi, tối đa 12 học viên/lớp.",
      "Học phí theo giá niêm yết của từng khoá (cùng các chương trình khuyến mãi áp dụng tại thời điểm thanh toán) đã bao gồm học liệu, hoá đơn và thiết bị thực hành tại lớp.",
      "Học phí giữ nguyên trong suốt học phần đã đóng, không điều chỉnh khi Bên A đổi bảng giá. Học phần tiếp theo áp dụng mức học phí tại thời điểm thanh toán.",
      "Quá 07 ngày kể từ ngày đến hạn mà chưa thanh toán, Bên A có quyền tạm dừng việc học cho đến khi Bên B hoàn tất nghĩa vụ.",
    ],
  },
  {
    ten: "Điều 2. Cam kết chất lượng và hoàn tiền buổi đầu tiên",
    dong: [
      "Bên A hoàn 100% học phí đã nộp nếu sau buổi học đầu tiên Bên B không hài lòng, với điều kiện Bên B thông báo bằng văn bản hoặc tin nhắn trong 24 giờ kể từ khi kết thúc buổi học và hoàn trả nguyên trạng học liệu đã nhận (nếu có).",
      "Tiền được hoàn trong 07 ngày làm việc; nội dung đào tạo chấm dứt và hai bên không còn khiếu nại nào khác.",
      "Ngoài trường hợp trên, học phí đã nộp không hoàn lại vì bất cứ lý do gì; Bên B được bảo lưu theo Điều 3.",
      "Buổi học bị huỷ do lỗi của Bên A được dạy bù 100% và không tính vào số buổi bù của học viên.",
    ],
  },
  {
    ten: "Điều 3. Xếp lớp, chuyên cần, học bù và bảo lưu",
    dong: [
      "Trung tâm sắp xếp và thông báo lịch khai giảng chính thức trong vòng 4 tuần kể từ ngày nhận được học phí. Quá thời hạn này mà không tổ chức lớp như cam kết, Bên A hoàn tiền cho Bên B.",
      "Học viên được nghỉ và bố trí học bù khi: tổng số buổi nghỉ không quá 1 buổi/học phần (12 buổi) và cộng dồn không quá 4 buổi/khoá (48 buổi); đồng thời xin phép trên Ứng dụng của Trung tâm trước giờ học ít nhất 4 tiếng.",
      "Buổi bù được xếp vào lớp cùng khoá học trong vòng 30 ngày.",
      "Buổi nghỉ và buổi bù không quy đổi thành tiền, không chuyển cho người khác.",
      "Học viên ốm dài ngày có giấy tờ y tế, hoặc gia đình chuyển nơi cư trú: được bảo lưu học phí còn lại tối đa 06 tháng; Trung tâm sẽ sắp xếp học lớp mới.",
    ],
  },
  {
    ten: "Điều 4. Quyền và nghĩa vụ của hai bên",
    dong: [
      "Bên A: giảng dạy đúng nội dung, lịch học và sĩ số đã cam kết; báo trước tối thiểu 24 giờ khi thay đổi lịch; bảo đảm an toàn cho học viên trong khuôn viên và giờ học; có phiếu nhận xét, đánh giá sau mỗi buổi; trả lời khiếu nại trong 03 ngày làm việc.",
      "Bên B: thanh toán đúng hạn; đưa đón đúng giờ và chịu trách nhiệm đối với học viên ngoài khuôn viên, ngoài giờ học; nhắc học viên tuân thủ nội quy; bồi thường theo giá trị thực tế nếu học viên cố ý làm hư hỏng tài sản của Bên A.",
      "Bên A được tạm dừng hoặc chấm dứt đào tạo đối với học viên vi phạm nội quy nghiêm trọng hoặc gây mất an toàn, và hoàn trả cho Bên B tương ứng với số buổi chưa được học.",
    ],
  },
  {
    ten: "Điều 5. Bất khả kháng, chấm dứt đào tạo và giải quyết tranh chấp",
    dong: [
      "Trường hợp bất khả kháng (thiên tai, dịch bệnh, yêu cầu của cơ quan nhà nước), hai bên không bị coi là vi phạm; Bên A chuyển sang học trực tuyến, bảo lưu hoặc dạy bù đủ số buổi còn lại.",
      "Việc đào tạo chấm dứt khi hoàn thành học phần hoặc khi hai bên có thoả thuận bằng văn bản.",
      "Tranh chấp được giải quyết bằng thương lượng, hoà giải; nếu không đạt được, một trong hai bên có quyền khởi kiện tại Toà án nhân dân có thẩm quyền tại thành phố Đà Nẵng.",
    ],
  },
];
