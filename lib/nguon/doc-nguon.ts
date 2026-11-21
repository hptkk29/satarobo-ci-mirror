/**
 * lib/nguon/doc-nguon.ts — ĐỌC nguồn của lead và HÀNG CHỜ NGUỒN (MANUAL_REVIEW). Đặc tả `02 §2.5`, `05 SRC-24`.
 *
 * ── Cách ly cơ sở: ĐI QUA `Lead` ĐÃ SCOPE, KHÔNG BAO GIỜ đọc thẳng bảng con ─────────────────────────────────
 * `LeadAttribution`/`LeadTouchpoint` không có cột đơn vị (ngoại lệ CÓ CHỦ ĐÍCH luật Nền #3 — chủ dự án chấp nhận 07/10/2026),
 * nên cách ly cơ sở của chúng chỉ có MỘT nguồn: `scopedDb(actor).lead`. Hậu quả bắt buộc cho tệp này:
 *   · mọi hàm nhận `actor` + `leadId` và đọc TỪ `Lead` (`sdb.lead.findUnique/findMany/count`, include/select quan hệ `attribution`);
 *   · KHÔNG hàm nào nhận `attributionId`/`touchpointId` làm khoá tra (lưới `[NCL-08]` ghim danh sách export);
 *   · tổng hợp đi `lead.count`, không `leadAttribution.groupBy`;
 *   · lead của cơ sở khác ⇒ `null` — không phân biệt "không có" với "không được xem" (không `403`, không lộ tồn tại).
 *
 * `passesScope` đứng thêm một lớp sau lượt đọc đã scope: lớp thứ hai rẻ, và nó là thứ giữ cổng nếu ai đó đổi `scopedDb`.
 *
 * ⚠️ KHÔNG có cổng QUYỀN ở đây (chỉ cơ sở). **Mọi nơi gọi PHẢI gác `sources:view` TRƯỚC** (qua `can()`): người xem được lead mà không có
 * `sources:view` sẽ đọc được nhóm nguồn, id người giới thiệu và cảnh báo `SDT_NHAN_VIEN`. Hiện 0 nơi gọi (PR7 nối giao diện).
 */
import type { Actor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { laManualReviewBat } from "./feature";
import type { LyDoXemTayNguon } from "./tin-hieu";

export type NguonCuaLead = {
  leadId: string;
  nhom: { code: string; name: string };
  nhomGoc: { code: string; name: string };
  luat: string;
  lyDo: string;
  identificationMethod: string;
  nguoiGioiThieu:
    | { kind: "EMPLOYEE"; employeeId: string }
    | { kind: "PARENT"; parentUserId: string | null; studentId: string | null }
    | { kind: "AFFILIATE"; affiliateId: string }
    | null;
  referrerMissing: boolean;
  canhBao: string[];
  xemTay: string[];
  khoaNguon: boolean;
  attributedAt: Date;
  keThuaTuLeadId: string | null;
  touchpoints: { kind: string; occurredAt: Date; nhomTuyenBo: string | null }[];
};

type SignalsNguon = { coXemTay?: boolean; xemTay?: string[]; khoaNguon?: boolean };
const laSignals = (v: unknown): SignalsNguon => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as SignalsNguon) : {});

/** Nguồn của MỘT lead. `null` nếu lead không tồn tại, ngoài tầm nhìn của actor, hoặc chưa có quy nguồn. */
export async function docNguonLead(actor: Actor, leadId: string): Promise<NguonCuaLead | null> {
  const sdb = scopedDb(actor);
  const l = await sdb.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      centerId: true,
      orgUnitId: true,
      attribution: {
        select: {
          matchedRule: true,
          reasonText: true,
          identificationMethod: true,
          referrerKind: true,
          referrerEmployeeId: true,
          referrerParentUserId: true,
          referrerStudentId: true,
          referrerAffiliateId: true,
          referrerMissing: true,
          canhBao: true,
          signals: true,
          attributedAt: true,
          inheritedFromLeadId: true,
          group: { select: { code: true, name: true } },
          originalGroup: { select: { code: true, name: true } },
        },
      },
      touchpoints: {
        orderBy: { occurredAt: "asc" },
        take: 100,
        select: { kind: true, occurredAt: true, claimedGroup: { select: { name: true } } },
      },
    },
  });
  if (!l || !l.attribution || !passesScope("Lead", l, actor)) return null;
  const a = l.attribution;
  const s = laSignals(a.signals);
  return {
    leadId: l.id,
    nhom: a.group,
    nhomGoc: a.originalGroup,
    luat: a.matchedRule,
    lyDo: a.reasonText,
    identificationMethod: a.identificationMethod,
    nguoiGioiThieu:
      a.referrerKind === "EMPLOYEE" && a.referrerEmployeeId
        ? { kind: "EMPLOYEE", employeeId: a.referrerEmployeeId }
        : a.referrerKind === "PARENT"
          ? { kind: "PARENT", parentUserId: a.referrerParentUserId, studentId: a.referrerStudentId }
          : a.referrerKind === "AFFILIATE" && a.referrerAffiliateId
            ? { kind: "AFFILIATE", affiliateId: a.referrerAffiliateId }
            : null,
    referrerMissing: a.referrerMissing,
    canhBao: a.canhBao,
    xemTay: s.xemTay ?? [],
    khoaNguon: s.khoaNguon === true,
    attributedAt: a.attributedAt,
    keThuaTuLeadId: a.inheritedFromLeadId,
    touchpoints: l.touchpoints.map((t) => ({ kind: t.kind, occurredAt: t.occurredAt, nhomTuyenBo: t.claimedGroup?.name ?? null })),
  };
}

export type BoLocHangCho = {
  /** 1..200. BẮT BUỘC khai (luật 7). */
  gioiHan: number;
  lyDo: LyDoXemTayNguon | null;
  /** Con trỏ phân trang: `leadId` cuối của trang trước. */
  sauLeadId: string | null;
};

export type HangChoNguon = {
  leadId: string;
  centerId: string | null;
  nhom: { code: string; name: string };
  lyDo: string[];
  canhBao: string[];
  referrerMissing: boolean;
  attributedAt: Date;
};

/**
 * HÀNG CHỜ NGUỒN — lead có attribution ở trạng thái xem tay (`signals.coXemTay`): nhãn #10/#14/#22 sau 06/10 (H21), nhóm cần
 * người mà chưa có người, mã NV không giải được, nhãn lạ, page chưa map, ref chưa phân loại, SĐT nhân viên (cảnh báo).
 *
 * Đọc QUA `Lead` đã scope: actor cơ sở nào chỉ thấy hàng của cơ sở đó. Người quyết (đổi nguồn) ⇒ cờ bị gỡ ⇒ rời hàng chờ.
 * Không trả PII (tên/SĐT phụ huynh): màn hình tự mở lead qua đường đọc đã che PII của nó.
 */
export async function docHangChoNguon(
  actor: Actor,
  loc: BoLocHangCho,
): Promise<{ bat: boolean; tong: number; hang: HangChoNguon[] }> {
  // Cờ `nguon.manualReview` (∧ master) gác MÀN hàng chờ, không gác việc GHI cờ xem tay (rẻ, không mất gì): tắt thì hàng chờ rỗng
  // và `bat = false` để giao diện nói "chưa bật" thay vì "không có gì cần xem" — hai câu khác hẳn nhau (luật 12).
  if (!(await laManualReviewBat())) return { bat: false, tong: 0, hang: [] };
  const gioiHan = Math.min(Math.max(Math.trunc(loc.gioiHan), 1), 200);
  const sdb = scopedDb(actor);
  const where = {
    deletedAt: null,
    AND: [
      { attribution: { is: { signals: { path: ["coXemTay"], equals: true } } } },
      ...(loc.lyDo ? [{ attribution: { is: { signals: { path: ["xemTay"], array_contains: [loc.lyDo] } } } }] : []),
    ],
  };
  const [tong, rows] = await Promise.all([
    sdb.lead.count({ where }),
    sdb.lead.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: gioiHan,
      ...(loc.sauLeadId ? { cursor: { id: loc.sauLeadId }, skip: 1 } : {}),
      select: {
        id: true,
        centerId: true,
        orgUnitId: true,
        attribution: {
          select: {
            referrerMissing: true,
            canhBao: true,
            signals: true,
            attributedAt: true,
            group: { select: { code: true, name: true } },
          },
        },
      },
    }),
  ]);
  return {
    bat: true,
    tong,
    hang: rows
      .filter((l) => l.attribution !== null && passesScope("Lead", l, actor))
      .map((l) => ({
        leadId: l.id,
        centerId: l.centerId,
        nhom: l.attribution!.group,
        lyDo: laSignals(l.attribution!.signals).xemTay ?? [],
        canhBao: l.attribution!.canhBao,
        referrerMissing: l.attribution!.referrerMissing,
        attributedAt: l.attribution!.attributedAt,
      })),
  };
}
