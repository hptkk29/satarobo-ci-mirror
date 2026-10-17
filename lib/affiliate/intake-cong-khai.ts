// lib/affiliate/intake-cong-khai.ts — LÕI của `POST /api/public/affiliate/v1/intake` (AFF-P1, docs/source-commission/12 §2.4–§2.6; đặc tả §22–§30, §50).
// Route chỉ làm việc HTTP; toàn bộ quyết định ở đây để test được bằng DB thật mà không cần dựng Next.
//
// Luật cứng:
//  1. KHÁCH LUÔN ĐƯỢC LƯU (T4). Token hỏng / link thu hồi / tự giới thiệu / nguồn chưa cấu hình / Origin lệch / CỜ AFFILIATE TẮT chỉ quyết có ghi người giới thiệu hay không — không bao giờ làm mất lead.
//  2. Phản hồi KHÔNG BAO GIỜ nói referral có được ghi hay không (cùng một câu cho mọi nhánh): người dò không phân biệt được «token đúng» với «token sai».
//  3. Không tin client: thân chỉ mang token + thông tin khách; mọi thứ khác đọc lại từ DB (`nhan-referral.ts`). Lược đồ `.strict()` từ chối khoá lạ.
//  4. Chống gửi lặp bằng `Lead.eventId` (UNIQUE) = `affiliate:<idempotencyKey>`; dòng referral thêm `idempotencyKey` UNIQUE.
//  5. Bot: ô ẩn `hp` có giá trị ⇒ trả như thành công, KHÔNG tạo gì.
//  6. (R9 · N1) KHÔNG LÀM LỘ «SĐT NÀY ĐÃ CÓ TRONG CRM HAY CHƯA» qua đường công khai: lead mới · lead trùng · xem tay · bị từ chối đều trả CÙNG status, CÙNG thân, CÙNG header (trừ
//     `Access-Control-Allow-Origin`, vốn chỉ phụ thuộc token/Origin — không phụ thuộc khách), và CÙNG LỚP THỜI GIAN: mọi nhánh đã chạm khách chờ tới ngưỡng tối thiểu `DO_TRE_TOI_THIEU_MS` (+ nhiễu
//     ngẫu nhiên) trước khi trả lời — đường «trùng» (chỉ ghi dấu vết) vốn nhanh hơn đường «lead mới» (tạo lead + con + chia chủ) nên đo thời gian là đoán được số có trong CRM hay không.
//     Phần còn lại của kênh dò là cổng đối tác (`lib/affiliate/cua-toi.ts`, `NGAY_AN_KET_QUA_REFERRAL`).
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

/**
 * Ngưỡng thời gian TỐI THIỂU (ms) của mọi lượt đã chạm khách (cả thành công lẫn lỗi lưu). Đo thực tế đường «lead mới» vài trăm ms; ngưỡng đặt phía trên để cả hai đường rơi vào cùng một lớp.
 * Cộng nhiễu 0..`DO_TRE_NHIEU_TOI_DA_MS`. Không áp cho nhánh bot (`hp`), 400/413/429 — các nhánh đó không đi qua DB nên không mang thông tin về khách.
 */
export const DO_TRE_TOI_THIEU_MS = 700;
export const DO_TRE_NHIEU_TOI_DA_MS = 150;

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
  /** Chờ `ms` mili giây (R9 · N1). BẮT BUỘC khai (luật 7): bỏ trống là mất lớp thời gian chung — test truyền hàm ghi nhận để khẳng định, không chờ thật. */
  cho: (ms: number) => Promise<void>;
  /** Nhiễu 0..`DO_TRE_NHIEU_TOI_DA_MS` (R9 · N1). Tách ra để test cố định được. */
  nhieuMs: () => number;
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
    cho: (ms) => new Promise((xong) => setTimeout(xong, ms)),
    nhieuMs: () => Math.floor(Math.random() * (DO_TRE_NHIEU_TOI_DA_MS + 1)),
  };
}

/** Chờ cho đủ `DO_TRE_TOI_THIEU_MS` (+ nhiễu) kể từ `batDau`. Đã chậm hơn ngưỡng thì không chờ thêm. */
async function denNguongThoiGian(pt: PhuThuocIntake, batDau: number): Promise<void> {
  const conLai = DO_TRE_TOI_THIEU_MS + pt.nhieuMs() - (pt.now().getTime() - batDau);
  if (conLai > 0) await pt.cho(conLai);
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
  const batDau = now.getTime();
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

  // Mọi lỗi KHÔNG lường trước ở đường ingest (ném từ ngoài khối bắt lỗi của nó) cũng phải đi hết lớp thời gian chung và ra CÙNG câu 500 như lỗi lưu thường — không để một lượt ném trần ra khỏi route
  // (500 mặc định của Next khác thân, và không chờ) làm lộ nhánh nào đã chạy (reviewer 14/10/2026).
  let ketQua: Awaited<ReturnType<typeof ingestIntakeLead>>;
  try {
    ketQua = await ingestIntakeLead(mapped.lead, {
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
  } catch (err) {
    console.error("[affiliate-intake] ingest ném lỗi:", err);
    ketQua = { ok: false, error: "Lỗi không lường trước ở đường ingest." };
  }

  // Cùng lớp thời gian cho MỌI nhánh đã chạm khách (lead mới · trùng · lỗi lưu) — xem luật 6 ở đầu tệp.
  await denNguongThoiGian(pt, batDau);
  if (!ketQua.ok) {
    console.error("[affiliate-intake] ingest:", ketQua.error);
    return tra(500, false, "Chưa lưu được thông tin. Bạn thử lại giúp nhé.", acao);
  }
  return tra(200, true, CAU_TRA_LOI_THANH_CONG, acao);
}
