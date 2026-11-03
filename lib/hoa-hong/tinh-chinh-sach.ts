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
import { chiaTienChoVai, kiemTran, tienCoDinhTheoCoSo, type QuyTacTheoVai } from "./tien";

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

/**
 * «Lần mua» của khoản đang tính, chỉ để quyết `FIXED_PER_PURCHASE` (AFF-L2b). Rule PERCENT KHÔNG đọc nó.
 *   · `laKhoanDau` — khoản này có phải khoản thu ĐẦU của lần mua không (định nghĩa DUY NHẤT ở `lib/hoa-hong/khoan-dau-lan-mua.ts`). Không phải khoản đầu ⇒ rule FIXED không ra tiền VÀ không vào phép kiểm trần.
 *   · `coSoGoc` — cơ sở GỐC của ô (`netBase` của khoản lúc ghi). `coSo` có thể nhỏ hơn (ô đã bị hoàn một phần: kỳ vọng tính trên cơ sở CÒN LẠI); tiền FIXED co theo tỉ lệ `coSo ÷ coSoGoc`, còn phép kiểm trần luôn đo trên `coSoGoc`
 *     (tỉ lệ hiệu dụng `giaTri ÷ coSoGoc` không đổi sau hoàn ⇒ một ô đã ghi không lật sang VUOT_TRAN chỉ vì bị hoàn).
 */
export type LanMuaCuaKhoan = { laKhoanDau: boolean; coSoGoc: number };

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
  /** BẮT BUỘC (luật 7): quên khai là FIXED trả mỗi đợt thu (≥ 2 lần) hoặc không bao giờ trả — `tsc` liệt kê mọi chỗ dựng. */
  lanMua: LanMuaCuaKhoan;
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

/**
 * Chọn quy tắc cho MỘT vai khi nguồn ĐÃ RÕ — MỘT nơi dựng ngữ cảnh chọn (người hưởng · đối tác · campaign · nhóm nguồn). `tinhChinhSachChoPhan` gọi nó cho mọi vai, và `tinh-dong-cho-khoan.ts` gọi lại để biết
 * rule nào SẼ thắng trước khi quyết cửa sổ bảo vệ của campaign (AFF-L2, D-A): hai nơi dựng ngữ cảnh riêng là hai sự thật về "rule nào thắng".
 * `nh` là kết quả người hưởng cần dùng để chọn (thô hay đã lọc tư cách là do chỗ gọi quyết định).
 */
export function chonQuyTacNguonRo(d: DauVaoTinhChinhSach, roleCode: string, nh: KetQuaNguoiHuong): ReturnType<typeof chonQuyTac> {
  // PERSON / AFFILIATE là chiều của NGƯỜI HƯỞNG — chỉ có khi vai có ĐÚNG MỘT người.
  const mot = nh.loai === "CO_NGUOI" && nh.nguoi.length === 1 ? nh.nguoi[0]! : null;
  const nguoiHuongUserId = mot?.kind === "USER" ? mot.id : null;
  const affiliateId = d.nguon.affiliateId ?? (mot?.kind === "AFFILIATE" ? mot.id : null);
  const roleDefIds = nguoiHuongUserId ? [...(d.roleDefIdsTheoNguoi.get(nguoiHuongUserId) ?? [])] : [];
  return chonQuyTac({
    ctx: {
      roleCode,
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
    quyTac: d.hoaHong.quyTac,
    thuTuPhamVi: d.hoaHong.thuTuPhamVi,
  });
}

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

    const r = chonQuyTacNguonRo(d, vai.code, nh);
    if (r.loai === "CHONG_LAN") return { loai: "CHONG_LAN", roleCode: vai.code, lyDo: r.lyDo };
    chon.push({
      roleCode: vai.code,
      nguoiHuong: nh,
      ket: r.loai === "THANG" ? { loai: "THANG", quyTac: r.quyTac, lyDo: r.lyDo, nguonKhongRo: false } : { loai: "KHONG_CO", lyDo: r.lyDo, nguonKhongRo: false },
    });
  }

  // 9 — trần: Σ TỈ LỆ của rule thắng, TRƯỚC lọc tư cách (vai treo vẫn tính).
  // FIXED_PER_PURCHASE: chỉ vào phép kiểm ở khoản thu ĐẦU của lần mua (khoản sau không ra tiền nên không có gì để so), và đo trên `coSoGoc` — cơ sở của khoản đầu — bằng ĐÚNG số tiền cố định:
  // tỉ lệ hiệu dụng = giaTri ÷ cơ sở khoản đầu. Khoản đầu quá nhỏ (vd tiền cọc) làm tỉ lệ vượt trần ⇒ VUOT_TRAN như mọi rule vượt trần: fail-closed, không cắt im lặng, không tự nâng trần (D1).
  const thang: { roleCode: string; q: QuyTac }[] = chon.flatMap((c) => (c.ket.loai === "THANG" ? [{ roleCode: c.roleCode, q: c.ket.quyTac }] : []));
  const choTran: QuyTacTheoVai[] = thang.flatMap(({ roleCode, q }): QuyTacTheoVai[] =>
    q.kieuTinh === "PERCENT"
      ? [{ roleCode, kieuTinh: "PERCENT", rate: q.giaTri }]
      : q.kieuTinh === "FIXED_PER_PURCHASE" && d.lanMua.laKhoanDau
        ? [{ roleCode, kieuTinh: "FIXED_PER_PURCHASE", fixed: Number(q.giaTri) }]
        : [],
  );
  const coFixedTinhTran = choTran.some((q) => q.kieuTinh === "FIXED_PER_PURCHASE");
  // Không có FIXED nào vào phép kiểm ⇒ `coSo` như cũ (kết quả KHÔNG đổi một byte so với trước AFF-L2b).
  const tran = kiemTran({ coSo: coFixedTinhTran ? d.lanMua.coSoGoc : d.coSo, quyTacTheoVai: choTran, tranTongTiLe: hh.tranTongTiLe });
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
    // FIXED_PER_PURCHASE ở khoản KHÔNG phải khoản đầu của lần mua: đã trả (hoặc đã được xét) ở khoản đầu — không ra tiền, KHÔNG hàng chờ, kể cả khi người hưởng đang treo (không có gì để treo).
    if (q.kieuTinh === "FIXED_PER_PURCHASE" && !d.lanMua.laKhoanDau) {
      return { ...goc, lyDo: `${c.ket.lyDo} · số tiền cố định chỉ trả MỘT lần cho mỗi lần mua, tại khoản thu đầu tiên — khoản này không phải khoản đầu`, trangThai: "KHONG_TIEN", quyTac: q, tienVai: 0, ...rong };
    }

    const tienVai = q.kieuTinh === "FIXED_PER_PURCHASE" ? tienCoDinhTheoCoSo(Number(q.giaTri), d.coSo, d.lanMua.coSoGoc) : tienTheoQuyTac(d.coSo, q);
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
