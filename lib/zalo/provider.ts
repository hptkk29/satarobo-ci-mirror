import "server-only";
import { getValidZaloAccessToken, forceRefreshZaloToken } from "@/lib/zalo/token";
import { canonicalPhone } from "@/lib/phone";
import { getSetting } from "@/lib/settings/service";
import { datChoNganSach, hoanNganSach } from "@/lib/ngan-sach-goi-ra/so-chi";
import { MA_KHONG_DEM_DUOC } from "@/lib/ngan-sach-goi-ra/chinh-sach";

// =============================================================================
// Cụm C5 + commit 5 — Zalo OA/ZNS provider.
//  - ZALO_OA_ID mặc định 40213330288531842 (có thể override qua env).
//  - Token lấy qua getValidZaloAccessToken() (tự refresh, xem lib/zalo/token.ts).
//    Cấu hình = có ZALO_OA_ACCESS_TOKEN HOẶC bộ refresh (APP_ID+SECRET+REFRESH).
//    Thiếu → tắt an toàn (service fallback email).
//  - Chỉ gọi API ZNS THẬT khi ZALO_LIVE=true (tránh gửi nhầm khi test). Có token
//    nhưng chưa live → mô phỏng thành công (không gọi API).
// =============================================================================

const DEFAULT_OA_ID = "40213330288531842";
const ZNS_ENDPOINT = "https://business.openapi.zalo.me/message/template";
// Mã lỗi ZNS cho biết access_token sai/hết hạn → refresh + thử lại 1 lần.
const AUTH_ERROR_CODES = new Set([-124, -201, -216]);

export interface ZaloSendInput {
  toPhone: string;
  templateKey?: string | null; // = template_id ZNS đã duyệt
  params?: Record<string, string | number>; // = template_data
}

export interface ZaloSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface ZaloProvider {
  name: string;
  isConfigured(): boolean;
  isLive(): boolean;
  send(input: ZaloSendInput): Promise<ZaloSendResult>;
}

/** Có thể gửi Zalo? = có token tĩnh HOẶC đủ bộ refresh để tự lấy token. */
function hasCredentials(): boolean {
  return Boolean(
    process.env.ZALO_OA_ACCESS_TOKEN ||
      (process.env.ZALO_OA_REFRESH_TOKEN && process.env.ZALO_APP_ID && process.env.ZALO_APP_SECRET),
  );
}

// AUTH-SĐT P1 — bản chuẩn hoá riêng đã gỡ. ZNS đòi đúng `84xxxxxxxxx`, cũng
// chính là canonical của repo (QĐ-4): không phải convert lúc gửi thì không có
// chỗ để lệch. Dữ liệu rác không chuẩn hoá được thì cứ gửi chữ số thô cho ZNS
// từ chối, đừng tự bịa số.
const toZnsPhone = (phone: string) => canonicalPhone(phone) ?? phone.replace(/\D/g, "");

type ZnsPostResult = ZaloSendResult & { authError?: boolean };

/** 1 lần POST tới ZNS với access_token cho trước. */
async function postZns(accessToken: string, input: ZaloSendInput): Promise<ZnsPostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(ZNS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", access_token: accessToken },
      body: JSON.stringify({
        phone: toZnsPhone(input.toPhone),
        template_id: input.templateKey,
        template_data: input.params ?? {},
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as
      | { error?: number; message?: string; data?: { msg_id?: string } }
      | null;
    // ZNS: error === 0 là thành công.
    if (json && json.error === 0) {
      return { ok: true, providerMessageId: json.data?.msg_id };
    }
    const code = json?.error;
    return {
      ok: false,
      error: `ZNS_ERR_${code ?? "?"}:${json?.message ?? "unknown"}`,
      authError: typeof code === "number" && AUTH_ERROR_CODES.has(code),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "ZNS_FETCH_FAILED" };
  } finally {
    clearTimeout(timer);
  }
}

export const znsProvider: ZaloProvider = {
  name: "zalo-zns",
  isConfigured() {
    return hasCredentials();
  },
  isLive() {
    return this.isConfigured() && process.env.ZALO_LIVE === "true";
  },
  async send(input: ZaloSendInput): Promise<ZaloSendResult> {
    if (!hasCredentials()) return { ok: false, error: "ZALO_NOT_CONFIGURED" };

    // 07/08 — công tắc live chuyển sang SystemSetting để admin tự bật/tắt, không cần
    // deploy. Setting thắng; env ZALO_LIVE là dự phòng khi chưa đặt setting.
    // Đọc lỗi (DB sập) → coi như KHÔNG live: thà không gửi còn hơn gửi nhầm hàng loạt.
    const liveFromDb = await getSetting("zalo.znsLive").catch(() => false);
    const live = this.isConfigured() && (liveFromDb || process.env.ZALO_LIVE === "true");
    if (!live) {
      // Có cấu hình nhưng chưa bật live → mô phỏng, KHÔNG gọi API thật.
      return { ok: true, providerMessageId: `SIMULATED-${input.toPhone}` };
    }
    // Gửi ZNS thật cần template đã duyệt.
    if (!input.templateKey) return { ok: false, error: "ZALO_NO_TEMPLATE" };

    // ── TRẦN CHI PHÍ THÁNG (chốt 27/08/2026) ────────────────────────────────
    // Cổng đặt Ở ĐÂY, không ở `lib/zalo/service.ts`, vì có HAI ngăn xếp cùng tiêu
    // tiền Zalo và chúng chỉ gặp nhau tại hàm này:
    //   A) sendZaloNotification → znsProvider.send
    //   B) requestOtp → zaloOtpProvider.send → znsProvider.send
    // Gác ở `service.ts` là để toàn bộ tin OTP đi vòng qua cổng.
    //
    // Đặt SAU nhánh mô phỏng và SAU kiểm tra mẫu: hai trường hợp đó chắc chắn không
    // phát sinh phí, trừ tiền cho chúng là để môi trường test ăn hết trần của prod.
    const giaMotTin = await getSetting("outbound.znsUnitCostVnd").catch(() => null);
    if (giaMotTin === null) {
      // Không biết một tin tốn bao nhiêu ⇒ không đếm được ⇒ không gửi. Cùng luật
      // fail-closed với công tắc live ngay phía trên.
      return { ok: false, error: `${MA_KHONG_DEM_DUOC}: Không đọc được đơn giá tin ZNS.` };
    }
    const datCho = await datChoNganSach({ truc: "ZALO", chiPhiVnd: giaMotTin });
    if (!datCho.ok) {
      // KHÔNG trả `ok: true`. Nơi gọi sẽ ghi FAILED + gửi email dự phòng (nếu có),
      // tức phụ huynh vẫn nhận được thông tin qua kênh khác thay vì im lặng mất tin.
      return { ok: false, error: `${datCho.ma}: ${datCho.thongDiep}` };
    }

    const accessToken = await getValidZaloAccessToken();
    if (!accessToken) {
      await hoanNganSach({ truc: "ZALO", chiPhiVnd: giaMotTin });
      return { ok: false, error: "ZALO_NOT_CONFIGURED" };
    }

    let result = await postZns(accessToken, input);
    // Token lỗi auth (hiếm — race hết hạn) → refresh + thử lại 1 lần.
    // Một suất ngân sách phủ cả hai lượt POST: cùng lắm chỉ MỘT tin tới tay khách.
    if (!result.ok && result.authError) {
      const fresh = await forceRefreshZaloToken();
      if (fresh) result = await postZns(fresh, input);
    }
    // Zalo KHÔNG tính phí tin gửi hỏng (văn bản ZBS 31/07) ⇒ trả lại suất đã đặt.
    // Thiếu bước này thì một đợt lỗi xác thực hàng loạt ăn sạch trần tháng mà chưa
    // gửi được tin nào — trần biến thành cầu chì tự nổ.
    if (!result.ok) await hoanNganSach({ truc: "ZALO", chiPhiVnd: giaMotTin });

    return { ok: result.ok, providerMessageId: result.providerMessageId, error: result.error };
  },
};

// Giữ tham chiếu để tránh "unused" khi chỉ cần OA_ID ở chỗ khác sau này.
export const DEFAULT_ZALO_OA_ID = DEFAULT_OA_ID;
