/**
 * Máy chủ satarobo GIẢ cho 4 endpoint POS Agent — kiểm theo ĐÚNG thứ tự hợp đồng
 * `docs/pos-agent-api.md` §3.5, và kiểm chữ ký bằng `node:crypto` (cài đặt ĐỘC LẬP với
 * `src/lib/ky.ts` dùng WebCrypto) — hai bên khớp nghĩa là extension ký đúng hợp đồng, không
 * phải "khớp với chính nó".
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { bangTranHopDong } from "./hop-dong";

/**
 * Hợp đồng 1.1 §6.1 — tập khoá + trần độ dài ĐỌC THẲNG bảng của `docs/pos-agent-api.md` (cùng tệp, cùng cột mà máy
 * chủ GĐ4 so: [POS4-HD-01]). Thứ tự Map = thứ tự dòng bảng ⇒ khoá vượt ĐẦU TIÊN thành `field` (như `truongVuotTran`).
 * Fake TRƯỚC 1.1 chép tay trần của `dongAgentSchema` 1.0 và trả 400 CẢ LÔ — luật máy chủ cũ.
 */
const BANG_TRAN: ReadonlyMap<string, number> = new Map(
  [...bangTranHopDong()].map(([k, o]): [string, number] => {
    if (o === null) throw new Error(`hợp đồng §6.1 thiếu ô trần cho ${k}`);
    return [k, o.tran];
  }),
);
const KHOA_DONG = new Set(BANG_TRAN.keys());
/** Khoá nhận `number | string | null`; còn lại chỉ `string | null` (schema strict của GĐ4: sai KIỂU ⇒ 400 cả lô). */
const KHOA_SO = new Set(["order_amount", "transaction_master_amount", "transaction_detail_amount", "fee", "tax"]);
const RE_MA_GD = /^[0-9A-Za-z]{8,64}$/;

export type MaTuChoiGia = "MERCHANT_MISMATCH" | "BAD_TRANSACTION_ID" | "FIELD_TOO_LONG";

/** Một dòng bị máy chủ TỪ CHỐI (§7.2) — fake ghi lại để test đọc. */
export interface TuChoiGia {
  syncId: string;
  batchIndex: number;
  index: number;
  transaction_id: string | null;
  code: MaTuChoiGia;
  field?: string;
}

/** Khoá đầu tiên SAI KIỂU (`transactions[i].khoa`) — 400 cả lô như schema strict; không có ⇒ null. */
function saiKieu(rows: readonly unknown[]): string | null {
  for (let i = 0; i < rows.length; i++) {
    for (const [k, v] of Object.entries(rows[i] as Record<string, unknown>)) {
      const ok = v === null || typeof v === "string" || (KHOA_SO.has(k) && typeof v === "number");
      if (!ok) return `transactions[${i}].${k}`;
    }
  }
  return null;
}

/**
 * Luật từ chối DÒNG của máy chủ 1.1 (§7.2), ĐÚNG thứ tự GĐ4 `chuanHoaDongAgent`: merchant ≠ agent ⇒ MERCHANT_MISMATCH ·
 * mã sai dạng / dài hơn 64 ⇒ BAD_TRANSACTION_ID · chuỗi dài hơn trần ⇒ FIELD_TOO_LONG + `field`. Mã dữ liệu khác
 * (BAD_TIME, AMOUNT_*…) không mô phỏng — việc của máy chủ, ngoài phạm vi extension.
 */
function kiemDong(
  row: Record<string, unknown>,
  merchantCode: string,
  tranEp: Readonly<Partial<Record<string, number>>>,
): { code: MaTuChoiGia; field?: string } | null {
  const chuan = (x: unknown) => (typeof x === "string" ? x.trim().toUpperCase() : "");
  if (chuan(row.merchant_code) === "" || chuan(row.merchant_code) !== chuan(merchantCode)) return { code: "MERCHANT_MISMATCH" };
  const ma = typeof row.transaction_id === "string" ? row.transaction_id.trim() : "";
  if (!RE_MA_GD.test(ma)) return { code: "BAD_TRANSACTION_ID" };
  for (const [k, tran] of BANG_TRAN) {
    const v = row[k];
    if (typeof v === "string" && v.length > (tranEp[k] ?? tran)) return { code: "FIELD_TOO_LONG", field: k };
  }
  return null;
}

const KHOA_LO = new Set(["syncId", "batchIndex", "final", "windowFrom", "windowTo", "jobIds", "transactions"]);
const KHOA_HEARTBEAT = new Set([
  "extensionVersion",
  "sessionState",
  "sessionExpiresAt",
  "sessionExpiresSource",
  "lastSyncedAt",
  "profileName",
]);
const KHOA_STATUS = new Set(["state", "reason", "occurredAt", "profileName", "sessionExpiresAt", "httpStatus"]);

export interface YeuCauNhan {
  phuongThuc: string;
  duongDan: string;
  headers: Record<string, string>;
  than: string;
  json: unknown;
  /** Mã lỗi nếu bị từ chối (null = nhận). */
  ma: string | null;
  httpStatus: number;
}

export interface JobGia {
  id: string;
  createdAt: string;
  scanFrom: string;
}

export interface PhanHoiEp {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

function loi(status: number, code: string): PhanHoiEp {
  return { status, body: { ok: false, error: { code, message: code, requestId: "rq" } } };
}

function khoaLa(o: unknown, choPhep: Set<string>): string | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return "(không phải object)";
  for (const k of Object.keys(o)) if (!choPhep.has(k)) return k;
  return null;
}

/**
 * `windowTo` của lô (`YYYY-MM-DD HH:mm:ss` GIỜ VN — hợp đồng §4.4) ⇒ mốc tuyệt đối, ghép `+07:00` TƯỜNG MINH — chép
 * luật máy chủ GĐ4 (`mocCuaSoDen`, `lib/payments/pos/agent/job.ts`). Không đọc được ⇒ null ⇒ không DONE job nào.
 */
function mocCuaSoDen(windowTo: unknown): number | null {
  if (typeof windowTo !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(windowTo)) return null;
  const ms = Date.parse(`${windowTo.replace(" ", "T")}+07:00`);
  return Number.isFinite(ms) ? ms : null;
}

export class SataroboGia {
  readonly yeuCau: YeuCauNhan[] = [];
  private nonceDaDung = new Set<string>();
  jobs: JobGia[] = [];
  /** `nextPollMs` khi rảnh (có job PENDING ⇒ luôn 2000). */
  nextPollRanh = 60_000;
  merchantCode: string;
  sessionState = "UNKNOWN";
  /** Đồng hồ máy chủ lệch so với đồng hồ agent bao nhiêu ms. */
  lechGioMayChu = 0;
  /** Chặn trước mọi kiểm tra (vd ép 401 BAD_SIGNATURE / 500). Trả null = đi tiếp. */
  epTruoc: ((yc: { phuongThuc: string; duongDan: string; json: unknown }) => PhanHoiEp | null) | null = null;
  readonly daXongJob: string[] = [];
  /**
   * Job gửi kèm lô final mà máy chủ GIỮ PENDING vì tạo SAU `windowTo` của lô (luật RV-06 của GĐ4: `danhDauJobXong`
   * chỉ đóng job `createdAt ≤ windowTo`, không dung sai) — test đọc để thấy job kẹt.
   */
  readonly jobGiuVi: Array<{ id: string; windowTo: string }> = [];
  /** Lô `final:false` đã NHẬN theo `syncId` — lô final thiếu lô nào (0..n−1) ⇒ không DONE job (hợp đồng §4.4). */
  private loDaNhan = new Map<string, Set<number>>();
  /** Mọi dòng bị TỪ CHỐI đã báo trong `rejected[]` (theo thứ tự). */
  readonly tuChoi: TuChoiGia[] = [];
  /** Mọi dòng NHẬN (không bị từ chối). */
  readonly dongNhan: Array<Record<string, unknown>> = [];
  /**
   * Trần CHẶT hơn hợp đồng ở vài khoá — mô phỏng extension LỆCH hợp đồng (khoá ↦ trần máy chủ đang dùng). Rỗng = máy
   * chủ đúng hợp đồng 1.1.
   */
  tranEp: Partial<Record<string, number>> = {};
  /** Dấu dòng đã lưu từ chối (`FIELD_TOO_LONG` lưu dấu) — gửi lại Y HỆT ⇒ `unchanged`, không vào `rejected` lần hai (§4.4). */
  private dauTuChoi = new Map<string, string>();

  constructor(
    private readonly p: { agentId: string; biMat: string; goc: string; merchantCode: string; dongHo: () => number },
  ) {
    this.merchantCode = p.merchantCode;
  }

  /** Lời gọi đã được NHẬN (qua mọi kiểm tra). */
  daNhan(duongDan?: string): YeuCauNhan[] {
    return this.yeuCau.filter((y) => y.ma === null && (duongDan === undefined || y.duongDan === duongDan));
  }

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const phuongThuc = String(init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const than = typeof init.body === "string" ? init.body : "";
    const u = new URL(url);
    let json: unknown = null;
    try {
      json = than ? JSON.parse(than) : null;
    } catch {
      json = "(không phải JSON)";
    }
    const ghi = (ph: PhanHoiEp): Response => {
      const ok = ph.status >= 200 && ph.status < 300;
      this.yeuCau.push({
        phuongThuc,
        duongDan: u.pathname,
        headers,
        than,
        json,
        ma: ok ? null : String((ph.body as { error?: { code?: string } })?.error?.code ?? ph.status),
        httpStatus: ph.status,
      });
      return new Response(JSON.stringify(ph.body), {
        status: ph.status,
        headers: {
          "content-type": "application/json",
          "x-server-time": String(this.p.dongHo() + this.lechGioMayChu),
          ...(ph.headers ?? {}),
        },
      });
    };

    if (u.origin !== this.p.goc) throw new TypeError("Failed to fetch (host lạ)");
    if (init.credentials !== "omit") return ghi(loi(400, "CREDENTIALS_NOT_OMITTED"));
    const ep = this.epTruoc?.({ phuongThuc, duongDan: u.pathname, json });
    if (ep) return ghi(ep);

    // §3.5 — đúng thứ tự
    if (headers["x-agent-contract"] !== "1") return ghi(loi(400, "UNSUPPORTED_CONTRACT"));
    if (u.search !== "" || url.includes("?")) return ghi(loi(400, "BAD_REQUEST"));
    const id = headers["x-agent-id"] ?? "";
    const ts = headers["x-agent-ts"] ?? "";
    const nonce = headers["x-agent-nonce"] ?? "";
    const sig = (headers["x-agent-sig"] ?? "").toLowerCase();
    if (!/^[a-z0-9]{20,40}$/.test(id) || !/^[0-9]{13}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) {
      return ghi(loi(400, "BAD_REQUEST"));
    }
    if (phuongThuc === "POST" && !/^application\/json(\s*;\s*charset=utf-8)?$/i.test(headers["content-type"] ?? "")) {
      return ghi(loi(415, "UNSUPPORTED_MEDIA_TYPE"));
    }
    if (phuongThuc === "GET" && than !== "") return ghi(loi(400, "BAD_REQUEST"));
    const tran = u.pathname === "/api/pos-agent/transactions" ? 524_288 : 4_096;
    if (Buffer.byteLength(than, "utf8") > tran) return ghi(loi(413, "BODY_TOO_LARGE"));

    const bam = createHash("sha256").update(Buffer.from(than, "utf8")).digest("hex");
    const mong = createHmac("sha256", Buffer.from(this.p.biMat, "utf8"))
      .update(Buffer.from(`${phuongThuc}\n${u.pathname}\n${ts}\n${nonce}\n${bam}`, "utf8"))
      .digest("hex");
    if (id !== this.p.agentId || !timingSafeEqual(Buffer.from(mong), Buffer.from(sig))) {
      return ghi(loi(401, "BAD_SIGNATURE"));
    }
    const gioMayChu = this.p.dongHo() + this.lechGioMayChu;
    if (Math.abs(gioMayChu - Number(ts)) > 300_000) return ghi(loi(401, "CLOCK_SKEW"));
    if (this.nonceDaDung.has(nonce)) return ghi(loi(401, "NONCE_REUSED"));
    this.nonceDaDung.add(nonce);

    const nextPollMs = this.jobs.length > 0 ? 2_000 : this.nextPollRanh;
    const serverTime = gioMayChu;
    const okData = (data: unknown): PhanHoiEp => ({ status: 200, body: { ok: true, data } });

    switch (`${phuongThuc} ${u.pathname}`) {
      case "POST /api/pos-agent/heartbeat": {
        const la = khoaLa(json, KHOA_HEARTBEAT);
        if (la) return ghi({ status: 400, body: { ok: false, error: { code: "PAYLOAD_INVALID", field: la } } });
        const s = (json as { sessionState?: string }).sessionState;
        if (s === "READY" || s === "EXPIRED") this.sessionState = s;
        return ghi(okData({ nextPollMs, serverTime, merchantCode: this.merchantCode, sessionState: this.sessionState }));
      }
      case "POST /api/pos-agent/status": {
        const la = khoaLa(json, KHOA_STATUS);
        if (la) return ghi({ status: 400, body: { ok: false, error: { code: "PAYLOAD_INVALID", field: la } } });
        const st = (json as { state?: string }).state;
        if (st === "SESSION_READY") this.sessionState = "READY";
        if (st === "SESSION_EXPIRED") this.sessionState = "EXPIRED";
        return ghi(okData({ sessionState: this.sessionState, nextPollMs, serverTime }));
      }
      case "GET /api/pos-agent/jobs":
        return ghi(okData({ jobs: this.jobs.slice(0, 20), nextPollMs, serverTime }));
      case "POST /api/pos-agent/transactions": {
        const la = khoaLa(json, KHOA_LO);
        if (la) return ghi({ status: 400, body: { ok: false, error: { code: "PAYLOAD_INVALID", field: la } } });
        const lo = json as { syncId: string; batchIndex: number; final: boolean; windowTo: string; jobIds: string[]; transactions: unknown[] };
        if (!lo.final && lo.jobIds.length > 0) {
          return ghi({ status: 400, body: { ok: false, error: { code: "PAYLOAD_INVALID", field: "jobIds" } } });
        }
        if (lo.transactions.length > 200) return ghi(loi(400, "TOO_MANY_ROWS"));
        for (let i = 0; i < lo.transactions.length; i++) {
          const k = khoaLa(lo.transactions[i], KHOA_DONG);
          if (k) {
            return ghi({ status: 400, body: { ok: false, error: { code: "PAYLOAD_INVALID", field: `transactions[${i}].${k}` } } });
          }
        }
        const kieu = saiKieu(lo.transactions);
        if (kieu) return ghi({ status: 400, body: { ok: false, error: { code: "PAYLOAD_INVALID", field: kieu } } });
        // 1.1: ĐỘ DÀI là luật DÒNG — từ chối dòng (`rejected[]`), các dòng khác của lô vẫn xử lý (không còn 400 cả lô).
        const rejected: Array<{ index: number; transaction_id: string | null; code: MaTuChoiGia; field?: string }> = [];
        let unchanged = 0;
        lo.transactions.forEach((raw, index) => {
          const row = raw as Record<string, unknown>;
          const tc = kiemDong(row, this.merchantCode, this.tranEp);
          if (tc === null) {
            this.dongNhan.push(row);
            return;
          }
          const ma = typeof row.transaction_id === "string" ? row.transaction_id.trim() : "";
          if (tc.code === "FIELD_TOO_LONG") {
            const dau = JSON.stringify(row);
            if (this.dauTuChoi.get(ma) === dau) {
              unchanged++; // gửi lại y hệt dòng đã từ chối ⇒ không báo lần hai
              return;
            }
            this.dauTuChoi.set(ma, dau);
          }
          const r = { index, transaction_id: ma !== "" && ma.length <= 64 ? ma : null, code: tc.code, ...(tc.field ? { field: tc.field } : {}) };
          rejected.push(r);
          this.tuChoi.push({ syncId: lo.syncId, batchIndex: lo.batchIndex, ...r });
        });
        let jobsDone = 0;
        const daNhan = this.loDaNhan.get(lo.syncId) ?? new Set<number>();
        if (!lo.final) {
          daNhan.add(lo.batchIndex);
          this.loDaNhan.set(lo.syncId, daNhan);
        } else {
          // §4.4: thiếu lô final:false nào của lượt ⇒ KHÔNG đánh DONE job. RV-06: chỉ job tạo ≤ `windowTo` của lô final.
          let loThieu = false;
          for (let b = 0; b < lo.batchIndex; b++) if (!daNhan.has(b)) loThieu = true;
          const den = mocCuaSoDen(lo.windowTo);
          for (const j of loThieu ? [] : lo.jobIds) {
            const vt = this.jobs.findIndex((x) => x.id === j);
            if (vt < 0) continue;
            const tao = Date.parse(this.jobs[vt].createdAt);
            if (den === null || !Number.isFinite(tao) || tao > den) {
              this.jobGiuVi.push({ id: j, windowTo: lo.windowTo });
              continue;
            }
            this.jobs.splice(vt, 1);
            this.daXongJob.push(j);
            jobsDone++;
          }
        }
        const n = lo.transactions.length;
        return ghi(
          okData({
            received: n,
            unchanged,
            created: n - unchanged - rejected.length,
            updated: 0,
            matched: 0,
            needsReview: 0,
            ignored: 0,
            staged: lo.final ? 0 : n - unchanged - rejected.length,
            rejected,
            errors: [],
            jobsDone,
            nextPollMs: this.jobs.length > 0 ? 2_000 : this.nextPollRanh,
            serverTime,
          }),
        );
      }
      default:
        return ghi({ status: 405, body: { ok: false, error: { code: "METHOD_NOT_ALLOWED" } } });
    }
  };
}
