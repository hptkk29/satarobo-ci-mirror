// lib/affiliate/intake-cong-khai.ts — LÕI của `POST /api/public/affiliate/v1/intake` (AFF-P1, docs/source-commission/12 §2.4–§2.6; đặc tả §22–§30, §50).
// Route chỉ làm việc HTTP; toàn bộ quyết định ở đây để test được bằng DB thật mà không cần dựng Next.
//
// Luật cứng:
//  1. KHÁCH LUÔN ĐƯỢC LƯU (T4). Token hỏng / link thu hồi / tự giới thiệu / nguồn chưa cấu hình / Origin lệch / CỜ AFFILIATE TẮT chỉ quyết có ghi người giới thiệu hay không — không bao giờ làm mất lead.
//  2. Phản hồi KHÔNG BAO GIỜ nói referral có được ghi hay không (cùng một câu cho mọi nhánh): người dò không phân biệt được «token đúng» với «token sai».
//  3. Không tin client: thân chỉ mang token + thông tin khách; mọi thứ khác đọc lại từ DB (`nhan-referral.ts`). Lược đồ `.strict()` từ chối khoá lạ.
//  4. Chống gửi lặp bằng `Lead.eventId` (UNIQUE) = `affiliate:<idempotencyKey>`; dòng referral thêm `idempotencyKey` UNIQUE.
//  5. Bot: ô ẩn `hp` có giá trị ⇒ trả như thành công, KHÔNG tạo gì.
import { rateLimit } from "@/lib/rate-limit";
import { ingestIntakeLead } from "@/lib/lead/intake/ingest";
import { AFFILIATE_HONEYPOT, affiliateIntakeSchema, eventIdAffiliate, mapAffiliateIntake, NGUON_KY_THUAT_AFFILIATE } from "@/lib/lead/intake/map-affiliate";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";
import { chuanBiReferral, docAcaoTheoToken, ghiReferralChoLeadCu, ghiReferralSauKhiTaoLead } from "./nhan-referral";

/** Trần thân (ký tự). Quá thì bỏ ngay không phân tích. */
export const DO_DAI_THAN_INTAKE_TOI_DA = 16_384;
/** Ngưỡng theo IP. Hằng có tên: chưa có khoá SystemSetting riêng cho đường này (đừng mượn khoá của form Sale — khác bản chất). */
export const GIOI_HAN_INTAKE = { max: 10, windowMs: 60_000 } as const;

export const CAU_TRA_LOI_THANH_CONG = "Đã nhận thông tin. Cảm ơn bạn!";

export type KetQuaIntake = {
  status: 200 | 400 | 413 | 429 | 500;
  body: { ok: boolean; message: string };
  /** `Access-Control-Allow-Origin` được phép phản chiếu, hoặc null. Không bao giờ `*`. */
  acao: string | null;
};

const tra = (status: KetQuaIntake["status"], ok: boolean, message: string, acao: string | null = null): KetQuaIntake => ({ status, body: { ok, message }, acao });

export type PhuThuocIntake = {
  now: () => Date;
  choPhepTanSuat: (khoa: string) => Promise<boolean>;
};

export function phuThuocIntakeThat(): PhuThuocIntake {
  return {
    now: () => new Date(),
    choPhepTanSuat: async (khoa) => {
      try {
        return (await rateLimit({ key: khoa, max: GIOI_HAN_INTAKE.max, windowMs: GIOI_HAN_INTAKE.windowMs })).success;
      } catch {
        return true; // hạ tầng giới hạn hỏng không được chặn khách thật
      }
    },
  };
}

/**
 * Đường THƯỜNG (cờ Affiliate BẬT): kiểm token → ghi referral nếu hợp lệ → lưu lead.
 */
export async function xuLyIntakeGioiThieu(
  p: { thanTho: string; origin: string | null; ip: string; userAgent: string | null },
  pt: PhuThuocIntake,
): Promise<KetQuaIntake> {
  return xuLyIntake(p, pt, true);
}

/**
 * Đường khi cờ Affiliate TẮT (R5, chốt 13/10/2026): khách của biểu mẫu trên website đối tác VẪN được lưu như một lead thường, nhưng KHÔNG referral, KHÔNG attribution Affiliate,
 * KHÔNG hoa hồng; token chỉ được dùng để phản chiếu `Access-Control-Allow-Origin` (để trình duyệt của website đối tác đọc được câu «đã nhận» — thiếu header này khách tưởng lỗi và gửi lại).
 * Lead rơi nhóm nguồn chờ (UNKNOWN, xem tay) như mọi lead không có người giới thiệu hợp lệ.
 */
export async function xuLyIntakeKhiTatTheoDoi(
  p: { thanTho: string; origin: string | null; ip: string; userAgent: string | null },
  pt: PhuThuocIntake,
): Promise<KetQuaIntake> {
  return xuLyIntake(p, pt, false);
}

async function xuLyIntake(
  p: { thanTho: string; origin: string | null; ip: string; userAgent: string | null },
  pt: PhuThuocIntake,
  ghiCong: boolean,
): Promise<KetQuaIntake> {
  if (p.thanTho.length > DO_DAI_THAN_INTAKE_TOI_DA) return tra(413, false, "Dữ liệu gửi lên quá lớn.");

  let tho: unknown;
  try {
    tho = JSON.parse(p.thanTho);
  } catch {
    return tra(400, false, "Dữ liệu không hợp lệ.");
  }
  const kq = affiliateIntakeSchema.safeParse(tho);
  if (!kq.success) return tra(400, false, "Dữ liệu không hợp lệ.");
  const dauVao = kq.data;

  // Bot: trả như thành công để không dò ra là đã bị chặn.
  if ((dauVao[AFFILIATE_HONEYPOT] ?? "").length > 0) return tra(200, true, CAU_TRA_LOI_THANH_CONG);

  if (!(await pt.choPhepTanSuat(`aff-intake:${p.ip}`))) return tra(429, false, "Bạn gửi hơi nhanh. Đợi một phút rồi thử lại nhé.");

  const mapped = mapAffiliateIntake(dauVao);
  if (!mapped.ok) return tra(400, false, mapped.error);

  const now = pt.now();
  const eventId = eventIdAffiliate(dauVao.idempotencyKey);

  // Chuẩn bị referral — lỗi ở bước này KHÔNG được làm mất khách: rơi về «lead thường, không người giới thiệu».
  let chuanBi: Awaited<ReturnType<typeof chuanBiReferral>> | null = null;
  let acaoKhiTat: string | null = null;
  if (!ghiCong) {
    try {
      acaoKhiTat = await docAcaoTheoToken(dauVao.token, p.origin);
    } catch (err) {
      console.error("[affiliate-intake] đọc origin khi cờ tắt:", err);
    }
  }
  try {
    if (ghiCong)
      chuanBi = await chuanBiReferral({
      token: dauVao.token,
      clickId: dauVao.clickId ?? null,
      khach: { phone: mapped.lead.phone, email: mapped.lead.email ?? null },
      origin: p.origin,
      idempotencyKey: dauVao.idempotencyKey,
      now,
    });
  } catch (err) {
    console.error("[affiliate-intake] chuẩn bị referral:", err);
  }
  const co = chuanBi && chuanBi.ok ? chuanBi : null;
  const acao = co ? co.acao : acaoKhiTat;

  const ketQua = await ingestIntakeLead(mapped.lead, {
    source: NGUON_KY_THUAT_AFFILIATE,
    eventId,
    ipAddress: p.ip,
    userAgent: p.userAgent,
    actorName: "Hệ thống (biểu mẫu giới thiệu)",
    // ẨN DANH (không đăng nhập, không chữ ký): SĐT trùng lead đang mở ⇒ chỉ để dấu vết trùng, KHÔNG sửa hồ sơ có sẵn (reviewer Bảo mật 14/10/2026).
    chiGhiDauVetKhiTrung: true,
    utmSource: dauVao.utm?.utm_source ?? null,
    utmCampaign: dauVao.utm?.utm_campaign ?? null,
    tinHieuNguon: { ...KHONG_CO_TIN_HIEU_NGUON, affiliate: co?.tinHieu ?? null },
    sauKhiTaoLead: co
      ? async ({ leadId, centerId }) => {
          await ghiReferralSauKhiTaoLead({ ghi: co.ghi, leadId, centerId, now });
        }
      : undefined,
    khiLeadTrung: co ? async (leadId) => void (await ghiReferralChoLeadCu({ ghi: co.ghi, leadId, now })) : undefined,
  });

  if (!ketQua.ok) {
    console.error("[affiliate-intake] ingest:", ketQua.error);
    return tra(500, false, "Chưa lưu được thông tin. Bạn thử lại giúp nhé.", acao);
  }
  return tra(200, true, CAU_TRA_LOI_THANH_CONG, acao);
}
