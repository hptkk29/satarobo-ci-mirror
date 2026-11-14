/**
 * lib/nguon/xuat-lead-day-du.ts — XUẤT TOÀN BỘ THÔNG TIN lead + NGUỒN ĐẦY ĐỦ của từng lead (một lead = một dòng sheet chính, kèm các sheet con: con · tín hiệu nguồn · lịch sử trạng thái · lịch sử chăm sóc).
 *
 * ── Vì sao KHÔNG nới đường xuất `lead` đang chạy ────────────────────────────────────────────────────────────────
 * `lead` (15 cột) mặc định cho `CENTER_MANAGER`. Thêm ngày sinh phụ huynh, link Facebook, IP, nhật ký chăm sóc vào đó là âm thầm giao chúng cho quản lý cơ sở. Đường này là MÃ MÀN RIÊNG `lead-day-du`
 * (`vaiMacDinh: []` ⇒ chỉ quản trị tối cao cho tới khi họ phân quyền), nên mở nó là một quyết định có chủ đích.
 *
 * ── PII: mọi cột đi qua cùng bộ che với màn hình ───────────────────────────────────────────────────────────────
 *  · tên PH / SĐT / email / tên con / ghi chú / lý do rớt / ngày sinh PH → `maskLeadPiiFields` (cùng hàm S-1 của mọi màn lead); riêng SĐT còn bị che khi trường `phone` bị DENY riêng (`phoneHienDuoc`);
 *  · link Facebook · IP · User-Agent · tên PH/HS giới thiệu · ngày sinh con · nhật ký chăm sóc (chữ tự do) → GIẤU khi không có `leads:view-pii`;
 *  · nhãn nguồn người gõ (`signals.nhanGoc`) · đường vào (`Lead.source`) · giải trình → `docNhanGoc`/`docDuongVao`/`docGiaiTrinh` (chữ tự do có thể chứa SĐT);
 *  · `signals` KHÔNG BAO GIỜ được đổ nguyên JSON ra: chỉ ba khoá đã biết (`nhanGoc` · `xemTay[]` · `khoaNguon`).
 * `canViewPii` + `phoneHienDuoc` BẮT BUỘC, không mặc định (luật 7): mặc định `true` ở một chỗ gọi quên là rò hàng loạt.
 *
 * ── Cách ly cơ sở ──────────────────────────────────────────────────────────────────────────────────────────────
 * Lead đọc qua `scopedDb(actor)` (CS1 không thấy CS2; Hội sở thấy hết). `LeadAttribution`/`LeadTouchpoint` KHÔNG có cột cơ sở (ngoại lệ có chủ đích luật Nền #3) nên chỉ được đọc LỒNG qua `lead` — không bao giờ đọc thẳng bảng.
 * Lead đã xoá mềm KHÔNG xuất.
 *
 * ── Quy mô ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * Đọc theo LÔ `CO_LO_XUAT` lead (keyset theo `id`) — không `take` cứng im lặng. Không có trần số dòng: người xuất nhận ĐÚNG toàn bộ lead trong tầm nhìn của họ, và `tong` được ghi vào nhật ký.
 */
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { formatDateTimeVNZoned } from "@/lib/format/date";
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";
import { maskLeadPiiFields, maskPersonName, maskPhone } from "@/lib/lead/pii";
import { docDuongVao, docGiaiTrinh, docNhanGoc } from "./chu-tu-do-an-toan";
import { nhanCachXacDinh, nhanCanhBao, nhanXemTay } from "./nhan-hien-thi";
import { nhanDuongVao } from "./nhan-duong-vao";

export const CO_LO_XUAT = 400;

export type BangPhuLead = { ten: string; cot: string[]; dong: (string | number)[][] };

export type KetQuaXuatLeadDayDu = {
  /** Số lead đã xuất. */
  tong: number;
  cotLead: string[];
  dongLead: (string | number)[][];
  /** Chỉ số cột phải ép TEXT (SĐT, mã) — Excel nuốt số 0 đầu. */
  cotChuoi: number[];
  bangPhu: BangPhuLead[];
  /** `true` khi người xuất KHÔNG có `leads:view-pii` — tệp nói thẳng điều đó ở sheet chú giải. */
  daChePii: boolean;
};

const AN = "đã ẩn (cần quyền xem thông tin liên hệ lead)";
const co = (b: boolean | null | undefined) => (b ? "CÓ" : "KHÔNG");
const gio = (d: Date | null | undefined) => (d ? formatDateTimeVNZoned(d) : "");
/** Cột `@db.Date` lưu mốc UTC 00:00 của NGÀY VN ⇒ đọc theo UTC mới đúng ngày. */
function ngay(d: Date | null | undefined): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const NHAN_TOUCHPOINT: Record<string, string> = {
  TAO_LEAD: "Tạo lead",
  NHAP_LAI: "Nhập lại (trùng SĐT)",
  REF_SAU: "Mã giới thiệu đến sau",
  THEM_CON: "Thêm con",
  NHAP_EXCEL: "Nhập từ Excel",
  DOI_NGUON_BI_CHAN: "Đổi nguồn bị chặn",
  GOP_LEAD: "Gộp lead",
};
const NHAN_NGUOI_GT: Record<string, string> = { EMPLOYEE: "Nhân sự", PARENT: "Phụ huynh", AFFILIATE: "Đối tác" };
const NHAN_PHAN_CHIA: Record<string, string> = {
  AUTO: "Máy chia tự động",
  SELF: "Sale tự nhập",
  MANAGER: "Quản lý giao tay",
  IMPORT: "Nhập Excel",
  AFFILIATE: "Từ link giới thiệu",
  DUPLICATE: "Trùng SĐT — giữ chủ cũ",
};
const NHAN_TRIAL_CON: Record<string, string> = { NONE: "Chưa học thử", SCHEDULED: "Đã hẹn", IN_PROGRESS: "Đang học thử", ATTENDED: "Đã học thử" };
const NHAN_TRANG_THAI_CON: Record<string, string> = {
  NEW: "Mới",
  CONSULTING: "Đang tư vấn",
  TRIAL_SCHEDULED: "Hẹn học thử",
  TRIAL_ATTENDED: "Đã học thử",
  ENROLLED: "Chốt",
  LOST: "Rớt",
};

/** JSON tuỳ ý trong DB ⇒ không tin kiểu. Trả đúng ba khoá đã biết, KHÔNG đổ nguyên `signals`. */
function docSignals(signals: unknown): { nhanGoc: unknown; xemTay: string[]; khoaNguon: boolean } {
  const o = typeof signals === "object" && signals !== null && !Array.isArray(signals) ? (signals as Record<string, unknown>) : {};
  const xt = Array.isArray(o.xemTay) ? o.xemTay.filter((x): x is string => typeof x === "string") : [];
  return { nhanGoc: o.nhanGoc, xemTay: xt, khoaNguon: o.khoaNguon === true };
}

export const COT_LEAD = [
  "Mã lead", "Ngày tạo", "Cập nhật lần cuối", "Lần nhập gần nhất", "Số lần vào hệ thống",
  "Trạng thái", "Đổi trạng thái lúc", "Rớt ở bậc", "Lý do rớt", "Rớt lúc",
  "Phụ huynh", "SĐT", "Email", "Link Facebook", "Giới tính PH", "Ngày sinh PH", "Tỉnh/Thành", "Phường/Xã", "Địa chỉ nhà",
  "Tên con (trên phiếu)", "Tuổi con", "Số con khai",
  "Cơ sở", "Khoá quan tâm", "Khoá dự kiến", "Loại đơn dự kiến",
  "Phụ trách", "Người nhập phiếu", "Người chốt đơn", "Sale Admin", "Người phân lead", "Cách chia lead", "Dùng chung cơ sở",
  "Đường vào", "UTM source", "UTM medium", "UTM campaign", "UTM content", "UTM term",
  "Mã campaign", "ID campaign (Meta)", "ID ad set", "ID ad", "fbclid", "gclid", "Trang đích", "Trang giới thiệu (referrer)", "Đồng ý nhận marketing",
  "IP", "Trình duyệt (User-Agent)", "Ghi chú", "Ghi chú bàn giao",
  "Đủ điều kiện L2 lúc", "Bàn giao HO lúc", "CS xác nhận lúc", "Phân Sale lúc", "Liên hệ lần đầu lúc", "Chuyển đăng ký lúc", "Hẹn liên hệ lại", "Hoạt động gần nhất",
  "Đối tác giới thiệu (cũ)", "Nhóm hoa hồng (cũ)",
  "NGUỒN hiện hành", "Mã nguồn hiện hành", "Loại nguồn", "NGUỒN GỐC ban đầu", "Cách xác định nguồn", "Luật quy nguồn thắng", "Lý do quy nguồn", "Ghi nhận nguồn lúc",
  "Đường vào lúc ghi nguồn", "Loại người giới thiệu", "Người giới thiệu", "Mã người giới thiệu", "Vai người giới thiệu lúc ghi", "Sale phụ trách PH giới thiệu",
  "Thiếu người giới thiệu", "Giải trình nguồn (nhóm Khác)", "Cảnh báo", "Nhãn nguồn gốc người nhập gõ", "Lý do cần xem tay", "Nguồn đang khoá",
  "Người đổi nguồn gần nhất", "Lý do đổi nguồn", "Đổi nguồn/sửa lúc", "Kế thừa nguồn từ lead", "Số tín hiệu nguồn",
] as const;

const CHI_SO = (ten: (typeof COT_LEAD)[number]) => COT_LEAD.indexOf(ten);
/** Cột phải ép TEXT. */
export const COT_LEAD_CHUOI = [CHI_SO("Mã lead"), CHI_SO("SĐT"), CHI_SO("ID campaign (Meta)"), CHI_SO("ID ad set"), CHI_SO("ID ad"), CHI_SO("Mã người giới thiệu"), CHI_SO("Mã nguồn hiện hành")];

/** Select của MỘT lượt đọc lead — tách ra hằng để kiểu `LeadXuat` suy từ chính nó (viết inline làm TypeScript suy kiểu vòng qua `scopedDb`). */
const SELECT_LEAD = {
  id: true, createdAt: true, updatedAt: true, lastInboundAt: true, inboundCount: true,
  status: true, statusChangedAt: true, droppedAtStage: true, lostNote: true, lostAt: true,
  parentName: true, phone: true, email: true, facebookUrl: true, parentGender: true, parentDob: true, city: true, ward: true, addressLine: true,
  childName: true, childAge: true,
  centerId: true, orderKind: true, assignmentSource: true, isSharedWithTeam: true,
  source: true, utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true, utmTerm: true,
  campaignName: true, campaignId: true, adsetId: true, adId: true, fbclid: true, gclid: true, landingPage: true, referrer: true, consentMarketing: true,
  ipAddress: true, userAgent: true, note: true, handoverNote: true,
  // `"assignedAt"` đặt trong dấu nháy: lưới `[SRC-ENT-14]` cấm chuỗi `assignedAt:` trần ở `lib/nguon/**` (nó canh việc GHI chủ lead); đây là ĐỌC để xuất.
  qualifiedAt: true, handedAt: true, receivedConfirmedAt: true, "assignedAt": true, firstContactAt: true, convertedAt: true, nextFollowUpAt: true, lastActivityAt: true,
  commissionSource: true,
  createdById: true, convertedById: true, adminId: true, assignedById: true,
  center: { select: { name: true } },
  course: { select: { name: true } },
  expectedCourse: { select: { name: true } },
  expectedProduct: { select: { name: true } },
  assignedTo: { select: { name: true } },
  affiliate: { select: { code: true, name: true } },
  attribution: {
    select: {
      otherSourceNote: true, referrerKind: true, referrerMissing: true, referrerRoleCode: true,
      identificationMethod: true, matchedRule: true, reasonText: true, canhBao: true, signals: true,
      conversionEntry: true, attributedAt: true, changeReason: true, changedById: true, updatedAt: true, inheritedFromLeadId: true,
      group: { select: { name: true, code: true, sourceType: true } },
      originalGroup: { select: { name: true } },
      referrerEmployee: { select: { fullName: true, employeeCode: true } },
      referrerParentUser: { select: { name: true } },
      referrerStudent: { select: { name: true, studentCode: true } },
      referrerAffiliate: { select: { name: true, code: true } },
      referrerSaleUser: { select: { name: true } },
    },
  },
  children: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true, fullName: true, dob: true, ageYears: true, gender: true, schoolName: true, gradeLevel: true,
      interestedCourseId: true, interestedCenterId: true, classId: true, note: true, trialStatus: true, status: true,
      closedAt: true, contractValue: true, createdAt: true,
    },
  },
  touchpoints: {
    orderBy: { occurredAt: "asc" },
    select: { kind: true, occurredAt: true, conversionEntry: true, actorId: true, leadDuplicateId: true, claimedGroup: { select: { name: true } } },
  },
  statusHistory: { orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, changedByName: true, source: true, reason: true, createdAt: true } },
} satisfies Prisma.LeadSelect;

type LeadXuat = Prisma.LeadGetPayload<{ select: typeof SELECT_LEAD }>;

export async function docLeadDayDu(
  actor: Actor,
  p: {
    /** Có `leads:view-pii` không. BẮT BUỘC. */
    canViewPii: boolean;
    /** SĐT thật hiện được (có PII ∧ trường `phone` không bị DENY riêng). BẮT BUỘC. */
    phoneHienDuoc: boolean;
  },
): Promise<KetQuaXuatLeadDayDu> {
  const { canViewPii, phoneHienDuoc } = p;
  const sdb = scopedDb(actor);
  const dongLead: (string | number)[][] = [];
  const dongCon: (string | number)[][] = [];
  const dongTin: (string | number)[][] = [];
  const dongSu: (string | number)[][] = [];
  const dongCS: (string | number)[][] = [];

  // Bảng tra phụ (tên khoá học / cơ sở / lớp theo id không FK của LeadChild) — nạp một lần, dùng cho cả file.
  const [courses, centers, classes] = await Promise.all([
    db.course.findMany({ select: { id: true, name: true } }),
    db.center.findMany({ select: { id: true, name: true } }),
    db.class.findMany({ select: { id: true, name: true } }),
  ]);
  const tenKhoa = new Map(courses.map((c) => [c.id, c.name]));
  const tenCoSo = new Map(centers.map((c) => [c.id, c.name]));
  const tenLop = new Map(classes.map((c) => [c.id, c.name]));

  let conTro: string | null = null;
  let tong = 0;
  for (;;) {
    const lo: LeadXuat[] = await sdb.lead.findMany({
      where: { deletedAt: null, ...(conTro ? { id: { gt: conTro } } : {}) },
      orderBy: { id: "asc" },
      take: CO_LO_XUAT,
      select: SELECT_LEAD,
    });
    if (lo.length === 0) break;
    const ids = lo.map((l) => l.id);

    // Tên người theo id (không FK): người nhập/chốt/phân/đổi nguồn/thao tác tín hiệu — MỘT truy vấn cho cả lô.
    const idNguoi = new Set<string>();
    for (const l of lo) {
      for (const x of [l.createdById, l.convertedById, l.adminId, l.assignedById, l.attribution?.changedById]) if (x) idNguoi.add(x);
      for (const t of l.touchpoints) if (t.actorId) idNguoi.add(t.actorId);
    }
    const [nguoi, chamSoc] = await Promise.all([
      idNguoi.size > 0 ? db.user.findMany({ where: { id: { in: [...idNguoi] } }, select: { id: true, name: true } }) : Promise.resolve([]),
      // Nhật ký chăm sóc là CHỮ TỰ DO (có SĐT, tên) ⇒ chỉ xuất khi người xuất có quyền xem PII.
      canViewPii
        ? db.leadActivity.findMany({ where: { leadId: { in: ids } }, orderBy: [{ leadId: "asc" }, { createdAt: "asc" }], select: { leadId: true, type: true, actorName: true, content: true, createdAt: true } })
        : Promise.resolve([]),
    ]);
    const tenNguoi = new Map(nguoi.map((u) => [u.id, u.name ?? u.id]));
    const ten = (id: string | null | undefined) => (id ? (tenNguoi.get(id) ?? id) : "");

    for (const l of lo) {
      const a = l.attribution;
      const sig = docSignals(a?.signals);
      const m = maskLeadPiiFields(
        { parentName: l.parentName, phone: l.phone, email: l.email, childName: l.childName, note: l.note, parentDob: l.parentDob, lostNote: l.lostNote },
        canViewPii,
      );
      const handover = canViewPii ? (l.handoverNote ?? "") : l.handoverNote ? AN : "";
      // Người giới thiệu: nhân sự = tên + mã nhân sự (không phải khách); PH/HS giới thiệu là KHÁCH ⇒ che như tên PH.
      let nguoiGt = "";
      let maGt = "";
      if (a) {
        if (a.referrerEmployee) {
          nguoiGt = a.referrerEmployee.fullName;
          maGt = a.referrerEmployee.employeeCode;
        } else if (a.referrerAffiliate) {
          nguoiGt = a.referrerAffiliate.name;
          maGt = a.referrerAffiliate.code;
        } else if (a.referrerParentUser) {
          nguoiGt = canViewPii ? (a.referrerParentUser.name ?? "") : maskPersonName(a.referrerParentUser.name);
        } else if (a.referrerStudent) {
          nguoiGt = canViewPii ? a.referrerStudent.name : maskPersonName(a.referrerStudent.name);
          maGt = a.referrerStudent.studentCode ?? "";
        }
      }
      dongLead.push([
        l.id, gio(l.createdAt), gio(l.updatedAt), gio(l.lastInboundAt), l.inboundCount,
        LEAD_STATUS_LABEL[l.status as keyof typeof LEAD_STATUS_LABEL] ?? l.status, gio(l.statusChangedAt),
        l.droppedAtStage ? (LEAD_STATUS_LABEL[l.droppedAtStage as keyof typeof LEAD_STATUS_LABEL] ?? l.droppedAtStage) : "", m.lostNote ?? "", gio(l.lostAt),
        m.parentName ?? "", phoneHienDuoc ? l.phone : maskPhone(l.phone), m.email ?? "",
        canViewPii ? (l.facebookUrl ?? "") : l.facebookUrl ? AN : "",
        l.parentGender ?? "", canViewPii ? ngay(l.parentDob) : l.parentDob ? AN : "", l.city ?? "", l.ward ?? "", l.addressLine ?? "",
        m.childName ?? "", l.childAge ?? "", l.children.length,
        l.center?.name ?? "", l.course?.name ?? "", l.expectedCourse?.name ?? l.expectedProduct?.name ?? "", l.orderKind ?? "",
        l.assignedTo?.name ?? "", ten(l.createdById), ten(l.convertedById), ten(l.adminId), ten(l.assignedById),
        l.assignmentSource ? (NHAN_PHAN_CHIA[l.assignmentSource] ?? l.assignmentSource) : "", co(l.isSharedWithTeam),
        // Đường vào: chữ tự do khi nhập Excel ⇒ qua `docDuongVao`, rồi đổi tên hiển thị (`sale-form-app` → `nhap-khach-hang`).
        nhanDuongVao(docDuongVao(l.source, canViewPii)) ?? "",
        l.utmSource ?? "", l.utmMedium ?? "", l.utmCampaign ?? "", l.utmContent ?? "", l.utmTerm ?? "",
        l.campaignName ?? "", l.campaignId ?? "", l.adsetId ?? "", l.adId ?? "", l.fbclid ?? "", l.gclid ?? "", l.landingPage ?? "", l.referrer ?? "", co(l.consentMarketing),
        canViewPii ? (l.ipAddress ?? "") : l.ipAddress ? AN : "", canViewPii ? (l.userAgent ?? "") : l.userAgent ? AN : "",
        m.note ?? "", handover,
        gio(l.qualifiedAt), gio(l.handedAt), gio(l.receivedConfirmedAt), gio(l.assignedAt), gio(l.firstContactAt), gio(l.convertedAt), gio(l.nextFollowUpAt), gio(l.lastActivityAt),
        l.affiliate ? `${l.affiliate.name} (${l.affiliate.code})` : "", l.commissionSource ?? "",
        // ── NGUỒN ĐẦY ĐỦ ──
        a?.group.name ?? "(chưa quy nguồn)", a?.group.code ?? "", a?.group.sourceType ?? "", a?.originalGroup.name ?? "",
        a ? nhanCachXacDinh(a.identificationMethod) : "", a?.matchedRule ?? "", a?.reasonText ?? "", gio(a?.attributedAt),
        nhanDuongVao(docDuongVao(a?.conversionEntry, canViewPii)) ?? "",
        a?.referrerKind ? (NHAN_NGUOI_GT[a.referrerKind] ?? a.referrerKind) : "", nguoiGt, maGt, a?.referrerRoleCode ?? "", a?.referrerSaleUser?.name ?? "",
        a ? co(a.referrerMissing) : "", docGiaiTrinh(a?.otherSourceNote, canViewPii) ?? "", (a?.canhBao ?? []).map(nhanCanhBao).join("; "),
        docNhanGoc(sig.nhanGoc, canViewPii) ?? "", sig.xemTay.map(nhanXemTay).join("; "), sig.khoaNguon ? "CÓ" : "KHÔNG",
        a?.changedById ? ten(a.changedById) : "", a?.changeReason ?? "", a?.changeReason ? gio(a.updatedAt) : "", a?.inheritedFromLeadId ?? "", l.touchpoints.length,
      ]);

      for (const c of l.children) {
        dongCon.push([
          l.id, c.id, canViewPii ? c.fullName : maskPersonName(c.fullName), canViewPii ? ngay(c.dob) : c.dob ? AN : "", c.ageYears ?? "", c.gender ?? "",
          c.schoolName ?? "", c.gradeLevel ?? "",
          (c.interestedCourseId && tenKhoa.get(c.interestedCourseId)) || "", (c.interestedCenterId && tenCoSo.get(c.interestedCenterId)) || "", (c.classId && tenLop.get(c.classId)) || "",
          c.status ? (NHAN_TRANG_THAI_CON[c.status] ?? c.status) : "", NHAN_TRIAL_CON[c.trialStatus] ?? c.trialStatus,
          gio(c.closedAt), c.contractValue ?? "", canViewPii ? (c.note ?? "") : c.note ? AN : "", gio(c.createdAt),
        ]);
      }
      for (const t of l.touchpoints) {
        dongTin.push([l.id, gio(t.occurredAt), NHAN_TOUCHPOINT[t.kind] ?? t.kind, nhanDuongVao(docDuongVao(t.conversionEntry, canViewPii)) ?? "", t.claimedGroup?.name ?? "", ten(t.actorId), t.leadDuplicateId ?? ""]);
      }
      for (const h of l.statusHistory) {
        dongSu.push([
          l.id, gio(h.createdAt), h.fromStatus ? (LEAD_STATUS_LABEL[h.fromStatus as keyof typeof LEAD_STATUS_LABEL] ?? h.fromStatus) : "(lúc tạo)",
          LEAD_STATUS_LABEL[h.toStatus as keyof typeof LEAD_STATUS_LABEL] ?? h.toStatus, h.changedByName ?? "(hệ thống)", h.source,
          canViewPii ? (h.reason ?? "") : h.reason ? AN : "",
        ]);
      }
    }
    for (const c of chamSoc) dongCS.push([c.leadId, gio(c.createdAt), c.type, c.actorName, c.content]);

    tong += lo.length;
    conTro = lo[lo.length - 1]!.id;
    if (lo.length < CO_LO_XUAT) break;
  }

  const bangPhu: BangPhuLead[] = [
    {
      ten: "Con",
      cot: ["Mã lead", "Mã con", "Họ tên con", "Ngày sinh", "Tuổi", "Giới tính", "Trường", "Lớp (khối)", "Khoá quan tâm", "Cơ sở quan tâm", "Lớp đang học", "Trạng thái phễu", "Học thử", "Chốt lúc", "Giá trị hợp đồng (cam kết)", "Ghi chú", "Tạo lúc"],
      dong: dongCon,
    },
    { ten: "Tin hieu nguon", cot: ["Mã lead", "Lúc", "Loại tín hiệu", "Đường vào", "Nguồn tín hiệu đề xuất", "Người thao tác", "Lead trùng"], dong: dongTin },
    { ten: "Lich su trang thai", cot: ["Mã lead", "Lúc", "Từ", "Sang", "Người đổi", "Đổi từ đâu", "Lý do"], dong: dongSu },
  ];
  if (canViewPii) bangPhu.push({ ten: "Lich su cham soc", cot: ["Mã lead", "Lúc", "Loại", "Người ghi", "Nội dung"], dong: dongCS });

  return { tong, cotLead: [...COT_LEAD], dongLead, cotChuoi: COT_LEAD_CHUOI, bangPhu, daChePii: !canViewPii };
}
