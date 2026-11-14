// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/do-day-du-bo-test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * ĐỘ ĐẦY ĐỦ CỦA BỘ TEST — ai đã làm, mấy bản, loại nào, còn thiếu gì (28.1).
 *
 * 🔴 KHÔNG DỰNG LUẬT "ĐỦ BẢN" THỨ HAI. Với một bé từ lớp 3, "đủ" nghĩa là màn đối chiếu hai
 * góc nhìn ghép được — nên trạng thái lấy THẲNG từ `doiChieu()` và lý do của nó
 * (thiếu bản con · thiếu bản bố mẹ · khác phiên bản · quá 60 ngày). Dựng luật riêng thì thẻ
 * có thể hiện ✓✓ trong khi màn đối chiếu báo "chưa so được" — hai nơi nói hai điều khác nhau
 * về cùng một đứa trẻ.
 *
 * Quy tắc:
 *  · Người lớn: đủ khi có ≥ 1 bản hợp lệ (hoặc hồ sơ nhận qua mã mời).
 *  · Bé nhỏ (mầm non, lớp 1–2; bộ quan sát là MN): bố mẹ làm cho bé — đủ khi có ≥ 1 bản hợp lệ.
 *  · Bé từ lớp 3 (bộ quan sát là QS): cần CẢ bản con tự làm VÀ bản bố mẹ làm cho con, cùng
 *    phiên bản bộ câu hỏi, cách nhau ≤ 60 ngày.
 *
 * Thuộc TẦNG LÕI (ADR-004): hàm thuần, không React, không đọc đồng hồ. `modules/report` chỉ
 * được import `@modules/core`, nên bộ quan sát của bé (`boDeQuanSatTheoLop`, ở module test)
 * do nơi gọi tính và truyền vào.
 */

import type { MaBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { loaiCuaBoDe } from "@/lib/disc/engine-goc/modules/core/gia-dinh/han-muc";
import type { ThanhVien } from "@/lib/disc/engine-goc/modules/core/gia-dinh/kieu";

import { doiChieu, type BaiDeGhep } from "./doi-chieu";

/** Bài chỉ cần đủ để đếm và ghép cặp — nhận `BaiLamLuu` thật cũng vừa. */
export type BaiDeDem = BaiDeGhep & { readonly maThanhVien?: string };

export type ViecConThieu =
  | { readonly ma: "CHUA_LAM" }
  | { readonly ma: "CHUA_BIET_BAC_HOC" }
  | { readonly ma: "THIEU_BAN_CON" }
  | { readonly ma: "THIEU_BAN_BO_ME" }
  | { readonly ma: "KHAC_PHIEN_BAN" }
  | { readonly ma: "QUA_HAN"; readonly soNgay: number };

export type KieuNguoi = "nguoi-lon" | "tre-nho" | "tre-lon" | "chua-biet-bac";

export type DayDuMotNguoi = {
  readonly id: string;
  readonly ten: string;
  readonly kieu: KieuNguoi;
  /** Số bản ĐÃ LÀM (kể cả bản hỏng) theo loại — để thẻ đếm đúng thứ người dùng đã bấm. */
  readonly soTuLam: number;
  readonly soQuanSat: number;
  /** ISO của bản hợp lệ gần nhất theo loại. Vắng ⇒ chưa có bản hợp lệ. */
  readonly ganNhatTuLam?: string;
  readonly ganNhatQuanSat?: string;
  /** Có bản không dùng được (HL hỏng) — thẻ nên nói thẳng để người dùng không tưởng đã đủ. */
  readonly coBanHong: boolean;
  /** Chỉ có hồ sơ nhận qua mã mời, không có bài gốc trên máy. */
  readonly chiCoMaMoi: boolean;
  readonly daDu: boolean;
  readonly viec: ViecConThieu | null;
};

const ganNhat = (ds: readonly BaiDeDem[]): string | undefined =>
  ds
    .filter((b) => b.ketQua.hopLe)
    .map((b) => b.ketThuc)
    .sort((a, b) => b.localeCompare(a))[0];

export function tinhDayDu(
  tv: Pick<ThanhVien, "id" | "ten" | "nhanQuaMa">,
  bai: readonly BaiDeDem[],
  nguoi: { readonly laTre: boolean; readonly boDeQuanSat: MaBoDe | null },
): DayDuMotNguoi {
  const tuLam = bai.filter((b) => loaiCuaBoDe(b.boDe) === "tu-lam");
  const quanSat = bai.filter((b) => loaiCuaBoDe(b.boDe) === "quan-sat");
  const chiCoMaMoi = bai.length === 0 && Boolean(tv.nhanQuaMa);

  const goc = {
    id: tv.id,
    ten: tv.ten,
    soTuLam: tuLam.length,
    soQuanSat: quanSat.length,
    ...(ganNhat(tuLam) ? { ganNhatTuLam: ganNhat(tuLam) } : {}),
    ...(ganNhat(quanSat) ? { ganNhatQuanSat: ganNhat(quanSat) } : {}),
    coBanHong: bai.some((b) => !b.ketQua.hopLe),
    chiCoMaMoi,
  };
  const ket = (kieu: KieuNguoi, daDu: boolean, viec: ViecConThieu | null): DayDuMotNguoi => ({
    ...goc,
    kieu,
    daDu,
    viec,
  });

  if (!nguoi.laTre) {
    if (tuLam.some((b) => b.ketQua.hopLe) || chiCoMaMoi) return ket("nguoi-lon", true, null);
    return ket("nguoi-lon", false, { ma: "CHUA_LAM" });
  }

  if (nguoi.boDeQuanSat === null) {
    return ket("chua-biet-bac", false, { ma: "CHUA_BIET_BAC_HOC" });
  }

  if (nguoi.boDeQuanSat === "MN") {
    if (quanSat.some((b) => b.ketQua.hopLe)) return ket("tre-nho", true, null);
    return ket("tre-nho", false, quanSat.length === 0 ? { ma: "CHUA_LAM" } : { ma: "THIEU_BAN_BO_ME" });
  }

  // Bé từ lớp 3: chạy đúng luật của màn đối chiếu, theo từng biệt danh đã dùng.
  if (bai.length === 0) return ket("tre-lon", false, { ma: "CHUA_LAM" });
  const moiNhat = [...bai].sort((a, b) => b.ketThuc.localeCompare(a.ketThuc));
  const cacTen = [...new Set(moiNhat.map((b) => b.maTre))];
  let lyDo: ViecConThieu = { ma: "THIEU_BAN_CON" };
  for (const [i, ten] of cacTen.entries()) {
    const kq = doiChieu(bai, ten);
    if (kq.ghepDuoc) return ket("tre-lon", true, null);
    if (i === 0) {
      lyDo =
        kq.lyDo.ma === "THIEU_BAI_CON"
          ? { ma: "THIEU_BAN_CON" }
          : kq.lyDo.ma === "THIEU_BAI_BO_ME"
            ? { ma: "THIEU_BAN_BO_ME" }
            : kq.lyDo.ma === "KHAC_PHIEN_BAN"
              ? { ma: "KHAC_PHIEN_BAN" }
              : { ma: "QUA_HAN", soNgay: kq.lyDo.soNgay };
    }
  }
  return ket("tre-lon", false, lyDo);
}

export type TongKetDayDu = {
  readonly tong: number;
  readonly soDu: number;
  readonly conThieu: readonly DayDuMotNguoi[];
};

export function tongKetDayDu(ds: readonly DayDuMotNguoi[]): TongKetDayDu {
  return {
    tong: ds.length,
    soDu: ds.filter((d) => d.daDu).length,
    conThieu: ds.filter((d) => !d.daDu),
  };
}
