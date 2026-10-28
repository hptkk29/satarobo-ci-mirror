// lib/push/ket-qua.ts — luật đọc kết quả một cú gửi push + quyết số phận dòng outbox.
//
// THUẦN: không DB, không mạng, không gói `web-push`. Đây là chỗ MỌI luật thử-lại nằm, tách
// khỏi engine để test được từng mã lỗi mà không phải dựng Prisma hay giả một push service.
//
// ── VÌ SAO PHÂN LOẠI THEO MÃ, KHÔNG THEO THÔNG ĐIỆP ───────────────────────────────────
// Mỗi push service viết một kiểu thông điệp lỗi (FCM, Mozilla autopush, WNS), và họ đổi nó
// mà không báo ai. Mã HTTP thì cố định trong RFC 8030. Bắt chuỗi là ký một hợp đồng với thứ
// không ai cam kết giữ nguyên.

import { createHash } from "node:crypto";

/** Số phận của MỘT cú gửi tới MỘT thiết bị. */
export type LoaiKetCuc =
  /** 2xx — máy đã nhận. Không bao giờ gửi lại cho endpoint này nữa. */
  | "THANH_CONG"
  /** Đăng ký chết hẳn (404/410) — gỡ thiết bị, đừng thử lại. */
  | "HET_HAN"
  /** Lỗi tạm (429/5xx/mạng) — thử lại sau. */
  | "THU_LAI"
  /** Lỗi vĩnh viễn khác (400/403/413…) — thôi, nhưng KHÔNG gỡ thiết bị. */
  | "CHET";

/**
 * Phân loại mã HTTP mà push service trả về.
 *
 * `null` = không có phản hồi nào (đứt mạng, quá hạn socket, DNS hỏng). Đó là lỗi TẠM: hạ tầng
 * của ta hỏng chứ không phải đăng ký của người dùng hỏng, nên gỡ thiết bị ở đây là tự huỷ kênh
 * của cả công ty trong một sự cố mạng 5 phút.
 *
 * 404/410 là HAI mã khác nhau nhưng cùng nghĩa "endpoint này không còn tồn tại" (RFC 8030 §7.3):
 * người dùng gỡ ứng dụng, xoá dữ liệu trình duyệt, hoặc push service dọn đăng ký cũ. Đây là mã
 * DUY NHẤT được phép đổi `WebPushSubscription.status` — xem chú thích ở `engine.ts`.
 *
 * 403 CỐ Ý không gỡ thiết bị: mã đó gần như luôn là `VapidPkHashMismatch`, tức KHOÁ SERVER vừa
 * xoay chứ máy người dùng vẫn tốt. Gỡ hàng loạt lúc đó là bắt cả công ty bật lại thông báo bằng
 * tay, trong khi việc phải làm là dán lại khoá cũ. Cột `vapidKeyId` sinh ra đúng để phân biệt ca
 * này — nó chỉ có ích nếu ta KHÔNG xoá mất bằng chứng.
 */
export function phanLoaiMa(code: number | null | undefined): LoaiKetCuc {
  if (code == null) return "THU_LAI";
  if (code >= 200 && code < 300) return "THANH_CONG";
  if (code === 404 || code === 410) return "HET_HAN";
  if (code === 408 || code === 429) return "THU_LAI";
  if (code >= 500) return "THU_LAI";
  return "CHET";
}

/** Trần của BACKOFF tự sinh — 30 phút. KHÔNG áp cho `Retry-After` (xem hằng dưới). */
export const TRAN_CHO_MS = 30 * 60_000;

/**
 * Trần của `Retry-After` — 6 giờ, bằng đúng hạn sống mặc định của dòng outbox.
 *
 * ⚠️ CỐ Ý KHÁC `TRAN_CHO_MS`, và đây là chỗ dễ gộp nhầm nhất trong file.
 *
 * Kẹp `Retry-After` xuống 30 phút nghe như "an toàn" nhưng nó PHÁ đúng cam kết của cổng này:
 * push service trả `Retry-After: 3600` nghĩa là "đừng gọi lại trong 1 giờ". Gọi lại sau 30 phút
 * là vẫn nằm trong cửa sổ họ vừa xin ⇒ ăn thêm một 429 ⇒ lại kẹp 30 phút ⇒ lặp cho tới khi cạn
 * `maxAttempts` rồi `DEAD`. Kết quả: đúng lúc bị bóp, hệ thống tự đốt hết lượt thử và MẤT push
 * IM LẶNG — trong khi chỉ cần chờ đủ là gửi được.
 *
 * Vẫn phải có trần: `Retry-After: 86400` mà tôn trọng nguyên xi sẽ đẩy `nextAttemptAt` ra xa hơn
 * `expiresAt` và dòng thành xác sống. 6 giờ là mốc mà quá nó thì dòng cũng hết hạn — lúc đó cổng
 * quá-hạn chốt `SKIPPED`, một câu trả lời TRUNG THỰC, khác hẳn với `DEAD` sau 5 lần gõ cửa sớm.
 */
export const TRAN_RETRY_AFTER_MS = 6 * 60 * 60_000;
/** Khoảng chờ cơ sở — 1 phút, đúng nhịp cron. */
export const CHO_CO_SO_MS = 60_000;

/**
 * Chờ bao lâu trước lần thử kế: nhân đôi theo số lần đã thử, kẹp trần.
 *
 * 1 → 1 phút · 2 → 2 · 3 → 4 · 4 → 8 · 5 → 16. Với `maxAttempts = 5` mặc định thì một dòng
 * sống tối đa ~31 phút. Cố ý ngắn: đây là kênh "báo ngay", một thông báo lead giao sau 6 tiếng
 * không còn giá trị nào — thà chết sớm và thấy được trong sổ còn hơn treo lâu.
 */
export function backoffMs(soLanDaThu: number): number {
  const n = Math.max(1, Math.trunc(soLanDaThu));
  // 2^30 phút là quá đủ để tràn số nếu ai đó đặt maxAttempts lớn — kẹp mũ trước khi luỹ thừa.
  const mu = Math.min(n - 1, 20);
  return Math.min(CHO_CO_SO_MS * 2 ** mu, TRAN_CHO_MS);
}

/**
 * Đọc `Retry-After` (RFC 9110 §10.2.3) → mili giây chờ, hoặc null nếu không có/không hiểu được.
 *
 * Hai dạng hợp lệ và push service dùng CẢ HAI: số giây (`120`) hoặc mốc HTTP (`Wed, 21 Oct 2026
 * 07:28:00 GMT`). Chỉ đọc một dạng là lặng lẽ bỏ qua nửa số ca — mà "bỏ qua" ở đây nghĩa là
 * thử lại sớm hơn push service yêu cầu, tức tự chuốc thêm 429.
 *
 * Header của `node:http` là object khoá THƯỜNG (đã hạ chữ) và giá trị có thể là mảng.
 */
export function docRetryAfterMs(
  headers: Readonly<Record<string, string | string[] | undefined>> | null | undefined,
  now: Date,
): number | null {
  if (!headers) return null;
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!v) return null;

  if (/^\d+$/.test(v)) {
    const giay = Number(v);
    if (!Number.isFinite(giay)) return null;
    return Math.min(Math.max(giay, 0) * 1000, TRAN_RETRY_AFTER_MS);
  }

  const moc = Date.parse(v);
  if (Number.isNaN(moc)) return null;
  // Mốc trong quá khứ ⇒ 0, không phải số âm.
  return Math.min(Math.max(moc - now.getTime(), 0), TRAN_RETRY_AFTER_MS);
}

// ── Sổ kết quả theo từng thiết bị ────────────────────────────────────────────────────────

/**
 * Băm endpoint — KHOÁ trong `WebPushOutbox.resultJson`.
 *
 * ⚠️ CỐ Ý KHÔNG lưu endpoint trần, dù chú thích schema bản đầu viết là `{ "<endpoint>": … }`.
 * Endpoint là một CREDENTIAL: ai có nó gửi được push rỗng vào máy nhân viên (service worker
 * hiện câu mặc định "Bạn có thông báo mới"), không cần biết `p256dh`/`auth`. Luật của việc này
 * là "không log đầy đủ endpoint ở bất kỳ đâu — cắt hoặc băm"; một bảng mà ai đọc được cũng đọc
 * được thì không khác một cái log.
 *
 * Băm vẫn giữ nguyên tính chất mà khoá cần: TẤT ĐỊNH ⇒ lượt thử sau tra lại được "máy này đã
 * nhận chưa". Kèm `may` (nhãn cắt) trong giá trị để người trực còn lần ra được là máy nào.
 */
export function bamEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex").slice(0, 16);
}

/**
 * Nhãn người đọc được của một endpoint: host + 6 ký tự cuối. KHÔNG gửi lại được.
 *
 * Host là thứ nói lên nhiều nhất khi đi tìm lỗi (`fcm.googleapis.com` = Chrome/Android,
 * `updates.push.services.mozilla.com` = Firefox, `*.notify.windows.com` = Edge) — cả một lớp sự
 * cố chỉ xảy ra ở một nhà cung cấp.
 */
export function nhanEndpoint(endpoint: string): string {
  let host = "?";
  try {
    host = new URL(endpoint).host;
  } catch {
    /* endpoint rác — vẫn phải trả được một nhãn, không được ném */
  }
  return `${host}/…${endpoint.slice(-6)}`;
}

/** Một dòng trong `resultJson`. Khoá của dòng là `bamEndpoint(endpoint)`. */
export interface DongKetQua {
  /** Nhãn cắt để người trực lần ra máy nào — KHÔNG phải endpoint đầy đủ. */
  may: string;
  /** Mã HTTP; null = không có phản hồi (đứt mạng). */
  code: number | null;
  loai: LoaiKetCuc;
  /** ISO. */
  at: string;
  /** Thông điệp lỗi đã cắt ngắn. Vắng mặt khi thành công. */
  loi?: string;
}

export type SoKetQua = Record<string, DongKetQua>;

/**
 * Đọc `resultJson` từ DB về `SoKetQua`, chịu được mọi thứ rác.
 *
 * Cột là `Json?` nên Prisma trả `JsonValue` — có thể là null, số, mảng, hay một object do một
 * phiên bản code cũ ghi. Ép kiểu bằng `as` là mời một `TypeError` lúc chạy ở đúng đường gửi.
 */
export function docSoKetQua(raw: unknown): SoKetQua {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const ra: SoKetQua = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const loai = o.loai;
    if (loai !== "THANH_CONG" && loai !== "HET_HAN" && loai !== "THU_LAI" && loai !== "CHET") {
      continue;
    }
    ra[k] = {
      may: typeof o.may === "string" ? o.may : "?",
      code: typeof o.code === "number" ? o.code : null,
      loai,
      at: typeof o.at === "string" ? o.at : "",
      ...(typeof o.loi === "string" ? { loi: o.loi } : {}),
    };
  }
  return ra;
}

// ── Chốt số phận dòng outbox ────────────────────────────────────────────────────────────

export type TrangThaiChot = "SENT" | "FAILED" | "DEAD" | "SKIPPED";

export interface ChotKetQua {
  status: TrangThaiChot;
  /** Chỉ khác null khi `FAILED`. */
  nextAttemptAt: Date | null;
  /** Chỉ khác null khi `SENT`. */
  sentAt: Date | null;
}

/**
 * Quyết số phận dòng outbox từ kết quả của TỪNG thiết bị.
 *
 * Luật, theo thứ tự:
 *  1. Không có thiết bị nào để gửi ⇒ `SKIPPED`. KHÔNG phải `DEAD`: người đó chỉ là chưa bật
 *     thông báo trên máy nào — không có gì hỏng, và đánh `DEAD` sẽ nhuộm đỏ sổ vận hành bằng
 *     những dòng mà không ai phải làm gì cả.
 *  2. Còn thiết bị đáng thử lại VÀ chưa cạn lượt ⇒ `FAILED` + hẹn giờ. `FAILED` ở đây nghĩa
 *     "lượt này hỏng", không phải "bỏ cuộc" — cột `nextAttemptAt` mới là thứ nói lên điều đó.
 *  3. Hết đường thử lại ⇒ có ÍT NHẤT một máy nhận được thì `SENT`, không máy nào thì `DEAD`.
 *     Một người có 2 máy, điện thoại nhận được còn máy bàn chết 410 ⇒ họ ĐÃ được báo: đánh
 *     `DEAD` là nói dối trong sổ và sẽ kéo người trực đi xử lý một việc không tồn tại.
 *
 * Thời điểm chờ lấy MAX của (backoff, mọi `Retry-After` đọc được): "tôn trọng Retry-After"
 * nghĩa là không bao giờ gọi lại SỚM hơn nó yêu cầu. Lấy thẳng số của push service có thể ngắn
 * hơn nhịp cron (1 phút) và biến vòng thử lại thành vòng quay không tác dụng.
 */
export function chotKetCuc(params: {
  ketQua: readonly { loai: LoaiKetCuc; choMs?: number | null }[];
  soLanDaThu: number;
  maxAttempts: number;
  now: Date;
}): ChotKetQua {
  const { ketQua, soLanDaThu, maxAttempts, now } = params;

  if (ketQua.length === 0) return { status: "SKIPPED", nextAttemptAt: null, sentAt: null };

  const coThanhCong = ketQua.some((k) => k.loai === "THANH_CONG");
  const conThuLai = ketQua.filter((k) => k.loai === "THU_LAI");

  if (conThuLai.length > 0 && soLanDaThu < maxAttempts) {
    const cho = Math.max(
      backoffMs(soLanDaThu),
      ...conThuLai.map((k) => (typeof k.choMs === "number" && k.choMs > 0 ? k.choMs : 0)),
    );
    return { status: "FAILED", nextAttemptAt: new Date(now.getTime() + cho), sentAt: null };
  }

  return coThanhCong
    ? { status: "SENT", nextAttemptAt: null, sentAt: now }
    : { status: "DEAD", nextAttemptAt: null, sentAt: null };
}
