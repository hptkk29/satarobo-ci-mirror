// lib/hoa-hong/tinh-dong-cho-khoan.ts — từ MỘT phần học viên của MỘT khoản thu ra các DÒNG NHÁP của sổ.
//
// Nguồn: docs/source-commission/04 §2 (bước 7–12), §7.2–§7.4 (tư cách), §17 `tinhDongChoKhoan`. THUẦN.
//
// Đây là hàm mà engine thật, thử tính (PR10) và "dự kiến của bạn" (PR9) CÙNG gọi (L11). Nó bọc `tinhChinhSachChoPhan` (PR4:
// chọn quy tắc · trần · tiền vai · chia người) và thêm đúng hai bộ lọc TƯ CÁCH mà PR4 để ngỏ cho PR5:
//
//   · CỬA SỔ 90 NGÀY (04 §7.3): vai `isAcquisition` mà khoản về NGOÀI cửa sổ ⇒ không sinh dòng, nguồn GIỮ NGUYÊN.
//   · ĐÃ TRẢ BẰNG ENGINE CŨ (04 §3.2): GV Trial đã nhận 1% × finalPrice lúc convert ⇒ không trả lần nữa theo đợt thu.
//
// Cả hai chạy SAU trần (trần là luật cấu hình, không đổi theo hôm nay ai nghỉ / khoản về ngày nào) — nên chúng được áp bằng
// cách đổi KẾT QUẢ NGƯỜI HƯỞNG của vai thành "treo", để `tinhChinhSachChoPhan` vẫn đếm rule của vai trong Σ tỉ lệ.
import type { HoaHongContext } from "./kieu";
import type { LyDoTreo, NguoiHuong } from "./nguoi-huong";
import type { QuyTac } from "./chon-quy-tac";
import type { KetQuaNguoiHuong } from "./nguoi-huong";
import { tinhChinhSachChoPhan, type NguonCuaKhoan, type TrangThaiVai, type VaiKetQua } from "./tinh-chinh-sach";

export type DauVaoKhoan = {
  hoaHong: HoaHongContext;
  loaiGiaoDich: "NEW" | "RENEWAL";
  /** `netBase` của phần học phí (VND, ≥ 0). */
  coSo: number;
  /** Ngày GỐC của tiền. */
  rateDate: Date;
  /** Đơn vị của GIAO DỊCH. */
  orgUnitPath: string;
  nguon: NguonCuaKhoan;
  /** Kết quả người hưởng THÔ của từng vai có chính sách (kể cả vai treo). */
  nguoiHuong: ReadonlyMap<string, KetQuaNguoiHuong>;
  roleDefIdsTheoNguoi: ReadonlyMap<string, readonly string[]>;
  /** Khoản về NGOÀI cửa sổ ghi công của lead ⇒ vai `isAcquisition` bị loại tư cách. BẮT BUỘC (luật 7). */
  ngoaiCuaSo: boolean;
  /** `User.id` đã nhận GV Trial bằng engine CŨ cho đúng ghi danh này (04 §3.2). BẮT BUỘC (luật 7). */
  daTraBangEngineCu: ReadonlySet<string>;
};

export type LyDoLoaiTuCach = LyDoTreo;

/**
 * Lý do "treo" mà người vận hành KHÔNG cần thấy trong hàng chờ vì đó là trạng thái BÌNH THƯỜNG, không phải thiếu dữ liệu:
 *   · KHONG_CO_GV_TRIAL / THIEU_NGUOI_GIOI_THIEU — phần lớn khoản thu không có GV trial hay người giới thiệu; hàng chờ nguồn
 *     (PR2) đã canh ca "nhóm cần người mà chưa có người".
 *   · NGOAI_CUA_SO / LEGACY_DA_TRA — luật tất định, không còn gì để người quyết (04 §3.2, §7.3).
 * Ngược lại KHONG_CO_LEAD, LEAD_THIEU_NGUOI, CHUA_KHAI_NGUOI_PHU_TRACH, KHONG_QUY_VE_CO_SO, NGUOI_HUONG_NGHI… là DỮ LIỆU
 * THIẾU ⇒ hàng chờ mềm `UNRESOLVED_BENEFICIARY` (04 §7.1).
 */
const TREO_IM_LANG: ReadonlySet<LyDoLoaiTuCach> = new Set<LyDoLoaiTuCach>([
  "KHONG_CO_GV_TRIAL",
  "THIEU_NGUOI_GIOI_THIEU",
  "NGOAI_CUA_SO",
  "LEGACY_DA_TRA",
]);

export type DongNhap = {
  roleCode: string;
  beneficiaryKind: "USER" | "AFFILIATE";
  beneficiaryId: string;
  /** > 0 */
  amount: number;
  /** Tiền của CẢ vai (trước khi chia người). */
  tienVai: number;
  quyTac: QuyTac;
  /** "Vì sao rule thắng" (04 §6.3). */
  lyDo: string;
  nguonKhongRo: boolean;
  /** Căn cứ phân giải người hưởng (vd `LEAD_CONVERTED_BY`, `ASSIGNEE_QC@cs1`). */
  canCu: string;
};

export type TreoNhap = {
  roleCode: string;
  lyDo: LyDoLoaiTuCach;
  /** Tiền CÓ THỂ đã sinh nếu có người (cả vai, hoặc phần của người bị loại). */
  tienVai: number;
  canCu: string;
  quyTac: QuyTac;
  /** Người bị loại (nghỉ việc…) — vắng khi cả vai treo. */
  recipientId: string | null;
  /** Có ghi hàng chờ mềm `UNRESOLVED_BENEFICIARY` không. */
  coHangCho: boolean;
};

export type VaiKhongTien = { roleCode: string; trangThai: Exclude<TrangThaiVai, "SINH_DONG" | "TREO">; lyDo: string };

export type KetQuaTinhKhoan =
  | {
      loai: "OK";
      dong: DongNhap[];
      treo: TreoNhap[];
      vaiKhongTien: VaiKhongTien[];
      tiLeTuongDuong: number;
      /** Kết quả từng vai nguyên bản — cho ngăn "Vì sao" (06 §2.3). */
      cacVai: VaiKetQua[];
    }
  | {
      loai: "VUOT_TRAN";
      tiLeTuongDuong: number;
      tran: number;
      quyTacThang: { roleCode: string; ruleId: string; kieuTinh: QuyTac["kieuTinh"]; giaTri: number | string }[];
    }
  | { loai: "CHONG_LAN"; roleCode: string; lyDo: string };

const treoTuCach = (lyDo: LyDoLoaiTuCach, canCu: string): KetQuaNguoiHuong => ({ loai: "TREO", lyDo, canCu });

/** Áp hai bộ lọc tư cách bằng cách đổi kết quả người hưởng của vai thành "treo". Không đụng vai không bị ảnh hưởng. */
function apDungTuCach(d: DauVaoKhoan): Map<string, KetQuaNguoiHuong> {
  const out = new Map<string, KetQuaNguoiHuong>();
  const laAcq = new Set(d.hoaHong.vaiHuong.filter((v) => v.isAcquisition).map((v) => v.code));
  for (const [code, nh] of d.nguoiHuong) {
    if (nh.loai !== "CO_NGUOI") {
      out.set(code, nh);
      continue;
    }
    if (laAcq.has(code) && d.ngoaiCuaSo) {
      out.set(code, treoTuCach("NGOAI_CUA_SO", `${nh.canCu}: khoản về ngoài cửa sổ ghi công`));
      continue;
    }
    if (code === "TRIAL_TEACHER" && d.daTraBangEngineCu.size > 0) {
      const con = nh.nguoi.filter((n) => !(n.kind === "USER" && d.daTraBangEngineCu.has(n.id)));
      if (con.length === 0) {
        out.set(code, treoTuCach("LEGACY_DA_TRA", `${nh.canCu}: đã nhận 1% lúc convert bằng engine cũ`));
        continue;
      }
      if (con.length < nh.nguoi.length) {
        out.set(code, { ...nh, nguoi: con, biLoai: nh.biLoai.filter((b) => con.some((n) => n.id === b.nguoi.id)) });
        continue;
      }
    }
    out.set(code, nh);
  }
  return out;
}

export function tinhDongChoKhoan(d: DauVaoKhoan): KetQuaTinhKhoan {
  const r = tinhChinhSachChoPhan({
    hoaHong: d.hoaHong,
    loaiGiaoDich: d.loaiGiaoDich,
    coSo: d.coSo,
    rateDate: d.rateDate,
    orgUnitPath: d.orgUnitPath,
    nguon: d.nguon,
    nguoiHuong: apDungTuCach(d),
    roleDefIdsTheoNguoi: d.roleDefIdsTheoNguoi,
  });
  if (r.loai === "VUOT_TRAN") return r;
  if (r.loai === "CHONG_LAN") return r;

  const dong: DongNhap[] = [];
  const treo: TreoNhap[] = [];
  const vaiKhongTien: VaiKhongTien[] = [];
  for (const v of r.cacVai) {
    const nh = d.nguoiHuong.get(v.roleCode);
    const canCu = nh?.canCu ?? "";
    if (v.trangThai === "SINH_DONG" && v.quyTac) {
      for (const p of v.duocChi) {
        if (p.amount <= 0) continue;
        const nguoi = v.nguoi.find((n) => n.id === p.recipientId) as NguoiHuong;
        dong.push({
          roleCode: v.roleCode,
          beneficiaryKind: nguoi.kind,
          beneficiaryId: nguoi.id,
          amount: p.amount,
          tienVai: v.tienVai,
          quyTac: v.quyTac,
          lyDo: v.lyDo,
          nguonKhongRo: v.nguonKhongRo,
          canCu: canCu || v.lyDo,
        });
      }
      for (const p of v.treoPhan) {
        treo.push({
          roleCode: v.roleCode,
          lyDo: "NGUOI_HUONG_NGHI",
          tienVai: p.amount,
          canCu,
          quyTac: v.quyTac,
          recipientId: p.recipientId,
          coHangCho: true,
        });
      }
    } else if (v.trangThai === "TREO" && v.quyTac) {
      const lyDo: LyDoLoaiTuCach = v.lyDoTreo ?? "RESOLVER_KHONG_BIET";
      treo.push({
        roleCode: v.roleCode,
        lyDo,
        tienVai: v.tienVai,
        canCu,
        quyTac: v.quyTac,
        recipientId: null,
        coHangCho: !TREO_IM_LANG.has(lyDo),
      });
    } else if (v.trangThai !== "SINH_DONG" && v.trangThai !== "TREO") {
      vaiKhongTien.push({ roleCode: v.roleCode, trangThai: v.trangThai, lyDo: v.lyDo });
    }
  }
  // Tất định: sắp theo (roleCode, beneficiaryKind, beneficiaryId) — thứ tự ghi không phụ thuộc thứ tự vai nạp.
  dong.sort((a, b) =>
    a.roleCode !== b.roleCode ? (a.roleCode < b.roleCode ? -1 : 1) : a.beneficiaryId < b.beneficiaryId ? -1 : a.beneficiaryId > b.beneficiaryId ? 1 : 0,
  );
  return { loai: "OK", dong, treo, vaiKhongTien, tiLeTuongDuong: r.tiLeTuongDuong, cacVai: r.cacVai };
}
