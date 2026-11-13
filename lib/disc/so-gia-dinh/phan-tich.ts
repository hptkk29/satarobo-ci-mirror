/**
 * PHÂN TÍCH CẢ NHÀ + THẺ CẶP HAI CHIỀU (doc 18, mục 3–4).
 *
 * Bọc `phanTichGiaDinh` của engine gốc: n người ⇒ n × (n − 1) lát cắt CÓ HƯỚNG, phép tính chạy MỘT lần mỗi cặp.
 * Nội dung chữ của mỗi lát cắt lấy NGUYÊN từ bảng của engine (MO_TA_LECH · VIEC_CUA_TOI · THOA_THUAN · TRUNG_KHOP) rồi thay đại từ
 * bằng `thayDaiTuCap` (KHÔNG dùng CHU_THE[maBoDe] — bài học GĐ9). Hàm này không tự viết thêm một chữ lời khuyên nào.
 *
 * Bản chụp (`BanChup`) lưu tên LÚC CHẠY và mã bài đã dùng: đổi tên/làm lại bài sau đó, bản cũ vẫn đọc được.
 *
 * Hai hồ sơ khác `phienBanBoDe` (`1.1` vs `nh:nh1`) VẪN ghép được ở lát cắt cả nhà — đây là so HAI NGƯỜI KHÁC NHAU, mỗi người đo bằng
 * thước của mình — nhưng thẻ ghi chú «đo bằng hai phiên bản câu hỏi» (khác với đối chiếu cùng một đứa trẻ, nơi bắt buộc cùng phiên bản).
 */
import {
  SO_THANH_VIEN_TOI_DA,
} from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import { thayDaiTuCap, type HuongLechCap, type KieuTrungKhop, type MoiQuanHeCap, type TheQuyen } from "@/lib/disc/engine-goc/config/disc-lech-cap";
import { MO_TA_LECH, THOA_THUAN, TRUNG_KHOP, VIEC_CUA_TOI } from "@/lib/disc/engine-goc/config/disc-noi-dung-cap";
import { laBanPhanTichHopLe, phanTichGiaDinh, type BanPhanTich, type LatCat } from "@/lib/disc/engine-goc/modules/report/phan-tich-gia-dinh";

import type { CachLam, DiemDisc, Kieu, MaTruc, VaiGiaDinh } from "./kieu";
import { NHAN_TRUC } from "./kieu";
import { tinhChiSoGiaDinh, type ChiSoGiaDinh, type NguoiChiSo } from "./chi-so";

export { SO_THANH_VIEN_TOI_DA };

/** Một người trong bản chụp phân tích. */
export type NguoiChup = {
  readonly id: string;
  readonly ten: string;
  readonly vaiTro: VaiGiaDinh;
  readonly laTre: boolean;
  readonly lop: string | null;
  readonly diem: DiemDisc;
  readonly kieu: Kieu;
  /** TU_LAM = chính thức · GOC_NHIN = ước lượng. */
  readonly qua: CachLam;
  readonly baiId: string;
  readonly phienBanBoDe: string;
};

export const PHIEN_BAN_CHUP = 1 as const;

export type BanChup = {
  readonly v: typeof PHIEN_BAN_CHUP;
  readonly nguoi: readonly NguoiChup[];
  readonly ban: readonly BanPhanTich[];
};

export type LyDoKhongPhanTich = "CHUA_DU_HAI_NGUOI" | "QUA_NHIEU_NGUOI";

export function dungBanChup(nguoi: readonly NguoiChup[]): { readonly ok: true; readonly chup: BanChup } | { readonly ok: false; readonly lyDo: LyDoKhongPhanTich } {
  const kq = phanTichGiaDinh(
    nguoi.map((n) => ({
      id: n.id,
      ten: n.ten,
      laTre: n.laTre,
      ...(n.lop ? { lop: n.lop } : {}),
      vaiTro: n.vaiTro,
      diem: n.diem,
    })),
  );
  if (!kq.phanTichDuoc) return { ok: false, lyDo: kq.lyDo };
  return { ok: true, chup: { v: PHIEN_BAN_CHUP, nguoi, ban: kq.ban } };
}

/** Kiểm hình dạng một bản chụp đọc từ DB (JSON). */
export function laBanChupHopLe(x: unknown): x is BanChup {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.v !== PHIEN_BAN_CHUP || !Array.isArray(o.nguoi) || o.nguoi.length < 2) return false;
  const nguoiOk = o.nguoi.every((n) => {
    if (typeof n !== "object" || n === null) return false;
    const r = n as Record<string, unknown>;
    const d = r.diem as Record<string, unknown> | undefined;
    return (
      typeof r.id === "string" &&
      typeof r.ten === "string" &&
      typeof r.laTre === "boolean" &&
      typeof d === "object" &&
      d !== null &&
      ["D", "I", "S", "C"].every((k) => typeof d[k] === "number")
    );
  });
  return nguoiOk && laBanPhanTichHopLe(o.ban);
}

export function chiSoTuChup(chup: BanChup): ChiSoGiaDinh | null {
  const nguoi: NguoiChiSo[] = chup.nguoi.map((n) => ({
    id: n.id,
    ten: n.ten,
    laTre: n.laTre,
    vaiTro: n.vaiTro,
    diem: n.diem,
    kieu: n.kieu,
    qua: n.qua,
  }));
  return tinhChiSoGiaDinh(nguoi);
}

/* ── Thẻ một chiều A → B ──────────────────────────────────────────────────── */

export type KhoiLech = {
  readonly truc: MaTruc;
  readonly tenTruc: string;
  readonly huong: HuongLechCap;
  readonly veToi: string;
  readonly veNguoiKia: string;
  readonly viecCuaToi: string;
  readonly thoaThuan: string;
};

export type KhoiTrungKhop = { readonly truc: MaTruc; readonly tenTruc: string; readonly kieu: KieuTrungKhop; readonly chu: string };

export type TheChieu = {
  readonly toiId: string;
  readonly toiTen: string;
  readonly kiaId: string;
  readonly kiaTen: string;
  readonly theQuyen: TheQuyen;
  readonly moiQuanHe: MoiQuanHeCap | null;
  readonly lech: readonly KhoiLech[];
  /** Chỉ có khi `lech` rỗng — bốn trục trùng khớp, KHÔNG để thẻ trống. */
  readonly trungKhop: readonly KhoiTrungKhop[];
  /** Hai hồ sơ đo bằng hai phiên bản câu hỏi (ví dụ `1.1` và `nh:nh1`). */
  readonly khacPhienBan: boolean;
  /** Người A / B là hồ sơ ước lượng (qua mắt chủ sổ). */
  readonly toiUocLuong: boolean;
  readonly kiaUocLuong: boolean;
};

function khoiTuLat(lat: LatCat): { lech: KhoiLech[]; trungKhop: KhoiTrungKhop[] } {
  const thay = (chu: string) => thayDaiTuCap(chu, lat.theQuyen, lat.tenNguoiKia);
  const lech = lat.trucLech.map((t): KhoiLech => ({
    truc: t.truc,
    tenTruc: NHAN_TRUC[t.truc],
    huong: t.huong,
    veToi: thay(MO_TA_LECH[t.truc][t.huong].veToi),
    veNguoiKia: thay(MO_TA_LECH[t.truc][t.huong].veNguoiKia),
    viecCuaToi: thay(VIEC_CUA_TOI[t.truc][t.huong][lat.theQuyen]),
    thoaThuan: thay(THOA_THUAN[t.truc][t.huong]),
  }));
  const trungKhop = (lat.trungKhop ?? []).map((t): KhoiTrungKhop => ({
    truc: t.truc,
    tenTruc: NHAN_TRUC[t.truc],
    kieu: t.kieu,
    chu: TRUNG_KHOP[t.truc][t.kieu],
  }));
  return { lech, trungKhop };
}

/** Thẻ A → B từ một bản chụp. null nếu hai người không có trong bản chụp (hoặc A = B). */
export function theChieu(chup: BanChup, aId: string, bId: string): TheChieu | null {
  if (aId === bId) return null;
  const a = chup.nguoi.find((n) => n.id === aId);
  const b = chup.nguoi.find((n) => n.id === bId);
  const banA = chup.ban.find((x) => x.toiId === aId);
  const lat = banA?.latCat.find((l) => l.nguoiKiaId === bId);
  if (!a || !b || !lat) return null;
  const { lech, trungKhop } = khoiTuLat(lat);
  return {
    toiId: a.id,
    toiTen: a.ten,
    kiaId: b.id,
    kiaTen: b.ten,
    theQuyen: lat.theQuyen,
    moiQuanHe: lat.moiQuanHe ?? null,
    lech,
    trungKhop,
    khacPhienBan: a.phienBanBoDe !== b.phienBanBoDe,
    toiUocLuong: a.qua === "GOC_NHIN",
    kiaUocLuong: b.qua === "GOC_NHIN",
  };
}

/** Mọi thẻ chiều của bản chụp: đúng n × (n − 1). */
export function moiTheChieu(chup: BanChup): TheChieu[] {
  const kq: TheChieu[] = [];
  for (const a of chup.nguoi) {
    for (const b of chup.nguoi) {
      if (a.id === b.id) continue;
      const t = theChieu(chup, a.id, b.id);
      if (t) kq.push(t);
    }
  }
  return kq;
}

/** Số trục lệch nói tới trong mỗi lát cắt (đọc từ chính bản chụp). */
export function soLatCat(chup: BanChup): number {
  return chup.ban.reduce((s, b) => s + b.latCat.length, 0);
}
