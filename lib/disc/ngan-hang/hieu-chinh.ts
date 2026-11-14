/**
 * HIỆU CHỈNH CÂU SAU KHI CÓ BÀI THẬT — hàm THUẦN.
 *
 * Ngân hàng mở rộng do máy soạn, CHƯA được đo trên người Việt. Cách duy nhất biết một câu
 * có đo đúng trục không là xem nó đi cùng chiều với các câu cùng trục trong chính bài đó:
 * TƯƠNG QUAN CÂU – PHẦN CÒN LẠI (item-rest correlation). Câu lạc trục ⇒ r thấp hoặc âm.
 *
 * Đầu vào: các bài đã nộp, mỗi bài = mã câu + giá trị thô (CHƯA đảo). Đầu ra: thẻ cho từng
 * câu. Thẻ chỉ là ĐỀ XUẤT — gỡ câu khỏi rổ bốc là quyết định của người duyệt nội dung, ghi
 * vào danh sách loại trừ có lý do (spec §3.6).
 *
 * 🔴 Không tính khi chưa đủ mẫu. r trên 30 bài là nhiễu; gắn thẻ "loại" theo nhiễu là loại
 * oan những câu tốt.
 */

import type { MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

export const SO_BAI_TOI_THIEU = 200;
export const R_LOAI = 0.2;
export const R_ON_DINH = 0.3;

export type CauDeTinh = { readonly ma: string; readonly truc: MaTruc; readonly dao: boolean };
export type BaiDeTinh = {
  readonly mucToiDa: number;
  readonly cau: readonly (CauDeTinh & { readonly giaTri: number })[];
};

export type TheCau = {
  readonly ma: string;
  readonly soBai: number;
  readonly trungBinh: number;
  readonly r: number | null;
  readonly the: "CHUA_DU_MAU" | "DE_XUAT_LOAI" | "THEO_DOI" | "ON_DINH";
};

function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function hieuChinh(ds: readonly BaiDeTinh[]): TheCau[] {
  const gom = new Map<string, { x: number[]; y: number[] }>();
  for (const bai of ds) {
    const daoChieu = (c: { giaTri: number; dao: boolean }) => (c.dao ? bai.mucToiDa + 1 - c.giaTri : c.giaTri);
    const tongTruc = new Map<MaTruc, number>();
    for (const c of bai.cau) tongTruc.set(c.truc, (tongTruc.get(c.truc) ?? 0) + daoChieu(c));
    for (const c of bai.cau) {
      const v = daoChieu(c);
      const conLai = (tongTruc.get(c.truc) ?? 0) - v;
      const g = gom.get(c.ma) ?? { x: [], y: [] };
      g.x.push(v);
      g.y.push(conLai);
      gom.set(c.ma, g);
    }
  }
  return [...gom.entries()]
    .map(([ma, g]) => {
      const soBai = g.x.length;
      const trungBinh = Math.round((g.x.reduce((a, b) => a + b, 0) / soBai) * 100) / 100;
      const rTho = pearson(g.x, g.y);
      const r = rTho === null ? null : Math.round(rTho * 1000) / 1000;
      const the: TheCau["the"] =
        soBai < SO_BAI_TOI_THIEU || r === null
          ? "CHUA_DU_MAU"
          : r < R_LOAI
            ? "DE_XUAT_LOAI"
            : r < R_ON_DINH
              ? "THEO_DOI"
              : "ON_DINH";
      return { ma, soBai, trungBinh, r, the };
    })
    .sort((a, b) => (a.ma < b.ma ? -1 : 1));
}
