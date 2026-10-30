/**
 * lib/affiliate/ghi-referral-xu-ly.ts — MỘT NƠI GHI việc xử lý tay referral: `xuLyReferral` (duyệt · từ chối · tranh chấp · xin/bổ sung bằng chứng) và `khaiTayReferral` (AFF-L3b).
 * Luật ĐƯỢC / KHÔNG ĐƯỢC ở `xu-ly-referral.ts` + `khai-tay-referral.ts` (thuần); phần ghi attribution ở `lib/nguon/ghi-nguon-affiliate-duyet.ts` (nơi duy nhất được chạm `LeadAttribution`).
 *
 * ── Thứ tự không đảo được ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *  1. Dòng referral đọc qua `scopedDb(actor)` + `passesScope` TRƯỚC mọi thứ: referral của cơ sở khác / `centerId NULL` (khi người xem cấp cơ sở) ⇒ trả y hệt «không tìm thấy». `scopedDb` KHÔNG che write.
 *  2. Quyền `affiliate_referrals:manage` do ACTION kiểm ở đầu hàm (nút vẽ bằng ĐÚNG khoá đó); ở đây chỉ còn cách ly cơ sở.
 *  3. Trong giao dịch: KHOÁ hàng referral (`FOR UPDATE`) → so mốc `updatedAt` người dùng đã thấy → máy trạng thái → mọi cổng → RỒI MỚI ghi. Từ chối sau phép ghi đầu tiên là `throw` (luật rollback).
 *  4. Mỗi hành động để lại: một dòng `AffiliateReferralEvent` (chỉ-thêm) + một dòng `AuditLog`, CÙNG giao dịch. `resolutionReason` cũ được chép vào `previousReason` của sự kiện — không viết đè im lặng.
 *
 * DUYỆT còn đòi: lead còn sống và nằm trong tầm nhìn cơ sở · chuỗi đối tác/thành viên/campaign còn hợp lệ HÔM NAY (hiệu lực ở thời điểm ghi nhận do người duyệt quyết, không phải lúc khách gửi) ·
 * không tự giới thiệu · nguồn giải LẠI từ cấu hình campaign (lượt cần xem tay không mang nguồn đã giải) · người duyệt không phải chính đối tác · tách nhiệm (người khai ≠ người duyệt khi còn người khác duyệt được).
 */
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/actor";
import { coQuyenTaiCoSo } from "@/lib/auth/quyen-tai-co-so";
import { db } from "@/lib/db";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { ghiNguonKhiDuyetReferral, NguonDuaGhiError } from "@/lib/nguon/ghi-nguon-affiliate-duyet";
import { capTheGhiNguon } from "@/lib/nguon/the-ghi-nguon";
import { nguoiGiuQuyenTaiCoSo } from "@/lib/org/nguoi-giu-quyen-tai-co-so";
import { MODULE_AUDIT_AFFILIATE, LoiGhiAffiliate, aud, laLoiTrungKhoa, type KetQuaGhi, type NguoiGhi } from "./chung";
import { giaiNguonCuaDoiTac } from "./giai-nguon";
import { docSnapshotReferral, type TrangThaiReferral } from "./ghi-referral-dau-vao";
import {
  khaiTayReferralSchema,
  khoaGiaoDichKhaiTay,
  khoaKhaiTay,
  kiemKhaiTay,
  type DauVaoKiemKhaiTay,
} from "./khai-tay-referral";
import { dungSnapshotReferral } from "./snapshot-referral";
import { danhTinhDoiTacDeChan } from "./danh-tinh-doi-tac";
import { kiemTuGioiThieu } from "./tu-gioi-thieu";
import {
  HANH_DONG_CAN_GHI_CHU,
  NHAN_HANH_DONG,
  chuyenTrangThai,
  kiemGhiChuBangChung,
  kiemLyDo,
  type HanhDongXuLy,
  type LoaiSuKien,
} from "./xu-ly-referral";

export const KHOA_QUYEN_XU_LY_REFERRAL = "affiliate_referrals:manage" as const;

const NGAY_MS = 24 * 60 * 60 * 1000;
const ENTITY = "AffiliateReferral";
const KHONG_TIM_THAY = "Không tìm thấy lượt giới thiệu này.";
const VUA_DOI = "Lượt này vừa được người khác xử lý hoặc thay đổi — hãy tải lại rồi thử lại.";

const khongTimThay = () => new LoiGhiAffiliate(KHONG_TIM_THAY, "khongTimThay");
const vuaDoi = () => new LoiGhiAffiliate(VUA_DOI, "vuaDoi");

function dich(e: unknown): { ok: false; loi: string; truong?: string } | null {
  if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
  if (e instanceof NguonDuaGhiError) return { ok: false, loi: e.message, truong: "vuaDoi" };
  return null;
}

/** Có người KHÁC (ngoài `loaiTruUserId`) giữ quyền xử lý referral tại cơ sở này không — nền của tách nhiệm. `centerId = null` (lượt chưa quy cơ sở) ⇒ chỉ tính người neo vai ở Hội sở/gốc. */
export async function coNguoiXuLyKhac(p: { centerId: string | null; loaiTruUserId: string; now: Date }): Promise<boolean> {
  if (p.centerId !== null) {
    const ids = await nguoiGiuQuyenTaiCoSo(p.centerId, [KHOA_QUYEN_XU_LY_REFERRAL]);
    return ids.some((id) => id !== p.loaiTruUserId);
  }
  // `UserOrgRole` không có quan hệ tới OrgUnit trong schema ⇒ tra đơn vị gốc/Hội sở trước, rồi lọc theo id.
  const donViGoc = await db.orgUnit.findMany({ where: { type: { in: ["ROOT", "HO"] }, deletedAt: null }, select: { id: true } });
  const dong = await db.userOrgRole.findFirst({
    where: {
      userId: { not: p.loaiTruUserId },
      orgUnitId: { in: donViGoc.map((d) => d.id) },
      status: "ACTIVE",
      effectiveFrom: { lte: p.now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: p.now } }],
      role: { permissions: { some: { action: KHOA_QUYEN_XU_LY_REFERRAL } } },
    },
    select: { userId: true },
  });
  return dong !== null;
}

export type DauVaoXuLyReferral = {
  actor: Actor;
  nguoi: NguoiGhi;
  referralId: string;
  hanhDong: HanhDongXuLy;
  /** Mốc `updatedAt` (ISO → Date) mà người dùng đã thấy — lệch ⇒ có người xử lý xen giữa. */
  updatedAtDaThay: Date;
  lyDo: unknown;
  ghiChu: unknown;
  now: Date;
};

export type KetQuaXuLyReferral = KetQuaGhi<{ den: TrangThaiReferral; nhanhGhiNguon: "TAO_MOI" | "DE_NHOM_CHO" | "DA_DUNG_NGUOI" | null; tuDuyet: boolean }>;

const SO_VOI_SU_KIEN: Readonly<Record<HanhDongXuLy, LoaiSuKien>> = {
  DUYET: "DUYET",
  TU_CHOI: "TU_CHOI",
  DANH_DAU_TRANH_CHAP: "DANH_DAU_TRANH_CHAP",
  XIN_BANG_CHUNG: "XIN_BANG_CHUNG",
  BO_SUNG_BANG_CHUNG: "BO_SUNG_BANG_CHUNG",
};

/** Câu hiện ở cột «Lý do / ghi chú» sau hành động — nhật ký đầy đủ nằm ở bảng sự kiện, đây chỉ là dòng cuối cùng. */
function lyDoHienTai(h: HanhDongXuLy, lyDo: string): string | null {
  if (h === "DUYET") return `Duyệt tay: ${lyDo}`;
  if (h === "TU_CHOI") return `Từ chối tay: ${lyDo}`;
  if (h === "DANH_DAU_TRANH_CHAP") return `Tranh chấp: ${lyDo}`;
  return null;
}

export async function xuLyReferral(p: DauVaoXuLyReferral): Promise<KetQuaXuLyReferral> {
  // Cổng nhập liệu — TRƯỚC khi chạm DB.
  const ly = kiemLyDo(p.lyDo);
  if (!ly.ok) return { ok: false, loi: ly.loi, truong: "lyDo" };
  let ghiChu: string | null = null;
  if (HANH_DONG_CAN_GHI_CHU[p.hanhDong]) {
    const g = kiemGhiChuBangChung(p.ghiChu);
    if (!g.ok) return { ok: false, loi: g.loi, truong: "ghiChu" };
    ghiChu = g.gia;
  } else if (typeof p.ghiChu === "string" && p.ghiChu.trim() !== "") {
    const g = kiemGhiChuBangChung(p.ghiChu);
    if (!g.ok) return { ok: false, loi: g.loi, truong: "ghiChu" };
    ghiChu = g.gia;
  }

  // 1. CƠ SỞ — referral qua scopedDb, TRƯỚC mọi thứ. Trả y hệt «không tìm thấy» cho ca không thấy và ca không tồn tại.
  const thay = await scopedDb(p.actor).affiliateReferral.findUnique({ where: { id: p.referralId }, select: { id: true, centerId: true } });
  if (!thay || !passesScope("AffiliateReferral", thay, p.actor)) return { ok: false, loi: KHONG_TIM_THAY, truong: "khongTimThay" };
  // NHÌN THẤY ≠ ĐƯỢC GHI (N9): `passesScope("AffiliateReferral")` gộp `view-org` và `manage` cùng tiền tố `affiliate_referrals:` ⇒ người chỉ XEM referral của cơ sở này (manage ở cơ sở khác) cũng "qua". Phải giữ ĐÚNG `manage` TẠI cơ sở của referral.
  if (!coQuyenTaiCoSo(p.actor, KHOA_QUYEN_XU_LY_REFERRAL, thay.centerId)) return { ok: false, loi: "Bạn không giữ quyền xử lý referral tại cơ sở này.", truong: "quyen" };

  try {
    return await db.$transaction(async (tx): Promise<KetQuaXuLyReferral> => {
      // 2. KHOÁ + đọc lại trong giao dịch.
      await tx.$queryRaw`SELECT "id" FROM "AffiliateReferral" WHERE "id" = ${p.referralId} FOR UPDATE`;
      const cu = await tx.affiliateReferral.findUnique({
        where: { id: p.referralId },
        include: {
          party: { select: { id: true, code: true, status: true, userId: true, employeeId: true, phone: true, email: true, typeId: true, type: { select: { code: true, defaultSourceGroupId: true } }, tags: { select: { tagId: true, tag: { select: { code: true } } } }, employee: { select: { phone: true, email: true } } } },
          campaign: { select: { id: true, code: true, status: true, effectiveFrom: true, effectiveTo: true, allowSelfReferral: true, protectWindowDays: true, defaultSourceGroupId: true, rules: { select: { typeId: true, tagId: true, sourceGroupId: true } } } },
          membership: { select: { id: true, status: true, effectiveFrom: true, effectiveTo: true } },
        },
      });
      if (!cu || !passesScope("AffiliateReferral", cu, p.actor)) throw khongTimThay();
      if (!coQuyenTaiCoSo(p.actor, KHOA_QUYEN_XU_LY_REFERRAL, cu.centerId)) throw new LoiGhiAffiliate("Bạn không giữ quyền xử lý referral tại cơ sở này.", "quyen");
      if (cu.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();

      // 3. Máy trạng thái.
      const ct = chuyenTrangThai(cu.status, p.hanhDong);
      if (!ct.ok) throw new LoiGhiAffiliate(ct.loi, "trangThai");

      let nhanhGhiNguon: "TAO_MOI" | "DE_NHOM_CHO" | "DA_DUNG_NGUOI" | null = null;
      let tuDuyet = false;
      let sourceGroupIdMoi: string | null = null;
      let snapshotMoi: Record<string, unknown> | null = null;

      if (p.hanhDong === "DUYET") {
        if (cu.leadId === null) throw new LoiGhiAffiliate("Lượt này chưa gắn phiếu khách — không có gì để ghi người giới thiệu.", "trangThai");
        const lead = await tx.lead.findUnique({ where: { id: cu.leadId }, select: { id: true, centerId: true, orgUnitId: true, phone: true, email: true, deletedAt: true } });
        if (!lead || lead.deletedAt !== null || !passesScope("Lead", lead, p.actor)) throw new LoiGhiAffiliate("Phiếu khách không còn hoặc nằm ngoài cơ sở của bạn.", "phieu");

        // NHÌN THẤY ≠ ĐƯỢC GHI, lần thứ hai: duyệt GHI NGUỒN CỦA LEAD (đổi ai nhận hoa hồng), nên khoá `manage` phải được giữ TẠI cơ sở của LEAD — không chỉ ở cơ sở của referral (hai cơ sở có thể
        // khác nhau: referral tự động/cũ có `centerId` riêng hoặc NULL). Thẻ do `capTheGhiNguon` cấp là thứ DUY NHẤT `ghiNguonKhiDuyetReferral` → `doiNguon` chấp nhận.
        const theGhi = capTheGhiNguon(p.actor, KHOA_QUYEN_XU_LY_REFERRAL, lead);
        if (!theGhi) throw new LoiGhiAffiliate("Bạn không giữ quyền xử lý referral tại cơ sở của phiếu khách này.", "quyen");

        // Người duyệt không được là CHÍNH đối tác được hưởng.
        const nguoiDuyet = await tx.user.findUnique({ where: { id: p.nguoi.userId }, select: { employeeId: true } });
        if (cu.party.userId === p.nguoi.userId || (cu.party.employeeId !== null && cu.party.employeeId === (nguoiDuyet?.employeeId ?? null))) {
          throw new LoiGhiAffiliate("Bạn là chính đối tác của lượt này — người khác phải duyệt.", "quyen");
        }
        // Tách nhiệm: lượt do chính người này khai thì chỉ tự duyệt được khi KHÔNG còn ai khác duyệt được.
        if (cu.createdById !== null && cu.createdById === p.nguoi.userId) {
          if (await coNguoiXuLyKhac({ centerId: cu.centerId, loaiTruUserId: p.nguoi.userId, now: p.now })) {
            throw new LoiGhiAffiliate("Lượt này do chính bạn khai — hãy nhờ người khác có quyền duyệt (tách nhiệm).", "quyen");
          }
          tuDuyet = true;
        }

        // Chuỗi còn hợp lệ HÔM NAY + không tự giới thiệu.
        const tgt = kiemTuGioiThieu(
          await danhTinhDoiTacDeChan(cu.party, tx),
          { phones: [lead.phone], emails: [lead.email] },
          cu.campaign.allowSelfReferral,
        );
        const kiem = kiemKhaiTay(
          { doiTac: { status: cu.party.status }, campaign: cu.campaign, thanhVien: cu.membership, phieuThayDuoc: true, tuGioiThieu: { chan: tgt.chan }, daCoLuotDangSong: false },
          p.now,
        );
        if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, "chuoi");

        // Nguồn giải LẠI từ cấu hình hiện hành — lượt cần xem tay không mang nguồn đã giải (cột `sourceGroupId` chỉ là chỗ giữ).
        const nguon = giaiNguonCuaDoiTac({
          quyTac: cu.campaign.rules,
          campaignMacDinh: cu.campaign.defaultSourceGroupId,
          doiTacLoaiId: cu.party.typeId,
          doiTacNhanIds: cu.party.tags.map((t) => t.tagId),
          loaiMacDinh: cu.party.type?.defaultSourceGroupId ?? null,
        });
        if (nguon.sourceGroupId === null) throw new LoiGhiAffiliate(`Chưa quy được nguồn để ghi: ${nguon.lyDo}`, "nguon");

        const snCu = docSnapshotReferral(cu.sourceSnapshot);
        snapshotMoi = dungSnapshotReferral({
          affiliateCode: cu.party.code,
          campaignCode: cu.campaign.code,
          method: cu.method,
          typeCode: cu.party.type?.code ?? null,
          tagCodes: cu.party.tags.map((t) => t.tag.code),
          tu: nguon.tu,
          // Giữ tín hiệu GỐC của lượt gửi (Origin lệch, căn cứ tự giới thiệu…) — đó là lý do nó từng cần xem tay.
          origin: snCu.origin ?? "VANG",
          canCuTuGioiThieu: snCu.canCuTuGioiThieu.length > 0 ? snCu.canCuTuGioiThieu : tgt.canCu,
        });
        sourceGroupIdMoi = nguon.sourceGroupId;

        // GHI NGUỒN — phép ghi ĐẦU TIÊN của giao dịch. Từ chối ở đây = chưa ghi gì.
        const gn = await ghiNguonKhiDuyetReferral(tx, {
          leadId: cu.leadId,
          the: theGhi,
          partyId: cu.partyId,
          campaignCode: cu.campaign.code,
          groupId: nguon.sourceGroupId,
          snapshot: snapshotMoi,
          referralId: cu.id,
          lyDo: ly.gia,
          actor: aud(p.nguoi),
          bayGio: p.now,
        });
        if (!gn.ok) throw new LoiGhiAffiliate(gn.loi, "nguon");
        nhanhGhiNguon = gn.nhanh;
      }

      // 4. Ghi referral — CÓ ĐIỀU KIỆN theo mốc đã đọc (hàng đã khoá, đây là lưới cuối).
      const dang = ct.den;
      const lyDoMoi = lyDoHienTai(p.hanhDong, ly.gia);
      const du: Prisma.AffiliateReferralUncheckedUpdateManyInput = {};
      if (dang !== cu.status) du.status = dang;
      if (lyDoMoi !== null) du.resolutionReason = lyDoMoi;
      if (p.hanhDong === "TU_CHOI") du.rejectedAt = p.now;
      if (p.hanhDong === "DUYET") {
        du.protectedUntil = new Date(p.now.getTime() + cu.campaign.protectWindowDays * NGAY_MS);
        du.sourceGroupId = sourceGroupIdMoi!;
        du.sourceSnapshot = snapshotMoi as Prisma.InputJsonValue;
      }
      // Hành động «giữ nguyên» (xin/bổ sung bằng chứng) vẫn đẩy `updatedAt` — để người đang mở trang cũ nhận «vừa được xử lý» thay vì ghi chồng lên một lượt đã khác.
      // Mốc này là dấu khoá lạc quan, không phải số liệu nghiệp vụ (nghiệp vụ dùng `p.now`).
      const r = await tx.affiliateReferral.updateMany({ where: { id: cu.id, updatedAt: cu.updatedAt }, data: { ...du, updatedAt: new Date() } });
      if (r.count === 0) throw vuaDoi();

      await tx.affiliateReferralEvent.create({
        data: {
          referralId: cu.id,
          kind: SO_VOI_SU_KIEN[p.hanhDong],
          fromStatus: cu.status,
          toStatus: dang,
          reason: ly.gia,
          note: ghiChu,
          previousReason: cu.resolutionReason,
          detail: ({ ...(nhanhGhiNguon ? { ghiNguon: nhanhGhiNguon } : {}), ...(tuDuyet ? { tuDuyet: true } : {}) }) as Prisma.InputJsonValue,
          actorId: p.nguoi.userId,
          actorName: p.nguoi.ten,
          centerId: cu.centerId,
          // Bảng chỉ-thêm (trigger chặn UPDATE) mà `BACKFILL_SPECS` lại có `UPDATE … SET orgUnitId … WHERE orgUnitId IS NULL` ⇒ dòng phải SINH RA đã đủ cột: chỉ truyền khi biết,
          // không thì để lớp ghi kép (`lib/org/dual-write.ts`) điền theo cơ sở — truyền `null` tường minh là «tôi tự set» và nó không điền.
          ...(cu.orgUnitId ? { orgUnitId: cu.orgUnitId } : {}),
        },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY,
        entityId: cu.id,
        action: `REFERRAL_${p.hanhDong}`,
        oldValues: { status: cu.status, resolutionReason: cu.resolutionReason },
        newValues: { status: dang, hanhDong: NHAN_HANH_DONG[p.hanhDong], ...(nhanhGhiNguon ? { ghiNguon: nhanhGhiNguon } : {}), ...(tuDuyet ? { tuDuyet: true } : {}) },
        reason: tuDuyet ? `${ly.gia} (người khai tự duyệt — không còn người khác có quyền duyệt)` : ly.gia,
        orgUnitId: cu.orgUnitId,
      });
      return { ok: true, den: dang, nhanhGhiNguon, tuDuyet };
    });
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── KHAI TAY ─────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaKhaiTay = KetQuaGhi<{ id: string }>;

export async function khaiTayReferral(p: { actor: Actor; nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaKhaiTay> {
  const kq = khaiTayReferralSchema.safeParse(p.vao);
  if (!kq.success) {
    const i = kq.error.issues[0];
    // `.strict()` ⇒ khoá lạ (soTien, tiLe, sourceGroupId…) rơi vào đây với `unrecognized_keys`.
    if (i?.code === "unrecognized_keys") return { ok: false, loi: "Không nhận ô này: hoa hồng, tỉ lệ và nguồn do hệ thống tính từ cấu hình campaign, không nhập tay.", truong: "chung" };
    return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
  }
  const v = kq.data;

  // Phiếu khách qua scopedDb + passesScope (cách ly cơ sở). `phone`/`email` chỉ để so tự giới thiệu — không rời hàm này.
  const lead = await scopedDb(p.actor).lead.findUnique({ where: { id: v.leadId }, select: { id: true, centerId: true, orgUnitId: true, phone: true, email: true, deletedAt: true } });
  // + ĐÚNG khoá `manage` TẠI cơ sở của phiếu (N9): `passesScope("Lead")` chỉ nói «thấy phiếu», không nói «được khai referral lên phiếu của cơ sở này».
  const phieuThayDuoc = !!lead && lead.deletedAt === null && passesScope("Lead", lead, p.actor) && coQuyenTaiCoSo(p.actor, KHOA_QUYEN_XU_LY_REFERRAL, lead.centerId);

  try {
    const ra = await db.$transaction(async (tx) => {
      const [party, campaign, membership] = await Promise.all([
        tx.affiliate.findUnique({
          where: { id: v.partyId },
          select: { id: true, code: true, status: true, userId: true, employeeId: true, phone: true, email: true, typeId: true, type: { select: { code: true, defaultSourceGroupId: true } }, tags: { select: { tagId: true, tag: { select: { code: true } } } }, employee: { select: { phone: true, email: true } } },
        }),
        tx.affiliateCampaign.findUnique({
          where: { id: v.campaignId },
          select: { id: true, code: true, status: true, effectiveFrom: true, effectiveTo: true, allowSelfReferral: true, defaultSourceGroupId: true, rules: { select: { typeId: true, tagId: true, sourceGroupId: true } } },
        }),
        tx.affiliateMembership.findUnique({ where: { partyId_campaignId: { partyId: v.partyId, campaignId: v.campaignId } }, select: { id: true, status: true, effectiveFrom: true, effectiveTo: true } }),
      ]);
      const tgt = party && campaign && lead
        ? kiemTuGioiThieu(
            await danhTinhDoiTacDeChan(party, tx),
            { phones: [lead.phone], emails: [lead.email] },
            campaign.allowSelfReferral,
          )
        : { chan: false, canCu: [] as const };

      // Hai lượt khai cùng bộ ba xếp hàng ở khoá này: «đã có lượt sống chưa» rồi ghi phải là một bước không xen được.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${khoaGiaoDichKhaiTay(v)}))`;
      const [daSong, daKhai] = await Promise.all([
        tx.affiliateReferral.findFirst({ where: { leadId: v.leadId, partyId: v.partyId, campaignId: v.campaignId, status: { in: ["VALID", "MANUAL_REVIEW", "DISPUTED"] } }, select: { id: true } }),
        tx.affiliateReferral.count({ where: { leadId: v.leadId, partyId: v.partyId, campaignId: v.campaignId, method: { in: ["MANUAL", "OFFLINE"] } } }),
      ]);

      const dauVao: DauVaoKiemKhaiTay = {
        doiTac: party ? { status: party.status } : null,
        campaign: campaign ? { status: campaign.status, effectiveFrom: campaign.effectiveFrom, effectiveTo: campaign.effectiveTo } : null,
        thanhVien: membership,
        phieuThayDuoc,
        tuGioiThieu: { chan: tgt.chan },
        daCoLuotDangSong: daSong !== null,
      };
      const cong = kiemKhaiTay(dauVao, p.now);
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.ma === "DA_CO_LUOT_DANG_SONG" ? "chung" : cong.ma === "PHIEU_KHONG_TIM_THAY" ? "leadId" : cong.ma === "DOI_TAC_KHONG_TIM_THAY" ? "partyId" : "campaignId");

      // Nguồn do CẤU HÌNH giải; thiếu cấu hình ⇒ không khai được (không bao giờ rơi âm thầm về «Không xác định»).
      const nguon = giaiNguonCuaDoiTac({
        quyTac: campaign!.rules,
        campaignMacDinh: campaign!.defaultSourceGroupId,
        doiTacLoaiId: party!.typeId,
        doiTacNhanIds: party!.tags.map((t) => t.tagId),
        loaiMacDinh: party!.type?.defaultSourceGroupId ?? null,
      });
      if (nguon.sourceGroupId === null) throw new LoiGhiAffiliate(`Chưa quy được nguồn cho đối tác này trong campaign: ${nguon.lyDo}`, "campaignId");

      const snapshot = dungSnapshotReferral({
        affiliateCode: party!.code,
        campaignCode: campaign!.code,
        method: v.method,
        typeCode: party!.type?.code ?? null,
        tagCodes: party!.tags.map((t) => t.tag.code),
        tu: nguon.tu,
        origin: "VANG",
        canCuTuGioiThieu: tgt.canCu,
      });
      const moi = await tx.affiliateReferral.create({
        data: {
          partyId: v.partyId,
          membershipId: membership!.id,
          campaignId: v.campaignId,
          assetId: null,
          clickId: null,
          leadId: v.leadId,
          method: v.method,
          status: "MANUAL_REVIEW",
          sourceGroupId: nguon.sourceGroupId,
          sourceSnapshot: snapshot as Prisma.InputJsonValue,
          evidence: { ghiChu: v.ghiChu, nguoiKhai: p.nguoi.userId } as Prisma.InputJsonValue,
          resolutionReason: `Khai tay, chờ duyệt: ${v.lyDo}`,
          idempotencyKey: khoaKhaiTay({ leadId: v.leadId, partyId: v.partyId, campaignId: v.campaignId, lan: daKhai + 1 }),
          centerId: lead!.centerId,
          orgUnitId: lead!.orgUnitId,
          createdById: p.nguoi.userId,
        },
        select: { id: true },
      });
      await tx.affiliateReferralEvent.create({
        data: {
          referralId: moi.id,
          kind: "KHAI_TAY",
          fromStatus: null,
          toStatus: "MANUAL_REVIEW",
          reason: v.lyDo,
          note: v.ghiChu,
          previousReason: null,
          detail: { cachDen: v.method } as Prisma.InputJsonValue,
          actorId: p.nguoi.userId,
          actorName: p.nguoi.ten,
          centerId: lead!.centerId,
          ...(lead!.orgUnitId ? { orgUnitId: lead!.orgUnitId } : {}), // xem chú thích ở sự kiện xử lý: dòng chỉ-thêm sinh ra đã đủ cột
        },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY,
        entityId: moi.id,
        action: "REFERRAL_KHAI_TAY",
        newValues: { status: "MANUAL_REVIEW", cachDen: v.method, partyId: v.partyId, campaignId: v.campaignId },
        reason: v.lyDo,
        orgUnitId: lead!.orgUnitId,
      });
      return { id: moi.id };
    });
    return { ok: true, id: ra.id };
  } catch (e) {
    if (laLoiTrungKhoa(e)) return { ok: false, loi: "Lượt khai tay này vừa được người khác ghi — tải lại để xem.", truong: "chung" };
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}
