/**
 * EL-10 — CHUẨN NỘP TỆP cho thư viện media đào tạo nội bộ.
 *
 * ⚠️ Bảng chuẩn RIÊNG, KHÔNG sửa `lib/storage/upload-config.ts`. Trần 500MB ở đó
 * là trần CHUNG của năm module khác; siết nó vì e-learning là đổi luật của người
 * không liên quan, còn nới nó vì e-learning là mở cửa cho cả năm module kia.
 *
 * ⚠️ Chuẩn ở đây CHẶT HƠN trần chung, và có case test khẳng định điều đó — bắt
 * được ngày ai đó "hợp nhất hai bảng cho gọn".
 */

/** Trần dung lượng một video bài học. */
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
/** Trần thời lượng một video bài học — §11 khuyến nghị bài ngắn. */
export const VIDEO_MAX_SEC = 900;
/** Sàn thời lượng: dưới mức này gần như chắc chắn là tải nhầm tệp. */
export const VIDEO_MIN_SEC = 5;

/**
 * Chỉ MP4/H.264. Không nhận `.mov`, `.webm`, `.mkv`.
 *
 * Không phải vì chúng "kém" mà vì mỗi định dạng thêm vào là một tổ hợp
 * trình duyệt × hệ điều hành nữa phải thử — và người phát hiện ra tổ hợp hỏng
 * sẽ là người học, giữa buổi học.
 */
/**
 * Trần ĐỘ PHÂN GIẢI: 720p là **trần**, không phải sàn.
 *
 * Đặc tả viết "H.264 720p" mà không nói chiều nào. Chọn trần vì hai lẽ nằm ngay
 * trong chính đặc tả: (1) **transcode là OUT** của ticket này ⇒ tệp người soạn nộp
 * lên CHÍNH LÀ tệp người học tải về, không có bước hạ cỡ nào ở giữa; (2) NFR dữ
 * liệu di động (≤60MB cho bài 10 phút) không thể đạt nếu bản gốc là 1080p hay 4K.
 * Tệp NHỎ HƠN 720p thì cho qua — một bản ghi màn hình 960×540 nhẹ hơn, không có
 * lý do gì chặn.
 *
 * So bằng CẠNH DÀI và CẠNH NGẮN, không bằng rộng×cao: video dựng bằng điện thoại
 * là 720×1280, và so theo chiều rộng sẽ chặn nhầm nó.
 */
export const VIDEO_MAX_CANH_DAI = 1280;
export const VIDEO_MAX_CANH_NGAN = 720;

/**
 * Trần TỐC ĐỘ BIT, tính bằng byte mỗi giây nội dung.
 *
 * SUY RA từ hai trần đã có (200MB / 15 phút = 13,3 MB/phút), KHÔNG viết tay con
 * số 13,3: viết tay là mở đường cho ba con số trôi khỏi nhau, và lúc đó không ai
 * biết con nào là chuẩn nộp thật.
 *
 * Vì sao cần trần này khi đã có trần dung lượng: một video 60 GIÂY nặng 200MB lọt
 * cả hai trần cũ (dưới 200MB, dưới 15 phút) — mà đó là 200MB dữ liệu di động cho
 * một phút nội dung, đúng cái mà NFR C11 sinh ra để chặn.
 */
export const VIDEO_BYTE_MOI_GIAY = VIDEO_MAX_BYTES / VIDEO_MAX_SEC;

/**
 * Trần tính như thể video dài TỐI THIỂU một phút.
 *
 * Không có mức miễn này thì một đoạn 5 giây chỉ được nặng 1,1MB — trong khi một
 * đoạn mở đầu 720p 5 giây nặng 2MB là chuyện thường. Chặn nó là chặn nhầm: 2MB
 * không đổi được quyết định nào về dữ liệu di động.
 */
export const VIDEO_GIAY_TOI_THIEU_TINH_TRAN = 60;

export const VIDEO_MIME = "video/mp4";
export const VIDEO_EXT = ".mp4";

export const CAPTION_MAX_BYTES = 2 * 1024 * 1024;
export const CAPTION_EXT = [".vtt", ".srt"] as const;

export type LoiChuanNop =
  | "SAI_DINH_DANG"
  | "SAI_DUOI_TEP"
  | "MIME_LECH_DUOI"
  | "QUA_LON"
  | "QUA_DAI"
  | "QUA_NGAN"
  | "QUA_NANG"
  | "QUA_NET"
  | "THIEU_THOI_LUONG"
  | "THIEU_DO_PHAN_GIAI";

export type KetQuaChuanNop =
  | { ok: true }
  | { ok: false; code: LoiChuanNop; message: string };

const duoiCua = (ten: string): string => {
  const i = ten.lastIndexOf(".");
  return i < 0 ? "" : ten.slice(i).toLowerCase();
};

/**
 * Kiểm một lượt nộp VIDEO.
 *
 * ⚠️ `durationSec` ở đây là con số do TRÌNH DUYỆT khai. Nó dùng để chặn SỚM
 * những trường hợp rõ ràng sai, KHÔNG phải để tin. Con số thật đọc từ hộp `moov`
 * của tệp sau khi tải xong (xem `mp4-probe.ts`) — chốt của chủ dự án 24/08.
 */
export function kiemChuanNopVideo(input: {
  filename: string;
  mime: string;
  sizeBytes: number;
  durationSec?: number | null;
  /**
   * Độ phân giải. `null` = đã đo nhưng KHÔNG đọc được ⇒ từ chối.
   *
   * ⚠️ Hai trường này là BẮT BUỘC trong kiểu, không `optional`: để `optional` thì
   * một đường gọi mới quên truyền vẫn biên dịch xanh, và trần độ phân giải im
   * lặng không áp cho đúng đường đó. Không đo được thì phải nói ra bằng `null`.
   */
  rong: number | null;
  cao: number | null;
}): KetQuaChuanNop {
  const duoi = duoiCua(input.filename);

  if (input.mime !== VIDEO_MIME) {
    return {
      ok: false,
      code: "SAI_DINH_DANG",
      message: `Chỉ nhận video MP4 (H.264). Tệp này là ${input.mime || "không rõ định dạng"}.`,
    };
  }
  if (duoi !== VIDEO_EXT) {
    return {
      ok: false,
      code: "SAI_DUOI_TEP",
      message: `Tên tệp phải kết thúc bằng ${VIDEO_EXT}.`,
    };
  }
  // Mime khớp nhưng đuôi lệch là dấu hiệu đổi tên tệp cho lọt cổng. Hai điều
  // kiện trên đã phủ, nhưng để riêng mã lỗi này cho trường hợp ngược lại về sau.

  if (input.sizeBytes <= 0) {
    return { ok: false, code: "QUA_LON", message: "Tệp rỗng hoặc không đọc được dung lượng." };
  }
  if (input.sizeBytes > VIDEO_MAX_BYTES) {
    return {
      ok: false,
      code: "QUA_LON",
      message: `Video tối đa ${Math.round(VIDEO_MAX_BYTES / 1024 / 1024)}MB. Tệp này ${Math.round(
        input.sizeBytes / 1024 / 1024,
      )}MB — cắt ngắn hoặc nén lại.`,
    };
  }

  if (input.durationSec == null) {
    // KHÔNG bỏ qua: thời lượng là thứ quyết định bài này có nằm trong chuẩn
    // "bài ngắn" hay không, và bỏ qua nghĩa là chuẩn đó chỉ áp cho ai trình
    // duyệt đọc được thời lượng.
    return {
      ok: false,
      code: "THIEU_THOI_LUONG",
      message: "Không đọc được thời lượng video — thử tệp khác hoặc đổi trình duyệt.",
    };
  }
  if (input.durationSec > VIDEO_MAX_SEC) {
    return {
      ok: false,
      code: "QUA_DAI",
      message: `Video tối đa ${VIDEO_MAX_SEC / 60} phút. Tệp này ${Math.round(
        input.durationSec / 60,
      )} phút — tách thành nhiều bài.`,
    };
  }
  if (input.durationSec < VIDEO_MIN_SEC) {
    return {
      ok: false,
      code: "QUA_NGAN",
      message: `Video dưới ${VIDEO_MIN_SEC} giây gần như chắc chắn là tải nhầm tệp.`,
    };
  }

  const giay = input.durationSec;
  const tranByte = Math.round(
    VIDEO_BYTE_MOI_GIAY * Math.max(giay, VIDEO_GIAY_TOI_THIEU_TINH_TRAN),
  );
  if (input.sizeBytes > tranByte) {
    const mb = (n: number) => n / 1024 / 1024;
    const mbMoiPhut = (mb(input.sizeBytes) / giay) * 60;
    return {
      ok: false,
      code: "QUA_NANG",
      // Nói cả con số của tệp và con số trần: người soạn phải biết phải nén tới
      // đâu, chứ "nén lại" suông thì họ đoán và tải lại nhiều lượt.
      message: `Video ${Math.round(mb(input.sizeBytes))}MB cho ${Math.round(
        giay,
      )} giây là ${mbMoiPhut.toFixed(1)}MB/phút — trần là ${(
        mb(VIDEO_BYTE_MOI_GIAY) * 60
      ).toFixed(1)}MB/phút. Xuất lại ở 720p với tốc độ bit khoảng 1,8 Mbps.`,
    };
  }

  if (input.rong == null || input.cao == null) {
    return {
      ok: false,
      code: "THIEU_DO_PHAN_GIAI",
      message: "Không đọc được kích thước khung video — thử xuất lại tệp.",
    };
  }
  const canhDai = Math.max(input.rong, input.cao);
  const canhNgan = Math.min(input.rong, input.cao);
  if (canhDai > VIDEO_MAX_CANH_DAI || canhNgan > VIDEO_MAX_CANH_NGAN) {
    return {
      ok: false,
      code: "QUA_NET",
      message: `Video tối đa 720p (${VIDEO_MAX_CANH_DAI}×${VIDEO_MAX_CANH_NGAN}). Tệp này ${input.rong}×${input.cao} — xuất lại ở 720p. Hệ thống KHÔNG hạ cỡ hộ, nên tệp nộp lên cũng là tệp người học tải về bằng dữ liệu di động.`,
    };
  }

  return { ok: true };
}

export function kiemChuanNopPhuDe(input: {
  filename: string;
  sizeBytes: number;
}): KetQuaChuanNop {
  const duoi = duoiCua(input.filename);
  if (!(CAPTION_EXT as readonly string[]).includes(duoi)) {
    return {
      ok: false,
      code: "SAI_DUOI_TEP",
      message: `Phụ đề phải là ${CAPTION_EXT.join(" hoặc ")}.`,
    };
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > CAPTION_MAX_BYTES) {
    return {
      ok: false,
      code: "QUA_LON",
      message: `Tệp phụ đề tối đa ${CAPTION_MAX_BYTES / 1024 / 1024}MB.`,
    };
  }
  return { ok: true };
}

/**
 * Khoá lưu trên R2 cho một tệp media của bài học.
 *
 * ⚠️ Khoá KHÔNG chứa tên tệp gốc. Tên tệp người soạn đặt có thể mang tên khách
 * hàng, tên nhân sự, hay số hiệu văn bản nội bộ — và khoá thì đi vào log, vào
 * URL, vào mọi chỗ khó xoá.
 */
export function khoaMedia(input: {
  lessonId: string;
  loai: "master" | "caption" | "audio";
  uuid: string;
}): string {
  const duoi =
    input.loai === "master" ? "mp4" : input.loai === "caption" ? "vtt" : "m4a";
  return `elearning/${input.loai}/${input.lessonId}/${input.uuid}.${duoi}`;
}
