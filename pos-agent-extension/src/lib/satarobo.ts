/**
 * Gọi API POS Agent của satarobo — ký HMAC MỖI request (hợp đồng §3), chỉ kết nối ĐI RA.
 *
 *   · `JSON.stringify` thân MỘT lần, băm đúng chuỗi đó, gửi đúng chuỗi đó (§3.2).
 *   · Chốt chặn cuối: thân có khoá CẤM (token / header / deviceId / tên chủ thẻ…) ⇒ NÉM, không gửi.
 *   · `credentials: "omit"` — không mang cookie của hồ sơ Chrome sang satarobo; `redirect: "error"`.
 *   · 401 CLOCK_SKEW ⇒ lấy giờ máy chủ từ `X-Server-Time`, ký lại với nonce MỚI, gửi lại MỘT lần;
 *     401 NONCE_REUSED ⇒ ký lại nonce mới, MỘT lần (§3.6–§3.7).
 *   · Mọi phản hồi mang `X-Server-Time` ⇒ trả về độ lệch đo được để nơi gọi lưu.
 */
import { LECH_GIO_NGUONG_MS } from "./hang-so.js";
import { kyYeuCau, taoNonce } from "./ky.js";
import { timKhoaCam } from "./payload.js";

export interface CauHinhGoi {
  agentId: string;
  biMat: string;
  /** satAroboBaseUrl, không "/" cuối. */
  goc: string;
}

export type FetchSatarobo = (url: string, init: RequestInit) => Promise<Response>;

export interface YeuCauApi {
  phuongThuc: "GET" | "POST";
  duongDan: string;
  than?: object;
  timeoutMs: number;
}

export type KetQuaApi =
  | { ok: true; httpStatus: number; data: unknown; lechGioMs: number | null }
  | {
      ok: false;
      loai: "HTTP";
      httpStatus: number;
      ma: string;
      /** `error.field` của máy chủ (vd `transactions[3].currency`) — chỉ để chọn dòng cần bỏ, không hiển thị. */
      field: string | null;
      retryAfterS: number | null;
      lechGioMs: number | null;
    }
  | { ok: false; loai: "MANG"; chiTiet: "TIMEOUT" | "NETWORK"; lechGioMs: number | null };

export class LoiBaoMat extends Error {}

function laObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export async function goiSatarobo(p: {
  fetch: FetchSatarobo;
  dongHo: () => number;
  /** Độ lệch giờ đã biết (giờ máy chủ − giờ máy). */
  lechGioMs: number;
  cauHinh: CauHinhGoi;
  yc: YeuCauApi;
  taoNonce?: () => string;
}): Promise<KetQuaApi> {
  const { yc, cauHinh } = p;
  if (yc.phuongThuc === "GET" && yc.than !== undefined) throw new Error("GET không được có thân");
  if (yc.than !== undefined) {
    const cam = timKhoaCam(yc.than);
    if (cam) throw new LoiBaoMat(`Chặn gửi: thân có khoá cấm "${cam}"`);
  }
  const than = yc.than === undefined ? "" : JSON.stringify(yc.than);
  let lech = p.lechGioMs;
  let lechDaDo: number | null = null;

  for (let lan = 1; lan <= 2; lan++) {
    const ts = String(p.dongHo() + (Math.abs(lech) > LECH_GIO_NGUONG_MS ? lech : 0));
    const ky = await kyYeuCau({
      agentId: cauHinh.agentId,
      biMat: cauHinh.biMat,
      phuongThuc: yc.phuongThuc,
      duongDan: yc.duongDan,
      than,
      ts,
      nonce: (p.taoNonce ?? taoNonce)(),
    });
    const headers: Record<string, string> = { ...ky };
    if (yc.phuongThuc === "POST") headers["Content-Type"] = "application/json";

    const ac = new AbortController();
    const hen = setTimeout(() => ac.abort(), yc.timeoutMs);
    let res: Response;
    let chu: string;
    try {
      res = await p.fetch(`${cauHinh.goc}${yc.duongDan}`, {
        method: yc.phuongThuc,
        headers,
        body: yc.phuongThuc === "POST" ? than : undefined,
        signal: ac.signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      chu = await res.text();
    } catch {
      return { ok: false, loai: "MANG", chiTiet: ac.signal.aborted ? "TIMEOUT" : "NETWORK", lechGioMs: lechDaDo };
    } finally {
      clearTimeout(hen);
    }

    const gioMayChu = Number(res.headers.get("x-server-time"));
    if (Number.isFinite(gioMayChu) && gioMayChu > 0) {
      lechDaDo = gioMayChu - p.dongHo();
      lech = lechDaDo;
    }
    let json: unknown = null;
    try {
      json = JSON.parse(chu);
    } catch {
      // thân không phải JSON (vd trang lỗi của proxy) — xử như lỗi HTTP theo mã trạng thái
    }
    if (res.ok && laObject(json) && json.ok === true) {
      return { ok: true, httpStatus: res.status, data: json.data, lechGioMs: lechDaDo };
    }
    const loi = laObject(json) && laObject(json.error) ? json.error : null;
    const ma = loi && typeof loi.code === "string" ? loi.code : `HTTP_${res.status}`;
    if (lan === 1 && res.status === 401 && (ma === "CLOCK_SKEW" || ma === "NONCE_REUSED")) continue;
    // RV5: vắng header ⇒ `Number(null)` = 0 ⇒ "chờ 0 giây" (mặc định 60 giây thành mã chết). Đọc chuỗi thô trước.
    const raTho = res.headers.get("retry-after");
    const ra = raTho === null || raTho.trim() === "" ? Number.NaN : Number(raTho);
    const field = loi && typeof loi.field === "string" && loi.field.length <= 200 ? loi.field : null;
    return {
      ok: false,
      loai: "HTTP",
      httpStatus: res.status,
      ma,
      field,
      retryAfterS: Number.isFinite(ra) && ra >= 0 ? ra : null,
      lechGioMs: lechDaDo,
    };
  }
  // Không tới được đây (vòng lặp luôn return ở lượt 2) — giữ cho trình biên dịch.
  return { ok: false, loai: "MANG", chiTiet: "NETWORK", lechGioMs: lechDaDo };
}
