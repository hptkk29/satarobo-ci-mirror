/**
 * Máy trạng thái PHIÊN portal — thuần (không đọc đồng hồ, không I/O).
 *
 * Ba tín hiệu hết phiên (roadmap §6 GĐ5): session không có `user` · API portal 401/403 · bị
 * chuyển về /login ⇒ SESSION_EXPIRED đúng MỘT lần mỗi lần chuyển (tín hiệu lặp lại ⇒ không
 * phát thêm). `user` xuất hiện lại ⇒ SESSION_READY (USER_PRESENT) + quét bù.
 *
 * TỰ QUYẾT — chống "nháy": hết phiên vì 401/403 trong khi session VẪN có `user` có thể là header
 * cũ bị từ chối chứ chưa chắc phiên chết. Khi đó chỉ READY lại khi có BẰNG CHỨNG phiên mới:
 *   · mốc `exp` của access token ĐỔI (đăng nhập lại ⇒ token mới), hoặc
 *   · app vừa gọi search THÀNH CÔNG sau lúc hết phiên (dấu header: trang khác, hoặc số lần bắt tăng).
 * Không vậy thì keepalive 10′ thấy `user` ⇒ READY ⇒ search 401 ⇒ EXPIRED ⇒ báo admin… lặp vô hạn.
 *
 * RV5 — hai lỗ của luật trên đã vá:
 *   · search (API) bị CHUYỂN HƯỚNG (3xx/opaqueredirect — đích không rõ: middleware, WAF…) cũng là "header
 *     bị từ chối mà session có thể vẫn còn user" ⇒ tín hiệu `API_CHUYEN_HUONG` cần bằng chứng như 401/403
 *     (lý do gửi máy chủ vẫn `REDIRECT_LOGIN`). Tab điều hướng tới /login (`VE_DANG_NHAP`) giữ như cũ.
 *   · chỉ mốc nguồn `ACCESS_TOKEN` mới là bằng chứng: `expires` của NextAuth TRƯỢT ở mỗi lần gọi session.
 */
import type { NguonHetHan } from "./than-api.js";

export type TrangThaiPhien = "UNKNOWN" | "READY" | "EXPIRED";
export type LyDoHet = "NO_USER" | "HTTP_401" | "HTTP_403" | "REDIRECT_LOGIN";

/** "Dấu" header app trong world MAIN — KHÔNG chứa header, chỉ mã trang + số lần bắt. */
export interface DauHeader {
  maTrang: string;
  soBat: number;
  coHeader: boolean;
}

export interface Phien {
  trangThai: TrangThaiPhien;
  lyDo: LyDoHet | null;
  lucChuyen: number | null;
  hetHanLuc: string | null;
  nguonHetHan: NguonHetHan;
  /** Mốc exp đã thấy lúc hết phiên vì 401/403. */
  hetHanKhiMat: string | null;
  /** Dấu header lúc hết phiên vì 401/403. */
  dauKhiMat: { maTrang: string; soBat: number } | null;
  /**
   * Hết phiên kiểu "header bị từ chối" (401/403/API chuyển hướng) ⇒ READY lại cần bằng chứng phiên mới.
   * Tuỳ chọn: phiên lưu bởi bản cũ không có trường này ⇒ suy từ `lyDo` (`canBangChung` bên dưới).
   */
  canBangChung?: boolean;
}

export const PHIEN_DAU: Phien = {
  trangThai: "UNKNOWN",
  lyDo: null,
  lucChuyen: null,
  hetHanLuc: null,
  nguonHetHan: null,
  hetHanKhiMat: null,
  dauKhiMat: null,
  canBangChung: false,
};

export type TinHieuPhien =
  | { loai: "PHIEN"; coUser: boolean; hetHanLuc: string | null; nguonHetHan: NguonHetHan; dau: DauHeader | null }
  | { loai: "HTTP"; httpStatus: 401 | 403; dau: DauHeader | null }
  | { loai: "API_CHUYEN_HUONG"; dau: DauHeader | null }
  | { loai: "VE_DANG_NHAP" };

export interface SuKienPhien {
  state: "SESSION_READY" | "SESSION_EXPIRED";
  reason: "EXTENSION_START" | "USER_PRESENT" | LyDoHet;
  occurredAt: number;
  httpStatus: number | null;
  sessionExpiresAt: string | null;
}

export interface KetQuaPhien {
  phien: Phien;
  suKien: SuKienPhien | null;
  quetBu: boolean;
}

function hetPhien(
  p: Phien,
  lyDo: LyDoHet,
  now: number,
  httpStatus: number | null,
  dau: DauHeader | null,
  canBangChung: boolean,
): KetQuaPhien {
  return {
    phien: {
      ...p,
      trangThai: "EXPIRED",
      lyDo,
      lucChuyen: now,
      hetHanKhiMat: p.hetHanLuc,
      dauKhiMat: dau ? { maTrang: dau.maTrang, soBat: dau.soBat } : null,
      canBangChung,
    },
    suKien: { state: "SESSION_EXPIRED", reason: lyDo, occurredAt: now, httpStatus, sessionExpiresAt: null },
    quetBu: false,
  };
}

function coBangChungPhienMoi(p: Phien, th: Extract<TinHieuPhien, { loai: "PHIEN" }>): boolean {
  const can = p.canBangChung ?? (p.lyDo === "HTTP_401" || p.lyDo === "HTTP_403");
  if (!can) return true;
  if (th.nguonHetHan === "ACCESS_TOKEN" && th.hetHanLuc !== null && th.hetHanLuc !== p.hetHanKhiMat) return true;
  const d = th.dau;
  if (!d || !d.coHeader || d.soBat <= 0) return false;
  const cu = p.dauKhiMat;
  return cu === null || d.maTrang !== cu.maTrang || d.soBat > cu.soBat;
}

export function xuLyTinHieu(p: Phien, th: TinHieuPhien, now: number): KetQuaPhien {
  if (th.loai === "PHIEN" && th.coUser) {
    const capNhat: Phien = { ...p, hetHanLuc: th.hetHanLuc, nguonHetHan: th.nguonHetHan };
    if (p.trangThai === "READY") return { phien: capNhat, suKien: null, quetBu: false };
    if (p.trangThai === "EXPIRED" && !coBangChungPhienMoi(p, th)) {
      return { phien: p, suKien: null, quetBu: false };
    }
    const reason = p.trangThai === "UNKNOWN" ? "EXTENSION_START" : "USER_PRESENT";
    // Hợp đồng 1.1 §4.2: `/status` KHÔNG có trường nguồn ⇒ chỉ gửi mốc `exp` của ACCESS TOKEN. Nguồn SESSION (`expires`
    // TRƯỢT của NextAuth) / không rõ ⇒ không mốc (thân /status bỏ khoá — không gửi null đè hạn máy chủ đã biết);
    // heartbeat kế tiếp mang mốc KÈM nguồn để máy chủ tự xử (§4.1).
    const mocStatus = th.nguonHetHan === "ACCESS_TOKEN" ? th.hetHanLuc : null;
    return {
      phien: { ...capNhat, trangThai: "READY", lyDo: null, lucChuyen: now, hetHanKhiMat: null, dauKhiMat: null, canBangChung: false },
      suKien: { state: "SESSION_READY", reason, occurredAt: now, httpStatus: null, sessionExpiresAt: mocStatus },
      quetBu: true,
    };
  }
  // Mọi nhánh còn lại là tín hiệu HẾT phiên. Đang EXPIRED ⇒ không phát lại (đúng một lần).
  if (p.trangThai === "EXPIRED") return { phien: p, suKien: null, quetBu: false };
  if (th.loai === "PHIEN") return hetPhien(p, "NO_USER", now, null, th.dau, false);
  if (th.loai === "HTTP") return hetPhien(p, th.httpStatus === 401 ? "HTTP_401" : "HTTP_403", now, th.httpStatus, th.dau, true);
  if (th.loai === "API_CHUYEN_HUONG") return hetPhien(p, "REDIRECT_LOGIN", now, null, th.dau, true);
  return hetPhien(p, "REDIRECT_LOGIN", now, null, null, false);
}
