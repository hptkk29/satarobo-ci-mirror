// lib/hoa-hong/dau-vao-chinh-sach.ts — DỰNG ĐẦU VÀO CHÍNH SÁCH cho MỘT phần học viên (nguồn · người hưởng · cửa sổ · GV Trial cũ).
//
// Nguồn: docs/source-commission/04 §2 bước 6–10, L11 (một hàm cho engine thật · thử tính · "dự kiến của bạn").
//
// Engine thật (`quet-khoan.ts`) và "dự kiến của bạn" (`du-kien.ts`) cùng gọi hàm này để có CÙNG đầu vào của `tinhDongChoKhoan`: nếu hai
// bên dựng riêng thì con số Sale thấy ở "dự kiến" và con số engine ghi sổ sẽ lệch nhau (luật 12b — đọc số của một chỗ, không dựng lại).
// Chỉ ĐỌC. Client KHÔNG scope (việc toàn hệ).
import { docAffiliateChoHoaHong, type AffiliateChoHoaHong } from "@/lib/affiliate/campaign-cho-hoa-hong";
import { conTrongCuaSoGhiCong, cuaSoHieuLuc } from "@/lib/nguon/cua-so-ghi-cong";
import { docNguonChoHoaHong, type NguonChoHoaHong } from "@/lib/nguon/doc-nguon-hoa-hong";

import { xetBaoVeCampaign, xetLienKetCampaign, type KetQuaBaoVe, type KetQuaLienKet } from "./bao-ve-campaign";
import type { BoiCanhQuet } from "./boi-canh";
import type { CuaSoGhiCong } from "./giai-thich-khong-tien";
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
  /**
   * Ngày thu ĐẦU TIÊN của lần mua = NGÀY SỰ KIỆN (hướng B+C): mốc so cửa sổ ghi công VÀ mốc tra CHỦ NGUỒN theo lịch sử (`LeadSourceOwnerPeriod`).
   * Gọi LƯỜI và nhớ kết quả: chỉ gọi khi khoản có lead (cần tra chủ nguồn) hoặc có vai `isAcquisition`. Mọi đợt trả góp của MỘT lần mua trả CÙNG ngày này.
   */
  ngayThuDau: () => Promise<Date>;
  /**
   * AFF-L2b: khoản đang tính có phải khoản thu ĐẦU của lần mua không (`khoan-dau-lan-mua.ts`) — chỉ rule `FIXED_PER_PURCHASE` đọc. BẮT BUỘC (luật 7): quên khai là FIXED trả mỗi đợt thu, hoặc không bao giờ trả, mà không lỗi nào báo
   * (rule PERCENT không đổi nên không ca cũ nào đỏ).
   */
  laKhoanDauLanMua: boolean;
};

export type DauVaoChinhSach = {
  nguon: NguonChoHoaHong | null;
  nguonChinhSach: NguonCuaKhoan;
  /**
   * Campaign · thành viên · referral Affiliate của khoản (AFF-P2) — cùng nguồn với `nguonChinhSach.campaignId`. `null` = khoản không đến từ link Affiliate (hoặc nguồn không rõ, hoặc bản chụp
   * không khớp đối tác đang giữ công). BẮT BUỘC khai (luật 7): quên là sổ ghi ba cột NULL mà không lỗi nào báo.
   */
  affiliate: AffiliateChoHoaHong | null;
  /**
   * Campaign còn BẢO VỆ referral vào ngày sự kiện không (AFF-L2, D-A) — kết quả của `xetBaoVeCampaign`, đo ở NGÀY THU ĐẦU của lần mua. `{ baoVe: false, lyDo: "KHONG_CO_CAMPAIGN" }` khi khoản không đến từ campaign.
   * Việc thoát cửa sổ nguồn có THẬT SỰ xảy ra hay không còn tuỳ rule thắng (`tinhDongChoKhoan.mienCuaSoNguon`). BẮT BUỘC (luật 7).
   */
  baoVe: KetQuaBaoVe;
  /** Chuỗi đối tác–thành viên–referral VALID–nguồn–campaign có hợp lệ vào ngày sự kiện không (chưa xét hạn bảo vệ) — so bóng (D-D) đọc. BẮT BUỘC (luật 7). */
  lienKet: KetQuaLienKet;
  nguoiHuong: ReadonlyMap<string, KetQuaNguoiHuong>;
  roleDefIds: ReadonlyMap<string, readonly string[]>;
  ngoaiCuaSo: boolean;
  /** Cửa sổ ghi công HIỆU LỰC của khoản (nguồn riêng ?? setting) — ảnh chụp ứng viên ghi đúng số này. */
  cuaSoNgay: number;
  /** Ngày quy nguồn · ngày thu ĐẦU của lần mua · cửa sổ hiệu lực — những số đã quyết `ngoaiCuaSo`. `null` khi không có phép đo cửa sổ nào chạy (không vai thu hút / nguồn không rõ). BẮT BUỘC. */
  cuaSo: CuaSoGhiCong | null;
  daTraBangEngineCu: ReadonlySet<string>;
  /**
   * Ghép đầu vào cuối cùng với cơ sở tính. `coSo` = cơ sở ĐANG TÍNH (`netBase` của phần; hoặc cơ sở CÒN LẠI của ô sau hoàn). `coSoGoc` = cơ sở GỐC của ô — KHÔNG có mặc định (luật 7): hai số này bằng nhau với khoản mới và
   * khác nhau với ô đã hoàn một phần, và truyền nhầm một số cho cả hai là đúng cách `FIXED_PER_PURCHASE` sinh INPUT_DRIFT giả sau hoàn (`[NHH-COM-08f]`).
   */
  dauVao: (coSo: number, coSoGoc: number) => DauVaoKhoan;
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
  // 5 — nguồn (qua lib/nguon — KHÔNG đọc thẳng LeadAttribution). Chủ nguồn tra theo NGÀY SỰ KIỆN (ngày thu đầu của lần mua), không theo hôm nay.
  let ngaySuKienDaDoc: Date | null = null;
  const ngaySuKien = async (): Promise<Date> => (ngaySuKienDaDoc ??= await i.ngayThuDau());
  const nguon = i.leadId ? await docNguonChoHoaHong(client, i.leadId, await ngaySuKien()) : null;
  const unknown = !nguon || nguon.groupCode === "UNKNOWN";
  // Campaign Affiliate: chỉ tra khi nguồn ĐÃ RÕ — nguồn không rõ đi đường `quyTacChoNguonKhongRo` (xoá mọi chiều con của nguồn), campaign không có tác dụng nên cũng không chụp.
  const affiliate = !unknown && i.leadId
    ? await docAffiliateChoHoaHong(client, { leadId: i.leadId, referrerKind: nguon.referrerKind, referrerAffiliateId: nguon.referrerAffiliateId, snapshot: nguon.affiliate })
    : null;
  // Cửa sổ BẢO VỆ của campaign (D-A) — đo ở ngày sự kiện (ngày thu đầu), cùng mốc với cửa sổ nguồn. Chỉ gọi `ngaySuKien()` khi có campaign: khoản không đến từ Affiliate không phát sinh thêm câu tra nào.
  const ngayCampaign = affiliate ? await ngaySuKien() : null;
  const baoVe: KetQuaBaoVe = affiliate && ngayCampaign ? xetBaoVeCampaign(affiliate, ngayCampaign, nguon?.groupId ?? null) : { baoVe: false, lyDo: "KHONG_CO_CAMPAIGN" };
  const lienKet: KetQuaLienKet = affiliate && ngayCampaign ? xetLienKetCampaign(affiliate, ngayCampaign, nguon?.groupId ?? null) : { hopLe: false, lyDo: "KHONG_CO_CAMPAIGN" };
  const nguonChinhSach: NguonCuaKhoan = {
    sourceGroupId: unknown ? null : nguon.groupId,
    coHoaHong: !unknown && nguon.nguonCoHoaHong,
    affiliateId: nguon?.referrerAffiliateId ?? null,
    sourceId: null,
    campaignId: affiliate?.campaignId ?? null,
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
  // Ba số quyết định `ngoaiCuaSo` được GIỮ LẠI (Hướng G): giải thích «vì sao 0đ» cần đúng những số này, không tính lại ở chỗ khác. `null` = không có phép đo nào chạy.
  let cuaSo: CuaSoGhiCong | null = null;
  if (coAcq && !unknown) {
    const ngayThuDau = await ngaySuKien();
    ngoaiCuaSo = !conTrongCuaSoGhiCong(nguon.attributedAt, ngayThuDau, cuaSoNgay);
    cuaSo = { attributedAt: nguon.attributedAt, ngayThuDau, cuaSoNgay };
  }

  // 8 — GV Trial đã nhận 1% bằng engine CŨ cho đúng ghi danh này (04 §3.2): không trả lần hai theo đợt thu.
  const daTra = i.enrollmentId
    ? new Set((await client.commissionLine.findMany({ where: { tier: "TRIAL_TEACHER", enrollmentId: i.enrollmentId }, select: { recipientId: true } })).map((x) => x.recipientId))
    : new Set<string>();

  const dauVao = (coSo: number, coSoGoc: number): DauVaoKhoan => ({
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
    baoVeCampaign: baoVe.baoVe,
    lanMua: { laKhoanDau: i.laKhoanDauLanMua, coSoGoc },
  });
  return { nguon, nguonChinhSach, affiliate, baoVe, lienKet, nguoiHuong, roleDefIds, ngoaiCuaSo, cuaSoNgay, cuaSo, daTraBangEngineCu: daTra, dauVao };
}
