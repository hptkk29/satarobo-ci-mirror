// lib/hoa-hong/tinh-chinh-sach.ts — GHÉP chọn quy tắc + người hưởng + trần + chia tiền cho MỘT phần học viên.
//
// Nguồn: docs/source-commission/04 §2 (bước 7–11), L5–L7, §8. THUẦN — không DB, không đồng hồ.
//
// Đây là hàm mà thử tính, "dự kiến của bạn" và engine thật (PR5) CÙNG gọi (L11). PR4 dừng ở đây: nó trả
// "mỗi vai được bao nhiêu, cho ai, vì sao"; việc dựng `CommissionEntry` (khoá, ảnh chụp, hash), ô tính, kỳ,
// ghi sổ là của PR5.
//
//   7. người hưởng thô của TỪNG vai (đã phân giải ở `nguoi-huong.ts`, truyền vào — kể cả vai "treo")
//   8. chọn quy tắc: nguồn biết ⇒ `chonQuyTac`; nguồn KHÔNG RÕ ⇒ `quyTacChoNguonKhongRo` (mức thấp nhất, động)
//   9. KIỂM TRẦN trên Σ TỈ LỆ của rule thắng — TRƯỚC lọc tư cách, gồm cả vai treo. Vượt ⇒ 0 dòng cho CẢ phần
//      học viên + hàng chờ `CAP_EXCEEDED`; KHÔNG tự cắt vai nào (D1).
//  10. người nghỉ việc (D13) bị loại; phần của họ TREO, không chia lại
//  11. tiền vai = `round(cơ sở × tỉ lệ)` MỘT lần, rồi chia đều cho người hưởng
//
// Vai tham gia = vai ĐANG BẬT trong master mà chính sách CÓ nhắc tới (bất kỳ rule nào). Vai chính sách không
// nhắc (vd Marketing khi chưa ai khai rule) KHÔNG xuất hiện — vai tuỳ chọn, không rule ⇒ không sinh, không 0%.
//
// ⚠️ Cửa sổ 90 ngày của vai "mang khách về" (`isAcquisition`) cần cột attribution của PR5; hàm này nhận
// kết quả người hưởng ĐÃ lọc cửa sổ nếu người gọi muốn — nó không tự đoán.
import { chonQuyTac, quyTacChoNguonKhongRo, tienTheoQuyTac, type NhomNguon, type QuyTac } from "./chon-quy-tac";
import type { HoaHongContext } from "./kieu";
import type { KetQuaNguoiHuong, LyDoTreo, NguoiHuong } from "./nguoi-huong";
import { chiaTienChoVai, kiemTran, type QuyTacTheoVai } from "./tien";

export type NguonCuaKhoan = {
  /** `null` = nguồn KHÔNG RÕ (UNKNOWN). */
  sourceGroupId: string | null;
  /** `LeadSourceGroup.commissionEnabled` của nguồn thắng: false ⇒ rule THU HÚT phạm vi SOURCE_GROUP của nó bất hoạt (dòng EXCLUDE vẫn chạy). Nguồn không rõ ⇒ không dùng. */
  coHoaHong: boolean;
  affiliateId: string | null;
  sourceId: string | null;
  campaignId: string | null;
  eventId: string | null;
};

export type DauVaoTinhChinhSach = {
  hoaHong: HoaHongContext;
  loaiGiaoDich: "NEW" | "RENEWAL";
  /** `netBase` của phần học phí (VND, ≥ 0). */
  coSo: number;
  /** Ngày GỐC của tiền. */
  rateDate: Date;
  /** Đơn vị của GIAO DỊCH. */
  orgUnitPath: string;
  nguon: NguonCuaKhoan;
  /** Kết quả người hưởng của TỪNG vai (khoá = `roleCode`). Thiếu một vai tham gia ⇒ ném. */
  nguoiHuong: ReadonlyMap<string, KetQuaNguoiHuong>;
  /** `User.id` → các `RoleDef.id` (cho phạm vi ROLE). Vắng = không có vai. */
  roleDefIdsTheoNguoi: ReadonlyMap<string, readonly string[]>;
};

export type TrangThaiVai = "SINH_DONG" | "TREO" | "KHONG_RULE" | "EXCLUDE" | "KHONG_TIEN";

export type VaiKetQua = {
  roleCode: string;
  trangThai: TrangThaiVai;
  quyTac: QuyTac | null;
  lyDo: string;
  /** Tiền của CẢ vai (kể cả khi treo — để màn hàng chờ nói "treo bao nhiêu"). */
  tienVai: number;
  nguonKhongRo: boolean;
  nguoi: NguoiHuong[];
  lyDoTreo: LyDoTreo | null;
  /** Mọi phần chia đều (Σ = `tienVai`), kể cả phần của người bị loại. */
  cacPhan: { recipientId: string; amount: number }[];
  duocChi: { recipientId: string; amount: number }[];
  /** Phần của người bị loại (nghỉ việc…) — TREO, không chia lại. */
  treoPhan: { recipientId: string; amount: number }[];
};

export type KetQuaTinhChinhSach =
  | { loai: "OK"; cacVai: VaiKetQua[]; tiLeTuongDuong: number }
  | {
      loai: "VUOT_TRAN";
      tiLeTuongDuong: number;
      tran: number;
      quyTacThang: { roleCode: string; ruleId: string; kieuTinh: QuyTac["kieuTinh"]; giaTri: number | string }[];
    }
  | { loai: "CHONG_LAN"; roleCode: string; lyDo: string };

type ChonXong =
  | { loai: "THANG"; quyTac: QuyTac; lyDo: string; nguonKhongRo: boolean }
  | { loai: "KHONG_CO"; lyDo: string; nguonKhongRo: boolean };

export function tinhChinhSachChoPhan(d: DauVaoTinhChinhSach): KetQuaTinhChinhSach {
  const { hoaHong: hh } = d;
  if (!Number.isInteger(d.coSo) || d.coSo < 0) throw new Error(`Cơ sở tính không hợp lệ: ${d.coSo}`);

  const roleCoChinhSach = new Set(hh.quyTac.map((q) => q.roleCode));
  const vaiThamGia = hh.vaiHuong.filter((v) => v.isActive && roleCoChinhSach.has(v.code));

  const chon: { roleCode: string; ket: ChonXong; nguoiHuong: KetQuaNguoiHuong }[] = [];
  for (const vai of vaiThamGia) {
    const nh = d.nguoiHuong.get(vai.code);
    if (!nh) throw new Error(`Thiếu kết quả người hưởng cho vai ${vai.code}`);

    // PERSON / AFFILIATE là chiều của NGƯỜI HƯỞNG — chỉ có khi vai có ĐÚNG MỘT người.
    const mot = nh.loai === "CO_NGUOI" && nh.nguoi.length === 1 ? nh.nguoi[0]! : null;
    const nguoiHuongUserId = mot?.kind === "USER" ? mot.id : null;
    const affiliateId = d.nguon.affiliateId ?? (mot?.kind === "AFFILIATE" ? mot.id : null);
    const roleDefIds = nguoiHuongUserId ? [...(d.roleDefIdsTheoNguoi.get(nguoiHuongUserId) ?? [])] : [];

    if (d.nguon.sourceGroupId === null) {
      const r = quyTacChoNguonKhongRo({
        ctx: {
          roleCode: vai.code,
          transactionType: d.loaiGiaoDich,
          revenueComponent: "TUITION",
          rateDate: d.rateDate,
          orgUnitPath: d.orgUnitPath,
          nguoiHuongUserId,
          roleDefIds,
        },
        nhomDangHoatDong: hh.nhomNguon as readonly NhomNguon[],
        quyTac: hh.quyTac,
        thuTuPhamVi: hh.thuTuPhamVi,
        coSo: d.coSo,
      });
      if (r.loai === "CHONG_LAN") return { loai: "CHONG_LAN", roleCode: vai.code, lyDo: r.lyDo };
      chon.push({
        roleCode: vai.code,
        nguoiHuong: nh,
        ket: r.loai === "THANG" ? { loai: "THANG", quyTac: r.quyTac, lyDo: r.lyDo, nguonKhongRo: true } : { loai: "KHONG_CO", lyDo: r.lyDo, nguonKhongRo: true },
      });
      continue;
    }

    const r = chonQuyTac({
      ctx: {
        roleCode: vai.code,
        transactionType: d.loaiGiaoDich,
        revenueComponent: "TUITION",
        rateDate: d.rateDate,
        orgUnitPath: d.orgUnitPath,
        nguoiHuongUserId,
        affiliateId,
        sourceId: d.nguon.sourceId,
        campaignId: d.nguon.campaignId,
        eventId: d.nguon.eventId,
        sourceGroupId: d.nguon.sourceGroupId,
        nguonCoHoaHong: d.nguon.coHoaHong,
        roleDefIds,
      },
      quyTac: hh.quyTac,
      thuTuPhamVi: hh.thuTuPhamVi,
    });
    if (r.loai === "CHONG_LAN") return { loai: "CHONG_LAN", roleCode: vai.code, lyDo: r.lyDo };
    chon.push({
      roleCode: vai.code,
      nguoiHuong: nh,
      ket: r.loai === "THANG" ? { loai: "THANG", quyTac: r.quyTac, lyDo: r.lyDo, nguonKhongRo: false } : { loai: "KHONG_CO", lyDo: r.lyDo, nguonKhongRo: false },
    });
  }

  // 9 — trần: Σ TỈ LỆ của rule thắng, TRƯỚC lọc tư cách (vai treo vẫn tính).
  const thang: { roleCode: string; q: QuyTac }[] = chon.flatMap((c) => (c.ket.loai === "THANG" ? [{ roleCode: c.roleCode, q: c.ket.quyTac }] : []));
  const choTran: QuyTacTheoVai[] = thang.flatMap(({ roleCode, q }): QuyTacTheoVai[] =>
    q.kieuTinh === "PERCENT"
      ? [{ roleCode, kieuTinh: "PERCENT", rate: q.giaTri }]
      : q.kieuTinh === "FIXED_PER_PURCHASE"
        ? [{ roleCode, kieuTinh: "FIXED_PER_PURCHASE", fixed: Number(q.giaTri) }]
        : [],
  );
  const tran = kiemTran({ coSo: d.coSo, quyTacTheoVai: choTran, tranTongTiLe: hh.tranTongTiLe });
  if (!tran.ok) {
    return {
      loai: "VUOT_TRAN",
      tiLeTuongDuong: tran.tiLeTuongDuong,
      tran: tran.tran,
      quyTacThang: thang.map(({ roleCode, q }) => ({ roleCode, ruleId: q.ruleId, kieuTinh: q.kieuTinh, giaTri: q.giaTri })),
    };
  }

  // 10–11 — người hưởng + tiền.
  const cacVai: VaiKetQua[] = chon.map((c): VaiKetQua => {
    const goc = { roleCode: c.roleCode, nguonKhongRo: c.ket.nguonKhongRo, lyDo: c.ket.lyDo };
    const rong = { nguoi: [] as NguoiHuong[], lyDoTreo: null, cacPhan: [], duocChi: [], treoPhan: [] };
    if (c.ket.loai === "KHONG_CO") return { ...goc, trangThai: "KHONG_RULE", quyTac: null, tienVai: 0, ...rong };
    const q = c.ket.quyTac;
    if (q.kieuTinh === "EXCLUDE") return { ...goc, trangThai: "EXCLUDE", quyTac: q, tienVai: 0, ...rong };

    const tienVai = tienTheoQuyTac(d.coSo, q);
    const nh = c.nguoiHuong;
    if (nh.loai === "TREO") {
      return { ...goc, trangThai: "TREO", quyTac: q, tienVai, nguoi: [], lyDoTreo: nh.lyDo, cacPhan: [], duocChi: [], treoPhan: [] };
    }
    if (tienVai === 0) return { ...goc, trangThai: "KHONG_TIEN", quyTac: q, tienVai, nguoi: nh.nguoi, lyDoTreo: null, cacPhan: [], duocChi: [], treoPhan: [] };
    const chia = chiaTienChoVai(
      tienVai,
      nh.nguoi.map((n) => n.id),
      new Set(nh.biLoai.map((b) => b.nguoi.id)),
    );
    return { ...goc, trangThai: "SINH_DONG", quyTac: q, tienVai, nguoi: nh.nguoi, lyDoTreo: null, cacPhan: chia.cacPhan, duocChi: chia.duocChi, treoPhan: chia.treo };
  });

  return { loai: "OK", cacVai, tiLeTuongDuong: tran.tiLeTuongDuong };
}
