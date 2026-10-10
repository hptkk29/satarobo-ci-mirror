// lib/hoa-hong/guardrail-kich-hoat.ts — GUARDRAIL khi KÍCH HOẠT một version chính sách (04 §6.6). THUẦN.
//
// Cổng SERVER: UI chỉ hiện lại. Hàm trả MỌI vấn đề một lượt để người soạn sửa một lần, chia:
//   · `loi`     — CHẶN kích hoạt;
//   · `canhBao` — không chặn, nhưng người kích hoạt phải xác nhận + nêu lý do (UNKNOWN tăng).
//
// Dữ liệu vào đã được nạp (hàm thuần): ngày nghỉ, danh sách cơ sở trong phạm vi, người phụ trách còn thiếu,
// các version/rule đang hiệu lực. Phần nạp nằm ở `chinh-sach-service.ts`.
import { chonQuyTac, laDongThuHut, quyTacChoNguonKhongRo, type PhamVi, type QuyTac } from "./chon-quy-tac";
import { kiemHieuLucSauCongBo, type NgayNghiLe } from "./ngay-lam-viec";
import { kiemTran, type QuyTacTheoVai } from "./tien";
import { dinhDangSo } from "./vi-sao";
import type { KieuResolver } from "./vai-huong";
import { dungHuongXuLyTran, type HuongXuLyTran } from "./huong-xu-ly-tran";

export type VanDeKichHoat = {
  ma: string;
  thongBao: string;
  /** Chỉ lỗi `VUOT_TRAN`: tổng LỚN NHẤT, trần hiện tại, chênh lệch và đường dẫn tới nơi nâng trần (chủ dự án 09/10/2026: nâng trần là thao tác của admin). */
  huongXuLy?: HuongXuLyTran;
  /** Chỉ lỗi `VUOT_TRAN`: tổng LỚN NHẤT dạng SỐ (phân số: 0,11) — để nơi khác (kiểm hạ trần) dùng mà không phải đọc ngược từ chữ. */
  tongToiDa?: number;
};

/** Trần số ngữ cảnh của lưới kiểm trần. Vượt ⇒ `LUOI_QUA_LON` (fail-closed) chứ không chạy vô hạn. */
export const LUOI_TOI_DA = 20_000;

/** Cơ sở chuẩn để so UNKNOWN trước/sau (04 §6.5): 10.000.000 đ. */
export const CO_SO_CHUAN = 10_000_000;

const PHAM_VI_CHUA_HO_TRO: readonly PhamVi[] = ["SOURCE", "CAMPAIGN", "EVENT"];

export type VanBanKiemTra = {
  documentCode: string;
  title: string;
  /** Ngày dạng "YYYY-MM-DD" (cột `@db.Date`). */
  issuedOn: string;
  publishedOn: string;
  effectiveOn: string;
  approvedByName: string;
  /** Đã có tệp đính kèm (`fileKey`/`fileUrl`). */
  coTep: boolean;
  daThuHoi: boolean;
};

export type PhienBanKiemTra = {
  id: string;
  policyId: string;
  scopeType: PhamVi;
  scopeKey: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  orgUnitId: string | null;
  orgUnitPath: string;
};

export type PhienBanKhac = {
  id: string;
  policyId: string;
  scopeKey: string;
  orgUnitId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** Đã sinh dòng sổ (`firstUsedAt != null`) — version ĐÃ KHOÁ: không được đổi ranh giới hiệu lực về quá khứ. BẮT BUỘC. */
  daDung: boolean;
};

export type DauVaoKichHoat = {
  phienBan: PhienBanKiemTra;
  vanBan: VanBanKiemTra | null;
  /** Rule của version đang kích hoạt (coi như `ACTIVE`). */
  quyTacDeXuat: readonly QuyTac[];
  /** Rule của MỌI version ACTIVE khác (kể cả bản trước của cùng policy). */
  quyTacDangHieuLuc: readonly QuyTac[];
  /** Version ACTIVE khác — kiểm chồng lấn thời gian. */
  phienBanKhac: readonly PhienBanKhac[];
  loaiGiaoDich: readonly { code: string; isActive: boolean; hasClassifier: boolean }[];
  /** `resolverKey` BẮT BUỘC: vài vai chỉ phân biệt được bằng khoá (vd `REFERRER_PARENT_SALE` cùng kiểu DIRECT_PERSON với `REFERRER_PARENT`) — luật so KIỂU/KHOÁ, không so mã vai. */
  vaiHuong: ReadonlyMap<string, { isActive: boolean; resolverType: KieuResolver; resolverKey: string | null }>;
  /** Vai ORG_UNIT_ROLE × cơ sở trong phạm vi mà `CenterCommissionAssignee` chưa có dòng hiệu lực tại `effectiveFrom`. */
  coSoThieuNguoiPhuTrach: readonly { roleCode: string; centerId: string }[];
  /** `coHoaHong` = `LeadSourceGroup.commissionEnabled`: false ⇒ rule THU HÚT phạm vi SOURCE_GROUP của nguồn này bất hoạt ⇒ KHÔNG kích hoạt được dòng thu hút của nguồn này (dòng EXCLUDE thì được). */
  nhomNguon: readonly {
    id: string;
    code: string;
    dangHoatDong: boolean;
    coHoaHong: boolean;
    /** `Employee.id` người phụ trách nguồn (`ownerEmployeeId`); null = chưa khai — vai `SOURCE_OWNER` sẽ không có người hưởng. BẮT BUỘC khai. */
    ownerEmployeeId: string | null;
    /** `referrerRequirement` của nguồn — vai `REFERRER_PARENT_SALE` chỉ có nghĩa khi nguồn kiểu PHỤ HUYNH giới thiệu. BẮT BUỘC khai. */
    referrerRequirement: string;
  }[];
  nghi: readonly NgayNghiLe[];
  coSoTrongPhamVi: ReadonlySet<string>;
  soNgayLamViec: number;
  /** BẮT BUỘC — `getSetting("crm.commissionMaxTotalRate")`. */
  tranTongTiLe: number;
  thuTuPhamVi: readonly PhamVi[];
  /** BẮT BUỘC (luật 19 — không đọc đồng hồ trong hàm thuần): thời điểm bấm kích hoạt. */
  now: Date;
};

function giaoNhau(a: { from: Date; to: Date | null }, b: { from: Date; to: Date | null }): boolean {
  // Biên MỞ: [from, to). `<` ở cả hai vế — bản kia hết ĐÚNG lúc bản này bắt đầu thì KHÔNG chồng.
  const aTruocKetThucB = b.to === null || a.from.getTime() < b.to.getTime();
  const bTruocKetThucA = a.to === null || b.from.getTime() < a.to.getTime();
  return aTruocKetThucB && bTruocKetThucA;
}

const uniq = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

/**
 * Version mới của CÙNG (policy, phạm vi) sẽ ĐÓNG bản trước tại `effectiveFrom` (khuôn `CommissionRateConfig`):
 * rule của bản trước bị cắt `effectiveTo` — nhưng chỉ khi bản trước bắt đầu TRƯỚC bản mới.
 */
function catBanTruoc(q: QuyTac, pv: PhienBanKiemTra): QuyTac {
  if (q.policyId !== pv.policyId || q.scopeKey !== pv.scopeKey) return q;
  if (q.effectiveFrom.getTime() >= pv.effectiveFrom.getTime()) return q;
  const den = q.effectiveTo === null || q.effectiveTo.getTime() > pv.effectiveFrom.getTime() ? pv.effectiveFrom : q.effectiveTo;
  return { ...q, effectiveTo: den };
}

export function kiemKichHoat(d: DauVaoKichHoat): { loi: VanDeKichHoat[]; canhBao: VanDeKichHoat[] } {
  const loi: VanDeKichHoat[] = [];
  const canhBao: VanDeKichHoat[] = [];
  const pv = d.phienBan;

  // ── 1 · Văn bản ──
  if (!d.vanBan) {
    loi.push({ ma: "VAN_BAN_THIEU", thongBao: "Chưa gắn văn bản quy định (số, tiêu đề, ngày ban hành/công bố/hiệu lực, người duyệt, tệp)." });
  } else {
    const v = d.vanBan;
    const thieu: string[] = [];
    if (!v.documentCode.trim()) thieu.push("documentCode");
    if (!v.title.trim()) thieu.push("title");
    if (!v.issuedOn) thieu.push("issuedOn");
    if (!v.publishedOn) thieu.push("publishedOn");
    if (!v.effectiveOn) thieu.push("effectiveOn");
    if (!v.approvedByName.trim()) thieu.push("approvedByName");
    if (!v.coTep) thieu.push("coTep");
    if (thieu.length > 0) loi.push({ ma: "VAN_BAN_THIEU", thongBao: `Văn bản thiếu: ${thieu.join(", ")}.` });
    if (v.daThuHoi) loi.push({ ma: "VAN_BAN_DA_THU_HOI", thongBao: `Văn bản ${v.documentCode} đã bị thu hồi.` });

    // ── 2 · Hiệu lực ≥ công bố + N ngày làm việc ──
    if (v.publishedOn) {
      const h = kiemHieuLucSauCongBo({
        congBo: v.publishedOn,
        hieuLuc: pv.effectiveFrom,
        soNgayLamViec: d.soNgayLamViec,
        nghi: d.nghi,
        coSoTrongPhamVi: d.coSoTrongPhamVi,
      });
      if (!h.ok) {
        loi.push({
          ma: "HIEU_LUC_SOM",
          thongBao: `Hiệu lực ${h.hieuLucNgay} sớm hơn công bố ${v.publishedOn} + ${d.soNgayLamViec} ngày làm việc — sớm nhất là ${h.somNhat}.`,
        });
      }
    }
  }

  // ── 3 · Rule có hợp lệ nghiệp vụ không ──
  if (d.quyTacDeXuat.length === 0) loi.push({ ma: "KHONG_CO_RULE", thongBao: "Version chưa có rule nào." });

  if (PHAM_VI_CHUA_HO_TRO.includes(pv.scopeType)) {
    loi.push({ ma: "PHAM_VI_CHUA_HO_TRO", thongBao: `Phạm vi ${pv.scopeType} chưa dùng được (cần PR8: cột scopeSourceId).` });
  }
  const loaiBat = new Map(d.loaiGiaoDich.map((l) => [l.code, l]));
  const baoRoi = new Set<string>();
  const bao = (ma: string, thongBao: string) => {
    const k = `${ma}|${thongBao}`;
    if (!baoRoi.has(k)) {
      baoRoi.add(k);
      loi.push({ ma, thongBao });
    }
  };
  for (const q of d.quyTacDeXuat) {
    const lo = loaiBat.get(q.transactionType);
    if (!lo || !lo.isActive || !lo.hasClassifier) bao("LOAI_GD_TAT", `Loại giao dịch ${q.transactionType} đang tắt hoặc chưa có bộ phân loại.`);
    if (q.kieuTinh === "FIXED_PER_PURCHASE" || q.kieuTinh === "TIER_PERIOD_BONUS") {
      bao("KIEU_TINH_CHUA_HO_TRO", `Kiểu tính ${q.kieuTinh} chưa kích hoạt được (PENDING_REGULATION, 04 §9.2).`);
    }
    const vai = d.vaiHuong.get(q.roleCode);
    if (!vai || !vai.isActive) bao("VAI_KHONG_HOAT_DONG", `Vai ${q.roleCode} không tồn tại hoặc không hoạt động.`);
    if (pv.scopeType === "PERSON" && vai?.resolverType === "ORG_UNIT_ROLE") {
      bao("PERSON_VAI_NHIEU_NGUOI", `Phạm vi PERSON không dùng được cho vai ${q.roleCode} (chia đều nhiều người + mức riêng một người là không xác định).`);
    }
    if (q.scopeType === "SOURCE_GROUP" && q.scope.sourceGroupId) {
      const g = d.nhomNguon.find((n) => n.id === q.scope.sourceGroupId);
      if (!g || !g.dangHoatDong) bao("NGUON_KHONG_HOAT_DONG", `Nhóm nguồn ${g?.code ?? q.scope.sourceGroupId} không còn hoạt động.`);
      // Dòng LOẠI TRỪ (EXCLUDE) không thu hút ai nên KHÔNG cần nguồn «tham gia hoa hồng» — engine cho nó chạy ở nguồn cờ tắt (`khopPhamVi`). Chỉ dòng thu hút bị chặn.
      else if (!g.coHoaHong && laDongThuHut(q.kieuTinh)) {
        bao(
          "NGUON_KHONG_THAM_GIA_HOA_HONG",
          `Nguồn ${g.code} không tham gia hoa hồng theo nguồn (commissionEnabled = tắt) nên các dòng thu hút của chính sách riêng nguồn này sẽ KHÔNG bao giờ chạy (chỉ dòng «loại trừ» mới chạy ở nguồn tắt cờ). Bật "tham gia hoa hồng" ở cấu hình nguồn trước, hoặc chuyển chính sách sang phạm vi chung.`,
        );
      }
      // Hai kiểu người hưởng mới chỉ có người khi NGUỒN có dữ liệu cho nó (res3 MEDIUM-4). Thiếu ⇒ chính sách vẫn qua cổng, rồi MỌI khoản thu của nguồn thành hold
      // `UNRESOLVED_BENEFICIARY` vĩnh viễn — tiền không bao giờ trả. So theo KIỂU/KHOÁ của vai, không theo mã vai.
      if (g) {
        const vaiQ = d.vaiHuong.get(q.roleCode);
        if (vaiQ?.resolverType === "SOURCE_OWNER" && !g.ownerEmployeeId) {
          bao(
            "NGUON_CHUA_CO_NGUOI_PHU_TRACH",
            `Nguồn ${g.code} chưa khai người phụ trách mà chính sách dùng vai ${q.roleCode} (người hưởng = người phụ trách nguồn): khoản thu nào của nguồn này cũng vào hàng chờ và không ai nhận. Khai người phụ trách ở cấu hình nguồn trước.`,
          );
        }
        if (vaiQ?.resolverKey === "REFERRER_PARENT_SALE" && g.referrerRequirement !== "PARENT") {
          bao(
            "NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU",
            `Nguồn ${g.code} không phải nguồn «phụ huynh giới thiệu» nên không có Sale phụ trách phụ huynh để trả vai ${q.roleCode}: khoản thu nào của nguồn này cũng vào hàng chờ. Dùng vai này cho nguồn kiểu phụ huynh giới thiệu, hoặc chọn vai khác.`,
          );
        }
      }
    } else if (q.scopeType !== "SOURCE_GROUP" && vai?.resolverType === "SOURCE_OWNER") {
      // Rule vai «người phụ trách nguồn» ở phạm vi KHÔNG gắn nguồn nào (chung · đơn vị · vai…) áp cho MỌI nguồn: nguồn đang hoạt động mà chưa khai người phụ trách thì mọi khoản thu
      // của nó vào hàng chờ `NGUON_CHUA_CO_NGUOI_PHU_TRACH` (resolver treo, KHÔNG im lặng) — tiền của các nguồn KHÔNG LIÊN QUAN cũng treo theo. Chặn, nêu đúng nguồn thiếu.
      // (`REFERRER_PARENT_SALE` thì KHÔNG cần chặn ở phạm vi chung: nguồn không phải PARENT chỉ treo im lặng `THIEU_NGUOI_GIOI_THIEU` — ca [FIX-F2-ENG].)
      const thieuChu = d.nhomNguon.filter((n) => n.dangHoatDong && !n.ownerEmployeeId).map((n) => n.code);
      if (thieuChu.length > 0) {
        const nem = thieuChu.slice(0, 5).join(", ") + (thieuChu.length > 5 ? ` và ${thieuChu.length - 5} nguồn khác` : "");
        bao(
          "NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH",
          `Chính sách dùng vai ${q.roleCode} (người hưởng = người phụ trách nguồn) ở phạm vi chung, nhưng ${thieuChu.length} nguồn đang hoạt động chưa khai người phụ trách (${nem}): khoản thu nào của các nguồn đó cũng vào hàng chờ và không ai nhận. Khai người phụ trách cho các nguồn ấy, hoặc đặt chính sách ở phạm vi riêng của nguồn có chủ.`,
        );
      }
    }
  }
  const rolesDeXuat = new Set(d.quyTacDeXuat.map((q) => q.roleCode));
  for (const t of d.coSoThieuNguoiPhuTrach) {
    if (!rolesDeXuat.has(t.roleCode)) continue;
    bao("THIEU_NGUOI_PHU_TRACH", `Vai ${t.roleCode}: cơ sở ${t.centerId} chưa có người phụ trách tại ngày hiệu lực.`);
  }

  // ── 4 · Chồng lấn hiệu lực (CÙNG policy + phạm vi + đơn vị — 04 §6.6) ──
  // Hai policy KHÁC nhau cùng phạm vi + đơn vị mà khoảng giao nhau là chuyện BÌNH THƯỜNG (HV_MOI = NEW, TAI_TUC = RENEWAL,
  // cùng GLOBAL/Hội sở): xung đột thật giữa chúng chỉ có khi hai rule cùng (vai × loại) cùng hạng — việc của `CHONG_LAN_RULE`
  // ở lưới ngữ cảnh bên dưới. So thêm theo policy ở đây là chặn mọi policy thứ hai trong cùng ô phạm vi.
  const mine = { from: pv.effectiveFrom, to: pv.effectiveTo };
  for (const k of d.phienBanKhac) {
    if (k.policyId !== pv.policyId) continue;
    if (k.scopeKey !== pv.scopeKey || k.orgUnitId !== pv.orgUnitId) continue;
    // Bản trước đang mở sẽ bị đóng tại effectiveFrom của bản này.
    let khoang = { from: k.effectiveFrom, to: k.effectiveTo };
    const seBiDong = k.effectiveFrom.getTime() < pv.effectiveFrom.getTime() && (k.effectiveTo === null || k.effectiveTo.getTime() > pv.effectiveFrom.getTime());
    if (k.effectiveFrom.getTime() < pv.effectiveFrom.getTime()) {
      khoang = { from: k.effectiveFrom, to: seBiDong ? pv.effectiveFrom : k.effectiveTo };
    }
    if (giaoNhau(mine, khoang)) {
      bao("CHONG_LAN_HIEU_LUC", `Hiệu lực chồng lấn version ${k.id} của cùng phạm vi ${pv.scopeKey} và đơn vị.`);
    }
    // Đóng bản trước ĐÃ DÙNG tại một mốc đã qua = đổi rule thắng của các giao dịch đã tính (rateDate ≥ mốc) — locked.
    if (seBiDong && k.daDung && pv.effectiveFrom.getTime() < d.now.getTime()) {
      bao(
        "LUI_HIEU_LUC_BAN_DA_DUNG",
        `Version ${k.id} đã sinh dòng sổ hoa hồng — không đóng lùi về ${pv.effectiveFrom.toISOString()} (đã qua). Đặt hiệu lực bắt đầu từ bây giờ trở đi.`,
      );
    }
  }

  // ── 5 · Lưới ngữ cảnh: trần + chồng lấn rule ──
  const dangSauCat = d.quyTacDangHieuLuc.map((q) => catBanTruoc(q, pv));
  const tatCa = [...dangSauCat, ...d.quyTacDeXuat];
  const txs = uniq(d.quyTacDeXuat.map((q) => q.transactionType));

  const paths = uniq([...tatCa.map((q) => q.orgUnitPath), ...tatCa.flatMap((q) => (q.scope.orgUnitPath ? [q.scope.orgUnitPath] : []))]);
  const pick = (t: PhamVi, f: (q: QuyTac) => string | undefined): (string | null)[] => [
    null,
    ...uniq(tatCa.filter((q) => q.scopeType === t).flatMap((q) => (f(q) ? [f(q)!] : []))),
  ];
  const persons = pick("PERSON", (q) => q.scope.userId);
  const affiliates = pick("AFFILIATE", (q) => q.scope.affiliateId);
  const groups = pick("SOURCE_GROUP", (q) => q.scope.sourceGroupId);
  const coHoaHongTheoNhom = new Map(d.nhomNguon.map((n) => [n.id, n.coHoaHong]));
  const sources = pick("SOURCE", (q) => q.scope.sourceId);
  const campaigns = pick("CAMPAIGN", (q) => q.scope.sourceId);
  const events = pick("EVENT", (q) => q.scope.sourceId);
  const roleSets: string[][] = [[], ...uniq(tatCa.flatMap((q) => (q.scopeType === "ROLE" && q.scope.roleDefId ? [q.scope.roleDefId] : []))).map((r) => [r])];

  const kichThuoc =
    paths.length * persons.length * affiliates.length * groups.length * sources.length * campaigns.length * events.length * roleSets.length;
  if (txs.length > 0 && kichThuoc > LUOI_TOI_DA) {
    loi.push({
      ma: "LUOI_QUA_LON",
      thongBao: `Lưới kiểm trần có ${dinhDangSo(kichThuoc)} ngữ cảnh (> ${dinhDangSo(LUOI_TOI_DA)}) — chia chính sách nhỏ hơn rồi kích hoạt lại.`,
    });
  } else if (txs.length > 0) {
    // Mốc nào làm tập rule thắng ĐỔI: lúc một rule BẮT ĐẦU, và lúc một rule HẾT HẠN (biên mở: tại `effectiveTo` rule đã hết,
    // rule thua nó lộ ra). Chỉ lấy mốc bắt đầu là bỏ sót ca rule cụ thể (tỉ lệ thấp) rút đi giữa cửa sổ.
    const trongCuaSo = (t: number): boolean => t > pv.effectiveFrom.getTime() && (pv.effectiveTo === null || t < pv.effectiveTo.getTime());
    const ngayTinh = uniq([
      pv.effectiveFrom.getTime(),
      ...tatCa.map((q) => q.effectiveFrom.getTime()).filter(trongCuaSo),
      ...tatCa.flatMap((q) => (q.effectiveTo === null ? [] : [q.effectiveTo.getTime()])).filter(trongCuaSo),
    ]);
    const vuot: string[] = [];
    /** Mức LỚN NHẤT trong MỌI ngữ cảnh vượt (không chỉ năm dòng được liệt kê): đó là số nâng trần phải đạt tối thiểu. */
    let tongToiDa = 0;
    // khoá (vai·loại) → câu nói CHÍNH SÁCH NÀO chồng nhau (lấy từ bộ chọn) để người sửa biết mở chính sách nào.
    const chong = new Map<string, string>();
    for (const t of ngayTinh) {
      for (const tx of txs) {
        const roles = uniq(tatCa.filter((q) => q.transactionType === tx).map((q) => q.roleCode));
        for (const path of paths)
          for (const person of persons)
            for (const aff of affiliates)
              for (const grp of groups)
                for (const src of sources)
                  for (const cam of campaigns)
                    for (const evt of events)
                      for (const rs of roleSets) {
                        const winners: QuyTacTheoVai[] = [];
                        for (const roleCode of roles) {
                          const r = chonQuyTac({
                            ctx: {
                              roleCode,
                              transactionType: tx,
                              revenueComponent: "TUITION",
                              rateDate: new Date(t),
                              orgUnitPath: path,
                              nguoiHuongUserId: person,
                              affiliateId: aff,
                              sourceId: src,
                              campaignId: cam,
                              eventId: evt,
                              sourceGroupId: grp,
                              nguonCoHoaHong: grp === null ? true : (coHoaHongTheoNhom.get(grp) ?? false),
                              roleDefIds: rs,
                            },
                            quyTac: tatCa,
                            thuTuPhamVi: d.thuTuPhamVi,
                          });
                          if (r.loai === "CHONG_LAN" && !chong.has(`${roleCode}·${tx}`)) chong.set(`${roleCode}·${tx}`, r.lyDo);
                          if (r.loai !== "THANG") continue;
                          const q = r.quyTac;
                          if (q.kieuTinh === "PERCENT") winners.push({ roleCode, kieuTinh: "PERCENT", rate: q.giaTri });
                          else if (q.kieuTinh === "FIXED_PER_PURCHASE") winners.push({ roleCode, kieuTinh: "FIXED_PER_PURCHASE", fixed: Number(q.giaTri) });
                        }
                        const k = kiemTran({ coSo: CO_SO_CHUAN, quyTacTheoVai: winners, tranTongTiLe: d.tranTongTiLe });
                        if (!k.ok && k.tiLeTuongDuong > tongToiDa) tongToiDa = k.tiLeTuongDuong;
                        if (!k.ok && vuot.length < 5) {
                          vuot.push(
                            `${tx} @${path}${grp ? ` nhóm ${grp}` : ""}${person ? ` người ${person}` : ""}${aff ? ` affiliate ${aff}` : ""}: Σ ${(k.tiLeTuongDuong * 100).toFixed(4)}% > trần ${(k.tran * 100).toFixed(4)}%`,
                          );
                        }
                      }
      }
    }
    for (const [, lyDo] of chong) loi.push({ ma: "CHONG_LAN_RULE", thongBao: `Chồng lấn chính sách: ${lyDo}` });
    if (vuot.length > 0) {
      const h = dungHuongXuLyTran({ tongToiDa, tran: d.tranTongTiLe });
      loi.push({
        ma: "VUOT_TRAN",
        thongBao: `Vượt trần hoa hồng: tổng cao nhất ${h.tongPhanTram}% so với trần hiện tại ${h.tranPhanTram}% (vượt ${h.chenhLechPhanTram} điểm phần trăm). ${vuot.join(" | ")}. ${h.loiKhuyen}`,
        huongXuLy: h,
        tongToiDa,
      });
    }
  }

  // ── 6 · Cảnh báo: mức UNKNOWN (nguồn không rõ) có TĂNG không ──
  const nhomHoatDong = d.nhomNguon.filter((n) => n.dangHoatDong).map((n) => ({ id: n.id, code: n.code, coHoaHong: n.coHoaHong }));
  if (nhomHoatDong.length > 0 && txs.length > 0) {
    const tangs: string[] = [];
    const roles = uniq(d.quyTacDeXuat.map((q) => q.roleCode));
    for (const tx of txs)
      for (const roleCode of roles)
        for (const path of paths) {
          const ctx = {
            roleCode,
            transactionType: tx,
            revenueComponent: "TUITION" as const,
            rateDate: pv.effectiveFrom,
            orgUnitPath: path,
            nguoiHuongUserId: null,
            roleDefIds: [] as string[],
          };
          const tien = (qs: readonly QuyTac[]): number => {
            const r = quyTacChoNguonKhongRo({ ctx, nhomDangHoatDong: nhomHoatDong, quyTac: qs, thuTuPhamVi: d.thuTuPhamVi, coSo: CO_SO_CHUAN });
            return r.loai === "THANG" ? r.tien : 0;
          };
          const truoc = tien(d.quyTacDangHieuLuc);
          const sau = tien(tatCa);
          // 0 → X chỉ KHÔNG phải "tăng" khi đây là rule ĐẦU TIÊN của ô (vai × loại × đơn vị): chưa có mức để so. Ô đã có rule
          // (ở nhóm nguồn khác) mà UNKNOWN đang 0 vì còn nhóm thiếu rule, rồi rule mới lấp nhóm ấy ⇒ từ hôm đó nguồn KHÔNG
          // RÕ bắt đầu được trả tiền — đó là tăng thật, phải có người xác nhận.
          const daCoRuleChoO = d.quyTacDangHieuLuc.some((q) => q.roleCode === roleCode && q.transactionType === tx && path.startsWith(q.orgUnitPath));
          if ((truoc > 0 || daCoRuleChoO) && sau > truoc) tangs.push(`${roleCode}·${tx}@${path}: ${dinhDangSo(truoc)} → ${dinhDangSo(sau)} đ trên ${dinhDangSo(CO_SO_CHUAN)} đ`);
        }
    if (tangs.length > 0) {
      canhBao.push({ ma: "UNKNOWN_TANG", thongBao: `Mức cho nguồn KHÔNG RÕ sẽ TĂNG: ${tangs.slice(0, 5).join(" | ")}` });
    }
  }

  return { loi, canhBao };
}
