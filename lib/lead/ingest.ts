import { ingestIntakeLead } from "./intake/ingest";
import { laNguonDuongCu } from "./nguon-duong-cu";

// =============================================================================
// LEAD INGEST — lớp bọc tương thích cho 3 nguồn webhook có từ Phase T1.4
// (facebook / zalo / google-form).
//
// Lõi thật nằm ở `lib/lead/intake/ingest.ts` — một đường ghi duy nhất cho MỌI
// nguồn ngoài. File này chỉ đổi hình dữ liệu vào cho khớp lời gọi cũ.
//
// HÀNH VI CỦA 3 NGUỒN NÀY GIỮ NGUYÊN 100% so với trước khi tách lõi:
//  - `legacyWebhook: true` ⇒ vẫn `autoAssignLead` (bản cũ), và SĐT không chuẩn
//    hoá được thì vẫn lưu chuỗi thô thay vì bị từ chối.
//  - `child: null` ⇒ KHÔNG tạo bản ghi `LeadChild`, chỉ set `Lead.childName`
//    y như cũ. `extractLeadFields` moi tên con từ text tự do nên độ tin thấp;
//    đẻ `LeadChild` từ đó là bơm rác vào màn chuyển đổi. Kéo theo: luật QĐ-D1
//    ("trùng SĐT khác con ⇒ gắn thêm con") KHÔNG áp cho 3 nguồn này — nó được
//    chốt cho form Sale, nơi tên con là ô nhập riêng.
//
// ⚠️ MỘT NGOẠI LỆ CÓ CHỦ ĐÍCH với câu "giữ nguyên 100%" ở trên: sự đồng ý nhận
// thông tin (`consentMarketing`). Trước 06/09/2026 file này ghi CỨNG `true` cho
// mọi phiếu — xem mục "SỰ ĐỒNG Ý" ngay dưới. Đó là hành vi SAI, nên nó là thứ
// duy nhất được cố ý đổi.
//
// Gộp nốt 3 nguồn cũ sang đường mới là việc NÊN làm, nhưng phải là đợt riêng
// có nghiệm thu.
//
// -----------------------------------------------------------------------------
// SỰ ĐỒNG Ý NHẬN THÔNG TIN — vì sao mặc định là `false` (S8 / việc 9.10, 06/09/2026)
//
// Bản cũ truyền `consentMarketing: true` cho MỌI phiếu đi qua đây. Không nguồn
// nào trong ba nguồn cũ có ô đồng ý: Facebook Lead Ads trả về đúng các ô của
// biểu mẫu quảng cáo, webhook Zalo OA trả nội dung tin, Google Form trả các ô
// của bảng hỏi. Ghi `true` ở đó là **ghi nhận một sự đồng ý chưa ai từng cho**.
//
// Cái `true` giả đó không nằm yên trong DB:
//   · `consentMarketing` là cổng cho liên hệ mục đích MARKETING (trục gọi điện OmiCall
//     từng dùng nó — đã gỡ 06/10/2026) ⇒ `true` giả là cho chào hàng người chưa đồng ý;
//   · màn chi tiết lead in "Consent marketing: Có" nên người trực tin theo.
//
// Nay giá trị phải đến từ NGUỒN: nơi gọi nào có ô tích thì truyền đúng cái ô đó
// xuống; nguồn không có ô thì bỏ trống ⇒ `false`. `false` ở đây nghĩa là "chưa
// có bằng chứng đồng ý", KHÔNG phải "đã từ chối" — vẫn liên hệ được để phản hồi
// đúng yêu cầu người ta vừa gửi, chỉ là không được xếp vào danh sách marketing.
//
// Hệ quả cần biết trước khi merge: lead mới từ 3 webhook cũ sẽ mang `false`, nên
// cuộc gọi MARKETING tới nhóm đó bị chặn ở `muc-dich.ts` (gọi CHĂM SÓC/tư vấn
// theo yêu cầu thì không). Đây là kết quả ĐÚNG, không phải hồi quy. Dữ liệu cũ
// đã lỡ ghi `true` thì file này không đụng tới — sửa ngược lịch sử là một quyết
// định vận hành + pháp lý riêng, không phải việc của một lớp bọc.
// =============================================================================

export type IngestLeadInput = {
  parentName: string;
  phone: string;
  email?: string | null;
  childName?: string | null;
  source: string; // "facebook" | "zalo" | "google-form" | ...
  note?: string | null;
  eventId?: string | null; // idempotency (unique trên Lead.eventId)
  /**
   * Người ta có tích ô "đồng ý nhận thông tin" trên chính biểu mẫu nguồn không.
   *
   * BỎ TRỐNG ⇒ `false`. Đó là mặc định đúng cho mọi nguồn KHÔNG CÓ ô đồng ý (cả
   * 3 webhook cũ hiện nay), và là lý do trường này để tuỳ chọn thay vì bắt buộc:
   * nơi gọi không có gì để nói thì đừng bắt nó bịa ra một giá trị.
   *
   * Chỉ truyền `true` khi cầm được bằng chứng thật — một ô tích trên biểu mẫu mà
   * người ta đã bấm. Suy ra từ "họ chủ động nhắn tin cho mình" là SUY DIỄN, không
   * phải đồng ý.
   */
  consentMarketing?: boolean;
  centerId?: string | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
  landingPage?: string | null;
};

export type IngestResult = {
  ok: boolean;
  leadId?: string;
  duplicate?: boolean;
  error?: string;
};

export async function ingestLead(input: IngestLeadInput): Promise<IngestResult> {
  const parentName = input.parentName?.trim();
  const phone = input.phone?.trim();
  if (!parentName || !phone) {
    return { ok: false, error: "Thiếu parentName hoặc phone" };
  }

  const result = await ingestIntakeLead(
    {
      parentName,
      phone,
      email: input.email?.trim() || null,
      centerHint: null,
      // Cố ý null — xem docblock đầu file (giữ nguyên hành vi cũ, không đẻ LeadChild).
      children: [],
      childName: input.childName?.trim() || null,
      employeeCode: null,
      noteLines: input.note ? [input.note] : [],
      // `eventId` của lời gọi cũ ĐÃ gắn sẵn tiền tố nguồn (`webhook.ts` dựng
      // `"<source>:<externalId>"`). Truyền thẳng làm `externalId` sẽ thành
      // `"facebook:facebook:123"` ⇒ mất tính idempotent với dữ liệu cũ.
      externalId: null,
      // So sánh `=== true` chứ không `?? false` / ép boolean: payload webhook là
      // `unknown` và nơi gọi có thể ép kiểu cẩu thả, nên chuỗi `"true"`, số `1`
      // hay một object rỗng đều "truthy" mà không phải sự đồng ý của ai cả.
      // Đồng ý chỉ được ghi khi cầm đúng `true` kiểu boolean; mọi thứ khác là
      // chưa rõ, và chưa rõ thì fail-closed. Xem mục "SỰ ĐỒNG Ý" đầu file.
      consentMarketing: input.consentMarketing === true,
      warnings: [],
    },
    {
      source: input.source,
      landingPage: input.landingPage ?? null,
      actorName: "Hệ thống (webhook)",
      centerId: input.centerId ?? null,
      eventId: input.eventId ?? null,
      utmSource: input.utmSource ?? null,
      utmCampaign: input.utmCampaign ?? null,
      // Đặt cứng `true` ở đây từng là cái bẫy — xem `lib/lead/nguon-duong-cu.ts`.
      legacyWebhook: laNguonDuongCu(input.source),
    },
  );

  return {
    ok: result.ok,
    leadId: result.leadId,
    duplicate: result.duplicate,
    error: result.error,
  };
}
