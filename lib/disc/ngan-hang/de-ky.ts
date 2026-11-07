/**
 * ĐỀ ĐÃ KÝ — máy chủ phát đề, trình duyệt cầm một vé MÃ HOÁ, nộp bài thì đưa vé lại.
 *
 * Vì sao phải mã hoá chứ không chỉ ký: trong vé là danh sách mã câu, mà mã câu chứa ô khung
 * (`TH-D1.e3.h2` ⇒ trục D). Vé chỉ ký thì ai cũng đọc được trục của từng vị trí — tức đọc
 * được khoá chấm. AES-256-GCM vừa che nội dung vừa chặn sửa (thẻ xác thực).
 *
 * Luật:
 *  · vé gắn với NGƯỜI LÀM (`nguoiLam`) và có HẠN (`hanPhut`) — vé của bé A không nộp được
 *    cho bé B, vé hôm qua không nộp được hôm nay;
 *  · vé sai khung (đổi `PHIEN_BAN_KHUNG` giữa lúc phát và lúc nộp) ⇒ từ chối, KHÔNG chấm;
 *  · câu trả lời phải ĐỦ mọi vị trí, mỗi giá trị là số nguyên 1..mucToiDa — chặt hơn engine
 *    gốc (gốc nhận cả 2,5), cùng luật với `engine-that.ts`.
 *
 * Chạy ở MÁY CHỦ (cần `node:crypto`). Khoá truyền từ ngoài — nơi gọi dùng `layKhoaDisc()`.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { NGAN_HANG } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { MA_BO_DE, type KetQua, type MaBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { cham } from "@/lib/disc/engine-goc/modules/report/cham";

import { bocDe, deChoKhach, dungBoDe, kiemKhung, traLoiTheoMa, type CauChoKhach, type DeDaBoc } from "./boc-de";

const MIEN = "disc-de-v1";

type NoiDungVe = {
  readonly v: 1;
  readonly bo: MaBoDe;
  readonly k: string;
  readonly c: readonly string[];
  /** Người làm (id thành viên trong sổ gia đình). */
  readonly n: string;
  /** Hết hạn, epoch ms. */
  readonly h: number;
};

function khoaAes(khoa: string): Buffer {
  return createHash("sha256").update(`${MIEN}:${khoa}`, "utf8").digest();
}

const b64 = (b: Buffer) => b.toString("base64url");

export function kyDe(de: DeDaBoc, khoa: string, nguoiLam: string, hetHan: Date): string {
  const tho: NoiDungVe = { v: 1, bo: de.boDe, k: de.phienBanKhung, c: de.maCau, n: nguoiLam, h: hetHan.getTime() };
  const iv = randomBytes(12);
  const ma = createCipheriv("aes-256-gcm", khoaAes(khoa), iv);
  ma.setAAD(Buffer.from(MIEN));
  const than = Buffer.concat([ma.update(JSON.stringify(tho), "utf8"), ma.final()]);
  return [b64(iv), b64(than), b64(ma.getAuthTag())].join(".");
}

export type LyDoVe = "VE_HONG" | "HET_HAN" | "SAI_NGUOI_LAM" | "SAI_KHUNG";

export function docVe(
  ve: string,
  khoa: string,
  nguoiLam: string,
  bayGio: Date,
): { ok: true; de: DeDaBoc } | { ok: false; lyDo: LyDoVe } {
  const phan = typeof ve === "string" ? ve.split(".") : [];
  if (phan.length !== 3) return { ok: false, lyDo: "VE_HONG" };
  let tho: NoiDungVe;
  try {
    const giai = createDecipheriv("aes-256-gcm", khoaAes(khoa), Buffer.from(phan[0], "base64url"));
    giai.setAAD(Buffer.from(MIEN));
    giai.setAuthTag(Buffer.from(phan[2], "base64url"));
    const ro = Buffer.concat([giai.update(Buffer.from(phan[1], "base64url")), giai.final()]).toString("utf8");
    tho = JSON.parse(ro) as NoiDungVe;
  } catch {
    return { ok: false, lyDo: "VE_HONG" };
  }
  if (tho.v !== 1 || !(MA_BO_DE as readonly string[]).includes(tho.bo) || !Array.isArray(tho.c)) {
    return { ok: false, lyDo: "VE_HONG" };
  }
  if (tho.n !== nguoiLam) return { ok: false, lyDo: "SAI_NGUOI_LAM" };
  if (!(bayGio.getTime() <= tho.h)) return { ok: false, lyDo: "HET_HAN" };
  const de: DeDaBoc = { boDe: tho.bo, phienBanKhung: tho.k, maCau: tho.c };
  if (kiemKhung(de).length > 0) return { ok: false, lyDo: "SAI_KHUNG" };
  return { ok: true, de };
}

/* ── Hai việc nơi gọi cần ─────────────────────────────────────────────────── */

export type DePhatRa = {
  readonly ve: string;
  readonly boDe: MaBoDe;
  readonly cauDan: string;
  readonly cauMoiMan: number;
  readonly thang: readonly { readonly gia: number; readonly nhan: string; readonly mat?: string }[];
  readonly cau: readonly CauChoKhach[];
};

/** Hạn mặc định của vé: đủ cho một lần làm có ngắt quãng, không đủ để vé trôi nổi nhiều ngày. */
export const HAN_VE_PHUT = 24 * 60;

export function phatDe(yc: {
  readonly boDe: MaBoDe;
  readonly nguoiLam: string;
  readonly daThay: readonly string[];
  readonly hat: string;
  readonly khoa: string;
  readonly bayGio: Date;
  readonly hanPhut?: number;
}): DePhatRa {
  const de = bocDe({ boDe: yc.boDe, daThay: yc.daThay, hat: yc.hat });
  const goc = NGAN_HANG[yc.boDe];
  const hetHan = new Date(yc.bayGio.getTime() + (yc.hanPhut ?? HAN_VE_PHUT) * 60_000);
  return {
    ve: kyDe(de, yc.khoa, yc.nguoiLam, hetHan),
    boDe: yc.boDe,
    cauDan: goc.cauDan,
    cauMoiMan: goc.cauMoiMan,
    thang: goc.thang.map((m) => ({ gia: m.giaTri, nhan: m.nhan, ...(m.mat ? { mat: m.mat } : {}) })),
    cau: deChoKhach(de),
  };
}

export type KetQuaNopBai =
  | {
      readonly ok: true;
      readonly boDe: MaBoDe;
      /** Ghi vào bài: hai bài cùng phiên bản này mới được đối chiếu với nhau. */
      readonly phienBanBoDe: string;
      /** Ghi vào lịch sử "đã thấy" của người làm. KHÔNG phải câu trả lời. */
      readonly maCau: readonly string[];
      readonly ketQua: Extract<KetQua, { hopLe: true }>;
    }
  | { readonly ok: false; readonly lyDo: LyDoVe | "THIEU_CAU_TRA_LOI" | "GIA_TRI_KHONG_HOP_LE" | "TRA_LOI_PHANG" };

/** Phiên bản bộ đề ghi vào bài làm bằng ngân hàng mở rộng. KHÁC phiên bản đề gốc (xem spec §3.5). */
export const phienBanBoDeMoRong = (k: string) => `nh:${k}`;

export function nopBai(yc: {
  readonly ve: string;
  readonly theoViTri: unknown;
  readonly nguoiLam: string;
  readonly khoa: string;
  readonly bayGio: Date;
}): KetQuaNopBai {
  const doc = docVe(yc.ve, yc.khoa, yc.nguoiLam, yc.bayGio);
  if (!doc.ok) return doc;
  const de = doc.de;
  const bo = dungBoDe(de);

  const tl = yc.theoViTri;
  if (typeof tl !== "object" || tl === null || Array.isArray(tl)) return { ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" };
  const vao = tl as Record<string, unknown>;
  const sach: Record<string, number> = {};
  for (const [k, v] of Object.entries(vao)) {
    const i = Number(k);
    if (!/^\d+$/.test(k) || i >= de.maCau.length) return { ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" };
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > bo.mucToiDa) {
      return { ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" };
    }
    sach[k] = v;
  }
  if (Object.keys(sach).length !== de.maCau.length) return { ok: false, lyDo: "THIEU_CAU_TRA_LOI" };

  // Thời gian làm bài không tin client ⇒ null (HL-4 bỏ qua), cùng luật `engine-that.ts`.
  const kq = cham(bo, traLoiTheoMa(de, sach), null);
  if (!kq.hopLe) return { ok: false, lyDo: kq.lyDo === "THIEU_CAU" ? "THIEU_CAU_TRA_LOI" : "TRA_LOI_PHANG" };
  return { ok: true, boDe: de.boDe, phienBanBoDe: phienBanBoDeMoRong(de.phienBanKhung), maCau: de.maCau, ketQua: kq };
}
