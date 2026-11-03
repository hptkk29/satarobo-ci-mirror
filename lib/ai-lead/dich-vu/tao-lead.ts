// lib/ai-lead/dich-vu/tao-lead.ts — CẦU NỐI sang CRM: tạo lead chính thức từ một hồ sơ chờ (design §6). LÁT C.
//
// ═══ ĐIỀU TỆP NÀY KHÔNG ĐƯỢC LÀM ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
//  · KHÔNG `db.lead.create` — lead chính thức CHỈ tạo qua `ingestIntakeLead` (chia sale, chống trùng, quy nguồn, thông báo Sale đều nằm trong đó). Lưới `[ATL-W1]`.
//  · KHÔNG engine chia sale riêng, KHÔNG sửa lõi `lib/nguon`. Nguồn: `ctx.source = "messenger-ai"` KHÔNG nằm trong `DUONG_VAO_MAC_DINH` — đừng «cho tiện» đăng ký đường vào ở đây. Nguồn đi qua luật PAGE_MAPPING (Owner tạo nhóm «Marketing HO»
//    + gán Page ở module Nguồn). Chưa cấu hình ⇒ cổng 4b (`san-sang-nguon.ts`) chặn TRƯỚC khi ghi và đưa hồ sơ vào Ngoại lệ `NGUON_CHUA_CAU_HINH` — KHÔNG bao giờ để lead chính thức rơi UNKNOWN.
//  · KHÔNG đặt `createdByUserId`. Trường đó đi thẳng vào `Lead.createdById` VÀ vào `nguoiNhapUserId` của bộ quy nguồn — đặt người bấm «Duyệt» là biến QLCS thành «nhân sự giới thiệu»
//    (D12) và kéo hoa hồng giới thiệu về họ. Người duyệt được ghi ở AuditLog, không ở lead.
//  · KHÔNG `legacyWebhook`, KHÔNG `allowMissingPhone`: đây là đường MỚI, SĐT phải chuẩn hoá được.
//
// ═══ THỨ TỰ (luật rollback: cổng đứng TRƯỚC phép ghi đầu tiên) ═══════════════════════════════════════════════════════════════════════════════
//   1. tải hồ sơ → 2. cổng phạm vi (người bấm) → 3. idempotent nếu đã ra lead → 4. REVALIDATE (tên FB có nguồn · SĐT · cơ sở còn dùng được) → 5. `ingestIntakeLead`
//   → 6. đọc lại `Lead.assignedToId` → 7. ghi kết quả vào hồ sơ + audit TRONG MỘT transaction, có điều kiện `version` (khoá lạc quan).
//   Hai lượt gọi song song cùng `draftId`: chỉ MỘT lead (Lead.eventId unique ở ingest); lượt thua ở bước 7 đọc lại hồ sơ và trả cùng `leadId`.
//
// ═══ PII ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// `chiTiet` của kết quả và `resultNote` của hồ sơ CHỈ là mã (THIEU:fbName,phone) — không tên, không SĐT, không PSID, không mid, không nội dung ingest trả về.
import { type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { passesScope } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { getSetting } from "@/lib/settings/service";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { ingestIntakeLead, type IntakeContext } from "@/lib/lead/intake/ingest";
import type { MappedLead } from "@/lib/lead/intake/types";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";
import { consentChoIngest } from "../trang-thai";
import { docSanSangNguon } from "./san-sang-nguon";
import { docMaNhomNguonSauTao } from "@/lib/nguon/doc-nhom-sau-tao";
import { baoCauHinhNguonThieu } from "./thong-bao";
import { daRaLead, laKetThuc, sdtChuanHoa, thieuDieuKien, type ThieuDieuKien } from "./dieu-kien";

export type NguonKichHoatTaoLead = "AUTO" | "STAFF";

export type LyDoTaoLeadThatBai =
  | "THIEU_DIEU_KIEN"
  | "CO_SO_KHONG_HOP_LE"
  | "LOI_INGEST"
  | "NGUON_CHUA_CAU_HINH"
  | "DA_XU_LY"
  | "XUNG_DOT_PHIEN_BAN"
  | "KHONG_TIM_THAY"
  | "NGOAI_PHAM_VI"
  | "TU_DONG_TAT";

export type KetQuaTaoLead =
  | { ok: true; leadId: string | null; duplicate: boolean }
  | { ok: false; lyDo: LyDoTaoLeadThatBai; chiTiet?: string };

export type NguCanhTaoLead = {
  /** Người bấm duyệt (khi `tu = "STAFF"`). `AUTO` ⇒ hệ thống tự chạy, không có actor. */
  actor?: Actor;
  tu: NguonKichHoatTaoLead;
  /** Tên người bấm — chỉ để ghi AuditLog (Actor không mang tên). Thiếu ⇒ «Nhân viên». */
  tenNguoi?: string;
};

/** Khoá kênh vào `Lead.source`. Cố ý KHÔNG đăng ký ở `DUONG_VAO_MAC_DINH` (xem đầu tệp). */
export const NGUON_LEAD_AI = "messenger-ai";
export const TEN_HE_THONG_AI = "Hệ thống (AI Messenger)";
/** `Lead.eventId` — khoá idempotent: một hồ sơ ⇒ tối đa MỘT lead. */
export const eventIdCuaHoSo = (draftId: string): string => `ailead:${draftId}`;

const NHAN_Y_DINH: Record<string, string> = {
  CONSULTATION_REQUEST: "xin tư vấn",
  ENROLLMENT_REQUEST: "đăng ký học",
  TRIAL_CLASS_REQUEST: "học thử",
};

/** Lỗi nội bộ để THROW trong transaction (từ chối sau khi đã ghi = throw, không `return`). */
class XungDotPhienBan extends Error {
  constructor() {
    super("XUNG_DOT_PHIEN_BAN");
  }
}

/** `error` của ingest là câu tiếng Việt cho người nhập — chỉ cho lọt MÃ, không bao giờ nguyên văn (ingest có thể nhắc tên nhãn/giá trị). */
function maLoiIngest(error: string | undefined): string {
  if (!error) return "INGEST_TU_CHOI";
  if (/Số điện thoại/i.test(error)) return "INGEST_SDT";
  if (/tên phụ huynh/i.test(error)) return "INGEST_TEN";
  if (/Lỗi tạo lead/i.test(error)) return "INGEST_GHI";
  return "INGEST_TU_CHOI";
}

async function danhDauNgoaiLe(draftId: string, version: number, ma: string, orgUnitId: string | null): Promise<void> {
  // Không còn điều kiện nào để ghi ⇒ bỏ qua im lặng: hồ sơ đã sang trạng thái khác (do người/lượt khác) và trạng thái đó mới là sự thật.
  // Có đổi dòng thì GHI AUDIT cùng transaction — chuyển sang SYSTEM_EXCEPTION mà dòng thời gian không có dấu là trạng thái tự nhiên xuất hiện, khó truy.
  await db
    .$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      const r = await tx.aiLeadDraft.updateMany({
        where: { id: draftId, version, state: { notIn: ["COMPLETED", "ASSIGNMENT_PENDING", "REJECTED", "EXPIRED"] } },
        data: { state: "SYSTEM_EXCEPTION", resultNote: ma.slice(0, 200), version: { increment: 1 } },
      });
      if (r.count === 0) return; // đổi 0 dòng ⇒ không có gì để ghi nhật ký (ngoại lệ hợp lệ của luật rollback)
      await writeAudit({
        tx,
        actor: { id: null, name: TEN_HE_THONG_AI },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: draftId,
        action: "SYSTEM_EXCEPTION",
        newValues: { state: "SYSTEM_EXCEPTION", ma },
        orgUnitId,
      });
    })
    .catch(() => undefined);
}

export async function taoLeadTuHoSo(draftId: string, ctx: NguCanhTaoLead): Promise<KetQuaTaoLead> {
  // ── 0. TỰ ĐỘNG chỉ khi chủ dự án bật (`ai.autoCreateEnabled`, mặc định TẮT) — FAIL-CLOSED: không đọc được cài đặt ⇒ coi như TẮT.
  // Đây là ĐƯỜNG DUY NHẤT tạo lead từ hồ sơ, nên cổng đặt Ở ĐÂY chứ không phó mặc cho từng chỗ gọi nhớ kiểm (một chỗ quên = lead tự tạo ngoài ý chủ dự án).
  // Đứng TRƯỚC mọi đọc/ghi DB. Người bấm «Duyệt» (STAFF) không phụ thuộc cờ này.
  if (ctx.tu === "AUTO") {
    const bat = await getSetting("ai.autoCreateEnabled").then((v) => v === true, () => false);
    if (!bat) return { ok: false, lyDo: "TU_DONG_TAT" };
  }

  // ── 1. tải hồ sơ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const hs = await db.aiLeadDraft.findUnique({
    where: { id: draftId },
    include: { conversation: { select: { pageId: true } } },
  });
  if (!hs) return { ok: false, lyDo: "KHONG_TIM_THAY" };

  // ── 2. cổng phạm vi — `scopedDb` KHÔNG che ghi, nên người bấm phải qua `passesScope` ở ĐÂY (không chỉ ở tầng gọi). STAFF không kèm actor ⇒ từ chối (fail-closed).
  if (ctx.tu === "STAFF") {
    if (!ctx.actor || !passesScope("AiLeadDraft", hs, ctx.actor)) return { ok: false, lyDo: "NGOAI_PHAM_VI" };
  }

  // ── 3. idempotent ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (daRaLead(hs.state)) return { ok: true, leadId: hs.leadId, duplicate: true };
  if (laKetThuc(hs.state)) return { ok: false, lyDo: "DA_XU_LY", chiTiet: hs.state };

  // ── 4. REVALIDATE LÚC GHI — dữ liệu đã đọc có thể cũ (Page bị tạm dừng, cơ sở ngừng nhận khách, Agent ghi đè tên…) ────────────────────────
  const thieu = thieuDieuKien(hs);
  if (thieu.length > 0) return { ok: false, lyDo: "THIEU_DIEU_KIEN", chiTiet: `THIEU:${thieu.join(",")}` };
  const phone = sdtChuanHoa(hs);
  const fbName = hs.fbName?.trim();
  const campusCenterId = hs.campusCenterId;
  if (!phone || !fbName || !campusCenterId) return { ok: false, lyDo: "THIEU_DIEU_KIEN", chiTiet: "THIEU:du-lieu" };

  const loiCoSo = await kiemCoSo(hs.conversation.pageId, campusCenterId, hs.campusCode);
  if (loiCoSo) return { ok: false, lyDo: "CO_SO_KHONG_HOP_LE", chiTiet: loiCoSo };

  // ── 4b. NGUỒN phải được cấu hình TRƯỚC khi tạo lead chính thức (chỉ đọc, trước mọi phép ghi): không âm thầm rơi UNKNOWN / không-nguồn. Chưa sẵn sàng ⇒ hồ sơ vào Ngoại lệ, KHÔNG mất khách.
  const nguon = await docSanSangNguon({ pageId: hs.conversation.pageId, centerId: campusCenterId, now: new Date() });
  if (!nguon.san) {
    const ma = "NGUON_CHUA_CAU_HINH";
    await danhDauNgoaiLe(hs.id, hs.version, ma, hs.orgUnitId);
    await baoCauHinhNguonThieu({ pageId: hs.conversation.pageId, ma: nguon.ma, now: new Date() });
    return { ok: false, lyDo: "NGUON_CHUA_CAU_HINH", chiTiet: `${ma}:${nguon.ma}` };
  }

  // ── 5. đổ sang CRM — ĐƯỜNG GHI DUY NHẤT ──────────────────────────────────────────────────────────────────────────────────────────────────
  const eventId = eventIdCuaHoSo(hs.id);
  const mapped: MappedLead = {
    // «tên phụ huynh» của lead = TÊN FACEBOOK (lời khai của Agent, hoặc đã nhân viên xác minh). Không phải tên thật cho tới khi Sale hỏi lại.
    parentName: fbName.slice(0, 200),
    phone,
    // Cố ý KHÔNG dựng `facebookUrl` từ psid: psid không phải URL hồ sơ, và đoán URL là bịa liên kết tới một người lạ.
    facebookUrl: null,
    centerHint: null,
    children: [],
    // Ghi chú KHÔNG chứa mid, psid, nội dung hội thoại, SĐT. Chỉ đủ để Sale biết nguồn và tra ngược hồ sơ.
    noteLines: [
      "Nguồn: AI Messenger",
      `Mã hồ sơ AI: ${hs.id.slice(-8)}`,
      `Khách muốn: ${NHAN_Y_DINH[hs.intent] ?? "liên hệ"}`,
    ],
    externalId: null,
    // `true` CHỈ khi khách đồng ý liên hệ VÀ có mid làm bằng chứng (OD-08). Không suy từ «khách chủ động nhắn».
    consentMarketing: consentChoIngest({ consent: { contactAllowed: hs.consentAllowed, messageMid: hs.consentMid ?? undefined } }),
    warnings: [],
  };
  const ctxIngest: IntakeContext = {
    source: NGUON_LEAD_AI,
    eventId,
    actorName: TEN_HE_THONG_AI,
    centerId: campusCenterId,
    // Chỉ `pageId` — KHÔNG bịa tín hiệu quảng cáo/UTM/ref. Nguồn do cấu hình Page quyết (luật PAGE_MAPPING); cổng 4b đã đảm bảo Page có cấu hình, nếu không hồ sơ không tới đây.
    tinHieuNguon: { ...KHONG_CO_TIN_HIEU_NGUON, pageId: hs.conversation.pageId },
    // STAFF = có người duyệt, chịu trách nhiệm: SĐT trùng lead đang mở thì gộp như nhập tay (không chỉ để lại dấu vết).
    // AUTO = KHÔNG ai xem trước, mà SĐT do một người dùng Facebook bất kỳ gõ vào: chỉ được ghi dấu vết khi trùng (có trần 5/24h) — không gộp,
    // không nhảy đồng hồ lead của người khác. Cùng khuôn với đường ẩn danh của Affiliate.
    chiGhiDauVetKhiTrung: ctx.tu === "AUTO",
  };

  let kq: Awaited<ReturnType<typeof ingestIntakeLead>>;
  try {
    kq = await ingestIntakeLead(mapped, ctxIngest);
  } catch {
    // KHÔNG log `err` trần (lỗi Prisma có thể kèm giá trị cột = PII). Mã thôi.
    await danhDauNgoaiLe(hs.id, hs.version, "INGEST_NEM_LOI", hs.orgUnitId);
    return { ok: false, lyDo: "LOI_INGEST", chiTiet: "INGEST_NEM_LOI" };
  }
  if (!kq.ok) {
    const ma = maLoiIngest(kq.error);
    await danhDauNgoaiLe(hs.id, hs.version, ma, hs.orgUnitId);
    return { ok: false, lyDo: "LOI_INGEST", chiTiet: ma };
  }

  // Đua `eventId` ở ingest trả `{ ok, duplicate }` KHÔNG kèm `leadId` — tra lại bằng chính khoá idempotent.
  const leadId = kq.leadId ?? (await db.lead.findUnique({ where: { eventId }, select: { id: true } }))?.id ?? null;
  if (!leadId) {
    await danhDauNgoaiLe(hs.id, hs.version, "INGEST_KHONG_CO_LEAD", hs.orgUnitId);
    return { ok: false, lyDo: "LOI_INGEST", chiTiet: "INGEST_KHONG_CO_LEAD" };
  }

  // ── 5b. NGUỒN SAU KHI TẠO (review độc lập 28/10): cổng 4b chạy thử bằng pageId, KHÔNG có SĐT — còn ingest thật có SĐT nên luật `KE_THUA_SDT` có thể kế thừa nguồn của lead cũ (kể cả UNKNOWN),
  // và `chuanBiQuyNguon` nuốt lỗi. Lead MỚI đã nằm trong CRM nên không thu hồi được; thay vào đó đánh dấu hồ sơ + audit để người phụ trách thấy «nguồn cần xem lại» — KHÔNG im lặng.
  // Lead trùng (gắn vào lead có sẵn) giữ nguồn của lead đó, không phán xét ở đây.
  let canXemNguon: string | null = null;
  if (kq.duplicate !== true) {
    const at = await docMaNhomNguonSauTao(leadId).catch(() => undefined);
    if (at && !at.coDong) canXemNguon = "NGUON_KHONG_GHI_SAU_TAO";
    else if (at && at.maNhom === "UNKNOWN") canXemNguon = "NGUON_UNKNOWN_SAU_TAO";
  }

  // ── 6. lead đã có chủ chưa? Chưa ⇒ hồ sơ ở ASSIGNMENT_PENDING (hàng chờ nhân viên — màn «Chưa phân công» có sẵn). Hồ sơ vẫn «mở» ở chỉ mục từng phần. ─────────
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true } });
  const trangThaiMoi = lead?.assignedToId ? ("COMPLETED" as const) : ("ASSIGNMENT_PENDING" as const);

  // ── 7. ghi kết quả — transaction, có điều kiện `version` ───────────────────────────────────────────────────────────────────────────────────
  const luc = new Date();
  const ghi = async (version: number): Promise<boolean> => {
    try {
      await db.$transaction(async (txRaw) => {
        const tx = txRaw as unknown as Prisma.TransactionClient;
        const r = await tx.aiLeadDraft.updateMany({
          where: { id: hs.id, version, state: { notIn: ["COMPLETED", "ASSIGNMENT_PENDING", "REJECTED", "EXPIRED"] } },
          data: {
            state: trangThaiMoi,
            leadId,
            version: { increment: 1 },
            resultNote: kq.duplicate ? "GAN_VAO_LEAD_CO_SAN" : canXemNguon,
            closedAt: trangThaiMoi === "COMPLETED" ? luc : null,
          },
        });
        if (r.count === 0) throw new XungDotPhienBan(); // thua đua: THROW để audit KHÔNG bị ghi lẻ
        await writeAudit({
          tx,
          actor: { id: ctx.tu === "STAFF" ? (ctx.actor?.userId ?? null) : null, name: ctx.tu === "STAFF" ? (ctx.tenNguoi ?? "Nhân viên") : TEN_HE_THONG_AI },
          module: "ai-lead",
          entityType: "AiLeadDraft",
          entityId: hs.id,
          action: "CREATE_LEAD",
          oldValues: { state: hs.state, leadId: hs.leadId },
          newValues: { state: trangThaiMoi, leadId, duplicate: kq.duplicate === true, tu: ctx.tu, ...(canXemNguon ? { canXemNguon } : {}) },
          orgUnitId: hs.orgUnitId,
        });
      });
      return true;
    } catch (e) {
      if (e instanceof XungDotPhienBan) return false;
      throw e;
    }
  };

  if (await ghi(hs.version)) return { ok: true, leadId, duplicate: kq.duplicate === true };

  // Thua đua. Đọc lại: (a) lượt khác đã ghi xong ⇒ idempotent; (b) chỉ lệch `version` (người vừa bổ sung trong lúc ingest chạy) mà lead ĐÃ tạo ⇒ ghi kết quả với version mới;
  // (c) hồ sơ bị từ chối/hết hạn giữa chừng ⇒ lead đã tồn tại mà hồ sơ đóng — KHÔNG nuốt, báo xung đột kèm id lead (không PII) để người xử lý đối chiếu.
  const lai = await db.aiLeadDraft.findUnique({ where: { id: hs.id }, select: { state: true, leadId: true, version: true } });
  if (!lai) return { ok: false, lyDo: "KHONG_TIM_THAY" };
  if (daRaLead(lai.state)) return { ok: true, leadId: lai.leadId ?? leadId, duplicate: true };
  if (!laKetThuc(lai.state) && (await ghi(lai.version))) return { ok: true, leadId, duplicate: kq.duplicate === true };
  return { ok: false, lyDo: "XUNG_DOT_PHIEN_BAN", chiTiet: `LEAD_DA_TAO:${leadId}` };
}

/**
 * Cơ sở còn dùng được không — trả MÃ lỗi hoặc `null`. Ba lớp, đều đọc SỐNG lúc ghi:
 *   · `Center.isActive` và KHÔNG nằm trong `getNonEnrollableCenterIds()` (Hội sở…): lead không bao giờ về cơ sở không nhận ghi danh (chủ dự án chốt 04/08);
 *   · `AiLeadCampusPublication` của ĐÚNG Page: còn xuất bản (`publicVisible`) VÀ còn nhận khách (`acceptingLeads`) — tắt «nhận khách» có hiệu lực NGAY, không đợi xuất bản lại catalog;
 *   · bản catalog xuất bản mới nhất: nếu nó ghi rõ cơ sở này `acceptingLeads=false` thì chặn. Cơ sở có trong cấu hình mà CHƯA có trong bản xuất bản thì KHÔNG chặn
 *     (nhân viên chọn thay khách một cơ sở vừa thêm là việc hợp lệ; ánh xạ campusCode↔Center thuộc lát Catalog nên ở đây chỉ so khi hồ sơ có `campusCode`).
 */
async function kiemCoSo(pageId: string, centerId: string, campusCode: string | null): Promise<string | null> {
  const [center, khongNhan, xuatBan, banMoi] = await Promise.all([
    db.center.findUnique({ where: { id: centerId }, select: { isActive: true } }),
    getNonEnrollableCenterIds(),
    db.aiLeadCampusPublication.findUnique({
      where: { pageId_campusCenterId: { pageId, campusCenterId: centerId } },
      select: { acceptingLeads: true, publicVisible: true },
    }),
    db.aiLeadCatalogSnapshot.findFirst({ orderBy: { version: "desc" }, select: { payload: true } }),
  ]);
  if (!center || !center.isActive) return "CO_SO_NGUNG_HOAT_DONG";
  if (khongNhan.includes(centerId)) return "CO_SO_KHONG_NHAN_GHI_DANH";
  if (!xuatBan || !xuatBan.publicVisible) return "CO_SO_CHUA_XUAT_BAN_CHO_PAGE";
  if (!xuatBan.acceptingLeads) return "CO_SO_NGUNG_NHAN_KHACH";
  if (campusCode && banMoi && catalogGhiNgungNhan(banMoi.payload, pageId, campusCode)) return "CATALOG_NGUNG_NHAN_KHACH";
  return null;
}

/** THUẦN. `payload = { pages:[{ pageId, campuses:[{ campusCode, acceptingLeads }] }] }` — hình dạng lạ ⇒ coi như KHÔNG nói gì (không chặn nhầm). */
export function catalogGhiNgungNhan(payload: unknown, pageId: string, campusCode: string): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const pages = (payload as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return false;
  for (const p of pages) {
    if (typeof p !== "object" || p === null || (p as { pageId?: unknown }).pageId !== pageId) continue;
    const campuses = (p as { campuses?: unknown }).campuses;
    if (!Array.isArray(campuses)) return false;
    for (const c of campuses) {
      if (typeof c !== "object" || c === null) continue;
      if ((c as { campusCode?: unknown }).campusCode === campusCode) return (c as { acceptingLeads?: unknown }).acceptingLeads === false;
    }
  }
  return false;
}

export type { ThieuDieuKien };
