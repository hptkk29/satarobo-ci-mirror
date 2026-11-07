// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/phan-tich-gia-dinh.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * ENGINE PHÂN TÍCH CẢ NHÀ — N người, mỗi người một bản đọc riêng (14.2).
 *
 * 🔴 CẶP CÓ HƯỚNG, NHƯNG PHÉP TÍNH CHỈ CHẠY MỘT LẦN.
 *
 * N người ⇒ N bản, mỗi bản có (N−1) lát cắt: bản của A gồm A↔B, A↔C, A↔D… Nhưng chênh
 * lệch giữa A và B là MỘT con số, không phải hai: `lech(B→A) = −lech(A→B)`. Tính một lần
 * cho cặp vô hướng rồi soi gương. Nếu tính hai lần thì hai lần đó có thể lệch nhau vì làm
 * tròn, và khi ấy bản của A nói một chuyện còn bản của B nói chuyện khác — về đúng cùng
 * một chỗ vênh.
 *
 * 🔴 KHÔNG SINH THƯ MỤC RỖNG. Dưới hai người thì trả về lý do, và nơi gọi phải chặn ở NÚT.
 * Sinh ra một bản phân tích trống rồi để người dùng mở ra xem là tệ hơn không cho bấm.
 *
 * Thuộc TẦNG LÕI (ADR-004): hàm thuần, không React, không DOM, không đọc đồng hồ.
 */

import { SO_THANH_VIEN_TOI_DA, soTrucTheoN } from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import type {
  HuongLechCap,
  KieuTrungKhop,
  MoiQuanHeCap,
  TheQuyen,
} from "@/lib/disc/engine-goc/config/disc-lech-cap";
import type { VaiGiaDinh } from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import type { BacTre } from "@/lib/disc/engine-goc/modules/core/gia-dinh/bac-hoc";
import { bacCuaTre } from "@/lib/disc/engine-goc/modules/core/gia-dinh/bac-hoc";
import { NGUONG_VUNG_LECH } from "@/lib/disc/engine-goc/config/disc-nguong";
import { MA_TRUC, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

import { mucLechTu } from "./doi-chieu";

/** Một người đã có hồ sơ, sẵn sàng đưa vào phân tích. */
export type NguoiTrongPhanTich = {
  readonly id: string;
  readonly ten: string;
  /** `true` khi người này là trẻ em — quyết định THẾ QUYỀN của mỗi lát cắt. */
  readonly laTre: boolean;
  /** Lớp của người này (chuỗi, đúng dạng lưu ở `ThanhVien.lop`) — để chọn lời khuyên theo bậc. */
  readonly lop?: string;
  /**
   * Vai trong nhà — CHỈ để suy ra mối quan hệ (vợ ↔ chồng hay anh chị em) cho nội dung 27.5.
   * Không bắt buộc: thiếu thì lát cắt dùng nội dung chung `ngang-vai` như trước.
   */
  readonly vaiTro?: VaiGiaDinh;
  readonly diem: Readonly<Record<MaTruc, number>>;
};

export type TrucLech = {
  readonly truc: MaTruc;
  /** Nhìn từ người ĐANG ĐỌC. Dương = tôi cao hơn. */
  readonly lech: number;
  readonly huong: HuongLechCap;
};

/** Một lát cắt: người đang đọc nhìn về MỘT người khác. */
export type LatCat = {
  readonly toiId: string;
  readonly nguoiKiaId: string;
  readonly tenNguoiKia: string;
  readonly theQuyen: TheQuyen;
  /**
   * Mối quan hệ cụ thể (29.0): luôn suy ra được cho bản mới. 🔴 Tuỳ chọn: thư mục đã lưu từ
   * phiên bản cũ không có trường này — vắng mặt ⇒ giao diện rơi về nội dung chung.
   */
  readonly moiQuanHe?: MoiQuanHeCap;
  /** Bậc của ĐỨA TRẺ trong cặp (người đọc hoặc người kia). Vắng ⇒ chưa có lớp ⇒ hỏi, không đoán. */
  readonly bacTre?: BacTre;
  readonly vaiToi?: VaiGiaDinh;
  readonly vaiNguoiKia?: VaiGiaDinh;
  /** Những trục lệch rõ nhất, đã cắt theo `soTrucTheoN`. Rỗng ⇒ xem `trungKhop`. */
  readonly trucLech: readonly TrucLech[];
  /** 🔴 Chỉ có khi `trucLech` rỗng — bốn trục đều trùng khớp. KHÔNG để trống. */
  readonly trungKhop?: readonly { readonly truc: MaTruc; readonly kieu: KieuTrungKhop }[];
};

/** Một bản: mọi lát cắt của MỘT người đọc. */
export type BanPhanTich = {
  readonly toiId: string;
  /** 🔴 Tên CHỤP LẠI lúc chạy — đổi tên sau đó thì bản cũ vẫn đọc được. */
  readonly tenLuc: string;
  readonly latCat: readonly LatCat[];
};

export type LyDoChuaPhanTich = "CHUA_DU_HAI_NGUOI" | "QUA_NHIEU_NGUOI";

export type KetQuaPhanTichGiaDinh =
  | { readonly phanTichDuoc: false; readonly lyDo: LyDoChuaPhanTich }
  | { readonly phanTichDuoc: true; readonly ban: readonly BanPhanTich[] };

/**
 * Thế quyền của một lát cắt: người đọc nói về người kia.
 *
 * Trẻ ↔ trẻ và người lớn ↔ người lớn đều là `ngang-vai`: cái quyết định không phải tuổi
 * mà là CHÊNH LỆCH quyền trong nhà. Hai anh em nói thẳng với nhau được y như hai người lớn.
 */
export function theQuyenCua(toiLaTre: boolean, nguoiKiaLaTre: boolean): TheQuyen {
  if (toiLaTre === nguoiKiaLaTre) return "ngang-vai";
  return toiLaTre ? "tre-voi-nguoi-lon" : "nguoi-lon-voi-tre";
}

/**
 * Suy mối quan hệ của MỘT lát cắt — luôn trả về một giá trị.
 *
 *  · người lớn ↔ trẻ ⇒ `nguoi-lon-voi-tre` / `tre-voi-nguoi-lon` (khớp `theQuyenCua`)
 *  · hai TRẺ ⇒ `anh-chi-em` (nội dung nói chuyện chơi, đồ chơi, giờ học). Hai người LỚN cùng khai
 *    anh/chị/em ⇒ `nguoi-lon-khac`: nội dung `anh-chi-em` viết cho trẻ, đọc với người lớn là vỡ
 *  · hai người lớn là một cặp (mẹ+bố, hoặc ông+bà) ⇒ `vo-chong`
 *  · hai người lớn còn lại (ông/bà với con dâu/rể, người thân, khác…) ⇒ `nguoi-lon-khac`
 *
 * 🔴 `ba` là BÀ (xem `CHU_VAI`), không phải "ba" = bố. Bản 27.5 từng gộp mẹ+bà thành vợ
 * chồng — sai; cặp ông+bà mới là một cặp.
 */
export function moiQuanHeCua(
  a: Pick<NguoiTrongPhanTich, "laTre" | "vaiTro">,
  b: Pick<NguoiTrongPhanTich, "laTre" | "vaiTro">,
): MoiQuanHeCap {
  if (a.laTre !== b.laTre) return a.laTre ? "tre-voi-nguoi-lon" : "nguoi-lon-voi-tre";
  if (a.laTre) return "anh-chi-em";
  const cap = new Set([a.vaiTro, b.vaiTro]);
  if (cap.size === 2 && ((cap.has("me") && cap.has("bo")) || (cap.has("ong") && cap.has("ba")))) {
    return "vo-chong";
  }
  return "nguoi-lon-khac";
}

/** Bốn trục của một cặp VÔ HƯỚNG, nhìn từ `a`. Bản của `b` soi gương từ đây. */
function bonTrucCua(
  a: NguoiTrongPhanTich,
  b: NguoiTrongPhanTich,
): readonly { truc: MaTruc; lech: number }[] {
  return MA_TRUC.map((truc) => ({
    truc,
    lech: Math.round((a.diem[truc] - b.diem[truc]) * 10) / 10,
  }));
}

function catTheoN(
  bon: readonly { truc: MaTruc; lech: number }[],
  soNguoi: number,
  daoDau: boolean,
): TrucLech[] {
  return bon
    .filter((x) => mucLechTu(x.lech) !== "trungKhop")
    .sort((x, y) => Math.abs(y.lech) - Math.abs(x.lech))
    .slice(0, soTrucTheoN(soNguoi))
    .map((x) => {
      const lech = daoDau ? -x.lech : x.lech;
      return { truc: x.truc, lech, huong: (lech > 0 ? "toi-cao-hon" : "toi-thap-hon") as HuongLechCap };
    });
}

/** Bốn trục đều trùng khớp ⇒ vẫn phải có chữ, không được để trống. */
function trungKhopCua(
  a: NguoiTrongPhanTich,
  b: NguoiTrongPhanTich,
): { truc: MaTruc; kieu: KieuTrungKhop }[] {
  return MA_TRUC.map((truc) => ({
    truc,
    kieu: ((a.diem[truc] + b.diem[truc]) / 2 >= NGUONG_NOI_CHUNG
      ? "cung-noi"
      : "cung-nhe") as KieuTrungKhop,
  }));
}

/** Trung bình hai người từ mức này trở lên thì gọi là "cùng nổi". Dưới thì "cùng nhẹ". */
const NGUONG_NOI_CHUNG = 50;

export function phanTichGiaDinh(
  ds: readonly NguoiTrongPhanTich[],
): KetQuaPhanTichGiaDinh {
  if (ds.length < 2) return { phanTichDuoc: false, lyDo: "CHUA_DU_HAI_NGUOI" };
  if (ds.length > SO_THANH_VIEN_TOI_DA) {
    return { phanTichDuoc: false, lyDo: "QUA_NHIEU_NGUOI" };
  }

  // Tính MỘT lần cho mỗi cặp vô hướng, khoá theo cặp chỉ số i<j.
  const bonTrucTheoCap = new Map<string, readonly { truc: MaTruc; lech: number }[]>();
  for (let i = 0; i < ds.length; i += 1) {
    for (let j = i + 1; j < ds.length; j += 1) {
      bonTrucTheoCap.set(`${i}|${j}`, bonTrucCua(ds[i], ds[j]));
    }
  }

  const ban = ds.map((toi, i): BanPhanTich => {
    const latCat = ds
      .map((nguoiKia, j) => ({ nguoiKia, j }))
      .filter(({ j }) => j !== i)
      .map(({ nguoiKia, j }): LatCat => {
        const daoDau = j < i;
        const bon = bonTrucTheoCap.get(daoDau ? `${j}|${i}` : `${i}|${j}`)!;
        const trucLech = catTheoN(bon, ds.length, daoDau);
        const theQuyen = theQuyenCua(toi.laTre, nguoiKia.laTre);
        const moiQuanHe = moiQuanHeCua(toi, nguoiKia);
        // Bậc của ĐỨA TRẺ trong cặp: người kia nếu người đọc là người lớn, người đọc nếu là trẻ.
        const bacTre =
          theQuyen === "nguoi-lon-voi-tre"
            ? bacCuaTre(nguoiKia.lop)
            : theQuyen === "tre-voi-nguoi-lon"
              ? bacCuaTre(toi.lop)
              : undefined;
        const chung: LatCat = {
          toiId: toi.id,
          nguoiKiaId: nguoiKia.id,
          tenNguoiKia: nguoiKia.ten,
          theQuyen,
          moiQuanHe,
          ...(bacTre ? { bacTre } : {}),
          ...(toi.vaiTro ? { vaiToi: toi.vaiTro } : {}),
          ...(nguoiKia.vaiTro ? { vaiNguoiKia: nguoiKia.vaiTro } : {}),
          trucLech,
        };
        return trucLech.length > 0
          ? chung
          : { ...chung, trungKhop: trungKhopCua(toi, nguoiKia) };
      });

    return { toiId: toi.id, tenLuc: toi.ten, latCat };
  });

  return { phanTichDuoc: true, ban };
}

/** Ngưỡng "trùng khớp" lấy nguyên của vùng lệch — không dựng thang thứ hai. */
export const NGUONG_TRUNG_KHOP = NGUONG_VUNG_LECH.trungKhopToiDa;

/**
 * BẢN GHI ĐÃ LƯU CÓ ĐÚNG HÌNH DẠNG KHÔNG (V3.1).
 *
 * 🔴 `PhanTichGiaDinh.noiDung` khai kiểu `unknown` CÓ CHỦ ĐÍCH — kho không biết gì về hình
 * dạng nội dung, và đó là điều đúng. Nhưng vì thế, mở lại một thư mục cũ mà ép kiểu bừa là
 * đường thẳng tới một trang trắng: bản ghi từ phiên bản trước có thể thiếu trường, và React
 * đọc `undefined.latCat` là màn hình trắng, không phải một lời báo lỗi.
 *
 * Hàm thuần, không React. Kiểm ĐỦ SÂU tới mức mà giao diện thật sự đọc tới.
 */
export function laBanPhanTichHopLe(x: unknown): x is readonly BanPhanTich[] {
  if (!Array.isArray(x) || x.length === 0) return false;
  return x.every((b) => {
    if (typeof b !== "object" || b === null) return false;
    const o = b as Record<string, unknown>;
    if (typeof o.toiId !== "string" || typeof o.tenLuc !== "string") return false;
    if (!Array.isArray(o.latCat)) return false;
    return o.latCat.every((l) => {
      if (typeof l !== "object" || l === null) return false;
      const c = l as Record<string, unknown>;
      return (
        typeof c.toiId === "string" &&
        typeof c.nguoiKiaId === "string" &&
        typeof c.tenNguoiKia === "string" &&
        Array.isArray(c.trucLech)
      );
    });
  });
}
