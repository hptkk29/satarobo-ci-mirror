// tests/hoa-hong/_kich-ban.ts — DỰNG KỊCH BẢN cho bộ test sổ hoa hồng (Postgres thật). KHÔNG phải spec (không `.spec.ts`).
//
// Nguyên tắc dựng (luật 9 CLAUDE.md "cổng phải được cho ăn bằng thứ đường THẬT cho nó ăn"):
//   · DÒNG TIỀN dựng bằng HÀM GHI THẬT của `lib/finance/payment.ts` (`recordPayment` → `confirmPayment`, `refundPayment`,
//     `adjustPayment`, `rejectPayment`) — không `payment.create` tay. Fixture gõ tay đầu vào của cổng thì kiểm cổng chứ không kiểm
//     hệ thống: nếu tầng khác (ví dụ `refundPayment` KHÔNG chép `orderItemId` sang bút toán hoàn) tính ra đầu vào lệch, thì đó mới là
//     chỗ bug nằm.
//   · Mỗi kịch bản tự dựng cơ sở + đơn vị + người + chính sách riêng (luật 18); dữ liệu mang tiền tố để dọn theo tiền tố.
//   · Sổ hoa hồng BẤT BIẾN (trigger cấm DELETE) và `Payment` bị khoá `Restrict`, nên fixture của sổ KHÔNG dọn được bằng xoá. Dọn bằng
//     cách VÔ HIỆU HOÁ chính sách của kịch bản (`CANCELLED`) để nó không lọt vào ngữ cảnh của bộ test khác.
//   · Ngày của khoản thu là ngày TUYỆT ĐỐI (luật 19). RIÊNG bút toán hoàn: `refundPayment` đặt `paidDate = now()` (đồng hồ thật) nên
//     `datNgayBut()` ghim lại sang ngày tuyệt đối — đó là sửa dấu thời gian của fixture do hàm thật tạo ra, không đổi logic nào.
import { resolveActorUncached } from "../../lib/auth/actor";
import type { NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
import { db } from "../../lib/db";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { adjustPayment, confirmPayment, recordPayment, refundPayment, rejectPayment } from "../../lib/finance/payment";
import { dungBoiCanhTuMoc, type BoiCanhQuet } from "../../lib/hoa-hong/boi-canh";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";

export const D = (s: string) => new Date(`${s}T03:00:00.000Z`);

let dem = 0;
export const maMoi = (tien: string) => `${tien}${Date.now().toString(36)}-${(dem += 1)}`;

export type LoaiRule = "PERCENT" | "EXCLUDE" | "FIXED_PER_PURCHASE";
export type RuleFx = { vai: string; rate?: number; /** `FIXED_PER_PURCHASE`: số tiền cố định theo LẦN MUA (VND). */ tien?: number; loai?: "NEW" | "RENEWAL"; kieu?: LoaiRule; phamVi?: "GLOBAL" | "SOURCE_GROUP"; nhomId?: string };

export const SEED_V1: RuleFx[] = [
  { vai: "SALE", rate: 0.04 },
  { vai: "SALE_ADMIN", rate: 0.01 },
  { vai: "CENTER_MANAGER", rate: 0.02 },
  { vai: "MARKETING", rate: 0.01 },
  { vai: "TRIAL_TEACHER", rate: 0.01 },
];

export type KichBan = Awaited<ReturnType<typeof dungKichBan>>;

export async function dungKichBan(tien: string, p: { rules?: RuleFx[]; coLead?: boolean; qlcs?: boolean; qc?: boolean } = {}) {
  const ma = maMoi(tien);
  const centerId = `${ma}-cs`;
  await db.center.create({ data: { id: centerId, name: `CS ${ma}`, slug: `${ma}-cs`, address: "x" } });
  const ou = await db.orgUnit.create({ data: { id: `${ma}-ou`, code: `${ma}-OU`.toUpperCase(), name: `ĐV ${ma}`, type: "CENTER", centerId, path: `/${ma}-ou/`, depth: 1 } });

  const nv = (ten: string) => seedUser({ email: `${ma}-${ten}@ci.test`, role: "SALES_CSM", name: `${ma}-${ten}`, phone: null });
  const [sale, saleAdmin, ketToanA, ketToanB, qlcs, qc, qc2] = await Promise.all([nv("sale"), nv("admin"), nv("kt-a"), nv("kt-b"), nv("ql"), nv("qc"), nv("qc2")]);

  const phanCong = (userId: string, role: "QL_TT" | "QC") =>
    db.centerCommissionAssignee.create({ data: { centerId, role, userId, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: ma } });
  if (p.qlcs !== false) await phanCong(qlcs.id, "QL_TT");
  if (p.qc !== false) await phanCong(qc.id, "QC");

  const lead =
    p.coLead === false
      ? null
      : await db.lead.create({ data: { parentName: `${ma}-ph`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "DA_DANG_KY", convertedById: sale.id, adminId: saleAdmin.id, centerId } });

  const khoa = await db.course.create({ data: { id: `${ma}-khoa`, name: `Sata 3 ${ma}`, slug: `${ma}-sata3`, totalSessions: 48 } });
  const lop = await db.class.create({ data: { id: `${ma}-lop`, name: `Lớp ${ma}`, courseId: khoa.id, centerId } });

  const chinhSach = await taoChinhSachFx(ma, p.rules ?? SEED_V1);

  return { ma, centerId, ouId: ou.id, ouPath: ou.path!, sale, saleAdmin, ketToanA, ketToanB, qlcs, qc, qc2, lead, khoa, lop, chinhSach, chinhSachThem: [] as string[] };
}

/** Chính sách ACTIVE phạm vi GLOBAL do KỊCH BẢN sở hữu — tạo thẳng bằng Prisma (bỏ qua 15 ngày làm việc; guardrail đã có bộ test riêng). */
export type PhamViFx = { loai: "GLOBAL" } | { loai: "SOURCE_GROUP"; sourceGroupId: string };

export async function taoChinhSachFx(
  ma: string,
  rules: RuleFx[],
  versionNo = 1,
  policyId?: string,
  hieuLucTu = "2026-03-20T17:00:00.000Z",
  phamVi: PhamViFx = { loai: "GLOBAL" },
  hauTo = "",
) {
  const vai = new Map((await db.beneficiaryRole.findMany({ select: { id: true, code: true } })).map((v) => [v.code, v.id]));
  const doc = await db.regulationDocument.create({
    data: { documentCode: `${ma}${hauTo}-vb${versionNo}`, title: "Quy định fixture", issuedOn: D("2026-02-20"), publishedOn: D("2026-02-20"), effectiveOn: D("2026-03-20"), approvedByName: "fixture" },
  });
  const pol = policyId
    ? await db.commissionPolicy.findUniqueOrThrow({ where: { id: policyId } })
    : await db.commissionPolicy.create({ data: { policyCode: `${ma}-pol${hauTo}`, name: `CS ${ma}${hauTo}` } });
  const ver = await db.commissionPolicyVersion.create({
    data: {
      policyId: pol.id,
      versionNo,
      status: "ACTIVE",
      effectiveFrom: new Date(hieuLucTu),
      reason: "fixture",
      documentId: doc.id,
      scopeType: phamVi.loai,
      scopeKey: phamVi.loai === "GLOBAL" ? "GLOBAL" : `SOURCE_GROUP:${phamVi.sourceGroupId}`,
      scopeSourceGroupId: phamVi.loai === "SOURCE_GROUP" ? phamVi.sourceGroupId : null,
      activatedAt: D("2026-03-20"),
    },
  });
  // Version mới ĐÓNG bản trước tại `effectiveFrom` của nó (biên MỞ) — như `kichHoat` thật; không thì hai version cùng hiệu lực ⇒ CHONG_LAN.
  if (policyId) {
    await db.commissionPolicyVersion.updateMany({
      where: { policyId, versionNo: { lt: versionNo }, status: "ACTIVE" },
      data: { status: "SUPERSEDED", effectiveTo: new Date(hieuLucTu) },
    });
  }
  await db.commissionRule.createMany({
    data: rules.map((r) => ({
      versionId: ver.id,
      transactionTypeCode: r.loai ?? "NEW",
      beneficiaryRoleId: vai.get(r.vai)!,
      revenueComponent: "TUITION" as const,
      calcKind: r.kieu ?? "PERCENT",
      rate: (r.kieu ?? "PERCENT") === "PERCENT" ? r.rate! : null,
      fixedAmount: r.kieu === "FIXED_PER_PURCHASE" ? r.tien! : null,
    })),
  });
  return { policyId: pol.id, policyCode: pol.policyCode, versionId: ver.id };
}

/** Vô hiệu hoá chính sách của kịch bản (không xoá được: sổ tham chiếu `Restrict`) để nó không lọt vào bối cảnh của bộ khác. */
export async function huyChinhSach(policyCode: string | readonly string[]) {
  const codes = typeof policyCode === "string" ? [policyCode] : [...policyCode];
  await db.commissionPolicyVersion.updateMany({ where: { policy: { policyCode: { in: codes } } }, data: { status: "CANCELLED" } });
}

/**
 * Dọn SAU kịch bản: huỷ mọi chính sách của ca VÀ gỡ đơn vị cơ sở của ca khỏi cây (soft delete).
 * Vì sao phải gỡ OrgUnit: guardrail kích hoạt (`coSoTrongPhamVi`) liệt kê MỌI OrgUnit loại CENTER trong phạm vi chính sách —
 * cơ sở mồ côi từ bộ này (không ai phụ trách) làm `THIEU_NGUOI_PHU_TRACH` cho bộ chính-sách/seed chạy SAU (luật 18).
 * Sổ cái bất biến nên không xoá cứng được cơ sở (FK) — soft delete là đường duy nhất.
 */
export async function donKichBan(ks: readonly KichBan[]) {
  for (const k of ks) await huyChinhSach([k.chinhSach.policyCode, ...k.chinhSachThem]);
  await db.orgUnit.updateMany({ where: { id: { in: ks.map((k) => `${k.ma}-ou`) } }, data: { deletedAt: new Date() } });
  await donSoCai();
  // Chính sách của kịch bản: có thể XOÁ sau khi sổ đã dọn (FK Restrict từ sổ là lý do `huyChinhSach` chỉ huỷ). Bản phạm vi NHÓM NGUỒN giữ `scopeSourceGroupId`
  // (FK Restrict) nên nếu để lại thì bộ lead-intake xoá `LeadSourceGroup` sẽ nổ.
  const maCs = ks.flatMap((k) => [k.chinhSach.policyCode, ...k.chinhSachThem]);
  const phienBan = await db.commissionPolicyVersion.findMany({ where: { policy: { policyCode: { in: maCs } } }, select: { id: true, documentId: true } });
  await db.commissionPolicyVersion.deleteMany({ where: { id: { in: phienBan.map((v) => v.id) } } }); // quy tắc xoá theo (Cascade)
  await db.commissionPolicy.deleteMany({ where: { policyCode: { in: maCs } } });
  await db.regulationDocument.deleteMany({ where: { id: { in: phienBan.map((v) => v.documentId).filter((x): x is string => !!x) } } });
  // Nguồn của lead kịch bản (`ganNguon`): bộ lead-intake xoá cả `LeadSourceGroup`, mà `LeadAttribution.groupId` là FK Restrict ⇒ nguồn mồ côi làm đỏ bộ ấy chạy SAU.
  const leadIds = ks.map((k) => k.lead?.id).filter((x): x is string => !!x);
  if (leadIds.length > 0) {
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: leadIds } } });
    await db.leadAttribution.deleteMany({ where: { leadId: { in: leadIds } } });
  }
}

/**
 * Dọn SỔ CÁI của DB TEST sau một tệp spec. Sổ bất biến (trigger chặn UPDATE/DELETE theo dòng) nên cách dọn DUY NHẤT là xoá cả bảng bằng lệnh cắt-bảng (TRUNCATE) —
 * trigger theo dòng không chạy với nó. Vì sao phải dọn: `CommissionTransaction.attributionId` là FK Restrict sang `LeadAttribution`, nên dòng sổ mồ côi làm bộ lead-intake
 * (xoá nguồn / nhóm nguồn) ĐỎ khi chạy SAU bộ này trên cùng DB — CI chạy lead-intake trước nên không thấy, máy dev chạy theo thứ tự nào cũng được (luật 18).
 * Chỉ chạm 6 bảng của sổ; `assertTestDb()` chặn mọi DB không phải `satarobo_test` / `ci_test`.
 */
export async function donSoCai(): Promise<void> {
  assertTestDb();
  await db.$executeRaw`TRUNCATE "CommissionTransaction", "CommissionHold", "CommissionCalcSlot", "CommissionPayoutBatch", "StudentTransaction", "CommissionPeriod" CASCADE`;
}

/** Thêm một chính sách phạm vi NHÓM NGUỒN cho kịch bản (ngoài chính sách GLOBAL mặc định). */
export async function themChinhSachNhom(k: KichBan, nhomCode: string, rules: RuleFx[]) {
  const nhom = await db.leadSourceGroup.findFirstOrThrow({ where: { code: nhomCode }, select: { id: true } });
  const r = await taoChinhSachFx(k.ma, rules, 1, undefined, "2026-03-20T17:00:00.000Z", { loai: "SOURCE_GROUP", sourceGroupId: nhom.id }, `-${nhomCode.toLowerCase()}`);
  k.chinhSachThem.push(r.policyCode);
  return { ...r, nhomId: nhom.id };
}

/** Mốc cutover — ghi thẳng `SystemSetting` (đường `datMocCutover` có cổng là PR5c, không dùng ở đây). */
export async function datMocCutover(thang: string | null) {
  if (thang === null) await db.systemSetting.deleteMany({ where: { key: "hoaHong.kyCutover" } });
  else
    await db.systemSetting.upsert({
      where: { key: "hoaHong.kyCutover" },
      update: { valueJson: thang },
      create: { key: "hoaHong.kyCutover", valueJson: thang },
    });
}

/** Bối cảnh quét CHỈ gồm chính sách của kịch bản (rule lạ còn sót từ bộ khác không được lọt vào — GLOBAL áp cho mọi thứ). */
export async function boiCanh(k: Pick<KichBan, "chinhSach" | "chinhSachThem">, now: Date, kyCutover = "2026-10", extra: Partial<BoiCanhQuet> = {}): Promise<BoiCanhQuet> {
  const bc = await dungBoiCanhTuMoc(db, now, kyCutover);
  const codes = new Set([k.chinhSach.policyCode, ...k.chinhSachThem]);
  return { ...bc, hoaHong: { ...bc.hoaHong, quyTac: bc.hoaHong.quyTac.filter((q) => codes.has(q.policyCode)) }, ...extra };
}

export type Be = { studentId: string; enrollmentId: string; orderId: string; orderItemId: string };

/** Một bé + ghi danh + đơn + MỘT dòng học phí (hình dạng sau convert-lead). */
export async function dungBe(
  k: KichBan,
  ten: string,
  p: { tongTien?: number; ngayDon?: Date; donSan?: string; leadChildId?: string | null; coLead?: boolean } = {},
): Promise<Be> {
  const id = `${k.ma}-${ten}`;
  const student = await db.student.create({ data: { id: `${id}-hv`, name: `Bé ${ten} ${k.ma}`, centerId: k.centerId, leadId: k.lead?.id ?? null, parentPhone: k.lead?.phone ?? null } });
  const enr = await db.enrollment.create({
    data: { id: `${id}-gd`, studentId: student.id, classId: k.lop.id, courseId: k.khoa.id, centerId: k.centerId, status: "ACTIVE", createdAt: p.ngayDon ?? D("2026-09-01") },
  });
  const orderId =
    p.donSan ??
    (
      await db.order.create({
        data: {
          id: `${id}-don`,
          code: `${id}-don`.toUpperCase(),
          type: "COURSE",
          status: "CONFIRMED",
          customerName: "PH",
          customerPhone: k.lead?.phone ?? "0990000001",
          totalAmount: p.tongTien ?? 10_000_000,
          centerId: k.centerId,
          leadId: p.coLead === false ? null : (k.lead?.id ?? null),
          leadChildId: p.leadChildId ?? null,
          createdAt: p.ngayDon ?? D("2026-09-01"),
        },
      })
    ).id;
  const item = await db.orderItem.create({
    data: {
      id: `${id}-oi`,
      orderId,
      type: "COURSE_ENROLLMENT",
      itemName: `Học phí ${ten}`,
      quantity: 1,
      unitPrice: p.tongTien ?? 10_000_000,
      totalPrice: p.tongTien ?? 10_000_000,
      studentId: student.id,
      enrollmentId: enr.id,
      createdAt: p.ngayDon ?? D("2026-09-01"),
    },
  });
  return { studentId: student.id, enrollmentId: enr.id, orderId, orderItemId: item.id };
}

/** Khoản thu ĐÃ XÁC NHẬN bằng hàm thật. Gắn dòng đơn `orderItemId` (hạt công nợ theo con) nếu có. */
export async function tienVe(
  k: KichBan,
  be: Be,
  p: { soTien: number; ngay: Date; gan?: boolean; xacNhan?: boolean },
): Promise<string> {
  const r = await recordPayment({
    orderId: be.orderId,
    enrollmentId: be.enrollmentId,
    amount: p.soTien,
    method: "cash",
    paidDate: p.ngay,
    recordedById: k.ketToanA.id,
    centerId: k.centerId,
  });
  if (!r.ok) throw new Error(`recordPayment: ${r.error}`);
  if (p.gan !== false) await db.payment.update({ where: { id: r.paymentId }, data: { orderItemId: be.orderItemId } });
  if (p.xacNhan !== false) {
    const c = await confirmPayment({ paymentId: r.paymentId, confirmedById: k.ketToanB.id });
    if (!c.ok) throw new Error(`confirmPayment: ${c.error}`);
  }
  return r.paymentId;
}

/** Hoàn tiền bằng `refundPayment` thật (KHÔNG chép `orderItemId`!), rồi ghim `paidDate` sang ngày tuyệt đối. */
export async function hoanTien(k: KichBan, paymentId: string, p: { soTien: number; ngay: Date }): Promise<string> {
  const r = await refundPayment({ paymentId, confirmedById: k.ketToanB.id, reason: "hoàn fixture", amount: p.soTien });
  if (!r.ok) throw new Error(`refundPayment: ${r.error}`);
  await db.payment.update({ where: { id: r.refundId }, data: { paidDate: p.ngay, confirmedAt: p.ngay } });
  return r.refundId;
}

/** Điều chỉnh bằng `adjustPayment` thật: `soDung` là số đúng cuối cùng của DÒNG này. Trả id bút toán điều chỉnh (DELTA). */
export async function dieuChinh(k: KichBan, paymentId: string, soDung: number): Promise<string> {
  const r = await adjustPayment({ paymentId, correctAmount: soDung, reason: "sửa số fixture", actorId: k.ketToanB.id });
  if (!r.ok) throw new Error(`adjustPayment: ${r.error}`);
  return r.adjustmentId;
}

export async function tuChoi(k: KichBan, paymentId: string): Promise<void> {
  const r = await rejectPayment({ paymentId, confirmedById: k.ketToanB.id, reason: "từ chối fixture" });
  if (!r.ok) throw new Error(`rejectPayment: ${r.error}`);
}

/** Đếm dòng sổ theo vai/kind của một khoản — đọc THẲNG bảng sổ (không qua hàm của engine). */
export async function dongSoCuaKhoan(paymentId: string) {
  return db.commissionTransaction.findMany({ where: { paymentId }, orderBy: [{ roleCode: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
}

export const tomTat = (rows: { roleCode: string; amount: number; beneficiaryUserId: string | null }[]) =>
  Object.fromEntries(rows.map((r) => [`${r.roleCode}:${r.beneficiaryUserId}`, r.amount]));

// ── Bổ sung cho bộ kỳ / hàng chờ / quyền ──────────────────────────────────────────────────────


/** GV Trial thật: LeadChild + lớp + buổi + ghi danh trải nghiệm + điểm danh CÓ MẶT (điều kiện cứng của `findAttendedTrialForLeadChild`). */
export async function themGvTrial(k: KichBan, gvUserId: string, ten = "gv"): Promise<string> {
  if (!k.lead) throw new Error("themGvTrial cần kịch bản có lead");
  const be = await db.leadChild.create({ data: { leadId: k.lead.id, fullName: `Bé trial ${ten} ${k.ma}` } });
  const lop = await db.trialClassV2.create({
    data: { code: `${k.ma}-tc-${ten}`, name: `Lớp trial ${ten} ${k.ma}`, centerId: k.centerId, teacherId: gvUserId, sessionCount: 1, startDate: D("2026-09-20") },
  });
  const buoi = await db.trialClassSession.create({ data: { trialClassId: lop.id, seq: 1, date: D("2026-09-20"), startTime: "09:00", endTime: "10:30", teacherId: gvUserId } });
  const ghiDanh = await db.trialEnrollment.create({ data: { trialClassId: lop.id, leadChildId: be.id } });
  await db.trialAttendance.create({ data: { trialSessionId: buoi.id, trialEnrollmentId: ghiDanh.id, status: "PRESENT" } });
  return be.id;
}

/** Gán vai thật cho một người tại một đơn vị (nguồn quyền của `resolveActorUncached` — RBAC v2 đọc DB). */
export async function ganVai(userId: string, orgUnitId: string, roleCode: string): Promise<void> {
  const v = await db.roleDef.findUniqueOrThrow({ where: { code: roleCode }, select: { id: true } });
  // effectiveFrom TUYỆT ĐỐI trong quá khứ: mặc định là `now()` của Postgres, mà `resolveActorUncached` lọc `effectiveFrom <= new Date()` (đồng hồ Node). Trên Windows hai đồng hồ
  // lệch nhau dưới 1ms ⇒ vai "chưa hiệu lực" ngay sau khi gán ⇒ actor thấy 0 cơ sở, ca đỏ NGẪU NHIÊN (đo 08/10: PER-06 đỏ 2/3 lượt, cô lập thì xanh).
  await db.userOrgRole.create({ data: { userId, orgUnitId, roleId: v.id, grantedById: userId, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
}

export const actorCua = (userId: string) => resolveActorUncached(userId);

/** OrgUnit Hội sở (type HO) của DB test — cho vai cross-center. */
export async function donViHoiSo(): Promise<string> {
  const ho = await db.orgUnit.findFirstOrThrow({ where: { code: "HO", deletedAt: null }, select: { id: true } });
  return ho.id;
}

/** Quy nguồn cho lead của kịch bản bằng hàm GHI THẬT của lib/nguon (`taoNguonBanDau`). */
export async function ganNguon(
  k: KichBan,
  nhomCode: string,
  p: { phHuynhUserId?: string; nhanSuEmployeeId?: string; attributedAt?: Date; saleUserId?: string; vai?: string } = {},
): Promise<void> {
  if (!k.lead) throw new Error("ganNguon cần kịch bản có lead");
  const nhom = await db.leadSourceGroup.findFirstOrThrow({ where: { code: nhomCode }, select: { id: true } });
  const kind = p.phHuynhUserId ? "PARENT" : p.nhanSuEmployeeId ? "EMPLOYEE" : null;
  await db.$transaction((tx) =>
    taoNguonBanDau(
      tx,
      k.lead!.id,
      {
        groupId: nhom.id,
        otherSourceNote: null,
        referrerKind: kind,
        referrerEmployeeId: p.nhanSuEmployeeId ?? null,
        referrerParentUserId: p.phHuynhUserId ?? null,
        referrerStudentId: null,
        referrerAffiliateId: null,
        referrerMissing: false,
        referrerRoleCode: p.vai ?? null,
        referrerSaleUserId: p.saleUserId ?? null,
        identificationMethod: kind === "PARENT" ? "PARENT_REFERRAL" : kind === "EMPLOYEE" ? "EMPLOYEE_REFERRAL" : nhomCode === "PAID_ADS" ? "AD_FORM_CAMPAIGN" : nhomCode === "UNKNOWN" ? "UNKNOWN" : "MANUAL",
        matchedRule: "FIXTURE",
        reasonText: `fixture ${nhomCode}`,
        canhBao: [],
        originalGroupId: nhom.id,
        inheritedFromLeadId: null,
        conversionEntry: "facebook",
        signals: null,
        attributedAt: p.attributedAt ?? null,
      },
      null,
    ),
  );
}

/**
 * Người thao tác KỲ ở tầng Hội sở: Kế toán HO thật (RBAC v2 đọc DB: `UserOrgRole` tại HO ⇒ `isHoLevel` ⇒ thấy/ghi mọi cơ sở). `quyen` là Actor
 * ĐÃ resolve — `passesScope` của dịch vụ kỳ chạy trên chính nó. Tạo một lần mỗi tệp test.
 */
let nguoiHoDaDung: Promise<NguoiThaoTacKy> | null = null;
export function nguoiKyHo(): Promise<NguoiThaoTacKy> {
  nguoiHoDaDung ??= (async () => {
    const u = await seedUser({ email: `fx-nhh-ho-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Kế toán HO fixture", phone: null });
    await ganVai(u.id, await donViHoiSo(), "HO_ACCOUNTANT");
    return { userId: u.id, ten: "Kế toán HO fixture", quyen: await actorCua(u.id) };
  })();
  return nguoiHoDaDung;
}

/** Người thao tác kỳ là QLCS của một kịch bản (neo tại ĐÚNG đơn vị của cơ sở ấy, vai CENTER_MANAGER). */
export async function nguoiKyQlcs(k: KichBan): Promise<NguoiThaoTacKy> {
  await ganVai(k.qlcs.id, k.ouId, "CENTER_MANAGER");
  return { userId: k.qlcs.id, ten: `QLCS ${k.ma}`, quyen: await actorCua(k.qlcs.id) };
}

/** Biến một người dùng thành NHÂN VIÊN nội bộ (có `Employee` + `User.employeeId`): điều kiện để dòng sổ của họ vào lô PAYROLL. Gọi TRƯỚC khi quét. */
export async function lamNhanVien(userId: string, ma: string): Promise<string> {
  const e = await db.employee.create({
    data: { employeeCode: `EM${userId.slice(-14)}`.toUpperCase(), fullName: `NV ${ma}`, jobTitle: "Nhân viên", department: "KINH_DOANH", status: "ACTIVE" },
  });
  await db.user.update({ where: { id: userId }, data: { employeeId: e.id } });
  return e.id;
}
