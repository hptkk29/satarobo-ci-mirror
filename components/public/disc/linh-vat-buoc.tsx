import { PubAnh } from "@/components/public/pub-design/pub-anh";
import type { Buoc } from "@/components/disc/ban-nhap";

/** Linh vật + một câu nhắn theo chặng — CHÉP từ artifact "Disc-LamBai" (`.dj-mascot.dj-hide-sm`; ảnh hi/pencil/reading/thumbs/party). */
const ANH = {
  hi: "677f6b6846ebf7628e125173d5ab78eb",
  pencil: "a8d293a9efc52ad97026bd2d0dc02db2",
  reading: "214f70bfc7cb9a92126b0a2e6207c48a",
  thumbs: "42d4d66e4311582de0d03b3122bb7b04",
  party: "da847c40d631e0b7a535a73c3172ac50",
} as const;

const THEO_BUOC: Record<Buoc, readonly [keyof typeof ANH, string]> = {
  hoSo: ["hi", "Chào ba mẹ! Mình là Rô. Điền vài thông tin để Rô chọn đúng bộ câu hỏi nhé."],
  phuHuynh: ["pencil", "Không có câu nào đúng hay sai — chọn mức đúng với bạn nhất."],
  hocSinh: ["reading", "Giờ tới lượt con! Chọn câu giống con nhất nha."],
  hoanThanh: ["thumbs", "Sắp xong rồi! Lưu lại để xem kết quả của cả nhà."],
};
const BE_NHO: readonly [keyof typeof ANH, string] = ["reading", "Chọn theo những gì bạn thường thấy ở bé, không theo điều bạn mong."];
const THANH_CONG: readonly [keyof typeof ANH, string] = ["party", "Tuyệt vời! Nhớ chép mã nhận kết quả trước khi rời trang nhé."];

export function LinhVatBuoc({ buoc, thanhCong, beNho = false }: { buoc: Buoc; thanhCong: boolean; beNho?: boolean }) {
  const [anh, loi] = thanhCong ? THANH_CONG : buoc === "hocSinh" && beNho ? BE_NHO : THEO_BUOC[buoc];
  return (
    <div className="dj-mascot dj-hide-sm">
      <PubAnh id={ANH[anh]} alt="" sizes="62px" />
      <span>{loi}</span>
    </div>
  );
}
