/**
 * BỐI CẢNH ĐẶT TRƯỚC MỖI CÂU — "Ở nhà, …", "Trong giờ học nhóm, …".
 *
 * Mỗi tầng 18 bối cảnh, chia đều 3 nhóm (h · n · b). Một câu của ngân hàng = một bối cảnh +
 * một mẫu hành vi CÙNG NHÓM. Bối cảnh chỉ đổi KHUNG CẢNH, không đổi hành vi được đo.
 *
 * 🔴 Bối cảnh phải RỘNG và TRUNG TÍNH ("Ở nhà", "Với nhóm bạn"). Bản đầu dùng bối cảnh hẹp
 * ("Trong bữa cơm tối", "Khi có việc gấp ở chỗ làm") và đọc mẫu thì ra câu vô nghĩa: *"Trong
 * bữa cơm tối, em chịu khó tập lại một việc nhiều lần"*. Bối cảnh hẹp chỉ hợp với một số
 * hành vi, và không có cách gắn thẻ nào bắt hết.
 *
 * 🔴 Bối cảnh KHÔNG chứa chủ ngữ, đánh giá, hay mức độ ("khi mệt", "khi bị ép", "chỗ đông
 * người"): những thứ đó đổi độ khó của câu, nên hai đề bốc ngẫu nhiên sẽ lệch nhau về độ khó.
 *
 * Thuộc TẦNG LÕI: hằng số thuần.
 */

import type { NhomBoiCanh, Tang } from "./khung";

export type BoiCanh = { readonly ma: string; readonly chu: string; readonly nhom: NhomBoiCanh };

const bc = (ma: string, nhom: NhomBoiCanh, chu: string): BoiCanh => ({ ma, chu, nhom });

export const BOI_CANH: Readonly<Record<Tang, readonly BoiCanh[]>> = {
  be: [
    bc("h1", "h", "Ở lớp"),
    bc("h2", "h", "Ở trường mầm non"),
    bc("h3", "h", "Trong giờ học trên lớp"),
    bc("h4", "h", "Ở lớp năng khiếu"),
    bc("h5", "h", "Khi ở cùng cô và các bạn"),
    bc("h6", "h", "Trong giờ chơi ở trường"),
    bc("n1", "n", "Ở nhà"),
    bc("n2", "n", "Khi ở cùng bố mẹ"),
    bc("n3", "n", "Khi ở cùng ông bà"),
    bc("n4", "n", "Vào cuối tuần ở nhà"),
    bc("n5", "n", "Khi ở nhà cùng anh chị em"),
    bc("n6", "n", "Khi về quê"),
    bc("b1", "b", "Ở sân chơi"),
    bc("b2", "b", "Khi chơi với các bạn"),
    bc("b3", "b", "Khi có bạn sang nhà chơi"),
    bc("b4", "b", "Ở công viên"),
    bc("b5", "b", "Khi sang nhà bạn chơi"),
    bc("b6", "b", "Ở khu vui chơi"),
  ],
  em: [
    bc("h1", "h", "Ở lớp"),
    bc("h2", "h", "Ở trường"),
    bc("h3", "h", "Trong giờ học nhóm"),
    bc("h4", "h", "Ở lớp học robot"),
    bc("h5", "h", "Ở lớp học thêm"),
    bc("h6", "h", "Trong các hoạt động ở trường"),
    bc("n1", "n", "Ở nhà"),
    bc("n2", "n", "Khi ở cùng bố mẹ"),
    bc("n3", "n", "Với anh chị em trong nhà"),
    bc("n4", "n", "Khi về thăm ông bà"),
    bc("n5", "n", "Vào cuối tuần ở nhà"),
    bc("n6", "n", "Khi cả nhà làm việc chung"),
    bc("b1", "b", "Khi chơi với các bạn"),
    bc("b2", "b", "Giờ ra chơi"),
    bc("b3", "b", "Khi đi chơi với bạn"),
    bc("b4", "b", "Khi chơi trò chơi nhóm"),
    bc("b5", "b", "Ở các buổi đi chơi tập thể"),
    bc("b6", "b", "Với các bạn hàng xóm"),
  ],
  teen: [
    bc("h1", "h", "Trên lớp"),
    bc("h2", "h", "Ở trường"),
    bc("h3", "h", "Khi làm bài nhóm"),
    bc("h4", "h", "Trong câu lạc bộ ở trường"),
    bc("h5", "h", "Ở lớp học thêm"),
    bc("h6", "h", "Trong các hoạt động ở trường"),
    bc("n1", "n", "Ở nhà"),
    bc("n2", "n", "Trong gia đình"),
    bc("n3", "n", "Khi ở cùng bố mẹ"),
    bc("n4", "n", "Với anh chị em trong nhà"),
    bc("n5", "n", "Khi cả nhà có việc chung"),
    bc("n6", "n", "Với họ hàng"),
    bc("b1", "b", "Với nhóm bạn"),
    bc("b2", "b", "Khi đi chơi với bạn"),
    bc("b3", "b", "Trong nhóm bạn thân"),
    bc("b4", "b", "Khi chơi thể thao cùng bạn"),
    bc("b5", "b", "Khi tham gia hoạt động chung"),
    bc("b6", "b", "Trên mạng với bạn bè"),
  ],
  lon: [
    bc("h1", "h", "Ở chỗ làm"),
    bc("h2", "h", "Trong công việc"),
    bc("h3", "h", "Khi làm việc với đồng nghiệp"),
    bc("h4", "h", "Khi làm việc nhóm"),
    bc("h5", "h", "Ở cơ quan"),
    bc("h6", "h", "Trong các việc chung ở chỗ làm"),
    bc("n1", "n", "Ở nhà"),
    bc("n2", "n", "Trong gia đình"),
    bc("n3", "n", "Khi ở cùng người nhà"),
    bc("n4", "n", "Trong các việc chung của gia đình"),
    bc("n5", "n", "Khi lo việc nhà"),
    bc("n6", "n", "Với họ hàng"),
    bc("b1", "b", "Với bạn bè"),
    bc("b2", "b", "Trong các buổi gặp gỡ"),
    bc("b3", "b", "Trong nhóm phụ huynh của lớp"),
    bc("b4", "b", "Với hàng xóm"),
    bc("b5", "b", "Khi tham gia hoạt động chung"),
    bc("b6", "b", "Trong các buổi liên hoan"),
  ],
};

/**
 * BỘ QS DÙNG BỐI CẢNH RIÊNG. Câu dẫn bắt bố mẹ "chỉ trả lời theo những gì THẬT SỰ nhìn
 * thấy" — nên chỉ giữ những khung cảnh bố mẹ có mặt. "Giờ ra chơi" hay "Ở lớp" thì bố mẹ
 * không nhìn thấy, và một câu như thế là mời bố mẹ ĐOÁN.
 */
export const BOI_CANH_QS: readonly BoiCanh[] = [
  bc("n1", "n", "Ở nhà"),
  bc("n2", "n", "Khi ở cùng bố mẹ"),
  bc("n3", "n", "Với anh chị em trong nhà"),
  bc("n4", "n", "Khi về thăm ông bà"),
  bc("n5", "n", "Vào cuối tuần ở nhà"),
  bc("n6", "n", "Khi cả nhà có việc chung"),
  bc("b1", "b", "Khi có bạn đến nhà chơi"),
  bc("b2", "b", "Khi đi chơi cùng gia đình và bạn bè"),
  bc("b3", "b", "Ở các buổi tiệc sinh nhật"),
  bc("b4", "b", "Khi chơi với các bạn ở khu nhà"),
  bc("b5", "b", "Ở các buổi họp mặt họ hàng"),
  bc("b6", "b", "Khi đi chơi cùng các bạn và bố mẹ"),
];
