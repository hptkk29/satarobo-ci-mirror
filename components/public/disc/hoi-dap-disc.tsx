"use client";

import { useState } from "react";

// Hỏi–đáp trang DISC — CHÉP từ artifact "Disc" (mục [06], `.sv.a-acc`, nút `aria-expanded`). Mỗi câu trả lời mô tả ĐÚNG hành vi thật của
// luồng làm bài đang chạy (bản nháp trong tab 2 giờ, lưu giữ tối đa 90 ngày, nhận lại bằng mã + OTP Zalo...) — đổi luồng thì sửa ở đây.
// Số câu của từng bộ KHÔNG nêu ở đây (artifact ghi "24 câu", "20–24 câu"): con số đó đọc từ động cơ ở bảng "Bộ câu hỏi".
const HOI_DAP: ReadonlyArray<readonly [string, string]> = [
  ["DISC là gì, có phải bài kiểm tra tâm lý không?", "DISC đo thiên hướng hành vi — mỗi người nghiêng về cách làm nào — qua bốn nhóm: Chủ động (D), Ảnh hưởng (I), Ổn định (S) và Cẩn trọng (C). Đây không phải chẩn đoán tâm lý, cũng không đo thông minh hay năng lực."],
  ["Làm bài mất bao lâu?", "Khoảng 15–20 phút cho cả ba/mẹ và con. Ba/mẹ làm bài của mình rồi tới bài của con, mỗi màn hình một câu."],
  ["Con còn nhỏ thì làm thế nào?", "Với bé mầm non và lớp 1–2, ba/mẹ quan sát và trả lời hộ theo những gì thường thấy ở bé trong khoảng hai tuần gần đây. Chúng tôi không bắt trẻ nhỏ tự đánh giá bản thân. Từ lớp 3, con tự làm bài của mình."],
  ["Có mất phí hay cần tài khoản không?", "Miễn phí và không cần đăng nhập để làm bài. Chỉ ở bước cuối, khi muốn lưu và xem lại kết quả, chúng tôi mới hỏi số điện thoại."],
  ["Làm xong thì xem lại kết quả ở đâu?", "Sau khi lưu, bạn tải được kết quả (PDF) ngay và nhận một mã nhận bài chỉ hiện một lần. Để xem lại về sau, vào trang Nhận kết quả DISC, nhập số điện thoại, mã nhận bài và năm sinh của con, rồi xác minh bằng mã gửi qua Zalo."],
  ["Dữ liệu của gia đình được giữ bao lâu?", "Bài làm tạm chỉ nằm trong tab trình duyệt, tự mất khi đóng tab hoặc sau 2 giờ, và không giữ họ tên. Khi bạn lưu, bài chưa được nhận về tài khoản được giữ tối đa 90 ngày. Bạn có thể xoá dữ liệu DISC trên máy bất cứ lúc nào."],
  ["Bộ câu hỏi có được chuẩn hoá không?", "Bộ câu hỏi do SATA ROBO biên soạn theo mô hình DISC và chưa được chuẩn hoá trên dữ liệu người Việt. Kết quả dùng để mở một cuộc trò chuyện trong nhà, không phải để dán nhãn cho con."],
  ["Có nhóm nào tốt hơn nhóm nào không?", "Không. Mỗi người là pha trộn của cả bốn nhóm, chỉ khác ở chỗ nhóm nào đậm hơn. Trẻ đang lớn thì hồ sơ còn đổi — làm lại sau vài tháng thường cho hình ảnh rõ hơn."],
];

export function HoiDapDisc() {
  const [mo, setMo] = useState<number | null>(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {HOI_DAP.map(([q, a], i) => {
        const dangMo = mo === i;
        return (
          <div key={q} className="sv a-acc" style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "14px" }}>
            <button
              type="button"
              id={`disc-hd-${i}`}
              aria-expanded={dangMo}
              aria-controls={`disc-hd-tl-${i}`}
              onClick={() => setMo(dangMo ? null : i)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left", background: "transparent", border: "0", padding: "16px 18px", font: "inherit", fontWeight: "700", color: "var(--text)", cursor: "pointer", minHeight: "56px" }}
            >
              <span style={{ flexGrow: "1" }}>{q}</span>
              <span
                aria-hidden="true"
                style={{
                  width: "30px", height: "30px", flexShrink: "0", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700",
                  ...(dangMo ? { background: "#fe8f2d", color: "#241133" } : { background: "var(--chip)", color: "var(--purT)" }),
                }}
              >
                {dangMo ? "−" : "+"}
              </span>
            </button>{" "}
            {dangMo && (
              <p id={`disc-hd-tl-${i}`} role="region" aria-labelledby={`disc-hd-${i}`} style={{ margin: "0", padding: "0 18px 16px", color: "var(--muted)" }}>
                {a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
