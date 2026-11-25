import "server-only";
// lib/integrations/zalocrm/config.ts — CẤU HÌNH THEO ORG cho đường webhook.
//
// =============================================================================
// 🔴 BÍ MẬT HMAC Ở **ENV**, KHÔNG Ở `IntegrationConfig.settings` (chốt Q3).
//
// `settings` là cột `Json` lưu PLAINTEXT: nó đi vào mọi bản `pg_dump`, mọi bản sao
// DB dev/test, và mọi lần ai đó mở Studio. Luật cứng #9 nói rõ "secret chỉ trong
// env". `settings` ở đây chỉ giữ thứ KHÔNG bí mật: bật/tắt, mốc đồng bộ.
//
// ⚠️ DB của môi trường `test` CHÍNH LÀ DB local (CLAUDE.md, chốt 01/08) — nên "chỉ
// là DB test thôi mà" không phải một lý do; nó là cùng một tệp dump.
//
// ── VÌ SAO MỖI ORG MỘT KHOÁ ───────────────────────────────────────────────────
// Ba org (CS1, CS2, TEST) chạy trên **một** máy chủ ZaloCRM, sau **một** Cloudflare
// Tunnel. Dùng chung một khoá thì lộ ở một cơ sở là mở cửa cho mọi cơ sở, và không
// cách nào xoay khoá cho riêng nơi bị lộ.
// =============================================================================
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { KHUON_ORG_CODE, PROVIDER_ZALOCRM } from "./types";

// Hai hằng dưới đây ĐỊNH NGHĨA ở `types.ts` (module thuần) và chỉ re-export lại đây
// cho gọn chỗ gọi. Nhờ vậy `log.ts` dùng được `PROVIDER_ZALOCRM` mà KHÔNG phải kéo
// theo `db` + `getSetting` của file này — nhật ký là thứ phải chạy được cả khi mọi
// thứ khác đang hỏng.
export { KHUON_ORG_CODE, PROVIDER_ZALOCRM };

/**
 * Khoá tra `IntegrationConfig` cho một org.
 *
 * Khuôn `PROVIDER:<hậu tố>` lấy từ `lib/payments/vietqr.ts:20-22` — `provider` là
 * `@unique` toàn cục và KHÔNG có cột cơ sở, nên cách ly phải nằm trong chính chuỗi.
 */
export function providerKeyForOrg(org: string): string {
  return `${PROVIDER_ZALOCRM}:${org}`;
}

export type MaLoiCauHinh =
  /** Đoạn `[org]` trên URL không đúng khuôn — chưa tra DB. Nơi gọi trả 404. */
  | "ORG_KHONG_HOP_LE"
  /** Env `ZALOCRM_WEBHOOK_SECRETS` vắng/hỏng. Lỗi CỦA MÌNH ⇒ nơi gọi trả **503**. */
  | "THIEU_BI_MAT"
  /** Env có, nhưng không có khoá cho org này ⇒ org lạ. Nơi gọi trả 404 + ghi vết. */
  | "ORG_KHONG_KHAI"
  /** Có dòng cấu hình và người vận hành đã TẮT riêng org này. Nơi gọi trả 404. */
  | "ORG_TAT";

export type CauHinhOrg = {
  orgCode: string;
  /** Khoá HMAC của org. KHÔNG BAO GIỜ log, không đưa vào thông điệp lỗi. */
  secret: string;
  /** `null` = orgCode chưa ánh xạ cơ sở nào. Giữ null thay vì đoán — xem bên dưới. */
  centerId: string | null;
  orgUnitId: string | null;
};

export type KetQuaCauHinhOrg =
  | { ok: true; cauHinh: CauHinhOrg }
  | { ok: false; ma: MaLoiCauHinh; thongDiep: string };

/**
 * Bảng bí mật theo org, đọc từ env `ZALOCRM_WEBHOOK_SECRETS` (JSON `{org: secret}`).
 *
 * FAIL-CLOSED ở MỌI môi trường. Ở đây CỐ Ý KHÔNG có nhánh "dev thì cho qua" như
 * `kiemBiMatWebhook` của OmiCall (`lib/calls/webhook.ts:53-59` — đã gỡ 06/10/2026): nhánh đó là ngoại lệ
 * riêng của nhà cung cấp đó (chưa biết họ có ký hay không), còn ZaloCRM ký HMAC bắt
 * buộc. Và "dev" chính là môi trường người ta hay quên bật lại.
 */
export function docBangBiMat():
  | { ok: true; bang: Record<string, string> }
  | { ok: false; ma: "THIEU_BI_MAT" } {
  const tho = process.env.ZALOCRM_WEBHOOK_SECRETS;
  if (!tho || !tho.trim()) return { ok: false, ma: "THIEU_BI_MAT" };

  let doc: unknown;
  try {
    doc = JSON.parse(tho);
  } catch {
    // KHÔNG in `tho` ra log — nó chứa mọi khoá của mọi cơ sở (luật cứng #9).
    console.error("[zalocrm] ZALOCRM_WEBHOOK_SECRETS không phải JSON hợp lệ.");
    return { ok: false, ma: "THIEU_BI_MAT" };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    console.error("[zalocrm] ZALOCRM_WEBHOOK_SECRETS phải là object JSON {org: secret}.");
    return { ok: false, ma: "THIEU_BI_MAT" };
  }

  const bang: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    // Khoá rỗng KHÔNG phải là "có khoá": để nó lọt là mọi chữ ký rỗng đều khớp.
    if (typeof v === "string" && v.trim()) bang[k] = v;
  }
  return { ok: true, bang };
}

/**
 * Cấu hình đầy đủ của một org: bí mật + cơ sở.
 *
 * Thứ tự kiểm CÓ Ý NGHĨA — khuôn trước (không ném chuỗi người lạ vào `findUnique`),
 * env sau (503 là lỗi của mình), DB cuối.
 */
export async function traCauHinhOrg(org: string): Promise<KetQuaCauHinhOrg> {
  if (!KHUON_ORG_CODE.test(org ?? "")) {
    return {
      ok: false,
      ma: "ORG_KHONG_HOP_LE",
      thongDiep: "Mã tổ chức không đúng khuôn.",
    };
  }

  const bang = docBangBiMat();
  if (!bang.ok) {
    console.error(
      "[zalocrm] THIẾU ZALOCRM_WEBHOOK_SECRETS — TỪ CHỐI mọi webhook (fail-closed).",
    );
    return {
      ok: false,
      ma: "THIEU_BI_MAT",
      thongDiep: "Webhook chưa cấu hình bí mật.",
    };
  }

  const secret = bang.bang[org];
  if (!secret) {
    // 404 nhưng PHẢI để lại vết: triệu chứng của "gõ sai một ký tự trong webhook_url"
    // là hộp thư TRỐNG, không phải một lỗi ai đó nhìn thấy.
    console.warn(`[zalocrm] webhook cho org lạ: ${org} — chưa khai trong ZALOCRM_WEBHOOK_SECRETS.`);
    return { ok: false, ma: "ORG_KHONG_KHAI", thongDiep: "Không tìm thấy tổ chức." };
  }

  const cauHinh = await db.integrationConfig.findUnique({
    where: { provider: providerKeyForOrg(org) },
    select: { isEnabled: true, settings: true },
  });
  // CHƯA có dòng cấu hình thì VẪN nhận tin: màn Tích hợp (L9) chưa lên, mà cổng thật
  // là bí mật trong env chứ không phải một dòng trong DB. Chỉ khi người vận hành đã
  // TẮT tường minh mới từ chối.
  if (cauHinh && cauHinh.isEnabled === false) {
    console.warn(`[zalocrm] org ${org} đang TẮT ở màn Tích hợp — từ chối webhook.`);
    return { ok: false, ma: "ORG_TAT", thongDiep: "Tổ chức đang tắt." };
  }

  const { centerId, orgUnitId } = await traCoSoTheoOrg(org);
  return { ok: true, cauHinh: { orgCode: org, secret, centerId, orgUnitId } };
}

/**
 * orgCode → cơ sở, qua setting `zalocrm.orgCodes` (khoá = `Center.code`, giá trị =
 * orgCode). Chiều của ánh xạ là một HỢP ĐỒNG — đảo chiều lúc tra là ánh xạ về cơ sở
 * khác, im lặng.
 *
 * Chưa ánh xạ ⇒ `null`, KHÔNG đoán: gán nhầm cơ sở kéo theo gán nhầm `orgUnitId` cho
 * mọi hội thoại của nick đó, tức rò chéo cơ sở mà không có gì báo. `null` thì hội
 * thoại nằm ở nhóm mồ côi — ai cũng thấy, nhưng đó là trạng thái ĐÃ BIẾT và có hàng
 * đợi xử lý (`lib/inbox/scope.ts`).
 */
async function traCoSoTheoOrg(
  org: string,
): Promise<{ centerId: string | null; orgUnitId: string | null }> {
  let anhXa: Record<string, string> = {};
  try {
    anhXa = await getSetting("zalocrm.orgCodes");
  } catch (err) {
    // Đọc setting hỏng KHÔNG được làm rơi tin: thà nhận tin ở dạng mồ côi còn hơn
    // trả 5xx cho một hội thoại thật.
    console.error("[zalocrm] không đọc được setting zalocrm.orgCodes:", err);
    return { centerId: null, orgUnitId: null };
  }

  const maCoSo = Object.keys(anhXa).find((k) => anhXa[k] === org);
  if (!maCoSo) return { centerId: null, orgUnitId: null };

  // `Center` KHÔNG có `deletedAt` (chỉ có `isActive`) — và CỐ Ý không lọc `isActive`:
  // một cơ sở tạm ngừng hoạt động vẫn phải nhận được tin của khách cũ. Lọc nó ở đây
  // là biến "tạm ngừng" thành "mọi hội thoại rơi về mồ côi", im lặng.
  const center = await db.center.findFirst({
    where: { code: maCoSo },
    select: { id: true },
  });
  if (!center) {
    console.warn(`[zalocrm] orgCode ${org} ánh xạ tới mã cơ sở ${maCoSo} không tồn tại.`);
    return { centerId: null, orgUnitId: null };
  }
  return { centerId: center.id, orgUnitId: await orgUnitIdForCenter(center.id) };
}
