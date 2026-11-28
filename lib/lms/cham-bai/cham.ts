import { z } from "zod";

import { idMu } from "./chieu";
import { chuanChu, sangViMo, type CauChuanHoa, type HanhDongKhoi, type VungHinh } from "./chuan-hoa";

/**
 * ENGINE CÂU HỎI — BƯỚC 3: CÂU TRẢ LỜI (kiểm cấu trúc) + CHẤM.
 *
 * Luật cứng:
 *  · KHÔNG có "chấm 0 âm thầm": mỗi câu trả về `tu_dong` (có điểm do máy tính) hoặc `cho_cham` (chờ giáo viên). Dạng/đáp án lỗi bị chặn ở
 *    `chuanHoaCau` trước khi tới đây.
 *  · Chưa trả lời một câu chấm máy ⇒ `tu_dong` đúng=false điểm 0 (bỏ trống là sai thật, không phải "chưa hỗ trợ").
 *  · Hai quyết định CHƯA được Owner duyệt nằm trong MỘT chỗ — `ChinhSachCham` — và có test cho cả hai giá trị:
 *      diemMotPhan  (mặc định false = TẤT CẢ HOẶC KHÔNG, như trắc nghiệm hiện tại của web);
 *      saiSoMacDinh (mặc định "0" = đúng tuyệt đối, khi giáo viên không đặt sai số cho câu nhập số).
 */

export type ChinhSachCham = { diemMotPhan: boolean; saiSoMacDinh: string };
export const CHINH_SACH_MAC_DINH: ChinhSachCham = { diemMotPhan: false, saiSoMacDinh: "0" };

const id = z.string().min(1).max(64);
export type KhoiTraLoi = { khoiId: string; con?: KhoiTraLoi[] };
const khoiSchema = (): z.ZodType<KhoiTraLoi> => z.lazy(() => z.strictObject({ khoiId: id, con: z.array(khoiSchema()).max(20).optional() })) as z.ZodType<KhoiTraLoi>;

/** Câu trả lời (CHIỀU GHI — strict: trường lạ như `diem`/`dung` bị từ chối, không bỏ qua im lặng). Khớp `traLoiSchema` của hợp đồng app. */
export const traLoiSchema = z.discriminatedUnion("dang", [
  z.strictObject({ dang: z.literal("chon_mot"), luaChonId: id }),
  z.strictObject({ dang: z.literal("chon_nhieu"), luaChonIds: z.array(id).min(1).max(10) }),
  z.strictObject({ dang: z.literal("dung_sai"), luaChonId: id }),
  z.strictObject({ dang: z.literal("ngan"), vanBan: z.string().max(500) }),
  z.strictObject({ dang: z.literal("tu_luan"), vanBan: z.string().max(20000) }),
  z.strictObject({ dang: z.literal("dien_khuyet"), cho: z.array(z.string().max(200)).min(1).max(10) }),
  z.strictObject({ dang: z.literal("ghep_cap"), cap: z.array(z.strictObject({ traiId: id, phaiId: id })).min(1).max(10) }),
  z.strictObject({ dang: z.literal("sap_xep"), thuTu: z.array(id).min(2).max(12) }),
  z.strictObject({ dang: z.literal("nop_san_pham"), tepIds: z.array(id).min(1).max(5) }),
  z.strictObject({ dang: z.literal("phan_loai"), gan: z.array(z.strictObject({ theId: id, nhomId: id })).min(1).max(16) }),
  z.strictObject({ dang: z.literal("chon_tren_hinh"), diem: z.array(z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(5) }),
  z.strictObject({ dang: z.literal("nhap_so"), giaTri: z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/, "Số không hợp lệ"), donVi: z.string().max(20).nullish() }),
  z.strictObject({ dang: z.literal("sap_khoi_lenh"), chuongTrinh: z.array(khoiSchema()).min(1).max(40) }),
]);
export type TraLoi = z.infer<typeof traLoiSchema>;

export type KiemTraLoi = { ok: true } | { ok: false; loi: string };
const sai = (loi: string): KiemTraLoi => ({ ok: false, loi });
const duyet: KiemTraLoi = { ok: true };
const trungLap = (a: readonly string[]) => new Set(a).size !== a.length;

/** Dựng bảng "id mờ → chỉ số gốc" (CHỈ máy chủ có seed ⇒ tính lại được). */
function bangId(seed: string, cauId: string, loai: string, n: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < n; i++) m.set(idMu(seed, cauId, loai, i), i);
  return m;
}

function demKhoi(ds: readonly KhoiTraLoi[]): number {
  return ds.reduce((n, k) => n + 1 + demKhoi(k.con ?? []), 0);
}
function doSau(ds: readonly KhoiTraLoi[]): number {
  return ds.length === 0 ? 0 : 1 + Math.max(0, ...ds.map((k) => doSau(k.con ?? [])));
}

/** Kiểm câu trả lời KHỚP CÂU (đúng dạng, id thuộc câu, đủ số lượng). Cấu trúc sai ⇒ 422 ở route, KHÔNG lưu. */
export function kiemTraTraLoi(c: CauChuanHoa, tl: TraLoi, seed: string): KiemTraLoi {
  if (tl.dang !== c.dang) return sai(`Câu này là dạng "${c.dang}", không nhận câu trả lời dạng "${tl.dang}".`);
  switch (c.dang) {
    case "chon_mot":
    case "dung_sai": {
      const t = tl as Extract<TraLoi, { luaChonId: string }>;
      return c.luaChon.some((l) => l.id === t.luaChonId) ? duyet : sai("Lựa chọn không thuộc câu hỏi.");
    }
    case "chon_nhieu": {
      const t = tl as Extract<TraLoi, { dang: "chon_nhieu" }>;
      if (trungLap(t.luaChonIds)) return sai("Lựa chọn bị lặp.");
      return t.luaChonIds.every((x) => c.luaChon.some((l) => l.id === x)) ? duyet : sai("Có lựa chọn không thuộc câu hỏi.");
    }
    case "ngan":
    case "tu_luan":
      return duyet;
    case "dien_khuyet": {
      const t = tl as Extract<TraLoi, { dang: "dien_khuyet" }>;
      return t.cho.length === c.manh.length - 1 ? duyet : sai(`Cần đúng ${c.manh.length - 1} chỗ trống.`);
    }
    case "ghep_cap": {
      const t = tl as Extract<TraLoi, { dang: "ghep_cap" }>;
      const bt = bangId(seed, c.goc.id, "t", c.trai.length);
      const bp = bangId(seed, c.goc.id, "p", c.phai.length);
      if (t.cap.length !== c.trai.length) return sai(`Cần ghép đủ ${c.trai.length} cặp.`);
      if (trungLap(t.cap.map((x) => x.traiId)) || trungLap(t.cap.map((x) => x.phaiId))) return sai("Mỗi mục chỉ được ghép một lần.");
      return t.cap.every((x) => bt.has(x.traiId) && bp.has(x.phaiId)) ? duyet : sai("Có mục không thuộc câu hỏi.");
    }
    case "sap_xep": {
      const t = tl as Extract<TraLoi, { dang: "sap_xep" }>;
      const b = bangId(seed, c.goc.id, "m", c.muc.length);
      if (t.thuTu.length !== c.muc.length || trungLap(t.thuTu)) return sai("Thứ tự phải gồm đủ mọi mục, mỗi mục một lần.");
      return t.thuTu.every((x) => b.has(x)) ? duyet : sai("Có mục không thuộc câu hỏi.");
    }
    case "nop_san_pham": {
      const t = tl as Extract<TraLoi, { dang: "nop_san_pham" }>;
      return t.tepIds.length <= 1 && !trungLap(t.tepIds) ? duyet : sai("Chỉ được nộp 1 tệp cho câu này.");
    }
    case "phan_loai": {
      const t = tl as Extract<TraLoi, { dang: "phan_loai" }>;
      const bc = bangId(seed, c.goc.id, "c", c.the.length);
      const bn = bangId(seed, c.goc.id, "n", c.nhom.length);
      if (t.gan.length !== c.the.length || trungLap(t.gan.map((x) => x.theId))) return sai("Phải xếp đủ mọi thẻ, mỗi thẻ một nhóm.");
      return t.gan.every((x) => bc.has(x.theId) && bn.has(x.nhomId)) ? duyet : sai("Có thẻ/nhóm không thuộc câu hỏi.");
    }
    case "chon_tren_hinh": {
      const t = tl as Extract<TraLoi, { dang: "chon_tren_hinh" }>;
      return t.diem.length <= c.soDiemToiDa ? duyet : sai(`Tối đa ${c.soDiemToiDa} điểm.`);
    }
    case "nhap_so": {
      const t = tl as Extract<TraLoi, { dang: "nhap_so" }>;
      if (sangViMo(t.giaTri) === null) return sai("Số không hợp lệ.");
      if (!c.choPhepThapPhan && t.giaTri.includes(".")) return sai("Câu này chỉ nhận số nguyên.");
      return duyet;
    }
    case "sap_khoi_lenh": {
      const t = tl as Extract<TraLoi, { dang: "sap_khoi_lenh" }>;
      const hop = new Map(c.hopKhoi.map((k) => [k.id, k] as const));
      if (doSau(t.chuongTrinh) > 2) return sai("Tối đa 2 cấp khối lồng nhau.");
      if (demKhoi(t.chuongTrinh) > c.soKhoiToiDa) return sai(`Tối đa ${c.soKhoiToiDa} khối.`);
      const hopLe = (ds: readonly KhoiTraLoi[]): boolean => ds.every((k) => { const h = hop.get(k.khoiId); return !!h && (h.loai === "lap" || !k.con?.length) && hopLe(k.con ?? []); });
      return hopLe(t.chuongTrinh) ? duyet : sai("Khối không thuộc hộp khối lệnh hoặc lồng sai chỗ.");
    }
  }
}

// ── chấm ──
export type KetQuaCham =
  | { trangThai: "tu_dong"; dung: boolean; diem: number; soDung: number; tong: number }
  | { trangThai: "cho_cham" };

const lamTron = (x: number) => Math.round(x * 100) / 100;
function ra(c: CauChuanHoa, soDung: number, tong: number, cs: ChinhSachCham): KetQuaCham {
  const dung = tong > 0 && soDung === tong;
  const diem = dung ? c.goc.points : cs.diemMotPhan && tong > 0 ? lamTron((c.goc.points * soDung) / tong) : 0;
  return { trangThai: "tu_dong", dung, diem, soDung, tong };
}

export function diemTrongVung(v: VungHinh, x: number, y: number, tiLe = 1): boolean {
  if (v.loai === "tron") {
    const dx = (x - v.x) * tiLe; // quy về đơn vị chiều cao
    const dy = y - v.y;
    return dx * dx + dy * dy <= v.r * v.r;
  }
  if (v.loai === "chu_nhat") return x >= v.x && x <= v.x + v.rong && y >= v.y && y <= v.y + v.cao;
  let trong = false;
  for (let i = 0, j = v.diem.length - 1; i < v.diem.length; j = i++) {
    const [xi, yi] = v.diem[i]!;
    const [xj, yj] = v.diem[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) trong = !trong;
  }
  return trong;
}

const HUONG = ["B", "D", "N", "T"] as const;
const DH: Record<(typeof HUONG)[number], readonly [number, number]> = { B: [-1, 0], D: [0, 1], N: [1, 0], T: [0, -1] };
export const TRAN_BUOC_MO_PHONG = 500;
export type LyDoMoPhong = "toi_dich" | "khong_toi" | "dam_tuong" | "ra_ngoai" | "qua_nhieu_buoc" | "khoi_la";

/** CHẠY MÔ PHỎNG robot trên bản đồ (không so chuỗi). Đúng khi dừng đúng ô đích. */
export function moPhong(
  ban: Extract<CauChuanHoa, { dang: "sap_khoi_lenh" }>["banDo"],
  dinhNghia: ReadonlyMap<string, HanhDongKhoi>,
  chuongTrinh: readonly KhoiTraLoi[],
): { toiDich: boolean; lyDo: LyDoMoPhong; soBuoc: number } {
  let [h, c] = ban.batDau;
  let hi = HUONG.indexOf(ban.huong);
  let buoc = 0;
  let loi: LyDoMoPhong | null = null;
  let dungLai = false;
  const tuong = new Set(ban.tuong.map(([a, b]) => `${a},${b}`));
  const chay = (ds: readonly KhoiTraLoi[]): void => {
    for (const k of ds) {
      if (loi || dungLai) return;
      if (++buoc > TRAN_BUOC_MO_PHONG) { loi = "qua_nhieu_buoc"; return; }
      const d = dinhNghia.get(k.khoiId);
      if (!d) { loi = "khoi_la"; return; }
      if (d.kieu === "di") {
        const [dh, dc] = DH[HUONG[hi]!];
        const nh = h + dh;
        const nc = c + dc;
        if (nh < 0 || nc < 0 || nh >= ban.hang || nc >= ban.cot) { loi = "ra_ngoai"; return; }
        if (tuong.has(`${nh},${nc}`)) { loi = "dam_tuong"; return; }
        h = nh;
        c = nc;
      } else if (d.kieu === "phai") hi = (hi + 1) % 4;
      else if (d.kieu === "trai") hi = (hi + 3) % 4;
      else if (d.kieu === "dung") dungLai = true;
      else for (let i = 0; i < d.so && !loi && !dungLai; i++) chay(k.con ?? []);
    }
  };
  chay(chuongTrinh);
  if (loi) return { toiDich: false, lyDo: loi, soBuoc: buoc };
  const toi = h === ban.dich[0] && c === ban.dich[1];
  return { toiDich: toi, lyDo: toi ? "toi_dich" : "khong_toi", soBuoc: buoc };
}

/** Chấm MỘT câu. `tl = null` = bỏ trống. Câu đã qua `kiemTraTraLoi` (id/số lượng hợp lệ) — id lạ vẫn không bao giờ tính đúng. */
export function chamCau(c: CauChuanHoa, tl: TraLoi | null, seed: string, cs: ChinhSachCham = CHINH_SACH_MAC_DINH): KetQuaCham {
  if (c.dang === "tu_luan" || c.dang === "nop_san_pham") return { trangThai: "cho_cham" };
  if (tl === null || tl.dang !== c.dang) return ra(c, 0, 1, cs); // bỏ trống / lệch dạng ⇒ sai thật, không phải "chưa hỗ trợ"
  switch (c.dang) {
    case "chon_mot":
    case "dung_sai": {
      const t = tl as Extract<TraLoi, { luaChonId: string }>;
      return ra(c, c.dungIds.length === 1 && c.dungIds[0] === t.luaChonId ? 1 : 0, 1, cs);
    }
    case "chon_nhieu": {
      const t = tl as Extract<TraLoi, { dang: "chon_nhieu" }>;
      const chon = new Set(t.luaChonIds);
      const dung = c.dungIds.length === chon.size && c.dungIds.every((x) => chon.has(x));
      return ra(c, dung ? 1 : 0, 1, cs); // trắc nghiệm nhiều đáp án: tất cả-hoặc-không (như web)
    }
    case "ngan": {
      const t = tl as Extract<TraLoi, { dang: "ngan" }>;
      return ra(c, chuanChu(t.vanBan) === chuanChu(c.dapAn) ? 1 : 0, 1, cs);
    }
    case "dien_khuyet": {
      const t = tl as Extract<TraLoi, { dang: "dien_khuyet" }>;
      const tong = c.chapNhan.length;
      if (t.cho.length !== tong) return ra(c, 0, tong, cs);
      return ra(c, c.chapNhan.filter((ds, i) => ds.some((d) => chuanChu(d) === chuanChu(t.cho[i]!))).length, tong, cs);
    }
    case "ghep_cap": {
      const t = tl as Extract<TraLoi, { dang: "ghep_cap" }>;
      const bt = bangId(seed, c.goc.id, "t", c.trai.length);
      const bp = bangId(seed, c.goc.id, "p", c.phai.length);
      const da = new Set<number>();
      let soDung = 0;
      for (const x of t.cap) {
        const i = bt.get(x.traiId);
        const j = bp.get(x.phaiId);
        if (i === undefined || j === undefined || da.has(i)) continue;
        da.add(i);
        if (chuanChu(c.phai[j]!) === chuanChu(c.phai[i]!)) soDung++; // so theo NỘI DUNG vế phải (vế phải trùng chữ vẫn đúng)
      }
      return ra(c, soDung, c.trai.length, cs);
    }
    case "sap_xep": {
      const t = tl as Extract<TraLoi, { dang: "sap_xep" }>;
      const b = bangId(seed, c.goc.id, "m", c.muc.length);
      if (t.thuTu.length !== c.muc.length) return ra(c, 0, c.muc.length, cs);
      return ra(c, t.thuTu.filter((x, vt) => { const i = b.get(x); return i !== undefined && chuanChu(c.muc[i]!) === chuanChu(c.muc[vt]!); }).length, c.muc.length, cs);
    }
    case "phan_loai": {
      const t = tl as Extract<TraLoi, { dang: "phan_loai" }>;
      const bc = bangId(seed, c.goc.id, "c", c.the.length);
      const bn = bangId(seed, c.goc.id, "n", c.nhom.length);
      const ganTheo = new Map(t.gan.map((x) => [x.theId, x.nhomId] as const));
      let soDung = 0;
      c.the.forEach((the, i) => {
        const idThe = idMu(seed, c.goc.id, "c", i);
        const nhomChon = bn.get(ganTheo.get(idThe) ?? "");
        if (bc.has(idThe) && nhomChon !== undefined && c.nhom[nhomChon]!.id === the.nhomId) soDung++;
      });
      return ra(c, soDung, c.the.length, cs);
    }
    case "chon_tren_hinh": {
      const t = tl as Extract<TraLoi, { dang: "chon_tren_hinh" }>;
      const tiLe = c.hinh.rong / c.hinh.cao;
      const trung = c.vung.map((v) => t.diem.some((d) => diemTrongVung(v, d.x, d.y, tiLe)));
      const diemThua = t.diem.some((d) => !c.vung.some((v) => diemTrongVung(v, d.x, d.y, tiLe)));
      const soDung = diemThua ? 0 : trung.filter(Boolean).length; // điểm thừa ngoài vùng ⇒ sai (không cho "rải điểm")
      return ra(c, soDung, c.vung.length, cs);
    }
    case "nhap_so": {
      const t = tl as Extract<TraLoi, { dang: "nhap_so" }>;
      const a = sangViMo(t.giaTri);
      const b = sangViMo(c.giaTri);
      const e = sangViMo(c.saiSo ?? cs.saiSoMacDinh);
      if (a === null || b === null || e === null || e < BigInt(0)) return ra(c, 0, 1, cs);
      const lech = a > b ? a - b : b - a;
      const donViKhop = !c.donVi || chuanChu(c.donVi) === chuanChu(t.donVi ?? "");
      return ra(c, lech <= e && donViKhop ? 1 : 0, 1, cs);
    }
    case "sap_khoi_lenh": {
      const t = tl as Extract<TraLoi, { dang: "sap_khoi_lenh" }>;
      const dn = new Map(c.hopKhoi.map((k) => [k.id, k.hanhDong] as const));
      const r = moPhong(c.banDo, dn, t.chuongTrinh);
      return ra(c, r.toiDich && demKhoi(t.chuongTrinh) <= c.soKhoiToiDa ? 1 : 0, 1, cs);
    }
  }
}

export type TongKet = { tongDiem: number; canGiaoVien: boolean; soCauTuDong: number };
/** Gộp điểm cả lượt: có MỘT câu `cho_cham` ⇒ cả lượt chờ giáo viên (điểm máy là tạm). */
export function tongKetLuot(kq: readonly KetQuaCham[]): TongKet {
  let tong = 0;
  let canGv = false;
  let tuDong = 0;
  for (const k of kq) {
    if (k.trangThai === "cho_cham") canGv = true;
    else { tong += k.diem; tuDong++; }
  }
  return { tongDiem: lamTron(tong), canGiaoVien: canGv, soCauTuDong: tuDong };
}
