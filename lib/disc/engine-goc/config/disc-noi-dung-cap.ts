// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc config/disc-noi-dung-cap.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * NỘI DUNG CHO MỖI CHỖ VÊNH GIỮA HAI NGƯỜI — 56 đoạn (14.3).
 *
 * Bốn bảng, cùng khoá theo TRỤC và HƯỚNG NHÌN TỪ NGƯỜI ĐỌC (xem `disc-lech-cap.ts`):
 *
 * | Bảng           | Khoá                        | Số đoạn | Ai đọc                 |
 * | -------------- | --------------------------- | ------- | ---------------------- |
 * | `MO_TA_LECH`   | trục × hướng × {veToi,veNguoiKia} |  16 | người đang đọc         |
 * | `THOA_THUAN`   | trục × hướng                |    8    | cả hai cùng đọc        |
 * | `VIEC_CUA_TOI` | trục × hướng × thế quyền    |   24    | người đang đọc         |
 * | `TRUNG_KHOP`   | trục × kiểu                 |    8    | cả hai, khi không lệch |
 *
 * ── BA LUẬT KHÔNG THƯƠNG LƯỢNG ──────────────────────────────────────────────
 *
 * 🔴 **1. `veNguoiKia` phải LẬT KHUNG, không được mô tả suông.**
 * Đây là đoạn nguy hiểm nhất trong cả sản phẩm: `{nguoiKia}` là tên một người có thật, và
 * người đọc có thể là anh chị em của họ. Một câu mô tả trung tính như *"Tí Nị quyết chậm
 * hơn em"* đọc lên vẫn thành một lời chê. Nên mỗi đoạn `veNguoiKia` bắt buộc chứa một dấu
 * hiệu lật khung — *"không phải… mà"*, *"thật ra"*, *"dễ bị đọc thành"*, *"nhìn từ ngoài"*
 * — tức là nói thẳng rằng cách hiểu đầu tiên có thể sai.
 * `tests/lech-cap.test.ts` dùng **khẳng định dương** (phải CÓ dấu hiệu) chứ không dùng
 * regex cấm: regex cấm sẽ báo nhầm chính những câu lật khung, đúng bài học chữ *"bạn"* vừa
 * là đại từ vừa là danh từ.
 *
 * 🔴 **2. `tre-voi-nguoi-lon` KHÔNG BAO GIỜ giao cho trẻ việc của người lớn.**
 * Bảo một đứa trẻ *"hãy đợi mẹ nói hết"* là dạy nó một kỹ năng. Bảo nó *"hãy giúp mẹ chậm
 * lại"* là giao cho nó trách nhiệm điều tiết một người lớn — và khi chuyện trong nhà không
 * đỡ hơn, đứa trẻ sẽ hiểu là nó đã làm hỏng. Ở thế quyền này chỉ nói được MỘT thứ: cách
 * nói ra điều mình cần.
 *
 * 🔴 **3. Cấm mọi so sánh hơn kém.** Không "tốt hơn", "giỏi hơn", "đúng hơn", "hợp lý hơn".
 * Hai người khác nhịp, không phải một người đúng một người sai.
 *
 * 🔴 **`ngang-vai` giữa hai NGƯỜI LỚN thuộc GÓI KÝ DUYỆT B** — phản hồi tính cách cho người
 * lớn về chính họ và bạn đời, gần tham vấn hơn lời khuyên nuôi dạy. Đã khai ở `GOI_KY_DUYET`.
 *
 * ⚠️ CHƯA CÓ NGƯỜI CHUYÊN MÔN KÝ DUYỆT. Xem mục CHỜ NGOÀI trong CLAUDE.md.
 *
 * Thuộc TẦNG LÕI (ADR-004): chuỗi thuần, không React, không DOM.
 */

import type { HuongLechCap, KieuTrungKhop, TheQuyen } from "./disc-lech-cap";

import type { MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

type KhoiMoTaLech = {
  /** Nói về chính người đang đọc. */
  readonly veToi: string;
  /** 🔴 Nói về người kia — BẮT BUỘC lật khung. Xem luật 1 ở đầu file. */
  readonly veNguoiKia: string;
};

/* ── 1. MÔ TẢ CHỖ VÊNH — 16 đoạn ─────────────────────────────────────────── */

export const MO_TA_LECH: Readonly<
  Record<MaTruc, Readonly<Record<HuongLechCap, KhoiMoTaLech>>>
> = {
  D: {
    "toi-cao-hon": {
      veToi:
        "{Toi} quyết nhanh và muốn bắt tay vào việc ngay khi đã thấy đường đi. Trong nhà, điều đó giữ cho mọi thứ chạy được — có người khởi động thì việc mới bắt đầu. Cái giá đi kèm là {toi} thường chốt xong trước khi người bên cạnh kịp có ý kiến, rồi ngạc nhiên khi họ có vẻ không hào hứng lắm với thứ vừa được quyết.",
      veNguoiKia:
        "{NguoiKia} cần thêm một nhịp trước khi quyết. Chuyện này dễ bị đọc thành chần chừ hoặc không quan tâm, nhưng thật ra khoảng lặng đó là lúc {nguoiKia} đang cân nhắc thật — và những thứ {nguoiKia} nghĩ ra trong khoảng lặng ấy thường là thứ đã bị bỏ qua khi mọi người quyết vội.",
    },
    "toi-thap-hon": {
      veToi:
        "{Toi} thích nhìn kỹ trước khi bước, và không thấy cần phải quyết ngay khi chưa rõ đường. Cái được là {toi} ít khi phải quay lại sửa. Cái giá là khi có người bên cạnh chạy nhanh hơn, {toi} dễ thấy mình bị đẩy đi — rồi hoặc là im, hoặc là phanh lại, mà cả hai đều không nói ra được điều {toi} thật sự nghĩ.",
      veNguoiKia:
        "{NguoiKia} quyết nhanh và muốn làm ngay. Nhìn từ ngoài, tốc độ đó dễ bị đọc thành hấp tấp hoặc không thèm hỏi ai. Thật ra {nguoiKia} thường đã nghĩ xong trong đầu từ trước, chỉ là phần nghĩ ấy không nói thành lời — nên người bên cạnh chỉ thấy phần kết luận.",
    },
  },
  I: {
    "toi-cao-hon": {
      veToi:
        "{Toi} bắt chuyện dễ, kể được, và kéo được người khác vào việc chung. Trong nhà, {toi} thường là người làm cho không khí ấm lên. Cái giá đi kèm là {toi} dễ lấp đầy mọi khoảng lặng — mà có người lại cần đúng khoảng lặng đó mới nói được điều họ đang nghĩ.",
      veNguoiKia:
        "{NguoiKia} nói ít hơn và cần thời gian trước khi mở lời. Điều này dễ bị đọc thành lạnh nhạt hoặc giận dỗi, nhưng thật ra {nguoiKia} chỉ đang chưa sẵn sàng nói. Im lặng ở đây không phải một thông điệp — nó chỉ là im lặng.",
    },
    "toi-thap-hon": {
      veToi:
        "{Toi} cần một quãng yên trước khi nói, và thường chọn ít người mà thân thay vì nhiều người mà nhạt. Cái được là khi {toi} nói thì lời nói có sức nặng. Cái giá là ở chỗ đông người hoặc trong một cuộc trò chuyện dồn dập, {toi} dễ bị coi như đang không tham gia, trong khi thật ra {toi} đang nghe rất kỹ.",
      veNguoiKia:
        "{NguoiKia} nói nhiều và bắt chuyện dễ. Nhìn từ ngoài, điều đó dễ bị đọc thành lấn át hoặc không để ý tới người khác. Thật ra với {nguoiKia}, nói chính là cách nghĩ — {nguoiKia} vừa nói vừa tìm ra ý mình, chứ không phải đã có sẵn ý rồi mới nói ra.",
    },
  },
  S: {
    "toi-cao-hon": {
      veToi:
        "{Toi} giữ được nhịp đều, giữ lời, và không bỏ ngang giữa chừng — nên người khác hay dựa vào {toi}. Cái giá đi kèm là thay đổi vào phút chót làm {toi} mất sức nhiều hơn hẳn người khác, và {toi} thường chịu đựng thay vì nói ra là mình đang khó chịu.",
      veNguoiKia:
        "{NguoiKia} đổi kế hoạch dễ hơn và không thấy đó là chuyện lớn. Điều này dễ bị đọc thành thiếu tôn trọng thời gian của người khác, nhưng thật ra {nguoiKia} không cảm nhận sự thay đổi nặng như {toi} — với {nguoiKia}, đổi kế hoạch là một lựa chọn bình thường chứ không phải một cú phanh gấp.",
    },
    "toi-thap-hon": {
      veToi:
        "{Toi} xoay chuyển nhanh, đổi hướng được giữa chừng mà không thấy khó. Cái được là {toi} không bị kẹt khi mọi thứ lệch khỏi dự tính. Cái giá là {toi} hay quên rằng với người bên cạnh, một thay đổi nhỏ có thể là cả một buổi phải sắp lại — và họ thường không nói ra điều đó.",
      veNguoiKia:
        "{NguoiKia} cần biết trước và cần nhịp đều. Nhìn từ ngoài, chuyện đó dễ bị đọc thành cứng nhắc hay ngại cái mới. Thật ra {nguoiKia} chỉ đang giữ cho mọi thứ chạy được — và phần lớn những việc chạy đều trong nhà là do có người như {nguoiKia} nhận lấy.",
    },
  },
  C: {
    "toi-cao-hon": {
      veToi:
        "{Toi} muốn nắm đủ thông tin rồi mới quyết, và làm kỹ nên ít sai sót. Trong nhà, {toi} thường là người phát hiện ra chỗ chưa ổn trước khi nó thành vấn đề. Cái giá đi kèm là {toi} dễ hỏi thêm một câu nữa vào đúng lúc người kia đã muốn xong, và câu hỏi ấy nghe như một lời nghi ngờ dù {toi} không định thế.",
      veNguoiKia:
        "{NguoiKia} quyết được khi thông tin còn thiếu, và không thấy đó là mạo hiểm. Điều này dễ bị đọc thành cẩu thả, nhưng thật ra {nguoiKia} đang tính sẵn đường sửa nếu sai — cách của {nguoiKia} là làm rồi chỉnh, không phải chỉnh xong mới làm.",
    },
    "toi-thap-hon": {
      veToi:
        "{Toi} quyết được với thứ đang có và không cần chờ đủ mọi thông tin. Cái được là mọi việc không bị treo. Cái giá là {toi} dễ bỏ qua một chi tiết mà người kỹ tính hơn đã thấy từ đầu — và khi họ nêu ra, {toi} dễ nghe thành họ đang bới lỗi thay vì đang giúp.",
      veNguoiKia:
        "{NguoiKia} muốn nắm đủ trước khi quyết, và hỏi rất nhiều. Nhìn từ ngoài, chuỗi câu hỏi đó dễ bị đọc thành thiếu tin tưởng. Thật ra {nguoiKia} hỏi vì muốn việc chạy trót lọt — mỗi câu hỏi là một cái bẫy đã được gỡ trước, chứ không phải một lời phản đối.",
    },
  },
};

/* ── 2. THOẢ THUẬN — 8 đoạn, cả hai cùng đọc ─────────────────────────────── */

/**
 * Việc CẢ HAI cùng làm, có thời hạn và có cách nhìn lại.
 *
 * 🔴 Luôn có phần cho cả hai phía. Một thoả thuận chỉ đòi một bên đổi thì không phải thoả
 * thuận — nó là một yêu cầu có vỏ lịch sự, và người kia biết ngay.
 */
export const THOA_THUAN: Readonly<Record<MaTruc, Readonly<Record<HuongLechCap, string>>>> = {
  D: {
    "toi-cao-hon":
      "Thử trong hai tuần: trước khi chốt một việc liên quan tới cả hai, {toi} đếm đến ba và hỏi {nguoiKia} nghĩ gì; {nguoiKia} nói ra ý mình ngay lúc đó, kể cả khi chưa nghĩ xong hẳn. Hết hai tuần, mỗi người kể một lần thấy cách này dễ chịu và một lần thấy khó.",
    "toi-thap-hon":
      "Thử trong hai tuần: {toi} nói ra ý mình ngay khi {nguoiKia} vừa nêu việc, kể cả khi ý đó còn dở dang; {nguoiKia} đợi hết câu rồi mới chốt. Hết hai tuần, ngồi lại xem có việc nào đã đỡ phải làm lại nhờ cách này.",
  },
  I: {
    "toi-cao-hon":
      "Thử trong hai tuần: mỗi lần hỏi {nguoiKia} một câu, {toi} đợi đủ năm giây rồi mới nói tiếp; {nguoiKia} thử trả lời ngay cả khi câu trả lời còn ngắn. Hết hai tuần, xem có chuyện gì được nói ra mà trước đó chưa từng.",
    "toi-thap-hon":
      "Thử trong hai tuần: {toi} nói trước một câu về việc mình cần khoảng lặng, thay vì im rồi để người kia đoán; {nguoiKia} chừa lại một quãng yên trong ngày và không lấp nó. Hết hai tuần, mỗi người kể một lần thấy nhẹ hơn.",
  },
  S: {
    "toi-cao-hon":
      "Thử trong hai tuần: {nguoiKia} báo trước mỗi khi định đổi kế hoạch, dù chỉ báo trước mười phút; {toi} nói thẳng khi một thay đổi làm mình mệt, thay vì nhận rồi chịu. Hết hai tuần, xem còn lần nào phải sắp lại cả buổi mà không ai biết trước.",
    "toi-thap-hon":
      "Thử trong hai tuần: {toi} báo trước mỗi khi đổi kế hoạch, dù chỉ mười phút; {nguoiKia} nói ra khi thấy mệt thay vì lặng lẽ gánh. Hết hai tuần, ngồi lại xem cái gì đã bớt căng và cái gì vẫn còn.",
  },
  C: {
    "toi-cao-hon":
      "Thử trong hai tuần: {toi} gom câu hỏi lại hỏi một lượt thay vì hỏi rải rác suốt buổi; {nguoiKia} trả lời thật thay vì gạt đi cho xong. Hết hai tuần, xem có việc nào chạy trót lọt hơn nhờ đã hỏi đủ từ đầu.",
    "toi-thap-hon":
      "Thử trong hai tuần: {toi} dành mười phút trả lời hết câu hỏi của {nguoiKia} một lượt, trước khi bắt đầu việc; {nguoiKia} chốt lại sau mười phút đó dù còn chỗ chưa rõ. Hết hai tuần, mỗi người kể một lần thấy cách này đỡ mất sức hơn.",
  },
};

/* ── 3. VIỆC CỦA TÔI — 24 đoạn, khác nhau theo THẾ QUYỀN ─────────────────── */

/**
 * Một việc NGƯỜI ĐANG ĐỌC làm được, khác nhau theo thế quyền.
 *
 * 🔴 Đọc kỹ nhánh `tre-voi-nguoi-lon` trước khi sửa: nó CHỈ được nói về cách đứa trẻ nói
 * ra điều mình cần. Không một câu nào ở đó được giao cho trẻ việc điều tiết người lớn.
 */
export const VIEC_CUA_TOI: Readonly<
  Record<MaTruc, Readonly<Record<HuongLechCap, Readonly<Record<TheQuyen, string>>>>>
> = {
  D: {
    "toi-cao-hon": {
      "nguoi-lon-voi-tre":
        "Hôm nay chọn một việc nhỏ và hỏi {nguoiKia} nghĩ gì trước khi bạn nói ý mình. Hỏi trước, không phải hỏi để xác nhận điều bạn đã quyết.",
      "tre-voi-nguoi-lon":
        "Khi em thấy mình đang nói nhanh hơn {nguoiKia}, thử dừng lại và hỏi một câu: “Ý của {nguoiKia} thế nào ạ?” Rồi đợi nghe hết.",
      "ngang-vai":
        "Lần tới khi bạn định chốt một việc chung, nói ra suy nghĩ của mình dưới dạng đề xuất chứ không phải kết luận, rồi đợi {nguoiKia} trả lời.",
    },
    "toi-thap-hon": {
      "nguoi-lon-voi-tre":
        "Tuần này chọn một việc bạn vẫn quen kiểm cho chắc, và để {nguoiKia} tự làm trọn — kể cả khi cách của {nguoiKia} vòng hơn cách của bạn.",
      "tre-voi-nguoi-lon":
        "Lúc thấy bị hối, thử nói thành lời: “Con cần thêm một phút ạ.” Câu đó ngắn nhưng nó cho người lớn biết em đang nghĩ, chứ không phải đang lờ đi.",
      "ngang-vai":
        "Lần tới khi {nguoiKia} chốt nhanh quá, nói ngay lúc đó là bạn cần thêm một nhịp — thay vì đồng ý rồi khó chịu về sau.",
    },
  },
  I: {
    "toi-cao-hon": {
      "nguoi-lon-voi-tre":
        "Hôm nay thử hỏi {nguoiKia} một câu rồi im lặng đủ lâu. Khoảng lặng đó khó chịu với bạn, nhưng nó chính là chỗ {nguoiKia} cần để mở lời.",
      "tre-voi-nguoi-lon":
        "Khi em kể chuyện xong, thử hỏi lại {nguoiKia} một câu và nghe hết câu trả lời trước khi kể tiếp.",
      "ngang-vai":
        "Trong cuộc nói chuyện tới, thử đếm xem bạn nói bao nhiêu và {nguoiKia} nói bao nhiêu. Chỉ đếm thôi, chưa cần sửa gì.",
    },
    "toi-thap-hon": {
      "nguoi-lon-voi-tre":
        "Thay vì đợi {nguoiKia} tự hạ giọng, thử nói trước: “Bạn cho tôi vài phút yên nhé.” Nói ra một lần đỡ hơn là chịu đựng cả buổi.",
      "tre-voi-nguoi-lon":
        "Khi em cần một lúc yên, thử nói ra thay vì im: “Con muốn ngồi im một lát ạ.” Người lớn không đoán được nếu em không nói.",
      "ngang-vai":
        "Lần tới khi bạn thấy mình đang lùi khỏi cuộc trò chuyện, thử nói một câu ngắn về điều mình nghĩ trước khi lùi hẳn.",
    },
  },
  S: {
    "toi-cao-hon": {
      "nguoi-lon-voi-tre":
        "Lần tới khi một thay đổi làm bạn mệt, nói thẳng ra thay vì nhận rồi chịu. {NguoiKia} không biết là bạn đang gắng nếu bạn không nói.",
      "tre-voi-nguoi-lon":
        "Khi kế hoạch đổi đột ngột và em thấy khó chịu, thử nói: “Con cần biết trước thì mới xoay kịp ạ.” Đó là điều em cần, không phải một lời trách.",
      "ngang-vai":
        "Lần tới khi {nguoiKia} đổi kế hoạch, thử nói ngay lúc đó là bạn cần biết trước — thay vì để bụng rồi bực về sau.",
    },
    "toi-thap-hon": {
      "nguoi-lon-voi-tre":
        "Tuần này, mỗi lần định đổi kế hoạch, báo cho {nguoiKia} trước dù chỉ mười phút. Mười phút đó đổi được cả thái độ của buổi hôm ấy.",
      "tre-voi-nguoi-lon":
        "Khi em muốn đổi kế hoạch, thử báo trước một câu thay vì đổi rồi mới nói. Báo trước thường mở được nhiều cửa hơn hẳn.",
      "ngang-vai":
        "Lần tới khi bạn định đổi giờ hay đổi việc, nhắn trước một câu. Không phải xin phép — chỉ là cho {nguoiKia} kịp sắp lại.",
    },
  },
  C: {
    "toi-cao-hon": {
      "nguoi-lon-voi-tre":
        "Lần tới, gom câu hỏi lại hỏi một lượt thay vì hỏi rải rác. Chuỗi câu hỏi liên tục nghe giống kiểm tra hơn là giống quan tâm.",
      "tre-voi-nguoi-lon":
        "Khi em còn thắc mắc, thử nói rõ vì sao em hỏi: “Con hỏi vì con muốn làm cho đúng ạ.” Câu đó giúp người lớn hiểu em đang muốn gì.",
      "ngang-vai":
        "Lần tới khi bạn định hỏi thêm, nói trước lý do hỏi. Một câu hỏi có lý do nghe khác hẳn một câu hỏi trống.",
    },
    "toi-thap-hon": {
      "nguoi-lon-voi-tre":
        "Lần tới khi {nguoiKia} hỏi thêm, thử trả lời đủ thay vì gạt đi cho xong. Câu hỏi đó thường là một cái bẫy đang được gỡ trước.",
      "tre-voi-nguoi-lon":
        "Khi {nguoiKia} hỏi nhiều, thử trả lời hết một lượt rồi hỏi lại: “Còn gì con cần nói thêm không ạ?” Hỏi lại nhanh hơn là đoán.",
      "ngang-vai":
        "Lần tới khi bạn thấy sốt ruột vì bị hỏi nhiều, thử dành trọn mười phút trả lời hết, rồi mới bắt đầu việc.",
    },
  },
};

/* ── 4. TRÙNG KHỚP — 8 đoạn, khi bốn trục không lệch ─────────────────────── */

/**
 * 🔴 Trùng khớp KHÔNG phải là "không có gì để nói".
 *
 * Hai người cùng nhịp ở một trục là một sự thật đáng nói — nó giải thích vì sao có những
 * chuyện nhà này không bao giờ va, và cũng cảnh báo được chỗ cả hai cùng có một điểm mù.
 * Để trống ở đây là trả về một màn hình trắng cho đúng những gia đình hợp nhau nhất.
 */
export const TRUNG_KHOP: Readonly<
  Record<MaTruc, Readonly<Record<KieuTrungKhop, string>>>
> = {
  D: {
    "cung-noi":
      "Cả hai đều quyết nhanh. Việc trong nhà ít khi bị treo — nhưng cũng ít khi có ai phanh lại.",
    "cung-nhe":
      "Cả hai đều thích nhìn kỹ trước khi bước. Ít quyết hỏng, nhưng có việc nằm chờ hơi lâu.",
  },
  I: {
    "cung-noi":
      "Cả hai đều dễ bắt chuyện. Nhà thường vui — và khoảng lặng thì hiếm, kể cả lúc cần.",
    "cung-nhe":
      "Cả hai đều cần quãng yên. Ở cùng nhau rất nhẹ, nhưng chuyện khó dễ bị để đó không ai mở lời.",
  },
  S: {
    "cung-noi":
      "Cả hai đều giữ nhịp đều và giữ lời. Rất dễ dựa vào nhau — và cũng rất ngại phá nhịp đó.",
    "cung-nhe":
      "Cả hai đều xoay nhanh và đổi hướng dễ. Linh hoạt, nhưng thói quen chung thì khó giữ.",
  },
  C: {
    "cung-noi":
      "Cả hai đều muốn nắm đủ rồi mới quyết. Ít sai sót — và cũng dễ cùng nhau chờ quá lâu.",
    "cung-nhe":
      "Cả hai đều quyết được với thứ đang có. Việc chạy nhanh, nhưng chi tiết dễ cùng bị bỏ qua.",
  },
};
