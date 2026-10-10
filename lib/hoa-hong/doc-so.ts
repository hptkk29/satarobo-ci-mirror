// lib/hoa-hong/doc-so.ts — ĐỌC sổ hoa hồng cho người xem: `docSoHoaHong` (MỘT hàm đọc duy nhất) và `duKienCuaToi`.
//
// Nguồn: docs/source-commission/02 §11.1 ("Đọc của chính mình — KHÔNG qua scopedDb"), 04 §16, 05 §1.4 + SEC-04..SEC-07.
//
// ── Vì sao có luật đọc riêng ──────────────────────────────────────────────────────────────────────────────
// `centerId` của dòng sổ là cơ sở của GIAO DỊCH, không phải của người hưởng. Sale neo CS1 có `centerScope = [CS1]` nên `scopedDb`
// LỌC MẤT dòng CS2 của chính họ ("lead CS1, đơn CS2" — COM-10). Nên:
//
//   chỉ `commission:view-self`    → `db` KHÔNG scope, `where` KHOÁ CỨNG `beneficiaryUserId = actor.userId`; `boLoc.nguoiHuong` của người khác bị
//                                   ÉP về chính mình — không ném lỗi (không lộ "người đó có tồn tại / có dòng không").
//   có `commission:view-center`   → tầm nhìn cơ sở theo `getModelVisibleCenterIds` (cùng nguồn với `scopedDb`).
//   có CẢ HAI                     → HỢP hai tập: của mình ở mọi cơ sở ∪ mọi người ở cơ sở mình quản.
//
// Hàm này nằm ở `lib/hoa-hong/**` (ngoài `app/**`) nên cổng ESLint "cấm import db trần" không soi — đúng ý đặc tả. Nhưng nó cũng nghĩa là KHÔNG
// có lưới nào khác canh: ca `[NHH-SEC-04*]` (Postgres thật, có đối chứng dương) là lưới duy nhất.
//
// ⚠️ KHÔNG kiểm quyền "được vào màn hình" — action PR9 `assertCan` ở đầu hàm. Hàm này kiểm lại bằng `can()` chỉ để chọn NHÁNH đọc, và đóng
// cửa (ném `PermissionError`) nếu actor không có cả hai key: fail-closed.
import type { CommissionPayoutStatus, Prisma, PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { can, PermissionError } from "@/lib/auth/can";
import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { getModelVisibleCenterIds } from "@/lib/db-scope";

import type { BoiCanhQuet } from "./boi-canh";
import { dungDauVaoChinhSach } from "./dau-vao-chinh-sach";
import { ngayVN } from "./ngay-lam-viec";
import { phaiThuCuaDong } from "./nap-khoan";
import { phanLoaiDongDon } from "./phan-loai-giao-dich-db";
import { tachVat, vatHieuLuc } from "./tien";
import { tinhDongChoKhoan } from "./tinh-dong-cho-khoan";
import { dungViSao, type ViSao } from "./vi-sao";

export const KEY_XEM_RIENG = "commission:view-self";
export const KEY_XEM_CO_SO = "commission:view-center";

export type BoLocSo = {
  thang?: string;
  centerId?: string;
  /** Người hưởng muốn xem — CHỈ có hiệu lực khi actor có `view-center`; ngược lại bị ép về chính actor. */
  nguoiHuong?: string;
  roleCode?: string;
  /** `LeadSourceGroup.code` ghi trên dòng (ảnh chụp lúc tính). */
  nhomNguon?: string;
  /** `NEW` | `RENEWAL` | … (ảnh chụp lúc tính). */
  loaiGiaoDich?: string;
  trangThaiChi?: CommissionPayoutStatus;
  trang?: number;
  coTrang?: number;
};

export type DongSoHienThi = {
  id: string;
  kyGhi: string;
  kyHieuLuc: string;
  lateArrival: boolean;
  kind: string;
  paymentId: string | null;
  orderId: string | null;
  studentId: string | null;
  leadId: string | null;
  roleCode: string;
  nguoiHuong: { kind: "USER" | "AFFILIATE"; id: string; ten: string };
  amount: number;
  grossAmount: number;
  netBase: number;
  vatRate: number;
  rate: number | null;
  nhomNguon: string;
  /** Tên nhóm nguồn hôm nay — chỉ để HIỂN THỊ; mã ở `nhomNguon` mới là ảnh chụp. */
  tenNhomNguon: string;
  tenVai: string;
  /** Số hiệu văn bản + phiên bản ghi trên dòng; null với dòng không đi qua chính sách (PERIOD_BONUS, LEGACY). */
  vanBan: string | null;
  versionNo: number | null;
  loaiGiaoDich: string;
  lyDo: string;
  maLyDo: string | null;
  centerId: string;
  payoutStatus: CommissionPayoutStatus;
  refEntryId: string | null;
  taoLuc: Date;
};

export type KetQuaDocSo = { dong: DongSoHienThi[]; tongSo: number; tongTien: number; trang: number; coTrang: number };

type Khach = PrismaClient | Prisma.TransactionClient;

const COT_HIEN_THI = {
  id: true,
  period: { select: { period: true } },
  naturalPeriod: true,
  lateArrival: true,
  entryKind: true,
  paymentId: true,
  orderId: true,
  studentId: true,
  leadId: true,
  roleCode: true,
  beneficiaryKind: true,
  beneficiaryUserId: true,
  beneficiaryAffiliateId: true,
  beneficiaryName: true,
  amount: true,
  grossAmount: true,
  netBase: true,
  vatRate: true,
  rate: true,
  sourceGroupCode: true,
  sourceGroup: { select: { name: true } },
  beneficiaryRole: { select: { name: true } },
  documentNumber: true,
  versionNo: true,
  transactionTypeCode: true,
  reason: true,
  reasonCode: true,
  centerId: true,
  payoutStatus: true,
  refEntryId: true,
  createdAt: true,
} satisfies Prisma.CommissionTransactionSelect;

type DongTho = Prisma.CommissionTransactionGetPayload<{ select: typeof COT_HIEN_THI }>;

function anhXa(d: DongTho): DongSoHienThi {
  const kind = d.beneficiaryKind;
  return {
    id: d.id,
    kyGhi: d.period.period,
    kyHieuLuc: d.naturalPeriod,
    lateArrival: d.lateArrival,
    kind: d.entryKind,
    paymentId: d.paymentId,
    orderId: d.orderId,
    studentId: d.studentId,
    leadId: d.leadId,
    roleCode: d.roleCode,
    nguoiHuong: { kind, id: (kind === "USER" ? d.beneficiaryUserId : d.beneficiaryAffiliateId) ?? "-", ten: d.beneficiaryName },
    amount: d.amount,
    grossAmount: d.grossAmount,
    netBase: d.netBase,
    vatRate: Number(d.vatRate),
    rate: d.rate === null ? null : Number(d.rate),
    nhomNguon: d.sourceGroupCode,
    tenNhomNguon: d.sourceGroup.name,
    tenVai: d.beneficiaryRole.name,
    vanBan: d.documentNumber,
    versionNo: d.versionNo,
    loaiGiaoDich: d.transactionTypeCode,
    lyDo: d.reason,
    maLyDo: d.reasonCode,
    centerId: d.centerId,
    payoutStatus: d.payoutStatus,
    refEntryId: d.refEntryId,
    taoLuc: d.createdAt,
  };
}

/**
 * MỘT hàm đọc sổ. Giao diện (tab Sổ), báo cáo và site GV (PR12) đều gọi hàm này — không ai dựng câu truy vấn thứ hai (luật 12b).
 */
/**
 * PHẠM VI NGƯỜI XEM — MỘT nơi duy nhất (HỢP của hai tập). `docSoHoaHong` và `docViSao` cùng dùng: ngăn "Vì sao" mà tự dựng phạm vi riêng là cửa thứ hai để
 * đọc dòng của người khác. Tầm nhìn "ALL" (vai neo Hội sở) = KHÔNG giới hạn — viết thẳng, không `OR: [.., {}]` (một nhánh `{}` trong `OR` dễ bị đọc nhầm).
 * Ném `PermissionError` khi actor không có cả hai key (fail-closed).
 */
export function phamViNguoiXem(actor: Actor): { xemCoSo: boolean; tamCoSo: "ALL" | readonly string[] | null; dieuKien: Prisma.CommissionTransactionWhereInput[] } {
  const xemRieng = can(actor, KEY_XEM_RIENG);
  const xemCoSo = can(actor, KEY_XEM_CO_SO);
  if (!xemRieng && !xemCoSo) throw new PermissionError();
  const dieuKien: Prisma.CommissionTransactionWhereInput[] = [];
  const cs = xemCoSo ? getModelVisibleCenterIds("CommissionTransaction", actor) : null;
  if (cs !== "ALL") {
    const phamVi: Prisma.CommissionTransactionWhereInput[] = [];
    if (xemRieng) phamVi.push({ beneficiaryUserId: actor.userId });
    if (cs !== null) phamVi.push({ centerId: { in: cs } });
    dieuKien.push({ OR: phamVi });
  }
  return { xemCoSo, tamCoSo: cs, dieuKien };
}

/**
 * Có được in TỔNG tỉ lệ các vai của một dòng không: chỉ người có tầm nhìn cơ sở ĐÚNG cơ sở của dòng (hoặc Hội sở). MỘT hàm cho `docViSao` và
 * `docViSaoDayDu` — hai nơi tự viết điều kiện này là hai nơi có thể lộ tiền của vai khác (NHH-SEC-09).
 */
export function duocXemTongTiLe(tamCoSo: "ALL" | readonly string[] | null, centerId: string): boolean {
  return tamCoSo === "ALL" || (tamCoSo !== null && tamCoSo.includes(centerId));
}

export async function docSoHoaHong(client: Khach, actor: Actor, boLoc: BoLocSo): Promise<KetQuaDocSo> {
  const { xemCoSo, dieuKien } = phamViNguoiXem(actor);

  // `nguoiHuong` của người khác: chỉ người có `view-center` mới được chọn; ngược lại ÉP về chính mình (không ném lỗi).
  const nguoiHuong = xemCoSo ? boLoc.nguoiHuong : actor.userId;
  if (nguoiHuong) dieuKien.push({ beneficiaryUserId: nguoiHuong });
  if (boLoc.thang) dieuKien.push({ period: { period: boLoc.thang } });
  if (boLoc.centerId) dieuKien.push({ centerId: boLoc.centerId });
  if (boLoc.roleCode) dieuKien.push({ roleCode: boLoc.roleCode });
  if (boLoc.nhomNguon) dieuKien.push({ sourceGroupCode: boLoc.nhomNguon });
  if (boLoc.loaiGiaoDich) dieuKien.push({ transactionTypeCode: boLoc.loaiGiaoDich });
  if (boLoc.trangThaiChi) dieuKien.push({ payoutStatus: boLoc.trangThaiChi });

  const where: Prisma.CommissionTransactionWhereInput = { AND: dieuKien };
  const coTrang = Math.min(Math.max(boLoc.coTrang ?? 50, 1), 200);
  const trang = Math.max(boLoc.trang ?? 1, 1);
  const [rows, tong] = await Promise.all([
    client.commissionTransaction.findMany({
      where,
      select: COT_HIEN_THI,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (trang - 1) * coTrang,
      take: coTrang,
    }),
    client.commissionTransaction.aggregate({ where, _count: { _all: true }, _sum: { amount: true } }),
  ]);
  return { dong: rows.map(anhXa), tongSo: tong._count._all, tongTien: tong._sum.amount ?? 0, trang, coTrang };
}

// ── "Hoa hồng dự kiến của bạn" (04 §16) ──────────────────────────────────────────────────────────

export type DongDuKien = { orderItemId: string; roleCode: string; soTien: number; lyDo: string };

export type KetQuaDuKien = {
  daGhiCuaToi: DongSoHienThi[];
  duKienCuaToi: DongDuKien[];
  giaDinh: string[];
  /**
   * Những chỗ KHÔNG tính được dự kiến, mỗi chỗ một lý do bằng chữ (06 §5.6: "chưa tính được ⇒ 'Chưa thể tính' + lý do, không '0đ'"). Có cấu trúc để màn
   * không phải đọc `giaDinh` (vốn trộn lẫn lời giả định với lời báo lỗi). `orderItemId = null` khi vấn đề nằm ở cả đơn.
   */
  chuaTinhDuoc: { orderItemId: string | null; lyDo: string }[];
};

/**
 * Hoa hồng ĐÃ GHI và DỰ KIẾN của CHÍNH actor trên một lead / một đơn. Người có `view-center` cũng chỉ thấy phần CỦA MÌNH ở đây: trừ tổng ra là
 * đoán được tiền của vai khác (`06` §3). Dự kiến = chạy ĐÚNG `tinhDongChoKhoan` trên phần học phí còn phải thu, rồi LỌC lấy dòng của actor ở server.
 *
 * Giả định in rõ: chính sách & VAT HÔM NAY, giả định thu đủ phần còn lại, có thể đổi khi hoàn / đổi nguồn.
 */
export async function duKienCuaToi(
  client: Khach,
  bc: BoiCanhQuet,
  actor: Actor,
  i: { leadId?: string; orderId?: string },
): Promise<KetQuaDuKien> {
  if (!can(actor, KEY_XEM_RIENG)) throw new PermissionError();
  if (!i.leadId && !i.orderId) throw new Error("duKienCuaToi cần leadId hoặc orderId.");

  const don = await client.order.findMany({
    where: { ...(i.orderId ? { id: i.orderId } : { leadId: i.leadId }), status: { not: "CANCELLED" } },
    select: {
      id: true,
      type: true,
      leadId: true,
      leadChildId: true,
      centerId: true,
      items: { select: { id: true, type: true, status: true, studentId: true, enrollmentId: true, totalPrice: true, discountAmount: true, usedValue: true, enrollment: { select: { studentId: true } } } },
    },
  });
  const donIds = don.map((d) => d.id);

  // ĐÃ GHI: khoá cứng theo actor (không qua scopedDb — dòng CS2 của Sale CS1 vẫn thấy).
  const daGhi = await client.commissionTransaction.findMany({
    where: { beneficiaryUserId: actor.userId, OR: [{ orderId: { in: donIds } }, ...(i.leadId ? [{ leadId: i.leadId }] : [])] },
    select: COT_HIEN_THI,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const duKien: DongDuKien[] = [];
  const chuaTinhDuoc: KetQuaDuKien["chuaTinhDuoc"] = [];
  const giaDinh = [
    "Tính theo chính sách và VAT áp dụng HÔM NAY, giả định thu đủ phần học phí còn lại.",
    "Có thể thay đổi nếu khách hoàn tiền, đổi nguồn lead, hoặc chính sách mới có hiệu lực.",
  ];
  const vatNay = vatHieuLuc(bc.hoaHong.vatTheoNgay, ngayVN(bc.now));

  for (const o of don) {
    if (!o.centerId) {
      chuaTinhDuoc.push({ orderItemId: null, lyDo: "Đơn chưa quy được cơ sở." });
      continue;
    }
    const ou = await client.orgUnit.findFirst({ where: { centerId: o.centerId, deletedAt: null }, select: { path: true } });
    if (!ou?.path) {
      chuaTinhDuoc.push({ orderItemId: null, lyDo: "Cơ sở của đơn chưa có đơn vị trong cây tổ chức." });
      continue;
    }
    for (const dong of o.items) {
      if (dong.type !== "COURSE_ENROLLMENT" && dong.type !== "COURSE_PACKAGE") continue;
      const daThu = await client.payment.aggregate({ where: { ...WHERE_THUC_THU, orderItemId: dong.id }, _sum: { amount: true } });
      const conLai = phaiThuCuaDong(dong) - (daThu._sum.amount ?? 0);
      if (conLai <= 0) continue;
      const studentId = dong.studentId ?? dong.enrollment?.studentId ?? null;
      if (!studentId) {
        chuaTinhDuoc.push({ orderItemId: dong.id, lyDo: "Dòng học phí chưa gắn học viên." });
        continue;
      }

      const cu = await client.studentTransaction.findUnique({ where: { orderItemId: dong.id }, select: { status: true, transactionTypeCode: true } });
      let loai: "NEW" | "RENEWAL" | null = null;
      if (cu?.status === "CLASSIFIED" && (cu.transactionTypeCode === "NEW" || cu.transactionTypeCode === "RENEWAL")) loai = cu.transactionTypeCode;
      else {
        const kq = await phanLoaiDongDon(client, { orderItemId: dong.id, moc: bc.now });
        if (kq?.trangThai === "CLASSIFIED") loai = kq.loai as "NEW" | "RENEWAL";
      }
      if (!loai) {
        giaDinh.push(`Dòng ${dong.id}: chưa phân loại được NEW/RENEWAL — chưa có dự kiến.`);
        chuaTinhDuoc.push({ orderItemId: dong.id, lyDo: "Chưa phân loại được khách mới hay tái tục." });
        continue;
      }
      const sv = await client.student.findUnique({ where: { id: studentId }, select: { leadChildId: true } });
      const dv = await dungDauVaoChinhSach(client, bc, {
        leadId: o.leadId,
        leadChildId: o.leadChildId ?? sv?.leadChildId ?? null,
        studentId,
        enrollmentId: dong.enrollmentId,
        centerId: o.centerId,
        orgUnitPath: ou.path,
        rateDate: bc.now,
        assigneeDate: bc.now,
        loaiGiaoDich: loai,
        // Dự kiến cho khoản THU SẮP TỚI: ngày thu đầu của lần mua là hôm nay nếu chưa có khoản nào.
        ngayThuDau: async () => {
          const r = await client.payment.aggregate({ where: { ...WHERE_THUC_THU, orderItemId: dong.id, amount: { gt: 0 } }, _min: { paidDate: true } });
          return r._min.paidDate ?? bc.now;
        },
      });
      const kq = tinhDongChoKhoan(dv.dauVao(tachVat(conLai, vatNay).netBase));
      if (kq.loai !== "OK") {
        giaDinh.push(`Dòng ${dong.id}: cấu hình chính sách đang lỗi (${kq.loai}) — chưa có dự kiến.`);
        chuaTinhDuoc.push({ orderItemId: dong.id, lyDo: "Cấu hình chính sách đang lỗi." });
        continue;
      }
      // Lọc ở SERVER: chỉ dòng của chính actor. Tổng các vai khác không bao giờ rời hàm này.
      for (const d of kq.dong) {
        if (d.beneficiaryKind === "USER" && d.beneficiaryId === actor.userId) {
          duKien.push({ orderItemId: dong.id, roleCode: d.roleCode, soTien: d.amount, lyDo: d.lyDo });
        }
      }
    }
  }
  return { daGhiCuaToi: daGhi.map(anhXa), duKienCuaToi: duKien, giaDinh, chuaTinhDuoc };
}

// ── Ngăn "Vì sao con số này" (06 §2.3) ─────────────────────────────────────────────────────────

/**
 * "VÌ SAO" của MỘT dòng sổ — dựng từ ẢNH CHỤP nằm trên chính dòng (không đọc chính sách live). Cùng phạm vi người xem với `docSoHoaHong`
 * (`phamViNguoiXem`): dòng ngoài tầm nhìn trả `null` — KHÔNG ném lỗi riêng, để không lộ "dòng này có tồn tại".
 */
export async function docViSao(client: Khach, actor: Actor, entryId: string): Promise<ViSao | null> {
  const { tamCoSo, dieuKien } = phamViNguoiXem(actor);
  const d = await client.commissionTransaction.findFirst({
    where: { AND: [{ id: entryId }, ...dieuKien] },
    select: {
      centerId: true,
      entryKind: true,
      amount: true,
      grossAmount: true,
      vatRate: true,
      netBase: true,
      rate: true,
      fixedAmount: true,
      capRate: true,
      equivalentRate: true,
      sourceGroupCode: true,
      transactionTypeCode: true,
      roleCode: true,
      splitMethod: true,
      documentNumber: true,
      versionNo: true,
      calcKind: true,
      reason: true,
      reasonCode: true,
      naturalPeriod: true,
      period: { select: { period: true } },
      lateArrival: true,
      refEntryId: true,
      refEventType: true,
      refEventId: true,
      resolverBasis: true,
      paymentId: true,
    },
  });
  if (!d) return null;
  // Tổng tỉ lệ các vai CHỈ hiện cho người có tầm nhìn cơ sở ĐÚNG cơ sở của dòng (hoặc Hội sở). Người xem dòng qua `view-self` — kể cả QLCS xem dòng của chính mình ở cơ sở khác — không thấy.
  const hienTongTiLe = duocXemTongTiLe(tamCoSo, d.centerId);
  return dungViSao({
    entryKind: d.entryKind,
    amount: d.amount,
    grossAmount: d.grossAmount,
    vatRate: Number(d.vatRate),
    netBase: d.netBase,
    rate: d.rate === null ? null : Number(d.rate),
    fixedAmount: d.fixedAmount,
    capRate: Number(d.capRate),
    equivalentRate: Number(d.equivalentRate),
    sourceGroupCode: d.sourceGroupCode,
    transactionTypeCode: d.transactionTypeCode,
    roleCode: d.roleCode,
    splitMethod: d.splitMethod,
    documentNumber: d.documentNumber,
    versionNo: d.versionNo,
    calcKind: d.calcKind,
    reason: d.reason,
    reasonCode: d.reasonCode,
    naturalPeriod: d.naturalPeriod,
    kyGhi: d.period.period,
    lateArrival: d.lateArrival,
    refEntryId: d.refEntryId,
    refEventType: d.refEventType,
    refEventId: d.refEventId,
    resolverBasis: d.resolverBasis,
    paymentId: d.paymentId,
  }, hienTongTiLe);
}
