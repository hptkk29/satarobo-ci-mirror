// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc config/disc-dien-giai.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * VĂN BẢN BÁO CÁO — bốn khối cho từng kiểu (DISC_BA.md §9.1).
 *
 * 🔴 SÁU LUẬT VIẾT NỘI DUNG, KHÔNG THƯƠNG LƯỢNG (§9.2):
 *  1. Nói THIÊN HƯỚNG, không nói bản chất. "có thiên hướng chủ động", không phải "LÀ
 *     người chủ động".
 *  2. Mỗi trục nêu CẢ mặt mạnh LẪN mặt cần để ý. Không có ngoại lệ.
 *  3. Không tiên đoán nghề nghiệp.
 *  4. Không so sánh với trẻ khác.
 *  5. Không gắn với học lực.
 *  6. Bộ MN và TH mở đầu bằng câu rào.
 *
 * > Một báo cáo toàn lời khen thì phụ huynh nào đọc cũng thấy đúng — và đó chính là dấu
 * > hiệu nó không đo gì cả.
 *
 * ⚠️ CHƯA CÓ NGƯỜI CHUYÊN MÔN TÂM LÝ/GIÁO DỤC KÝ DUYỆT. Chạy nội bộ thì không sao. Ngày
 * bấm nút chạy quảng cáo là ngày nói với người lạ về con của họ — trước ngày đó phải có
 * một người ký. Xem mục "CHỜ NGOÀI" trong CLAUDE.md.
 *
 * `{chuThe}` / `{ChuThe}` được thay bằng "bạn" / "con" / "bé" / "em" tuỳ bộ đề — cùng một
 * nội dung phục vụ cả người tự đánh giá lẫn người quan sát, không viết hai bản lệch nhau.
 */

export type MaKieu =
  | "D" | "I" | "S" | "C"
  | "DI" | "DS" | "DC" | "IS" | "IC" | "SC"
  | "DEU";

export type KhoiDienGiai = {
  /** KHỐI 1 — Điều này thường trông như thế nào. */
  readonly trongNhuTheNao: string;
  /** KHỐI 2 — Điểm mạnh khi ở đúng chỗ. */
  readonly diemManh: string;
  /** KHỐI 3 — Chỗ cần để ý. 🔴 Không được để trống ở bất kỳ kiểu nào. */
  readonly choCanDeY: string;
  /** KHỐI 4 — Ba câu để hỏi con tối nay. Đây cũng là thứ lên đầu tấm ảnh chia sẻ (QĐ10). */
  readonly cauHoiToiNay: readonly [string, string, string];
};

export const TIEU_DE_KHOI = {
  trongNhuTheNao: "Điều này thường trông như thế nào",
  diemManh: "Điểm mạnh khi ở đúng chỗ",
  choCanDeY: "Chỗ cần để ý",
  cauHoiToiNay: "3 câu để hỏi con tối nay",
  cauHoiToiNayTuMinh: "3 câu để tự hỏi mình",
} as const;

export const DIEN_GIAI: Readonly<Record<MaKieu, KhoiDienGiai>> = {
  D: {
    trongNhuTheNao:
      "{ChuThe} quyết nhanh và nói thẳng. Trong nhóm, {chuThe} thường là người đưa ra phương án trước khi mọi người còn đang bàn, và không ngại nhận phần khó. Bị cản thì phản ứng ngay chứ ít khi để bụng.",
    diemManh:
      "Việc cần người khởi động, cần ai đó chịu trách nhiệm khi những người khác còn do dự — đó là chỗ {chuThe} phát huy. {ChuThe} cũng chịu được va chạm và bất đồng tốt hơn nhiều người.",
    choCanDeY:
      "Quyết nhanh đôi khi là quyết trước khi nghe hết. {ChuThe} có thể vô tình cắt lời người nói chậm, và sự thẳng thắn dễ bị hiểu thành gay gắt. Hỏi lại một câu trước khi chốt thường đủ để tránh chuyện đó.",
    cauHoiToiNay: [
      "Hôm nay có việc gì {chuThe} muốn làm theo cách của {chuThe} mà chưa được không?",
      "Khi người khác không đồng ý, {chuThe} thường làm gì?",
      "Có việc nào {chuThe} muốn tự làm mà người lớn hay làm giúp không?",
    ],
  },

  I: {
    trongNhuTheNao:
      "{ChuThe} thuyết phục bằng câu chuyện và cảm xúc hơn là bằng số liệu. Làm quen nhanh, kể chuyện có duyên, và không khí quanh {chuThe} thường nhẹ đi.",
    diemManh:
      "Chỗ cần gắn kết người với người, cần ai đó phá tan sự ngại ngùng ban đầu — {chuThe} làm việc đó rất tự nhiên. {ChuThe} cũng động viên người khác một cách thật lòng.",
    choCanDeY:
      "Chuyện vui dễ kéo dài hơn dự định, và việc đang dở dễ bị bỏ giữa chừng khi có điều gì mới hấp dẫn hơn. {ChuThe} cũng có thể thấy hụt hẫng khi không được ai chú ý. Ghi việc cần làm ra giấy giúp {chuThe} nhiều hơn là tự nhắc trong đầu.",
    cauHoiToiNay: [
      "Hôm nay {chuThe} kể chuyện gì làm mọi người cười nhiều nhất?",
      "Có ai hôm nay {chuThe} muốn làm quen mà chưa nói được câu nào không?",
      "Việc gì {chuThe} bắt đầu rồi mà chưa làm xong?",
    ],
  },

  S: {
    trongNhuTheNao:
      "{ChuThe} giữ nhịp đều, chờ được lâu, và thường là người nhường để mọi việc êm. Thay đổi đột ngột làm {chuThe} thấy chông chênh, nhưng nếu biết trước thì {chuThe} thích nghi tốt.",
    diemManh:
      "Người khác hay tìm đến {chuThe} khi cần một chỗ yên để nói chuyện. Việc cần bền, cần đều tay, cần giữ lời — đó là chỗ {chuThe} đáng tin.",
    choCanDeY:
      "Nhường nhiều quá thì phần mình bị bỏ quên, và cái khó chịu tích lại bên trong lâu hơn vẻ ngoài cho thấy. {ChuThe} cũng dễ trì hoãn việc phải nói ra điều khó nghe. Nói sớm một chút thường nhẹ hơn nhiều so với nói muộn.",
    cauHoiToiNay: [
      "Hôm nay có lúc nào {chuThe} nhường mà trong lòng chưa muốn nhường không?",
      "Có chuyện gì làm {chuThe} thấy khó chịu mà chưa kể với ai chưa?",
      "Ngày mai có việc gì {chuThe} muốn biết trước để đỡ lo không?",
    ],
  },

  C: {
    trongNhuTheNao:
      "{ChuThe} đọc kỹ trước khi làm, soát lại sau khi xong, và hỏi “vì sao” trước khi đồng ý. Đồ đạc và công việc của {chuThe} thường có một trật tự riêng.",
    diemManh:
      "Việc cần chính xác, cần phát hiện chỗ sai trước khi nó thành chuyện lớn — {chuThe} nhìn ra những thứ người khác lướt qua.",
    choCanDeY:
      "Muốn đúng có thể thành khó bắt đầu, vì chưa đủ chắc thì chưa muốn làm. {ChuThe} cũng dễ khắt khe với chính mình hơn với người khác. Có việc làm xong tám phần đúng lúc còn hơn mười phần muộn — phân biệt được hai loại việc đó là thứ đáng luyện.",
    cauHoiToiNay: [
      "Hôm nay có việc gì {chuThe} muốn làm cho thật đúng mà chưa kịp không?",
      "Có chỗ nào {chuThe} thấy chưa hợp lý mà chưa hỏi lại không?",
      "Nếu làm sai một chỗ nhỏ thì {chuThe} thấy thế nào?",
    ],
  },

  DI: {
    trongNhuTheNao:
      "{ChuThe} vừa quyết nhanh vừa kéo được người khác đi cùng. Ý tưởng đến nhanh, và {chuThe} nói ra ngay chứ ít khi giữ trong đầu.",
    diemManh:
      "Chỗ cần vừa khởi động vừa tập hợp người — {chuThe} làm được cả hai. Nhóm ít khi bị đứng yên khi có {chuThe}.",
    choCanDeY:
      "Nhanh cộng với sôi nổi thì phần chi tiết dễ rơi rụng. {ChuThe} có thể hứa nhiều hơn mức làm được, và người trầm tính khó chen vào để nói. Dừng lại hỏi “ai chưa được nói gì?” là thói quen đáng tập.",
    cauHoiToiNay: [
      "Hôm nay {chuThe} rủ được ai làm cùng việc gì không?",
      "Có việc nào {chuThe} nhận rồi mà thấy hơi quá sức không?",
      "Trong nhóm hôm nay, ai là người ít nói nhất?",
    ],
  },

  DS: {
    trongNhuTheNao:
      "{ChuThe} quyết đoán nhưng vẫn giữ hoà khí. Biết mình muốn gì, và cũng biết lúc nào nên lùi để mọi việc êm.",
    diemManh:
      "Vừa dám nhận trách nhiệm vừa không làm người khác tổn thương — tổ hợp này hiếm và rất được việc khi nhóm có bất đồng.",
    choCanDeY:
      "Hai hướng này đôi khi kéo ngược nhau: muốn nói thẳng nhưng lại ngại làm mất lòng, nên {chuThe} dễ giữ lại điều cần nói. Càng để lâu thì càng khó nói.",
    cauHoiToiNay: [
      "Hôm nay có điều gì {chuThe} muốn nói mà cuối cùng thôi không nói không?",
      "Khi {chuThe} và người khác muốn hai thứ khác nhau, {chuThe} làm thế nào?",
      "Có việc gì {chuThe} nhường mà thật ra {chuThe} muốn làm không?",
    ],
  },

  DC: {
    trongNhuTheNao:
      "{ChuThe} quyết nhanh nhưng đòi có căn cứ. Không thích vòng vo, và cũng không thích làm bừa.",
    diemManh:
      "Chỗ cần vừa nhanh vừa chắc — {chuThe} vừa dám chốt vừa kiểm được chỗ dễ sai. Ít khi phải làm lại.",
    choCanDeY:
      "Tiêu chuẩn cao cộng với nói thẳng dễ làm người khác thấy bị soi. {ChuThe} cũng có thể sốt ruột với người làm chậm hơn. Nói rõ “mình đang góp ý cho việc, không phải cho người” giúp ích nhiều.",
    cauHoiToiNay: [
      "Hôm nay {chuThe} thấy chỗ nào người khác làm chưa đúng không?",
      "{ChuThe} nói thế nào khi thấy ai đó làm sai?",
      "Có việc gì {chuThe} muốn làm nhanh mà phải chờ không?",
    ],
  },

  IS: {
    trongNhuTheNao:
      "{ChuThe} ấm áp và dễ gần, giữ được quan hệ lâu. Thích không khí vui nhưng không thích tranh cãi.",
    diemManh:
      "Chỗ cần giữ người ở lại với nhau, cần ai đó để ý xem có ai đang bị bỏ ra rìa — {chuThe} nhìn thấy điều đó sớm.",
    choCanDeY:
      "Ngại va chạm cộng với muốn ai cũng vui thì việc cần nói thẳng bị đẩy lùi mãi. {ChuThe} cũng dễ nhận thêm việc chỉ vì khó từ chối.",
    cauHoiToiNay: [
      "Hôm nay có ai ngồi một mình không?",
      "Có ai nhờ {chuThe} việc gì mà {chuThe} không muốn nhận không?",
      "Lúc mọi người tranh cãi, {chuThe} làm gì?",
    ],
  },

  IC: {
    trongNhuTheNao:
      "{ChuThe} kể chuyện có dẫn chứng. Thích chia sẻ, nhưng thích chia sẻ thứ mình đã kiểm lại.",
    diemManh:
      "Vừa làm người khác muốn nghe, vừa nói đúng — chỗ cần giải thích một việc phức tạp cho nhiều người là chỗ {chuThe} sáng.",
    choCanDeY:
      "Muốn nói hay lại muốn nói đúng thì dễ chuẩn bị mãi không xong. {ChuThe} cũng có thể tự trách khi lỡ nói sai một chi tiết nhỏ mà chẳng ai để ý.",
    cauHoiToiNay: [
      "Hôm nay {chuThe} muốn kể chuyện gì mà chưa kể?",
      "Có lúc nào {chuThe} định nói rồi lại thôi vì sợ nói sai không?",
      "{ChuThe} thích giải thích cho người khác kiểu nào hơn: kể chuyện hay chỉ từng bước?",
    ],
  },

  SC: {
    trongNhuTheNao:
      "{ChuThe} bền và kỹ. Làm theo nếp, làm đến nơi, và cần thời gian để quen với cái mới.",
    diemManh:
      "Việc dài hơi, việc cần đều tay và chính xác — {chuThe} giữ được chất lượng từ đầu đến cuối, không đuối giữa chừng.",
    choCanDeY:
      "Cẩn thận cộng với ngại thay đổi thì việc mới dễ bị hoãn mãi. {ChuThe} cũng chịu áp lực trong im lặng lâu hơn mức nên chịu. Chia việc mới thành một bước rất nhỏ để bắt đầu thường tháo được nút này.",
    cauHoiToiNay: [
      "Có việc mới nào {chuThe} thấy hơi ngại bắt đầu không?",
      "Hôm nay có gì thay đổi so với mọi hôm không? {ChuThe} thấy thế nào?",
      "Có chuyện gì {chuThe} đang lo mà chưa kể với ai không?",
    ],
  },

  DEU: {
    trongNhuTheNao:
      "Bốn nhóm hành vi của {chuThe} khá cân bằng, chưa nhóm nào nổi rõ hơn hẳn.",
    diemManh:
      "Cân bằng có cái lợi riêng: {chuThe} xoay theo hoàn cảnh dễ hơn người có một nhóm rất trội, và ít khi bị kẹt vì chỉ có một cách làm.",
    choCanDeY:
      "Điều này bình thường, nhất là với trẻ đang lớn — tính cách còn đang hình thành và sẽ đổi theo tuổi. Cũng có thể lần này {chuThe} trả lời theo hướng “cái nào cũng hơi đúng”. Làm lại sau vài tháng thường cho hình ảnh rõ hơn.",
    cauHoiToiNay: [
      "Hôm nay lúc nào {chuThe} thấy đúng là mình nhất?",
      "Có việc gì {chuThe} làm theo một cách hẳn, không giống người khác không?",
      "Nếu được chọn, {chuThe} thích làm việc một mình hay làm cùng nhóm?",
    ],
  },
};

/**
 * Ai đang ĐỌC bản báo cáo. Cùng một bài, hai người đọc gọi đứa trẻ bằng hai từ khác nhau.
 *
 * 🔴 TRỤC XOAY CỦA CẢ GĐ10. Bảng đại từ cũ khoá theo `maBoDe` MỘT CHIỀU, tức là ngầm giả
 * định *"một bộ đề = một người đọc"*. Giả định đó đúng cho tới khi có ba bản: cùng một bài
 * Tiểu học, **con đọc phần của con** ("em") còn **bố mẹ đọc phần của bố mẹ** ("con"). Không
 * tách được hai chiều thì hoặc là gọi một em lớp 4 là "con", hoặc là bắt bố mẹ đọc "em" khi
 * nói về chính con mình.
 */
export type BanDoc = "con" | "boMe";

/**
 * Đại từ thay vào {chuThe}, theo bộ đề VÀ theo người đọc.
 *
 * Cột `con` giữ đúng giá trị cũ ⇒ mọi nơi gọi `thayChuThe()` không truyền người đọc vẫn ra
 * y hệt trước, không có chỗ nào âm thầm đổi chữ.
 *
 * Chỉ bộ TH và THCS mới thật sự dùng cả hai cột (trẻ tự làm bài thì có cả bản cho con lẫn
 * bản cho bố mẹ). Ba bộ còn lại chỉ có một người đọc, hai cột trùng nhau — khai đủ để không
 * có ô nào rơi vào `undefined`.
 */
export const CHU_THE: Readonly<
  Record<string, Readonly<Record<BanDoc, { thuong: string; hoa: string }>>>
> = {
  // Bố mẹ trả lời hộ bé mẫu giáo; bé chưa đọc được bản nào.
  MN: { con: { thuong: "bé", hoa: "Bé" }, boMe: { thuong: "bé", hoa: "Bé" } },
  // Em học sinh tự làm: em đọc "em", bố mẹ đọc "con".
  TH: { con: { thuong: "em", hoa: "Em" }, boMe: { thuong: "con", hoa: "Con" } },
  THCS: { con: { thuong: "bạn", hoa: "Bạn" }, boMe: { thuong: "con", hoa: "Con" } },
  // Người lớn tự đánh giá chính mình — chỉ một người đọc.
  PH: { con: { thuong: "bạn", hoa: "Bạn" }, boMe: { thuong: "bạn", hoa: "Bạn" } },
  // Bố mẹ quan sát con; con không đọc bản này.
  QS: { con: { thuong: "con", hoa: "Con" }, boMe: { thuong: "con", hoa: "Con" } },
};
