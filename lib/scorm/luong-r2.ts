// lib/scorm/luong-r2.ts — phần THUẦN (không biết Next, không biết đĩa) của đường phát asset SCORM: bọc luồng byte của R2/đĩa thành
// ReadableStream có BACKPRESSURE + huỷ đúng + chống treo, phân loại lỗi R2, so khớp ETag/If-Range, và log có cấu trúc (nén dòng lặp).
//
// Vì sao tách khỏi route (24/10/2026): `Readable.toWeb(...)`/`transformToWebStream()` đủ cho ca êm, nhưng đo ra ba lỗ ở ca xấu —
//   1. Client ngắt (trình duyệt huỷ `video1.mp4` giữa chừng, `H3_REQUEST_CANCELLED` ở Caddy) mà không ai chủ động huỷ nguồn thì socket R2
//      (hoặc fd đĩa) ở lại tới khi nguồn tự hết; pool mặc định của SDK là 50 socket và KHÔNG có hạn chờ nên vài chục lượt huỷ là đủ treo.
//   2. Nguồn đứng im giữa thân (R2/mạng chết nửa chừng) thì phản hồi treo vô hạn: không 5xx nào xuất hiện nên chỉ số 5xx mù với nó.
//   3. Lỗi bị nuốt thành 404 (xem `phanLoaiLoiR2`) và không để lại dấu vết để đối chiếu với log Caddy.
// Mọi hằng/hàm ở đây thuần để test được không cần mạng, không cần Next. Route phải import hằng từ đây — Next cấm route.ts export tên lạ.
import type { Readable } from "node:stream";
import { chungTienTrinh } from "@/lib/scorm/chung-tien-trinh";

/** Tệp ≤ ngưỡng này nạp vào RAM (nhả socket R2 ngay); lớn hơn thì truyền dòng. 2MB: tải xong dưới ~100ms từ VPS, 50 lượt song song ≤ 100MB. */
export const NGUONG_DEM_BYTE = 2 * 1024 * 1024;
/** Chờ R2 trả HEADER tối đa bao lâu — SDK không có hạn chờ mặc định, treo là quay hoài. */
export const HAN_CHO_R2_MS = 15_000;
/** Thân đang phát mà R2 im quá ngần này thì cắt (KHÔNG tính lúc ta tạm dừng vì client nhận chậm). */
export const HAN_TREO_THAN_MS = 30_000;
/** Hàng đợi tối đa giữa nguồn và client (byte). Vượt ⇒ tạm dừng đọc nguồn (backpressure). */
export const NGUONG_HANG_DOI_BYTE = 256 * 1024;

// ── Lỗi + phân loại ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nguồn đứng im quá hạn. `name = "TimeoutError"` để `phanLoaiLoiR2` đổi thành 504 khi còn kịp (trước khi gửi header). */
export class LoiTreo extends Error {
  constructor(ms: number) {
    super(`luồng không có byte nào trong ${ms}ms`);
    this.name = "TimeoutError";
  }
}

type LoiR2 = { name?: string; $metadata?: { httpStatusCode?: number } };

/** Lỗi R2/SDK → mã HTTP. 304/404/416/504 có nghĩa riêng; còn lại 502 (đừng giả làm 404: client sẽ không thử lại). */
export function phanLoaiLoiR2(e: unknown): number {
  const err = (e ?? {}) as LoiR2;
  const ma = err.$metadata?.httpStatusCode;
  if (err.name === "AbortError" || err.name === "TimeoutError") return 504;
  if (err.name === "NotModified" || ma === 304) return 304;
  if (err.name === "NoSuchKey" || err.name === "NotFound" || ma === 404) return 404;
  if (err.name === "InvalidRange" || ma === 416) return 416;
  if (err.name === "PreconditionFailed" || ma === 412) return 412;
  return 502;
}

// ── Huỷ: client ngắt HOẶC quá hạn chờ header ────────────────────────────────────────────────────────────────────────────

export type PhienHuy = {
  /** Đưa cho `send(lenh, { abortSignal })`. Abort SAU khi có header vẫn huỷ luôn thân đang chảy (SDK huỷ cả request). */
  signal: AbortSignal;
  /** Hết hạn chờ header ⇒ huỷ + ghi lý do. */
  hetHan: () => void;
  /** Vì sao bị huỷ (null = chưa). "client" = người xem ngắt — KHÔNG phải lỗi hạ tầng, đừng log như lỗi. */
  lyDo: () => "client" | "het-han" | null;
};

/** Một AbortController cho cả đời một request: nối với `req.signal` (client ngắt) và với hạn chờ R2. */
export function taoPhienHuy(signalClient?: AbortSignal): PhienHuy {
  const ctl = new AbortController();
  let lyDo: "client" | "het-han" | null = null;
  const khiClientNgat = () => {
    lyDo ??= "client";
    ctl.abort();
  };
  if (signalClient?.aborted) khiClientNgat();
  else signalClient?.addEventListener("abort", khiClientNgat, { once: true });
  return {
    signal: ctl.signal,
    hetHan: () => {
      lyDo ??= "het-han";
      ctl.abort();
    },
    lyDo: () => lyDo,
  };
}

// ── Luồng Node → Web, có backpressure ──────────────────────────────────────────────────────────────────────────────────

export type KetThucLuong = "het" | "huy" | "loi";

export type TuyChonLuong = {
  /** Client ngắt ⇒ huỷ nguồn ngay (không chờ phía nhận tự phát hiện). */
  signal?: AbortSignal;
  treoMs?: number;
  nguongHangDoiByte?: number;
  /** Gọi ĐÚNG MỘT lần khi luồng kết thúc (để log / dọn). Không ném. */
  khiXong?: (kq: KetThucLuong, loi?: unknown) => void;
};

/**
 * Bọc `src` (luồng từ R2 hoặc đĩa) thành ReadableStream cho `Response`. Khác `Readable.toWeb`:
 *  · backpressure RÕ RÀNG: hàng đợi vượt `nguongHangDoiByte` ⇒ `src.pause()`; client đọc tiếp (`pull`) mới `resume()` — không đọc
 *    nhanh hơn client nhận, nên RAM không tăng theo kích thước tệp;
 *  · `cancel()` (client ngắt/đóng) và `signal` abort đều `src.destroy()` ⇒ socket R2/fd đĩa được nhả NGAY;
 *  · chống treo: đang chờ nguồn mà quá `treoMs` không có byte ⇒ huỷ nguồn và báo lỗi cho phía nhận (đồng hồ KHÔNG chạy khi ta
 *    chủ động tạm dừng vì client chậm);
 *  · nguồn đóng sớm / lỗi giữa chừng ⇒ báo lỗi cho phía nhận (kết nối bị cắt, trình duyệt thử lại bằng Range) chứ không treo.
 */
export function boLuongNode(src: Readable, opt: TuyChonLuong = {}): ReadableStream<Uint8Array> {
  const treoMs = opt.treoMs ?? HAN_TREO_THAN_MS;
  const nguong = opt.nguongHangDoiByte ?? NGUONG_HANG_DOI_BYTE;
  let xong = false;
  let hen: ReturnType<typeof setTimeout> | undefined;
  let ctlLuong: ReadableStreamDefaultController<Uint8Array> | undefined;

  const tatHen = () => {
    if (hen) clearTimeout(hen);
    hen = undefined;
  };
  const datHen = () => {
    tatHen();
    hen = setTimeout(() => ketThuc("loi", new LoiTreo(treoMs)), treoMs);
    hen.unref?.();
  };
  const ketThuc = (kq: KetThucLuong, loi?: unknown) => {
    if (xong) return;
    xong = true;
    tatHen();
    src.off("data", khiCoData);
    src.off("end", khiHet);
    src.off("error", khiLoi);
    src.off("close", khiDong);
    opt.signal?.removeEventListener("abort", khiSignalHuy);
    // Nuốt lỗi muộn của nguồn đã bị huỷ (ECONNRESET/AbortError) — không để thành "unhandled error".
    src.on("error", () => {});
    if (!src.destroyed) src.destroy();
    try {
      if (kq === "het") ctlLuong?.close();
      else if (kq === "loi") ctlLuong?.error(loi instanceof Error ? loi : new Error(String(loi ?? "luồng lỗi")));
      else ctlLuong?.error(Object.assign(new Error("Request aborted"), { name: "AbortError" })); // huỷ: đừng để người đang đọc treo
    } catch {
      /* phía nhận đã đóng */
    }
    try {
      opt.khiXong?.(kq, loi);
    } catch {
      /* log không được làm hỏng luồng */
    }
  };

  const khiCoData = (chunk: Buffer | string) => {
    if (xong) return;
    const u8 = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    ctlLuong!.enqueue(u8);
    if ((ctlLuong!.desiredSize ?? 0) <= 0) {
      src.pause();
      tatHen(); // tạm dừng vì client nhận chậm không phải là "nguồn treo"
    } else {
      datHen();
    }
  };
  const khiHet = () => ketThuc("het");
  const khiLoi = (e: unknown) => ketThuc("loi", e);
  const khiDong = () => ketThuc("loi", new Error("nguồn đóng trước khi hết thân"));
  const khiSignalHuy = () => ketThuc("huy");

  return new ReadableStream<Uint8Array>(
    {
      start(c) {
        ctlLuong = c;
        if (opt.signal?.aborted) return ketThuc("huy");
        opt.signal?.addEventListener("abort", khiSignalHuy, { once: true });
        src.on("end", khiHet);
        src.on("error", khiLoi);
        src.on("close", khiDong);
        src.on("data", khiCoData);
        src.pause(); // gắn 'data' bật chế độ chảy; chờ `pull` mới cho chảy
      },
      pull() {
        if (xong) return;
        datHen();
        src.resume();
      },
      cancel() {
        ketThuc("huy");
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: nguong }),
  );
}

/**
 * Đọc HẾT một luồng nhỏ vào Buffer (tệp ≤ ngưỡng nạp RAM). Có trần byte (nguồn khai sai ContentLength ⇒ huỷ chứ không phình RAM) và
 * chống treo. Ném `LoiTreo` (→ 504) / lỗi nguồn; luôn huỷ nguồn khi lỗi.
 */
export function docHetLuong(src: Readable, opt: { toiDaByte: number; treoMs?: number; signal?: AbortSignal }): Promise<Buffer> {
  const treoMs = opt.treoMs ?? HAN_TREO_THAN_MS;
  return new Promise<Buffer>((ok, loi) => {
    const manh: Buffer[] = [];
    let tong = 0;
    let xong = false;
    let hen: ReturnType<typeof setTimeout> | undefined;
    const don = () => {
      if (hen) clearTimeout(hen);
      src.off("data", khiData);
      src.off("end", khiHet);
      src.off("error", khiLoi);
      src.off("close", khiDong);
      opt.signal?.removeEventListener("abort", khiHuy);
    };
    const thatBai = (e: Error) => {
      if (xong) return;
      xong = true;
      don();
      src.on("error", () => {});
      if (!src.destroyed) src.destroy();
      loi(e);
    };
    const datHen = () => {
      if (hen) clearTimeout(hen);
      hen = setTimeout(() => thatBai(new LoiTreo(treoMs)), treoMs);
      hen.unref?.();
    };
    const khiData = (c: Buffer | string) => {
      const b = typeof c === "string" ? Buffer.from(c) : c;
      tong += b.length;
      if (tong > opt.toiDaByte) return thatBai(new Error(`thân vượt trần ${opt.toiDaByte} byte`));
      manh.push(b);
      datHen();
    };
    const khiHet = () => {
      if (xong) return;
      xong = true;
      don();
      ok(Buffer.concat(manh, tong));
    };
    const khiLoi = (e: unknown) => thatBai(e instanceof Error ? e : new Error(String(e)));
    const khiDong = () => thatBai(new Error("nguồn đóng trước khi hết thân"));
    const khiHuy = () => {
      const e = new Error("Request aborted");
      e.name = "AbortError";
      thatBai(e);
    };
    if (opt.signal?.aborted) return khiHuy();
    opt.signal?.addEventListener("abort", khiHuy, { once: true });
    src.on("end", khiHet);
    src.on("error", khiLoi);
    src.on("close", khiDong);
    src.on("data", khiData);
    datHen();
  });
}

/**
 * Canh một luồng đang CHẢY liên tục (ghi xuống đĩa khi làm nóng): im quá `ms` ⇒ `src.destroy(LoiTreo)`. Trả hàm dừng canh (gọi trong finally).
 * Chỉ dùng khi luồng chảy liền (đã/đang pipe) — gắn 'data' sẽ bật chế độ chảy.
 */
export function canhGacTreo(src: Readable, ms: number): () => void {
  let hen: ReturnType<typeof setTimeout> | undefined;
  const dat = () => {
    if (hen) clearTimeout(hen);
    hen = setTimeout(() => {
      if (!src.destroyed) src.destroy(new LoiTreo(ms));
    }, ms);
    hen.unref?.();
  };
  src.on("data", dat);
  dat();
  return () => {
    if (hen) clearTimeout(hen);
    src.off("data", dat);
  };
}

// ── ETag / điều kiện ────────────────────────────────────────────────────────────────────────────────────────────────────

const boWeak = (s: string): string => s.trim().replace(/^W\//i, "");

/** `If-None-Match` có khớp ETag không (so yếu theo RFC 9110 §13.1.2; hỗ trợ danh sách và `*`). */
export function khopIfNoneMatch(header: string | null | undefined, etag: string | null | undefined): boolean {
  if (!header || !etag) return false;
  if (header.trim() === "*") return true;
  const e = boWeak(etag);
  return header.split(",").some((p) => boWeak(p) === e);
}

/**
 * `If-Range`: true ⇒ được phục vụ Range; false ⇒ phải bỏ Range và trả cả tệp 200 (tệp đã đổi so với bản trình duyệt đang giữ).
 * Không có `If-Range` ⇒ true. ETag yếu không dùng được cho If-Range (RFC) ⇒ false. Dạng ngày so đúng bằng `Last-Modified`.
 */
export function ifRangeKhop(ifRange: string | null | undefined, etag: string | null | undefined, lastModified: string | null | undefined): boolean {
  if (!ifRange) return true;
  const v = ifRange.trim();
  if (v.startsWith("W/")) return false;
  if (v.startsWith('"')) return Boolean(etag) && v === etag;
  const a = Date.parse(v);
  const b = lastModified ? Date.parse(lastModified) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

// ── Kiểm phiên SỐNG khi gia hạn vé trượt (có nhớ ngắn) ────────────────────────────────────────────────────────────────────
//
// Route asset chỉ tin JWT (`auth()`), nên tài khoản bị khoá giữa buổi vẫn đọc asset tới hết trần 3 giờ của chuỗi gia hạn nếu cookie
// cứ được gia hạn trượt. Chỗ DUY NHẤT đáng hỏi DB là lúc route thật sự cấp cookie mới (vé còn < 5 phút) — nhưng 12 request song song cùng
// mang cookie cũ sẽ CÙNG rơi vào cửa sổ đó, nên cần nhớ ngắn + gộp lượt đang bay để 1 lần gia hạn = 1 truy vấn DB, không phải 12.
//   · "song"    ⇒ phiên còn hiệu lực ở DB: được cấp cookie mới;
//   · "chet"    ⇒ DB nói phiên đã chết (khoá / xoá / đổi tokenVersion): route trả 403 'phien', KHÔNG cấp cookie;
//   · "khong-ro" ⇒ không hỏi được DB (ném lỗi): KHÔNG cấp cookie mới nhưng vẫn phục vụ request bằng vé còn hạn — không biến một cú
//     chập DB thành lỗi giả giữa buổi dạy; đường chủ động `/api/scorm/gia-han` cũng không gia hạn được khi DB hỏng (cùng quyết định).
export type KetQuaPhienSong = "song" | "chet" | "khong-ro";
/** Nhớ kết quả "song"/"chet" ngần này ms — ngắn hơn nhiều so với nhịp gia hạn (≈ 5 phút) nên không làm trễ việc thu hồi đáng kể. */
export const NHO_PHIEN_SONG_MS = 60_000;
/** Lỗi hỏi DB chỉ nhớ rất ngắn: đủ để một cú chập không kéo thêm hàng chục truy vấn, đủ ngắn để gia hạn thử lại sớm. */
export const NHO_PHIEN_LOI_MS = 5_000;
const NHO_PHIEN_TOI_DA = 500;
const phienDangKiem = chungTienTrinh("luong-r2.phienDangKiem", () => new Map<string, Promise<KetQuaPhienSong>>());
const phienDaBiet = chungTienTrinh("luong-r2.phienDaBiet", () => new Map<string, { kq: KetQuaPhienSong; het: number }>());

/**
 * Hỏi `kiem()` (true = phiên sống) tối đa một lượt cho mỗi `khoa` trong lúc đang bay, và nhớ kết quả `NHO_PHIEN_*_MS`.
 * `khoa` nên gồm userId + tokenVersion của phiên (hai phiên khác version không dùng chung kết quả). Không bao giờ ném.
 */
export function kiemPhienSongCoNho(khoa: string, kiem: () => Promise<boolean>, now = Date.now()): Promise<KetQuaPhienSong> {
  const biet = phienDaBiet.get(khoa);
  if (biet && biet.het > now) return Promise.resolve(biet.kq);
  const dang = phienDangKiem.get(khoa);
  if (dang) return dang;
  const p = (async (): Promise<KetQuaPhienSong> => {
    let kq: KetQuaPhienSong;
    try {
      kq = (await kiem()) ? "song" : "chet";
    } catch {
      kq = "khong-ro";
    }
    if (phienDaBiet.size >= NHO_PHIEN_TOI_DA) {
      for (const [k, v] of phienDaBiet) if (v.het <= now) phienDaBiet.delete(k);
      if (phienDaBiet.size >= NHO_PHIEN_TOI_DA) phienDaBiet.clear();
    }
    phienDaBiet.set(khoa, { kq, het: now + (kq === "khong-ro" ? NHO_PHIEN_LOI_MS : NHO_PHIEN_SONG_MS) });
    return kq;
  })().finally(() => {
    phienDangKiem.delete(khoa);
  });
  phienDangKiem.set(khoa, p);
  return p;
}

/** Chỉ cho test. */
export function _datLaiBoNhoPhien(): void {
  phienDangKiem.clear();
  phienDaBiet.clear();
}

// ── Log có cấu trúc, nén dòng lặp ──────────────────────────────────────────────────────────────────────────────────────

/** Mỗi loại sự kiện (khoá) log tối đa ngần này dòng mỗi cửa sổ; phần dư chỉ đếm và in một dòng tóm tắt khi sang cửa sổ mới. */
const LOG_TOI_DA_MOI_CUA_SO = 5;
const LOG_CUA_SO_MS = 60_000;
const cuaSoLog = chungTienTrinh("luong-r2.cuaSoLog", () => new Map<string, { batDau: number; da: number; nen: number }>());
const demSuKien = chungTienTrinh("luong-r2.demSuKien", () => new Map<string, number>());

/**
 * Log một sự kiện của đường asset. `thongTin` là nơi đặt packageId / khoá TƯƠNG ĐỐI / mã / tên lỗi / thời lượng — TUYỆT ĐỐI không
 * đưa vé, cookie, query vào đây. Cùng `khoa` thì nén (không spam khi một gói hỏng làm hàng trăm tệp lỗi cùng lúc).
 */
export function ghiLogAsset(
  khoa: string,
  muc: "warn" | "error",
  moTa: string,
  thongTin: Record<string, unknown>,
  now = Date.now(),
): void {
  demSuKien.set(khoa, (demSuKien.get(khoa) ?? 0) + 1);
  if (cuaSoLog.size > 200) cuaSoLog.clear();
  let w = cuaSoLog.get(khoa);
  if (!w || now - w.batDau >= LOG_CUA_SO_MS) {
    if (w && w.nen > 0) console.warn(`[scorm-asset] đã nén ${w.nen} dòng "${khoa}" ở cửa sổ trước`);
    w = { batDau: now, da: 0, nen: 0 };
    cuaSoLog.set(khoa, w);
  }
  if (w.da >= LOG_TOI_DA_MOI_CUA_SO) {
    w.nen++;
    return;
  }
  w.da++;
  console[muc](`[scorm-asset] ${moTa}`, thongTin);
}

/** Số sự kiện đã gặp theo khoá kể từ lúc tiến trình khởi động (cho ops / test). */
export function docDemSuKien(): Record<string, number> {
  return Object.fromEntries(demSuKien);
}

/** Chỉ cho test. */
export function _datLaiLog(): void {
  cuaSoLog.clear();
  demSuKien.clear();
}
