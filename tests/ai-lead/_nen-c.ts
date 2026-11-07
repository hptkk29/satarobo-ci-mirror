// tests/ai-lead/_nen-c.ts — GIÁ ĐỠ DB THẬT cho test lát C (tạo lead từ hồ sơ + xử lý hồ sơ chờ). Không phải spec: tên bắt đầu `_` nên không bị gom.
//
// Dọn THEO TIỀN TỐ (`ATLC_`), KHÔNG `resetDb()`: bộ này chạy chung DB với bộ khác của lát AI Lead, không được TRUNCATE.
// Cổng chạy: `RUN_DB_TESTS` (tests/_helpers/db-gate.ts) + `assertTenDbTest()` (chỉ tên DB test*) — nó có ca gọi hàm tác động nhiều bảng.
import { PrismaClient } from "@prisma/client";

export const P = "ATLC_";
export const MA_CS_A = "ATA";
export const MA_CS_B = "ATB";
export const PAGE = `${P}PAGE1`;
export const PHONE_NOI_DIA = ["0900100001", "0900100002", "0900100003", "0900100004", "0900100005", "0900100006", "0900100007", "0900100008", "0900100009"] as const;

export const db = new PrismaClient();

/** Nhóm nguồn «Marketing HO» của bộ test (tiền tố riêng, dọn theo tiền tố). Cổng nguồn của `taoLeadTuHoSo` đòi cấu hình này TRƯỚC khi tạo lead chính thức. */
export const MA_NGUON = `${P}MKTHO`;
const KHOA_NGUON_TEST = ["nguon.enabled", "nguon.pageMapping", "nguon.bangNguonTheoPage"] as const;

async function xoaCache(): Promise<void> {
  (await import("@/lib/settings/service")).clearSettingsCache();
}

/** Cấu hình nguồn ĐẦY ĐỦ cho `pageId`: nhóm ACTIVE + ánh xạ Page CRM + hai cờ + dòng bảng nguồn theo Page. Idempotent. Test muốn cấu hình THIẾU thì gọi `goCauHinhNguon()` sau `dungNen()`. */
export async function camNguonMarketingHo(pageId: string = PAGE): Promise<void> {
  await db.leadSourceGroup.upsert({
    where: { code: MA_NGUON },
    update: { status: "ACTIVE", selectable: true, referrerRequirement: "NONE", effectiveFrom: null, effectiveTo: null },
    create: { code: MA_NGUON, name: `${P}Marketing HO`, status: "ACTIVE", selectable: true, referrerRequirement: "NONE" },
  });
  await db.facebookPageMapping.upsert({
    where: { pageId },
    update: { isActive: true, scopeType: "HO" },
    create: { pageId, pageName: `${P}Page`, scopeType: "HO", isActive: true },
  });
  const dat = (key: string, valueJson: unknown) =>
    db.systemSetting.upsert({ where: { key }, update: { valueJson: valueJson as never }, create: { key, valueJson: valueJson as never, updatedByName: "atlc" } });
  await dat("nguon.enabled", true);
  await dat("nguon.pageMapping", true);
  await dat("nguon.bangNguonTheoPage", { [pageId]: { groupCode: MA_NGUON } });
  await xoaCache();
}

/** Gỡ cấu hình nguồn (trả về mặc định: master tắt, bảng rỗng). */
export async function goCauHinhNguon(): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: { in: [...KHOA_NGUON_TEST] } } });
  await db.facebookPageMapping.deleteMany({ where: { pageName: { startsWith: P } } });
  await db.leadAttribution.deleteMany({ where: { group: { code: MA_NGUON } } });
  await db.leadSourceGroup.deleteMany({ where: { code: MA_NGUON } });
  await xoaCache();
}

export type Nen = { centerA: string; centerB: string; agentId: string; convId: string };

export async function donDep(): Promise<void> {
  const leads = await db.lead.findMany({
    where: { OR: [{ eventId: { startsWith: `ailead:${P}` } }, { parentName: { startsWith: P } }, { phone: { in: PHONE_NOI_DIA.flatMap((p) => [p, `84${p.slice(1)}`]) } }] },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadAuditLog.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadChild.deleteMany({ where: { leadId: { in: ids } } });
    await db.staffNotification.deleteMany({ where: { entityId: { in: ids } } }).catch(() => undefined);
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await goCauHinhNguon();
  await db.staffNotification.deleteMany({ where: { dedupeKey: { startsWith: "ai_lead.nguon:" } } });
  await db.auditLog.deleteMany({ where: { module: "ai-lead", entityId: { startsWith: P } } });
  await db.staffNotification.deleteMany({ where: { dedupeKey: { startsWith: `ai_lead.draft:${P}` } } });
  await db.aiLeadDraft.deleteMany({ where: { id: { startsWith: P } } });
  await db.aiLeadConversation.deleteMany({ where: { pageId: { startsWith: P } } });
  await db.aiLeadCampusPublication.deleteMany({ where: { pageId: { startsWith: P } } });
  await db.aiLeadAgent.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: P.toLowerCase() } } });
  await db.orgUnit.deleteMany({ where: { code: { startsWith: P } } });
}

async function taoCoSo(ma: string): Promise<string> {
  const c = await db.center.upsert({
    where: { slug: `${P.toLowerCase()}${ma.toLowerCase()}` },
    update: { code: ma, isActive: true },
    create: { code: ma, name: `${P}Cơ sở ${ma}`, slug: `${P.toLowerCase()}${ma.toLowerCase()}`, address: `${ma} Đường Kiểm Thử`, isActive: true },
    select: { id: true },
  });
  // PHẢI có OrgUnit type=CENTER trỏ vào cơ sở: `getNonEnrollableCenterIds` coi cơ sở mồ côi là «không nhận ghi danh» (xem tests/lead-intake/ingest.spec.ts).
  await db.orgUnit.upsert({
    where: { code: `${P}${ma}` },
    update: { centerId: c.id, isActive: true, deletedAt: null },
    create: { type: "CENTER", code: `${P}${ma}`, name: `${P}OrgUnit ${ma}`, centerId: c.id, path: `/${P.toLowerCase()}${ma.toLowerCase()}/`, depth: 2, isActive: true },
  });
  return c.id;
}

/** Dựng 2 cơ sở + 1 agent + 1 hội thoại + xuất bản cả hai cơ sở cho Page. Idempotent (dọn trước). */
export async function dungNen(): Promise<Nen> {
  await donDep();
  const [centerA, centerB] = [await taoCoSo(MA_CS_A), await taoCoSo(MA_CS_B)];
  const agent = await db.aiLeadAgent.create({ data: { name: `${P}agent`, environment: "TEST" } });
  const conv = await db.aiLeadConversation.create({
    data: { agentId: agent.id, pageId: PAGE, psid: `${P}psid-bi-mat`, fbName: "Nguyễn Thị Lan", fbNameSource: "META_PROFILE_API", ownerState: "AI_ACTIVE" },
  });
  for (const c of [centerA, centerB]) {
    await db.aiLeadCampusPublication.create({ data: { pageId: PAGE, campusCenterId: c, acceptingLeads: true, publicVisible: true } });
  }
  await camNguonMarketingHo(PAGE);
  return { centerA, centerB, agentId: agent.id, convId: conv.id };
}

/** Thêm một hội thoại (Page × PSID khác) — mỗi (hội thoại, ý định) chỉ có MỘT hồ sơ mở (chỉ mục từng phần), nên ca cần nhiều hồ sơ phải có nhiều hội thoại. */
export async function taoHoiThoai(nen: Nen, hauTo: string, over: { ownerState?: "AI_ACTIVE" | "HANDOFF_REQUESTED" | "TAKEOVER_PENDING" | "HUMAN_ACTIVE" | "PAUSED" } = {}): Promise<string> {
  const c = await db.aiLeadConversation.create({
    data: { agentId: nen.agentId, pageId: PAGE, psid: `${P}psid-${hauTo}`, fbName: "Nguyễn Thị Lan", fbNameSource: "META_PROFILE_API", ownerState: over.ownerState ?? "AI_ACTIVE" },
  });
  return c.id;
}

type TuyChonHoSo = Partial<{
  id: string;
  state: "COLLECTING" | "PENDING_INFO" | "WAITING_QLCS" | "IN_PROGRESS" | "READY_FOR_REVIEW" | "COMPLETED" | "REJECTED" | "EXPIRED" | "SYSTEM_EXCEPTION" | "ASSIGNMENT_PENDING";
  fbName: string | null;
  fbNameSource: "META_PROFILE_API" | "WEBHOOK_PAYLOAD" | "CUSTOMER_STATED" | null;
  phone: string | null;
  centerId: string | null;
  campusCenterId: string | null;
  campusCode: string | null;
  claimedById: string | null;
  consentAllowed: boolean;
  consentMid: string | null;
  convId: string;
  evidence: object;
  intent: "CONSULTATION_REQUEST" | "ENROLLMENT_REQUEST" | "TRIAL_CLASS_REQUEST";
  slaClaimDueAt: Date | null;
  slaResolveDueAt: Date | null;
}>;

/** Hồ sơ mặc định: ĐỦ ĐIỀU KIỆN, ở cơ sở A, chờ duyệt. */
export async function taoHoSo(nen: Nen, o: TuyChonHoSo = {}) {
  const ma = o.campusCode === undefined ? MA_CS_A : o.campusCode;
  const sdt = o.phone === undefined ? PHONE_NOI_DIA[0] : o.phone;
  return db.aiLeadDraft.create({
    data: {
      id: o.id ?? `${P}d-${Math.random().toString(36).slice(2, 10)}`,
      conversationId: o.convId ?? nen.convId,
      intent: o.intent ?? "ENROLLMENT_REQUEST",
      state: o.state ?? "READY_FOR_REVIEW",
      fbName: o.fbName === undefined ? "Nguyễn Thị Lan" : o.fbName,
      fbNameSource: o.fbNameSource === undefined ? "META_PROFILE_API" : o.fbNameSource,
      phoneRaw: sdt,
      phoneCanonical: sdt ? `84${sdt.slice(1)}` : null,
      campusCode: ma,
      campusCenterId: o.campusCenterId === undefined ? nen.centerA : o.campusCenterId,
      consentAllowed: o.consentAllowed ?? true,
      consentMid: o.consentMid === undefined ? "mid.dong-y" : o.consentMid,
      evidence: o.evidence ?? { phoneMessageMid: "mid.sdt" },
      centerId: o.centerId === undefined ? nen.centerA : o.centerId,
      claimedById: o.claimedById ?? null,
      slaClaimDueAt: o.slaClaimDueAt ?? null,
      slaResolveDueAt: o.slaResolveDueAt ?? null,
    },
  });
}
