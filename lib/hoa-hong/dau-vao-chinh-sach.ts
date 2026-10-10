// lib/hoa-hong/dau-vao-chinh-sach.ts — DỰNG ĐẦU VÀO CHÍNH SÁCH cho MỘT phần học viên (nguồn · người hưởng · cửa sổ · GV Trial cũ).
//
// Nguồn: docs/source-commission/04 §2 bước 6–10, L11 (một hàm cho engine thật · thử tính · "dự kiến của bạn").
//
// Engine thật (`quet-khoan.ts`) và "dự kiến của bạn" (`du-kien.ts`) cùng gọi hàm này để có CÙNG đầu vào của `tinhDongChoKhoan`: nếu hai
// bên dựng riêng thì con số Sale thấy ở "dự kiến" và con số engine ghi sổ sẽ lệch nhau (luật 12b — đọc số của một chỗ, không dựng lại).
// Chỉ ĐỌC. Client KHÔNG scope (việc toàn hệ).
import { conTrongCuaSoGhiCong, cuaSoHieuLuc } from "@/lib/nguon/cua-so-ghi-cong";
import { docNguonChoHoaHong, type NguonChoHoaHong } from "@/lib/nguon/doc-nguon-hoa-hong";

import type { BoiCanhQuet } from "./boi-canh";
import { docNguCanhNguoiHuong } from "./nguoi-huong-db";
import { phanGiaiNguoiHuong, type KetQuaNguoiHuong } from "./nguoi-huong";
import type { Khach } from "./nap-khoan";
import type { NguonCuaKhoan } from "./tinh-chinh-sach";
import type { DauVaoKhoan } from "./tinh-dong-cho-khoan";

export type NenDauVao = {
  leadId: string | null;
  leadChildId: string | null;
  studentId: string;
  /** Ghi danh của dòng — để tra GV Trial đã nhận bằng engine cũ. */
  enrollmentId: string | null;
  centerId: string;
  orgUnitPath: string;
  rateDate: Date;
  assigneeDate: Date;
  loaiGiaoDich: "NEW" | "RENEWAL";
  /** Ngày thu ĐẦU TIÊN của lần mua (mốc so cửa sổ ghi công). Gọi LƯỜI: chỉ khi thật sự có vai `isAcquisition` cần. */
  ngayThuDau: () => Promise<Date>;
};

export type DauVaoChinhSach = {
  nguon: NguonChoHoaHong | null;
  nguonChinhSach: NguonCuaKhoan;
  nguoiHuong: ReadonlyMap<string, KetQuaNguoiHuong>;
  roleDefIds: ReadonlyMap<string, readonly string[]>;
  ngoaiCuaSo: boolean;
  /** Cửa sổ ghi công HIỆU LỰC của khoản (nguồn riêng ?? setting) — ảnh chụp ứng viên ghi đúng số này. */
  cuaSoNgay: number;
  daTraBangEngineCu: ReadonlySet<string>;
  /** Ghép đầu vào cuối cùng với cơ sở tính (`netBase` của phần). */
  dauVao: (coSo: number) => DauVaoKhoan;
};

async function docRoleDefIds(client: Khach, nguoiHuong: ReadonlyMap<string, KetQuaNguoiHuong>, at: Date): Promise<Map<string, string[]>> {
  const ids = new Set<string>();
  for (const nh of nguoiHuong.values()) if (nh.loai === "CO_NGUOI") for (const n of nh.nguoi) if (n.kind === "USER") ids.add(n.id);
  const ra = new Map<string, string[]>();
  if (ids.size === 0) return ra;
  const rows = await client.userOrgRole.findMany({
    where: { userId: { in: [...ids] }, status: "ACTIVE", effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
    select: { userId: true, roleId: true },
  });
  for (const r of rows) ra.set(r.userId, [...(ra.get(r.userId) ?? []), r.roleId]);
  return ra;
}

export async function dungDauVaoChinhSach(client: Khach, bc: BoiCanhQuet, i: NenDauVao): Promise<DauVaoChinhSach> {
  // 5 — nguồn (qua lib/nguon — KHÔNG đọc thẳng LeadAttribution).
  const nguon = i.leadId ? await docNguonChoHoaHong(client, i.leadId) : null;
  const unknown = !nguon || nguon.groupCode === "UNKNOWN";
  const nguonChinhSach: NguonCuaKhoan = {
    sourceGroupId: unknown ? null : nguon.groupId,
    coHoaHong: !unknown && nguon.nguonCoHoaHong,
    affiliateId: nguon?.referrerAffiliateId ?? null,
    sourceId: null,
    campaignId: null,
    eventId: null,
  };

  // 6 — người hưởng thô của từng vai có chính sách (kể cả vai treo).
  const ctxNguoi = await docNguCanhNguoiHuong(client, {
    leadId: i.leadId,
    leadChildId: i.leadChildId,
    centerId: i.centerId,
    assigneeDate: i.assigneeDate,
    nguon: nguon
      ? {
          referrerKind: nguon.referrerKind,
          referrerParentUserId: nguon.referrerParentUserId,
          referrerSaleUserId: nguon.referrerSaleUserId,
          referrerEmployeeId: nguon.referrerEmployeeId,
          referrerAffiliateId: nguon.referrerAffiliateId,
          nguonChuEmployeeId: nguon.nguonChuEmployeeId,
        }
      : null,
  });
  const roleCoRule = new Set(bc.hoaHong.quyTac.map((q) => q.roleCode));
  const nguoiHuong = new Map<string, KetQuaNguoiHuong>();
  for (const v of bc.hoaHong.vaiHuong) {
    if (v.isActive && roleCoRule.has(v.code)) nguoiHuong.set(v.code, phanGiaiNguoiHuong({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey }, ctxNguoi));
  }
  const roleDefIds = bc.coPhamViRole ? await docRoleDefIds(client, nguoiHuong, i.assigneeDate) : new Map<string, string[]>();

  // 7 — cửa sổ ghi công (chỉ vai `isAcquisition`; mốc = ngày thu ĐẦU TIÊN của lần mua).
  const coAcq = bc.hoaHong.vaiHuong.some((v) => v.isAcquisition && roleCoRule.has(v.code));
  // Cửa sổ HIỆU LỰC: nguồn thắng có cửa sổ riêng thì dùng nó; NULL ⇒ setting chung (`cuaSoHieuLuc` là chỗ DUY NHẤT chọn).
  const cuaSoNgay = cuaSoHieuLuc(unknown ? null : nguon.cuaSoRiengNgay, bc.cuaSoNgay);
  let ngoaiCuaSo = false;
  if (coAcq && !unknown) ngoaiCuaSo = !conTrongCuaSoGhiCong(nguon.attributedAt, await i.ngayThuDau(), cuaSoNgay);

  // 8 — GV Trial đã nhận 1% bằng engine CŨ cho đúng ghi danh này (04 §3.2): không trả lần hai theo đợt thu.
  const daTra = i.enrollmentId
    ? new Set((await client.commissionLine.findMany({ where: { tier: "TRIAL_TEACHER", enrollmentId: i.enrollmentId }, select: { recipientId: true } })).map((x) => x.recipientId))
    : new Set<string>();

  const dauVao = (coSo: number): DauVaoKhoan => ({
    hoaHong: bc.hoaHong,
    loaiGiaoDich: i.loaiGiaoDich,
    coSo,
    rateDate: i.rateDate,
    orgUnitPath: i.orgUnitPath,
    nguon: nguonChinhSach,
    nguoiHuong,
    roleDefIdsTheoNguoi: roleDefIds,
    ngoaiCuaSo,
    daTraBangEngineCu: daTra,
  });
  return { nguon, nguonChinhSach, nguoiHuong, roleDefIds, ngoaiCuaSo, cuaSoNgay, daTraBangEngineCu: daTra, dauVao };
}
