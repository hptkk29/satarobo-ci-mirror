import "server-only";
// lib/ai-lead/dich-vu/intake.ts — POST /lead-intakes: GHI MÙ một lần ghi nhận nhu cầu tư vấn (Agent chỉ ghi, không đọc lại).
//
// ═══ N1 (TRUNG TÍNH) — ĐIỀU QUAN TRỌNG NHẤT CỦA TỆP NÀY ═════════════════════════════════════════════════════════════════════
// Phản hồi được quyết ĐỊNH DUY NHẤT bởi `quyetDinhLeadIntake` (trang-thai.ts) từ: dữ liệu Agent vừa gửi + hồ sơ đang mở của CHÍNH hội thoại này + catalog hiện hành của Page +
// `ownerState`. Đường phản hồi (mọi câu lệnh trước khi trả lời) KHÔNG đọc bảng CRM nào: không Lead, không Contact, không Student, không Order, không `lib/nguon`.
// Việc nào cần CRM (tự tạo lead) chạy SAU khi đã trả lời, qua `deps.lenLichNen` (nen.ts) — để cả THỜI GIAN trả lời cũng không lộ "khách đã có trong CRM".
// Lưới `[AIL-N1-*]` (tests/ai-lead + app/api/ai-lead-agent) chặn mọi truy cập mô hình CRM trên đường này.
//
// ═══ TUẦN TỰ HOÁ ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Giao dịch: (1) giữ khoá idempotency; (2) KHOÁ HÀNG hội thoại; (3) đọc hồ sơ mở; (4) gộp + ghi. Bước 2 làm 20 yêu cầu song song khác key trên cùng hội thoại xếp hàng ⇒ đúng 1 hồ sơ mở.
// Cập nhật hồ sơ có điều kiện `version` (nhân viên ở lát C có thể đang sửa cùng hồ sơ không qua khoá hội thoại): trượt ⇒ chạy lại cả giao dịch.
//
// ═══ GỘP DỮ LIỆU ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// Hồ sơ gộp theo (hội thoại, intent). Ứng viên dùng để QUYẾT ĐỊNH = dữ liệu Agent vừa gửi CHỒNG LÊN những gì hồ sơ đã biết (khách đưa SĐT lượt trước, cơ sở lượt này ⇒ cả hai).
// `evidence` được MERGE (không thay cả đối tượng): khoá `staff` là dấu xác minh của nhân viên (dieu-kien.ts) — mất nó là mất công việc người.
// Dữ liệu khách VẪN được lưu khi `ownerState ≠ AI_ACTIVE`; chỉ PHẢN HỒI bị khoá thành HUMAN_QUEUED (quyết định mới 27/10).
import { db } from "@/lib/db";
import { canonicalPhone } from "@/lib/phone";
import { taoReceiptId } from "../phan-hoi";
import { quyetDinhLeadIntake } from "../trang-thai";
import { taoLeadTuHoSo } from "./tao-lead";
import type { KetQuaXuLy, NguCanhYeuCau } from "../xac-thuc";
import { layCatalogMoiNhat } from "./catalog";
import { thieuDieuKien } from "./dieu-kien";
import { capNhatHoiThoai, khoaHoiThoai } from "./hoi-thoai";
import { bamNoiDung, ChayLaiGiaoDich, dungThanOk, ghiPhanHoiTrongTx, giaoDichCoThuLai, giuKhoaTrongTx } from "./idempotency";
import type { LenLichNen } from "./nen";
import { hanSlaTheoQuyTac, thuHepTuTao, timQuyTacAuto } from "./bo-quy-tac";
import { docTrangThaiBoQuyTac, type BanGhiBoQuyTac } from "./bo-quy-tac-db";
import { choPhepTuTaoLead } from "./quy-tac-page";
import { baoHoSoCanXuLy } from "./thong-bao";
import { canNguoiXuLy, coTheTinhLai, danhSachThieu, TRANG_THAI_DONG, tinhHanSla, tinhTrangThaiThuThap } from "./tinh-ho-so";
import { maLoiNoiBo } from "../loi-he-thong";

export type HauKyIntake = {
  draftId: string;
  centerId: string | null;
  trangThai: string;
  /** Hồ sơ vừa VÀO trạng thái cần người (hoặc vừa tạo ở đó) ⇒ báo QLCS. */
  canBao: boolean;
  /** Dữ kiện để quy tắc THU HẸP tự tạo lead (Rule Builder). Vắng (hồ sơ của nhân viên) ⇒ không bao giờ tự tạo. */
  thuHep?: { consentAllowed: boolean; campusCenterId: string | null };
};

/**
 * Bộ quy tắc hiện hành — MỘT truy vấn/lượt. Lỗi đọc / payload hỏng ⇒ `ban: null, hong: true`: SLA rơi về tham số `ai.*` (quy tắc không bao giờ làm hỏng phản hồi của Agent) NHƯNG tự tạo lead
 * đi đường an toàn (hồ sơ chờ nhân viên) vì không biết ràng buộc thu hẹp có hay không — thu hẹp KHÔNG ĐƯỢC fail-open.
 */
async function docBoQuyTacAnToan(): Promise<{ ban: BanGhiBoQuyTac | null; hong: boolean }> {
  try {
    return await docTrangThaiBoQuyTac();
  } catch (err) {
    console.error(`[ai-lead:intake] doc bo quy tac loi=${maLoiNoiBo(err)}`);
    return { ban: null, hong: true };
  }
}

/** Mã cơ sở (catalog) → Center.id, CHỈ qua xuất bản của đúng Page này — không tra `Center.code` trần (cơ sở chưa xuất bản cho Page này không được lọt vào). */
async function bangMaCoSoCuaPage(pageId: string): Promise<Map<string, string>> {
  const pubs = await db.aiLeadCampusPublication.findMany({ where: { pageId }, select: { campusCenterId: true, campus: { select: { code: true } } } });
  const m = new Map<string, string>();
  for (const p of pubs) if (p.campus.code) m.set(p.campus.code, p.campusCenterId);
  return m;
}

async function bangOrgUnit(centerIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(centerIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const dong = await db.orgUnit.findMany({ where: { centerId: { in: ids }, deletedAt: null }, select: { id: true, centerId: true } });
  const m = new Map<string, string>();
  for (const d of dong) if (d.centerId) m.set(d.centerId, d.id);
  return m;
}

type Evidence = Record<string, unknown>;
function laDoiTuong(x: unknown): x is Evidence {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** MERGE bằng chứng: giữ mọi khoá đang có (kể cả `staff`), chỉ ghi đè hai `mid` Agent vừa gửi. */
export function gopBangChung(cu: unknown, moi: { phoneMessageMid?: string | undefined; campusMessageMid?: string | undefined } | undefined): Evidence {
  const goc: Evidence = laDoiTuong(cu) ? { ...cu } : {};
  if (moi?.phoneMessageMid !== undefined) goc.phoneMessageMid = moi.phoneMessageMid;
  if (moi?.campusMessageMid !== undefined) goc.campusMessageMid = moi.campusMessageMid;
  return goc;
}

export async function xuLyLeadIntake(ctx: NguCanhYeuCau<"leadIntakes">, deps: { lenLichNen: LenLichNen }): Promise<KetQuaXuLy> {
  const b = ctx.body;
  const now = new Date(ctx.nowMs);
  const hash = bamNoiDung("leadIntakes", b);
  const pageId = b.conversation.pageId;

  // Catalog HIỆN HÀNH của Page. Chưa từng xuất bản ⇒ KHÔNG trả lời bằng danh mục rỗng (sẽ ra INVALID_SELECTION/NEED_INFO sai lệch): 503 để Agent thử lại / chuyển người.
  const snap = await layCatalogMoiNhat();
  if (!snap) return { loai: "loi", ma: "TEMP_UNAVAILABLE", retryAfterS: 30 };
  const catalog = snap.pages.find((p) => p.pageId === pageId)?.campuses ?? [];

  const dongPage = ctx.agent.pages.find((p) => p.pageId === pageId);
  const routingCenterId = dongPage?.routingCenterId ?? null;
  const maCoSo = await bangMaCoSoCuaPage(pageId);
  // Tra trước các OrgUnit có thể dùng — KHÔNG để extension ghi kép tra lúc đang giữ khoá hàng bằng kết nối khác (đói pool ⇒ kẹt).
  const orgUnits = await bangOrgUnit([routingCenterId, ...maCoSo.values()]);

  const hoiThoai = await capNhatHoiThoai(ctx.agent.id, b.conversation, ctx.nowMs);
  // Bộ quy tắc có version: đọc NGOÀI giao dịch (không giữ khoá hàng hội thoại khi tra thêm). Chỉ chạm bảng của Gateway ⇒ N1 giữ nguyên.
  const { ban: boQuyTac, hong: boQuyTacHong } = await docBoQuyTacAnToan();
  const hanSla = (centerId: string | null) => {
    const h = hanSlaTheoQuyTac(boQuyTac?.bo ?? null, { pageId, centerId }, ctx.cai);
    return tinhHanSla(now, { slaClaimMinutes: h.claimMinutes, slaResolveMinutes: h.resolveMinutes });
  };

  const kq = await giaoDichCoThuLai(async (tx) => {
    const g = await giuKhoaTrongTx(tx, { agentId: ctx.agent.id, key: b.idempotencyKey, endpoint: "leadIntakes", hash });
    if (g.loai === "xung-dot") return { loai: "xung-dot" as const };
    if (g.loai === "phat-lai") return { loai: "phat-lai" as const, body: g.body };

    const h = await khoaHoiThoai(tx, hoiThoai.id);
    const mo = await tx.aiLeadDraft.findFirst({
      where: { conversationId: h.id, intent: b.intent, state: { notIn: [...TRANG_THAI_DONG] } },
      orderBy: { createdAt: "desc" },
    });

    // Ứng viên GỘP: lượt này chồng lên điều hồ sơ đã biết.
    const phoneRaw = b.candidate.phoneRaw ?? mo?.phoneRaw ?? undefined;
    const campusCode = b.candidate.campusCode ?? mo?.campusCode ?? undefined;
    const quyet = quyetDinhLeadIntake({
      candidate: { phoneRaw, campusCode },
      conversation: { fbName: h.fbName, fbNameSource: h.fbNameSource ?? undefined },
      catalog,
      ownerState: h.ownerState,
    });

    const phoneCanonical = phoneRaw === undefined ? null : canonicalPhone(phoneRaw);
    const coSoHopLe = campusCode !== undefined ? catalog.find((c) => c.campusCode === campusCode && c.acceptingLeads) : undefined;
    const campusCenterId = coSoHopLe ? (maCoSo.get(coSoHopLe.campusCode) ?? null) : null;
    const bangChung = gopBangChung(mo?.evidence, b.evidence);
    const thieu = thieuDieuKien({ fbName: h.fbName, fbNameSource: h.fbNameSource, phoneCanonical, phoneRaw: phoneRaw ?? null, campusCenterId, evidence: bangChung });
    const consentAllowed = b.candidate.consent ? true : (mo?.consentAllowed ?? false);
    const consentMid = b.candidate.consent ? b.candidate.consent.messageMid : (mo?.consentMid ?? null);

    // Giá trị chung của mọi lần ghi hồ sơ.
    const duLieu = {
      fbName: h.fbName,
      fbNameSource: h.fbNameSource,
      phoneRaw: phoneRaw ?? null,
      phoneCanonical,
      campusCode: campusCode ?? null,
      campusCenterId,
      consentAllowed,
      consentMid,
      evidence: bangChung as object,
      missingFields: danhSachThieu(thieu),
    };
    const cenDich = campusCenterId ?? routingCenterId;
    const orgDich = cenDich ? orgUnits.get(cenDich) : undefined;

    let hauKy: HauKyIntake;
    if (!mo) {
      const state = tinhTrangThaiThuThap({ thieu, ownerState: h.ownerState });
      const moi = await tx.aiLeadDraft.create({
        data: {
          conversationId: h.id,
          intent: b.intent,
          state,
          ...duLieu,
          centerId: cenDich,
          // ⚠️ LUÔN truyền `orgUnitId` (kể cả null): vắng khoá thì extension ghi kép (lib/org/dual-write.ts) tra OrgUnit bằng kết nối KHÁC của pool NGAY TRONG giao dịch này,
          // trong khi các giao dịch song song đang giữ hết kết nối chờ khoá hàng hội thoại ⇒ kẹt tới khi hết hạn (P2028). Không ánh xạ được ⇒ null, cron đối soát `orgunit-drift` nhặt.
          orgUnitId: orgDich ?? null,
          ...(canNguoiXuLy(state) ? hanSla(cenDich) : {}),
          ruleSetVersion: boQuyTac?.version ?? null,
        },
        select: { id: true },
      });
      hauKy = { draftId: moi.id, centerId: cenDich, trangThai: state, canBao: canNguoiXuLy(state), thuHep: { consentAllowed, campusCenterId } };
    } else {
      // Hồ sơ đã có NGƯỜI nhận (hoặc đã ở trạng thái do người/hệ thống giữ: IN_PROGRESS · SYSTEM_EXCEPTION) là của nhân viên: dữ liệu Agent gửi thêm
      // KHÔNG được đè lên SĐT / cơ sở / tên nhân viên đã xác minh, và `campusCenterId` không được lệch khỏi `centerId` (nhân viên CS1 duyệt mà lead ra ở CS2).
      // Phản hồi cho Agent không đổi (do `quyet`, không do nhánh này); chỉ là Gateway không ghi gì. Ca cần ghi lại ý khách đổi → nhân viên đọc hội thoại.
      const cuaNhanVien = !coTheTinhLai(mo.state) || mo.claimedById !== null;
      if (cuaNhanVien) {
        hauKy = { draftId: mo.id, centerId: mo.centerId, trangThai: mo.state, canBao: false };
      } else {
        const state = tinhTrangThaiThuThap({ thieu, ownerState: h.ownerState });
        const doiChoXuLy = cenDich !== mo.centerId;
        const r = await tx.aiLeadDraft.updateMany({
          where: { id: mo.id, version: mo.version },
          data: {
            ...duLieu,
            state,
            version: { increment: 1 },
            // `orgUnitId` đổi CÙNG `centerId` (kể cả về null) — để một mình thì hai cột lệch nhau và cron đối soát phải nhặt.
            ...(doiChoXuLy ? { centerId: cenDich, orgUnitId: orgDich ?? null } : {}),
            ...(canNguoiXuLy(state) && mo.slaClaimDueAt === null ? { ...hanSla(doiChoXuLy ? cenDich : mo.centerId), ruleSetVersion: boQuyTac?.version ?? null } : {}),
          },
        });
        // Nhân viên (lát C) vừa sửa cùng hồ sơ ⇒ đọc lại và gộp lại từ đầu, không đè.
        if (r.count !== 1) throw new ChayLaiGiaoDich("version hồ sơ đổi giữa chừng");
        // Báo khi hồ sơ vừa chuyển sang cần người, HOẶC đã cần người mà vừa đổi sang cơ sở khác (QLCS mới chưa từng nghe về nó).
        hauKy = {
          draftId: mo.id,
          centerId: doiChoXuLy ? cenDich : mo.centerId,
          trangThai: state,
          canBao: canNguoiXuLy(state) && (!canNguoiXuLy(mo.state) || doiChoXuLy),
          thuHep: { consentAllowed, campusCenterId },
        };
      }
    }

    const body = dungThanOk(ctx, { receiptId: taoReceiptId(), ...quyet });
    await ghiPhanHoiTrongTx(tx, { agentId: ctx.agent.id, key: b.idempotencyKey, status: 200, body });
    return { loai: "ok" as const, body, hauKy };
  });

  if (kq.loai === "xung-dot") return { loai: "xung-dot" };
  if (kq.loai === "phat-lai") return { loai: "phat-lai", body: kq.body };

  // ── SAU khi đã quyết phản hồi (và đã commit): việc nền. Lỗi ở đây KHÔNG BAO GIỜ đổi phản hồi của Agent. ──
  const hk = kq.hauKy;
  // Tự tạo lead = công tắc TOÀN HỆ ∧ cờ RIÊNG của Page ∧ Page đang bật ∧ Agent active (quy-tac-page.ts, fail-closed). Page KHÔNG tìm thấy ⇒ từ chối.
  // Bị từ chối ⇒ rơi xuống nhánh dưới: hồ sơ vẫn báo QLCS như thường.
  const tuTao =
    dongPage !== undefined &&
    choPhepTuTaoLead({
      autoCreateToanHe: ctx.cai.autoCreateEnabled,
      pageAutoCreate: dongPage.autoCreate,
      pageState: dongPage.state,
      agentActive: ctx.agent.active,
      environment: ctx.agent.environment,
    }).allowed &&
    // Rule Builder: quy tắc của Page chỉ có thể THU HẸP (đòi đồng ý liên hệ / giới hạn cơ sở). Hồ sơ không có dữ kiện (của nhân viên) ⇒ không tự tạo.
    hk.thuHep !== undefined &&
    !boQuyTacHong &&
    thuHepTuTao(timQuyTacAuto(boQuyTac?.bo ?? null, ctx.agent.id, pageId), hk.thuHep).allowed;
  if (hk.trangThai === "READY_FOR_REVIEW" && tuTao) {
    deps.lenLichNen(() => tuTaoLeadRoiBao(hk, now));
  } else if (hk.canBao) {
    deps.lenLichNen(() => baoHoSoCanXuLy({ draftId: hk.draftId, centerId: hk.centerId, now }));
  }
  return { loai: "ok", body: kq.body };
}

/**
 * Tự tạo lead từ hồ sơ đã đủ điều kiện (CHỈ khi `choPhepTuTaoLead` cho phép: `ai.autoCreateEnabled` ∧ cờ riêng của Page — xem quy-tac-page.ts). Thất bại ⇒ đẩy hồ sơ sang `SYSTEM_EXCEPTION` (nhân viên thấy và xử lý) và báo;
 * thành công ⇒ trạng thái do `taoLeadTuHoSo` (lát C) đặt. Không bao giờ ném ra ngoài.
 */
export async function tuTaoLeadRoiBao(hk: HauKyIntake, now: Date): Promise<void> {
  let lyDo: string | null = null;
  try {
    const kq = await taoLeadTuHoSo(hk.draftId, { tu: "AUTO" });
    if (!kq.ok) lyDo = kq.lyDo;
  } catch (err) {
    console.error(`[ai-lead:tu-tao-lead] draft=${hk.draftId} loi=${maLoiNoiBo(err)}`);
    lyDo = "LOI_INGEST";
  }
  if (lyDo === null || lyDo === "DA_XU_LY" || lyDo === "XUNG_DOT_PHIEN_BAN") return;
  // THIEU_DIEU_KIEN: hồ sơ vẫn READY_FOR_REVIEW cho người xem. Lỗi hạ tầng/cơ sở: SYSTEM_EXCEPTION (ghi MÃ, không ghi nội dung lỗi).
  if (lyDo !== "THIEU_DIEU_KIEN") {
    try {
      await db.aiLeadDraft.updateMany({
        where: { id: hk.draftId, state: "READY_FOR_REVIEW" },
        data: { state: "SYSTEM_EXCEPTION", resultNote: `AUTO_${lyDo}`, version: { increment: 1 } },
      });
    } catch (err) {
      console.error(`[ai-lead:tu-tao-lead] draft=${hk.draftId} danh-dau loi=${maLoiNoiBo(err)}`);
    }
  }
  await baoHoSoCanXuLy({ draftId: hk.draftId, centerId: hk.centerId, now });
}
