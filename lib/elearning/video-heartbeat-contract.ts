import { z } from "zod";

/**
 * EL-12a — HỢP ĐỒNG NHỊP XEM VIDEO.
 *
 * Tệp này KHÔNG chạm DB, không chạm mạng. Nó tồn tại để khoá hai đầu khỏi trôi
 * khỏi nhau: trình phát (EL-11) TIÊU THỤ hợp đồng này, còn đường ghi (EL-12b)
 * SINH RA nó.
 *
 * ⚠️ Vì sao tách ra và làm TRƯỚC cả hai: thứ tự trong tài liệu là EL-11 rồi
 * EL-12, nhưng trình phát phải nhận trường `thachThuc` do heartbeat bơm xuống và
 * phải xử năm mã lỗi của nó. Làm trình phát trước khi chốt hợp đồng là dựng một
 * đường điều khiển riêng rồi phải gỡ.
 *
 * ⚠️ Trần tốc độ phát 1.5x và chặn tua tới là hai trong tám cơ chế chống học đối
 * phó (QĐ-CDA-04). Cả hai kiểm ở SERVER — kiểm ở trình phát chỉ là gợi ý, vì
 * client là thứ người ta sửa được.
 */

export const TOC_DO_TOI_DA = 1.5;
/** Vé phát sống 30 phút; khoá chống xem song song sống 30 giây, gia hạn bằng chính nhịp. */
export const KHOA_PHAT_TTL_GIAY = 30;

// ── Thân yêu cầu ───────────────────────────────────────────────────────────

export const nhipXemSchema = z
  .object({
    /** Vé phát HMAC — thay cho việc tra lại quyền mỗi nhịp. */
    ve: z.string().min(1),
    enrollmentId: z.string().min(1),
    lessonId: z.string().min(1),
    /** Khoảng vừa xem trong nhịp này. */
    tuSec: z.number().min(0),
    denSec: z.number().min(0),
    /** Số thứ tự nhịp, tăng dần trong một phiên. Dùng để bỏ nhịp đến muộn. */
    seq: z.number().int().min(0),
    /** Tốc độ phát người học đang đặt. */
    tocDo: z.number().min(0.25).max(4),
    /** Tab có đang hiện không — cơ chế "tự dừng khi rời tab". */
    tabHien: z.boolean(),
    /** Vị trí con trỏ hiện tại, để phát hiện tua tới. */
    viTriSec: z.number().min(0),
    /**
     * Trả lời thách thức, nếu nhịp trước có hỏi.
     *
     * ⚠️ Là OBJECT chứ không phải chuỗi id, vì hai loại thách thức cần hai thứ
     * khác nhau: điểm kiểm tra tập trung chỉ cần biết người học CÒN Ở ĐÂY (id là
     * đủ), còn câu hỏi chèn giữa video cần biết họ CHỌN GÌ.
     *
     * ⚠️ `dapAn` là LỰA CHỌN, không phải kết luận đúng/sai. Nhận "đúng/sai" từ
     * client là để người ta gửi thẳng `{dung:true}` và bỏ qua cả cơ chế.
     */
    traLoiThachThuc: z
      .union([
        z.null(),
        z
          .object({
            id: z.string().min(1).max(200),
            dapAn: z.union([z.null(), z.string().max(200)]).optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

export type NhipXemInput = z.infer<typeof nhipXemSchema>;

// ── Thân phản hồi ──────────────────────────────────────────────────────────

export type TrangThaiNhip = "GHI_NHAN" | "BO_QUA" | "CHO_TRA_LOI";

export type ThachThuc = {
  /** `ATTENTION` = điểm kiểm tra tập trung; `CUE` = câu hỏi chèn giữa video. */
  loai: "ATTENTION" | "CUE";
  id: string;
  cauHoi: string;
  /**
   * Hạn trả lời, giây. `null` = KHÔNG có hạn.
   *
   * ⚠️ Cue chặn CỐ Ý không có hạn. Chép nhánh hết-hạn của điểm kiểm tra tập trung
   * sang đây là hỏng nặng: nhánh đó gỡ câu treo rồi CHO ĐI TIẾP, nên "chờ 45 giây"
   * trở thành đường bỏ qua MỌI câu hỏi — và triệu chứng là mọi thứ vẫn trả 200,
   * không ai thấy gì bất thường.
   */
  hanGiay: number | null;
  /**
   * Lựa chọn để người học bấm. Rỗng với `ATTENTION` (chỉ cần xác nhận có mặt).
   *
   * ⚠️ CHỈ nhãn và mã. Đáp án đúng KHÔNG BAO GIỜ đi xuống đây — nó sẽ nằm trong
   * tab Network, và cơ chế bị vô hiệu bằng một cú F12.
   */
  luaChon: { ma: string; nhan: string }[];
  /** `true` = video phải DỪNG cho tới khi trả lời. */
  chan: boolean;
  /**
   * `true` = câu cho chọn NHIỀU ý.
   *
   * ⚠️ Gửi tường minh, không để trình phát suy từ số lựa chọn. Bản đầu suy bằng
   * `luaChon.length > 2`, nên một câu MỘT-đáp-án có 3 lựa chọn trở lên biến thành
   * ô tích nhiều — người học tích hai ý, và câu họ trả lời đúng bị chấm sai.
   */
  chonNhieu?: boolean;
  /** Giây trong video mà câu hỏi này neo vào. Chỉ có với `CUE`. */
  atSec?: number;
};

export type NhipXemKetQua = {
  coveredSec: number;
  coveragePercent: number;
  status: TrangThaiNhip;
  meta: { seq: number };
  /** Có thì trình phát phải DỪNG và hỏi người học. */
  thachThuc?: ThachThuc;
  /** Nhịp bị cắt vì vượt trần delta — trình phát không cần xử, chỉ để ghi cờ. */
  biCatTran?: boolean;
  /**
   * Câu vừa trả lời SAI. Thách thức được gửi LẠI kèm cờ này.
   *
   * ⚠️ Trả lời sai KHÔNG phải lỗi HTTP. Nó là 200 kèm chính câu hỏi đó, vì hai lẽ:
   * (1) trình phát không bao giờ được mất câu hỏi đang treo — mất là người học kẹt
   * với một video dừng và không có gì để bấm; (2) sai rồi cho làm lại là đường
   * BÌNH THƯỜNG của việc học, không phải trạng thái lỗi.
   */
  saiRoi?: boolean;
};

// ── Mã lỗi và ánh xạ HTTP ──────────────────────────────────────────────────

export type MaLoiNhip =
  | "TICKET_INVALID"
  | "SEEK_BLOCKED"
  | "RATE_TOO_HIGH"
  | "SESSION_SUPERSEDED"
  | "PAUSED_ATTENTION"
  | "DUE_PASSED"
  | "POLICY_NOT_ACCEPTED"
  | "REVOKED";

/**
 * Mỗi mã một mã HTTP, khai TƯỜNG MINH.
 *
 * ⚠️ Đừng gộp mọi lỗi thành 400. Trình phát phải phân biệt được "dừng hẳn" (403)
 * với "thử lại sau khi xử xong" (409) — gộp lại thì nó hoặc thử lại mãi một lỗi
 * không thể tự khỏi, hoặc bỏ cuộc trên một lỗi chỉ cần trả lời một câu hỏi.
 */
export const HTTP_CUA_LOI: Record<MaLoiNhip, number> = {
  TICKET_INVALID: 403,
  POLICY_NOT_ACCEPTED: 403,
  REVOKED: 403,
  DUE_PASSED: 409,
  SEEK_BLOCKED: 409,
  SESSION_SUPERSEDED: 409,
  PAUSED_ATTENTION: 409,
  RATE_TOO_HIGH: 409,
};

export const THONG_BAO_LOI: Record<MaLoiNhip, string> = {
  TICKET_INVALID: "Phiên xem đã hết hạn — tải lại trang để tiếp tục",
  POLICY_NOT_ACCEPTED: "Cần xác nhận chính sách theo dõi tiến độ trước khi xem",
  REVOKED: "Lượt học này đã bị thu hồi",
  DUE_PASSED: "Đã quá hạn — liên hệ Đào tạo để được gia hạn",
  SEEK_BLOCKED: "Khoá này không cho tua tới phần chưa xem",
  SESSION_SUPERSEDED: "Bài này đang được xem trên thiết bị khác",
  PAUSED_ATTENTION: "Trả lời câu hỏi trên màn hình để tiếp tục",
  RATE_TOO_HIGH: `Tốc độ phát tối đa là ${TOC_DO_TOI_DA}x`,
};

/** Lỗi nào trình phát nên thử lại sau khi người học xử xong. */
export function coTheThuLai(ma: MaLoiNhip): boolean {
  return HTTP_CUA_LOI[ma] === 409;
}

// ── Ba quyết định thuần mà cả hai đầu phải hiểu giống nhau ─────────────────

/**
 * Cơ chế "chặn tua tới": nhảy tới vùng CHƯA xem thì từ chối.
 *
 * Tua LÙI luôn được — xem lại là hành vi học bình thường. Tua tới trong vùng ĐÃ
 * xem cũng được, vì không ai gian lận bằng cách nhảy tới chỗ mình đã xem rồi.
 *
 * ⚠️ SO BẰNG ĐIỂM BẮT ĐẦU của khoảng vừa xem (`tuSec`), KHÔNG bằng vị trí con trỏ.
 * Đây là chỗ bản đầu của hàm này sai, và sai theo hướng chặn đứng cả sản phẩm:
 * con trỏ LUÔN chạy trước mốc đã ghi, vì mốc chỉ được cập nhật ở cuối mỗi nhịp.
 * Với nhịp 15 giây thì mọi nhịp bình thường đều trông như "nhảy tới 15 giây chưa
 * xem" — kể cả nhịp ĐẦU TIÊN của mọi bài (con trỏ ở giây 10, mốc còn 0). Người
 * học sẽ không xem nổi một video nào, và lỗi hiện ra là "khoá này không cho tua
 * tới" — một câu không liên quan gì tới việc họ vừa làm.
 *
 * Điểm bắt đầu thì khác: phát liên tục nghĩa là nhịp sau bắt đầu ĐÚNG chỗ nhịp
 * trước dừng, nên nó bám sát mốc đã xem. Chỉ khi người ta kéo con trỏ đi thì
 * khoảng vừa xem mới bắt đầu ở một chỗ xa hơn mốc.
 */
export function chanTuaToi(input: {
  /** Điểm BẮT ĐẦU khoảng vừa xem trong nhịp này. */
  batDauSec: number;
  maxDaXemSec: number;
  chanTua: boolean;
  /** Dung sai: trình phát báo vị trí lệch vài trăm mili giây là bình thường. */
  dungSaiSec?: number;
}): boolean {
  if (!input.chanTua) return false;
  const dungSai = input.dungSaiSec ?? 2;
  return input.batDauSec > input.maxDaXemSec + dungSai;
}

/**
 * Cơ chế "trần tốc độ phát".
 *
 * ⚠️ Kiểm ở SERVER. Trình phát khoá nút chọn tốc độ là gợi ý — client là thứ
 * người ta sửa được, và `video.playbackRate = 4` gõ trong bảng điều khiển là hết.
 */
export function vuotTranTocDo(tocDo: number, tran = TOC_DO_TOI_DA): boolean {
  // Dung sai nhỏ: trình duyệt trả 1.5000000000000002 là chuyện thường.
  return tocDo > tran + 0.01;
}

export type QuyetDinhKhoaPhat =
  | { cho: true; backend: string }
  | { cho: false; ma: "SESSION_SUPERSEDED" };

/**
 * Cơ chế "chống xem song song": khoá phát theo người học.
 *
 * 🔴 QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN 24/08 — Redis chết thì VẪN CHO HỌC.
 *
 * Đặc tả có hai đoạn nói ngược nhau (§5.11 mục 18 đòi từ chối phát; TS-42 ⑦ đòi
 * vẫn xem được). Chủ dự án chốt fail-open cho việc học: một sự cố hạ tầng không
 * được biến thành cả công ty ngừng học, nhất là khi khoá tuân thủ có hạn chót
 * cứng và người học sẽ bị tính quá hạn vì lỗi không phải của họ.
 *
 * Cái giá được nhận: có một cửa sổ gian lận trong lúc Redis hỏng. Đổi lại, hàm
 * này TRẢ VỀ `backend` để đường gọi ghi log đếm được — không được nuốt im lặng.
 */
export function quyetDinhKhoaPhat(input: {
  backend: string;
  khoaThuocNguoiKhac: boolean;
}): QuyetDinhKhoaPhat {
  if (input.backend !== "upstash") {
    // Không có khoá dùng chung ⇒ không kết luận được gì. Cho học, và để đường
    // gọi đếm số lượt rơi vào đây.
    return { cho: true, backend: input.backend };
  }
  if (input.khoaThuocNguoiKhac) return { cho: false, ma: "SESSION_SUPERSEDED" };
  return { cho: true, backend: input.backend };
}

/**
 * Nhịp đến MUỘN (seq nhỏ hơn seq đã ghi) thì bỏ qua.
 *
 * Mạng chậm làm nhịp tới không đúng thứ tự. Xử một nhịp cũ sau một nhịp mới là
 * ghi đè vị trí bằng dữ liệu quá khứ, và trình phát sẽ thấy tiến độ nhảy lùi.
 */
export function nhipDenMuon(seqNhan: number, seqDaGhi: number): boolean {
  return seqNhan <= seqDaGhi;
}
