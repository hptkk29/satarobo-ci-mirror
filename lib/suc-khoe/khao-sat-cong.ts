/**
 * BỘ CÂU KHẢO SÁT THÓI QUEN của cổng phụ huynh — CHÉP NGUYÊN VĂN từ artifact «Cổng Phụ Huynh — Thiết kế lại» (project/Suc-khoe-khao-sat.dc.html, biến BANK):
 * 28 câu cho trẻ + 30 câu cho người lớn. Mỗi câu: [mã lĩnh vực, nhãn nhóm, câu hỏi (có {ten}), kiểu (1 = chọn một · 2 = chọn nhiều), các lựa chọn, ghi chú].
 * ⚠️ Không sửa tay từng dòng — đổi nội dung thì sửa artifact rồi sinh lại. Chưa qua thẩm định y khoa (chủ dự án chốt khuyến nghị đơn giản, 07/11/2026).
 */
export type CauKhaoSat = readonly [maLinhVuc: string, nhan: string, cau: string, kieu: 1 | 2, luaChon: readonly string[], ghiChu: string];

export const KHAO_SAT_CONG: { readonly tre: readonly CauKhaoSat[]; readonly lon: readonly CauKhaoSat[] } = {
 "tre": [
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Thường ngày đi học, {ten} ăn sáng bao nhiêu ngày trong tuần?",
   1,
   [
    "Hầu như không ăn",
    "1–3 ngày",
    "4–6 ngày",
    "Mọi ngày"
   ],
   ""
  ],
  [
   "do-uong",
   "💧 ĐỒ UỐNG",
   "Trong 7 ngày qua, {ten} uống nước ngọt có ga, trà sữa hoặc nước đóng chai có đường mấy lần?",
   1,
   [
    "Không lần nào",
    "1–2 lần",
    "3–6 lần",
    "Mỗi ngày từ 1 lần trở lên"
   ],
   ""
  ],
  [
   "van-dong",
   "🏃 VẬN ĐỘNG",
   "Trong 7 ngày qua, có bao nhiêu ngày {ten} chạy nhảy, chơi thể thao cộng dồn đủ 60 phút?",
   1,
   [
    "0–2 ngày",
    "3–5 ngày",
    "6–7 ngày"
   ],
   "Tính cả giờ ra chơi, thể dục ở trường và chơi ở nhà; hoạt động làm bé thở nhanh hơn bình thường."
  ],
  [
   "ngu-nghi",
   "😴 GIẤC NGỦ",
   "Đêm trước ngày đi học, {ten} thường ngủ được tổng cộng bao nhiêu tiếng, tính từ lúc ngủ đến lúc dậy?",
   1,
   [
    "Dưới 8 tiếng",
    "8 đến dưới 9 tiếng",
    "9–12 tiếng",
    "Hơn 12 tiếng"
   ],
   ""
  ],
  [
   "man-hinh",
   "📱 MÀN HÌNH",
   "Ngày đi học, {ten} dùng màn hình để giải trí (video, game, không tính học) tổng cộng bao lâu?",
   1,
   [
    "Dưới 1 giờ",
    "1–2 giờ",
    "Hơn 2 đến 3 giờ",
    "Hơn 3 giờ"
   ],
   ""
  ],
  [
   "tam-trang",
   "🙂 TÂM TRẠNG",
   "Nhìn chung trong 2 tuần qua, {ten} có vẻ vui vẻ, thoải mái không?",
   1,
   [
    "Phần lớn thời gian buồn hoặc cáu",
    "Lúc vui lúc buồn như thường",
    "Phần lớn vui vẻ"
   ],
   ""
  ],
  [
   "rang-mieng",
   "🦷 RĂNG MIỆNG",
   "Mỗi ngày {ten} đánh răng mấy lần?",
   1,
   [
    "Có ngày không đánh",
    "1 lần",
    "2 lần trở lên"
   ],
   ""
  ],
  [
   "mat",
   "👀 MẮT",
   "Tính cả ở trường và ở nhà, mỗi ngày {ten} ở ngoài trời dưới ánh sáng tự nhiên khoảng bao lâu?",
   1,
   [
    "Dưới 1 giờ",
    "1 đến dưới 2 giờ",
    "2 giờ trở lên"
   ],
   ""
  ],
  [
   "tu-the",
   "🪑 TƯ THẾ",
   "Cặp sách hằng ngày của {ten} nặng cỡ nào (ba mẹ thử nhấc lên)?",
   1,
   [
    "Rất nặng, bé phải cúi người khi đeo",
    "Hơi nặng",
    "Vừa sức"
   ],
   ""
  ],
  [
   "ve-sinh",
   "🧼 VỆ SINH",
   "Trong 30 ngày qua, trước khi ăn {ten} có rửa tay bằng xà phòng không?",
   1,
   [
    "Không bao giờ",
    "Hiếm khi",
    "Thỉnh thoảng",
    "Thường xuyên",
    "Hầu như mọi lần"
   ],
   ""
  ],
  [
   "an-toan",
   "🛟 AN TOÀN",
   "{ten} đã biết bơi chưa?",
   1,
   [
    "Chưa biết",
    "Bơi được một đoạn ngắn, chưa tự tin",
    "Bơi được và tự nổi, giữ thăng bằng trong nước"
   ],
   ""
  ],
  [
   "phat-trien",
   "🌱 PHÁT TRIỂN",
   "{ten} tự tắm, mặc quần áo và chuẩn bị đồ đi học đến mức nào?",
   1,
   [
    "Người lớn làm giúp phần lớn",
    "Tự làm một phần",
    "Tự làm gần hết"
   ],
   ""
  ],
  [
   "hoc-tap",
   "📚 HỌC TẬP",
   "Ngày đi học, {ten} làm bài tập ở nhà tổng cộng bao lâu?",
   1,
   [
    "Dưới 30 phút",
    "30–60 phút",
    "1–2 giờ",
    "Hơn 2 giờ"
   ],
   ""
  ],
  [
   "gia-dinh",
   "🏠 GIA ĐÌNH",
   "Trong 7 ngày qua, có bao nhiêu tối ít nhất một người lớn ngồi ăn cùng {ten}?",
   1,
   [
    "0–2 tối",
    "3–5 tối",
    "6–7 tối"
   ],
   ""
  ],
  [
   "moi-truong",
   "🌿 MÔI TRƯỜNG",
   "Trong 7 ngày qua, có ai hút thuốc lá (kể cả thuốc lá điện tử) trong nhà hoặc trên xe khi có {ten} không?",
   1,
   [
    "Có, nhiều ngày",
    "Có, 1–2 lần",
    "Không"
   ],
   ""
  ],
  [
   "so-thich",
   "⭐ SỞ THÍCH",
   "{ten} thích nhóm món nào nhất?",
   2,
   [
    "Cơm và món mặn",
    "Bún, phở, mì Quảng",
    "Rau củ",
    "Trái cây",
    "Cá, hải sản",
    "Bánh kẹo, đồ ngọt",
    "Đồ chiên rán"
   ],
   ""
  ],
  [
   "dau-hieu",
   "⚠️ DẤU HIỆU",
   "{ten} có hay nheo mắt, nghiêng đầu hoặc ghé sát khi xem bảng, xem tivi không?",
   1,
   [
    "Thường xuyên",
    "Đôi khi",
    "Không"
   ],
   ""
  ],
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Trong 7 ngày qua, có bao nhiêu ngày {ten} ăn rau trong ít nhất một bữa chính?",
   1,
   [
    "0–2 ngày",
    "3–5 ngày",
    "6–7 ngày"
   ],
   ""
  ],
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Trong 7 ngày qua, có mấy ngày {ten} ăn bánh kẹo, kem hoặc snack ngọt?",
   1,
   [
    "0–2 ngày",
    "3–5 ngày",
    "6–7 ngày"
   ],
   ""
  ],
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Khi ăn cơm, {ten} có xem tivi, điện thoại hoặc máy tính bảng không?",
   1,
   [
    "Không bao giờ",
    "Hiếm khi",
    "Thỉnh thoảng",
    "Thường xuyên",
    "Hầu như bữa nào cũng xem"
   ],
   ""
  ],
  [
   "do-uong",
   "💧 ĐỒ UỐNG",
   "{ten} có mang bình nước riêng đi học và uống hết không?",
   1,
   [
    "Không mang, mua ở trường hoặc chờ về nhà",
    "Có mang nhưng thường còn đầy",
    "Có, thường uống hết hoặc gần hết"
   ],
   ""
  ],
  [
   "van-dong",
   "🏃 VẬN ĐỘNG",
   "Trong tuần, bao nhiêu ngày {ten} chơi mạnh tới mức thở dốc, đổ mồ hôi (chạy đuổi, đá bóng, bơi nhanh)?",
   1,
   [
    "Không ngày nào",
    "1–2 ngày",
    "3 ngày trở lên"
   ],
   ""
  ],
  [
   "van-dong",
   "🏃 VẬN ĐỘNG",
   "Cuối tuần, cả nhà có cùng {ten} đi bộ, đạp xe, bơi hay chơi thể thao không?",
   1,
   [
    "Hầu như không",
    "1–2 lần mỗi tháng",
    "Hầu hết các cuối tuần"
   ],
   ""
  ],
  [
   "ngu-nghi",
   "😴 GIẤC NGỦ",
   "Trong 1 giờ trước khi ngủ, {ten} có dùng điện thoại, máy tính bảng hoặc xem tivi không?",
   1,
   [
    "Không bao giờ",
    "Hiếm khi",
    "Thỉnh thoảng",
    "Thường xuyên",
    "Hầu như mọi tối"
   ],
   ""
  ],
  [
   "man-hinh",
   "📱 MÀN HÌNH",
   "Nhà mình có quy tắc rõ ràng về giờ và nội dung {ten} được xem không?",
   1,
   [
    "Chưa có",
    "Có nhưng ít khi giữ được",
    "Có và thường giữ được"
   ],
   ""
  ],
  [
   "tam-trang",
   "🙂 TÂM TRẠNG",
   "Ở lớp, {ten} có ít nhất một người bạn thân hay chơi cùng không?",
   1,
   [
    "Chưa có bạn thân",
    "Có 1 bạn",
    "Có vài bạn"
   ],
   ""
  ],
  [
   "tam-trang",
   "🙂 TÂM TRẠNG",
   "Trong 30 ngày qua, {ten} có kể là bị bạn trêu chọc, chế giễu hoặc cho ra rìa không?",
   1,
   [
    "Không",
    "1–2 lần",
    "Nhiều lần"
   ],
   ""
  ],
  [
   "tam-trang",
   "🙂 TÂM TRẠNG",
   "Khi có chuyện buồn, {ten} thường kể với ai?",
   2,
   [
    "Ba hoặc mẹ",
    "Ông bà, người thân khác",
    "Thầy cô",
    "Bạn bè",
    "Không kể với ai"
   ],
   ""
  ]
 ],
 "lon": [
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Trong một tuần bình thường, {ten} ăn rau xanh vào bao nhiêu ngày?",
   1,
   [
    "0–2 ngày",
    "3–5 ngày",
    "6–7 ngày"
   ],
   ""
  ],
  [
   "do-uong",
   "💧 ĐỒ UỐNG",
   "Mỗi ngày {ten} uống khoảng bao nhiêu ly nước lọc (ly khoảng 250 ml)?",
   1,
   [
    "Dưới 4 ly",
    "4–6 ly",
    "Từ 7 ly trở lên"
   ],
   ""
  ],
  [
   "van-dong",
   "🏃 VẬN ĐỘNG",
   "Cộng tất cả lại, mỗi tuần {ten} vận động từ mức vừa (thở nhanh hơn, vẫn nói chuyện được) trở lên khoảng bao lâu?",
   1,
   [
    "Dưới 60 phút",
    "60–149 phút",
    "150–300 phút",
    "Hơn 300 phút"
   ],
   ""
  ],
  [
   "ngu-nghi",
   "😴 GIẤC NGỦ",
   "Trong 7 ngày qua, trung bình mỗi đêm {ten} ngủ được bao nhiêu tiếng?",
   1,
   [
    "Dưới 6 tiếng",
    "6 đến dưới 7 tiếng",
    "7–9 tiếng",
    "Hơn 9 tiếng"
   ],
   ""
  ],
  [
   "man-hinh",
   "📱 MÀN HÌNH",
   "Ngoài giờ làm, mỗi ngày {ten} dành bao lâu cho điện thoại, tivi, máy tính để giải trí?",
   1,
   [
    "Dưới 1 giờ",
    "1–2 giờ",
    "2–4 giờ",
    "Hơn 4 giờ"
   ],
   ""
  ],
  [
   "tam-trang",
   "🙂 TÂM TRẠNG",
   "Trong 2 tuần qua, {ten} cảm thấy vui vẻ, tinh thần thoải mái trong khoảng bao nhiêu thời gian?",
   1,
   [
    "Không lúc nào",
    "Thỉnh thoảng",
    "Ít hơn một nửa thời gian",
    "Hơn một nửa thời gian",
    "Hầu như mọi lúc"
   ],
   ""
  ],
  [
   "rang-mieng",
   "🦷 RĂNG MIỆNG",
   "Mỗi ngày {ten} chải răng mấy lần?",
   1,
   [
    "Không đều, có ngày không chải",
    "1 lần",
    "2 lần trở lên"
   ],
   ""
  ],
  [
   "mat",
   "👀 MẮT",
   "Khi làm việc với máy tính hoặc điện thoại lâu, {ten} có định kỳ rời mắt nhìn ra xa không?",
   1,
   [
    "Hầu như không",
    "Khi nhớ ra",
    "Khoảng 20–30 phút một lần",
    "Ít dùng màn hình"
   ],
   ""
  ],
  [
   "tu-the",
   "🪑 TƯ THẾ",
   "Khi ngồi làm việc, mép trên màn hình máy tính của {ten} nằm ở đâu so với tầm mắt?",
   1,
   [
    "Thấp hẳn, phải cúi đầu (thường là laptop)",
    "Hơi thấp",
    "Ngang hoặc hơi dưới tầm mắt",
    "Không làm máy tính"
   ],
   ""
  ],
  [
   "ve-sinh",
   "🧼 VỆ SINH",
   "Trước khi ăn, {ten} có rửa tay bằng xà phòng không?",
   1,
   [
    "Hiếm khi",
    "Thỉnh thoảng",
    "Thường xuyên",
    "Luôn luôn"
   ],
   ""
  ],
  [
   "an-toan",
   "🛟 AN TOÀN",
   "Khi đi xe máy (lái hoặc ngồi sau), {ten} đội mũ bảo hiểm cài quai thường xuyên đến mức nào?",
   1,
   [
    "Hiếm khi",
    "Chỉ khi đi đường xa",
    "Hầu như luôn luôn",
    "Luôn luôn",
    "Không đi xe máy"
   ],
   ""
  ],
  [
   "cong-viec",
   "💼 CÔNG VIỆC",
   "Tính cả làm thêm và việc mang về nhà, mỗi tuần {ten} làm việc khoảng bao nhiêu giờ?",
   1,
   [
    "Dưới 40 giờ",
    "40–48 giờ",
    "49–54 giờ",
    "Từ 55 giờ trở lên",
    "Hiện không đi làm"
   ],
   ""
  ],
  [
   "gia-dinh",
   "🏠 GIA ĐÌNH",
   "Trong 7 ngày qua, có bao nhiêu tối cả nhà cùng ngồi ăn tối với nhau?",
   1,
   [
    "0–1 tối",
    "2–4 tối",
    "5–7 tối"
   ],
   ""
  ],
  [
   "thuoc-la-ruou",
   "🚭 THUỐC LÁ, RƯỢU BIA",
   "Hiện nay {ten} có hút thuốc lá điếu, thuốc lào hay xì gà không?",
   1,
   [
    "Có, hằng ngày",
    "Có, nhưng không phải ngày nào",
    "Đã bỏ",
    "Chưa bao giờ hút"
   ],
   ""
  ],
  [
   "kham-dinh-ky",
   "🩺 KHÁM ĐỊNH KỲ",
   "Lần gần nhất {ten} đi khám sức khỏe tổng quát (không phải vì đang ốm) là khi nào?",
   1,
   [
    "Trong 12 tháng qua",
    "1–2 năm trước",
    "Hơn 2 năm trước",
    "Chưa bao giờ hoặc không nhớ"
   ],
   ""
  ],
  [
   "moi-truong",
   "🌿 MÔI TRƯỜNG",
   "Khi đi xe máy trên đường bụi, gần công trình, {ten} có đeo khẩu trang không?",
   1,
   [
    "Hầu như không",
    "Thỉnh thoảng",
    "Thường xuyên"
   ],
   ""
  ],
  [
   "so-thich",
   "⭐ SỞ THÍCH",
   "{ten} thích hoặc muốn thử môn vận động nào? (chọn các ý đúng)",
   2,
   [
    "Đi bộ, chạy bộ",
    "Bơi lội",
    "Cầu lông, bóng bàn, pickleball",
    "Đá bóng, bóng chuyền",
    "Yoga, dưỡng sinh",
    "Tập tạ, gym",
    "Đạp xe",
    "Khác"
   ],
   ""
  ],
  [
   "dau-hieu",
   "⚠️ DẤU HIỆU",
   "Trong 3 tháng qua, {ten} có lúc đau, tức hoặc đè nặng ở ngực, nhất là khi leo dốc, đi nhanh hay căng thẳng không?",
   1,
   [
    "Không",
    "Có, đã được bác sĩ khám",
    "Có, chưa đi khám"
   ],
   ""
  ],
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Trong một tuần bình thường, {ten} ăn trái cây vào bao nhiêu ngày?",
   1,
   [
    "0–2 ngày",
    "3–5 ngày",
    "6–7 ngày"
   ],
   ""
  ],
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Trong 7 ngày qua, {ten} ăn sáng bao nhiêu ngày?",
   1,
   [
    "0–2 ngày",
    "3–5 ngày",
    "6–7 ngày"
   ],
   ""
  ],
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Khi đã ngồi vào bữa, {ten} có hay rắc thêm muối, chan thêm nước mắm hoặc xì dầu vào món ăn không?",
   1,
   [
    "Luôn luôn",
    "Thường xuyên",
    "Thỉnh thoảng",
    "Hiếm khi",
    "Không bao giờ"
   ],
   ""
  ],
  [
   "an-uong",
   "🥦 ĂN UỐNG",
   "Trong một tuần, bữa ăn của {ten} có món chiên ngập dầu (gà rán, nem rán, khoai chiên…) bao nhiêu lần?",
   1,
   [
    "Từ 5 lần trở lên",
    "3–4 lần",
    "1–2 lần",
    "Gần như không"
   ],
   ""
  ],
  [
   "do-uong",
   "💧 ĐỒ UỐNG",
   "Trong 7 ngày qua, {ten} uống bao nhiêu lon hoặc chai nước ngọt có gas?",
   1,
   [
    "Từ 7 lon trở lên",
    "3–6 lon",
    "1–2 lon",
    "Không uống"
   ],
   ""
  ],
  [
   "van-dong",
   "🏃 VẬN ĐỘNG",
   "Trong một tuần, {ten} tập cho cơ bắp chắc khỏe (hít đất, squat, tạ, dây kháng lực) bao nhiêu ngày?",
   1,
   [
    "Không ngày nào",
    "1 ngày",
    "Từ 2 ngày trở lên"
   ],
   ""
  ],
  [
   "van-dong",
   "🏃 VẬN ĐỘNG",
   "Một ngày bình thường, tính cả lúc làm việc, đi xe và xem tivi, {ten} ngồi hoặc nằm nghỉ (không ngủ) tổng cộng bao lâu?",
   1,
   [
    "Dưới 4 giờ",
    "4–7 giờ",
    "8–10 giờ",
    "Hơn 10 giờ"
   ],
   ""
  ],
  [
   "ngu-nghi",
   "😴 GIẤC NGỦ",
   "Trong 2 tuần qua, {ten} có bao nhiêu buổi sáng thức dậy thấy tươi tỉnh, được nghỉ ngơi?",
   1,
   [
    "Không lúc nào",
    "Ít hơn một nửa số ngày",
    "Hơn một nửa số ngày",
    "Hầu như mọi ngày"
   ],
   ""
  ],
  [
   "man-hinh",
   "📱 MÀN HÌNH",
   "Trong 30 phút trước khi ngủ, {ten} có dùng điện thoại hoặc xem màn hình không?",
   1,
   [
    "Hầu như đêm nào",
    "Vài đêm mỗi tuần",
    "Hiếm khi"
   ],
   ""
  ],
  [
   "tam-trang",
   "🙂 TÂM TRẠNG",
   "Nhìn lại tháng qua, mức căng thẳng chung của {ten} thế nào?",
   1,
   [
    "Rất căng thẳng",
    "Khá căng thẳng",
    "Vừa phải",
    "Ít căng thẳng",
    "Hầu như không"
   ],
   ""
  ],
  [
   "tam-trang",
   "🙂 TÂM TRẠNG",
   "Trong một tuần, {ten} có được bao nhiêu thời gian làm việc mình thích, chỉ cho riêng mình?",
   1,
   [
    "Gần như không có",
    "Dưới 1 giờ",
    "1–3 giờ",
    "Hơn 3 giờ"
   ],
   ""
  ],
  [
   "an-toan",
   "🛟 AN TOÀN",
   "Trong 12 tháng qua, {ten} có lái xe máy hoặc ô tô sau khi đã uống rượu bia, dù chỉ một ít, không?",
   1,
   [
    "Có, nhiều lần",
    "Có, một hai lần",
    "Không",
    "Không lái xe hoặc không uống"
   ],
   ""
  ]
 ]
} as const;
