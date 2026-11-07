// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc config/disc-loi-khuyen.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * TẦNG LỜI KHUYÊN — phần trả lời câu hỏi *"đọc xong rồi tôi phải làm gì?"*.
 *
 * 🔴 VÌ SAO FILE NÀY TỒN TẠI. Bản báo cáo cũ có bốn khối: trông như thế nào · điểm mạnh ·
 * chỗ cần để ý · ba câu hỏi. Không một trường nào chứa HÀNH ĐỘNG. Phụ huynh đọc xong biết
 * thêm về con nhưng không biết tối nay nên làm gì khác đi — và đó chính là chỗ bị chê
 * "chưa chạm".
 *
 * BA THỨ LÀM PHỤ HUYNH THẤY CHẠM, theo đúng thứ tự sức nặng:
 *  1. **Nhận ra** — "đúng là con tôi". Thuộc `BIEU_HIEN` ở `disc-bieu-hien.ts`.
 *  2. **Nhẹ lòng / lật khung** — "hoá ra không phải con hư, con đang quá tải". Đây là
 *     trường `khiCangThang` bên dưới, và là đòn bẩy mạnh nhất mà DISC làm được.
 *  3. **Biết làm gì tối nay** — trường `motViecToiNay`. ĐÚNG MỘT việc, không phải một danh
 *     sách. Danh sách mười việc thì không việc nào được làm.
 *
 * 🔴 BỐN LẰN RANH KHÔNG ĐƯỢC VƯỢT:
 *
 *  a. **"Cân bằng" nghĩa là LINH HOẠT TÌNH HUỐNG, không phải vá chỗ thiếu.** DISC không
 *     phải mô hình khuyết thiếu. Cặp `kyNangThem` (dạy con một kỹ năng dùng thêm) và
 *     `boMeChinh` (bố mẹ chỉnh cách mình nói) luôn đi cùng nhau — bỏ vế thứ hai là biến
 *     lời khuyên thành "sửa đứa trẻ", đúng thứ ADR-002 dựng ra để chặn.
 *
 *  b. **Nói CÁCH, cấm ĐOÁN (luật §9.2 số 5).** `cungHocTheNao` chỉ được nói cách tổ chức
 *     việc học cùng con. Tuyệt đối không đoán môn nào hợp, năng lực tới đâu, thi được hay
 *     không.
 *
 *  c. **Không nói bản chất (luật §9.2 số 1).** "có thiên hướng…", không phải "LÀ người…".
 *
 *  d. **Đúng người đọc.** `LOI_KHUYEN` viết cho NGƯỜI LỚN đọc về trẻ (bộ MN, QS).
 *     `TU_MINH` viết cho chính người làm bài (bộ TH, THCS, PH). Đây KHÔNG phải hai bản
 *     dịch của nhau — dùng nhầm là lặp lại đúng lỗi đã trả giá 27/08/2026, khi bộ THCS
 *     hiện tiêu đề "3 câu để tự hỏi mình" mà ruột là câu viết cho phụ huynh hỏi con.
 *
 * ⚠️ CHƯA CÓ NGƯỜI CHUYÊN MÔN TÂM LÝ/GIÁO DỤC KÝ DUYỆT. Xem mục CHỜ NGOÀI trong CLAUDE.md.
 *
 * Thuộc TẦNG LÕI (ADR-004): chuỗi thuần, không React, không DOM.
 */

import type { MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

/* ── Lời khuyên cho NGƯỜI LỚN đọc về trẻ (bộ MN, QS) ─────────────────────── */

export type KhoiLoiKhuyen = {
  /** Cách nói để lời nói tới được. */
  readonly noiTheNao: string;
  /** 🔴 Câu NGUYÊN VĂN. Phụ huynh nhận ra chính câu mình đã nói hỏng — đó là chỗ chạm. */
  readonly cauNenNoi: readonly [string, string, string];
  readonly cauNenTranh: readonly [string, string, string];
  /** 🔴 Lật khung "con hư" thành "con đang quá tải". Đòn bẩy cảm xúc mạnh nhất. */
  readonly khiCangThang: string;
  /** Vế 1 của linh hoạt tình huống: kỹ năng dạy CON dùng thêm. */
  readonly kyNangThem: string;
  /** 🔴 Vế 2, bắt buộc đi cùng: điều BỐ MẸ tự chỉnh. Bỏ vế này là quay về "sửa đứa trẻ". */
  readonly boMeChinh: string;
  /** Chỉ CÁCH tổ chức việc học. Cấm đoán môn, đoán năng lực (luật §9.2 số 5). */
  readonly cungHocTheNao: string;
  /** 🔴 ĐÚNG MỘT việc, làm được ngay tối nay. */
  readonly motViecToiNay: string;
};

export const LOI_KHUYEN: Readonly<Record<MaTruc, KhoiLoiKhuyen>> = {
  D: {
    noiTheNao:
      "Nói ngắn, vào thẳng việc, và chừa cho {chuThe} một khoảng được tự quyết. Giải thích dài dòng trước khi vào việc thường bị {chuThe} nghe thành cản đường.",
    cauNenNoi: [
      "“Việc này {chuThe} muốn làm cách nào?”",
      "“{ChuThe} chọn một trong hai cách này nhé.”",
      "“Chỗ này {chuThe} tự quyết được.”",
    ],
    cauNenTranh: [
      "“Không được cãi, người lớn nói sao thì nghe vậy.”",
      "“Để đấy, làm không nổi đâu.”",
      "“Sao lúc nào cũng phải theo ý {chuThe}?”",
    ],
    khiCangThang:
      "Quá tải thì {chuThe} không rút lui mà đẩy tới: to tiếng, cãi lại, đòi làm cho bằng được. Nhìn từ ngoài rất dễ đọc thành hỗn. Thứ giúp được không phải là áp đảo lại, mà là bớt số việc đang tranh nhau và trả cho {chuThe} một chỗ được tự quyết.",
    kyNangThem:
      "Tập hỏi lại một câu trước khi chốt — “ý bạn thế nào?”. Không phải để {chuThe} bớt quyết đoán, mà để phần quyết đoán đó không làm người khác rụt lại.",
    boMeChinh:
      "Ra yêu cầu gọn, và cho hai lựa chọn thay vì một mệnh lệnh. Vẫn là việc đó, nhưng cách nói này giảm hẳn số lần va nhau.",
    cungHocTheNao:
      "Chia việc thành từng chặng ngắn và để {chuThe} tự gạch chỗ đã xong. {ChuThe} cần thấy mình đang tiến, và cần được tự chọn thứ tự làm.",
    motViecToiNay:
      "Tối nay giao cho {chuThe} một việc trong nhà mà {chuThe} được tự quyết cách làm, rồi không góp ý cho tới khi {chuThe} làm xong.",
  },
  I: {
    noiTheNao:
      "Nghe hết câu chuyện đã, rồi mới tới phần việc. Cắt ngang lúc {chuThe} đang kể thì phần việc nói sau đó cũng không vào được.",
    cauNenNoi: [
      "“Kể tiếp đi, rồi sao nữa?”",
      "“Chỗ này {chuThe} làm hay lắm, hay ở chỗ…”",
      "“Mình cùng làm phần này nhé?”",
    ],
    cauNenTranh: [
      "“Nói ít thôi, làm đi.”",
      "“Suốt ngày chỉ thấy bạn bè.”",
      "“Có thế mà cũng khoe.”",
    ],
    khiCangThang:
      "Quá tải thì {chuThe} nói nhiều hơn hẳn bình thường, hoặc đột nhiên im bặt nếu bị chê trước mặt người khác. Một lời chê nơi đông người ở lại rất lâu. Thứ giúp được là nói riêng, và nói rõ rằng việc chưa xong không có nghĩa là {chuThe} không được quý.",
    kyNangThem:
      "Tập ghi lại việc đã nhận thay vì nhớ trong đầu. {ChuThe} nhận lời nhanh vì thật lòng muốn giúp — chỗ vỡ nằm ở lúc quên, không nằm ở thiện chí.",
    boMeChinh:
      "Khen vào việc cụ thể chứ đừng khen chung chung, và tránh chê {chuThe} trước mặt người khác. Cùng một câu, nói riêng thì thành góp ý, nói giữa đám đông thì thành vết.",
    cungHocTheNao:
      "Cho {chuThe} nói lại điều vừa làm bằng lời của mình, hoặc giảng lại cho người khác nghe. {ChuThe} nhớ bằng cách kể ra, không nhớ bằng cách ngồi im.",
    motViecToiNay:
      "Tối nay dành mười phút chỉ để nghe {chuThe} kể chuyện — không xen vào, không lái sang chuyện bài vở.",
  },
  S: {
    noiTheNao:
      "Báo trước và cho thời gian. {ChuThe} không phản đối thay đổi, {chuThe} chỉ cần biết trước để kịp chuẩn bị.",
    cauNenNoi: [
      "“Mười lăm phút nữa mình chuyển sang việc khác nhé.”",
      "“{ChuThe} thấy thế nào? Cứ nói thật, không sao đâu.”",
      "“Việc này {chuThe} làm đều lắm, người khác khó theo được.”",
    ],
    cauNenTranh: [
      "“Nhanh lên, có thế mà cũng lâu.”",
      "“Đổi ngay bây giờ, không bàn nữa.”",
      "“{ChuThe} thì ý kiến gì.”",
    ],
    khiCangThang:
      "Quá tải thì {chuThe} thường không cãi mà im lặng rút đi, hoặc gật cho xong rồi giữ ấm ức lại. Nhìn từ ngoài rất dễ đọc thành giận dỗi hoặc lì. Thực ra đó là dấu hiệu {chuThe} đang cần một quãng yên và một lời hỏi riêng.",
    kyNangThem:
      "Tập nói ra điều mình muốn ngay lúc chuyện còn nhỏ, thay vì để dồn. Nhường là một thế mạnh thật, nhưng nhường mà không ai biết thì phần thiệt không ai bù.",
    boMeChinh:
      "Báo trước mọi thay đổi lịch, và hỏi ý {chuThe} bằng câu hỏi mở chứ đừng hỏi “có được không” — {chuThe} sẽ gật cho xong chuyện.",
    cungHocTheNao:
      "Giữ đúng một khung giờ và một chỗ ngồi quen. {ChuThe} vào việc chậm nhưng làm rất bền, nên thứ phá nhịp nhất là đổi giờ đổi chỗ liên tục.",
    motViecToiNay:
      "Tối nay hỏi {chuThe} một câu rồi chờ đủ lâu để {chuThe} trả lời — im lặng vài giây không có nghĩa là {chuThe} không có gì để nói.",
  },
  C: {
    noiTheNao:
      "Nói rõ lý do và tiêu chuẩn. {ChuThe} làm theo dễ hơn hẳn khi hiểu vì sao phải làm thế, và khựng lại khi bị yêu cầu mà không có lý do.",
    cauNenNoi: [
      "“Chỗ này {chuThe} thấy chưa ổn ở đâu?”",
      "“Làm đến mức này là đủ rồi, mình dừng ở đây.”",
      "“{ChuThe} hỏi tiếp đi, hỏi thế là đúng chỗ.”",
    ],
    cauNenTranh: [
      "“Sao cứ hỏi mãi thế, cứ làm đi.”",
      "“Có gì đâu mà phải kỹ thế.”",
      "“Sai có tí mà cũng làm lại từ đầu.”",
    ],
    khiCangThang:
      "Quá tải thì {chuThe} làm đi làm lại một chỗ, hoặc dừng hẳn vì sợ làm sai. Nhìn từ ngoài rất dễ đọc thành chậm chạp hay lười. Thực ra {chuThe} đang mắc ở chỗ chưa đủ chắc — thứ giúp được là nói rõ “đến mức này là đủ”, chứ không phải giục nhanh lên.",
    kyNangThem:
      "Tập chấp nhận một bản “đủ dùng” rồi sửa dần, thay vì chờ đúng ngay từ lần đầu. Kỹ lưỡng là thế mạnh, nhưng nó chỉ thành kết quả khi có thứ để đưa ra.",
    boMeChinh:
      "Nói trước tiêu chuẩn “thế nào là xong”, rồi giữ đúng tiêu chuẩn đó. {ChuThe} không cần bị hạ chuẩn, {chuThe} cần biết vạch đích nằm ở đâu.",
    cungHocTheNao:
      "Cho {chuThe} biết trước yêu cầu và cách soát, rồi để {chuThe} tự soát. Việc giao mập mờ làm {chuThe} tốn gấp đôi thời gian vì phải đoán.",
    motViecToiNay:
      "Tối nay chọn một việc và nói trước với {chuThe} rằng “làm đến mức này là đủ”, rồi giữ đúng lời khi {chuThe} muốn làm thêm.",
  },
};

/* ── Bản tự đọc, cho chính người làm bài (bộ TH, THCS, PH) ──────────────── */

/**
 * 🔴 KHÔNG PHẢI BẢN DỊCH CỦA `LOI_KHUYEN`.
 *
 * Người đọc ở đây là chính người vừa làm bài — một học sinh lớp 5, lớp 9, hoặc một phụ
 * huynh tự đánh giá. Bê nguyên câu viết cho bố mẹ sang rồi chỉ đổi tiêu đề là đúng lỗi đã
 * trả giá 27/08/2026. Ngắn hơn có chủ đích: người tự đọc cần một điều để thử, không cần
 * một giáo án về chính mình.
 */
export type KhoiTuMinh = {
  readonly khiCangThang: string;
  readonly tapThem: string;
  readonly motViecToiNay: string;
};

export const TU_MINH: Readonly<Record<MaTruc, KhoiTuMinh>> = {
  D: {
    khiCangThang:
      "Lúc quá tải, {chuThe} thường đẩy tới chứ không lùi lại: nói to hơn, muốn giải quyết cho xong ngay. Nhận ra sớm thì tách ra vài phút rồi hãy nói tiếp.",
    tapThem:
      "Hỏi lại một câu trước khi chốt. Chỉ một câu thôi cũng đủ để người nghĩ chậm hơn kịp vào chuyện.",
    motViecToiNay:
      "Hôm nay chọn một việc và để người khác quyết cách làm, kể cả khi {chuThe} thấy cách của mình nhanh hơn.",
  },
  I: {
    khiCangThang:
      "Lúc quá tải, {chuThe} nói nhiều hơn bình thường, hoặc hụt hẳn đi nếu bị chê trước mặt người khác. Cảm giác đó là thật, nhưng nó không đo đúng giá trị của {chuThe}.",
    tapThem:
      "Ghi lại việc đã nhận thay vì nhớ trong đầu. Chỗ vỡ thường nằm ở lúc quên, không nằm ở thiện chí.",
    motViecToiNay: "Hôm nay làm xong một việc đang dở trước khi bắt đầu việc mới.",
  },
  S: {
    khiCangThang:
      "Lúc quá tải, {chuThe} hay im lặng rút đi hoặc gật cho xong rồi giữ ấm ức lại. Điều đó khiến người khác tưởng {chuThe} đã đồng ý.",
    tapThem:
      "Nói ra điều mình muốn lúc chuyện còn nhỏ, đừng để dồn. Nhường mà không ai biết thì phần thiệt không ai bù.",
    motViecToiNay: "Hôm nay nói ra một điều {chuThe} vẫn định để sau.",
  },
  C: {
    khiCangThang:
      "Lúc quá tải, {chuThe} làm đi làm lại một chỗ hoặc dừng hẳn vì sợ sai. Đó là dấu hiệu cần một vạch đích rõ hơn, không phải dấu hiệu {chuThe} kém.",
    tapThem:
      "Chấp nhận một bản đủ dùng rồi sửa dần. Kỹ lưỡng chỉ thành kết quả khi có thứ để đưa ra.",
    motViecToiNay:
      "Hôm nay chọn một việc và tự chốt trước “đến mức này là đủ”, rồi dừng đúng ở đó.",
  },
};

/* ── Điều đang băn khoăn — một chạm ở màn kết quả ────────────────────────── */

export const MA_BAN_KHOAN = [
  "hay-cau",
  "ngai-giao-tiep",
  "le-me",
  "buong",
  "chi-to-mo",
] as const;
export type MaBanKhoan = (typeof MA_BAN_KHOAN)[number];

/**
 * 🔴 GIỌNG BẮT BUỘC: *"phong cách của con liên quan thế nào tới chuyện này"*.
 * TUYỆT ĐỐI KHÔNG: *"vì sao con bị như vậy"*. Bộ câu hỏi này đo thiên hướng hành vi, nó
 * không chẩn đoán gì hết — và một phụ huynh đang lo thì rất dễ đọc bất kỳ câu nào thành
 * chẩn đoán. Nên mỗi `loiMoDau` phải tự nói ra giới hạn của nó TRƯỚC khi nói phần có ích.
 */
type KhoiBanKhoan = {
  readonly nhan: string;
  /** Trục liên quan nhất — dùng để đưa phần đó lên trước, KHÔNG dùng để kết luận. */
  readonly trucLienQuan: readonly MaTruc[];
  readonly loiMoDau: string;
};

export const BAN_KHOAN: Readonly<Record<MaBanKhoan, KhoiBanKhoan>> = {
  "hay-cau": {
    nhan: "Hay cáu, hay ăn vạ",
    trucLienQuan: ["D", "I"],
    loiMoDau:
      "Kết quả này không giải thích vì sao {chuThe} hay cáu — nó không đo được chuyện đó. Nhưng nó cho biết {chuThe} thường phản ứng thế nào khi quá tải, và kiểu nói nào làm chuyện dịu xuống nhanh hơn.",
  },
  "ngai-giao-tiep": {
    nhan: "Ngại giao tiếp, ít nói",
    trucLienQuan: ["I", "S"],
    loiMoDau:
      "Kết quả này không kết luận {chuThe} nhút nhát — ít nói và ngại là hai chuyện khác nhau. Nhưng nó cho biết {chuThe} lấy lại sức ở đâu, và chỗ đông người lạ tốn của {chuThe} bao nhiêu.",
  },
  "le-me": {
    nhan: "Lề mề, làm gì cũng chậm",
    trucLienQuan: ["S", "C"],
    loiMoDau:
      "Kết quả này không đo nhanh hay chậm. Nhưng nó cho biết {chuThe} cần gì để vào được việc — và vì sao giục thường làm chậm thêm chứ không nhanh lên.",
  },
  buong: {
    nhan: "Bướng, không chịu nghe lời",
    trucLienQuan: ["D", "C"],
    loiMoDau:
      "Kết quả này không phán xét chuyện nghe lời. Nhưng nó cho biết {chuThe} cần khoảng tự quyết tới đâu, và kiểu yêu cầu nào thì {chuThe} nhận được.",
  },
  "chi-to-mo": {
    nhan: "Chưa có gì cụ thể, chỉ muốn hiểu thêm",
    trucLienQuan: [],
    loiMoDau:
      "Không có băn khoăn cụ thể nào thì cứ đọc theo thứ tự bên dưới — bắt đầu từ nhóm nổi nhất của {chuThe}.",
  },
};

/* ── Lệch phong cách BỐ MẸ ↔ CON ─────────────────────────────────────────── */

/**
 * 🔴 KHÁC với vùng lệch ở `disc-doi-chieu.ts`. Vùng lệch cũ so *con tự thấy* với *bố mẹ
 * nhìn con* — cùng một đứa trẻ, hai góc nhìn. Bảng này so PHONG CÁCH CỦA BỐ MẸ (bộ PH)
 * với phong cách của con: hai người khác nhau, và chỗ vênh giữa họ là chỗ va nhau hằng
 * ngày trong nhà.
 *
 * Đây là thứ chạm cảm xúc nhất mà DISC làm được — *"bố mẹ nhóm D, con nhóm S: bố mẹ thấy
 * con chậm chạp, con thấy mình bị hối"* — và hạ tầng đã dựng sẵn từ GĐ5 nhưng đang bỏ không.
 *
 * 🔴 GĐ10 CHẶNG 2 — MỘT CHỖ VÊNH, BỐN CÁCH KỂ, MỖI CÁCH MỘT NGƯỜI ĐỌC.
 * Bản cũ chỉ có một đoạn viết cho bố mẹ. Nhưng chỗ vênh này có HAI người sống trong nó, và
 * đứa trẻ trước giờ không được nói gì cả — nó chỉ được nhận xét. Bốn trường dưới đây tách
 * theo người đọc chứ không tách theo chủ đề:
 *   `choBoMe`    — bố mẹ đọc về CON. Đây là bản cũ, giữ nguyên chữ.
 *   `choCon`     — chính đứa trẻ đọc về chỗ vênh, bằng đại từ của bộ đề nó vừa làm.
 *   `boMeTuNhin` — bố mẹ đọc về CHÍNH MÌNH. Không một chữ nào nhận xét đứa trẻ. **GÓI B.**
 *   `thoaThuan`  — việc CẢ HAI cùng làm. Nằm ở dải chung, nên cả hai đều đọc được.
 *
 * ⚠️ MIỄN TRỪ CÓ CHỦ ĐÍCH khỏi luật cấm gõ cứng đại từ, cùng khuôn với `cauRaoTre` — nhưng
 * chỉ cho BA trường viết cho/về người lớn (`choBoMe`, `boMeTuNhin`, `thoaThuan`): ở đó "bạn"
 * = bố mẹ đang đọc, "con" = đứa trẻ, và cả hai nghĩa đều cố định.
 * 🔴 `choCon` KHÔNG được miễn trừ: người đọc nó là em học sinh, nên nó phải dùng
 * `{chuThe}`/`{ChuThe}` và đi qua `thayChuThe`. Gõ cứng "con" vào đó là lặp lại đúng lỗi
 * đã trả giá 27/08/2026 — bê chữ viết cho phụ huynh sang cho người khác đọc.
 */
export type HuongLechPhongCach = "bo-me-cao-hon" | "bo-me-thap-hon";

export type KhoiLechPhongCach = {
  /** Bố mẹ đọc về con. Bản có từ GĐ9. */
  readonly choBoMe: string;
  /** 🔴 Chính đứa trẻ đọc. Dùng `{chuThe}`, KHÔNG gõ cứng đại từ. */
  readonly choCon: string;
  /** 🔴 GÓI B — bố mẹ đọc về CHÍNH MÌNH, không nhận xét đứa trẻ. */
  readonly boMeTuNhin: string;
  /** Việc cả hai cùng làm, có thời hạn và có cách nhìn lại. */
  readonly thoaThuan: string;
};

export const LECH_PHONG_CACH: Readonly<
  Record<MaTruc, Readonly<Record<HuongLechPhongCach, KhoiLechPhongCach>>>
> = {
  D: {
    "bo-me-cao-hon": {
      choBoMe:
        "Bạn chủ động và quyết nhanh hơn con khá nhiều. Trong nhà, điều đó dễ thành: bạn quyết xong rồi mới thấy con chưa kịp có ý kiến. Thử lùi một nhịp và hỏi trước khi chốt — không phải để chiều, mà để con tập nói ra ý mình.",
      choCon:
        "Bố mẹ quyết nhanh và thích bắt tay vào việc ngay, còn {chuThe} cần thêm một nhịp để nghĩ. Đó không phải chậm — hai người đang chạy hai tốc độ khác nhau. Lúc thấy bị hối, thử nói thành lời: “Con cần thêm một phút ạ.” Câu đó ngắn nhưng nó cho bố mẹ biết {chuThe} đang nghĩ, chứ không phải đang lờ đi. Dấu hiệu nó có tác dụng: bố mẹ bắt đầu hỏi lại {chuThe} trước khi chốt, thay vì báo cho {chuThe} biết sau khi đã quyết xong.",
      boMeTuNhin:
        "Nhìn về phía bạn: quyết nhanh là một thế mạnh thật, nó giữ cho mọi việc chạy được. Cái giá đi kèm là bạn thường chốt xong trước khi kịp nghe hết. Ở nơi làm việc điều đó tiết kiệm thời gian; ở nhà, nó khiến người bên cạnh dần thôi không nói nữa — không phải vì họ đồng ý, mà vì họ thấy nói cũng không kịp. Việc thử được ngay: hôm nay chọn một quyết định nhỏ và hỏi con nghĩ gì trước khi bạn nói ý mình. Hỏi trước, không phải hỏi để xác nhận.",
      thoaThuan:
        "Thử trong hai tuần: bố mẹ đếm đến ba trước khi chốt một việc có liên quan tới con; con nói ra ý mình ngay trong lúc đó, kể cả khi chưa nghĩ xong hẳn. Hết hai tuần, mỗi người kể một lần thấy cách này dễ chịu hơn và một lần thấy khó.",
    },
    "bo-me-thap-hon": {
      choBoMe:
        "Con chủ động và quyết nhanh hơn bạn. Điều đó rất dễ bị đọc thành bướng, trong khi thực ra con đang muốn tự làm. Chừa cho con một khoảng được tự quyết thường hạ căng thẳng nhanh hơn là siết lại.",
      choCon:
        "{ChuThe} quyết nhanh và muốn tự xoay hơn bố mẹ. Điều đó hay bị đọc thành bướng, dù thật ra {chuThe} chỉ đang muốn tự làm lấy. Cách đỡ mất sức nhất là nói trước ý định thay vì làm rồi mới báo: “Con định làm thế này, bố mẹ thấy sao ạ?” Nói trước thường mở được nhiều cửa hơn hẳn là làm trước. Dấu hiệu nó có tác dụng: bố mẹ bớt hỏi lại từng bước, và số việc {chuThe} được tự quyết nhiều dần lên.",
      boMeTuNhin:
        "Nhìn về phía bạn: bạn cân nhắc kỹ và không vội chốt, nên bạn ít khi quyết hỏng. Cái giá đi kèm là khi có người bên cạnh quyết nhanh hơn, bạn dễ thấy mình bị đẩy, rồi phản ứng bằng cách siết lại. Siết hiếm khi đổi được tốc độ của người kia — nó chỉ chuyển một cuộc bàn bạc thành một cuộc giằng co. Việc thử được ngay: chọn một việc bạn vẫn quen kiểm cho chắc, và tuần này để con tự làm trọn, kể cả khi cách của con vòng hơn cách của bạn.",
      thoaThuan:
        "Thử trong hai tuần: con báo trước ý định trước khi bắt tay vào; bố mẹ trả lời ngay trong ngày thay vì để treo đó. Chốt sẵn một danh sách ngắn những việc con được tự quyết mà không cần hỏi — có danh sách thì cả hai hết phải đoán ranh giới nằm ở đâu.",
    },
  },
  I: {
    "bo-me-cao-hon": {
      choBoMe:
        "Bạn cởi mở và bắt chuyện dễ hơn con. Chỗ va nhau thường là lúc bạn muốn con chào hỏi, kể chuyện, hoà vào chỗ đông người — còn con thì đang cần thêm thời gian. Giới thiệu trước rồi đứng cạnh vài phút giúp nhiều hơn là giục.",
      choCon:
        "Bố mẹ bắt chuyện và hoà vào chỗ đông người dễ hơn {chuThe}. Chỗ {chuThe} hay thấy mệt là lúc bị đẩy ra chào hỏi khi chưa sẵn sàng. {ChuThe} không cần thành một người khác — chỉ cần cho bố mẹ biết {chuThe} cần mấy phút. Một câu “Con đứng đây một lát rồi con ra” thường là đủ. Dấu hiệu nó có tác dụng: bố mẹ bắt đầu chờ {chuThe} thay vì đẩy, và chỗ đông người bớt thành chỗ {chuThe} phải gồng.",
      boMeTuNhin:
        "Nhìn về phía bạn: bạn kết nối nhanh và làm không khí quanh mình dễ chịu, đó là thứ nhiều người phải học mãi mới có. Cái giá đi kèm là bạn dễ đọc sự im lặng của người khác thành có chuyện, rồi lấp nó bằng lời. Có những khoảng im lặng không cần lấp — đó là cách người bên cạnh nạp lại sức. Việc thử được ngay: lần tới con im lặng, hãy để yên trọn một phút trước khi bạn nói gì. Một phút dài hơn bạn tưởng, và thường là đủ.",
      thoaThuan:
        "Thử cách này: đến chỗ đông người, bố mẹ giới thiệu con một lần rồi đứng cạnh năm phút và không giục thêm; đổi lại, mỗi tuần con nhận một việc nhỏ có nói chuyện với người lạ, do chính con chọn. Cả hai cùng ghi lại lần nào hoá ra dễ hơn mình tưởng.",
    },
    "bo-me-thap-hon": {
      choBoMe:
        "Con cần được nói và được chú ý nhiều hơn bạn. Cái bạn thấy là ồn thì với con là cách kết nối. Mười phút ngồi nghe con kể mà không xen vào thường đủ để phần còn lại của buổi tối dễ hơn hẳn.",
      choCon:
        "{ChuThe} cần được nói và được để ý nhiều hơn bố mẹ. Khi bố mẹ im hoặc trả lời cụt, rất dễ tưởng là bố mẹ không quan tâm — thường thì không phải vậy, bố mẹ chỉ ít lời hơn {chuThe} thôi. Nếu muốn được nghe, thử nói thẳng ra: “Con kể chuyện này một lát nhé.” Rõ ràng như vậy dễ hơn là ngồi chờ được hỏi. Dấu hiệu nó có tác dụng: bố mẹ hỏi lại về chuyện {chuThe} kể hôm trước — nghĩa là bố mẹ có nghe thật, chỉ là không nói nhiều.",
      boMeTuNhin:
        "Nhìn về phía bạn: bạn ít lời và không cần nhiều sự chú ý, nên bạn giữ được sự tập trung mà nhiều người quanh bạn không có. Cái giá đi kèm là con bạn có thể đang đọc sự yên lặng đó thành “bố mẹ không muốn nghe”. Mười phút ngồi nghe mà không xen vào có sức nặng khác hẳn một tiếng “ừ” cho xong chuyện. Việc thử được ngay: tối nay hỏi con một câu về chuyện của con rồi ngồi nghe hết, không sửa và không rút ra bài học nào.",
      thoaThuan:
        "Thử cách này: mỗi tối mười phút con được kể, bố mẹ không cắt ngang và không sửa; đổi lại, ngoài mười phút đó con để bố mẹ có khoảng yên của mình. Đặt giờ hẳn hoi — có mốc thì cả hai đều biết lúc nào đến lượt mình, và không ai phải tranh.",
    },
  },
  S: {
    "bo-me-cao-hon": {
      choBoMe:
        "Bạn điềm đạm và chịu được nhịp chậm hơn con. Chỗ va nhau thường là lúc con muốn đổi, muốn nhanh, còn bạn muốn giữ nếp. Nói rõ đâu là chỗ đổi được, đâu là chỗ giữ, sẽ đỡ hơn là cản chung chung.",
      choCon:
        "Bố mẹ chịu được nhịp chậm và thích giữ nếp hơn {chuThe}. Khi {chuThe} muốn đổi, muốn thử cái mới, bố mẹ hay phanh lại — không phải để cấm, mà vì đổi đột ngột làm bố mẹ mất chỗ bám. Nói trước sẽ đổi cái gì và đổi tới đâu thường được đồng ý nhanh hơn nhiều so với đổi rồi mới nói. Dấu hiệu nó có tác dụng: bố mẹ trả lời nhanh hơn với những việc {chuThe} báo trước, và bớt dần câu “để tính sau”.",
      boMeTuNhin:
        "Nhìn về phía bạn: bạn giữ được một nhịp ổn định, và chính nhịp đó làm một đứa trẻ thấy nhà là chỗ an toàn. Cái giá đi kèm là bạn dễ đọc mọi đề nghị thay đổi thành rủi ro phải cân nhắc. Có những thay đổi nhỏ không đáng cân nhắc lâu — cân nhắc lâu quá thì lần sau người ta thôi không đề nghị nữa. Việc thử được ngay: tuần này nhận lời một đề nghị đổi mà bình thường bạn sẽ cân nhắc thêm vài hôm. Chọn một việc nhỏ, và đồng ý ngay trong ngày.",
      thoaThuan:
        "Thử cách này: con nói trước ít nhất một ngày với việc muốn đổi; bố mẹ trả lời có hoặc không kèm đúng một lý do, không để lửng. Chia sẵn thành hai nhóm — chỗ nào đổi được, chỗ nào là nếp giữ nguyên. Biết ranh giới rồi thì hết phải thử lại từng lần một.",
    },
    "bo-me-thap-hon": {
      choBoMe:
        "Con cần nếp quen và cần được báo trước nhiều hơn bạn. Việc bạn thấy là linh hoạt thì với con là mất chỗ bám. Báo trước mười lăm phút là việc rất nhỏ nhưng đổi hẳn cách buổi tối diễn ra.",
      choCon:
        "{ChuThe} cần nếp quen và cần được báo trước nhiều hơn bố mẹ. Bố mẹ đổi kế hoạch nhanh không phải vì coi nhẹ {chuThe}, mà vì với bố mẹ việc đó nhẹ thật. Nếu bị đổi đột ngột làm {chuThe} khó chịu, hãy nói ra bằng một con số: “Con cần biết trước mười lăm phút ạ.” Con số dễ làm theo hơn là một cảm giác. Dấu hiệu nó có tác dụng: {chuThe} biết trước buổi tối sẽ diễn ra thế nào, và bớt hẳn cảm giác bị hẫng giữa chừng.",
      boMeTuNhin:
        "Nhìn về phía bạn: bạn xoay nhanh và không bị kẹt khi kế hoạch đổi, đó là một sức bền thật sự. Cái giá đi kèm là bạn dễ quên rằng người bên cạnh cần thời gian để chuyển. Với bạn, đổi kế hoạch là chuyện nhỏ; với con, mỗi lần đổi là một lần phải dựng lại toàn bộ hình dung về buổi tối. Việc thử được ngay: lần đổi kế hoạch gần nhất, hãy nói trước cho con mười lăm phút — kể cả khi với bạn việc đó chẳng đáng phải báo.",
      thoaThuan:
        "Thử cách này: bố mẹ báo trước mười lăm phút mỗi khi đổi việc đang làm; đổi lại, mỗi tuần con nhận một lần đổi bất ngờ mà không phản ứng ngay, coi như tập. Ghi lại tuần đó báo trước được mấy lần — con số nói rõ hơn cảm giác của cả hai bên.",
    },
  },
  C: {
    "bo-me-cao-hon": {
      choBoMe:
        "Bạn kỹ lưỡng và cần chắc chắn hơn con. Chỗ va nhau thường là lúc bạn thấy chưa đủ chuẩn còn con thấy đã xong rồi. Nói trước “thế nào là xong” giúp cả hai đỡ phải tranh nhau ở phút cuối.",
      choCon:
        "Bố mẹ kỹ và cần chắc chắn hơn {chuThe}. Chỗ hay va nhau là lúc {chuThe} thấy đã xong rồi còn bố mẹ thấy chưa đủ. Cách đỡ mất công nhất là hỏi ngay từ đầu: “Thế nào là xong ạ?” Biết vạch đích trước khi bắt tay vào thì đỡ phải làm lại, và cũng đỡ phải cãi nhau ở phút cuối. Dấu hiệu nó có tác dụng: {chuThe} biết trước làm tới đâu là xong, nên bớt phải làm lại và bớt phải đoán ý bố mẹ.",
      boMeTuNhin:
        "Nhìn về phía bạn: bạn làm gì cũng chắc, hiếm khi phải quay lại sửa. Cái giá đi kèm là cái chuẩn ấy nằm trong đầu bạn, còn người khác thì không đọc được nó. Khi chuẩn không được nói thành lời, đứa trẻ không học được cách làm cho tốt hơn — nó chỉ học được rằng làm gì rồi cũng sẽ chưa đủ. Việc thử được ngay: hôm nay nói ra một lần “thế là được rồi” với một việc con làm, và không thêm bất cứ nhận xét nào phía sau câu đó.",
      thoaThuan:
        "Thử cách này: trước mỗi việc chung, bố mẹ nói ra “xong nghĩa là thế nào” bằng đúng một câu; con làm tới đúng mức đó rồi mới hỏi có cần thêm gì không. Trong hai tuần, bố mẹ chọn ít nhất ba lần nói “thế là được rồi” và dừng lại thật ở đó.",
    },
    "bo-me-thap-hon": {
      choBoMe:
        "Con kỹ lưỡng và cần chắc chắn hơn bạn. Cái bạn thấy là chậm hoặc cầu toàn thì với con là chưa yên tâm. Cho con biết vạch đích nằm ở đâu thường hiệu quả hơn là giục nhanh lên.",
      choCon:
        "{ChuThe} kỹ và cần chắc chắn hơn bố mẹ. Khi bố mẹ bảo “thế được rồi”, {chuThe} dễ thấy chưa yên tâm — cảm giác đó có lý của nó. Nhưng {chuThe} cũng nên tự đặt cho mình một mức: tới đâu thì dừng. Không có mức đó thì việc gì cũng kéo dài ra, và {chuThe} mệt trước khi kịp làm xong. Dấu hiệu nó có tác dụng: {chuThe} dừng lại được mà không thấy áy náy, vì đã biết trước mức nào là đủ.",
      boMeTuNhin:
        "Nhìn về phía bạn: bạn quyết nhanh và không sa vào tiểu tiết, nhờ vậy việc chạy được. Cái giá đi kèm là bạn dễ đọc sự cẩn thận của con thành chậm chạp hoặc cầu toàn. Thường thì con không chậm — con đang chưa biết đâu là đủ, và câu “nhanh lên” không trả lời được điều đó. Việc thử được ngay: thay một câu “nhanh lên” bằng một câu tả rõ vạch đích — làm tới đâu, xong lúc mấy giờ, thế nào là đạt.",
      thoaThuan:
        "Thử cách này: bố mẹ cho con biết vạch đích cụ thể thay vì giục nhanh lên; đổi lại, con tự chốt trước một mốc thời gian và dừng đúng ở đó, kể cả khi thấy chưa hoàn hảo. Cuối tuần cùng soi lại một việc đã dừng đúng hạn, xem thật ra có sao không.",
    },
  },
};

/**
 * 🔴 HAI GÓI KÝ DUYỆT, TÁCH RỜI CÓ CHỦ ĐÍCH.
 *
 * Không phải để cho gọn hồ sơ. Hai gói này đòi hai mức trách nhiệm khác nhau ở người ký:
 * mô tả hành vi một đứa trẻ và đưa lời khuyên nuôi dạy là một việc; đưa phản hồi tính cách
 * cho một NGƯỜI LỚN về chính họ lại gần tham vấn hơn hẳn. Gộp chung một tệp thì người ký
 * hoặc phải nhận cả hai mức, hoặc từ chối cả hai — và thường họ sẽ từ chối cả hai.
 *
 * Gói A chặn ngày ra người dùng thật. Gói B chỉ chặn phần nội dung của chính nó: chưa ký
 * được gói B thì vẫn phát hành được sản phẩm, chỉ là tắt phần đó đi.
 */
export const GOI_KY_DUYET = {
  A: {
    ten: "Gói A — nội dung nói về TRẺ",
    moTa: "Mô tả hành vi theo lứa tuổi, lời khuyên cho bố mẹ về con, bản tự đọc cho học sinh.",
    nguon: ["BIEU_HIEN", "DAC_DIEM_TRUC", "DIEN_GIAI", "LOI_KHUYEN", "BAN_KHOAN", "LECH_PHONG_CACH.choBoMe", "LECH_PHONG_CACH.choCon", "LECH_PHONG_CACH.thoaThuan"],
  },
  B: {
    ten: "Gói B — phản hồi tính cách cho NGƯỜI LỚN về chính họ",
    moTa:
      "Gần tham vấn hơn gói A. Người ký chịu trách nhiệm ở mức khác, nên tách riêng. " +
      "Từ 14.3, gói này còn gồm nội dung nói về quan hệ giữa HAI NGƯỜI LỚN trong nhà " +
      "(vợ ↔ chồng): nhận xét bạn đời của một người là bước xa hơn hẳn so với lời khuyên " +
      "nuôi dạy con, và người ký cần biết mình đang ký cái đó.",
    nguon: [
      "TU_MINH (đọc ở bộ PH)",
      "LECH_PHONG_CACH.boMeTuNhin",
      // 🔴 Khai NGAY LÚC DỰNG BẢNG (14.3), không đợi tới lúc gửi hồ sơ. Khai sau nghĩa là
      // có một quãng thời gian nội dung đã tồn tại mà hồ sơ ký duyệt không biết tới nó.
      "MO_TA_LECH + VIEC_CUA_TOI + THOA_THUAN ở thế quyền \"ngang-vai\" giữa hai người lớn",
    ],
  },
} as const;
