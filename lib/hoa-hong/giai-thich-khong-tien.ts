// lib/hoa-hong/giai-thich-khong-tien.ts — GIẢI THÍCH vì sao một vai KHÔNG phát sinh tiền ở một khoản thu (Hướng G). THUẦN — không DB, không đồng hồ.
//
// Vấn đề: khoản thu đầu tiên của lần mua nằm NGOÀI cửa sổ ghi công thì vai thu hút (`isAcquisition`) bị loại tư cách → 0 dòng sổ, 0 hàng chờ (mã `NGOAI_CUA_SO` nằm trong
// `TREO_IM_LANG`). Nguồn VẪN giữ nguyên (báo cáo nguồn không đổi) nhưng 1% biến mất mà không màn nào nói vì sao (08 §14 mục 22, R1-M3).
//
// Vì sao KHÔNG dòng 0đ trong sổ / KHÔNG hàng chờ / KHÔNG tính lại lúc đọc (sc2.md §2):
//   · sổ có CHECK `amount <> 0` và mọi tổng · kỳ · bảng chi · đối soát đọc nó;
//   · hàng chờ là bảng công việc — thêm việc không ai làm là làm hỏng chính hàng chờ (đó là lý do `TREO_IM_LANG` tồn tại);
//   · tính lại lúc đọc dùng chủ nguồn / chính sách / tỉ lệ CỦA HÔM NAY, không phải của ngày ghi ⇒ lịch sử tiền "trôi".
// Nên: một bảng CHỈ-THÊM `CommissionExplainLine`, ghi cùng giao dịch với ô tính (`giai-thich-db.ts`).
//
// Tệp này là phần THUẦN: (1) bảng ánh xạ `LyDoTreo → reasonCode` (chỉ NGOAI_CUA_SO được bật; thiết kế chứa được mã khác — thêm một dòng ở `MA_THEO_LY_DO_TREO`),
// (2) `dungGiaiThich` dựng các dòng từ `kq.treo`, (3) `dungNhanGiaiThich` dựng chữ cho người đọc.
//
// ⚠️ Giải thích KHÔNG BAO GIỜ đi vào `hashCuaKetQua`: nó là hệ quả của kết quả tính, không phải đầu vào. Đưa nó vào hash là INPUT_DRIFT giả ở mọi ô cũ (ca `[GTK-04]`).
// ⚠️ `lib/` không so mã nguồn ("PAID_ADS"…): tên nguồn / vai / chính sách trên màn LẤY TỪ DỮ LIỆU (lưới `[DYN-NOHARD]`).
import { ngayVN, soNgayGiua } from "@/lib/format/thoi-gian-vn";
import { hanCuaSoGhiCong } from "@/lib/nguon/cua-so-ghi-cong";

import type { QuyTac } from "./chon-quy-tac";
import type { LyDoTreo, NguoiHuong } from "./nguoi-huong";
import { dinhDangDong, phanTram } from "./vi-sao";
import { chiaTienChoVai } from "./tien";
import type { TreoNhap } from "./tinh-dong-cho-khoan";

// ── Mã lý do ────────────────────────────────────────────────────────────────────────────────────────────────

export const MA_LY_DO_GIAI_THICH = ["ATTRIBUTION_WINDOW_EXPIRED"] as const;
export type MaLyDoGiaiThich = (typeof MA_LY_DO_GIAI_THICH)[number];

/**
 * `LyDoTreo` → mã giải thích. CHỈ lý do có ở đây mới được giải thích; lý do khác trả `null` ⇒ không sinh dòng (ca `[GTK-05]`).
 * Hướng G bật đúng MỘT mã. Các chỗ "rơi vô hình" khác (THIEU_NGUOI_GIOI_THIEU · LEGACY_DA_TRA · EXCLUDE · RENEWAL không policy) là nợ có chủ đích — 08 §14 mục «Các chỗ khác đang rơi vô hình».
 */
export const MA_THEO_LY_DO_TREO: Readonly<Partial<Record<LyDoTreo, MaLyDoGiaiThich>>> = {
  NGOAI_CUA_SO: "ATTRIBUTION_WINDOW_EXPIRED",
};

export function maGiaiThichCua(lyDo: LyDoTreo): MaLyDoGiaiThich | null {
  return Object.prototype.hasOwnProperty.call(MA_THEO_LY_DO_TREO, lyDo) ? (MA_THEO_LY_DO_TREO[lyDo] ?? null) : null;
}

/** Mã lạ (đọc từ DB) ⇒ `null`: KHÔNG bịa nhãn. */
export function laMaGiaiThich(ma: unknown): ma is MaLyDoGiaiThich {
  return typeof ma === "string" && (MA_LY_DO_GIAI_THICH as readonly string[]).includes(ma);
}

// ── Cửa sổ ghi công (đầu vào) ──────────────────────────────────────────────────────────────────────────────

/** Ba số quyết định "ngoài cửa sổ": ngày quy nguồn · ngày thu ĐẦU của lần mua · số ngày của cửa sổ hiệu lực. BẮT BUỘC có mặt cùng nhau. */
export type CuaSoGhiCong = { attributedAt: Date; ngayThuDau: Date; cuaSoNgay: number };

export type ChiTietCuaSo = {
  /** ISO. */
  attributedAt: string;
  /** ISO. */
  ngayThuDau: string;
  cuaSoNgay: number;
  /** Ngày VN cuối cùng còn ghi công ("YYYY-MM-DD"). */
  hanGhiCong: string;
  /** Số ngày khoản thu đầu tiên đến SAU hạn (≥ 1 khi thật sự ngoài cửa sổ). */
  soNgayTre: number;
};

export function chiTietCuaSo(c: CuaSoGhiCong): ChiTietCuaSo {
  const han = ngayVN(hanCuaSoGhiCong(c.attributedAt, c.cuaSoNgay));
  return {
    attributedAt: c.attributedAt.toISOString(),
    ngayThuDau: c.ngayThuDau.toISOString(),
    cuaSoNgay: c.cuaSoNgay,
    hanGhiCong: han,
    soNgayTre: soNgayGiua(han, ngayVN(c.ngayThuDau)),
  };
}

// ── Dựng dòng giải thích ───────────────────────────────────────────────────────────────────────────────────

/** Khoá người trong dòng giải thích: `USER:<id>` · `AFFILIATE:<id>` · `-` (chưa biết người). Cột NOT NULL để UNIQUE có tác dụng. */
export function khoaNguoiGiaiThich(n: NguoiHuong | null): string {
  return n ? `${n.kind}:${n.id}` : "-";
}

export type DongGiaiThichNhap = {
  roleCode: string;
  reasonCode: MaLyDoGiaiThich;
  beneficiaryKey: string;
  beneficiaryKind: "USER" | "AFFILIATE" | null;
  beneficiaryId: string | null;
  /** Tiền LẼ RA có (phần của riêng người này) — KHÔNG phải khoản nợ. > 0. */
  wouldBeAmount: number;
  /** Tiền của CẢ vai trước khi chia người. */
  tienVai: number;
  quyTac: QuyTac;
  chiTiet: ChiTietCuaSo;
};

export type DauVaoGiaiThich = {
  /** `kq.treo` của `tinhDongChoKhoan`. */
  treo: readonly TreoNhap[];
  /** Cửa sổ của khoản; `null` = không có vai thu hút / nguồn không rõ ⇒ không có gì để giải thích bằng cửa sổ. BẮT BUỘC (luật 7). */
  cuaSo: CuaSoGhiCong | null;
};

/**
 * Từ `kq.treo` ra các dòng giải thích. Mỗi (vai × người) một dòng; tiền "lẽ ra" chia bằng CHÍNH `chiaTienChoVai` mà engine dùng để chia tiền thật — không công thức thứ hai.
 *   · lý do không có trong bảng ánh xạ ⇒ bỏ qua;
 *   · không có cửa sổ ⇒ bỏ qua (không bịa số ngày);
 *   · `tienVai = 0` hoặc phần chia 0đ ⇒ bỏ qua: không có gì bị mất thì không có gì để giải thích.
 * Thứ tự tất định theo (roleCode, beneficiaryKey).
 */
export function dungGiaiThich(d: DauVaoGiaiThich): DongGiaiThichNhap[] {
  const ra: DongGiaiThichNhap[] = [];
  for (const t of d.treo) {
    const ma = maGiaiThichCua(t.lyDo);
    if (ma === null || d.cuaSo === null || t.tienVai <= 0) continue;
    const chiTiet = chiTietCuaSo(d.cuaSo);
    const mon = (nguoi: NguoiHuong | null, soTien: number): DongGiaiThichNhap => ({
      roleCode: t.roleCode,
      reasonCode: ma,
      beneficiaryKey: khoaNguoiGiaiThich(nguoi),
      beneficiaryKind: nguoi ? nguoi.kind : null,
      beneficiaryId: nguoi ? nguoi.id : null,
      wouldBeAmount: soTien,
      tienVai: t.tienVai,
      quyTac: t.quyTac,
      chiTiet,
    });
    if (t.nguoiDuKien.length === 0) {
      ra.push(mon(null, t.tienVai));
      continue;
    }
    const theoId = new Map(t.nguoiDuKien.map((n) => [n.id, n] as const));
    for (const p of chiaTienChoVai(t.tienVai, t.nguoiDuKien.map((n) => n.id), new Set()).cacPhan) {
      if (p.amount > 0) ra.push(mon(theoId.get(p.recipientId)!, p.amount));
    }
  }
  return ra.sort((a, b) => (a.roleCode !== b.roleCode ? (a.roleCode < b.roleCode ? -1 : 1) : a.beneficiaryKey < b.beneficiaryKey ? -1 : a.beneficiaryKey > b.beneficiaryKey ? 1 : 0));
}

// ── Chữ cho người đọc ──────────────────────────────────────────────────────────────────────────────────────

/** Một dòng giải thích ĐÃ ĐỌC từ DB (+ vài tên tra theo id). Chỉ dữ liệu thuần — không Date, không Decimal. */
export type DongGiaiThichDoc = {
  id: string;
  reasonCode: string;
  roleCode: string;
  tenVai: string;
  tenNhom: string;
  /** Tên chính sách HÔM NAY (hiển thị); số hiệu + phiên bản là ảnh chụp. */
  tenChinhSach: string | null;
  documentNumber: string;
  versionNo: number;
  calcKind: string;
  rate: number | null;
  fixedAmount: number | null;
  wouldBeAmount: number;
  chiTiet: ChiTietCuaSo | null;
  /** Đã có dòng sổ cho (ô × vai × người) này ⇒ giải thích không còn mô tả hiện trạng. */
  daCoTien: boolean;
};

/** Dòng giải thích kèm TÊN người hưởng dự kiến — hình dạng ngăn «Vì sao» cần. */
export type DongKhongPhatSinhTho = DongGiaiThichDoc & { tenNguoiHuong: string | null };

export type NhanGiaiThich = {
  nguon: string;
  chinhSach: string;
  dieuKien: string;
  lyDo: string;
  lyDoMa: string;
  hoaHong: string;
  leRa: string;
  /** Có ⇒ dòng "Đã được thay thế" (đã có tiền thật cho vai này). */
  thayThe: string | null;
};

const ddmmyyyy = (iso: string): string => {
  const [y, m, d] = ngayVN(new Date(iso)).split("-");
  return `${d}/${m}/${y}`;
};
const ddmmyyyyNgay = (ngay: string): string => {
  const [y, m, d] = ngay.split("-");
  return `${d}/${m}/${y}`;
};

function chuyenDoi(d: Pick<DongGiaiThichDoc, "calcKind" | "rate" | "fixedAmount">): string {
  if (d.calcKind === "PERCENT" && d.rate !== null) return phanTram(d.rate);
  if (d.calcKind === "FIXED_PER_PURCHASE" && d.fixedAmount !== null) return `${dinhDangDong(d.fixedAmount)} / lần mua`;
  return "Không theo tỉ lệ";
}

/**
 * Câu lý do theo MÃ. Mã lạ ⇒ chính mã (không bịa). `ATTRIBUTION_WINDOW_EXPIRED` nói ba con số của cửa sổ: ngày thu đầu tiên · hạn ghi công · số ngày trễ.
 */
export function cauLyDoGiaiThich(ma: string, c: ChiTietCuaSo | null): string {
  if (ma === "ATTRIBUTION_WINDOW_EXPIRED") {
    if (!c) return "Khoản thu đầu tiên của lần mua nằm ngoài cửa sổ ghi công.";
    return `Khoản thu đầu tiên ${ddmmyyyy(c.ngayThuDau)} sau hạn ghi công ${ddmmyyyyNgay(c.hanGhiCong)} (trễ ${c.soNgayTre} ngày; cửa sổ ${c.cuaSoNgay} ngày kể từ ${ddmmyyyy(c.attributedAt)}).`;
  }
  return ma;
}

/** Lý do NGẮN cho ô bảng («Quá hạn 9 ngày» — đủ ngắn để không bị cắt ở cột 9,5rem). Mã lạ ⇒ chính mã. Câu đầy đủ ở `cauLyDoGiaiThich` (trong ngăn). */
export function lyDoNgan(ma: string, c: ChiTietCuaSo | null): string {
  if (ma === "ATTRIBUTION_WINDOW_EXPIRED") return c ? `Quá hạn ${c.soNgayTre} ngày` : "Quá hạn ghi công";
  return ma;
}

export function dungNhanGiaiThich(d: DongGiaiThichDoc): NhanGiaiThich {
  const ten = d.tenChinhSach ?? d.documentNumber;
  return {
    nguon: d.tenNhom,
    chinhSach: `${ten}: ${chuyenDoi(d)} (${d.documentNumber} · phiên bản ${d.versionNo})`,
    dieuKien: "Không đủ điều kiện",
    lyDo: cauLyDoGiaiThich(d.reasonCode, d.chiTiet),
    lyDoMa: d.reasonCode,
    hoaHong: dinhDangDong(0),
    leRa: `Lẽ ra: ${dinhDangDong(d.wouldBeAmount)}`,
    thayThe: d.daCoTien ? "Đã được thay thế: vai này nay đã có dòng hoa hồng thật ở khoản này." : null,
  };
}
