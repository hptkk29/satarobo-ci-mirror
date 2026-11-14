/**
 * SINH NGÂN HÀNG CÂU — hàm THUẦN, tất định: cùng nguyên liệu ⇒ cùng danh sách, cùng mã.
 *
 * Một câu = (ô khung của bộ đề) × (mẫu hành vi cùng họ, thuộc tầng của bộ đề) × (bối cảnh
 * cùng nhóm với mẫu). Ngoài ra 104 câu gốc được đưa vào nguyên văn, mang `nguon: "goc"`.
 *
 * 🔴 MÃ CÂU ỔN ĐỊNH: `<mã câu gốc>.<tầng><số mẫu>.<mã bối cảnh>`, vd `TH-D1.e3.h2`. Mã đi
 * vào lịch sử "đã thấy" của từng người; đổi cách đặt mã là xoá trắng lịch sử đó và người
 * dùng gặp lại câu cũ. Thêm mẫu thì THÊM VÀO CUỐI mảng của họ — chèn vào giữa là xê dịch số
 * mẫu của mọi câu phía sau.
 *
 * Thuộc TẦNG LÕI: không đọc file, không đồng hồ.
 */

import { NGAN_HANG } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { THU_TU } from "@/lib/disc/engine-goc/config/disc-thu-tu";
import { MA_BO_DE, type MaBoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

import { BOI_CANH, BOI_CANH_QS, type BoiCanh } from "./boi-canh";
import { CACH_XUNG, HO, O_KHUNG, type MaHo, type NhomBoiCanh, type Tang } from "./khung";
import { MAU_HANH_VI } from "./mau-hanh-vi";

export type CauNganHang = {
  readonly ma: string;
  readonly boDe: MaBoDe;
  /** Mã câu gốc của ô khung — câu này thay được cho đúng ô đó, không ô nào khác. */
  readonly oKhung: string;
  readonly ho: MaHo;
  readonly truc: MaTruc;
  readonly dao: boolean;
  readonly noiDung: string;
  readonly nguon: "goc" | "sinh";
  /** Chỉ có ở câu sinh. Dùng để bốc đề không lặp lại cùng một hành vi. */
  readonly mau?: string;
  readonly boiCanh?: string;
};

const NHOM_HOP_LE: readonly NhomBoiCanh[] = ["h", "n", "b"];

/** Tách `"vị ngữ|nhóm"`. Nhóm sai ký tự ⇒ ném, để lỗi nguyên liệu không lọt im lặng. */
export function tachMau(mau: string): { viNgu: string; nhom: readonly NhomBoiCanh[] } {
  const [viNgu, nhomChu = "hnb"] = mau.split("|");
  const nhom = [...nhomChu] as NhomBoiCanh[];
  if (!viNgu?.trim() || nhom.length === 0 || nhom.some((n) => !NHOM_HOP_LE.includes(n))) {
    throw new Error(`Mẫu hành vi sai cú pháp: "${mau}"`);
  }
  return { viNgu: viNgu.trim(), nhom };
}

/** Viết hoa chữ cái đầu, gom khoảng trắng. */
function viHoaDau(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.charAt(0).toLocaleUpperCase("vi-VN") + t.slice(1);
}

export function ghepCau(boiCanh: string, viNgu: string, boDe: MaBoDe): string {
  const x = CACH_XUNG[boDe];
  const than = viNgu.startsWith("~")
    ? viNgu.slice(1).split("{tan}").join(x.tan)
    : x.chuNgu
      ? `${x.chuNgu} ${viNgu}`
      : viNgu;
  return viHoaDau(`${boiCanh}, ${than}`);
}

/** Khoá so trùng: bỏ dấu câu, thường hoá, NFC. Hai câu khác nhau chỉ ở dấu phẩy là MỘT câu. */
export function khoaSoTrung(s: string): string {
  return s
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN")
    .replace(/["“”.,!?…:;()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const chuTang: Readonly<Record<Tang, string>> = { be: "b", em: "e", teen: "t", lon: "l" };

/**
 * CHẶN CÂU LẠC CẢNH BẰNG TỪ VỰNG — nhóm khai trên mẫu là lời hứa của người viết, còn
 * bảng dưới là hàng rào máy kiểm. Mẫu nhắc tới "bạn", "lớp", "bài" thì không được đứng
 * sau "Ở nhà, …"; nhắc "cả nhà", "ông bà" thì không đứng sau "Ở lớp, …".
 *
 * 🔴 Chỉ BỚT nhóm, không bao giờ thêm. Bớt hết thì mẫu không sinh câu nào — test
 * `[NH-04]` canh để mẫu như thế không nằm chết trong nguyên liệu.
 */
const CAM_THEO_NHOM: Readonly<Record<NhomBoiCanh, RegExp>> = {
  n: /(^|\s)(bạn|các bạn|cô|thầy|lớp|nhóm|đội|đồng nghiệp|bài|nộp|trường|đối tác|người lạ|nhóm trưởng|trưởng nhóm|sân khấu|đại diện|phát biểu|thuyết trình|câu lạc bộ|cuộc họp|MC)(\s|$|[,.])/iu,
  h: /(cả nhà|bố mẹ|người nhà|ông bà|người thân|bữa cơm|món ăn|đi ngủ|hoá đơn|vật nuôi|họ hàng|đi chơi|tụ tập|tiệc|chỗ ở|ra khỏi nhà|đi đâu)/iu,
  b: /(cô |cô giáo|thầy|(^|\s)lớp|bài|nộp|cả nhà|bố mẹ|người nhà|ông bà|đi ngủ|đồng nghiệp|đối tác|hoá đơn|sổ sách|giấy tờ|chỗ làm|việc nhà(\s|$|[,.])|quy trình)/iu,
};

export function nhomHieuLuc(viNgu: string, khai: readonly NhomBoiCanh[]): NhomBoiCanh[] {
  return khai.filter((n) => !CAM_THEO_NHOM[n].test(viNgu));
}

function boiCanhCua(boDe: MaBoDe, tang: Tang): readonly BoiCanh[] {
  return boDe === "QS" ? BOI_CANH_QS : BOI_CANH[tang];
}

export function sinhNganHang(): CauNganHang[] {
  const ra: CauNganHang[] = [];
  for (const boDe of MA_BO_DE) {
    const daCo = new Set<string>();
    const xung = CACH_XUNG[boDe];
    for (const maGoc of THU_TU[boDe]) {
      const goc = NGAN_HANG[boDe].cau.find((c) => c.ma === maGoc);
      const ho = O_KHUNG[maGoc];
      if (!goc || !ho) throw new Error(`Ô khung ${maGoc} thiếu câu gốc hoặc họ.`);
      const info = HO[ho];
      if (info.truc !== goc.truc || info.dao !== goc.dao) {
        throw new Error(`Ô ${maGoc}: họ ${ho} (${info.truc}/${info.dao}) lệch câu gốc (${goc.truc}/${goc.dao}).`);
      }
      daCo.add(khoaSoTrung(goc.noiDung));
      ra.push({ ma: goc.ma, boDe, oKhung: maGoc, ho, truc: goc.truc, dao: goc.dao, noiDung: goc.noiDung, nguon: "goc" });

      for (const tang of xung.tang) {
        const mauDs = MAU_HANH_VI[tang][ho] ?? [];
        mauDs.forEach((mauTho, i) => {
          const { viNgu, nhom: khai } = tachMau(mauTho);
          const nhom = nhomHieuLuc(viNgu, khai);
          for (const bc of boiCanhCua(boDe, tang)) {
            if (!nhom.includes(bc.nhom) || !xung.nhom.includes(bc.nhom)) continue;
            const noiDung = ghepCau(bc.chu, viNgu, boDe);
            const khoa = khoaSoTrung(noiDung);
            if (daCo.has(khoa)) continue;
            daCo.add(khoa);
            const mau = `${chuTang[tang]}${i + 1}`;
            ra.push({
              ma: `${maGoc}.${mau}.${bc.ma}`,
              boDe,
              oKhung: maGoc,
              ho,
              truc: goc.truc,
              dao: goc.dao,
              noiDung,
              nguon: "sinh",
              mau,
              boiCanh: bc.ma,
            });
          }
        });
      }
    }
  }
  return ra;
}
