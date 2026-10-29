// lib/phan-cong/luoi-gop.ts — GHÉP màn Phân công gộp (GĐ3): lưới người × ngày × buổi S/C/T + danh sách buổi trong ngày. THUẦN — không
// DB, không đồng hồ. Đầu vào là dòng nguồn đã đọc (buổi + phân công còn sống · trực còn sống · việc ở cơ sở khác của cùng người).
//
// Mọi câu hỏi nghiệp vụ đi qua hàm GĐ1, không viết lại ở đây:
//   · buổi nào chứa việc dạy      → `xepBuoiVaoCa`
//   · ô mang mã gì, cờ trùng giờ  → `tinhMaO`
//   · ngày phải quét mấy cặp      → `capQuetKyVong`
// KHÔNG có tiền ở đây (màn Phân công không hiện tiền — chốt GĐ0). Tiền vẫn ở màn Công parttime tháng.
import { capQuetKyVong, type CapQuet } from "@/lib/cham-cong/cap-quet-ky-vong";
import { gopDayHoToiDaPhut, type ThamSoSrQd238 } from "@/lib/parttime/chinh-sach";
import { tinhMaO, xepBuoiVaoCa, type KetQuaMaO, type KhungCa, type LoaiViec, type ViecDay } from "./ma-o";

export type BuoiVao = {
  key: string;
  sourceType: "CLASS_SESSION" | "MAKEUP_CASE" | "TRIAL_SESSION";
  sourceId: string;
  ngay: string;
  gioBatDau: string;
  gioKetThuc: string;
  ten: string;
  phu: string | null;
  /** Tên phòng (null = chưa xếp phòng). Hai buổi cùng tên phòng ở cùng cơ sở = cùng phòng. */
  phong: string | null;
  /** Buổi còn mở để giao / gỡ (tinhTrang MO + thuộc SR.QD.238). */
  mo: boolean;
  main: { id: string; userId: string } | null;
  ta: { id: string; userId: string }[];
};

export type TrucVaoGop = { id: string; userId: string; ngay: string; shiftCode: string };
/** Việc của cùng người ở CƠ SỞ KHÁC — chỉ để báo trùng giờ. */
export type ViecNoiKhac = { id: string; userId: string; ngay: string; gioBatDau: string; gioKetThuc: string; coSoId: string; loai: LoaiViec };

export type BuoiGop = BuoiVao & {
  loai: LoaiViec;
  /** Buổi xếp vào ca nào của CƠ SỞ (hoà ⇒ ca có người trực). null = ngoài khung. */
  ca: string | null;
  /** Học bù / Trial rơi vào ca không ai trực (hoặc ngoài khung) — chốt GĐ0 số 2: đánh dấu trên màn. */
  khongAiTruc: boolean;
};

export type OGop = KetQuaMaO & {
  trucId: string | null;
  /** Việc của người này trong ô: phân công → buổi. */
  viec: { assignmentId: string; buoiKey: string; vai: "MAIN" | "TA" }[];
};

export type DongGop = {
  userId: string;
  ten: string;
  laMuon: boolean;
  o: Record<string, Record<string, OGop>>;
  cap: Record<string, CapQuet[]>;
};

export type LuoiGop = {
  ngays: string[];
  /** Mã ca theo ngày (null = ngày ngoài SR.QD.238 — không có lưới). */
  caTheoNgay: Record<string, string[] | null>;
  /** Khung giờ từng ca theo ngày (cùng nguồn `paramsJson.ca` với `caTheoNgay`) — panel in "Sáng 07:45–11:30". null = ngoài SR.QD.238. */
  khungCa: Record<string, KhungCa[] | null>;
  dong: DongGop[];
  buoi: BuoiGop[];
  /** ngày → ca → người trực (userId). */
  trucTheoCa: Record<string, Record<string, string[]>>;
};

const LOAI: Record<BuoiVao["sourceType"], LoaiViec> = { CLASS_SESSION: "LOP", MAKEUP_CASE: "BU", TRIAL_SESSION: "TRIAL" };

export function ghepLuoiGop(v: {
  ngays: readonly string[];
  /** Tham số chính sách tại ngày (null = LEGACY). */
  thamSoTai: (ngay: string) => ThamSoSrQd238 | null;
  centerId: string;
  /** Mọi người hiện trên lưới (GV của cơ sở + người có việc / trực ở đây), đã sắp. */
  nguoi: readonly { id: string; ten: string; laMuon: boolean }[];
  buoi: readonly BuoiVao[];
  truc: readonly TrucVaoGop[];
  viecNoiKhac: readonly ViecNoiKhac[];
}): LuoiGop {
  const caTheoNgay: LuoiGop["caTheoNgay"] = {};
  const khungCa: LuoiGop["khungCa"] = {};
  const trucTheoCa: LuoiGop["trucTheoCa"] = {};
  for (const ngay of v.ngays) {
    const ts = v.thamSoTai(ngay);
    caTheoNgay[ngay] = ts ? ts.ca.map((c) => c.ma) : null;
    khungCa[ngay] = ts ? ts.ca.map((c) => ({ ma: c.ma, tu: c.tu, den: c.den })) : null;
    trucTheoCa[ngay] = {};
    for (const t of v.truc.filter((x) => x.ngay === ngay)) (trucTheoCa[ngay]![t.shiftCode] ??= []).push(t.userId);
  }

  // Buổi: xếp vào ca theo khung của NGÀY; hoà phút ⇒ ca có BẤT KỲ ai trực ở cơ sở (chốt 11).
  const buoi: BuoiGop[] = v.buoi.map((b) => {
    const ts = v.thamSoTai(b.ngay);
    const coTruc = Object.keys(trucTheoCa[b.ngay] ?? {});
    const ca = ts ? xepBuoiVaoCa({ ca: ts.ca, gioBatDau: b.gioBatDau, gioKetThuc: b.gioKetThuc, caCoTruc: coTruc }) : null;
    const loai = LOAI[b.sourceType];
    const khongAiTruc = loai !== "LOP" && ts != null && b.mo && (ca == null || !(trucTheoCa[b.ngay]?.[ca]?.length));
    return { ...b, loai, ca, khongAiTruc };
  });

  const dong: DongGop[] = v.nguoi.map((n) => {
    const d: DongGop = { userId: n.id, ten: n.ten, laMuon: n.laMuon, o: {}, cap: {} };
    for (const ngay of v.ngays) {
      const ts = v.thamSoTai(ngay);
      if (!ts) continue;
      const trucCua = v.truc.filter((t) => t.userId === n.id && t.ngay === ngay);
      const caTruc = trucCua.map((t) => t.shiftCode);
      // Việc của người này trong ngày: ở đây (có phòng) + nơi khác (để báo trùng giờ).
      const viec: (ViecDay & { ca: string | null; buoiKey: string | null })[] = [];
      for (const b of buoi.filter((x) => x.ngay === ngay)) {
        const vai = b.main?.userId === n.id ? "MAIN" : b.ta.some((t) => t.userId === n.id) ? "TA" : null;
        if (!vai) continue;
        const id = vai === "MAIN" ? b.main!.id : b.ta.find((t) => t.userId === n.id)!.id;
        viec.push({
          id,
          loai: b.loai,
          vai,
          gioBatDau: b.gioBatDau,
          gioKetThuc: b.gioKetThuc,
          phongId: b.phong,
          coSoId: v.centerId,
          ca: xepBuoiVaoCa({ ca: ts.ca, gioBatDau: b.gioBatDau, gioKetThuc: b.gioKetThuc, caCoTruc: caTruc }),
          buoiKey: b.key,
        });
      }
      for (const x of v.viecNoiKhac.filter((y) => y.userId === n.id && y.ngay === ngay)) {
        viec.push({ id: x.id, loai: x.loai, vai: "MAIN", gioBatDau: x.gioBatDau, gioKetThuc: x.gioKetThuc, phongId: null, coSoId: x.coSoId, ca: null, buoiKey: null });
      }
      const o: Record<string, OGop> = {};
      for (const c of ts.ca) {
        const kq = tinhMaO({ ca: c.ma, viecTrongNgay: viec, truc: caTruc.includes(c.ma), toiDaTietMoiCa: ts.toiDaTietMoiCa });
        o[c.ma] = {
          ...kq,
          trucId: trucCua.find((t) => t.shiftCode === c.ma)?.id ?? null,
          viec: viec.filter((x) => x.ca === c.ma && x.buoiKey).map((x) => ({ assignmentId: x.id, buoiKey: x.buoiKey!, vai: x.vai })),
        };
      }
      d.o[ngay] = o;
      d.cap[ngay] = capQuetKyVong({
        ca: ts.ca,
        caTruc,
        viecDay: viec.filter((x) => x.buoiKey).map((x) => ({ ca: x.ca, gioBatDau: x.gioBatDau, gioKetThuc: x.gioKetThuc })),
        gopDayHoToiDaPhut: gopDayHoToiDaPhut(ts),
      });
    }
    return d;
  });

  return { ngays: [...v.ngays], caTheoNgay, khungCa, dong, buoi, trucTheoCa };
}
