// lib/parttime/viec-ngay.ts — VIỆC THEO PHÂN CÔNG của giáo viên parttime, theo (người × NGÀY). THUẦN — không DB, không đồng hồ.
//
// Chủ dự án chốt 08/11/2026: từ mốc `shift.parttimeLuatCongMoiTuKy` (01/11/2026) công GV parttime = việc theo phân công, ĐÚNG phép tính
// "Lương dự kiến" của màn Phân công. Hàm này KHÔNG tính lại gì (luật 12b) — nó CẮT theo ngày đúng hai thứ màn Phân công đang vẽ:
//   · MÃ Ô (D / TD / D2 / TG / T…, đuôi +TR) lấy từ lưới gộp (`docLuoiGop` → `tinhMaO`) — chính chữ màn Phân công in trong ô;
//   · số tiết / ca trực / tiền lấy từ dòng tiền của ô (`docLuoiTuan` → `ghepLuoi` → `tinhCaDuKien`), tiền theo nhóm qua `tongHopTuan`
//     trên lát MỘT ngày — nên tổng các ngày = tổng tuần màn Phân công in (`tongHopTuan` cộng dồn theo ô).
//
// Đếm từ `ke.dong`, KHÔNG từ `hoatDong`: `hoatDong` còn chứa việc bị GHÉP, buổi Trial, phân công chưa nhận — thứ `tinhCaDuKien` đã loại.
// Dòng tiền `thanhTien == null` (buổi lệch chuẩn chưa quyết, trực chưa tính được) KHÔNG cộng — đếm vào `chuaTinh` để màn NÓI ra.
// Ngày không có chính sách SR.QD.238 (`ke == null`) ⇒ `legacy` — màn nói "chưa có chính sách", không in 0.
import type { CanhBaoO, DongGiaoVien } from "./luoi-tuan-ghep";
import { NHOM_TIEN, tongHopTuan, type NhomTien } from "./luong-tuan";

/** Một ô có việc (người × ngày × ca × cơ sở). `ma` = chữ màn Phân công in trong ô; `coTrial` = đuôi +TR. */
export type OViec = { centerId: string; ca: string; ma: string; coTrial: boolean; canhBao: CanhBaoO[] };

export type ViecNgay = {
  userId: string;
  /** Tên như màn Phân công in (`docLuoiTuan`) — đọc không qua scope, nên GV mượn từ cơ sở khác vẫn có tên. */
  ten: string;
  ngay: string;
  /** Cơ sở có việc trong ngày (gộp nhiều cơ sở ở site GV). */
  coSo: string[];
  o: OViec[];
  /** Số tiết ĐỨNG CHÍNH đã tính được (dòng MAIN của ô — có thể lẻ khi buổi lệch chuẩn đã ghi đè). */
  tietChinh: number;
  tietTroGiang: number;
  /** Số ô có dòng trực quy đổi 1 ca / 0,5 ca (dòng trực tính được). */
  trucDu: number;
  trucNua: number;
  /** Σ ca trực quy đổi (1 · 0,5). */
  trucQuyDoi: number;
  /** Buổi Trial đứng chính trong ngày (để nói "Trial 1"); tiền hỗ trợ Trial nằm ở `tienTheoNhom.HO_TRO_TRIAL`. */
  soBuoiTrial: number;
  /** Tiền DỰ KIẾN của ngày — chỉ các dòng tính được (`tongHopTuan(...).keHoach`). */
  tien: number;
  tienTheoNhom: Record<NhomTien, number>;
  /** Số dòng tiền CHƯA tính được — không cộng vào `tien`. */
  chuaTinh: number;
  /** Phân công không nằm trọn ca nào (vượt ranh ca) — KHÔNG có trong ô, không tính tiền; màn phải nói ra. */
  ngoaiCa: number;
  /** Có việc ở ngày không có chính sách SR.QD.238 — không có mã / tiền dự kiến. */
  legacy: boolean;
};

/** Dữ liệu một cơ sở × một khoảng ngày, ĐÃ đọc bằng đúng hai bộ đọc của màn Phân công. */
export type LuoiCoSo = {
  centerId: string;
  /** `docLuoiGop(...).dong` — chỉ cần mã ô. */
  gop: readonly { userId: string; o: Record<string, Record<string, { ma: string; coTrial: boolean }>> }[];
  /** `docLuoiTuan(...).dong` (đã ăn CHÍNH `gop` ở trên). */
  tuan: readonly (DongGiaoVien & { ten: string })[];
};

const rongNhom = (): Record<NhomTien, number> => Object.fromEntries(NHOM_TIEN.map((n) => [n, 0])) as Record<NhomTien, number>;

function motNgay(centerId: string, d: DongGiaoVien & { ten: string }, ngay: string, maGop: Record<string, { ma: string; coTrial: boolean }> | undefined): ViecNgay | null {
  const theoCa = d.o[ngay];
  if (!theoCa) return null;
  const o: OViec[] = [];
  let tietChinh = 0;
  let tietTroGiang = 0;
  let trucDu = 0;
  let trucNua = 0;
  let trucQuyDoi = 0;
  let soBuoiTrial = 0;
  let legacy = false;
  const lat: DongGiaoVien["o"][string] = {};
  for (const [ca, c] of Object.entries(theoCa)) {
    if (!c.hoatDong.length && !c.trucId) continue;
    lat[ca] = c;
    const g = maGop?.[ca];
    o.push({ centerId, ca, ma: g?.ma ?? c.ke?.ma ?? "?", coTrial: g?.coTrial ?? c.ke?.coTrial ?? false, canhBao: [...c.canhBao] });
    if (!c.ke) {
      legacy = true;
      continue;
    }
    for (const dt of c.ke.dong) {
      if (dt.thanhTien == null) continue;
      if (dt.loai === "MAIN") tietChinh += dt.soLuong;
      else if (dt.loai === "TA") tietTroGiang += dt.soLuong;
      else if (dt.loai === "TRUC" && dt.soLuong > 0) {
        trucQuyDoi += dt.soLuong;
        if (dt.soLuong >= 1) trucDu++;
        else trucNua++;
      }
    }
    soBuoiTrial += c.hoatDong.filter((h) => h.loai === "TRIAL" && h.vai === "MAIN").length;
  }
  const ngoaiCa = d.ngoaiCa[ngay]?.length ?? 0;
  if (!o.length && !ngoaiCa) return null;
  // Tiền theo nhóm: CHÍNH `tongHopTuan` trên lát một ngày (không cộng lại tay — luật 12b).
  const t = tongHopTuan({ ...d, o: { [ngay]: lat } });
  const tienTheoNhom = rongNhom();
  for (const n of t.nhom) tienTheoNhom[n.loai] = n.keHoach;
  return {
    userId: d.userId,
    ten: d.ten,
    ngay,
    coSo: [centerId],
    o,
    tietChinh,
    tietTroGiang,
    trucDu,
    trucNua,
    trucQuyDoi,
    soBuoiTrial,
    tien: t.keHoach,
    tienTheoNhom,
    chuaTinh: t.chuaTinh,
    ngoaiCa,
    legacy,
  };
}

/** Gộp hai bản ghi cùng (người × ngày) ở hai cơ sở — site GV gộp mọi cơ sở. */
function cong(a: ViecNgay, b: ViecNgay): ViecNgay {
  const tienTheoNhom = rongNhom();
  for (const n of NHOM_TIEN) tienTheoNhom[n] = a.tienTheoNhom[n] + b.tienTheoNhom[n];
  return {
    ...a,
    coSo: [...new Set([...a.coSo, ...b.coSo])],
    o: [...a.o, ...b.o],
    tietChinh: a.tietChinh + b.tietChinh,
    tietTroGiang: a.tietTroGiang + b.tietTroGiang,
    trucDu: a.trucDu + b.trucDu,
    trucNua: a.trucNua + b.trucNua,
    trucQuyDoi: a.trucQuyDoi + b.trucQuyDoi,
    soBuoiTrial: a.soBuoiTrial + b.soBuoiTrial,
    tien: a.tien + b.tien,
    tienTheoNhom,
    chuaTinh: a.chuaTinh + b.chuaTinh,
    ngoaiCa: a.ngoaiCa + b.ngoaiCa,
    legacy: a.legacy || b.legacy,
  };
}

const THU_TU_CA: Record<string, number> = { S: 0, C: 1, T: 2 };

/**
 * Cắt lưới phân công thành (người × ngày). `luoi` = một hoặc nhiều cơ sở; cùng (người × ngày) ở nhiều cơ sở được GỘP (site GV).
 * Màn admin truyền đúng MỘT cơ sở đang xem ⇒ chỉ việc ở cơ sở đó. `userIds` = chỉ những người này; "TAT_CA" = mọi người trong lưới.
 * BẮT BUỘC (luật 7: tham số mở rộng phạm vi không có mặc định).
 */
export function viecTheoNgay(luoi: readonly LuoiCoSo[], userIds: readonly string[] | "TAT_CA"): ViecNgay[] {
  const chon = userIds === "TAT_CA" ? null : new Set(userIds);
  const theoKhoa = new Map<string, ViecNgay>();
  for (const l of luoi) {
    const gopTheoNguoi = new Map(l.gop.map((g) => [g.userId, g]));
    for (const d of l.tuan) {
      if (chon && !chon.has(d.userId)) continue;
      for (const ngay of Object.keys(d.o)) {
        const v = motNgay(l.centerId, d, ngay, gopTheoNguoi.get(d.userId)?.o[ngay]);
        if (!v) continue;
        const k = `${v.userId}|${ngay}`;
        const cu = theoKhoa.get(k);
        theoKhoa.set(k, cu ? cong(cu, v) : v);
      }
    }
  }
  return [...theoKhoa.values()]
    .map((v) => ({ ...v, o: [...v.o].sort((a, b) => (THU_TU_CA[a.ca] ?? 9) - (THU_TU_CA[b.ca] ?? 9) || a.centerId.localeCompare(b.centerId)) }))
    .sort((a, b) => a.ngay.localeCompare(b.ngay) || a.userId.localeCompare(b.userId));
}

export type TongViec = Omit<ViecNgay, "userId" | "ten" | "ngay" | "o" | "coSo"> & { soNgay: number };

/** Tổng của nhiều ngày (tóm tắt tháng) — cộng các trường đã cắt, KHÔNG tính lại. */
export function tongViec(ds: readonly ViecNgay[]): TongViec {
  const tienTheoNhom = rongNhom();
  const t: TongViec = { soNgay: ds.length, tietChinh: 0, tietTroGiang: 0, trucDu: 0, trucNua: 0, trucQuyDoi: 0, soBuoiTrial: 0, tien: 0, tienTheoNhom, chuaTinh: 0, ngoaiCa: 0, legacy: false };
  for (const v of ds) {
    t.tietChinh += v.tietChinh;
    t.tietTroGiang += v.tietTroGiang;
    t.trucDu += v.trucDu;
    t.trucNua += v.trucNua;
    t.trucQuyDoi += v.trucQuyDoi;
    t.soBuoiTrial += v.soBuoiTrial;
    t.tien += v.tien;
    t.chuaTinh += v.chuaTinh;
    t.ngoaiCa += v.ngoaiCa;
    t.legacy ||= v.legacy;
    for (const n of NHOM_TIEN) tienTheoNhom[n] += v.tienTheoNhom[n];
  }
  return t;
}

const so = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
/** 0,5 ⇒ "½" · 1 ⇒ "1" · 1,5 ⇒ "1½" (đúng cách màn Phân công nói "nửa ca"). */
export function nhanCaTruc(n: number): string {
  const nguyen = Math.floor(n);
  const le = n - nguyen;
  if (Math.abs(le - 0.5) < 1e-9) return nguyen ? `${nguyen}½` : "½";
  return so(n);
}

/** "2 tiết · TG 1 · trực ½ · Trial 1" — MỘT chỗ dựng chữ cột Công cho cả admin lẫn site GV. Không việc tính được ⇒ "Không có tiết / trực". */
export function nhanViec(v: Pick<ViecNgay, "tietChinh" | "tietTroGiang" | "trucQuyDoi" | "soBuoiTrial">): string {
  const phan: string[] = [];
  if (v.tietChinh > 0) phan.push(`${so(v.tietChinh)} tiết`);
  if (v.tietTroGiang > 0) phan.push(`TG ${so(v.tietTroGiang)}`);
  if (v.trucQuyDoi > 0) phan.push(`trực ${nhanCaTruc(v.trucQuyDoi)}`);
  if (v.soBuoiTrial > 0) phan.push(`Trial ${v.soBuoiTrial}`);
  return phan.length ? phan.join(" · ") : "Không có tiết / trực";
}

/** "450.000đ". */
export const nhanTien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

/** Mã ô như màn Phân công: "D", "TD+TR"; nhiều ô ⇒ "S·TD C·D2". */
export const nhanMaO = (o: Pick<OViec, "ma" | "coTrial">) => `${o.ma}${o.coTrial ? "+TR" : ""}`;
