/**
 * CRM cho DISC — hiện thực `CongCrm` (kiểu ở luu.ts) bằng cách DÙNG LẠI lõi lead/nguồn/affiliate,
 * không dựng luật thứ hai. Tệp này là phần THUẦN (quyết định) theo cổng `CrmPorts`; nối DB thật ở
 * `crm-that.ts`. Chi tiết + sơ đồ: docs/disc-tich-hop/07-crm-affiliate.md.
 *
 * Luật (mỗi luật có ca test [DISC-CRM-*]):
 *  1. Một lần lưu = tối đa MỘT lead: `Lead.eventId = disc:<submissionId>` (UNIQUE) + tra trước.
 *  2. SĐT đã có lead (còn mở / trong cửa sổ chống trùng) ⇒ KHÔNG tạo lead, KHÔNG đổi nguồn: chỉ ghi
 *     touchpoint/dấu vết DISC lên lead cũ (một lead một nguồn).
 *  3. Nguồn: LÚC LƯU không đọc cookie giới thiệu, không ghi referral (N4/M-2): người gõ SĐT ≠ chủ SĐT, nên để lõi
 *     quy nguồn quyết định theo cấu hình động (đường vào `web` không tín hiệu ⇒ nguồn "KH tự đến" theo cấu hình
 *     hiện hành). KHÔNG so mã nguồn cứng ở đây. Referral CHỈ được ghi SAU KHI chủ số qua OTP + mã nhận
 *     (`taoGhiReferralSauNhan`), bằng cookie `sr_aff` của CHÍNH trình duyệt chủ số, tra lại ở DB; không nhận
 *     sourceId/commissionRate/ownerId từ client. EMAIL chưa xác minh cũng KHÔNG vào lead lúc lưu (xem `gatEmailDaXacMinhChoLead`).
 *  4. DISC là CHIẾN DỊCH/điểm chạm, không phải nguồn mới, không kích hoạt hoa hồng.
 *  5. ĐỒNG Ý TIẾP THỊ (F-09): ô tích do NGƯỜI GÕ SĐT quyết, không phải CHỦ SĐT ⇒ lúc tạo lead
 *     `consentMarketing` LUÔN false. Chỉ khi chủ số đã qua OTP và nhận bài (`taoXacNhanTiepThi`, gọi từ
 *     luồng nhận) thì mới bật — và chỉ khi bài đã ghi nhận ô tích đó.
 *  6. TUYỆT ĐỐI không đưa điểm · câu trả lời · năm sinh · TÊN CON vào lead/ghi chú/touchpoint (F-13):
 *     kiểu `LeadMoiDisc` chỉ có các trường liên hệ của người lớn; lưới [DISC-CRM-05] ghim danh sách trường.
 *  7. SĐT vào lead là SĐT CHUẨN HOÁ thô (`84…`). Nếu đầu vào không phải SĐT hợp lệ (vd lỡ truyền
 *     khoá HMAC `phoneKey` của bảng Disc* vào chỗ `soDienThoai`) ⇒ KHÔNG tạo lead (fail-closed), để không bao giờ ghi một chuỗi băm
 *     vào `Lead.phone`.
 */
import { PHONE_VN_RE } from "@/lib/phone";
import type { CongCrm } from "./luu";

/** Mọi trường được phép đi vào lead. Thêm trường = phải sửa lưới [DISC-CRM-05] có chủ đích. */
export type LeadMoiDisc = {
  parentName: string;
  phone: string;
  /** Luôn null lúc tạo: email do người gõ khai, chưa xác minh (N4). Vào lead sau khi bài CLAIMED ∧ email đã xác minh. */
  email: null;
  consentMarketing: false;
  landingPage: "/disc";
  source: "web";
  note: string;
  /** Địa chỉ nơi ở của PHỤ HUYNH (05/11/2026, để chia lead về cơ sở gần nhà): tên thành phố/phường đúng danh mục. null = không khai. */
  city: string | null;
  ward: string | null;
  addressLine: string | null;
  /** Mã cơ sở khách TỰ chọn («CS1»/«CS2»); adapter đổi sang Center.id nếu cơ sở còn nhận lead, không thì bỏ qua. */
  coSoMongMuon: string | null;
};

export type CrmPorts<C> = {
  timLeadTheoEventId: (eventId: string) => Promise<{ id: string } | null>;
  timLeadTrung: (phone: string) => Promise<{ id: string } | null>;
  /** Gom tín hiệu nguồn cho lõi quy nguồn. KHÔNG có cookie giới thiệu / email: lúc lưu chưa có gì xác thực chủ số (N4). */
  chuanBi: (p: { phone: string; eventId: string }) => Promise<C>;
  taoLeadMoi: (p: { eventId: string; data: LeadMoiDisc; chuanBi: C }) => Promise<{ leadId: string; centerId: string | null }>;
  /** Lead đã có: touchpoint + dấu vết, có trần. KHÔNG đổi nguồn, KHÔNG ghi referral. */
  ghiLeadTrung: (p: { leadId: string; chuanBi: C; nhan: string }) => Promise<void>;
  /** Sau commit: chia lead. Lỗi nuốt (không được làm mất khách). */
  hoanTatLeadMoi: (p: { leadId: string; centerId: string | null; chuanBi: C }) => Promise<void>;
  datLeadChoBai: (submissionId: string, leadId: string) => Promise<void>;
};

const CHIEN_DICH_HOP_LE = /^[A-Za-z0-9_-]{1,40}$/;

export function tenChienDichAnToan(raw: string): string {
  return CHIEN_DICH_HOP_LE.test(raw) ? raw : "DISC";
}

/**
 * Chỉ nhận các trường LIÊN HỆ của người lớn. `tenCon` / `tiepThi` còn nằm trong kiểu `CongCrm` (luu.ts) nhưng
 * CỐ Ý không được đọc ở đây — xem luật 5 và 6.
 */
export function dungLeadMoiDisc(d: Parameters<CongCrm>[0]): LeadMoiDisc {
  return {
    parentName: d.tenPhuHuynh.trim().slice(0, 120),
    phone: d.soDienThoai,
    email: null, // N4: chưa xác minh ⇒ không vào lead lúc lưu
    consentMarketing: false,
    landingPage: "/disc",
    source: "web",
    note: `Làm bài DISC (chiến dịch ${tenChienDichAnToan(d.chienDich)}).`,
    city: d.diaChi?.thanhPho ?? null,
    ward: d.diaChi?.phuong ?? null,
    addressLine: d.diaChi?.soNha ?? null,
    coSoMongMuon: d.diaChi?.coSoGanNha ?? null,
  };
}

/** Giá trị cookie `sr_aff` = `<token>.<epochMs>` (xem lib/affiliate/theo-doi-cong-khai.ts). Lấy phần token; lạ ⇒ null. */
export function tachTokenTuCookie(v: string | null | undefined): string | null {
  if (!v) return null;
  const i = v.lastIndexOf(".");
  const token = i > 0 ? v.slice(0, i) : v;
  return token.length > 0 && token.length <= 128 ? token : null;
}

export const eventIdCuaBai = (submissionId: string) => `disc:${submissionId}`;

/**
 * Mã lỗi AN TOÀN để ghi log: chỉ `code` dạng mã (P2002…) hoặc `name` của lỗi, KHÔNG BAO GIỜ `message`/đối tượng lỗi
 * (lỗi Prisma/Postgres hay kèm giá trị cột — số điện thoại, email — trong thông điệp).
 */
export function maLoiAnToan(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; name?: unknown };
    if (typeof o.code === "string" && /^[A-Za-z0-9_]{1,24}$/.test(o.code)) return o.code;
    if (typeof o.name === "string" && /^[A-Za-z]{1,40}$/.test(o.name)) return o.name;
  }
  return "UNKNOWN";
}

export function taoCongCrm<C>(ports: CrmPorts<C>): CongCrm {
  return async (d) => {
    // Luật 7: chỉ SĐT chuẩn hoá thô mới được vào lead.
    if (typeof d.soDienThoai !== "string" || !PHONE_VN_RE.test(d.soDienThoai)) return { leadId: null };

    const eventId = eventIdCuaBai(d.submissionId);

    // 1. Gọi lặp cho cùng một bài ⇒ cùng lead, không ghi thêm.
    const daCo = await ports.timLeadTheoEventId(eventId);
    if (daCo) {
      await ports.datLeadChoBai(d.submissionId, daCo.id);
      return { leadId: daCo.id };
    }

    const data = dungLeadMoiDisc(d);
    const chuanBi = await ports.chuanBi({ phone: data.phone, eventId });

    // 2. Trùng SĐT ⇒ chỉ ghi dấu vết lên lead cũ.
    const trung = await ports.timLeadTrung(data.phone);
    if (trung) {
      await ports.ghiLeadTrung({ leadId: trung.id, chuanBi, nhan: "disc" });
      await ports.datLeadChoBai(d.submissionId, trung.id);
      return { leadId: trung.id };
    }

    const { leadId, centerId } = await ports.taoLeadMoi({ eventId, data, chuanBi });
    await ports.datLeadChoBai(d.submissionId, leadId);
    await ports.hoanTatLeadMoi({ leadId, centerId, chuanBi }).catch(() => {});
    return { leadId };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Đồng ý tiếp thị CHỈ có hiệu lực sau khi chủ số xác thực (F-09)
// ─────────────────────────────────────────────────────────────────────────────

export type TiepThiPorts = {
  /** Đọc đồng ý tiếp thị đã ghi trên bài + lead đã gắn (null = không có bài). */
  docBai: (submissionId: string) => Promise<{ consentMarketing: boolean; leadId: string | null } | null>;
  /**
   * Bật đồng ý tiếp thị trên lead — điều kiện NẰM TRONG phép ghi: lead phải đúng SĐT chủ số vừa xác thực
   * và đang chưa bật. `chiLeadCuaBai` có ⇒ phép ghi CÒN ràng `Lead.eventId = chiLeadCuaBai` (lead do CHÍNH bài này tạo,
   * không phải lead có sẵn). true = lượt này đã bật.
   */
  datTiepThiChoLead: (leadId: string, sdtChuan: string, rangBuoc: { chiLeadCuaBai?: string }) => Promise<boolean>;
};

export type XacNhanTiepThi = (p: { submissionId: string; sdtChuan: string; chuSoDongY?: boolean }) => Promise<"DA_BAT" | "KHONG_DOI">;

/**
 * Gọi SAU KHI luồng nhận đã xác minh OTP của `sdtChuan` và gắn bài thành công. Không bao giờ ném (lỗi ⇒ "KHONG_DOI":
 * thà thiếu đồng ý còn hơn bật nhầm). Hai nguồn đồng ý, KHÁC NHAU về hiệu lực (N7):
 *  · `chuSoDongY === true` — chủ số TỰ tích ô riêng ở form nhận (sau OTP) ⇒ đồng ý mới của chính họ: bật trên lead
 *    có SĐT của họ (kể cả lead có sẵn đang false).
 *  · ô tích của NGƯỜI GÕ lúc lưu (`bai.consentMarketing`) ⇒ chỉ bật trên lead do CHÍNH bài này tạo (`eventId`),
 *    KHÔNG BAO GIỜ lật lead có sẵn — `false` ở lead cũ có thể là "đã từ chối".
 */
export function taoXacNhanTiepThi(ports: TiepThiPorts): XacNhanTiepThi {
  return async ({ submissionId, sdtChuan, chuSoDongY }) => {
    if (!PHONE_VN_RE.test(sdtChuan)) return "KHONG_DOI";
    try {
      const bai = await ports.docBai(submissionId);
      if (!bai || !bai.leadId) return "KHONG_DOI";
      if (chuSoDongY === true) return (await ports.datTiepThiChoLead(bai.leadId, sdtChuan, {})) ? "DA_BAT" : "KHONG_DOI";
      if (bai.consentMarketing !== true) return "KHONG_DOI";
      return (await ports.datTiepThiChoLead(bai.leadId, sdtChuan, { chiLeadCuaBai: eventIdCuaBai(submissionId) })) ? "DA_BAT" : "KHONG_DOI";
    } catch {
      return "KHONG_DOI";
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Referral/affiliate CHỈ ghi sau khi chủ số xác thực (N4/M-2)
// ─────────────────────────────────────────────────────────────────────────────

export type ReferralSauNhanPorts<G> = {
  /** Cookie giới thiệu `sr_aff` của request nhận (= trình duyệt CỦA CHỦ SỐ). null nếu không có / cờ Affiliate tắt. */
  docRefCookie: () => Promise<string | null>;
  /** Lead của bài + việc lead đó do chính bài này tạo hay có sẵn. */
  docLeadCuaBai: (submissionId: string) => Promise<{ leadId: string; centerId: string | null; doBaiTao: boolean } | null>;
  /** Tra token ở DB (không tin client). SĐT = SĐT chủ số đã qua OTP; email KHÔNG truyền (chưa xác minh). null = token không dùng được. */
  chuanBi: (p: { token: string; phone: string; eventId: string }) => Promise<G | null>;
  ghiChoLeadMoi: (p: { ghi: G; leadId: string; centerId: string | null }) => Promise<void>;
  ghiChoLeadCu: (p: { ghi: G; leadId: string }) => Promise<void>;
};

export type GhiReferralSauNhan = (p: { submissionId: string; sdtChuan: string }) => Promise<"DA_GHI" | "KHONG_DOI">;

/**
 * Gọi SAU KHI chủ số đã qua OTP + mã nhận. Lúc LƯU không có referral nào được ghi, nên một affiliate không thể gắn
 * lead/referral cho SĐT của người lạ chỉ bằng cách lưu bài. Cookie đọc ở đây là của người ĐANG NHẬN. Không bao giờ ném.
 * Quyết định referral (VALID / MANUAL_REVIEW / REJECTED…) vẫn do lõi `chuanBiReferral` — đường DISC không có tín hiệu
 * Origin/clickId nên luôn ra XEM_TAY (không tự ghi công): giữ có chủ đích (ISSUE-1).
 */
export function taoGhiReferralSauNhan<G>(ports: ReferralSauNhanPorts<G>): GhiReferralSauNhan {
  return async ({ submissionId, sdtChuan }) => {
    if (!PHONE_VN_RE.test(sdtChuan)) return "KHONG_DOI";
    try {
      const token = tachTokenTuCookie(await ports.docRefCookie());
      if (!token) return "KHONG_DOI";
      const lead = await ports.docLeadCuaBai(submissionId);
      if (!lead) return "KHONG_DOI";
      const ghi = await ports.chuanBi({ token, phone: sdtChuan, eventId: eventIdCuaBai(submissionId) });
      if (!ghi) return "KHONG_DOI";
      if (lead.doBaiTao) await ports.ghiChoLeadMoi({ ghi, leadId: lead.leadId, centerId: lead.centerId });
      else await ports.ghiChoLeadCu({ ghi, leadId: lead.leadId });
      return "DA_GHI";
    } catch {
      return "KHONG_DOI";
    }
  };
}
