// lib/payments/pos/agent/hien-thi.ts — CHỮ của màn "Sức khoẻ POS Agent" (GĐ4 POS — §9.3). THUẦN.
//
// Gọi tên thống nhất với chuông `pos.agent-*` ("Máy POS Agent CS1 …"): màn, chuông và nút nói CÙNG một tên.
//
// Mỗi câu là một LỜI HỨA (luật 12): "Đang làm việc" chỉ khi máy thật sự vừa gọi về; "hết phiên" nói kèm VIỆC
// PHẢI LÀM (remote vào máy agent, đăng nhập lại hồ sơ Chrome của cơ sở). Trạng thái của thẻ suy từ CÙNG ngưỡng
// sale bị gác (D9 — `sucKhoeAgent`, 3 phút) để màn và quầy nói cùng một chuyện.
import type { PosAgentEventType, PosAgentSessionState, Prisma } from "@prisma/client";
import { gioVN, ngayVN } from "@/lib/format/thoi-gian-vn";
import { canBaoSang } from "./canh-bao-luat";
import { sucKhoeAgent } from "./suc-khoe";
import type { CotLech, NhomDoiChieu } from "./doi-chieu";

export type Tone = "success" | "warning" | "danger" | "info" | "muted";

/** "hh:mm" giờ VN; khác ngày VN với `now` ⇒ "hh:mm dd/mm". `giay` ⇒ "hh:mm:ss". */
export function luc(d: Date, now: Date, giay = false): string {
  const v = gioVN(d);
  const gio = v.slice(11, giay ? 19 : 16);
  return v.slice(0, 10) === ngayVN(now) ? gio : `${gio} ${v.slice(8, 10)}/${v.slice(5, 7)}`;
}

/** Khoảng thời gian tiếng Việt gọn: "25 giây" · "7 phút" · "3 giờ 10 phút" · "2 ngày 4 giờ". */
export function khoang(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1_000));
  if (s < 60) return `${s} giây`;
  const p = Math.floor(s / 60);
  if (p < 60) return `${p} phút`;
  const g = Math.floor(p / 60);
  if (g < 24) return p % 60 ? `${g} giờ ${p % 60} phút` : `${g} giờ`;
  const n = Math.floor(g / 24);
  return g % 24 ? `${n} ngày ${g % 24} giờ` : `${n} ngày`;
}

/** Một mốc đã qua: dưới 5 giây ⇒ "vừa xong" (đọc "0 giây trước" như máy đo hỏng); còn lại "N … trước". */
export function truocDay(ms: number): string {
  return ms < 5_000 ? "vừa xong" : `${khoang(ms)} trước`;
}

export type TheTrangThai = {
  /** Nhãn pill — luôn có chữ (không mã hoá trạng thái chỉ bằng màu). */
  nhan: string;
  tone: Tone;
  /** Câu chính: chuyện gì đang xảy ra. */
  cau: string;
  /** Việc phải làm ngay — null khi không có gì phải làm. */
  lamGi: string | null;
};

/**
 * Trạng thái MỘT thẻ máy đồng bộ. Thứ tự: tắt → hết phiên → chưa kết nối → mất kết nối → chưa sẵn sàng → sẵn sàng
 * (khớp `sucKhoeAgent` — cùng ngưỡng sale bị gác D9).
 */
export function trangThaiThe(
  a: {
    active: boolean;
    sessionState: PosAgentSessionState;
    sessionDoiLuc: Date | null;
    sessionExpiresAt: Date | null;
    lastHeartbeatAt: Date | null;
    matKetNoiTuLuc: Date | null;
    lastSyncedAt: Date | null;
    coSo: string;
  },
  now: Date,
): TheTrangThai {
  if (!a.active) {
    return {
      nhan: "Đã tắt",
      tone: "muted",
      cau: "POS Agent đang TẮT — phiếu thu thẻ của cơ sở này đọc dữ liệu từ file Techcombank nhập tay.",
      lamGi: null,
    };
  }
  const sk = sucKhoeAgent(a, now);
  switch (sk) {
    case "HET_PHIEN":
      return {
        nhan: "Hết phiên",
        tone: "danger",
        cau: `Portal Techcombank đã hết phiên${a.sessionDoiLuc ? ` lúc ${luc(a.sessionDoiLuc, now)}` : ""}. Sale đang thấy “Tạm mất kết nối Techcombank ${a.coSo}”.`,
        lamGi: `Remote vào máy POS Agent, mở hồ sơ Chrome ${a.coSo} và đăng nhập lại portal.`,
      };
    case "CHUA_KET_NOI":
      return {
        nhan: "Chưa kết nối",
        tone: "muted",
        cau: "POS Agent chưa gọi về lần nào.",
        lamGi: `Cài extension "SataRobo POS Agent" vào hồ sơ Chrome ${a.coSo} trên máy POS Agent và dán cấu hình (mã máy + bí mật).`,
      };
    case "MAT_KET_NOI": {
      const tu = a.matKetNoiTuLuc ?? a.lastHeartbeatAt!;
      return {
        nhan: "Mất kết nối",
        tone: "danger",
        cau: `Không nhận được tín hiệu từ ${luc(tu, now)} (${khoang(now.getTime() - tu.getTime())}).`,
        lamGi: `Kiểm máy POS Agent còn bật, có mạng và Chrome đang mở hồ sơ ${a.coSo}.`,
      };
    }
    case "CHUA_SAN_SANG":
      return {
        nhan: "Chưa rõ phiên",
        tone: "warning",
        cau: "POS Agent đang gọi về nhưng chưa báo được trạng thái phiên portal.",
        lamGi: `Mở hồ sơ Chrome ${a.coSo} trên máy POS Agent, kiểm tab Techcombank còn đăng nhập.`,
      };
    case "SAN_SANG": {
      // Chốt hợp đồng 1.1 (RV5.4 #4): `lastSyncedAt` là giờ MÁY CHỦ NHẬN lô cuối — nói đúng tên đó; mốc dữ liệu đã
      // đọc tới là một ô riêng (`duLieuDocToi`).
      const dongBo = a.lastSyncedAt ? `, nhận lô cuối lúc ${luc(a.lastSyncedAt, now)}` : ", chưa đồng bộ lần nào";
      const sapHet = canBaoSang(a.sessionExpiresAt, now) && a.sessionExpiresAt!.getTime() > now.getTime();
      return {
        nhan: "Đang làm việc",
        tone: "success",
        cau: `Liên lạc ${truocDay(now.getTime() - a.lastHeartbeatAt!.getTime())}${dongBo}.`,
        lamGi: sapHet ? `Phiên portal hết hạn lúc ${luc(a.sessionExpiresAt!, now)} hôm nay — đăng nhập lại trước giờ đó.` : null,
      };
    }
  }
}

/** Đồng hồ máy agent chậm hơn chừng này (cửa sổ dừng SỚM hơn lúc nhận) mới gọi là "trễ" — dưới đó là độ trễ mạng. */
export const NGUONG_TRE_DU_LIEU_MS = 60_000;

export type DuLieuDocToi =
  | { loai: "CHUA_CO" }
  | { loai: "KIP"; luc: Date }
  | { loai: "TRE"; luc: Date; treMs: number };

/**
 * Chốt hợp đồng 1.1 (RV5.4 #4) — "Dữ liệu đã đọc tới" TÁCH khỏi "Nhận lô cuối lúc" (`lastSyncedAt`, giờ MÁY CHỦ).
 * `cuaSoDen` = `windowTo` của lô final (`PosAgent.duLieuDenLuc`) — cận trên cửa sổ search agent khai, theo đồng hồ máy
 * agent (đã hiệu chỉnh + biên 2′ ở extension ⇒ thường MUỘN hơn lúc nhận).
 *  · cửa sổ phủ tới / quá lúc nhận ⇒ KIP, mốc = min(cửa sổ, lúc nhận) — không in một giờ TƯƠNG LAI (portal không thể
 *    có giao dịch sau lúc đọc);
 *  · cửa sổ dừng SỚM hơn lúc nhận > 60″ ⇒ TRE (mốc cửa sổ + độ trễ) — đồng hồ máy agent chậm / lượt chạy lâu: giao dịch
 *    sau mốc đó CHƯA được đọc dù lô vừa nhận;
 *  · chưa có mốc (lô final trước bản 1.1, chưa đồng bộ lần nào) ⇒ CHUA_CO.
 */
export function duLieuDocToi(nhanLuc: Date | null, cuaSoDen: Date | null): DuLieuDocToi {
  if (nhanLuc === null || cuaSoDen === null) return { loai: "CHUA_CO" };
  const tre = nhanLuc.getTime() - cuaSoDen.getTime();
  if (tre > NGUONG_TRE_DU_LIEU_MS) return { loai: "TRE", luc: cuaSoDen, treMs: tre };
  return { loai: "KIP", luc: tre > 0 ? cuaSoDen : nhanLuc };
}

export const NHAN_PHIEN: Record<PosAgentSessionState, string> = {
  READY: "Sống",
  EXPIRED: "Hết phiên",
  UNKNOWN: "Chưa rõ",
};

export const NHAN_LOAI_SU_KIEN: Record<PosAgentEventType, string> = {
  HEARTBEAT: "Kết nối",
  SESSION_READY: "Phiên sống lại",
  SESSION_EXPIRED: "Hết phiên",
  SYNC: "Đồng bộ",
  ERROR: "Lỗi",
};

export const TONE_LOAI_SU_KIEN: Record<PosAgentEventType, Tone> = {
  HEARTBEAT: "info",
  SESSION_READY: "success",
  SESSION_EXPIRED: "danger",
  SYNC: "muted",
  ERROR: "warning",
};

/** Mã con của sự kiện ⇒ chữ người đọc (mã lạ giữ nguyên — agent gửi mã, không chữ tự do). */
const NHAN_MA: Readonly<Record<string, string>> = {
  LAN_DAU: "Gọi về lần đầu",
  KET_NOI_LAI: "Kết nối lại",
  DOI_PHIEN_BAN: "Đổi phiên bản extension",
  MAT_KET_NOI: "Mất kết nối",
  JOB_KHONG_TRA_LOI: "Không trả lời yêu cầu kiểm",
  HEADER_NOT_CAPTURED: "Chưa bắt được header portal",
  BODY_ENCRYPTED: "Thân tìm kiếm bị mã hoá",
  PORTAL_HTTP_ERROR: "Portal trả lỗi HTTP",
  PORTAL_BAD_SHAPE: "Portal trả dữ liệu lạ",
  PORTAL_TAB_MISSING: "Mất tab portal",
  SYNC_FAILED: "Đồng bộ lỗi",
  MERCHANT_CONFIG_MISMATCH: "Sai merchant cấu hình",
  MERCHANT_MISMATCH: "Dòng của merchant khác",
  BAD_TRANSACTION_ID: "Mã giao dịch sai",
  BAD_TIME: "Giờ giao dịch sai",
  TYPE_MISSING: "Thiếu loại giao dịch",
  STATUS_MISSING: "Thiếu trạng thái",
  AMOUNT_MISSING: "Thiếu số tiền",
  AMOUNT_NOT_INTEGER: "Số tiền có số lẻ",
  AMOUNT_MISMATCH: "Ba trường số tiền lệch nhau",
  CURRENCY_UNSUPPORTED: "Tiền tệ khác VND",
  // Chốt hợp đồng 1.1: máy chủ từ chối DÒNG (agent tự báo lại bằng /status ERROR cùng mã).
  FIELD_TOO_LONG: "Trường vượt trần hợp đồng",
};

/**
 * Lý do đổi phiên (`reason` của `/status` — `docs/pos-agent-api.md` §4.2 — và `HEARTBEAT` khi heartbeat mang trạng thái
 * khác trạng thái đang lưu, `phien.ts`) ⇒ chữ người đọc. Đợt /impeccable 07/10: bảng sự kiện từng in trần
 * "Lý do REDIRECT_LOGIN" cho Kế toán HO. Mã lạ giữ "Lý do <mã>" (agent gửi mã, không chữ tự do).
 */
const NHAN_LY_DO_PHIEN: Readonly<Record<string, string>> = {
  NO_USER: "Portal không còn người đăng nhập",
  HTTP_401: "Portal từ chối (401 — hết đăng nhập)",
  HTTP_403: "Portal từ chối (403)",
  REDIRECT_LOGIN: "Portal chuyển về trang đăng nhập",
  USER_PRESENT: "Đã đăng nhập lại portal",
  EXTENSION_START: "Extension vừa khởi động",
  HEARTBEAT: "Báo qua tín hiệu định kỳ",
};

export function nhanMa(ma: string | null): string | null {
  return ma === null ? null : (NHAN_MA[ma] ?? ma);
}

function so(o: Prisma.JsonObject, k: string): number | null {
  const v = o[k];
  return typeof v === "number" ? v : null;
}

/** Tóm tắt SỐ ĐẾM của một sự kiện — không PII (detail chỉ mang số, mã, mốc giờ). */
export function tomTatSuKien(type: PosAgentEventType, ma: string | null, detail: Prisma.JsonValue): string {
  const o: Prisma.JsonObject = detail !== null && typeof detail === "object" && !Array.isArray(detail) ? detail : {};
  const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
  switch (type) {
    case "SYNC": {
      const phan = [
        ["nhận", so(o, "received")],
        ["mới", so(o, "created")],
        ["cập nhật", so(o, "updated")],
        ["khớp", so(o, "matched")],
        ["cần xử lý", so(o, "needsReview")],
        ["từ chối", so(o, "rejected")],
        ["lỗi", so(o, "errors")],
        // Gộp GĐ3: giao dịch đã ghi nhận mà agent báo khác (sổ không đổi — chi tiết ở audit lệch).
        ["lệch", so(o, "lech")],
      ]
        .filter((x): x is [string, number] => typeof x[1] === "number" && (x[0] === "nhận" || x[1] > 0))
        .map(([k, n]) => `${k} ${fmt(n)}`);
      const tre = so(o, "treNhatPhut");
      if (tre !== null && tre > 10) phan.push(`trễ nhất ${khoang(tre * 60_000)}`);
      return phan.join(" · ");
    }
    case "ERROR": {
      const dem = so(o, "dem");
      return `${nhanMa(ma) ?? "Lỗi"}${dem && dem > 1 ? ` · ${fmt(dem)} lần trong ngày` : ""}`;
    }
    case "HEARTBEAT": {
      if (ma === "KET_NOI_LAI") {
        const phut = so(o, "phut");
        return phut !== null ? `Kết nối lại sau ${khoang(phut * 60_000)}` : "Kết nối lại";
      }
      if (ma === "DOI_PHIEN_BAN") {
        const tu = typeof o.tu === "string" ? o.tu : "?";
        const den = typeof o.den === "string" ? o.den : "?";
        return `Extension ${tu} → ${den}`;
      }
      return nhanMa(ma) ?? "Kết nối";
    }
    case "SESSION_READY":
    case "SESSION_EXPIRED": {
      const lyDo = typeof o.reason === "string" ? o.reason : null;
      if (lyDo === null) return "—";
      return NHAN_LY_DO_PHIEN[lyDo] ?? `Lý do ${lyDo}`;
    }
  }
}

export const NHAN_NHOM_DOI_CHIEU: Record<NhomDoiChieu, string> = {
  KHOP: "Khớp",
  CHI_AGENT: "Chỉ POS Agent thấy",
  CHI_FILE: "Chỉ file thấy",
  AGENT_TU_CHOI: "POS Agent từ chối",
  LECH: "Lệch",
};

export const TONE_NHOM_DOI_CHIEU: Record<NhomDoiChieu, Tone> = {
  KHOP: "success",
  CHI_AGENT: "info",
  CHI_FILE: "warning",
  AGENT_TU_CHOI: "warning",
  LECH: "danger",
};

export const NHAN_COT_LECH: Record<CotLech, string> = {
  soTien: "số tiền",
  trangThai: "trạng thái",
  loaiGiaoDich: "loại",
  thoiGianGiaoDich: "giờ",
  bamDienGiai: "ghi chú",
};
