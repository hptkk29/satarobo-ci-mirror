/**
 * MÔ HÌNH MÀN «KẾ HOẠCH» — thuần. Dựng từ kế hoạch ĐÃ LƯU (DB) + bản chụp phân tích; không sinh việc mới ở đây.
 * Mọi con số hiển thị (tỉ lệ tuần, chuỗi ngày, lời cảm ơn) đếm từ chính các dòng `DiscViec` / `DiscCheckin` — không có số "trang trí".
 */
import { chuVietTat, duongTheCap } from "./man-hinh";
import {
  CAU_KHONG_TICK,
  MOI_KY,
  NGHI_THUC_TUAN,
  NHAN_KY,
  PHUT_VIEC_NHO,
  QUY_NAM,
  SO_NGAY_KY,
  choPhepTick,
  tuanCuaNgay,
  type HoatDongDaKiem,
  type KyKeHoach,
} from "./ke-hoach";
import { congNgay, hienNgay, hienNgayNgan, nhanThu, soNgayGiua, type MaTruc } from "./kieu";
import { tangBaoCaoMo, type TangBaoCao } from "./chi-so";
import type { KeHoachDaLuu, ViecDaLuu } from "./doc";
import type { BanChup } from "./phan-tich";

export type TabKeHoach = KyKeHoach | "HOAT_DONG" | "CHECKIN";

export const NHAN_TAB: Readonly<Record<TabKeHoach, string>> = { NGAY_7: "7 ngày", HOAT_DONG: "Hoạt động cả nhà", THANG_1: "1 tháng", NAM_1: "1 năm", CHECKIN: "Check-in" };

export type ViecVM = {
  readonly id: string;
  readonly chu: string;
  readonly huong: string;
  readonly meta: string;
  readonly phut: number;
  readonly noiDung: string;
  readonly xong: boolean;
  readonly cho: { readonly tick: boolean; readonly lyDoKhong: string | null };
  readonly coCamOn: boolean;
  readonly camOn: boolean;
  readonly tenNguoiNhan: string | null;
  readonly caNha: boolean;
  readonly ngay: string;
};

export type NgayVM = { readonly n: number; readonly ymd: string; readonly thu: string; readonly ngay: string; readonly xong: number; readonly tong: number; readonly homNay: boolean };

export type ManKeHoachVM = {
  readonly tab: TabKeHoach;
  readonly tabs: readonly { readonly tab: TabKeHoach; readonly nhan: string; readonly mo: boolean; readonly coKeHoach: boolean }[];
  readonly tang: TangBaoCao;
  /** Kế hoạch của kỳ đang xem (null nếu chưa tạo). */
  readonly keHoach: { readonly id: string; readonly ky: KyKeHoach; readonly batDau: string; readonly batDauHien: string; readonly doKho: number; readonly soViecTuan: number; readonly moiTuan: number } | null;
  readonly lyKhoa: string | null;
  readonly canTaoMoi: { readonly ky: KyKeHoach; readonly macDinh: string } | null;
  readonly capNhat: string | null;
  readonly hero: { readonly tile: number; readonly daLam: number; readonly tong: number; readonly chuoi: number; readonly tuan: number; readonly chuDeTuan: string; readonly huyHieu: readonly { readonly ten: string; readonly v: string }[] } | null;
  readonly ngays: readonly NgayVM[];
  readonly ngayChon: NgayVM | null;
  readonly viecNgay: readonly ViecVM[];
  readonly tuans: readonly { readonly n: number; readonly chu: string }[];
  readonly tuanChon: number;
  readonly viecTuan: readonly ViecVM[];
  readonly quy: readonly { readonly quy: number; readonly chuDe: string; readonly mucTieu: string; readonly moc: string }[];
  readonly ngayGiaDinh: readonly ViecVM[];
  readonly moc: readonly ViecVM[];
  readonly hoatDong: readonly HoatDongDaKiem[];
  readonly checkin: ManCheckinVM | null;
  readonly luat: readonly { readonly tt: string; readonly t: string }[];
};

export type ManCheckinVM = {
  readonly keHoachId: string;
  readonly ky: KyKeHoach;
  readonly tuan: number;
  readonly soTuan: number;
  readonly nguoi: readonly { readonly id: string; readonly ten: string; readonly diem: number | null }[];
  readonly caps: readonly { readonly a: string; readonly b: string; readonly nhan: string; readonly chon: boolean }[];
  readonly lyDo: readonly string[];
};

export const LUAT_TU_DIEU_CHINH: readonly { readonly tt: string; readonly t: string }[] = [
  { tt: "Dưới 40%", t: "Hoàn thành dưới 40% trong một tuần: tuần sau còn 3 việc, độ khó 1." },
  { tt: "Điểm thấp", t: "Một người chấm 1–2 điểm hai tuần liền: đổi việc khác cùng khối và thêm 1 buổi 1-1 cho cặp của người đó." },
  { tt: "Trên 80%", t: "Hoàn thành trên 80% và điểm từ 4 trở lên hai tuần liền: tăng độ khó." },
];

export type DauVaoKeHoachMan = {
  readonly tab: TabKeHoach;
  readonly ngayChon: number | null;
  readonly tuanChon: number | null;
  readonly kyCheckin: KyKeHoach | null;
  readonly soTuLam: number;
  readonly soCoHoSo: number;
  readonly tongThanhVien: number;
  readonly chup: BanChup | null;
  readonly soBanMoiNhat: number | null;
  readonly keHoach: Readonly<Partial<Record<KyKeHoach, KeHoachDaLuu>>>;
  readonly phanTichIdMoiNhat: string | null;
  readonly hoatDong: readonly HoatDongDaKiem[];
  readonly thanhVien: readonly { readonly id: string; readonly ten: string }[];
  readonly homNay: string;
};

function viecVM(v: ViecDaLuu, ten: ReadonlyMap<string, string>, chinhCua: ReadonlyMap<string, MaTruc>, homNay: string): ViecVM {
  const tenLam = v.nguoiLamId ? (ten.get(v.nguoiLamId) ?? "Thành viên") : null;
  const tenNhan = v.nguoiNhanId ? (ten.get(v.nguoiNhanId) ?? null) : null;
  const xong = v.xongLuc !== null;
  const cho = choPhepTick(v.ngay, homNay, xong);
  const tl = v.nguoiLamId ? chinhCua.get(v.nguoiLamId) : undefined;
  const tn = v.nguoiNhanId ? chinhCua.get(v.nguoiNhanId) : undefined;
  return {
    id: v.id,
    chu: tenLam ? chuVietTat(tenLam) : "NHÀ",
    huong: tenLam ? (tenNhan ? `${tenLam} → ${tenNhan}` : tenLam) : "Cả nhà",
    meta: tl && tn ? `Nhóm ${tl} → ${tn}` : tenLam ? "Việc nhỏ" : "Việc cả nhà",
    phut: v.phut || PHUT_VIEC_NHO,
    noiDung: v.noiDung,
    xong,
    cho: cho.duoc ? { tick: true, lyDoKhong: null } : { tick: false, lyDoKhong: xong ? null : CAU_KHONG_TICK[cho.lyDo] },
    coCamOn: xong && v.nguoiNhanId !== null,
    camOn: v.camOnLuc !== null,
    tenNguoiNhan: tenNhan,
    caNha: tenLam === null,
    ngay: v.ngay,
  };
}

export function chuoiNgayLienTiep(viec: readonly { ngay: string; xongLuc: Date | null }[], homNay: string): number {
  const coXong = new Set(viec.filter((v) => v.xongLuc !== null).map((v) => v.ngay));
  let d = coXong.has(homNay) ? homNay : congNgay(homNay, -1);
  let n = 0;
  while (coXong.has(d)) {
    n += 1;
    d = congNgay(d, -1);
  }
  return n;
}

export function dungManKeHoach(dv: DauVaoKeHoachMan): ManKeHoachVM {
  const tang = tangBaoCaoMo(dv.soTuLam, dv.soCoHoSo, dv.tongThanhVien);
  const ten = new Map(dv.thanhVien.map((t) => [t.id, t.ten]));
  const chinhCua = new Map<string, MaTruc>();
  if (dv.chup) {
    for (const n of dv.chup.nguoi) {
      const x = (["D", "I", "S", "C"] as const).reduce((m, k) => (n.diem[k] > n.diem[m] ? k : m), "D" as MaTruc);
      chinhCua.set(n.id, x);
    }
  }
  const moKy: Record<KyKeHoach, boolean> = { NGAY_7: tang.ke7, THANG_1: tang.ke30, NAM_1: tang.ke365 };
  const lyKhoaKy: Record<KyKeHoach, string> = {
    NGAY_7: "Cần ít nhất 2 người đã có kết quả.",
    THANG_1: "Mở khi có 3 hồ sơ, trong đó ít nhất 2 người tự làm bài.",
    NAM_1: `Mở khi có 3 hồ sơ và độ tin cậy từ 60% (hiện ${tang.tinCay}%).`,
  };
  const coKh = (k: KyKeHoach) => dv.keHoach[k] !== undefined;
  const tabs = [
    { tab: "NGAY_7" as const, nhan: NHAN_TAB.NGAY_7, mo: moKy.NGAY_7, coKeHoach: coKh("NGAY_7") },
    ...(dv.hoatDong.length > 0 ? [{ tab: "HOAT_DONG" as const, nhan: NHAN_TAB.HOAT_DONG, mo: true, coKeHoach: true }] : []),
    { tab: "THANG_1" as const, nhan: NHAN_TAB.THANG_1, mo: moKy.THANG_1, coKeHoach: coKh("THANG_1") },
    { tab: "NAM_1" as const, nhan: NHAN_TAB.NAM_1, mo: moKy.NAM_1, coKeHoach: coKh("NAM_1") },
    { tab: "CHECKIN" as const, nhan: NHAN_TAB.CHECKIN, mo: MOI_KY.some(coKh), coKeHoach: MOI_KY.some(coKh) },
  ];

  const kyXem: KyKeHoach | null = dv.tab === "NGAY_7" || dv.tab === "THANG_1" || dv.tab === "NAM_1" ? dv.tab : null;
  const kh = kyXem ? (dv.keHoach[kyXem] ?? null) : null;
  const moiTuanTong = (k: KeHoachDaLuu) => k.soViecTuan;

  const khAnh = kh
    ? { id: kh.id, ky: kh.ky, batDau: kh.batDau, batDauHien: `${nhanThu(kh.batDau)} ${hienNgay(kh.batDau)}`, doKho: kh.doKho, soViecTuan: kh.soViecTuan, moiTuan: moiTuanTong(kh) }
    : null;

  // Hero: kế hoạch ĐANG XEM nếu có; không thì kế hoạch chạy đầu tiên (7 ngày → 1 tháng → 1 năm).
  const khHero = kh ?? (MOI_KY.map((k) => dv.keHoach[k]).find((x) => x !== undefined) ?? null);
  let hero: ManKeHoachVM["hero"] = null;
  if (khHero) {
    const soNgay = SO_NGAY_KY[khHero.ky];
    const tuanNay = Math.max(1, Math.min(Math.ceil(soNgay / 7), Math.floor(soNgayGiua(khHero.batDau, dv.homNay) / 7) + 1));
    const trongTuan = khHero.viec.filter((v) => tuanCuaNgay(khHero.batDau, v.ngay, soNgay) === tuanNay);
    const daLam = trongTuan.filter((v) => v.xongLuc !== null).length;
    const tong = trongTuan.length;
    const chuDe = khHero.ky === "THANG_1" ? (NGHI_THUC_TUAN[tuanNay - 1]?.chuDe ?? "") : khHero.ky === "NGAY_7" ? "Việc nhỏ mỗi ngày" : (QUY_NAM[Math.min(3, Math.floor((tuanNay - 1) / 13))]?.chuDe ?? "");
    hero = {
      tile: tong === 0 ? 0 : Math.round((daLam / tong) * 100),
      daLam,
      tong,
      chuoi: chuoiNgayLienTiep(khHero.viec, dv.homNay),
      tuan: tuanNay,
      chuDeTuan: chuDe,
      huyHieu: [
        { ten: "Việc đã xong", v: String(khHero.viec.filter((v) => v.xongLuc !== null).length) },
        { ten: "Lời cảm ơn", v: String(khHero.viec.filter((v) => v.camOnLuc !== null).length) },
        { ten: "Chuỗi ngày", v: String(chuoiNgayLienTiep(khHero.viec, dv.homNay)) },
        { ten: "Tuần đã check-in", v: String(new Set(khHero.checkin.map((c) => c.tuan)).size) },
      ],
    };
  }

  // 7 ngày
  const ngays: NgayVM[] = [];
  let ngayChon: NgayVM | null = null;
  let viecNgay: ViecVM[] = [];
  const kh7 = dv.keHoach.NGAY_7;
  if (kh7 && dv.tab === "NGAY_7") {
    for (let i = 0; i < 7; i++) {
      const ymd = congNgay(kh7.batDau, i);
      const v = kh7.viec.filter((x) => x.ngay === ymd);
      ngays.push({ n: i + 1, ymd, thu: nhanThu(ymd), ngay: hienNgayNgan(ymd), xong: v.filter((x) => x.xongLuc !== null).length, tong: v.length, homNay: ymd === dv.homNay });
    }
    const macDinh = ngays.find((n) => n.homNay)?.n ?? ngays.find((n) => n.xong < n.tong)?.n ?? 1;
    ngayChon = ngays.find((n) => n.n === (dv.ngayChon ?? macDinh)) ?? ngays[0] ?? null;
    viecNgay = ngayChon ? kh7.viec.filter((x) => x.ngay === ngayChon!.ymd).map((x) => viecVM(x, ten, chinhCua, dv.homNay)) : [];
  }

  // 1 tháng
  const kh30 = dv.keHoach.THANG_1;
  const tuans = kh30 ? NGHI_THUC_TUAN.map((t) => ({ n: t.tuan, chu: t.chuDe })) : [];
  const tuanChon = Math.max(1, Math.min(4, dv.tuanChon ?? hero?.tuan ?? 1));
  const viecTuan = kh30 && dv.tab === "THANG_1"
    ? kh30.viec.filter((v) => tuanCuaNgay(kh30.batDau, v.ngay, SO_NGAY_KY.THANG_1) === tuanChon).map((v) => viecVM(v, ten, chinhCua, dv.homNay))
    : [];

  // 1 năm
  const kh365 = dv.keHoach.NAM_1;
  const ngayGiaDinh = kh365 ? kh365.viec.filter((v) => v.nguon.startsWith("NGAY_GIA_DINH:")).map((v) => viecVM(v, ten, chinhCua, dv.homNay)) : [];
  const moc = kh365 ? kh365.viec.filter((v) => !v.nguon.startsWith("NGAY_GIA_DINH:")).map((v) => viecVM(v, ten, chinhCua, dv.homNay)) : [];

  // Check-in
  let checkin: ManCheckinVM | null = null;
  if (dv.tab === "CHECKIN") {
    const k = dv.kyCheckin && dv.keHoach[dv.kyCheckin] ? dv.kyCheckin : (MOI_KY.find(coKh) ?? null);
    const kc = k ? dv.keHoach[k] : undefined;
    if (kc) {
      const soTuan = Math.ceil(SO_NGAY_KY[kc.ky] / 7);
      const tuanNay = Math.max(1, Math.min(soTuan, Math.floor(soNgayGiua(kc.batDau, dv.homNay) / 7) + 1));
      const tuan = Math.max(1, Math.min(tuanNay, dv.tuanChon ?? tuanNay));
      const da = kc.checkin.filter((c) => c.tuan === tuan);
      const capDa = da.find((c) => c.capDeChiu)?.capDeChiu ?? null;
      const ds = dv.thanhVien;
      const caps: ManCheckinVM["caps"] = ds.flatMap((a, i) => ds.slice(i + 1).map((b) => {
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        return { a: a.id, b: b.id, nhan: `${a.ten} – ${b.ten}`, chon: capDa === key };
      }));
      checkin = {
        keHoachId: kc.id,
        ky: kc.ky,
        tuan,
        soTuan: tuanNay,
        nguoi: ds.map((t) => ({ id: t.id, ten: t.ten, diem: da.find((c) => c.thanhVienId === t.id)?.diem ?? null })),
        caps,
        lyDo: [],
      };
    }
  }

  const kyTab: KyKeHoach | null = kyXem;
  const lyKhoa = kyTab && !moKy[kyTab] ? lyKhoaKy[kyTab] : null;
  const canTao = kyTab && moKy[kyTab] && !kh ? { ky: kyTab, macDinh: dv.homNay } : null;

  // Gợi ý «cập nhật kế hoạch»: có bản phân tích mới hơn bản mà kế hoạch đang chạy dựa vào.
  const capNhat = kh && dv.phanTichIdMoiNhat && kh.phanTichId && kh.phanTichId !== dv.phanTichIdMoiNhat && dv.soBanMoiNhat !== null
    ? `Có kết quả mới (bản tính số ${dv.soBanMoiNhat}).`
    : null;

  return {
    tab: dv.tab,
    tabs,
    tang,
    keHoach: khAnh,
    lyKhoa,
    canTaoMoi: canTao,
    capNhat,
    hero,
    ngays,
    ngayChon,
    viecNgay,
    tuans,
    tuanChon,
    viecTuan,
    quy: QUY_NAM,
    ngayGiaDinh,
    moc,
    hoatDong: dv.tab === "HOAT_DONG" ? dv.hoatDong : [],
    checkin,
    luat: LUAT_TU_DIEU_CHINH,
  };
}

export const nhanKy = (k: KyKeHoach) => NHAN_KY[k];
export { duongTheCap };
