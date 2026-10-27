/**
 * lib/affiliate/bao-cao.ts — LÕI THUẦN của khối «Hiệu quả» trên trang chi tiết campaign (AFF-P3 H1). Không DB, không đồng hồ ẩn: test không cần Postgres.
 *
 * Mọi con số trong khối này phải NÓI THẬT thứ nó đếm (luật 12). Ba điều quyết định hình dạng của tệp này:
 *   · Lượt bấm (`ReferralClick`) là dữ liệu TOÀN HỆ (không có cơ sở, không PII); referral / chuyển đổi đi qua `scopedDb` (cắt theo cơ sở người xem); hoa hồng đi qua `phamViNguoiXem`. Ba tầng phạm vi
 *     khác nhau ⇒ KHÔNG chia số tầng này cho số tầng kia trừ khi người xem thấy `TAT_CA` (`tiLe` nhận cờ đó từ nơi gọi).
 *   · Khoảng ngày chỉ áp cho lượt bấm / referral / chuyển đổi (cùng một cột thời điểm phát sinh của mỗi bước). Hoa hồng KHÔNG theo khoảng ngày: sổ ghi theo KỲ và có dòng hoàn về sau, nên một tổng
 *     «trong 30 ngày» sẽ không khớp màn Sổ cho cùng bộ lọc. Khối nói thẳng điều đó.
 *   · «Đã đăng ký» = referral HỢP LỆ mà phiếu khách đã `convertedAt` (dấu «đã chốt» thật của convert-lead), KHÔNG suy từ `Lead.status`.
 */
import { congNgay, dauNgayTuChuoi, laNgayHopLe, ngayVN, soNgayGiua } from "@/lib/format/thoi-gian-vn";
import { NHAN_CHUOI_LINK_KHONG_HOP_LE, type MaChuoiLinkKhongHopLe } from "./ghi-link-dau-vao";
import { demRong, type DemTheoTrangThaiReferral, type TrangThaiReferral } from "./ghi-referral-dau-vao";

// ── Quyền ────────────────────────────────────────────────────────────────────────────────────────

/** Khoá nào người xem có — mỗi khối chỉ được TRUY VẤN khi có khoá của nó. BẮT BUỘC khai đủ ba (không mặc định, luật 7). Dựng bằng `quyenBaoCaoTuScope` (`quyen-bao-cao.ts`). */
export type QuyenBaoCao = { luotBam: boolean; referral: boolean; hoaHong: boolean };

// ── Khoảng ngày ──────────────────────────────────────────────────────────────────────────────────

export const SO_NGAY_MAC_DINH = 30;
export const SO_NGAY_TOI_DA = 366;

export type KhoangNgay = {
  /** Ngày VN, gồm đầu mút (`YYYY-MM-DD`). */
  tu: string;
  den: string;
  /** Mốc DƯỚI (gồm) và TRÊN (loại) để lọc cột Timestamptz: 00:00 VN của `tu` … 00:00 VN của ngày SAU `den`. */
  tuLuc: Date;
  denLuc: Date;
  /** Đang dùng khoảng mặc định (30 ngày gần nhất) — vì người dùng không chọn, hoặc chọn không hợp lệ. */
  macDinh: boolean;
  /** Có giá trị người dùng gõ bị bỏ vì sai ⇒ câu cho người đọc. */
  canhBao: string | null;
};

/**
 * Khoảng ngày của báo cáo. `now` BẮT BUỘC (luật 19): mặc định là «30 ngày gần nhất» tính từ đồng hồ TRUYỀN VÀO, gồm cả hôm nay.
 * Chỉ nhận ngày có thật trên lịch, `tu ≤ den`, dài tối đa 366 ngày; sai ⇒ rơi về mặc định KÈM cảnh báo (không im lặng đổi khoảng).
 */
export function giaiKhoangNgay(p: { tu: string | null; den: string | null; now: Date }): KhoangNgay {
  const homNay = ngayVN(p.now);
  const macDinh = (canhBao: string | null): KhoangNgay => {
    const den = homNay;
    const tu = congNgay(den, -(SO_NGAY_MAC_DINH - 1));
    return { tu, den, tuLuc: dauNgayTuChuoi(tu), denLuc: dauNgayTuChuoi(congNgay(den, 1)), macDinh: true, canhBao };
  };
  if (p.tu === null && p.den === null) return macDinh(null);
  if (p.tu === null || p.den === null) return macDinh("Cần chọn cả ngày bắt đầu lẫn ngày kết thúc — đang hiện 30 ngày gần nhất.");
  if (!laNgayHopLe(p.tu) || !laNgayHopLe(p.den)) return macDinh("Ngày không hợp lệ — đang hiện 30 ngày gần nhất.");
  if (p.tu > p.den) return macDinh("Ngày bắt đầu sau ngày kết thúc — đang hiện 30 ngày gần nhất.");
  if (soNgayGiua(p.tu, p.den) + 1 > SO_NGAY_TOI_DA) return macDinh(`Khoảng chọn dài quá ${SO_NGAY_TOI_DA} ngày — đang hiện 30 ngày gần nhất.`);
  return { tu: p.tu, den: p.den, tuLuc: dauNgayTuChuoi(p.tu), denLuc: dauNgayTuChuoi(congNgay(p.den, 1)), macDinh: false, canhBao: null };
}

// ── Lượt bấm ─────────────────────────────────────────────────────────────────────────────────────

export type NhomLyDoBamLoi = { ma: string; nhan: string; n: number };

export type TomTatLuotBam = {
  tong: number;
  /** Lượt bấm vào link đang dùng được (`outcome = OK`). */
  hopLe: number;
  /** Lượt bấm vào link ĐÃ không dùng được (thu hồi, hết hạn, đối tác ngừng…) — báo cáo «link chết còn bị bấm». */
  khongDung: number;
  theoLyDo: NhomLyDoBamLoi[];
};

const laMaBiet = (v: string): v is MaChuoiLinkKhongHopLe => Object.prototype.hasOwnProperty.call(NHAN_CHUOI_LINK_KHONG_HOP_LE, v);

export function tomTatLuotBam(theoKetCuc: readonly { outcome: string; n: number }[]): TomTatLuotBam {
  let hopLe = 0;
  const loi = new Map<string, number>();
  for (const r of theoKetCuc) {
    if (r.outcome === "OK") hopLe += r.n;
    else loi.set(r.outcome, (loi.get(r.outcome) ?? 0) + r.n);
  }
  const theoLyDo = [...loi.entries()]
    .map(([ma, n]): NhomLyDoBamLoi => ({ ma, nhan: laMaBiet(ma) ? NHAN_CHUOI_LINK_KHONG_HOP_LE[ma] : `Lý do khác (${ma})`, n }))
    .sort((a, b) => b.n - a.n || (a.ma < b.ma ? -1 : 1));
  const khongDung = theoLyDo.reduce((s, x) => s + x.n, 0);
  return { tong: hopLe + khongDung, hopLe, khongDung, theoLyDo };
}

// ── Tỉ lệ ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Tỉ lệ phần trăm làm tròn 1 chữ số, hoặc `null` khi KHÔNG nên hiện: mẫu bằng 0 (chia cho 0 / «0%» của một tập rỗng là con số không có nghĩa) hoặc `soSanhDuoc = false`
 * (tử và mẫu đến từ hai phạm vi khác nhau — vd lượt bấm TOÀN HỆ chia cho referral CỦA CƠ SỞ MÌNH).
 */
export function tiLe(tu: number, mau: number, soSanhDuoc: boolean): number | null {
  if (!soSanhDuoc || mau <= 0) return null;
  return Math.round((tu / mau) * 1000) / 10;
}

// ── Theo đối tác ─────────────────────────────────────────────────────────────────────────────────

export const TOI_DA_DOI_TAC_HIEN = 50;

export type DongDoiTac = {
  partyId: string;
  ten: string;
  ma: string;
  luotBam: number;
  luotBamLoi: number;
  referral: DemTheoTrangThaiReferral;
  /** VALID ∧ phiếu đã chốt (`convertedAt`). */
  daDangKy: number;
  /** null = người xem KHÔNG có quyền xem sổ (khác 0 đồng). */
  hoaHong: { soDong: number; tien: number } | null;
};

export type DauVaoGopDoiTac = {
  luotBam: readonly { partyId: string; outcome: string; n: number }[];
  referral: readonly { partyId: string; status: TrangThaiReferral; n: number }[];
  daDangKy: readonly { partyId: string; n: number }[];
  /** null = không xem được sổ. */
  tien: readonly { partyId: string; soDong: number; tien: number }[] | null;
  danhTinh: ReadonlyMap<string, { ten: string; ma: string }>;
};

/**
 * Gộp các nhóm đếm thành MỘT dòng cho mỗi đối tác, xếp theo «đã đăng ký» ↓, «hợp lệ» ↓, lượt bấm ↓, tên. Cắt ở `TOI_DA_DOI_TAC_HIEN` và trả `biCat` để màn nói «còn N đối tác khác» chứ
 * không lặng lẽ giấu. Đối tác không còn tên trong `danhTinh` vẫn có dòng (mã id rút gọn) — không bỏ số của họ.
 */
export function gopTheoDoiTac(d: DauVaoGopDoiTac, toiDa = TOI_DA_DOI_TAC_HIEN): { dong: DongDoiTac[]; biCat: number } {
  const ra = new Map<string, DongDoiTac>();
  const lay = (partyId: string): DongDoiTac => {
    let r = ra.get(partyId);
    if (!r) {
      const dt = d.danhTinh.get(partyId);
      r = { partyId, ten: dt?.ten ?? `Đối tác ${partyId.slice(-6).toUpperCase()}`, ma: dt?.ma ?? "", luotBam: 0, luotBamLoi: 0, referral: demRong(), daDangKy: 0, hoaHong: d.tien === null ? null : { soDong: 0, tien: 0 } };
      ra.set(partyId, r);
    }
    return r;
  };
  for (const x of d.luotBam) {
    const r = lay(x.partyId);
    if (x.outcome === "OK") r.luotBam += x.n;
    else r.luotBamLoi += x.n;
  }
  for (const x of d.referral) lay(x.partyId).referral[x.status] += x.n;
  for (const x of d.daDangKy) lay(x.partyId).daDangKy += x.n;
  for (const x of d.tien ?? []) {
    const r = lay(x.partyId);
    if (r.hoaHong) {
      r.hoaHong.soDong += x.soDong;
      r.hoaHong.tien += x.tien;
    }
  }
  const tatCa = [...ra.values()].sort(
    (a, b) => b.daDangKy - a.daDangKy || b.referral.VALID - a.referral.VALID || b.luotBam - a.luotBam || (a.ten < b.ten ? -1 : a.ten > b.ten ? 1 : a.partyId < b.partyId ? -1 : 1),
  );
  return { dong: tatCa.slice(0, toiDa), biCat: Math.max(0, tatCa.length - toiDa) };
}
