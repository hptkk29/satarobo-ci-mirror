// lib/hoa-hong/hang-cho-chinh-sach.ts — HÀNG CHỜ của tab Chính sách (06 §4.1): phân loại THUẦN. Phần đọc DB ở `chinh-sach-doc.ts`.
//
// Bốn loại việc, mỗi việc ĐÚNG MỘT loại (con số này in trên pill tab, công tắc "Cần xử lý" và route gốc — đếm đôi một
// nháp là ba nơi cùng nói sai; luật 12b: một hàm đếm):
//   1. NHAP_THIEU_VAN_BAN       — nháp chưa gắn văn bản / văn bản chưa có tệp / văn bản đã thu hồi (cổng kích hoạt sẽ chặn);
//   2. CHUA_DU_NGAY_LAM_VIEC    — nháp có văn bản đủ nhưng hiệu lực < công bố + N ngày làm việc (in NGÀY SỚM NHẤT hợp lệ);
//   3. SAP_HIEU_LUC             — bản ĐÃ kích hoạt, chưa tới ngày hiệu lực, trong 7 ngày tới (để người liên quan kịp biết);
//   4. VAI_KHONG_CO_CHINH_SACH  — vai hưởng đang bật mà không rule nào trong bản ACTIVE nào (vai ấy không được trả đồng nào).
// Mốc 15 ngày dùng ĐÚNG `kiemHieuLucSauCongBo` của guardrail (cùng ngày nghỉ, cùng biên) — không viết phép đếm thứ hai.
import { kiemHieuLucSauCongBo, ngayVN, type NgayNghiLe } from "./ngay-lam-viec";
import { ngayDMY } from "./hang-rao-ui";

export const SO_NGAY_SAP_HIEU_LUC = 7;

export type LoaiHangChoChinhSach = "NHAP_THIEU_VAN_BAN" | "CHUA_DU_NGAY_LAM_VIEC" | "SAP_HIEU_LUC" | "VAI_KHONG_CO_CHINH_SACH";

export const THU_TU_LOAI_HANG_CHO: readonly LoaiHangChoChinhSach[] = [
  "NHAP_THIEU_VAN_BAN",
  "CHUA_DU_NGAY_LAM_VIEC",
  "SAP_HIEU_LUC",
  "VAI_KHONG_CO_CHINH_SACH",
];

export const NHAN_LOAI_HANG_CHO: Record<LoaiHangChoChinhSach, string> = {
  NHAP_THIEU_VAN_BAN: "Nháp thiếu văn bản",
  CHUA_DU_NGAY_LAM_VIEC: "Chưa đủ 15 ngày làm việc",
  SAP_HIEU_LUC: "Sắp hiệu lực",
  VAI_KHONG_CO_CHINH_SACH: "Vai chưa có chính sách",
};

export type PhienBanHangCho = {
  versionId: string;
  policyId: string;
  policyCode: string;
  tenChinhSach: string;
  versionNo: number;
  status: "DRAFT" | "ACTIVE";
  effectiveFrom: Date;
  vanBan: { documentCode: string; /** "YYYY-MM-DD" */ publishedOn: string; coTep: boolean; daThuHoi: boolean } | null;
  /** Cơ sở trong phạm vi của phiên bản — để biết lễ riêng của cơ sở nào được trừ. */
  coSoTrongPhamVi: ReadonlySet<string>;
  /** Mã vai có ít nhất một rule trong phiên bản này. */
  codeVaiCoRule: readonly string[];
};

export type ViecHangCho = {
  loai: LoaiHangChoChinhSach;
  /** `null` ở loại VAI. */
  versionId: string | null;
  policyId: string | null;
  policyCode: string | null;
  tenChinhSach: string | null;
  versionNo: number | null;
  vai: { code: string; name: string } | null;
  lyDo: string;
  /** Ngày liên quan ("YYYY-MM-DD"): ngày sớm nhất hợp lệ (loại 2) hoặc ngày bắt đầu hiệu lực (loại 3). */
  ngay: string | null;
};

const MS_NGAY = 86_400_000;

function soNgayGiua(tu: string, den: string): number {
  return Math.round((Date.parse(`${den}T00:00:00.000Z`) - Date.parse(`${tu}T00:00:00.000Z`)) / MS_NGAY);
}

export function phanLoaiHangChoChinhSach(d: {
  phienBan: readonly PhienBanHangCho[];
  vai: readonly { code: string; name: string; isActive: boolean }[];
  nghi: readonly NgayNghiLe[];
  now: Date;
  soNgayLamViec: number;
}): ViecHangCho[] {
  const viec: ViecHangCho[] = [];
  const homNay = ngayVN(d.now);
  const mot = (p: PhienBanHangCho) => ({ versionId: p.versionId, policyId: p.policyId, policyCode: p.policyCode, tenChinhSach: p.tenChinhSach, versionNo: p.versionNo, vai: null });

  for (const p of d.phienBan) {
    if (p.status === "DRAFT") {
      const v = p.vanBan;
      const thieu = !v ? "Chưa gắn văn bản quy định." : v.daThuHoi ? `Văn bản ${v.documentCode} đã bị thu hồi.` : !v.coTep ? `Văn bản ${v.documentCode} chưa có tệp đính kèm.` : null;
      if (thieu) {
        viec.push({ loai: "NHAP_THIEU_VAN_BAN", ...mot(p), lyDo: thieu, ngay: null });
        continue;
      }
      const h = kiemHieuLucSauCongBo({
        congBo: v!.publishedOn,
        hieuLuc: p.effectiveFrom,
        soNgayLamViec: d.soNgayLamViec,
        nghi: d.nghi,
        coSoTrongPhamVi: p.coSoTrongPhamVi,
      });
      if (!h.ok) {
        viec.push({
          loai: "CHUA_DU_NGAY_LAM_VIEC",
          ...mot(p),
          lyDo: `Hiệu lực ${ngayDMY(h.hieuLucNgay)} sớm hơn công bố ${ngayDMY(v!.publishedOn)} + ${d.soNgayLamViec} ngày làm việc — sớm nhất là ${ngayDMY(h.somNhat)}.`,
          ngay: h.somNhat,
        });
      }
      continue;
    }
    // ACTIVE: chưa tới ngày hiệu lực và trong cửa sổ 7 ngày.
    const ngayHieuLuc = ngayVN(p.effectiveFrom);
    if (p.effectiveFrom.getTime() > d.now.getTime() && soNgayGiua(homNay, ngayHieuLuc) <= SO_NGAY_SAP_HIEU_LUC) {
      viec.push({
        loai: "SAP_HIEU_LUC",
        ...mot(p),
        lyDo: `Có hiệu lực từ ${ngayDMY(ngayHieuLuc)}.`,
        ngay: ngayHieuLuc,
      });
    }
  }

  const daCoRule = new Set(d.phienBan.filter((p) => p.status === "ACTIVE").flatMap((p) => p.codeVaiCoRule));
  for (const v of d.vai) {
    if (!v.isActive || daCoRule.has(v.code)) continue;
    viec.push({
      loai: "VAI_KHONG_CO_CHINH_SACH",
      versionId: null,
      policyId: null,
      policyCode: null,
      tenChinhSach: null,
      versionNo: null,
      vai: { code: v.code, name: v.name },
      lyDo: `Vai "${v.name}" đang bật nhưng chưa có chính sách nào — vai này không được trả hoa hồng.`,
      ngay: null,
    });
  }

  const hang = (l: LoaiHangChoChinhSach) => THU_TU_LOAI_HANG_CHO.indexOf(l);
  return viec.sort(
    (a, b) =>
      hang(a.loai) - hang(b.loai) ||
      (a.policyCode ?? a.vai?.code ?? "").localeCompare(b.policyCode ?? b.vai?.code ?? "") ||
      (a.versionNo ?? 0) - (b.versionNo ?? 0),
  );
}

/**
 * Dòng hàng chờ bấm vào đâu (luật 12: dòng chỉ là vùng bấm khi đích có thật VÀ người xem vào được).
 *   · nháp thiếu văn bản / chưa đủ ngày ⇒ thẳng bước tương ứng của trình soạn — NẾU người xem được soạn; không thì trang chi tiết;
 *   · sắp hiệu lực ⇒ trang chi tiết;
 *   · vai chưa có chính sách ⇒ tạo chính sách mới — chỉ khi được soạn, không thì KHÔNG có đích (`null`: dòng không bấm được).
 */
export function hrefViecHangCho(v: ViecHangCho, coTheSoan: boolean): string | null {
  const goc = "/nguon-hoa-hong/chinh-sach";
  if (v.loai === "VAI_KHONG_CO_CHINH_SACH") return coTheSoan ? `${goc}/moi` : null;
  if (!v.policyId || !v.versionId) return null;
  const chiTiet = `${goc}/${v.policyId}?v=${v.versionNo}`;
  if (!coTheSoan || v.loai === "SAP_HIEU_LUC") return chiTiet;
  return `${goc}/${v.policyId}/soan?v=${v.versionId}&buoc=${v.loai === "NHAP_THIEU_VAN_BAN" ? "van-ban" : "hieu-luc"}`;
}

