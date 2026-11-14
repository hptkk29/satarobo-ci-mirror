/**
 * lib/affiliate/theo-doi-cong-khai.ts — LÕI DÙNG CHUNG của hai đường CÔNG KHAI theo dõi link giới thiệu (AFF-P1, docs/source-commission/12 §2.3, §2.6; đặc tả §16–§21, §63–§66):
 *   · `GET  /r/:token`                       → `xuLyBamLink`   (chuyển hướng, ghi lượt bấm, đặt cookie)
 *   · `POST /api/public/affiliate/v1/click`  → `xuLyBeacon`    (link TRỰC TIẾP đặt trên site đối tác)
 * Route chỉ làm việc HTTP (đọc header/cookie, dựng Response); toàn bộ quyết định ở đây. Mọi phụ thuộc (DB · đồng hồ · giới hạn tần suất · khoá HMAC · bộ sinh mã phiên · gốc công khai) được TIÊM
 * qua `PhuThuoc` để test không cần mạng/đồng hồ thật (luật 19); `phuThuocThat()` là bản chạy thật.
 *
 * ── Luật cứng ───────────────────────────────────────────────────────────────────────────────────────────────────
 *  1. ĐIỂM ĐẾN chỉ dựng từ DỮ LIỆU ĐÃ LƯU (`dungUrlDich` ← site + trang đích + token + mã campaign đọc từ DB) — KHÔNG BAO GIỜ từ query / Referer / Host / body của request (chống open-redirect).
 *     Cái duy nhất đi từ request vào URL đích là 5 khoá `utm_*` (đã chuẩn hoá, mã hoá URL, cắt 100 ký tự).
 *  2. Token hỏng / lạ ⇒ về trang chủ, KHÔNG ghi gì, KHÔNG lộ «token không tồn tại» (cùng một phản hồi với mọi trường hợp lỗi).
 *  3. Token đúng nhưng chuỗi KHÔNG hợp lệ (thu hồi, hết hạn, đối tác ngừng…) ⇒ GHI lượt bấm với `outcome` = mã lý do (báo cáo «link chết còn bị bấm»), KHÔNG đặt cookie giới thiệu, chuyển tới trang
 *     đích SẠCH (không `aff`/`cmp`/`clk`) hoặc trang chủ. Khách không bao giờ thấy lý do (`CAU_CHUNG_CHO_KHACH` là câu duy nhất nếu có hiển thị).
 *  4. Hợp lệ ⇒ ghi lượt bấm TRƯỚC, rồi mới dựng URL đích kèm `clk=<id lượt bấm>`; ghi lượt bấm hỏng ⇒ vẫn chuyển tới đích, không `clk`.
 *  5. Mọi lỗi nội bộ ⇒ chuyển về trang chủ công khai (tuyệt đối, từ hằng cấu hình — không từ request). Khách không bao giờ nhận trang lỗi vì hệ thống theo dõi hỏng.
 *  6. `sessionKey` = HMAC-SHA256 một chiều của MÃ PHIÊN ẨN DANH (cookie ngẫu nhiên riêng `sr_aff_s`), không phải IP / User-Agent.
 *  7. Giới hạn tần suất theo IP: ngưỡng là HẰNG CÓ TÊN dưới đây (chưa có khoá SystemSetting phù hợp — `public.leadRateLimit*` là ngưỡng gửi form, quá chặt cho lượt bấm link).
 */
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getSigningSecret } from "@/lib/security/signing-key";
import { hopCoAffiliate, laAffiliateBatTho } from "@/lib/affiliate/feature";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import { chuanHoaUtm, dungUrlDich, dungUrlTrangDich, type Utm } from "./dung-url-theo-doi";
import { taiChuoiLinkTheoToken, type LinkDaTai } from "./doc-link";
import { gocCongKhai } from "./goc-cong-khai";
import { kiemChuoiLink } from "./ghi-link-dau-vao";
import { chuanHoaToken } from "./token";
import { kiemUrlDuocPhep } from "./website-hop-le";

type Khach = PrismaClient | Prisma.TransactionClient;

// ── Hằng có tên ─────────────────────────────────────────────────────────────────────────────────────────────────

export const COOKIE_GIOI_THIEU = "sr_aff";
export const COOKIE_PHIEN = "sr_aff_s";
const NGAY_GIAY = 24 * 60 * 60;
/** Tuổi cookie mã phiên ẩn danh. Chỉ để gộp «cùng một người bấm nhiều lần» — không quyết định tiền. */
export const TUOI_COOKIE_PHIEN_GIAY = 30 * NGAY_GIAY;
/** Ngưỡng theo IP, mỗi đường một khoá (xem luật 7 ở đầu tệp). */
export const GIOI_HAN_BAM_LINK = { max: 120, windowMs: 60_000 } as const;
export const GIOI_HAN_BEACON = { max: 120, windowMs: 60_000 } as const;
/** Trần thân beacon (byte ký tự). Quá thì bỏ ngay không phân tích. */
export const DO_DAI_THAN_BEACON_TOI_DA = 4096;
const MA_PHIEN_RE = /^[0-9a-f]{32}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

// ── Phụ thuộc tiêm vào ──────────────────────────────────────────────────────────────────────────────────────────

export type PhuThuoc = {
  client: Khach;
  now: () => Date;
  /** Origin công khai (https, không đường dẫn) — trang chủ dự phòng. KHÔNG lấy từ request. `null` = môi trường chưa cấu hình `AFFILIATE_PUBLIC_ORIGIN` ⇒ trang chủ dự phòng là đường dẫn TƯƠNG ĐỐI `/` (cùng host với chính request `/r` này — không bao giờ một tên miền cứng). */
  goc: string | null;
  /** `true` = còn trong ngưỡng. Lỗi hạ tầng ⇒ nơi gọi cho qua (không chặn khách). */
  choPhepTanSuat: (khoa: string, gioiHan: { max: number; windowMs: number }) => Promise<boolean>;
  /** HMAC key. Hàm để việc đọc secret (ném nếu thiếu) xảy ra LƯỜI, trong try. */
  khoaHmac: () => string;
  sinhMaPhien: () => string;
};

export function phuThuocThat(): PhuThuoc {
  return {
    client: db,
    now: () => new Date(),
    // Trang chủ dự phòng của /r: gốc đã cấu hình; thiếu cấu hình ⇒ null ⇒ về `/` TƯƠNG ĐỐI (không đoán một tên miền nào khác, không lấy từ Host của request).
    goc: gocCongKhai(process.env),
    choPhepTanSuat: async (khoa, gh) => {
      try {
        return (await rateLimit({ key: khoa, max: gh.max, windowMs: gh.windowMs })).success;
      } catch {
        return true;
      }
    },
    khoaHmac: getSigningSecret,
    sinhMaPhien: () => randomBytes(16).toString("hex"),
  };
}

/** Cờ: Affiliate bật ∧ module nguồn bật. Đọc hỏng ⇒ TẮT (route trả 404 y như không tồn tại). */
export async function docCoTheoDoi(): Promise<boolean> {
  const [affiliate, nguon] = await Promise.all([laAffiliateBatTho().catch(() => false), laQuanLyNguonBat().catch(() => false)]);
  return hopCoAffiliate({ affiliate, nguon });
}

// ── Tiện ích thuần ──────────────────────────────────────────────────────────────────────────────────────────────

/** HMAC-SHA256 một chiều của mã phiên, hex 32 ký tự đầu. Tên miền khoá riêng ("aff-session") để HMAC này không dùng chung với chữ ký khác từ cùng secret. */
export function tinhSessionKey(khoa: string, maPhien: string): string {
  return createHmac("sha256", khoa).update(`aff-session:${maPhien}`).digest("hex").slice(0, 32);
}

/** Host (chữ thường) của header Referer, hoặc null. Chỉ HOST — không đường dẫn, không query (có thể mang PII). */
export function hostTuReferer(referer: string | null | undefined): string | null {
  if (!referer || referer.length > 2048) return null;
  try {
    const u = new URL(referer);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    return HOST_RE.test(h) && !/^[0-9]+$/.test(h.slice(h.lastIndexOf(".") + 1)) ? h : null;
  } catch {
    return null;
  }
}

const trangChu = (goc: string | null) => (goc === null ? "/" : `${goc}/`);

/** Cắt query + fragment khỏi một URL thô TRƯỚC khi đưa vào `kiemUrlDuocPhep` (hợp đồng của nó chỉ nói về host + đường dẫn). */
export function boQueryVaFragment(raw: string): string {
  const i = raw.search(/[?#]/);
  return i === -1 ? raw : raw.slice(0, i);
}

// ── /r/:token ───────────────────────────────────────────────────────────────────────────────────────────────────

export type CookieDat = { giaTri: string; maxAgeGiay: number };

export type KetQuaBamLink = {
  /** Địa chỉ tuyệt đối để 302 tới. */
  diemDen: string;
  /** Cookie giới thiệu — CHỈ khi link hợp lệ. */
  cookieGioiThieu: CookieDat | null;
  /** Cookie mã phiên ẩn danh — khi đã ghi (hoặc định ghi) một lượt bấm. */
  cookiePhien: CookieDat | null;
  ketCuc: "KHONG_GHI" | "OK" | "KHONG_HOP_LE" | "LOI_NOI_BO";
  clickId: string | null;
};

async function ghiLuotBam(
  client: Khach,
  p: { link: LinkDaTai; outcome: string; referrerHost: string | null; utm: Utm; sessionKey: string | null },
): Promise<string | null> {
  try {
    const r = await client.referralClick.create({
      data: {
        assetId: p.link.id,
        campaignId: p.link.campaignId,
        partyId: p.link.partyId,
        outcome: p.outcome,
        referrerHost: p.referrerHost,
        ...(Object.keys(p.utm).length > 0 ? { utm: p.utm } : {}),
        sessionKey: p.sessionKey,
      },
      select: { id: true },
    });
    return r.id;
  } catch (e) {
    console.error("[affiliate] không ghi được lượt bấm:", e instanceof Error ? e.message : "lỗi");
    return null;
  }
}

/**
 * Bấm `/r/<token>` khi cờ Affiliate TẮT (R5, chốt 13/10/2026): KHÔNG 404 — khách bấm một mã QR / link đã in không được mất. Điểm đến = trang đích SẠCH của link
 * (không `aff`/`cmp`/`clk`), hoặc trang chủ nếu token hỏng/lạ. KHÔNG ghi lượt bấm, KHÔNG đặt cookie, KHÔNG ghi gì xuống DB. Điểm đến vẫn chỉ dựng từ dữ liệu đã lưu (luật 1).
 */
export async function xuLyBamLinkKhiTat(p: { tokenTho: string; ip: string }, deps: PhuThuoc): Promise<{ diemDen: string }> {
  const ve = { diemDen: trangChu(deps.goc) };
  try {
    if (!(await deps.choPhepTanSuat(`aff-r:${p.ip}`, GIOI_HAN_BAM_LINK))) return ve;
    const token = chuanHoaToken(p.tokenTho);
    if (token === null) return ve;
    const link = await taiChuoiLinkTheoToken(deps.client, token);
    if (link === null) return ve;
    const sach = dungUrlTrangDich({ site: link.site, trangDich: link.chuoi.trangDich, landingHost: link.chuoi.taiSan.landingHost, landingPath: link.landingPath });
    return sach.ok ? { diemDen: sach.url } : ve;
  } catch {
    return ve;
  }
}

export async function xuLyBamLink(
  p: {
    tokenTho: string;
    ip: string;
    /** Query của request — CHỈ để lấy khoá `utm_*`. Mọi khoá khác (aff, cmp, clk, redirect, url…) bị bỏ. */
    query: Readonly<Record<string, unknown>>;
    /** Giá trị cookie `sr_aff_s` của request (nếu có). */
    cookiePhien: string | null;
    referer: string | null;
  },
  deps: PhuThuoc,
): Promise<KetQuaBamLink> {
  const ve = (ketCuc: KetQuaBamLink["ketCuc"]): KetQuaBamLink => ({ diemDen: trangChu(deps.goc), cookieGioiThieu: null, cookiePhien: null, ketCuc, clickId: null });
  try {
    if (!(await deps.choPhepTanSuat(`aff-r:${p.ip}`, GIOI_HAN_BAM_LINK))) return ve("KHONG_GHI");
    const token = chuanHoaToken(p.tokenTho);
    if (token === null) return ve("KHONG_GHI");
    const link = await taiChuoiLinkTheoToken(deps.client, token);
    if (link === null) return ve("KHONG_GHI");

    const now = deps.now();
    const kq = kiemChuoiLink(link.chuoi, now);
    const maPhien = p.cookiePhien !== null && MA_PHIEN_RE.test(p.cookiePhien) ? p.cookiePhien : deps.sinhMaPhien();
    const cookiePhien: CookieDat = { giaTri: maPhien, maxAgeGiay: TUOI_COOKIE_PHIEN_GIAY };
    const sessionKey = tinhSessionKey(deps.khoaHmac(), maPhien);
    const referrerHost = hostTuReferer(p.referer);
    const utm = chuanHoaUtm(p.query);

    if (!kq.ok) {
      await ghiLuotBam(deps.client, { link, outcome: kq.ma, referrerHost, utm, sessionKey });
      const sach = dungUrlTrangDich({ site: link.site, trangDich: link.chuoi.trangDich, landingHost: link.chuoi.taiSan.landingHost, landingPath: link.landingPath });
      return { diemDen: sach.ok ? sach.url : trangChu(deps.goc), cookieGioiThieu: null, cookiePhien, ketCuc: "KHONG_HOP_LE", clickId: null };
    }

    const clickId = await ghiLuotBam(deps.client, { link, outcome: "OK", referrerHost, utm, sessionKey });
    const dich = dungUrlDich({
      site: link.site,
      trangDich: link.chuoi.trangDich,
      landingHost: link.chuoi.taiSan.landingHost,
      landingPath: link.landingPath,
      token,
      campaignCode: link.chuoi.campaign.code,
      clickId,
      utm,
    });
    if (!dich.ok) {
      // Chuỗi vừa hợp lệ mà không dựng được URL đích (không nên xảy ra): không đặt cookie, về trang chủ.
      return { diemDen: trangChu(deps.goc), cookieGioiThieu: null, cookiePhien, ketCuc: "LOI_NOI_BO", clickId };
    }
    return {
      diemDen: dich.url,
      cookieGioiThieu: { giaTri: `${token}.${now.getTime()}`, maxAgeGiay: link.chuoi.campaign.cookieWindowDays * NGAY_GIAY },
      cookiePhien,
      ketCuc: "OK",
      clickId,
    };
  } catch (e) {
    console.error("[affiliate] /r lỗi nội bộ:", e instanceof Error ? e.message : "lỗi");
    return ve("LOI_NOI_BO");
  }
}

// ── Beacon ──────────────────────────────────────────────────────────────────────────────────────────────────────

const thanBeaconSchema = z
  .object({
    v: z.literal(1),
    token: z.string().max(64),
    landingUrl: z.string().max(2048),
    utm: z.record(z.string(), z.unknown()).optional(),
  })
  .strip();

export type KetQuaBeacon = {
  /** Giá trị `Access-Control-Allow-Origin`: CHỈ khi origin của request nằm trong `allowedDomains` của website của link; không bao giờ `*`. */
  acao: string | null;
  ketCuc: "KHONG_GHI" | "OK" | "KHONG_HOP_LE";
};

/** `https://host` nếu `origin` (header Origin) có host nằm trong danh sách tên miền; ngược lại null. Origin chỉ là tín hiệu PHỤ — không xác thực gì. */
export function acaoChoOrigin(origin: string | null, allowedDomains: readonly string[]): string | null {
  if (!origin || origin.length > 300) return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" || u.port !== "" || u.pathname !== "/" || u.search !== "" || u.hash !== "" || u.username !== "" || u.password !== "") return null;
    return allowedDomains.includes(u.hostname) ? `https://${u.hostname}` : null;
  } catch {
    return null;
  }
}

export async function xuLyBeacon(
  p: { thanTho: string; origin: string | null; ip: string; cookiePhien: string | null },
  deps: PhuThuoc,
): Promise<KetQuaBeacon> {
  const khong: KetQuaBeacon = { acao: null, ketCuc: "KHONG_GHI" };
  try {
    if (p.thanTho.length === 0 || p.thanTho.length > DO_DAI_THAN_BEACON_TOI_DA) return khong;
    if (!(await deps.choPhepTanSuat(`aff-b:${p.ip}`, GIOI_HAN_BEACON))) return khong;
    let json: unknown;
    try {
      json = JSON.parse(p.thanTho);
    } catch {
      return khong;
    }
    const than = thanBeaconSchema.safeParse(json);
    if (!than.success) return khong;
    const token = chuanHoaToken(than.data.token);
    if (token === null) return khong;
    const link = await taiChuoiLinkTheoToken(deps.client, token);
    if (link === null) return khong;

    const acao = acaoChoOrigin(p.origin, link.chuoi.site.allowedDomains);

    // URL nơi link được mở PHẢI nằm trong website của chính link này (tên miền + trang đích) — không thì không ghi gì.
    const url = kiemUrlDuocPhep(boQueryVaFragment(than.data.landingUrl), link.site, link.chuoi.trangDich);
    if (!url.ok) return { acao, ketCuc: "KHONG_GHI" };

    const maPhien = p.cookiePhien !== null && MA_PHIEN_RE.test(p.cookiePhien) ? p.cookiePhien : null;
    const sessionKey = maPhien !== null ? tinhSessionKey(deps.khoaHmac(), maPhien) : null;
    const utm = chuanHoaUtm(than.data.utm);
    const kq = kiemChuoiLink(link.chuoi, deps.now());
    await ghiLuotBam(deps.client, { link, outcome: kq.ok ? "OK" : kq.ma, referrerHost: url.host, utm, sessionKey });
    return { acao, ketCuc: kq.ok ? "OK" : "KHONG_HOP_LE" };
  } catch (e) {
    console.error("[affiliate] beacon lỗi nội bộ:", e instanceof Error ? e.message : "lỗi");
    return khong;
  }
}
