// lib/phan-cong/chon-nguoi-truc.ts — TỰ XẾP học bù / Trial cho NGƯỜI ĐANG TRỰC (GĐ5, docs/phan-cong-gop/KHAO-SAT.md chốt 2, 3, 11). THUẦN.
//
// Một hàm cho câu hỏi "buổi học bù / Trial này giao ai": người TRỰC đúng ca của buổi tại cơ sở (ca xếp bằng `xepBuoiVaoCa`, hoà phút ⇒
// ca có người trực, vẫn hoà ⇒ ca sau — chốt 11). Nhiều người trực ⇒ bốn tầng hoà (chốt 3):
//   1. KHÔNG bận giờ (không có việc dạy nào của chính họ chồng giờ buổi, ở bất kỳ cơ sở nào);
//   2. ít tiết hơn trong buổi (ca) đó;
//   3. ít buổi học bù / Trial hơn trong tháng (chia đều);
//   4. mã nhân viên tăng dần (người chưa có mã xếp cuối, rồi theo id — tất định).
// Trial: chỉ người có CHỨNG NHẬN Trial còn hiệu lực tại ngày buổi (không có ⇒ coi như không ai trực — advisor GĐ5; tiền hỗ trợ Trial
// đòi chứng nhận, giao cho người không có là sinh `CERTIFICATE_MISSING`).
// Không ai ⇒ `userId: null` + lý do ⇒ nơi gọi đi ĐƯỜNG LÙI (ô chọn GV cũ) và màn Phân công đánh dấu buổi (chốt 2).
// ⚠️ CHƯA NỐI vào luồng book (QUYET-DINH-DEM G5-*).
import type { KhungCa } from "./ma-o";
import { xepBuoiVaoCa } from "./ma-o";
import { phutTrongNgay } from "@/lib/parttime/chinh-sach";

export type UngVienTruc = {
  userId: string;
  maNv: string | null;
  /** Ca người này trực tại cơ sở của buổi, ngày của buổi. */
  caTruc: readonly string[];
  /** Mọi việc dạy còn sống trong ngày (mọi cơ sở) — để xét bận giờ + đếm tiết trong ca. */
  viec: readonly { gioBatDau: string; gioKetThuc: string; ca: string | null }[];
  /** Số buổi học bù + Trial đã nhận trong tháng của buổi. */
  soBuTrialThang: number;
  /** Chứng nhận Trial còn hiệu lực tại ngày buổi. */
  coChungNhanTrial: boolean;
};

export type KetQuaChon =
  | { userId: string; ca: string; tang: 1 | 2 | 3 | 4 | 0 }
  | { userId: null; ca: string | null; lyDo: "NGOAI_KHUNG" | "KHONG_AI_TRUC" | "KHONG_AI_CO_CHUNG_NHAN" };

const chong = (a: { gioBatDau: string; gioKetThuc: string }, b: { gioBatDau: string; gioKetThuc: string }) =>
  phutTrongNgay(a.gioBatDau) < phutTrongNgay(b.gioKetThuc) && phutTrongNgay(b.gioBatDau) < phutTrongNgay(a.gioKetThuc);

export function chonNguoiTruc(p: {
  ca: readonly KhungCa[];
  loai: "BU" | "TRIAL";
  gioBatDau: string;
  gioKetThuc: string;
  ungVien: readonly UngVienTruc[];
}): KetQuaChon {
  const caCoTruc = [...new Set(p.ungVien.flatMap((u) => u.caTruc))];
  const ca = xepBuoiVaoCa({ ca: p.ca, gioBatDau: p.gioBatDau, gioKetThuc: p.gioKetThuc, caCoTruc });
  if (!ca) return { userId: null, ca: null, lyDo: "NGOAI_KHUNG" };
  const truc = p.ungVien.filter((u) => u.caTruc.includes(ca));
  if (!truc.length) return { userId: null, ca, lyDo: "KHONG_AI_TRUC" };
  const du = p.loai === "TRIAL" ? truc.filter((u) => u.coChungNhanTrial) : truc;
  if (!du.length) return { userId: null, ca, lyDo: "KHONG_AI_CO_CHUNG_NHAN" };

  const buoi = { gioBatDau: p.gioBatDau, gioKetThuc: p.gioKetThuc };
  const khoa = (u: UngVienTruc) =>
    [
      u.viec.some((v) => chong(v, buoi)) ? 1 : 0, // 1. bận giờ xếp sau
      u.viec.filter((v) => v.ca === ca).length, // 2. ít tiết trong ca
      u.soBuTrialThang, // 3. ít học bù / Trial trong tháng
    ] as const;
  const xep = [...du].sort((a, b) => {
    const [x, y] = [khoa(a), khoa(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    if (a.maNv !== b.maNv) return a.maNv == null ? 1 : b.maNv == null ? -1 : a.maNv.localeCompare(b.maNv, "en");
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  // Tầng QUYẾT ĐỊNH: tầng đầu tiên mà người thắng khác người thứ hai (0 = chỉ một ứng viên).
  let tang: 0 | 1 | 2 | 3 | 4 = 0;
  if (xep.length > 1) {
    const [x, y] = [khoa(xep[0]!), khoa(xep[1]!)];
    tang = x[0] !== y[0] ? 1 : x[1] !== y[1] ? 2 : x[2] !== y[2] ? 3 : 4;
  }
  return { userId: xep[0]!.userId, ca, tang };
}
