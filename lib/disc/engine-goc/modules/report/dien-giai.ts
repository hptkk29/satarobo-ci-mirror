// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/dien-giai.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * GHÉP VĂN BẢN BÁO CÁO với kiểu đã chấm được.
 *
 * Hàm thuần, thuộc TẦNG LÕI (ADR-004): không React, không DOM.
 */

import {
  BIEU_HIEN,
  DAC_DIEM_TRUC,
  MUC_DO_RO,
  THU_TU_PHA,
  type KhoiPha,
  type LuaTuoi,
} from "@/lib/disc/engine-goc/config/disc-bieu-hien";
import {
  CHU_THE,
  DIEN_GIAI,
  type BanDoc,
  type KhoiDienGiai,
  type MaKieu,
} from "@/lib/disc/engine-goc/config/disc-dien-giai";
import { TUOI_VAO_THCS } from "@/lib/disc/engine-goc/config/disc-nguong";
import {
  BAN_KHOAN,
  LOI_KHUYEN,
  MA_BAN_KHOAN,
  TU_MINH,
  type KhoiLoiKhuyen,
  type KhoiTuMinh,
  type MaBanKhoan,
} from "@/lib/disc/engine-goc/config/disc-loi-khuyen";

import { MA_TRUC, type MaBoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

import type { Kieu } from "./cham";
import { xepKieu } from "./cham";
import { noiRo, viTriTrongHoSo, type ViTriTruc } from "./muc-do";

export class LoiDienGiai extends Error {
  constructor(thongDiep: string) {
    super(thongDiep);
    this.name = "LoiDienGiai";
  }
}

/**
 * Đổi kiểu đã chấm thành khoá văn bản.
 * Cặp pha luôn viết theo thứ tự cố định D-I-S-C ⇒ đúng sáu khoá, không phải mười hai.
 */
export function maKieuTu(kieu: Kieu): MaKieu {
  if (kieu.loai === "deu") return "DEU";
  if (kieu.loai === "don") return kieu.truc;
  const cap = [...kieu.cap].sort((a, b) => MA_TRUC.indexOf(a) - MA_TRUC.indexOf(b));
  return cap.join("") as MaKieu;
}

/**
 * Thay {chuThe} / {ChuThe} bằng đại từ đúng với bộ đề VÀ người đang đọc.
 *
 * Mặc định `banDoc = "con"` giữ nguyên hành vi cũ — mọi nơi gọi hàm này trước GĐ10 ra chữ
 * y hệt, nên không có chỗ nào âm thầm đổi giọng.
 */
export function thayChuThe(chuoi: string, maBoDe: MaBoDe, banDoc: BanDoc = "con"): string {
  const dt = CHU_THE[maBoDe]?.[banDoc];
  if (!dt) {
    throw new LoiDienGiai(
      `Bộ đề "${maBoDe}" chưa khai đại từ cho người đọc "${banDoc}" trong CHU_THE.`,
    );
  }
  return chuoi.split("{ChuThe}").join(dt.hoa).split("{chuThe}").join(dt.thuong);
}

export type DienGiaiDaThay = {
  readonly maKieu: MaKieu;
  readonly trongNhuTheNao: string;
  readonly diemManh: string;
  readonly choCanDeY: string;
  readonly cauHoiToiNay: readonly string[];
};

/** Lấy trọn bốn khối, đã thay đại từ. Thiếu khoá thì NÉM — không trả về khối rỗng. */
export function layDienGiai(kieu: Kieu, maBoDe: MaBoDe): DienGiaiDaThay {
  const maKieu = maKieuTu(kieu);
  const khoi: KhoiDienGiai | undefined = DIEN_GIAI[maKieu];
  if (!khoi) {
    throw new LoiDienGiai(
      `Không có văn bản cho kiểu "${maKieu}". Thêm vào config/disc-dien-giai.ts — ` +
        `một khối trống ở đây nghĩa là người dùng nhận về một màn hình trắng.`,
    );
  }
  return {
    maKieu,
    trongNhuTheNao: thayChuThe(khoi.trongNhuTheNao, maBoDe),
    diemManh: thayChuThe(khoi.diemManh, maBoDe),
    choCanDeY: thayChuThe(khoi.choCanDeY, maBoDe),
    cauHoiToiNay: khoi.cauHoiToiNay.map((c) => thayChuThe(c, maBoDe)),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * BẢN ĐẦY ĐỦ — lớp bóc sâu, thêm vào chứ KHÔNG thay bản cũ.
 *
 * 🔴 `layDienGiai` ở trên GIỮ NGUYÊN CHỮ KÝ. Nó là bốn khối mặc định mà màn kết quả vẫn
 * hiện y như cũ. Đổi chữ ký tại chỗ chỉ tổ tạo ra chín điểm phải sửa trong
 * `tests/dien-giai.test.ts` mà không đổi được hành vi nào.
 *
 * Ba lỗi gốc mà phần dưới đây trả nợ:
 *  1. `layDienGiai` không nhận `diem` ⇒ hồ sơ D=92 và D=58 ra báo cáo giống nhau TỪNG BYTE.
 *  2. Diễn giải làm theo KIỂU nên chỉ trục trội có chữ; ba trục còn lại — nhất là trục
 *     nhẹ nhất — không một dòng nào, dù biểu đồ vẫn hiện đủ bốn cột kèm số. Đặc tả §9.2
 *     luật 2 đòi đủ bốn trục ngay từ đầu.
 *  3. Cặp pha mất thứ tự ⇒ "D trội, I phụ" đọc y hệt "I trội, D phụ".
 * ══════════════════════════════════════════════════════════════════════════ */

export function laMaBanKhoan(gia: unknown): gia is MaBanKhoan {
  return typeof gia === "string" && (MA_BAN_KHOAN as readonly string[]).includes(gia);
}

/**
 * Chọn lứa nội dung.
 *
 * 🔴 Bốn bộ suy thẳng từ mã bộ đề. Riêng bộ QS trải từ 8 đến 15 tuổi — bắc qua CẢ tiểu học
 * lẫn THCS — nên chỉ trường `tuoi` phân định được. Đó là lý do `tuoi` được lưu lại ở GĐ B.
 *
 * Bài lưu từ trước khi có trường `tuoi` sẽ rơi về lứa `TH`: chọn bản nhẹ nhàng hơn khi
 * không biết, thay vì nói với phụ huynh của một bé lớp 3 bằng giọng viết cho lớp 9.
 */
export function luaTuoiTu(maBoDe: MaBoDe, tuoi?: number): LuaTuoi {
  switch (maBoDe) {
    case "MN":
      return "MN";
    case "TH":
      return "TH";
    case "THCS":
      return "THCS";
    case "PH":
      return "NGUOI_LON";
    case "QS":
      return tuoi !== undefined && tuoi >= TUOI_VAO_THCS ? "THCS" : "TH";
  }
}

/**
 * Khoá cặp pha CÓ THỨ TỰ, lấy từ `xepHang` chứ không lấy từ `kieu.cap`.
 *
 * `xepKieu()` cố ý sắp `cap` về thứ tự cố định D-I-S-C và `tests/cham-diem.test.ts` khẳng
 * định điều đó — đấy là hành vi ĐÚNG của tầng chấm điểm, đừng đụng vào. Thứ tự trội/phụ là
 * việc của tầng diễn giải, và `xepHang` đã mang sẵn.
 */
export function maPhaCoThuTu(xepHang: readonly MaTruc[]): string {
  return `${xepHang[0]}${xepHang[1]}`;
}

export type TrucDaDoc = {
  readonly truc: MaTruc;
  readonly diem: number;
  readonly viTri: ViTriTruc;
  /** Hành vi quan sát được, theo lứa tuổi. */
  readonly bieuHien: string;
  /** Trục nổi/giữa: cái được. Trục nhẹ nhất: cả cái được lẫn cái giá, gộp một khối. */
  readonly than: string;
  /** Trục nổi/giữa mới có. Trục nhẹ nhất đã gộp cái giá vào `than`. */
  readonly choCanDeY?: string;
  /** 🔴 ĐÚNG MỘT MỆNH ĐỀ, chỉ có ở trục nổi nhất khi `noiRo()` đúng. */
  readonly mucDoRo?: string;
};

export type DienGiaiDay = DienGiaiDaThay & {
  readonly luaTuoi: LuaTuoi;
  /** 🔴 ĐỦ BỐN TRỤC, không bao giờ ít hơn — đây chính là món §9.2 luật 2 đòi. */
  readonly phoBonNhom: readonly TrucDaDoc[];
  /** Chỉ có khi kiểu là pha. Đã tính theo thứ tự trội/phụ thật. */
  readonly pha?: KhoiPha;
  /**
   * BẢN CHO CON — chính đứa trẻ đọc về mình. Chỉ bộ TH và THCS, hai bộ trẻ TỰ làm bài.
   * Bộ MN thì bé chưa đọc được; bộ QS thì điểm do bố mẹ chấm, dựng "lời cho con" từ đó là bịa.
   */
  readonly banCon?: KhoiTuMinh;
  /**
   * BẢN CHO BỐ MẸ — người lớn đọc về đứa trẻ. Bộ MN, QS, và (mới từ GĐ10) cả TH, THCS.
   * 🔴 Trước GĐ10 phụ huynh của học sinh tiểu học/THCS KHÔNG nhận được gì cả.
   */
  readonly banBoMe?: KhoiLoiKhuyen;
  /** BẢN TỰ ĐỌC CỦA NGƯỜI LỚN — chỉ bộ PH, người lớn đánh giá chính mình. */
  readonly banTuMinh?: KhoiTuMinh;
  readonly banKhoan?: { readonly nhan: string; readonly loiMoDau: string };
};

export type DauVaoDienGiai = {
  readonly diem: Readonly<Record<MaTruc, number>>;
  readonly xepHang: readonly MaTruc[];
  readonly maBoDe: MaBoDe;
  readonly tuoi?: number;
  readonly banKhoan?: string;
};

/**
 * Ghép trọn bản báo cáo sâu.
 *
 * 🔴 Đầu vào là RECORD PHẲNG, cố ý không nhận thẳng `BaiLamLuu`: kiểu đó nằm ở
 * `modules/core/luu-tru`, vốn KHÔNG thuộc tầng lõi (nó đụng IndexedDB). Semgrep cho qua vì
 * report được phép import core, nên sẽ không có gì đỏ để nhắc — hàng rào duy nhất là chỗ
 * này. Nơi gọi tự bóc các trường ra.
 *
 * 🔴 Mọi trường mới đều tuỳ chọn, và bài lưu từ trước GĐ B thiếu `tuoi`/`banKhoan` vẫn phải
 * ra báo cáo đầy đủ. Màn *Bài đã làm* dựng lại kết quả từ bản ghi cũ — ném ở đây là làm
 * hỏng cả màn lịch sử.
 */
export function layDienGiaiDay(dv: DauVaoDienGiai): DienGiaiDay {
  const { diem, xepHang, maBoDe } = dv;
  const kieu = xepKieu(diem, xepHang);
  /** Trẻ TỰ làm bài ⇒ có bản cho chính em ấy đọc. */
  const laConTuLam = maBoDe === "TH" || maBoDe === "THCS";
  /** Có một đứa trẻ để người lớn đọc về. Bộ PH nói về chính người lớn nên không có. */
  const coBanBoMe = maBoDe !== "PH";
  const goc = layDienGiai(kieu, maBoDe);
  const luaTuoi = luaTuoiTu(maBoDe, dv.tuoi);
  const thay = (chuoi: string) => thayChuThe(chuoi, maBoDe);

  const daNoiRo = noiRo(diem, xepHang);

  // Đi theo MA_TRUC chứ không theo xepHang: biểu đồ bốn cột luôn xếp D-I-S-C, và chữ phải
  // đọc cùng thứ tự với cột thì mắt mới nối được hai thứ với nhau.
  const phoBonNhom: TrucDaDoc[] = MA_TRUC.map((t) => {
    const viTri = viTriTrongHoSo(xepHang, t);
    const chung = {
      truc: t,
      diem: diem[t],
      viTri,
      bieuHien: thay(BIEU_HIEN[t][luaTuoi]),
    };
    if (viTri === "nheNhat") {
      // `khiNhe` đã gói sẵn cả cái được lẫn cái giá, nên không kèm `choCanDeY` nữa —
      // kèm thêm là biến trục nhẹ thành trục bị chê hai lần.
      return { ...chung, than: thay(DAC_DIEM_TRUC[t].khiNhe) };
    }
    return {
      ...chung,
      than: thay(DAC_DIEM_TRUC[t].diemManh),
      choCanDeY: thay(DAC_DIEM_TRUC[t].choCanDeY),
      ...(viTri === "noiNhat" && daNoiRo ? { mucDoRo: thay(MUC_DO_RO[t]) } : {}),
    };
  });

  const khoiPha = kieu.loai === "pha" ? THU_TU_PHA[maPhaCoThuTu(xepHang)] : undefined;
  const trucChinh = xepHang[0];

  const bk = laMaBanKhoan(dv.banKhoan) ? BAN_KHOAN[dv.banKhoan] : undefined;

  return {
    ...goc,
    luaTuoi,
    phoBonNhom,
    ...(khoiPha
      ? {
          pha: {
            tieuDe: thay(khoiPha.tieuDe),
            tieuDeNgan: thay(khoiPha.tieuDeNgan),
            than: thay(khoiPha.than),
          },
        }
      : {}),
    // Ba bản, mỗi bản một người đọc. Tách bằng CẤU TRÚC chứ không bằng kỷ luật: giao diện
    // không có đường nào đổ chữ của bố mẹ vào mục của con nếu chúng không nằm chung một trường.
    ...(laConTuLam ? { banCon: thayKhoiTuMinh(TU_MINH[trucChinh], maBoDe, "con") } : {}),
    ...(coBanBoMe ? { banBoMe: thayKhoiLoiKhuyen(LOI_KHUYEN[trucChinh], maBoDe, "boMe") } : {}),
    ...(maBoDe === "PH" ? { banTuMinh: thayKhoiTuMinh(TU_MINH[trucChinh], maBoDe, "boMe") } : {}),
    ...(bk ? { banKhoan: { nhan: bk.nhan, loiMoDau: thay(bk.loiMoDau) } } : {}),
  };
}

function thayKhoiLoiKhuyen(k: KhoiLoiKhuyen, maBoDe: MaBoDe, banDoc: BanDoc): KhoiLoiKhuyen {
  const t = (c: string) => thayChuThe(c, maBoDe, banDoc);
  return {
    noiTheNao: t(k.noiTheNao),
    cauNenNoi: [t(k.cauNenNoi[0]), t(k.cauNenNoi[1]), t(k.cauNenNoi[2])],
    cauNenTranh: [t(k.cauNenTranh[0]), t(k.cauNenTranh[1]), t(k.cauNenTranh[2])],
    khiCangThang: t(k.khiCangThang),
    kyNangThem: t(k.kyNangThem),
    boMeChinh: t(k.boMeChinh),
    cungHocTheNao: t(k.cungHocTheNao),
    motViecToiNay: t(k.motViecToiNay),
  };
}

function thayKhoiTuMinh(k: KhoiTuMinh, maBoDe: MaBoDe, banDoc: BanDoc): KhoiTuMinh {
  const t = (c: string) => thayChuThe(c, maBoDe, banDoc);
  return {
    khiCangThang: t(k.khiCangThang),
    tapThem: t(k.tapThem),
    motViecToiNay: t(k.motViecToiNay),
  };
}
