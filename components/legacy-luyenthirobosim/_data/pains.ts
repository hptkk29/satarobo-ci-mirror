export interface Pain {
  id: number;
  icon: string;
  label: string;
  title: string;
  body: string;
}

const pains: Pain[] = [
  {
    id: 1,
    icon: "❌",
    label: "SỰ THẬT 01",
    title: "Đề thi đã mở công khai — và đó CHÍNH LÀ vấn đề.",
    body: `Bố mẹ tưởng "con có đề trước là lợi thế"? Sai hoàn toàn.

Khi cả nước đều có đề.
Khi cả nước đều luyện free trên Youtube.
Khi cả nước đều có 180 phút như nhau.

→ Con bố mẹ KHÔNG còn lợi thế nào cả. Ai cũng giống ai.`,
  },
  {
    id: 2,
    icon: "❌",
    label: "SỰ THẬT 02",
    title: "Học free → Đứng cùng đám đông → Bị loại cùng đám đông.",
    body: `Đại đa số học sinh học free đạt mức điểm gần bằng nhau — mức trung bình chung của những người tự luyện.

Nghe có vẻ ổn? Không hề.

BTC RBT2026 không cộng điểm cho "cố gắng". BTC chỉ chọn TOP — phần còn lại bị loại.

Mà mức điểm "trung bình chung"… nằm trong phần BỊ LOẠI.`,
  },
  {
    id: 3,
    icon: "❌",
    label: "SỰ THẬT 03",
    title: "180 phút thi — Con không kịp làm, mất điểm OAN.",
    body: `Cùng 1 đề. Cùng 180 phút.

Có bạn làm xong dư thời gian, ăn điểm tối đa từng câu.
Có bạn loay hoay đến phút thứ 170 vẫn chưa qua câu khó.

Vì sao? Vì có bạn biết MẸO di chuyển robot nhanh. Có bạn biết TRICK ưu tiên câu nào trước. Có bạn được dạy KỸ THUẬT tránh bẫy mất điểm.

Còn con bố mẹ thì… tự mò trên Youtube.`,
  },
];

export default pains;
