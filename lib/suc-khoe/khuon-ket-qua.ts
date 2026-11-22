/**
 * KHUÔN KẾT QUẢ theo nhóm (lời chào, giải thích, gợi ý ăn uống · vận động · nghỉ ngơi, lịch tuần, 3 thử thách) — CHÉP NGUYÊN VĂN từ artifact «Sata Robo — Website mới»
 * (project/SucKhoe.dc.html, đối số thứ hai của khối logic). Cùng nguồn với `dong-co-goc.ts`: khuyến nghị ĐƠN GIẢN, chủ dự án chốt KHÔNG cần bác sĩ duyệt (07/11/2026).
 * Chọn khuôn: trẻ <6 tuổi → `tre-nho`; trẻ → `tre`; mang thai/cho con bú → `dac-biet`; người lớn theo BMI châu Á → `nl-nhe-can` / `nl-binh-thuong` / `nl-can-chu-y`.
 * ⚠️ Không sửa tay từng dòng — đổi nội dung thì sửa artifact rồi sinh lại.
 */

export type MucGoiY = readonly [bieuTuong: string, noiDung: string];
export type KhoiGoiY = {
  readonly tieuDe: string;
  readonly tomTat: string;
  readonly muc: readonly MucGoiY[];
  readonly luuY?: string;
  readonly tuan?: readonly (readonly [thu: string, viec: string])[];
};
export type KhuonKetQua = {
  readonly giaiThich: string;
  readonly loiChao: string;
  readonly anUong: KhoiGoiY;
  readonly vanDong: KhoiGoiY;
  readonly nghiNgoi: KhoiGoiY;
  readonly thuThach: readonly string[];
};
export type TenKhuon = "tre-nho" | "tre" | "nl-binh-thuong" | "nl-nhe-can" | "nl-can-chu-y" | "dac-biet";

export const KHUON_KET_QUA: Readonly<Record<TenKhuon, KhuonKetQua>> = {
  "tre-nho": {
    "giaiThich": "Với bé dưới 5 tuổi, bé được so với bảng chuẩn tăng trưởng của WHO theo tuổi và giới. Cân đo định kỳ ở cơ sở y tế vẫn là cách theo dõi đáng tin nhất.",
    "loiChao": "Chào **{ten}**! Sata Robo cùng ba mẹ theo dõi bé lớn lên từng ngày nhé!",
    "anUong": {
      "tieuDe": "Ăn uống cho bé nhỏ",
      "tomTat": "Đa dạng, đủ bữa, theo hướng dẫn của bác sĩ nhi",
      "muc": [
        [
          "🍼",
          "Bé dưới 6 tháng: **bú mẹ hoàn toàn** là lựa chọn được WHO khuyến nghị; từ 6 tháng bắt đầu ăn dặm theo hướng dẫn của bác sĩ nhi."
        ],
        [
          "🥣",
          "Ăn đủ nhóm: tinh bột, đạm (cá, trứng, thịt, đậu), rau củ, trái cây; **thêm dầu mỡ lành mạnh** vừa đủ."
        ],
        [
          "🥛",
          "Sữa và chế phẩm từ sữa theo độ tuổi, theo hướng dẫn của bác sĩ."
        ],
        [
          "🚫",
          "Tránh ép ăn; tránh nước ngọt, bánh kẹo, đồ ăn vặt đóng gói."
        ]
      ],
      "luuY": "Mỗi bé có nhu cầu riêng — hãy hỏi bác sĩ nhi về lượng sữa và bữa ăn phù hợp."
    },
    "vanDong": {
      "tieuDe": "Vui chơi vận động",
      "tomTat": "Chơi nhiều trong ngày, hạn chế ngồi lâu",
      "muc": [
        [
          "🧸",
          "Bé 3–4 tuổi nên có khoảng **180 phút/ngày** hoạt động thể chất ở mọi mức độ (bò, chạy, chơi cùng bố mẹ)."
        ],
        [
          "📵",
          "Dưới 1 tuổi nên tránh xem màn hình; từ 2–4 tuổi, **không quá 1 giờ/ngày**, càng ít càng tốt."
        ],
        [
          "📖",
          "Cùng bé đọc sách, hát, chơi — vận động cũng là lúc gắn kết."
        ]
      ],
      "tuan": [
        [
          "T2",
          "Đạp xe 30 phút"
        ],
        [
          "T3",
          "Nhảy dây 15 phút"
        ],
        [
          "T4",
          "Chơi ngoài sân 45 phút"
        ],
        [
          "T5",
          "Bơi / thể dục"
        ],
        [
          "T6",
          "Đi bộ cùng bố mẹ"
        ],
        [
          "T7",
          "Cầu lông cả nhà"
        ],
        [
          "CN",
          "Dã ngoại nhẹ"
        ]
      ]
    },
    "nghiNgoi": {
      "tieuDe": "Giấc ngủ của bé",
      "tomTat": "10–14 giờ mỗi ngày tuỳ độ tuổi",
      "muc": [
        [
          "🌙",
          "Bé 1–2 tuổi thường ngủ **11–14 giờ**, bé 3–4 tuổi **10–13 giờ** (kể cả giấc ngày)."
        ],
        [
          "🛁",
          "Nếp trước khi ngủ cố định: tắm, đọc truyện, tắt đèn."
        ]
      ],
      "luuY": "Nếu bé ngủ ngáy to, ngừng thở hoặc chậm lớn, hãy đưa bé đi khám."
    },
    "thuThach": [
      "Cùng bé chơi ngoài trời mỗi ngày",
      "Đọc cho bé nghe một câu chuyện trước khi ngủ",
      "Tắt tivi trong giờ ăn"
    ]
  },
  "tre": {
    "giaiThich": "So với bảng chuẩn tăng trưởng của WHO cho trẻ cùng độ tuổi và giới. Chỉ là một mốc tham khảo — mỗi bé lớn lên theo nhịp riêng.",
    "loiChao": "Chào **{ten}**! Sata Robo thấy mình đang lớn rất ổn. Cùng thử vài thói quen vui nhé!",
    "anUong": {
      "tieuDe": "Ăn uống cho bé đang lớn",
      "tomTat": "4 nhóm thực phẩm, sữa, rau, nước",
      "muc": [
        [
          "🍚",
          "Ăn đủ **4 nhóm** mỗi ngày: cơm/bún/khoai, đạm (cá, trứng, thịt, đậu phụ), rau củ, trái cây."
        ],
        [
          "🥛",
          "Sữa hoặc sản phẩm từ sữa **2–3 phần/ngày** để có canxi cho xương."
        ],
        [
          "🥬",
          "Rau nhiều màu: rau muống, bí, cà rốt, cải xanh. Để bé tự chọn một loại rau mỗi bữa."
        ],
        [
          "💧",
          "Uống nước lọc đủ; hạn chế nước ngọt, trà sữa, đồ chiên, snack."
        ],
        [
          "🍳",
          "**Đừng bỏ bữa sáng** — giúp bé tập trung ở trường."
        ]
      ],
      "luuY": "Không cần đếm calo cho bé. Điều quan trọng là bữa ăn đa dạng và vui vẻ."
    },
    "vanDong": {
      "tieuDe": "Vận động mỗi ngày",
      "tomTat": "Khoảng 60 phút/ngày, chọn trò bé thích",
      "muc": [
        [
          "⏱️",
          "Trẻ 5–17 tuổi nên có khoảng **60 phút/ngày** vận động từ vừa đến mạnh (chạy nhảy, đạp xe, bơi, nhảy dây)."
        ],
        [
          "🦴",
          "Nhảy, leo trèo, đá cầu vài buổi/tuần giúp **xương và cơ** chắc khoẻ."
        ],
        [
          "😄",
          "Chọn trò bé thích — vận động nên là niềm vui."
        ]
      ],
      "tuan": [
        [
          "T2",
          "Đạp xe 30 phút"
        ],
        [
          "T3",
          "Nhảy dây 15 phút"
        ],
        [
          "T4",
          "Chơi ngoài sân 45 phút"
        ],
        [
          "T5",
          "Bơi / thể dục"
        ],
        [
          "T6",
          "Đi bộ cùng bố mẹ"
        ],
        [
          "T7",
          "Cầu lông cả nhà"
        ],
        [
          "CN",
          "Dã ngoại nhẹ"
        ]
      ]
    },
    "nghiNgoi": {
      "tieuDe": "Nghỉ ngơi cho bé",
      "tomTat": "9–12 giờ ngủ, nghỉ mắt, tư thế học",
      "muc": [
        [
          "🌙",
          "Trẻ 6–12 tuổi thường cần **9–12 giờ ngủ** mỗi đêm; tuổi thiếu niên khoảng 8–10 giờ."
        ],
        [
          "📵",
          "Giờ đi ngủ đều đặn, tắt màn hình **1 giờ trước khi ngủ**."
        ],
        [
          "👀",
          "Quy tắc **20–20–20**: mỗi 20 phút nhìn xa 20 giây; hạn chế xem màn hình giải trí."
        ],
        [
          "🪑",
          "Ngồi học lưng thẳng, vở/màn hình cách mắt vừa tầm."
        ]
      ],
      "luuY": "Dành 10 phút mỗi tối trò chuyện cùng bé — tâm trạng cũng là sức khoẻ."
    },
    "thuThach": [
      "Cả nhà ăn tối cùng nhau 5 ngày trong tuần",
      "Mỗi người uống thêm 1 cốc nước vào buổi sáng",
      "Cuối tuần cùng đi bộ hoặc đạp xe 30 phút"
    ]
  },
  "nl-binh-thuong": {
    "giaiThich": "Theo ngưỡng BMI dành cho người trưởng thành châu Á. BMI không phân biệt cơ và mỡ nên chỉ là mốc tham khảo.",
    "loiChao": "Chào **{ten}**! Chăm sóc bản thân cũng là chăm sóc cả nhà. Sata Robo gợi ý vài điều nhỏ nhé!",
    "anUong": {
      "tieuDe": "Giữ cân bằng mỗi ngày",
      "tomTat": "Chia đĩa ăn, đạm, nước, ít muối",
      "muc": [
        [
          "🥗",
          "Chia đĩa ăn: **½ rau và trái cây, ¼ đạm, ¼ tinh bột**; ưu tiên gạo lứt, khoai, ngũ cốc nguyên hạt."
        ],
        [
          "🐟",
          "Đạm từ cá, đậu, trứng, thịt nạc; cá ít nhất 2 bữa mỗi tuần."
        ],
        [
          "💧",
          "Uống khoảng **1,5–2 lít nước**/ngày, nhiều hơn khi trời nóng hoặc vận động."
        ],
        [
          "🧂",
          "Hạn chế đồ chiên, đồ ngọt, muối và nước chấm mặn."
        ]
      ],
      "luuY": "Nhu cầu năng lượng là ước tính tham khảo, tuỳ mức vận động từng ngày."
    },
    "vanDong": {
      "tieuDe": "Vận động cho người lớn",
      "tomTat": "150–300 phút/tuần + 2 buổi sức mạnh",
      "muc": [
        [
          "🚶",
          "Mục tiêu tham khảo: **150–300 phút/tuần** vận động vừa phải (đi bộ nhanh, đạp xe, bơi)."
        ],
        [
          "🏋️",
          "Thêm **2 buổi/tuần** tập sức mạnh: squat, plank, dây kháng lực."
        ],
        [
          "🪑",
          "Ngồi nhiều thì mỗi giờ đứng dậy đi lại vài phút."
        ]
      ],
      "tuan": [
        [
          "T2",
          "Đi bộ nhanh 30 phút"
        ],
        [
          "T3",
          "Tập sức mạnh 20 phút"
        ],
        [
          "T4",
          "Giãn cơ"
        ],
        [
          "T5",
          "Đạp xe 30 phút"
        ],
        [
          "T6",
          "Tập sức mạnh 20 phút"
        ],
        [
          "T7",
          "Cùng con đi chơi"
        ],
        [
          "CN",
          "Yoga nhẹ"
        ]
      ]
    },
    "nghiNgoi": {
      "tieuDe": "Nghỉ ngơi và tinh thần",
      "tomTat": "7–9 giờ ngủ, thư giãn, khám định kỳ",
      "muc": [
        [
          "🌙",
          "Người lớn thường cần **7–9 giờ ngủ** mỗi đêm."
        ],
        [
          "☕",
          "Giờ ngủ đều đặn; hạn chế cà phê chiều tối."
        ],
        [
          "🧘",
          "Vài phút thở sâu, thư giãn mỗi ngày để giảm căng thẳng."
        ],
        [
          "🩺",
          "Khám sức khoẻ định kỳ theo lời khuyên của bác sĩ."
        ]
      ],
      "luuY": "Chăm sóc bản thân cũng là chăm sóc cả nhà."
    },
    "thuThach": [
      "Ăn thêm 1 phần rau ở mỗi bữa chính",
      "Đi bộ nhanh 30 phút, 3 lần trong tuần",
      "Đi ngủ trước 23 giờ ít nhất 5 đêm"
    ]
  },
  "nl-nhe-can": {
    "giaiThich": "BMI dưới 18,5 theo ngưỡng châu Á là nhẹ cân. Nguyên nhân có thể rất khác nhau, nên nếu sụt cân không chủ ý hãy hỏi bác sĩ.",
    "loiChao": "Chào **{ten}**! Sata Robo gợi ý vài cách ăn đủ chất và tăng sức khoẻ nhẹ nhàng nhé!",
    "anUong": {
      "tieuDe": "Ăn đủ chất, tăng dần",
      "tomTat": "Bữa chính đủ đạm, bữa phụ lành mạnh",
      "muc": [
        [
          "🍳",
          "Ăn **3 bữa chính + 1–2 bữa phụ**: sữa chua, chuối, hạt, sữa, bánh mì trứng."
        ],
        [
          "🍗",
          "Mỗi bữa có đạm (cá, trứng, thịt, đậu) và tinh bột tốt; thêm một chút dầu ô-liu/lạc/mè."
        ],
        [
          "🥑",
          "Chọn món giàu năng lượng lành mạnh: bơ, các loại hạt, khoai lang."
        ],
        [
          "⏰",
          "Không bỏ bữa; ăn đúng giờ."
        ]
      ],
      "luuY": "Nếu sụt cân không chủ ý, chán ăn kéo dài hoặc mệt mỏi, nên đi khám để tìm nguyên nhân."
    },
    "vanDong": {
      "tieuDe": "Vận động giúp ăn ngon, có cơ",
      "tomTat": "Tập sức mạnh nhẹ, không quá sức",
      "muc": [
        [
          "💪",
          "Tập sức mạnh **2–3 buổi/tuần** giúp tăng cơ khoẻ mạnh."
        ],
        [
          "🚶",
          "Đi bộ nhẹ hằng ngày để ăn ngon miệng hơn."
        ],
        [
          "🛑",
          "Tránh tập quá sức khi chưa ăn đủ."
        ]
      ],
      "tuan": [
        [
          "T2",
          "Đi bộ 20 phút"
        ],
        [
          "T3",
          "Nghỉ"
        ],
        [
          "T4",
          "Đi bộ nhanh 30 phút"
        ],
        [
          "T5",
          "Tập sức mạnh nhẹ 15 phút"
        ],
        [
          "T6",
          "Nghỉ"
        ],
        [
          "T7",
          "Bơi / đạp xe"
        ],
        [
          "CN",
          "Đi bộ cùng cả nhà"
        ]
      ]
    },
    "nghiNgoi": {
      "tieuDe": "Nghỉ ngơi",
      "tomTat": "7–9 giờ ngủ, giảm căng thẳng",
      "muc": [
        [
          "🌙",
          "Ngủ đủ **7–9 giờ** giúp cơ thể phục hồi."
        ],
        [
          "🧘",
          "Căng thẳng kéo dài có thể làm giảm cảm giác thèm ăn — thử thư giãn mỗi ngày."
        ]
      ]
    },
    "thuThach": [
      "Thêm một bữa phụ lành mạnh mỗi ngày",
      "Tập sức mạnh nhẹ 2 buổi",
      "Ăn đúng giờ cả tuần"
    ]
  },
  "nl-can-chu-y": {
    "giaiThich": "Theo ngưỡng BMI châu Á, từ 23 trở lên là nên chú ý. Nên hỏi bác sĩ để biết chính xác tình trạng và mục tiêu phù hợp với riêng mình.",
    "loiChao": "Chào **{ten}**! Mình cùng đi từng bước nhỏ, đều đặn và bền vững nhé. Có bệnh nền thì nhớ hỏi bác sĩ trước!",
    "anUong": {
      "tieuDe": "Điều chỉnh từ từ, bền vững",
      "tomTat": "Khoảng 0,5 kg/tuần, bớt nước ngọt, không ăn khuya",
      "muc": [
        [
          "📉",
          "Nếu muốn giảm cân, giảm từ từ, khoảng **0,5 kg mỗi tuần** là mức thường được xem là an toàn — tránh ăn kiêng khắc nghiệt."
        ],
        [
          "🥤",
          "Giảm nước ngọt, bia rượu, đồ chiên; thay bằng nước lọc, trà không đường."
        ],
        [
          "🥦",
          "Thêm rau và đạm nạc để no lâu; ăn chậm, đúng giờ, hạn chế ăn khuya."
        ],
        [
          "🍚",
          "Bớt một phần cơm/bún mỗi bữa thay vì bỏ hẳn tinh bột."
        ]
      ],
      "luuY": "Nếu có tiểu đường, huyết áp, mỡ máu hoặc đang dùng thuốc, hãy hỏi bác sĩ trước khi đổi chế độ ăn."
    },
    "vanDong": {
      "tieuDe": "Bắt đầu nhẹ nhàng",
      "tomTat": "Đi bộ nhanh, tăng dần, tập sức mạnh nhẹ",
      "muc": [
        [
          "🚶",
          "Khởi động bằng **đi bộ nhanh 20–30 phút**, tăng dần lên 150 phút/tuần."
        ],
        [
          "💪",
          "Thêm 2 buổi tập sức mạnh nhẹ để giữ cơ."
        ],
        [
          "🏊",
          "Chọn môn ít chấn thương khớp: đi bộ, bơi, đạp xe."
        ]
      ],
      "tuan": [
        [
          "T2",
          "Đi bộ 20 phút"
        ],
        [
          "T3",
          "Nghỉ"
        ],
        [
          "T4",
          "Đi bộ nhanh 30 phút"
        ],
        [
          "T5",
          "Tập sức mạnh nhẹ 15 phút"
        ],
        [
          "T6",
          "Nghỉ"
        ],
        [
          "T7",
          "Bơi / đạp xe"
        ],
        [
          "CN",
          "Đi bộ cùng cả nhà"
        ]
      ]
    },
    "nghiNgoi": {
      "tieuDe": "Nghỉ ngơi",
      "tomTat": "7–9 giờ ngủ, giảm căng thẳng",
      "muc": [
        [
          "🌙",
          "Ngủ **7–9 giờ**; ngủ thiếu dễ làm thèm ăn."
        ],
        [
          "😮‍💨",
          "Nếu ngáy to, ngừng thở khi ngủ hoặc buồn ngủ ban ngày, nên khám chuyên khoa."
        ],
        [
          "🎵",
          "Giảm căng thẳng bằng đi bộ, nghe nhạc, trò chuyện cùng gia đình."
        ]
      ],
      "luuY": "Nên kiểm tra huyết áp, đường huyết và mỡ máu định kỳ."
    },
    "thuThach": [
      "Thay nước ngọt bằng nước lọc cả tuần",
      "Đi bộ 20 phút sau bữa tối, 4 lần",
      "Không ăn khuya trong 5 ngày"
    ]
  },
  "dac-biet": {
    "giaiThich": "Với người đang mang thai, cho con bú hoặc có bệnh nền, chỉ số BMI và các gợi ý chung có thể không phù hợp. Sata Robo chỉ đưa ra vài thói quen an toàn; mọi điều chỉnh nên theo bác sĩ.",
    "loiChao": "Chào **{ten}**! Sức khoẻ của bạn rất quan trọng. Hãy trao đổi với bác sĩ để có lời khuyên riêng nhé.",
    "anUong": {
      "tieuDe": "Ăn uống an toàn",
      "tomTat": "Đa dạng, đủ nước, hỏi bác sĩ về chế độ riêng",
      "muc": [
        [
          "🥗",
          "Ăn đa dạng, nhiều rau và trái cây, đạm từ nguồn sạch, nấu chín kỹ."
        ],
        [
          "💧",
          "Uống đủ nước trong ngày."
        ],
        [
          "🩺",
          "**Chế độ ăn riêng** (bổ sung vi chất, kiêng cữ) nên theo hướng dẫn của bác sĩ hoặc chuyên gia dinh dưỡng."
        ]
      ],
      "luuY": "Không tự ý ăn kiêng hay dùng thực phẩm chức năng khi chưa hỏi bác sĩ."
    },
    "vanDong": {
      "tieuDe": "Vận động nhẹ nhàng",
      "tomTat": "Chỉ khi bác sĩ cho phép",
      "muc": [
        [
          "🚶",
          "Đi bộ nhẹ, giãn cơ thường là lựa chọn dễ chịu — **hãy hỏi bác sĩ** về mức vận động phù hợp."
        ],
        [
          "🛑",
          "Dừng ngay và đi khám nếu thấy đau, chóng mặt, khó thở."
        ]
      ]
    },
    "nghiNgoi": {
      "tieuDe": "Nghỉ ngơi",
      "tomTat": "Ngủ đủ, thư giãn, khám định kỳ",
      "muc": [
        [
          "🌙",
          "Ngủ đủ giấc, ngủ trưa ngắn nếu mệt."
        ],
        [
          "🩺",
          "Khám và theo dõi định kỳ theo lịch của bác sĩ."
        ]
      ]
    },
    "thuThach": [
      "Uống đủ nước mỗi ngày",
      "Đi bộ nhẹ khi bác sĩ cho phép",
      "Ghi lại câu hỏi để hỏi bác sĩ"
    ]
  }
};
