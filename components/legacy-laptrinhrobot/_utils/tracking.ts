"use client";

import { canonicalPhone, isValidPhoneVN } from "@/lib/phone";
import { readAttribution } from "@/lib/marketing/attribution";

// gtag/fbq global types declared in components/public/{ga4,meta-pixel}.tsx

export const GOOGLE_SHEET_URL =
  "https://script.google.com/macros/s/AKfycbw4Zlz8HyWqVp_no4m0DSsej61WPbmLoSwYrv9DCU6qzy-OOimZe8LtFFVl5z8k_ruK/exec";

export interface LeadData {
  /** Họ tên phụ huynh — form mới để KHÔNG bắt buộc, có thể rỗng. */
  name?: string;
  phone?: string;
  email?: string;
  center?: string;
  course?: string;
  // Bộ field bổ sung theo form đăng ký mới. Lead không có cột riêng cho trường /
  // lớp / tỉnh nên 3 thứ này đi vào `note`; `childName` thì có cột thật.
  childName?: string;
  school?: string;
  grade?: string;
  province?: string;
  /** Honeypot — server chỉ kiểm đúng khoá `website`, đặt tên khác là mất tác dụng. */
  website?: string;
  /** Giây kể từ lúc mở form. Server vứt lead nếu < 3 (nghi bot). */
  timeOnPage?: number;
}

/**
 * Payload của đường GỬI LEAD — khác `LeadData` ở đúng một trường.
 *
 * Vì sao tách: `LeadData` dùng chung cho cả payload pixel (`trackFacebookLead`,
 * `trackGA4Lead`) lẫn payload gửi lead. Bắt buộc trường đồng ý trên `LeadData` sẽ ép
 * hai hàm tracking phải khai một thứ chúng không liên quan — `tsc` đã chỉ đúng 4 chỗ đó.
 *
 * Trường này CỐ Ý không optional và không có mặc định: để `tsc` liệt kê mọi đường gửi
 * thay vì để một đường quên truyền rồi lặng lẽ gửi lead không có đồng ý. Server
 * (`leadCreateSchema`) chặn bằng `z.literal(true)`, nên gửi `false` bị từ chối — đó là
 * ý đồ, không phải lỗi.
 */
export interface LeadSubmitData extends LeadData {
  dongYChinhSachBaoMat: boolean;
}

export function trackFacebookLead(data: LeadData = {}): void {
  if (typeof window !== "undefined" && typeof window.fbq === "function") {
    try {
      window.fbq("track", "Lead", {
        content_name: data.course || "Khóa học Robotics",
        content_category: data.center || "Sata Robo Đà Nẵng",
        value: 0,
        currency: "VND",
      });
    } catch (err) {
      console.warn("[Pixel] Track Lead error:", err);
    }
  }
}

export function trackPixelEvent(eventName: string, data: Record<string, unknown> = {}): void {
  if (typeof window !== "undefined" && typeof window.fbq === "function") {
    try {
      window.fbq("trackCustom", eventName, data);
    } catch (err) {
      console.warn("[Pixel] Custom track error:", err);
    }
  }
}

export function trackGA4Lead(data: LeadData = {}): void {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    try {
      window.gtag("event", "generate_lead", {
        course_name: data.course || "Không xác định",
        center: data.center || "Không xác định",
        currency: "VND",
        value: 0,
      });
    } catch (err) {
      console.warn("[GA4] Track lead error:", err);
    }
  }
}

export function trackGA4Event(eventName: string, params: Record<string, unknown> = {}): void {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    try {
      window.gtag("event", eventName, params);
    } catch (err) {
      console.warn("[GA4] Event track error:", err);
    }
  }
}

export async function submitLeadToSheet(formData: LeadData): Promise<{ success: boolean; error?: string }> {
  try {
    // GIỮ NGUYÊN 5 khoá cũ (Google Apps Script đang đọc theo tên) — chỉ thêm khoá mới.
    const sheetPayload = JSON.stringify({
      name: formData.name || "",
      phone: formData.phone || "",
      email: formData.email || "",
      center: formData.center || "",
      course: formData.course || "",
      childName: formData.childName || "",
      school: formData.school || "",
      grade: formData.grade || "",
      province: formData.province || "",
    });

    await fetch(GOOGLE_SHEET_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: sheetPayload,
    });

    return { success: true };
  } catch (err) {
    console.error("[Sheet] Submit error:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function submitLeadToApi(formData: LeadSubmitData): Promise<void> {
  // Phase 4.UI.RESET.2 PART D1 — write to internal Lead table alongside Google Sheet.
  // Errors do NOT break form submit, but we now CHECK response.ok and log
  // payload + status so silent 400/429 failures surface in browser console.
  const eventId = `ltr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const childName = formData.childName?.trim() ?? "";
  // Server bắt `parentName` tối thiểu 2 ký tự (`lib/validators/lead.ts`). Form mới
  // để ô "Họ tên phụ huynh" KHÔNG bắt buộc ⇒ trống thì phải suy ra từ tên con,
  // nếu gửi rỗng sẽ dính 400 mà `submitLeadToApi` chỉ log rồi nuốt ⇒ lead bốc hơi
  // trong khi phụ huynh vẫn thấy màn "Đăng ký thành công".
  const parentName = formData.name?.trim() || (childName ? `PH của ${childName}` : "");
  const note = [
    formData.course ? `Khoá: ${formData.course}` : null,
    formData.center ? `Cơ sở: ${formData.center}` : null,
    formData.school ? `Trường: ${formData.school}` : null,
    formData.grade ? `Lớp: ${formData.grade}` : null,
    formData.province ? `Tỉnh/TP: ${formData.province}` : null,
  ]
    .filter(Boolean)
    .join(" | ")
    // `note` server giới hạn 500 ký tự — vượt là 400 và lead lại bốc hơi.
    .slice(0, 500);

  const payload = {
    parentName,
    childName: childName || undefined,
    timeOnPage: formData.timeOnPage,
    website: formData.website ?? "",
    // AUTH-SĐT P1 — chuẩn hoá TRƯỚC khi gửi: người dùng gõ "0905 123 456"
    // từng bị server trả 400 rồi client nuốt lỗi ⇒ lead bốc hơi không ai biết.
    phone: canonicalPhone(formData.phone) ?? formData.phone ?? "",
    email: formData.email || "",
    source: "laptrinhrobot-landing",
    eventId,
    landingPage:
      typeof window !== "undefined" ? window.location.href : undefined,
    referrer:
      typeof document !== "undefined" ? document.referrer || undefined : undefined,
    note: note || undefined,
    // Một lượt đồng ý (BLĐ 22/09/2026) — xem chú thích ở /lien-he.
    consentMarketing: formData.dongYChinhSachBaoMat,
    dongYChinhSachBaoMat: formData.dongYChinhSachBaoMat,
    // Nguồn khách giữ từ lúc vào site (?ref= affiliate + UTM + click-id) — landing
    // này cũng nhận link giới thiệu qua domain cũ laptrinhrobot.vn (proxy.ts).
    ...readAttribution(),
  };

  try {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[Lead API] HTTP ${res.status} ${res.statusText} — lead NOT saved to admin`,
        { payload, response: body.slice(0, 500) },
      );
      return;
    }

    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; leadId?: string }
      | null;
    if (!data?.ok) {
      console.warn("[Lead API] response.ok=false", data);
    }
  } catch (err) {
    console.error("[Lead API] network/exception (lead NOT saved):", err);
  }
}

export async function handleLeadSubmission(formData: LeadSubmitData) {
  // ⚠️ ĐÃ NGỪNG gửi sang Google Sheet (21/09/2026) — hồ sơ Bộ Công Thương.
  //
  // `submitLeadToSheet` đẩy 9 trường sang một Google Apps Script đóng cứng URL, trong đó
  // có **tên con, trường, lớp** của học sinh. Google Apps Script KHÔNG nằm trong danh
  // sách "tổ chức, cá nhân có thể được tiếp cận thông tin cá nhân" ở mục 6 của Chính
  // sách bảo mật sắp đăng ⇒ để nguyên là công bố một đằng, làm một nẻo.
  //
  // KHÔNG mất dữ liệu: `submitLeadToApi` ngay dưới vẫn ghi Lead vào DB nội bộ, và DB mới
  // là nguồn sự thật (bản Sheet còn nuốt số 0 đầu số điện thoại).
  //
  // Bật lại = bỏ comment dòng dưới, NHƯNG phải khai Google là bên thứ ba trong mục 6 của
  // `content/legal/chinh-sach-bao-mat.md` TRƯỚC.
  // const sheetResult = await submitLeadToSheet(formData);

  // Await Lead API so any 400/429/500 failures surface in console immediately
  // (still non-blocking via the surrounding try/catch — submit success not gated).
  await submitLeadToApi(formData);
  trackFacebookLead({ course: formData.course, center: formData.center });
  trackGA4Lead({ course: formData.course, center: formData.center });
  return { success: true } as const;
}

// AUTH-SĐT P1 — bản regex viết tay thứ 3 đã gỡ; dùng chung `lib/phone.ts`.
export function validateVietnamPhone(phone: string): boolean {
  return isValidPhoneVN(phone);
}

export function validateEmail(email: string): boolean {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
