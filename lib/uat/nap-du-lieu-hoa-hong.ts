// lib/uat/nap-du-lieu-hoa-hong.ts — BỘ NẠP DỮ LIỆU UAT cho module Nguồn & Hoa hồng (lõi của scripts/hoa-hong/uat-nap-du-lieu.ts).
//
// CHỈ chạy trên DB UAT: cổng chặn ở `cong-db-uat.ts`, do script gọi TRƯỚC khi vào đây. Hàm này tin `db` đã qua cổng.
//
// Dựng bằng HÀM GHI THẬT của repo (luật 9: cổng phải được cho ăn bằng thứ đường thật cho nó ăn):
//   · khoản thu: `recordPayment` → `confirmPayment` (hoàn tiền: `refundPayment`) — không ghi sổ tiền bằng tay;
//   · quy nguồn: `chuanBiQuyNguon` + `ghiQuyNguonLeadMoi` (cùng đường mà form nhập khách dùng) — bản chụp chủ nguồn / Sale phụ trách PH sinh ra thật;
//   · nguồn mẫu / chủ nguồn: `taoNguon` / `suaNguon` (có AuditLog, có cổng); chính sách mẫu: `taoVanBan` / `taoChinhSach` (DRAFT — người nghiệm thu tự kích hoạt);
//   · mốc cutover (tuỳ chọn): `datMocCutover` với actor SUPER_ADMIN thật.
// KHÔNG TRUNCATE, KHÔNG xoá, KHÔNG sửa dữ liệu không mang tiền tố UAT. Sổ hoa hồng bất biến nên "đặt lại" = dựng lại DB (xem checklist §Đặt lại).
//
// IDEMPOTENT: nhận ra "đã nạp" bằng mã đơn `UAT-<kịch bản>-DON` và ghi chú khoản thu `UAT:<kịch bản>:<số thứ tự>`. Chạy lại không sinh thêm khoản thu nào.
// DRY-RUN (`apply = false`): chỉ ĐỌC; trả kế hoạch "SE_TAO / DA_CO / THIEU".
import { Prisma } from "@prisma/client";

import { resolveActorUncached } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { confirmPayment, recordPayment, refundPayment } from "@/lib/finance/payment";
import { docMocCutover } from "@/lib/hoa-hong/cutover";
import { cuaSoMacDinh, xacNhanCutover, xemTruocCutover } from "@/lib/hoa-hong/cutover-hanh-dong";
import { taoChinhSach, taoVanBan } from "@/lib/hoa-hong/chinh-sach-service";
import type { RuleInput } from "@/lib/hoa-hong/chinh-sach-dau-vao";
import { suaNguon, taoNguon } from "@/lib/nguon/danh-muc-ghi";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import { chuanBiQuyNguon, ghiQuyNguonLeadMoi, type DauVaoNoiDay } from "@/lib/nguon/noi-day";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";

import {
  CHINH_SACH_MAU,
  EMAIL_UAT,
  HOC_PHI_UAT,
  KICH_BAN_UAT,
  NGUON_MAU,
  TIEN_TO_UAT,
  kyCuaNgay,
  maDonGocUat,
  phoneKhachUat,
  phonePhUat,
  maDonUat,
  mocGhiNhanUat,
  hieuLucChuNguonUat,
  ngayThuCuaUat,
  type KhoaNguoiUat,
  type KichBanUat,
} from "./kich-ban-hoa-hong";

export type DauVaoNapUat = {
  apply: boolean;
  /** Đồng hồ của lượt nạp (luật 19): dùng cho audit và cho `bayGio` của quy nguồn. BẮT BUỘC. */
  now: Date;
  /** Tháng cutover "YYYY-MM": mọi khoản thu UAT rơi vào tháng này (và mốc ghi nhận nguồn ở tháng liền trước). BẮT BUỘC. */
  kyCutover: string;
  /** Đặt `hoaHong.kyCutover` bằng `datMocCutover` nếu chưa có mốc. BẮT BUỘC, không mặc định (đụng cấu hình chung). */
  datMocCutover: boolean;
  /** Dựng sẵn khoản hoàn của S10 (bút toán hoàn mang ngày trong kỳ T) — để chạy bước 10 TRƯỚC khi lịch sang tháng T. BẮT BUỘC. */
  hoanTienSan: boolean;
};

export type TrangThaiMuc = "DA_CO" | "SE_TAO" | "DA_TAO" | "BO_QUA" | "THIEU";
export type MucNap = { nhom: string; ma: string; trangThai: TrangThaiMuc; ghiChu?: string };

export type KetQuaNapUat = {
  muc: MucNap[];
  /** Thứ cần có trước khi `--apply` chạy được (rỗng = đủ). */
  thieu: string[];
  /** Các kỳ "YYYY-MM" có khoản thu UAT — những kỳ cần bấm Tính. */
  cacKy: string[];
};

const LY_DO = "Nạp dữ liệu UAT hoa hồng (scripts/hoa-hong/uat-nap-du-lieu.ts)";
const NGAY_BAN_HANH_VB = "2026-09-01";
const HIEU_LUC_CS = new Date("2026-09-30T17:00:00.000Z"); // 01/10/2026 giờ VN

type Nguoi = { id: string; email: string; name: string | null; employeeId: string | null };
type BoNguoi = Record<KhoaNguoiUat, Nguoi>;


// ── Đọc điều kiện tiên quyết ──────────────────────────────────────────────────────────────────────────────

async function docNguoi(thieu: string[]): Promise<BoNguoi | null> {
  const emails = Object.values(EMAIL_UAT);
  const rows = await db.user.findMany({ where: { email: { in: [...emails] }, deletedAt: null }, select: { id: true, email: true, name: true, employeeId: true } });
  const theoEmail = new Map(rows.map((r) => [r.email, r]));
  const ra = {} as BoNguoi;
  let du = true;
  for (const [khoa, email] of Object.entries(EMAIL_UAT) as [KhoaNguoiUat, string][]) {
    const r = theoEmail.get(email);
    if (!r) {
      thieu.push(`tài khoản ${email} (chạy \`pnpm db:seed:uat\` hoặc workflow seed UAT)`);
      du = false;
      continue;
    }
    ra[khoa] = { id: r.id, email: r.email ?? email, name: r.name, employeeId: r.employeeId };
  }
  // hai người cần HỒ SƠ NHÂN SỰ: chủ nguồn và nhân sự giới thiệu
  if (du) {
    for (const khoa of ["marketing", "sale2"] as const) {
      if (!ra[khoa].employeeId) thieu.push(`tài khoản ${ra[khoa].email} chưa nối hồ sơ nhân sự (Employee) — cần để làm chủ nguồn / người giới thiệu`);
    }
  }
  return du ? ra : null;
}

// ── Chính sách mẫu ─────────────────────────────────────────────────────────────────────────────────────────

const rule = (loai: "NEW" | "RENEWAL", roleCode: string, rate: number): RuleInput => ({
  transactionTypeCode: loai,
  roleCode,
  revenueComponent: "TUITION",
  calcKind: "PERCENT",
  rate,
  fixedAmount: null,
  tierTable: null,
  note: "UAT",
});

// ── Dựng nền: cơ sở, người phụ trách, nguồn mẫu, chính sách mẫu ─────────────────────────────────────────────

async function dungNenChung(i: DauVaoNapUat, nguoi: BoNguoi, ra: MucNap[]): Promise<{ centerId: string; orgUnitId: string; nhomMauId: string | null }> {
  const cs1 = await db.center.findFirst({ where: { code: "CS1" }, select: { id: true } });
  const dv = await db.orgUnit.findFirst({ where: { code: "CS1", deletedAt: null }, select: { id: true } });
  if (!cs1 || !dv) throw new Error("Thiếu cơ sở CS1 (Center/OrgUnit) — chạy `pnpm db:seed:orgunit` trước.");
  const centerId = cs1.id;

  // Người phụ trách QLCS (QL_TT) + Marketing (QC) của CS1: chỉ BỔ SUNG khi thiếu — không đè người thật.
  for (const [role, khoa, nhan] of [
    ["QL_TT", "giamdoc", "QLCS"],
    ["QC", "sale5", "Marketing cơ sở"],
  ] as const) {
    const co = await db.centerCommissionAssignee.count({ where: { centerId, role, effectiveTo: null } });
    const ma = `CS1/${role}`;
    if (co > 0) ra.push({ nhom: "Người phụ trách", ma, trangThai: "DA_CO", ghiChu: `đã có người phụ trách ${nhan} — giữ nguyên, số tiền theo người ĐANG được gán` });
    else if (!i.apply) ra.push({ nhom: "Người phụ trách", ma, trangThai: "SE_TAO", ghiChu: `${nhan} = ${nguoi[khoa].email}` });
    else {
      await db.centerCommissionAssignee.create({ data: { centerId, role, userId: nguoi[khoa].id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: `${TIEN_TO_UAT}nap-du-lieu` } });
      ra.push({ nhom: "Người phụ trách", ma, trangThai: "DA_TAO", ghiChu: `${nhan} = ${nguoi[khoa].email}` });
    }
  }

  // Khoá học + lớp mẫu (hai khoá để dựng lần mua thứ hai).
  for (const [slug, ten] of [
    ["uat-sata3", "UAT — Sata 3"],
    ["uat-sata4", "UAT — Sata 4"],
  ] as const) {
    const co = await db.course.findUnique({ where: { slug }, select: { id: true } });
    if (co) ra.push({ nhom: "Khoá học", ma: slug, trangThai: "DA_CO" });
    else if (!i.apply) ra.push({ nhom: "Khoá học", ma: slug, trangThai: "SE_TAO" });
    else {
      const k = await db.course.create({ data: { id: `${TIEN_TO_UAT}khoa-${slug}`, name: ten, slug, totalSessions: 48 } });
      await db.class.create({ data: { id: `${TIEN_TO_UAT}lop-${slug}`, name: `${ten} · lớp UAT`, courseId: k.id, centerId } });
      ra.push({ nhom: "Khoá học", ma: slug, trangThai: "DA_TAO" });
    }
  }

  // Nguồn mẫu (bước 1) — ACTIVE, có chủ, tham gia hoa hồng, cửa sổ riêng.
  let nhomMauId: string | null = (await db.leadSourceGroup.findUnique({ where: { code: NGUON_MAU.code }, select: { id: true } }))?.id ?? null;
  if (nhomMauId) ra.push({ nhom: "Nguồn mẫu", ma: NGUON_MAU.code, trangThai: "DA_CO" });
  else if (!i.apply) ra.push({ nhom: "Nguồn mẫu", ma: NGUON_MAU.code, trangThai: "SE_TAO", ghiChu: `chủ nguồn = ${nguoi.marketing.email} · cửa sổ ${NGUON_MAU.cuaSoNgay} ngày` });
  else {
    const t = await taoNguon({
      nguoi: { userId: nguoi.admin.id, ten: nguoi.admin.name ?? nguoi.admin.email },
      coQuyenKichHoat: true,
      vao: {
        code: NGUON_MAU.code,
        name: NGUON_MAU.ten,
        description: "Nguồn mẫu của bộ UAT hoa hồng — dùng cho bước 1 và 2 của checklist.",
        sourceType: "PARTNER",
        referrerRequirement: "NONE",
        requiresNote: false,
        selectable: true,
        sortOrder: 900,
        trangThai: "ACTIVE",
        attributionWindowDays: NGUON_MAU.cuaSoNgay,
        commissionEnabled: true,
        ownerOrgUnitId: null,
        ownerEmployeeId: nguoi.marketing.employeeId,
        effectiveFrom: null,
        effectiveTo: null,
      },
    });
    if (!t.ok) throw new Error(`Không tạo được nguồn mẫu: ${t.truong}: ${t.loi}`);
    nhomMauId = t.id;
    ra.push({ nhom: "Nguồn mẫu", ma: NGUON_MAU.code, trangThai: "DA_TAO" });
  }

  // Văn bản + hai chính sách mẫu (DRAFT).
  const nguoiThaoTac = { userId: nguoi.admin.id, ten: nguoi.admin.name ?? nguoi.admin.email };
  let vb = await db.regulationDocument.findUnique({ where: { documentCode: CHINH_SACH_MAU.vanBan }, select: { id: true } });
  if (vb) ra.push({ nhom: "Văn bản", ma: CHINH_SACH_MAU.vanBan, trangThai: "DA_CO" });
  else if (!i.apply) ra.push({ nhom: "Văn bản", ma: CHINH_SACH_MAU.vanBan, trangThai: "SE_TAO", ghiChu: "tệp đính kèm là liên kết giả — chỉ dùng trên môi trường thử" });
  else {
    vb = await taoVanBan({
      documentCode: CHINH_SACH_MAU.vanBan,
      title: "Quy định thử nghiệm UAT — hoa hồng theo nguồn (không có giá trị ban hành)",
      kind: "COMMISSION_POLICY",
      issuedOn: NGAY_BAN_HANH_VB,
      publishedOn: NGAY_BAN_HANH_VB,
      effectiveOn: "2026-09-23",
      approvedByName: "UAT",
      approvedById: null,
      fileKey: "documents/uat-vb-01.pdf",
      fileName: "uat-vb-01.pdf",
      fileUrl: "https://example.test/uat-vb-01.pdf",
      ownerOrgUnitId: null,
      actor: nguoiThaoTac,
      now: i.now,
    });
    ra.push({ nhom: "Văn bản", ma: CHINH_SACH_MAU.vanBan, trangThai: "DA_TAO" });
  }
  for (const [ma, ten, phamVi, rules] of [
    [CHINH_SACH_MAU.nguon, "UAT — chủ nguồn mẫu nhận 1%", nhomMauId ? ({ loai: "SOURCE_GROUP", sourceGroupId: nhomMauId } as const) : null, [rule("NEW", "SOURCE_OWNER", 0.01)]],
    [CHINH_SACH_MAU.taiTuc, "UAT — tái tục: Sale 1% + QLCS 1%", { loai: "GLOBAL" } as const, [rule("RENEWAL", "SALE", 0.01), rule("RENEWAL", "CENTER_MANAGER", 0.01)]],
  ] as const) {
    const co = await db.commissionPolicy.findUnique({ where: { policyCode: ma }, select: { id: true } });
    if (co) ra.push({ nhom: "Chính sách mẫu", ma, trangThai: "DA_CO" });
    else if (!i.apply || !vb || !phamVi) ra.push({ nhom: "Chính sách mẫu", ma, trangThai: "SE_TAO", ghiChu: "bản NHÁP — người nghiệm thu thử tính rồi kích hoạt (bước 2, bước 8)" });
    else {
      await taoChinhSach({
        policyCode: ma,
        name: ten,
        description: "Chính sách mẫu của bộ UAT.",
        ownerOrgUnitId: null,
        phamVi,
        effectiveFrom: HIEU_LUC_CS,
        effectiveTo: null,
        reason: "SR.QD.UAT-01 — chính sách thử nghiệm",
        documentId: vb.id,
        rules,
        actor: nguoiThaoTac,
        now: i.now,
      });
      ra.push({ nhom: "Chính sách mẫu", ma, trangThai: "DA_TAO", ghiChu: "bản NHÁP" });
    }
  }
  return { centerId, orgUnitId: dv.id, nhomMauId };
}

// ── Một kịch bản ───────────────────────────────────────────────────────────────────────────────────────────

type NenChung = { centerId: string; orgUnitId: string; nhomMauId: string | null };

/** Tra id nhóm nguồn theo mã (nhóm mẫu lấy từ nền chung vì có thể vừa tạo). */
async function idNhom(code: string, nen: NenChung): Promise<string> {
  if (code === NGUON_MAU.code && nen.nhomMauId) return nen.nhomMauId;
  const g = await db.leadSourceGroup.findUnique({ where: { code }, select: { id: true } });
  if (!g) throw new Error(`Thiếu nhóm nguồn ${code} trong danh mục — chạy migration/seed nguồn trước.`);
  return g.id;
}

const nguonChon = (groupId: string) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null });

/** Dòng tín hiệu nhập như form nhập khách dựng, theo kiểu nguồn của kịch bản. Người gõ KHÔNG khai: ghi nguồn theo lựa chọn của kịch bản, không theo "người nhập là người giới thiệu". */
async function dongNhap(kb: Pick<KichBanUat, "nhom" | "nguoiGioiThieu">, nguoi: BoNguoi, nen: NenChung, studentPhId: string | null, sdt: string, now: Date): Promise<DauVaoNoiDay> {
  const goc: DauVaoNoiDay = {
    bayGio: now,
    duongVao: "nhap-tay",
    conversionEntry: null,
    nhanKhai: null,
    laNhapExcel: false,
    sdtKhach: sdt, // SĐT thật của dòng nhập: quy nguồn dùng nó để kế thừa theo SĐT + cảnh báo trùng SĐT nhân viên ([QN-W14])
    maNvNguoiNhap: null,
    nguoiNhapUserId: null,
    ...KHONG_CO_TIN_HIEU_NGUON,
    orgUnitId: nen.orgUnitId,
    centerId: nen.centerId,
  };
  if (kb.nguoiGioiThieu === "PHU_HUYNH") return { ...goc, phuHuynhGioiThieu: { parentUserId: nguoi.phuhuynh.id, studentId: studentPhId } };
  if (kb.nguoiGioiThieu === "NHAN_SU") return { ...goc, nhanSuGioiThieuEmployeeId: nguoi.sale2.employeeId };
  if (kb.nhom === "PAID_ADS") {
    return { ...goc, duongVao: "facebook", conversionEntry: "facebook", quangCao: { adId: "uat-ad", campaignId: "uat-camp", adsetId: null, campaignName: "UAT", formId: null, fbclid: null, gclid: null } };
  }
  return { ...goc, nguonChon: nguonChon(await idNhom(kb.nhom, nen)) };
}

type NguonDaBat = Extract<Awaited<ReturnType<typeof chuanBiQuyNguon>>[number], { bat: true }>;

/** Quy nguồn chuẩn bị NGOÀI transaction (đọc DB), kiểm đã bật và không bị chặn. */
async function chuanBi(dong: DauVaoNoiDay): Promise<NguonDaBat> {
  const cb = (await chuanBiQuyNguon(db, [dong]))[0]!;
  if (!cb.bat) throw new Error(`Quy nguồn không bật${cb.loi ? `: ${cb.loi}` : ""} — bật công tắc tổng "Quản lý nguồn khách" ở Cấu hình vận hành (tab Khách hàng) trước khi nạp.`);
  if (cb.chanNhap) throw new Error(`Đường nhập chặn: ${cb.chanNhap}`);
  return cb;
}

/**
 * Tạo MỘT lead đã quy nguồn. Lời gọi `.lead.create(` và `ghiQuyNguonLeadMoi(` nằm CÙNG hàm, cùng transaction (lưới `[QN-W1]`/`[QN-W2]`):
 * lead không bao giờ ra đời mà thiếu nguồn.
 */
async function taoLeadDaQuyNguon(p: {
  tx: Prisma.TransactionClient;
  ten: string;
  phone: string;
  convertedById: string;
  adminId: string | null;
  centerId: string;
  tao: Date;
  mocGhiNhan: Date;
  cb: NguonDaBat;
}): Promise<string> {
  const lead = await p.tx.lead.create({
    data: { parentName: p.ten, phone: p.phone, status: "DA_DANG_KY", convertedById: p.convertedById, adminId: p.adminId, centerId: p.centerId, createdAt: p.tao, lastInboundAt: p.tao },
    select: { id: true },
  });
  // Ghim mốc ghi nhận về ngày của kịch bản (DB đặt giờ thật cho dòng mới; khoản thu của kịch bản mang ngày tuyệt đối nên mốc cũng phải tuyệt đối).
  await ghiQuyNguonLeadMoi(p.tx, lead.id, { ...p.cb, duLieu: { ...p.cb.duLieu, attributedAt: p.mocGhiNhan } }, null);
  return lead.id;
}

type DonDung = { orderId: string; orderItemId: string; enrollmentId: string };
type CoSoKichBan = DonDung & { goc: DonDung | null };

const NGAY_MS = 86_400_000;

async function dungKichBan(i: DauVaoNapUat, kb: KichBanUat, nguoi: BoNguoi, nen: NenChung): Promise<CoSoKichBan> {
  const mocGhiNhan = mocGhiNhanUat(i.kyCutover);
  const phone = phoneKhachUat(kb.ma);
  const lopId = (slug: string) => `${TIEN_TO_UAT}lop-${slug}`;
  const khoaId = (slug: string) => `${TIEN_TO_UAT}khoa-${slug}`;

  // Phụ huynh giới thiệu (S03): lead gốc + học viên của phụ huynh, COMMIT TRƯỚC — quy nguồn tra Sale phụ trách PH qua Student.leadId → Lead.convertedById
  // nên phải thấy chúng. Học viên là dấu "đã dựng": chạy lại sau lỗi giữa chừng không dựng đôi.
  let studentPhId: string | null = null;
  if (kb.nguoiGioiThieu === "PHU_HUYNH") {
    const idHv = `${TIEN_TO_UAT}${kb.ma}-hv-ph`;
    studentPhId = idHv;
    if (!(await db.student.findUnique({ where: { id: idHv }, select: { id: true } }))) {
      const cbGoc = await chuanBi(await dongNhap({ nhom: "WALK_IN", nguoiGioiThieu: null }, nguoi, nen, null, phonePhUat(kb.ma), i.now));
      const mocGoc = new Date(mocGhiNhan.getTime() - 60 * NGAY_MS);
      await db.$transaction(async (tx) => {
        const leadGocId = await taoLeadDaQuyNguon({
          tx,
          ten: `${TIEN_TO_UAT}${kb.ma}-ph-goc`,
          phone: phonePhUat(kb.ma),
          convertedById: nguoi.sale3.id,
          adminId: null,
          centerId: nen.centerId,
          tao: mocGoc,
          mocGhiNhan: mocGoc,
          cb: cbGoc,
        });
        await tx.student.create({
          data: { id: idHv, name: `Bé UAT ${kb.ma} (con phụ huynh giới thiệu)`, centerId: nen.centerId, parentUserId: nguoi.phuhuynh.id, leadId: leadGocId },
        });
      });
    }
  }
  const cb = await chuanBi(await dongNhap(kb, nguoi, nen, studentPhId, phone, i.now));
  const tongDon = kb.thanhToan.reduce((s, t) => s + t.soTien, 0);

  return db.$transaction(
    async (tx) => {
      const leadId = await taoLeadDaQuyNguon({
        tx,
        ten: `${TIEN_TO_UAT}${kb.ma}-ph`,
        phone,
        convertedById: nguoi.sale1.id,
        adminId: nguoi.saleho.id,
        centerId: nen.centerId,
        tao: mocGhiNhan,
        mocGhiNhan,
        cb,
      });

      let leadChildId: string | null = null;
      if (kb.coGvTrial) {
        const be = await tx.leadChild.create({ data: { leadId, fullName: `Bé UAT ${kb.ma}` } });
        leadChildId = be.id;
        const lop = await tx.trialClassV2.create({
          data: { code: `${TIEN_TO_UAT}TC-${kb.ma}`, name: `Lớp trial UAT ${kb.ma}`, centerId: nen.centerId, teacherId: nguoi.giaovien.id, sessionCount: 1, startDate: new Date("2026-09-20T03:00:00.000Z") },
        });
        const buoi = await tx.trialClassSession.create({
          data: { trialClassId: lop.id, seq: 1, date: new Date("2026-09-20T03:00:00.000Z"), startTime: "09:00", endTime: "10:30", teacherId: nguoi.giaovien.id },
        });
        const ghiDanhTrial = await tx.trialEnrollment.create({ data: { trialClassId: lop.id, leadChildId: be.id } });
        await tx.trialAttendance.create({ data: { trialSessionId: buoi.id, trialEnrollmentId: ghiDanhTrial.id, status: "PRESENT" } });
      }

      const student = await tx.student.create({
        data: { id: `${TIEN_TO_UAT}${kb.ma}-hv`, name: `Bé UAT ${kb.ma}`, centerId: nen.centerId, leadId, parentPhone: phone },
        select: { id: true },
      });

      const taoDon = async (p: { ma: string; slug: string; tao: Date; leadChild: string | null; tong: number }): Promise<DonDung> => {
        const gd = await tx.enrollment.create({
          data: { id: `${p.ma}-gd`, studentId: student.id, classId: lopId(p.slug), courseId: khoaId(p.slug), centerId: nen.centerId, status: "ACTIVE", createdAt: p.tao },
          select: { id: true },
        });
        const don = await tx.order.create({
          data: { id: `${p.ma}-id`, code: p.ma, type: "COURSE", status: "CONFIRMED", customerName: "PH UAT", customerPhone: phone, totalAmount: p.tong, centerId: nen.centerId, leadId, leadChildId: p.leadChild, createdAt: p.tao },
          select: { id: true },
        });
        const dong = await tx.orderItem.create({
          data: { id: `${p.ma}-oi`, orderId: don.id, type: "COURSE_ENROLLMENT", itemName: `Học phí ${kb.ma}`, quantity: 1, unitPrice: p.tong, totalPrice: p.tong, studentId: student.id, enrollmentId: gd.id, createdAt: p.tao },
          select: { id: true },
        });
        return { orderId: don.id, orderItemId: dong.id, enrollmentId: gd.id };
      };
      // Lần mua đầu (chỉ khi kịch bản là lần mua thứ hai): đơn cũ, tạo TRƯỚC, đã thu đủ — để lần mua sau là RENEWAL cả ở luật hiện hành lẫn luật tất định theo thứ tự mua.
      const goc = kb.lanMuaThuHai ? await taoDon({ ma: maDonGocUat(kb.ma), slug: "uat-sata3", tao: new Date(mocGhiNhan.getTime() - 45 * NGAY_MS), leadChild: null, tong: HOC_PHI_UAT }) : null;
      const chinh = await taoDon({ ma: maDonUat(kb.ma), slug: kb.lanMuaThuHai ? "uat-sata4" : "uat-sata3", tao: mocGhiNhan, leadChild: leadChildId, tong: tongDon });
      return { ...chinh, goc };
    },
    { maxWait: 20_000, timeout: 60_000 },
  );
}

async function ghiKhoanThu(p: { ghiChu: string; don: DonDung; soTien: number; ngay: Date; nguoi: BoNguoi; centerId: string }): Promise<string> {
  const da = await db.payment.findFirst({ where: { note: p.ghiChu }, select: { id: true } });
  if (da) return da.id;
  const r = await recordPayment({ orderId: p.don.orderId, enrollmentId: p.don.enrollmentId, amount: p.soTien, method: "cash", paidDate: p.ngay, note: p.ghiChu, recordedById: p.nguoi.sale1.id, centerId: p.centerId });
  if (!r.ok) throw new Error(`recordPayment ${p.ghiChu}: ${r.error}`);
  await db.payment.update({ where: { id: r.paymentId }, data: { orderItemId: p.don.orderItemId } });
  const c = await confirmPayment({ paymentId: r.paymentId, confirmedById: p.nguoi.ketoan.id });
  if (!c.ok) throw new Error(`confirmPayment ${p.ghiChu}: ${c.error}`);
  return r.paymentId;
}

/** Đọc lại đơn đã dựng (chạy lại sau lần nạp trước). */
async function timDon(ma: string): Promise<DonDung | null> {
  const don = await db.order.findUnique({ where: { code: ma }, select: { id: true, items: { select: { id: true, enrollmentId: true } } } });
  const it = don?.items[0];
  return don && it?.enrollmentId ? { orderId: don.id, orderItemId: it.id, enrollmentId: it.enrollmentId } : null;
}

// ── Điểm vào ────────────────────────────────────────────────────────────────────────────────────────────────

export async function napDuLieuHoaHongUat(i: DauVaoNapUat): Promise<KetQuaNapUat> {
  const ra: MucNap[] = [];
  const thieu: string[] = [];

  const nguoi = await docNguoi(thieu);
  const cs1 = await db.center.findFirst({ where: { code: "CS1" }, select: { id: true } });
  if (!cs1) thieu.push("cơ sở CS1 (chạy `pnpm db:seed:orgunit`)");
  const nhomGoc = await db.leadSourceGroup.count({ where: { code: { in: ["PAID_ADS", "PARENT_REFERRAL", "EMPLOYEE_REFERRAL", "WALK_IN", "EVENT", "CENTER_ORGANIC", "UNKNOWN"] } } });
  if (nhomGoc < 7) thieu.push("danh mục nguồn gốc (migration 20261014090000)");
  if ((await db.beneficiaryRole.count()) < 10) thieu.push("danh mục vai hưởng hoa hồng (migration 20261014100000)");
  if (!(await laQuanLyNguonBat())) thieu.push('công tắc "Quản lý nguồn khách" đang TẮT — bật ở Cấu hình vận hành → tab Khách hàng (xem checklist §Điều kiện tiên quyết)');

  const cacKy = [...new Set(KICH_BAN_UAT.flatMap((k) => k.thanhToan.map((t) => kyCuaNgay(ngayThuCuaUat(i.kyCutover, t.ngay)))))].sort();

  if (thieu.length > 0 || nguoi === null) {
    for (const t of thieu) ra.push({ nhom: "Điều kiện tiên quyết", ma: t, trangThai: "THIEU" });
    if (i.apply) throw new Error(`Chưa đủ điều kiện để nạp:\n  - ${thieu.join("\n  - ")}`);
    return { muc: ra, thieu, cacKy };
  }

  // Mốc cutover
  const mocHienCo = await docMocCutover(db);
  if (mocHienCo !== null) {
    ra.push({ nhom: "Mốc cutover", ma: mocHienCo, trangThai: "DA_CO", ghiChu: mocHienCo === i.kyCutover ? "khớp kỳ T" : `KHÁC kỳ T=${i.kyCutover}: khoản thu UAT nằm ở kỳ T; nếu T < mốc thì engine mới sẽ bỏ qua chúng` });
  } else if (!i.datMocCutover) {
    ra.push({ nhom: "Mốc cutover", ma: i.kyCutover, trangThai: "BO_QUA", ghiChu: "chưa đặt mốc — đặt ở /cau-hinh-van-hanh (uat.admin) hoặc chạy lại với --dat-moc-cutover" });
  } else if (!i.apply) {
    ra.push({ nhom: "Mốc cutover", ma: i.kyCutover, trangThai: "SE_TAO" });
  } else {
    // Đúng đường người dùng đặt mốc ở trang «Chuyển hoa hồng»: XEM TRƯỚC (đủ bằng chứng + precheck) rồi XÁC NHẬN bằng đúng cái đã xem. Không bơm `phuThuoc` giả, không bỏ precheck.
    const actor = await resolveActorUncached(nguoi.admin.id);
    const cuaSo = cuaSoMacDinh(i.now);
    const xem = await xemTruocCutover({ moi: i.kyCutover, now: i.now, cuaSo });
    if (!xem.ok) throw new Error(`Không xem trước được việc đặt mốc ${i.kyCutover}: ${xem.ma}: ${xem.loi}`);
    if (!xem.xem.sanSang) {
      throw new Error(`Chưa đặt được mốc cutover ${i.kyCutover} — trang «Chuyển hoa hồng» cũng đang chặn:\n  - ${xem.xem.chan.map((c) => `${c.ma}: ${c.lyDo} (sửa: ${c.noiSua})`).join("\n  - ")}`);
    }
    const xacNhan = await xacNhanCutover({ actor, ten: nguoi.admin.name ?? nguoi.admin.email }, { moi: i.kyCutover, lyDo: LY_DO, now: i.now, cuaSo, cuDaXem: xem.xem.cu, dauVanDaXem: xem.xem.dauVan });
    if (!xacNhan.ok) throw new Error(`Không đặt được mốc cutover ${i.kyCutover}: ${xacNhan.ma}: ${xacNhan.loi}`);
    ra.push({ nhom: "Mốc cutover", ma: i.kyCutover, trangThai: "DA_TAO" });
  }

  const nen = await dungNenChung(i, nguoi, ra);

  // Chủ nguồn PAID_ADS: lead S05B phải ghi nhận TRƯỚC khi khai chủ (đối chứng "ảnh chụp chủ nguồn"); các lead khác SAU.
  const paidAds = await db.leadSourceGroup.findUnique({ where: { code: "PAID_ADS" }, select: { id: true, ownerEmployeeId: true, updatedAt: true } });
  if (!paidAds) throw new Error("Thiếu nguồn PAID_ADS trong danh mục.");
  const chuDaCoTruoc = paidAds.ownerEmployeeId !== null;

  const xuLy = async (kb: KichBanUat): Promise<void> => {
    let co: CoSoKichBan;
    const daCo = await timDon(maDonUat(kb.ma));
    if (daCo) {
      co = { ...daCo, goc: kb.lanMuaThuHai ? await timDon(maDonGocUat(kb.ma)) : null };
      ra.push({ nhom: "Kịch bản", ma: kb.ma, trangThai: "DA_CO", ghiChu: kb.tieuDe });
    } else if (kb.truocKhiKhaiChuNguon && chuDaCoTruoc) {
      ra.push({ nhom: "Kịch bản", ma: kb.ma, trangThai: "BO_QUA", ghiChu: "nguồn PAID_ADS đã có chủ — không dựng lại được tình huống 'ghi nhận lúc chưa có chủ'; đối chứng ÂM của bước 5 làm theo hướng dẫn trong checklist" });
      return;
    } else if (!i.apply) {
      ra.push({ nhom: "Kịch bản", ma: kb.ma, trangThai: "SE_TAO", ghiChu: kb.tieuDe });
      return;
    } else {
      co = await dungKichBan(i, kb, nguoi, nen);
      ra.push({ nhom: "Kịch bản", ma: kb.ma, trangThai: "DA_TAO", ghiChu: kb.tieuDe });
    }
    if (!i.apply) return;

    // Khoản thu — idempotent theo ghi chú. Lần mua đầu của S08 (đơn gốc) thu trước kỳ T 40 ngày.
    if (co.goc) {
      await ghiKhoanThu({ ghiChu: `UAT:${kb.ma}:0`, don: co.goc, soTien: HOC_PHI_UAT, ngay: new Date(mocGhiNhanUat(i.kyCutover).getTime() - 40 * NGAY_MS), nguoi, centerId: nen.centerId });
    }
    let khoanDau: string | null = null;
    for (const [idx, t] of kb.thanhToan.entries()) {
      const id = await ghiKhoanThu({ ghiChu: `UAT:${kb.ma}:${idx + 1}`, don: co, soTien: t.soTien, ngay: ngayThuCuaUat(i.kyCutover, t.ngay), nguoi, centerId: nen.centerId });
      khoanDau ??= id;
    }
    if (kb.hoanTienSan && i.hoanTienSan && khoanDau) {
      const ghiChuHoan = `UAT:${kb.ma}:hoan`;
      if (await db.payment.findFirst({ where: { note: ghiChuHoan }, select: { id: true } })) {
        ra.push({ nhom: "Hoàn tiền", ma: kb.ma, trangThai: "DA_CO" });
      } else {
        const h = await refundPayment({ paymentId: khoanDau, confirmedById: nguoi.ketoan.id, reason: `Hoàn một phần UAT ${ghiChuHoan}`, amount: kb.hoanTienSan.soTien });
        if (!h.ok) throw new Error(`refundPayment ${kb.ma}: ${h.error}`);
        // `refundPayment` đặt ngày hoàn = giờ thật; kịch bản cần ngày nằm trong kỳ T ⇒ ghim sang ngày của kịch bản (sửa dấu thời gian của bút toán do hàm thật tạo, không đổi logic).
        const ngay = ngayThuCuaUat(i.kyCutover, kb.hoanTienSan.ngay);
        await db.payment.update({ where: { id: h.refundId }, data: { paidDate: ngay, confirmedAt: ngay, note: ghiChuHoan } });
        ra.push({ nhom: "Hoàn tiền", ma: kb.ma, trangThai: "DA_TAO", ghiChu: `${kb.hoanTienSan.soTien} đ, ngày ${ngay.toISOString().slice(0, 10)}` });
      }
    }
  };

  // 1) S05B (ghi nhận lúc chưa có chủ nguồn)
  for (const kb of KICH_BAN_UAT.filter((k) => k.truocKhiKhaiChuNguon)) await xuLy(kb);

  // 2) khai chủ nguồn PAID_ADS nếu chưa có
  if (chuDaCoTruoc) {
    ra.push({ nhom: "Chủ nguồn", ma: "PAID_ADS", trangThai: "DA_CO", ghiChu: "đã có chủ — giữ nguyên" });
  } else if (!i.apply) {
    ra.push({ nhom: "Chủ nguồn", ma: "PAID_ADS", trangThai: "SE_TAO", ghiChu: `= ${nguoi.marketing.email}` });
  } else {
    const s = await suaNguon({
      nguoi: { userId: nguoi.admin.id, ten: nguoi.admin.name ?? nguoi.admin.email },
      id: paidAds.id,
      updatedAtDaThay: paidAds.updatedAt,
      vao: { ownerEmployeeId: nguoi.marketing.employeeId },
      lyDo: "Khai chủ nguồn quảng cáo cho bộ UAT hoa hồng (bước 5)",
      coQuyenKichHoat: true,
      now: i.now,
      // Chủ nguồn chỉ áp cho giao dịch có NGÀY THU ĐẦU từ mốc này (08 §16): S05B (thu 16) nằm TRƯỚC ⇒ vẫn «chưa có chủ»; S05 (thu 20) nằm SAU ⇒ chủ nhận 1%.
      hieuLucChuTu: hieuLucChuNguonUat(i.kyCutover),
    });
    if (!s.ok) throw new Error(`Không khai được chủ nguồn PAID_ADS: ${s.truong}: ${s.loi}`);
    ra.push({ nhom: "Chủ nguồn", ma: "PAID_ADS", trangThai: "DA_TAO", ghiChu: `= ${nguoi.marketing.email}` });
  }

  // 3) các kịch bản còn lại
  for (const kb of KICH_BAN_UAT.filter((k) => !k.truocKhiKhaiChuNguon)) await xuLy(kb);

  return { muc: ra, thieu, cacKy };
}
