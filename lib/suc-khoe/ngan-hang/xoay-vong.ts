/**
 * TẦNG 3 · XOAY VÒNG của Sức khỏe cả nhà (07/11/2026) — thói quen & hiểu biết, KHÔNG chấm điểm, KHÔNG lặp với người đã thấy.
 *
 * Luật chọn chép từ thiết kế (artifact «Sata Robo — Website mới», SucKhoe.dc.html): mỗi lượt thăm dò rút tối đa 3 câu cho MỘT người:
 *   · lọc theo tuổi: câu nhóm `all`, hoặc nhóm `tre` khi người đó là trẻ, hoặc nhóm `nl` khi người đó là người lớn;
 *   · bỏ mọi câu người này ĐÃ THẤY (`daThay`);
 *   · trộn ngẫu nhiên; lấy câu kiến thức (`kt`) đầu tiên; rồi lấy tiếp câu của lĩnh vực CHƯA dùng cho đủ 3 — để một lượt phủ nhiều mảng.
 * THUẦN: bộ ngẫu nhiên được TIÊM (test không đọc `Math.random` thật).
 *
 * Ngân hàng 1000 câu ở `xoay-vong-du-lieu.ts`; nên nạp bằng `import()` động khi vào bước câu xoay vòng (≈250 KB, không đưa vào gói đầu trang).
 */
import { XOAY_VONG_DU_LIEU } from "./xoay-vong-du-lieu";

export type NhomCau = "tre" | "nl" | "all";
export type LinhVucCau = "an" | "vd" | "ngu" | "mh" | "tt" | "th";
export type LoaiCau = "tq" | "kt";

export type CauXoayVong = {
  id: string;
  nhom: NhomCau;
  linhVuc: LinhVucCau;
  loai: LoaiCau;
  /** Có thể chứa `{ai}` / `{Ai}` — thay bằng `thayTen`. */
  cau: string;
  luaChon: readonly string[];
  /** `kt`: chỉ số đáp án đúng; `tq`: null. */
  dapAn: number | null;
  giaiThich: string;
  nguon: string;
};

export const NGAN_HANG_XOAY_VONG: readonly CauXoayVong[] = XOAY_VONG_DU_LIEU.map(([id, nhom, linhVuc, loai, cau, luaChon, dapAn, giaiThich, nguon]) => ({
  id,
  nhom: nhom as NhomCau,
  linhVuc: linhVuc as LinhVucCau,
  loai: loai as LoaiCau,
  cau,
  luaChon,
  dapAn,
  giaiThich,
  nguon,
}));

export const SO_CAU_MOI_LUOT = 3;

/** `{ai}`/`{Ai}` → «bé»/«Bé» cho trẻ, «anh chị»/«Anh chị» cho người lớn (đúng như thiết kế). */
export function thayTen(cau: string, laTre: boolean): string {
  return cau.replace(/\{ai\}/g, laTre ? "bé" : "anh chị").replace(/\{Ai\}/g, laTre ? "Bé" : "Anh chị");
}

/** Câu còn lại cho một người: đúng nhóm tuổi và CHƯA thấy. */
export function cauConLai(laTre: boolean, daThay: readonly string[], nganHang: readonly CauXoayVong[] = NGAN_HANG_XOAY_VONG): CauXoayVong[] {
  const thay = new Set(daThay);
  return nganHang.filter((c) => (c.nhom === "all" || (c.nhom === "tre") === laTre) && !thay.has(c.id));
}

function tron<T>(ds: readonly T[], ngauNhien: () => number): T[] {
  const a = [...ds];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(ngauNhien() * (i + 1)));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function chonXoayVong(p: {
  laTre: boolean;
  daThay: readonly string[];
  ngauNhien?: () => number;
  soCau?: number;
  nganHang?: readonly CauXoayVong[];
}): CauXoayVong[] {
  const ngauNhien = p.ngauNhien ?? Math.random;
  const soCau = p.soCau ?? SO_CAU_MOI_LUOT;
  const tronRoi = tron(cauConLai(p.laTre, p.daThay, p.nganHang), ngauNhien);
  const chon: CauXoayVong[] = [];
  const dungLinhVuc = new Set<string>();
  const kt = tronRoi.find((c) => c.loai === "kt");
  if (kt && soCau > 0) {
    chon.push(kt);
    dungLinhVuc.add(kt.linhVuc);
  }
  for (const c of tronRoi) {
    if (chon.length >= soCau) break;
    if (!chon.includes(c) && !dungLinhVuc.has(c.linhVuc)) {
      chon.push(c);
      dungLinhVuc.add(c.linhVuc);
    }
  }
  return chon;
}

/** Chấm một câu kiến thức (`kt`) sau khi trả lời: đúng/sai + lời giải. Câu `tq` không có đúng/sai. */
export function phanHoiCauKienThuc(c: CauXoayVong, daChon: number): { dung: boolean; loiGiai: string } | null {
  if (c.loai !== "kt" || c.dapAn === null) return null;
  const dung = daChon === c.dapAn;
  return { dung, loiGiai: (dung ? "Đúng rồi! " : "Chưa đúng. ") + c.giaiThich };
}
