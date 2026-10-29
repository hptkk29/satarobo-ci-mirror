/**
 * NGÂN SÁCH THỜI GIAN THẬT của việc xem một video.
 *
 * Hàm THUẦN — không DB, không đồng hồ. `ghiNhipXem` truyền `now`, mốc phát vé và mốc ngân sách đã lưu vào, nhận
 * về số giây nội dung được phép cộng, rồi ghi lại mốc mới. Thuật toán gộp bitmap không đổi.
 *
 * ── Bất biến duy nhất mà server có thể bảo đảm ────────────────────────────────────────────────────────────
 *
 *   nội dung được ghi nhận  ≤  tốc độ tối đa × (now − thời điểm phát vé) + DUNG_SAI
 *
 * · Tốc độ tối đa là trần của LƯỢT GIAO (`maxPlaybackRate`, mặc định 1.5) — KHÔNG BAO GIỜ là `tocDo` client khai.
 * · Mọi mốc đều là đồng hồ SERVER. Vé do server ký nên `iat` không thể sớm hơn lúc trang học thật sự dựng xong.
 * · Nội dung ghi nhận đo bằng số giây ĐOẠN MỚI được bật (`giayMoi`), không phải độ dài khoảng khai: khoảng khai
 *   ngắn mà chạm biên đoạn vẫn bật cả đoạn 5 giây, nên đo theo khoảng khai là để lọt kiểu "nhịp bụi".
 *
 * Nó KHÔNG chứng minh được người đang nhìn video (trình duyệt không chứng minh được điều đó, MP4 cũng như
 * YouTube). Nó chứng minh một điều nhỏ hơn: không ai hoàn thành video dài L giây sớm hơn (L − DUNG_SAI) / tốc độ
 * tối đa giây KỂ TỪ LÚC MỞ TRANG — dù gửi nhịp một lần hay một trăm lần, một tab hay hai tab, vé mới hay vé cũ.
 *
 * ── Dạng toán: GCRA (thùng rò) với MỘT mốc `tat` cho mỗi (người, bài) ─────────────────────────────────────
 *
 *   base    = max(tat, thời điểm phát vé, now − CUA_SO_GIAY)
 *   cho phép = tốc độ × (now − base) + DUNG_SAI × tốc độ        (nội dung, giây)
 *   sau khi ghi `c` giây:  tat := base + c / tốc độ
 *
 * Mỗi giây nội dung ghi nhận "tiêu" 1/tốc độ giây của mốc `tat`; `tat` không bao giờ lùi, nên tổng nội dung của một
 * chuỗi nhịp không thể vượt `tốc độ × (now − base đầu chuỗi) + DUNG_SAI` — bất kể tần suất nhịp. `tat` dùng chung
 * cho mọi tab vì khoá theo (người, bài), nên hai tab chia nhau MỘT ngân sách.
 *
 * ── Ba tham số, mỗi cái có một lý do và một ca test canh nó ───────────────────────────────────────────────
 *
 * 1. `CUA_SO_GIAY` — ngân sách KHÔNG tích vô hạn trong lúc im lặng. Nghỉ 4 phút rồi bắn dồn nhịp chỉ tiêu được tối đa
 *    `tốc độ × CUA_SO_GIAY + dung sai`, không phải 4 phút. 30 = hai chu kỳ nhịp: mạng kẹt tới 15 giây (một nhịp tới
 *    muộn, nhịp sau tới đúng giờ) KHÔNG làm mất giây nào; kẹt lâu hơn thì phần vượt cửa sổ không được bù
 *    (mất tối đa tốc độ × (thời gian kẹt − 15) giây nội dung, MỘT lần cho mỗi lần kẹt — ca `[VTB-04]`). Cửa sổ này
 *    KHÔNG liên quan tới phiên xem thống kê (`TrnVideoSession`, 5 phút) và không đổi định nghĩa đó.
 * 2. `DUNG_SAI_GIAY` — độ trễ MẠNG chênh nhau giữa hai nhịp (nhịp trước tới trễ, nhịp sau tới đúng giờ ⇒ khoảng cách
 *    tới nơi ngắn hơn khoảng cách phát). Cộng MỘT LẦN cho cả chuỗi (không phải mỗi nhịp) vì `tat` bị tính đủ phần đã
 *    ghi. 2 giây thực = 3 giây nội dung ở 1.5x: đó là TOÀN BỘ phần video ngắn có thể "hoàn thành sớm" nhờ dung sai.
 * 3. Trần mỗi nhịp `TRAN_DELTA_GIAY` (25) nằm ở `segment-bitmap.ts` — một nhịp không bao giờ mang quá 25 giây.
 */

/** Cửa sổ tối đa ngân sách được tích trong im lặng (giây thực). Xem đầu tệp. */
export const CUA_SO_GIAY = 30;
/** Độ chênh trễ mạng chấp nhận được giữa hai nhịp (giây thực). Xem đầu tệp. */
export const DUNG_SAI_GIAY = 2;

/** Dung sai tính BẰNG NỘI DUNG: giây thực × tốc độ tối đa. Ở 1.5x = 3 giây, ở 1x = 2 giây. */
export function dungSaiNoiDung(tocDoToiDa: number): number {
  return tocDoToiDa * DUNG_SAI_GIAY;
}

export type NganSach = {
  /** Số giây NỘI DUNG còn được ghi nhận lúc `now` — chưa kẹp trần mỗi nhịp, không âm. */
  ngan: number;
  /** Mốc xuất phát của phép tính (epoch ms) — đưa lại cho `tatSauKhiGhi`. */
  base: number;
};

export function nganGiay(i: {
  now: Date;
  /** Mốc `tat` đã lưu của (người, bài); `null` = chưa có. */
  tat: Date | null;
  /** Mốc phát vé của NHỊP NÀY (epoch ms) — `thoiDiemPhatVe`, đã kẹp trên `now`. */
  phatVeMs: number;
  /** Trần tốc độ của LƯỢT GIAO — không bao giờ lấy từ thân yêu cầu. */
  tocDoToiDa: number;
}): NganSach {
  const nowMs = i.now.getTime();
  const base = Math.max(i.tat?.getTime() ?? Number.NEGATIVE_INFINITY, Math.min(i.phatVeMs, nowMs), nowMs - CUA_SO_GIAY * 1000);
  // KHÔNG kẹp `(now − base)` ở 0: `tat` nhỉnh hơn `now` (đã tiêu trước) làm ngân sách THẤP hơn dung sai — đó chính là
  // cách một khoản dùng quá mức được trừ lại ở nhịp sau.
  const ngan = i.tocDoToiDa * ((nowMs - base) / 1000) + dungSaiNoiDung(i.tocDoToiDa);
  return { ngan: Math.max(0, ngan), base };
}

/** Mốc `tat` mới sau khi ghi `giayMoi` giây nội dung. */
export function tatSauKhiGhi(i: { base: number; giayMoi: number; tocDoToiDa: number }): Date {
  return new Date(i.base + (i.giayMoi / i.tocDoToiDa) * 1000);
}

/**
 * Chọn điểm kết thúc của khoảng được nhận sao cho số giây ĐOẠN MỚI không vượt `ngan`.
 *
 * Ngân sách chỉ đo phần ĐƯỢC GHI (đoạn mới bật), KHÔNG đo độ dài khoảng khai: người xem đi lại khoảng đã ghi (ví dụ
 * nhịp mang câu trả lời thách thức, xem lại đoạn cũ) không tốn ngân sách, còn kẻ khai khoảng ngắn vắt qua ranh giới
 * đoạn (`gopNhipXem` bật cả đoạn 5 giây chứa điểm bắt đầu) vẫn bị tính đủ 5 giây.
 *
 * Thử `denSec`, rồi lùi dần về từng RANH GIỚI đoạn cho tới khi vừa; không vừa ranh giới nào thì không ghi gì
 * (`denNhan = tuSec`).
 *
 * Lùi về ranh giới (không phải điểm bất kỳ) là chủ ý: `gopNhipXem` luôn bật đoạn chứa `tuSec`, nên nhịp kế tiếp bắt
 * đầu đúng ranh giới này sẽ bật đoạn kế tiếp — không đoạn nào bị bỏ rơi giữa hai nhịp.
 *
 * @returns `denNhan`: điểm kết thúc đã được nhận (≤ `denSec`, ≤ `tuSec + tranNhip`). Trình phát đặt mốc nhịp sau tại
 *   đây, nên phần chưa được nhận được xin lại — người xem trung thực không mất giây nào, chỉ được ghi nhận CHẬM nếu
 *   nhịp tới sớm hơn dự kiến. `haVeNgan` = điểm nhận bị lùi VÌ ngân sách (khác với bị kẹp bởi trần mỗi nhịp).
 */
export function khopNganSach<G extends { giayMoi: number }>(i: {
  tuSec: number;
  denSec: number;
  ngan: number;
  doanGiay: number;
  /** Trần ĐỘ DÀI khoảng của một nhịp (`TRAN_DELTA_GIAY`) — `thu` đã kẹp theo nó; điểm nhận cũng không vượt `tuSec + tranNhip`. */
  tranNhip: number;
  /** Chạy gộp bitmap với điểm kết thúc đã cho (đã bao gồm trần mỗi nhịp). */
  thu: (denSec: number) => G;
}): { gop: G; denNhan: number; haVeNgan: boolean } {
  const kep = (den: number) => Math.max(i.tuSec, Math.min(den, i.tuSec + i.tranNhip));
  const dau = i.thu(i.denSec);
  if (dau.giayMoi <= i.ngan) return { gop: dau, denNhan: kep(i.denSec), haVeNgan: false };

  // Bắt đầu từ ranh giới thấp hơn điểm ĐÃ KẸP — các điểm cao hơn trần mỗi nhịp cho cùng kết quả với điểm kẹp.
  const tran = kep(i.denSec);
  let ranh = Math.floor(tran / i.doanGiay) * i.doanGiay;
  if (ranh >= tran) ranh -= i.doanGiay;
  for (; ranh > i.tuSec; ranh -= i.doanGiay) {
    const g = i.thu(ranh);
    if (g.giayMoi <= i.ngan) return { gop: g, denNhan: ranh, haVeNgan: true };
  }
  return { gop: i.thu(i.tuSec), denNhan: i.tuSec, haVeNgan: true };
}
