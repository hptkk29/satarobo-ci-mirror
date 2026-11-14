// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc config/disc-bieu-hien.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * VĂN BẢN THEO TỪNG TRỤC — phần đặc tả đòi từ đầu mà bản dựng đầu tiên bỏ sót.
 *
 * 🔴 VÌ SAO FILE NÀY TỒN TẠI. `DISC_BA.md` §9.2 luật 2 ghi *"Mỗi trục nêu CẢ mặt mạnh LẪN
 * mặt cần để ý. Không có ngoại lệ"*, và DEMO #5 đòi *"mỗi trục có ít nhất một dòng chỗ cần
 * để ý"*. Bản dựng lại làm theo KIỂU (11 kiểu) chứ không theo TRỤC, nên phụ huynh nhìn biểu
 * đồ bốn cột có số đầy đủ mà chỉ đọc được chữ về đúng một nhóm. Hạng mục đó đã tick ✅
 * nhưng nghiệm thu bằng tiêu chí sai. Đây là chỗ trả nợ.
 *
 * 🔴 SÁU LUẬT VIẾT NỘI DUNG §9.2 vẫn áp nguyên (xem đầu `disc-dien-giai.ts`):
 *  1. Nói THIÊN HƯỚNG, không nói bản chất.  2. Mỗi trục nêu cả mạnh lẫn chỗ cần để ý.
 *  3. Không tiên đoán nghề nghiệp.  4. Không so sánh với trẻ khác.  5. Không gắn học lực.
 *  6. Bộ MN và TH mở đầu bằng câu rào.
 *
 * 🔴 LUẬT THỨ BẢY, RIÊNG CHO FILE NÀY — **TRỤC NHẸ KHÔNG PHẢI TRỤC HỎNG.**
 * DISC không phải mô hình khuyết thiếu. Mỗi `khiNhe` bắt buộc nêu cái ĐƯỢC trước, rồi mới
 * tới cái giá đi kèm. Viết kiểu "con thiếu S, cần bổ sung S" là dán nhãn thiếu sót lên một
 * đứa trẻ — đúng thứ ADR-002 dựng ra để chặn.
 *
 * ⚠️ CHƯA CÓ NGƯỜI CHUYÊN MÔN TÂM LÝ/GIÁO DỤC KÝ DUYỆT. Xem mục CHỜ NGOÀI trong CLAUDE.md.
 *
 * Thuộc TẦNG LÕI (ADR-004): chuỗi thuần, không React, không DOM, không Tailwind.
 */

import type { MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

/**
 * Lứa nội dung. KHÔNG trùng với mã bộ đề: bộ QS (bố mẹ nhìn con) trải từ 8 đến 15 tuổi
 * nên bắc qua cả `TH` lẫn `THCS` — chỉ trường `tuoi` trong bản ghi phân định được.
 */
export const LUA_TUOI = ["MN", "TH", "THCS", "NGUOI_LON"] as const;
export type LuaTuoi = (typeof LUA_TUOI)[number];

/* ── Biểu hiện quan sát được, theo lứa tuổi ──────────────────────────────── */

/**
 * 🔴 VIẾT HÀNH VI NHÌN THẤY ĐƯỢC, KHÔNG VIẾT TÍNH TỪ.
 *
 * "Bé giành làm trước khi người lớn kịp hướng dẫn" thì phụ huynh gật đầu vì họ đã thấy
 * cảnh đó. "Bé chủ động" thì đúng với mọi đứa trẻ và không chạm được ai. Cảm giác
 * *"đúng là con tôi"* đến từ chi tiết cụ thể, và đó là điều kiện cần để họ đọc tiếp.
 */
export const BIEU_HIEN: Readonly<Record<MaTruc, Readonly<Record<LuaTuoi, string>>>> = {
  D: {
    MN: "{ChuThe} giành làm trước khi người lớn kịp hướng dẫn, và hay là người bày ra trò chơi rồi phân vai cho các bạn. Bị ngăn thì phản ứng ngay, to tiếng một lúc rồi thôi chứ ít khi để bụng.",
    TH: "{ChuThe} nhận phần khó trong nhóm và muốn làm theo cách của mình. Không đồng ý điều gì thì nói thẳng, kể cả với người lớn. Thua một cuộc chơi thì tiếc ra mặt.",
    THCS: "{ChuThe} thường quyết rồi mới báo. Khi tin là mình đúng thì tranh luận tới cùng. Việc bàn mãi chưa chốt làm {chuThe} sốt ruột thấy rõ.",
    NGUOI_LON: "{ChuThe} quyết nhanh, nói thẳng vào việc, và nhận phần khó khi những người khác còn cân nhắc. Việc bị kéo dài làm {chuThe} mất kiên nhẫn.",
  },
  I: {
    MN: "{ChuThe} kể lại chuyện ở lớp bằng rất nhiều chi tiết, làm quen với bạn mới chỉ trong vài phút, và thích được nhìn, được khen, được gọi lên trước.",
    TH: "{ChuThe} kết bạn nhanh và nhớ tên gần hết lớp. Kể chuyện thì hay thêm thắt cho hấp dẫn. Hào hứng lúc bắt đầu, dễ nguội khi việc thành lặp đi lặp lại.",
    THCS: "{ChuThe} nói trước đám đông không thấy ngại và rủ được người khác cùng tham gia. Bạn bè chiếm phần lớn tâm trí, và một lời chê nơi đông người thì {chuThe} nhớ rất lâu.",
    NGUOI_LON: "{ChuThe} bắt chuyện dễ, kể chuyện có duyên, kéo được người khác vào việc chung. Phần mở màn hợp với {chuThe} hơn phần thu dọn.",
  },
  S: {
    MN: "{ChuThe} chơi được rất lâu với một trò, nhường đồ chơi mà không cần ai nhắc. Lịch sinh hoạt đổi đột ngột thì bối rối, có khi khóc mà không nói được vì sao.",
    TH: "{ChuThe} giữ đúng nếp đã quen và cần biết trước hôm nay sẽ làm gì. Trong lúc tranh cãi thì thường nhường trước, rồi giữ phần ấm ức lại trong lòng.",
    THCS: "{ChuThe} là chỗ bạn bè tìm đến khi có chuyện. Ít khi cãi tay đôi — không đồng ý thì im lặng rồi rút lui. Thay đổi đột ngột làm {chuThe} mất đà lâu hơn người khác.",
    NGUOI_LON: "{ChuThe} kiên nhẫn, giữ lời, làm đều tay, nên người khác hay dựa vào. Đổi kế hoạch vào phút chót là thứ làm {chuThe} khó chịu nhất.",
  },
  C: {
    MN: "{ChuThe} xếp đồ về đúng chỗ cũ và hỏi “vì sao” nhiều lần cho tới khi hiểu. Làm sai một chút là muốn bỏ đi làm lại từ đầu.",
    TH: "{ChuThe} làm theo hướng dẫn rồi soát lại, và hỏi cho rõ luật chơi trước khi bắt đầu. Bị chê thì nhớ rất kỹ mình đã sai ở chỗ nào.",
    THCS: "{ChuThe} muốn hiểu lý do trước khi làm theo, và soát lại nhiều lần trước khi nộp. Việc làm qua loa khiến {chuThe} khó chịu, kể cả khi đó là việc của người khác.",
    NGUOI_LON: "{ChuThe} muốn có đủ thông tin rồi mới quyết, làm kỹ nên ít sai sót. Phải quyết vội khi chưa nắm rõ là tình huống {chuThe} ngại nhất.",
  },
};

/* ── Mạnh / cần để ý / khi nhẹ ───────────────────────────────────────────── */

export type DacDiemTruc = {
  /** Khi trục này NỔI trong hồ sơ — cái được. */
  readonly diemManh: string;
  /** 🔴 Cái giá đi kèm. Không khối nào được để trống: báo cáo toàn lời khen là không đo gì. */
  readonly choCanDeY: string;
  /** 🔴 Khi trục này NHẸ. Bắt buộc nêu cái ĐƯỢC trước, rồi mới tới cái giá. */
  readonly khiNhe: string;
  /**
   * 🔴 KHỐI THỨ TƯ (12.5) — MƯỢN CÁCH CỦA NHÓM KHÁC.
   *
   * Đây là chỗ trả lời câu "vậy làm sao cho cân bằng?" mà không đi ngược ADR-002.
   *
   * "Cân bằng DISC" theo nghĩa *nâng trục thấp lên cho bằng* là một cách đọc sai mô hình,
   * và tệ hơn, nó ngầm nói với một đứa trẻ rằng nó đang thiếu cái gì đó. Nghĩa đúng là
   * **linh hoạt tình huống**: biết khi nào thì mượn cách làm của nhóm khác, dùng xong thì
   * trả lại. Thêm một lựa chọn, không phải vá một chỗ hổng.
   *
   * Vì vậy khối này viết theo khuôn *"có những lúc … thì cách của nhóm X hợp hơn"*, và
   * TUYỆT ĐỐI không dùng từ khuyết thiếu. `tests/noi-dung-moi.test.ts` canh cả hai điều.
   */
  readonly muonCach: string;
};

export const DAC_DIEM_TRUC: Readonly<Record<MaTruc, DacDiemTruc>> = {
  D: {
    diemManh:
      "Việc cần một người khởi động, cần ai đó đứng ra chịu trách nhiệm khi mọi người còn do dự — đó là chỗ {chuThe} phát huy. {ChuThe} cũng chịu được va chạm và bất đồng tốt hơn nhiều người.",
    choCanDeY:
      "Quyết nhanh đôi khi là quyết trước khi nghe hết. {ChuThe} dễ vô tình cắt lời người nói chậm, và sự thẳng thắn dễ bị hiểu thành gay gắt. Hỏi lại một câu trước khi chốt thường đủ để tránh chuyện đó.",
    khiNhe:
      "Nhẹ ở nhóm này không phải là {chuThe} không dám lên tiếng. Thường {chuThe} không thấy cần phải thắng trong mọi chuyện, nên nhường được những thứ người khác phải tranh nhau. Cái giá đi kèm: đến lúc thật sự cần lên tiếng cho mình thì {chuThe} hay chờ quá lâu.",
    muonCach:
      "Có những lúc việc không cần ai quyết nhanh — nó cần mọi người thấy mình được hỏi. Những lúc đó cách của nhóm Ổn định hợp hơn: chờ thêm một nhịp, để người khác nói hết, rồi mới chốt. Dùng xong thì trả lại, không phải đổi người.",
  },
  I: {
    diemManh:
      "Chỗ nào cần làm cho không khí ấm lên, cần thuyết phục người khác cùng làm, cần một người để ý tới cảm giác của cả nhóm — {chuThe} làm việc đó rất tự nhiên.",
    choCanDeY:
      "Câu chuyện hay dễ lấn mất phần việc phải xong. {ChuThe} cũng dễ nhận lời quá nhiều vì ngại làm người khác thất vọng, rồi vỡ kế hoạch của chính mình.",
    khiNhe:
      "Nhẹ ở nhóm này không phải là {chuThe} không có bạn. Thường {chuThe} chọn ít bạn mà thân, và không cần được chú ý mới thấy yên tâm. Cái giá đi kèm: chỗ đông người lạ làm {chuThe} tốn sức hơn hẳn, nên về nhà thường cần một quãng yên tĩnh.",
    muonCach:
      "Có những lúc câu chuyện không giúp được gì — việc cần một danh sách và một thứ tự. Những lúc đó cách của nhóm Cẩn trọng hợp hơn: viết ra, sắp thứ tự, làm từng cái. Mượn đúng lúc, không phải mượn mãi.",
  },
  S: {
    diemManh:
      "Việc cần làm đều đặn, cần giữ đúng lời, cần một người không bỏ ngang giữa chừng — {chuThe} là chỗ dựa. {ChuThe} cũng nghe được lâu hơn phần lớn mọi người trước khi sốt ruột.",
    choCanDeY:
      "Nhường nhiều quá thì phần của mình bị bỏ quên, và chỗ ấm ức đó tích lại chứ không tự mất đi. {ChuThe} cũng cần thêm thời gian để quen với thay đổi, nên bị giục là càng chậm.",
    khiNhe:
      "Nhẹ ở nhóm này thường đi cùng chuyện {chuThe} không bị mắc kẹt khi kế hoạch đổi — đổi thì đổi, {chuThe} xoay được ngay. Cái giá đi kèm: việc phải làm đều đặn mỗi ngày dễ làm {chuThe} chán trước khi kịp thấy kết quả.",
    muonCach:
      "Có những lúc giữ hoà khí lại làm chuyện kéo dài thêm. Những lúc đó cách của nhóm Chủ động hợp hơn: nói thẳng điều mình muốn, và chấp nhận là câu nói đó sẽ làm ai đó khó chịu một lúc.",
  },
  C: {
    diemManh:
      "Chỗ nào sai một chi tiết là hỏng cả việc, chỗ nào cần người soát lại lần cuối — {chuThe} giữ được mức kỹ lưỡng mà người khác dễ bỏ qua.",
    choCanDeY:
      "Muốn đúng tuyệt đối thì dễ chậm, và dễ tự trách khi kết quả chưa như ý. {ChuThe} cũng có thể vô tình làm người xung quanh thấy mình đang bị soi.",
    khiNhe:
      "Nhẹ ở nhóm này thường đi cùng chuyện {chuThe} bắt tay vào làm nhanh, không sa đà vào tiểu tiết, nên khởi động dễ hơn nhiều người. Cái giá đi kèm: những chỗ đòi chính xác thì {chuThe} dễ bỏ sót và phải làm lại.",
    muonCach:
      "Có những lúc chờ đủ thông tin nghĩa là chờ quá muộn. Những lúc đó cách của nhóm Chủ động hợp hơn: quyết với thứ đang có, và tính sẵn đường sửa nếu sai. Không phải bỏ sự kỹ càng — chỉ là biết lúc nào tạm cất nó đi.",
  },
};

/* ── Cường độ — ĐÚNG MỘT MỆNH ĐỀ ─────────────────────────────────────────── */

/**
 * 🔴 CHỈ ĐƯỢC DÙNG LÀM MỘT MỆNH ĐỀ THÊM VÀO, KHÔNG BAO GIỜ ĐỂ RẼ SANG MẠCH VĂN KHÁC.
 *
 * Phép đo quá thô để đỡ một thang nhiều nấc — một nấc trả lời dịch điểm chuẩn hoá 4–10
 * điểm tuỳ bộ đề (chi tiết ở `NGUONG_NOI_RO` trong `disc-nguong.ts`). Nên ngưỡng chắc chắn
 * có lúc đoán sai, và thiết kế phải chịu được việc đó: sai thì mất hoặc thừa MỘT CÂU, chứ
 * không phải người dùng nhận một bản báo cáo khác nghĩa.
 *
 * Chỉ hiện khi `noiRo()` đúng, tức là điểm đạt ngưỡng VÀ cách trục kế đủ xa.
 */
export const MUC_DO_RO: Readonly<Record<MaTruc, string>> = {
  D: "Nhóm này nổi hẳn lên chứ không chỉ nhỉnh hơn một chút — người xung quanh nhận ra sự chủ động của {chuThe} gần như ngay lập tức.",
  I: "Nhóm này nổi hẳn lên chứ không chỉ nhỉnh hơn một chút — sức hút của {chuThe} với người khác là thứ khó bỏ qua.",
  S: "Nhóm này nổi hẳn lên chứ không chỉ nhỉnh hơn một chút — sự điềm đạm của {chuThe} là thứ người xung quanh dựa vào.",
  C: "Nhóm này nổi hẳn lên chứ không chỉ nhỉnh hơn một chút — mức kỹ lưỡng của {chuThe} vượt hẳn mức thông thường.",
};

/* ── Cặp pha CÓ THỨ TỰ ───────────────────────────────────────────────────── */

/**
 * 🔴 SỬA LỖI "DI ĐỌC Y HỆT ID".
 *
 * `maKieuTu()` trong `dien-giai.ts` sắp cặp pha về thứ tự cố định D-I-S-C, nên mười hai cặp
 * có thứ tự bị gộp còn sáu khoá. Hệ quả: hồ sơ *D trội, I phụ* và hồ sơ *I trội, D phụ* —
 * hai người khác hẳn nhau — đọc được đúng một bản văn. Bảng này giữ lại thứ tự.
 *
 * Cố ý KHÔNG đụng vào `maKieuTu()` và `xepKieu()`: `tests/cham-diem.test.ts` khẳng định
 * `cap` luôn theo thứ tự D-I-S-C, và đó là hành vi đúng của tầng chấm điểm. Thứ tự trội/phụ
 * lấy từ `xepHang`, không lấy từ `cap`.
 *
 * `tieuDeNgan` dành riêng cho tấm ảnh PNG 1080×1350. Canvas KHÔNG báo lỗi khi chữ tràn
 * khung (đã trả giá) — nhan đề dài đẩy cỡ chữ tụt xuống rồi bị cắt, và dòng thứ ba đè lên
 * biểu đồ vì khối kết quả cao cố định. Ảnh phải dùng bản ngắn.
 */
export type KhoiPha = {
  readonly tieuDe: string;
  /** Bản ngắn cho ảnh chia sẻ. Giữ ngắn hơn hoặc bằng "Pha giữa Chủ động và Ảnh hưởng". */
  readonly tieuDeNgan: string;
  readonly than: string;
};

export const THU_TU_PHA: Readonly<Record<string, KhoiPha>> = {
  DI: {
    tieuDe: "Chủ động dẫn đường, Ảnh hưởng đi kèm",
    tieuDeNgan: "Chủ động + Ảnh hưởng",
    than: "{ChuThe} quyết nhanh và kéo được người khác đi cùng. Lời {chuThe} nói ra vừa dứt khoát vừa dễ nghe.",
  },
  ID: {
    tieuDe: "Ảnh hưởng dẫn đường, Chủ động đi kèm",
    tieuDeNgan: "Ảnh hưởng + Chủ động",
    than: "{ChuThe} kéo người khác đi cùng bằng sự hào hứng trước, rồi mới tới phần dứt khoát. {ChuThe} thuyết phục nhiều hơn là ra lệnh.",
  },
  DS: {
    tieuDe: "Chủ động dẫn đường, Ổn định đi kèm",
    tieuDeNgan: "Chủ động + Ổn định",
    than: "{ChuThe} dứt khoát nhưng không nóng. Nhận phần khó rồi làm đều tay cho tới lúc xong.",
  },
  SD: {
    tieuDe: "Ổn định dẫn đường, Chủ động đi kèm",
    tieuDeNgan: "Ổn định + Chủ động",
    than: "Điềm đạm là nền của {chuThe}, nhưng đến lúc cần thì {chuThe} đứng ra và nói thẳng.",
  },
  DC: {
    tieuDe: "Chủ động dẫn đường, Cẩn trọng đi kèm",
    tieuDeNgan: "Chủ động + Cẩn trọng",
    than: "{ChuThe} quyết nhanh trên cơ sở đã xem kỹ. Ít khi quyết bừa, và cũng ít khi đổi ý giữa chừng.",
  },
  CD: {
    tieuDe: "Cẩn trọng dẫn đường, Chủ động đi kèm",
    tieuDeNgan: "Cẩn trọng + Chủ động",
    than: "{ChuThe} soát cho chắc trước, dứt khoát sau. Đã ra tay là lúc {chuThe} thấy đã đủ chắc.",
  },
  IS: {
    tieuDe: "Ảnh hưởng dẫn đường, Ổn định đi kèm",
    tieuDeNgan: "Ảnh hưởng + Ổn định",
    than: "{ChuThe} vui vẻ dễ gần mà vẫn giữ được nhịp. Ở cạnh {chuThe} người khác thấy thoải mái.",
  },
  SI: {
    tieuDe: "Ổn định dẫn đường, Ảnh hưởng đi kèm",
    tieuDeNgan: "Ổn định + Ảnh hưởng",
    than: "Điềm đạm là nền, sự ấm áp là phần nổi. {ChuThe} gắn kết mọi người mà không cần đứng ở giữa.",
  },
  IC: {
    tieuDe: "Ảnh hưởng dẫn đường, Cẩn trọng đi kèm",
    tieuDeNgan: "Ảnh hưởng + Cẩn trọng",
    than: "{ChuThe} nói được và cũng làm kỹ. Trình bày rõ ràng vì đã chuẩn bị rõ ràng.",
  },
  CI: {
    tieuDe: "Cẩn trọng dẫn đường, Ảnh hưởng đi kèm",
    tieuDeNgan: "Cẩn trọng + Ảnh hưởng",
    than: "Kỹ lưỡng là ưu tiên của {chuThe}, nhưng {chuThe} biết cách nói cho người khác hiểu được cái mình đã soát.",
  },
  SC: {
    tieuDe: "Ổn định dẫn đường, Cẩn trọng đi kèm",
    tieuDeNgan: "Ổn định + Cẩn trọng",
    than: "{ChuThe} làm đều đặn và chỉn chu. Việc gì cũng tới nơi, ít ồn ào.",
  },
  CS: {
    tieuDe: "Cẩn trọng dẫn đường, Ổn định đi kèm",
    tieuDeNgan: "Cẩn trọng + Ổn định",
    than: "Chuẩn mực là chính, kiên nhẫn đi kèm. {ChuThe} không vội và cũng không cẩu thả.",
  },
};

/* ── Tiêu đề các lớp mới trên màn kết quả ────────────────────────────────── */

export const TIEU_DE_LOP = {
  phoBonNhom: "Đọc sâu hơn về từng nhóm",
  noiChuyen: "Nói chuyện với {chuThe} thế nào",
  cangThang: "Khi {chuThe} căng thẳng",
  linhHoat: "Nên linh hoạt ở đâu",
  nheNhat: "Nhóm nhẹ nhất",
  noiNhat: "Nhóm nổi nhất",
  cauNenNoi: "Câu nên nói",
  cauNenTranh: "Câu nên tránh",
  motViec: "Một việc làm được ngay:",
} as const;
