/**
 * lib/cham-cong/cum-quet.ts — chia đoạn WORK thành các CỤM QUÉT kỳ vọng.
 *
 * THUẦN: không `@/lib/db`, không `next/*`, không đọc đồng hồ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TỒN TẠI
 *
 * Engine đang gộp cụm bằng `mergeIntervals` — tức theo **TÍNH LIỀN KỀ** của đoạn WORK.
 * Nó ra ĐÚNG kết quả hôm nay, nhưng **VÌ LÝ DO KHÁC**: khoảng nghỉ-không-tính hiện không
 * thuộc đoạn nào, nên hai bên tự nhiên rời nhau và thành hai cụm.
 *
 * Ngày thêm `UNPAID_BREAK` (đợt sau), khoảng ấy thành một đoạn THẬT. `mergeIntervals` nối
 * liền hai bên lại, `ST` tụt từ 2 cụm xuống 1 — và **KHÔNG ca test nào đỏ**, vì chẳng ca
 * nào từng khẳng định "ST phải có hai cụm". Đó là lý do `BANG-MA-CA-CHOT.md` xếp
 * `UNPAID_BREAK` và `soCapQuetKyVong` vào CÙNG một đợt.
 *
 * Hàm này gỡ phép suy ấy ra khỏi hình dạng dữ liệu: số cụm do **danh mục KHAI**, không do
 * các đoạn tình cờ rời nhau.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIẾT KẾ — chủ dự án duyệt nguyên văn (BANG-MA-CA-CHOT.md)
 *
 * | | |
 * |---|---|
 * | `0` | không kiểm quét, không cờ |
 * | `1` | gom **mọi** đoạn WORK thành **một cụm**: vào = `start` đoạn ĐẦU, ra = `end` đoạn CUỐI |
 * | `2` | **hai cụm**, cắt ở **khoảng hở LỚN NHẤT** giữa các đoạn WORK |
 */

/** Phút tính từ 00:00 giờ VN. */
export type Doan = { start: number; end: number };

/** Một cụm quét kỳ vọng: người ta phải có một cặp vào–ra phủ được khoảng này. */
export type CumQuet = {
  /** Mốc VÀO kỳ vọng — `start` của đoạn WORK đầu trong cụm. */
  start: number;
  /** Mốc RA kỳ vọng — `end` của đoạn WORK cuối trong cụm. */
  end: number;
};

/**
 * @param doanWork các đoạn WORK của ca (KHÔNG gồm nghỉ). Thứ tự bất kỳ.
 * @param soCap    `ShiftTemplate.soCapQuetKyVong` — 0 / 1 / 2.
 */
export function cumQuetKyVong(
  doanWork: readonly Doan[],
  soCap: 0 | 1 | 2,
): CumQuet[] {
  if (soCap === 0) return [];

  const ds = [...doanWork]
    .filter((d) => d.end > d.start)
    .sort((a, b) => a.start - b.start);
  if (ds.length === 0) return [];

  const motCum = (tu: Doan[]): CumQuet => ({
    start: tu[0]!.start,
    end: Math.max(...tu.map((d) => d.end)),
  });

  if (soCap === 1) return [motCum(ds)];

  // soCap === 2 — cắt ở KHOẢNG HỞ LỚN NHẤT giữa hai đoạn liên tiếp.
  //
  // Một đoạn duy nhất thì KHÔNG có khoảng hở nào để cắt. Trả về MỘT cụm chứ không bịa ra
  // cụm thứ hai: bịa là dựng một mốc quét không có trong ca, và người ta bị đòi một lượt
  // quét cho khoảng thời gian không tồn tại. Danh mục khai 2 cho một ca liền mạch là danh
  // mục SAI — và `catalog.test.ts` đối chiếu bảng chốt là chỗ bắt chuyện đó, không phải đây.
  if (ds.length < 2) return [motCum(ds)];

  let iCat = 1;
  let hoLonNhat = -1;
  for (let i = 1; i < ds.length; i++) {
    const ho = ds[i]!.start - ds[i - 1]!.end;
    // `>` chứ không `>=`: hai khoảng hở BẰNG NHAU thì lấy cái ĐẦU TIÊN. Chọn cái cuối cũng
    // "đúng" như nhau, nhưng phải chọn MỘT cách và giữ nguyên — kẻo cùng một ca ra hai kết
    // quả khác nhau tuỳ thứ tự mảng đầu vào.
    if (ho > hoLonNhat) {
      hoLonNhat = ho;
      iCat = i;
    }
  }
  return [motCum(ds.slice(0, iCat)), motCum(ds.slice(iCat))];
}

/**
 * Nhãn của cụm thứ `i` (0-based) khi có `tong` cụm — dùng cho cờ thiếu lượt.
 *
 * Bảng chốt: cờ `THIEU_BUOI_SANG`/`THIEU_BUOI_CHIEU` chuyển thành *thiếu cụm thứ n*, và
 * **chỉ có nghĩa khi `soCapQuetKyVong ≥ 2`**.
 *
 * ⚠️ GIỮ NGUYÊN TÊN CỜ CŨ. Chúng đã nằm trong `StaffAttendanceDay.flags` của dữ liệu prod,
 * trong `CO_CANH_BAO`, trong `flag-labels.ts`, và trong bộ lọc của màn admin. Đổi tên là
 * một lượt đổi dữ liệu + sáu chỗ đọc, cho một lợi ích bằng không ở đợt này — ghi vé nếu
 * muốn, đừng làm kèm.
 */
export function coThieuCum(i: number): "THIEU_BUOI_SANG" | "THIEU_BUOI_CHIEU" {
  return i === 0 ? "THIEU_BUOI_SANG" : "THIEU_BUOI_CHIEU";
}

/**
 * Có cặp quét nào PHỦ TRỌN một khoảng nghỉ giữa hai cụm kỳ vọng? ⇒ cờ `THIEU_LUOT_GIUA_CA`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TỒN TẠI — `soCapQuetKyVong: 2` một mình KHÔNG đòi được 4 lượt
 *
 * Cổng thiếu-cụm ở `engine.ts:363` bỏ qua cụm nào đã có cặp phủ chồng:
 *
 *     const covered = pairedIntervals.some((p) => overlap(p, blk) > 0);
 *     if (firstIn === undefined && !covered) → gắn cờ thiếu cụm
 *
 * Nên với `HC` khai 2 cụm, MỘT cặp `08:00 → 17:30` phủ chồng cả hai ⇒ `covered = true` ở
 * cụm chiều ⇒ **sạch cờ**, dù người ấy chưa từng quét ở nghỉ trưa. Đo trước bản vá:
 * `run("HC", [IN("08:00"), OUT("17:30")])` với 2 cụm ra `flags: []`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO KHÔNG SIẾT `covered` — hai lý do, cái thứ hai mới nặng
 *
 *  1. Gắn `THIEU_BUOI_SANG`/`THIEU_BUOI_CHIEU` cho người làm TRỌN ngày là nói sai: họ có
 *     mặt cả hai buổi, thứ họ thiếu là **mốc quét giữa ca**. Và "thiếu buổi nào" thì
 *     không có câu trả lời đúng — cặp dài phủ cả hai, chọn buổi nào để trách cũng tuỳ tiện.
 *  2. `noi-quy.ts:130 thieuNuaNgay()` đọc ĐÚNG hai cờ ấy để LOẠI ngày khỏi `caThucTe`.
 *     Mượn chúng là kéo tỷ lệ đạt nội quy của người làm trọn ngày xuống như thể họ bỏ nửa
 *     ngày. Phạt sai người, và phạt im lặng — không màn nào nói vì sao.
 *
 * Cờ riêng nên vào `CO_CANH_BAO` (admin đếm "Ngày có cờ") và `CO_CAN_XU_LY` (site GV: việc
 * người đi làm tự nộp đơn chỉnh công), **KHÔNG** vào `thieuNuaNgay`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LUẬT: **phủ TRỌN** khoảng hở, không phải "chồng lên hai cụm"
 *
 * Chọn "phủ trọn" vì nó khỏi cần ngưỡng và nói đúng một câu kiểm được: *suốt cả giờ nghỉ,
 * người này vẫn đang ở trạng thái "đã vào"*. Hệ quả có chủ đích:
 *
 *   · ra 11:35 / vào 11:36  → **không** cờ. Họ CÓ quét trong giờ nghỉ; muộn 5′ là việc của
 *     `VE_SOM`/`DI_MUON`, không phải của cờ này.
 *   · ra 14:00 (quá trưa)   → **có** cờ. Cặp `[08:00, 14:00]` phủ trọn 11:30–13:30.
 *   · chỉ quét buổi sáng    → **không** cờ NÀY — đã có `THIEU_BUOI_CHIEU`. Hai cờ cố ý
 *     không chồng nhau, kẻo một ngày bị đếm hai lần trong cùng một bảng.
 *
 * @param capDaDong các cặp ĐÃ ĐÓNG (`pairedIntervals` của engine — đã gộp). Cặp còn mở
 *                  không vào đây: ngày ấy đã có `THIEU_LUOT_RA`.
 * @param cum       cụm kỳ vọng, kết quả `cumQuetKyVong`. Dưới 2 cụm ⇒ luôn `false`, nên mọi
 *                  mã khai 0/1 giữ nguyên hành vi.
 */
export function khongQuetGiuaCa(
  capDaDong: readonly Doan[],
  cum: readonly CumQuet[],
): boolean {
  if (cum.length < 2) return false;
  for (let i = 1; i < cum.length; i++) {
    const ho = { start: cum[i - 1]!.end, end: cum[i]!.start };
    // Hai cụm dính nhau (hoặc chồng) thì KHÔNG có giờ nghỉ nào để đòi quét. Đòi ở đây là
    // dựng một mốc không có trong ca — cùng lỗi mà `cumQuetKyVong` từ chối bịa cụm thứ hai.
    if (ho.end <= ho.start) continue;
    if (capDaDong.some((p) => p.start <= ho.start && p.end >= ho.end)) return true;
  }
  return false;
}


/**
 * Ca này có khai được **2 cặp quét** không? = có ít nhất một khoảng hở giữa hai đoạn WORK.
 *
 * Vì sao là một CỔNG chứ chỉ là lời khuyên: `cumQuetKyVong` cố ý **không bịa cụm thứ hai**
 * cho ca liền mạch (bịa là dựng một mốc quét không có trong ca). Nên khai `2` cho ca một
 * đoạn thì nó lặng lẽ chạy như `1` — người vận hành chọn "2 lần chấm", thấy lưu thành công,
 * và tưởng đã siết. Đúng loại lỗi im lặng repo này đã trả giá nhiều lần.
 *
 * Màn Danh mục mã ca gọi hàm này để TỪ CHỐI lưu, kèm câu nói rõ phải làm gì.
 *
 * @param doanWork các đoạn WORK (phút VN). Đoạn `PAID_BREAK` KHÔNG tính là khoảng hở — nghỉ
 *                 có tính công thì không ai phải quét ra/vào giữa nó (`CT`, `CS`).
 */
export function khaiDuocHaiCap(doanWork: readonly Doan[]): boolean {
  const ds = [...doanWork]
    .filter((d) => d.end > d.start)
    .sort((a, b) => a.start - b.start);
  return ds.some((d, i) => i > 0 && d.start > ds[i - 1]!.end);
}
