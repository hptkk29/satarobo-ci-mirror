// lib/phan-cong/ma-o.ts — MÃ Ô của màn Phân công gộp (GĐ1, docs/phan-cong-gop/KHAO-SAT.md mục "CHỐT GĐ0"). THUẦN — không DB, không đồng hồ.
//
// Ô = giáo viên × ngày × buổi (S/C/T theo `paramsJson.ca` của chính sách). Hai câu hỏi, mỗi câu MỘT hàm; màn Phân công, engine công và màn
// Công parttime cùng gọi, không viết lại điều kiện ở chỗ gọi:
//   1. một việc dạy rơi vào buổi nào                → xepBuoiVaoCa   (chốt 11: nhiều phút hơn → ca có trực → ca sau)
//   2. ô này mang mã gì, bao nhiêu tiết, trực mấy ca → tinhMaO        (chốt 12: ghép học bù/Trial, cờ trùng giờ)
//
// Bảng mã là `maTongQuat` (chốt GĐ1 số 6): bảng 1.2 (D / T / TG / TD / TTG / D2 / D+TG / TG2) mở rộng D{n} · TG{n} · D{n}+TG{m} — không ô
// nào có tiết mà không có mã. `maNen` (lib/parttime/luoi-tuan.ts) GIỮ NGUYÊN vì màn tiền dự kiến cũ còn đọc nó (ô > 2 tiết ở đó vẫn là
// QUA_SO_TIET, tiền trực chưa tính) — đổi nó là đổi số tiền dự kiến, việc của đợt khác. Hai hàm trùng nhau ở mọi ô ≤ 2 tiết ([MAO-30]).
// Mã ở đây là không gian tên của lưới phân công, KHÔNG phải mã ca `ShiftTemplate` (lib/cham-cong/catalog.ts).
import { phutTrongNgay } from "@/lib/parttime/chinh-sach";
import { trucQuyDoi } from "@/lib/parttime/luoi-tuan";

export type KhungCa = { ma: string; tu: string; den: string };

/** LOP = buổi lớp chính thức · BU = case học bù · TRIAL = buổi trải nghiệm. */
export type LoaiViec = "LOP" | "BU" | "TRIAL";

export type ViecDay = {
  /** id dòng phân công — dòng dõi cho panel / đối soát. */
  id: string;
  loai: LoaiViec;
  vai: "MAIN" | "TA";
  /** Giờ DẠY "HH:mm". */
  gioBatDau: string;
  gioKetThuc: string;
  /** Phòng của buổi; null = chưa xếp phòng. BẮT BUỘC khai (luật 7) — nó quyết "ghép" hay "trùng giờ". */
  phongId: string | null;
  coSoId: string;
};

const phut = (v: { gioBatDau: string; gioKetThuc: string }) => [phutTrongNgay(v.gioBatDau), phutTrongNgay(v.gioKetThuc)] as const;
const giaoPhut = (a: readonly [number, number], b: readonly [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/**
 * Buổi nào chứa việc dạy `[gioBatDau, gioKetThuc]` (chốt 11): ca chứa NHIỀU PHÚT của việc hơn; hoà ⇒ ca có trong `caCoTruc`; vẫn hoà ⇒ ca
 * SAU (giờ bắt đầu muộn hơn). Không ca nào giao một phút ⇒ null (ngoài khung — không đoán).
 * `caCoTruc`: ca có người trực — với ô của MỘT người là ca người đó trực; với tự xếp học bù/Trial là ca có bất kỳ ai trực ở cơ sở. BẮT BUỘC.
 */
export function xepBuoiVaoCa(p: { ca: readonly KhungCa[]; gioBatDau: string; gioKetThuc: string; caCoTruc: readonly string[] }): string | null {
  const viec = phut(p);
  let tot: { ma: string; phut: number; truc: boolean; tu: number } | null = null;
  for (const c of p.ca) {
    const khung = [phutTrongNgay(c.tu), phutTrongNgay(c.den)] as const;
    const ung = { ma: c.ma, phut: giaoPhut(viec, khung), truc: p.caCoTruc.includes(c.ma), tu: khung[0] };
    if (ung.phut === 0) continue;
    const hon =
      !tot ||
      ung.phut > tot.phut ||
      (ung.phut === tot.phut && ung.truc && !tot.truc) ||
      (ung.phut === tot.phut && ung.truc === tot.truc && ung.tu > tot.tu);
    if (hon) tot = ung;
  }
  return tot?.ma ?? null;
}

/** Mã ô của lưới gộp: bảng 1.2 + dạng tổng quát (chốt GĐ1 số 6). Không gian tên RIÊNG — không phải mã ca `ShiftTemplate`. */
export type MaOGop = "X" | "T" | "D" | "TG" | "TD" | "TTG" | `D${number}` | `TG${number}` | `D${string}+TG${string}`;

/**
 * Mã từ số tiết đứng chính / trợ giảng và việc có trực. 0 tiết ⇒ T / X · 1 tiết ⇒ D / TG (có trực: TD / TTG) · ≥ 2 tiết ⇒ D{n}, TG{m},
 * D{n}+TG{m} (số 1 không viết: D2 · D+TG · TG2 · D3 · D2+TG), có trực cũng không thêm T — trực quy đổi 0 (chốt 6).
 */
export function maTongQuat(p: { main: number; ta: number; truc: boolean }): MaOGop {
  const { main, ta, truc } = p;
  if (main + ta === 0) return truc ? "T" : "X";
  if (main + ta === 1) return main === 1 ? (truc ? "TD" : "D") : truc ? "TTG" : "TG";
  const d = main === 0 ? "" : main === 1 ? "D" : `D${main}`;
  const g = ta === 0 ? "" : ta === 1 ? "TG" : `TG${ta}`;
  return (d && g ? `${d}+${g}` : d || g) as MaOGop;
}

export type CapTrungGio = { a: string; b: string };

export type KetQuaMaO = {
  ma: MaOGop;
  /** Số việc đứng chính / trợ giảng ĐƯỢC ĐẾM trong ô (không gồm Trial và học bù ghép). Đơn vị tiết thập phân là việc của tầng tiền. */
  tietD: number;
  tietTG: number;
  /** Trực quy đổi (1 · 0,5 · 0) khi ô có trực; 0 khi không trực. Tổng tiết ≥ 2 ⇒ 0 (chốt 6). */
  trucQuyDoi: number;
  /** Ô có buổi Trial ⇒ hiện đuôi `+TR`. */
  coTrial: boolean;
  /** Cờ đỏ: có cặp việc trong NGÀY chồng giờ mà một trong hai rơi vào ô này (chốt 12). */
  coTrungGio: boolean;
  trungGio: CapTrungGio[];
  /** Cờ VÀNG (chốt lượt 2 điểm 1, 27/10): ô có học bù / Trial CHƯA có phòng (bản ghi cũ — bản ghi mới bắt buộc phòng). Chỉ báo, không
   *  chặn, không đỏ, KHÔNG đổi luật ghép (thiếu phòng vẫn tính như cùng phòng). */
  coChuaPhong: boolean;
  /** Học bù / Trial ghép (không cộng tiết): vào lớp của chính GV, hoặc vào học bù / Trial khác của GV bắt đầu SỚM hơn — cùng cơ sở,
   *  cùng phòng (hoặc chưa biết phòng), chồng giờ (chốt 12 + chốt GĐ1 số 2). */
  ghep: string[];
};

/**
 * Hai việc chồng giờ có phải "người ở hai nơi" (cờ đỏ) không — chốt 12:
 *   · hai LỚP chính thức chồng giờ ⇒ đỏ, bất kể phòng;
 *   · học bù / Trial chồng giờ với việc khác ở cơ sở khác hoặc phòng khác ⇒ đỏ;
 *   · học bù / Trial chồng giờ với việc khác cùng cơ sở, cùng phòng (hoặc chưa biết phòng) ⇒ GHÉP, không đỏ.
 */
function laTrungGio(a: ViecDay, b: ViecDay): boolean {
  if (giaoPhut(phut(a), phut(b)) === 0) return false;
  if (a.loai === "LOP" && b.loai === "LOP") return true;
  if (a.coSoId !== b.coSoId) return true;
  return a.phongId != null && b.phongId != null && a.phongId !== b.phongId;
}

/**
 * Mã của ô (người × ngày × `ca`). `viecTrongNgay` = MỌI việc dạy còn sống của người đó trong ngày (mọi cơ sở) kèm `ca` đã xếp bằng
 * `xepBuoiVaoCa` — cần cả ngày vì trùng giờ có thể vắt qua ô khác / cơ sở khác.
 */
export function tinhMaO(p: {
  ca: string;
  viecTrongNgay: readonly (ViecDay & { ca: string | null })[];
  /** Người này có dòng trực còn sống ở ô này. */
  truc: boolean;
  toiDaTietMoiCa: number;
}): KetQuaMaO {
  const trongO = p.viecTrongNgay.filter((v) => v.ca === p.ca);
  const ghepDuoc = (v: ViecDay, w: ViecDay) => v.id !== w.id && giaoPhut(phut(v), phut(w)) > 0 && !laTrungGio(v, w);

  // Ghép (không cộng tiết), theo thứ tự:
  //   · học bù / Trial chồng giờ với LỚP của chính GV mà không phải "trùng giờ" (chốt 12);
  //   · học bù / Trial chồng giờ với học bù / Trial khác của GV mà không phải "trùng giờ" ⇒ việc bắt đầu SỚM hơn là việc chính, việc kia
  //     ghép (chốt GĐ1 số 2 — hai việc một tiết). Cùng giờ bắt đầu: học bù đứng trước Trial (Trial không bao giờ là tiết), rồi theo id —
  //     tất định, không phụ thuộc thứ tự mảng.
  const thuTu = (v: ViecDay) => [phutTrongNgay(v.gioBatDau), v.loai === "TRIAL" ? 1 : 0] as const;
  const dungTruoc = (w: ViecDay, v: ViecDay) => {
    const [a, b] = [thuTu(w), thuTu(v)];
    return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : w.id < v.id;
  };
  const ghep = trongO
    .filter(
      (v) =>
        v.loai !== "LOP" &&
        // Học bù KHÔNG ghép vào Trial: Trial không bao giờ là tiết, ghép vào nó là mất tiết của học bù (hai việc phải còn MỘT tiết).
        p.viecTrongNgay.some((w) => ghepDuoc(v, w) && (w.loai === "LOP" || (dungTruoc(w, v) && !(v.loai === "BU" && w.loai === "TRIAL")))),
    )
    .map((v) => v.id);

  const trungGio: CapTrungGio[] = [];
  const ds = p.viecTrongNgay;
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i]!;
      const b = ds[j]!;
      if ((a.ca === p.ca || b.ca === p.ca) && laTrungGio(a, b)) trungGio.push({ a: a.id, b: b.id });
    }

  const dem = trongO.filter((v) => v.loai !== "TRIAL" && !ghep.includes(v.id));
  const tietD = dem.filter((v) => v.vai === "MAIN").length;
  const tietTG = dem.filter((v) => v.vai === "TA").length;
  const tong = tietD + tietTG;
  return {
    ma: maTongQuat({ main: tietD, ta: tietTG, truc: p.truc }),
    tietD,
    tietTG,
    trucQuyDoi: !p.truc || tong >= 2 ? 0 : trucQuyDoi(tong, p.toiDaTietMoiCa),
    coTrial: trongO.some((v) => v.loai === "TRIAL"),
    coTrungGio: trungGio.length > 0,
    trungGio,
    coChuaPhong: trongO.some((v) => v.loai !== "LOP" && v.phongId == null),
    ghep,
  };
}
