/**
 * MÔ HÌNH MÀN HÌNH (view-model) của sổ gia đình DISC — hàm THUẦN dựng dữ liệu đã chọn lọc cho giao diện.
 * Server Component đọc DB (doc.ts) → gọi các hàm ở đây → truyền JSON phẳng xuống component. Component không tự tính gì.
 *
 * Hai nguyên tắc:
 *  · MỘT nguồn: nhãn · cường độ · T · B · kiểu · tầng mở đều đi qua `chi-so.ts`; chữ lời khuyên đi qua engine (config/disc-*).
 *  · KHÔNG vẽ thứ không có dữ liệu: chưa đủ người ⇒ khối ẩn / khoá, kèm lý do bằng chữ.
 */
import { TRUC } from "@/lib/disc/engine-goc/config/disc-tu-dien";
import { bacCuaTre } from "@/lib/disc/engine-goc/modules/core/gia-dinh/bac-hoc";
import { layDienGiaiDay, type DienGiaiDay } from "@/lib/disc/engine-goc/modules/report/dien-giai";

import {
  CHU_CAN_BANG,
  DIEM_MU_CHUNG,
  NGUONG_TIN_CAY,
  NHAN_MUC,
  VIEC_BU_THIEU,
  heSoQuanHe as heSoQuanHeBridge,
  hoSoChiSo,
  nhanQuanHeCap as nhanQuanHeBridge,
  tangBaoCaoMo,
  toaDoBanDo,
  xepHang,
  type ChiSoGiaDinh,
  type HoSoChiSo,
  type MucVaCham,
  type TangBaoCao,
} from "./chi-so";
import { hanCaNha, type HanCaNha } from "./han-lam-lai";
import { chenhLechVoiLanTruoc, hoSoCaNha, hoSoDangDung, lichSuLanLam } from "./ho-so-dang-dung";
import { BON_TRUC, NHAN_TRUC, hienNgay, ngayVN, type BaiLam, type CachLam, type MaTruc, type ThanhVien } from "./kieu";
import { chiSoTuChup, laBanChupHopLe, moiTheChieu, theChieu, type BanChup, type TheChieu } from "./phan-tich";
import { boDeChoBai, tuoiTuNamSinh } from "./dinh-tuyen-bai";

export type DauVaoMan = {
  readonly thanhVien: readonly ThanhVien[];
  readonly bai: readonly BaiLam[];
  readonly chup: BanChup | null;
  readonly soBan: number | null;
  readonly taoLucPhanTich: Date | null;
  readonly tenGiaDinh: string;
  /** Thành viên chính là chủ sổ (null nếu dữ liệu cũ thiếu). */
  readonly chuSoId: string | null;
  /** Mã thành viên đang có bản nháp dở (để hiện «Làm tiếp bài đang dở»). */
  readonly dangNhap: ReadonlyMap<string, { readonly daLam: number; readonly tong: number }>;
  readonly bayGio: Date;
};

export const CAU_GHI_CHU_DISC = "DISC mô tả xu hướng hành vi, không phải đánh giá tâm lý hay tính cách cố định.";
export const CAU_KHONG_TOT_XAU = "Không có phong cách tốt hay xấu, chỉ có khác biệt và cách bắc cầu.";

/* ── Tiện ích hiển thị ────────────────────────────────────────────────────── */

/** Chữ viết tắt trong ô tròn: 1 từ ⇒ tối đa 3 chữ cái; nhiều từ ⇒ chữ cái đầu của 2 từ cuối. */
export function chuVietTat(ten: string): string {
  const tu = ten.trim().split(/\s+/).filter(Boolean);
  if (tu.length === 0) return "?";
  if (tu.length === 1) return [...tu[0]!].slice(0, 3).join("").toUpperCase();
  return tu.slice(-2).map((t) => [...t][0] ?? "").join("").toUpperCase();
}

export type TrangThaiTv = "xong" | "uoc" | "dang" | "chua";
export const NHAN_TRANG_THAI: Readonly<Record<TrangThaiTv, string>> = { xong: "Hoàn thành", uoc: "Ước lượng", dang: "Đang làm", chua: "Chưa làm" };

const dd = (d: Date) => hienNgay(ngayVN(d));
const gio = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(11, 16);

/* ── Tab «Gia đình» ───────────────────────────────────────────────────────── */

export type TheTvVM = {
  readonly id: string;
  readonly ten: string;
  readonly chu: string;
  readonly phu: string;
  readonly trangThai: TrangThaiTv;
  readonly nhanTrangThai: string;
  readonly hoSo: string;
  readonly chinh: MaTruc | null;
  readonly nut: { readonly ten: string; readonly href: string; readonly noiBat: boolean };
};

export type TangVM = {
  readonly n: number;
  readonly ten: string;
  readonly trangThai: "mo" | "nhap" | "khoa" | "mot-phan";
  readonly nhanTrangThai: string;
  readonly ghi: string;
  readonly href: string;
};

export type NutBanDo = {
  readonly id: string;
  readonly nhan: string;
  readonly x: number;
  readonly y: number;
  readonly chinh: MaTruc;
  readonly uocLuong: boolean;
};
export type DayBanDo = { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly muc: MucVaCham; readonly uocLuong: boolean };

export type DotVM = { readonly k: MaTruc; readonly ten: string; readonly tb: number; readonly top: string; readonly cham: readonly { readonly id: string; readonly ten: string; readonly chu: string; readonly v: number; readonly chinh: MaTruc; readonly uocLuong: boolean }[] };
export type CapDsVM = { readonly href: string; readonly ten: string; readonly kieu: string; readonly qh: string; readonly muc: MucVaCham; readonly nhanMuc: string; readonly diem: number; readonly canChuY: boolean };
export type CapNongVM = { readonly href: string; readonly ten: string; readonly muc: MucVaCham; readonly nhanMuc: string; readonly ghi: string; readonly loi: readonly string[]; readonly canGiu: boolean };

export type BaoCaoGiaDinhVM = {
  readonly nhap: boolean;
  readonly banDo: { readonly nut: readonly NutBanDo[]; readonly day: readonly DayBanDo[]; readonly giaDinh: { readonly x: number; readonly y: number }; readonly aria: string };
  readonly kieu: { readonly ten: string; readonly manh: string; readonly rui: string };
  readonly canBang: { readonly v: number; readonly ghi: string };
  readonly phu: readonly { readonly k: MaTruc; readonly ten: string; readonly ai: string; readonly co: boolean }[];
  readonly phuGhi: string;
  readonly motCau: string;
  readonly kpi: readonly { readonly nhan: string; readonly v: string; readonly ghi: string }[];
  readonly dotPlot: readonly DotVM[];
  readonly capDs: readonly CapDsVM[];
  readonly capNong: readonly CapNongVM[];
  readonly vai: readonly { readonly id: string; readonly chu: string; readonly ten: string; readonly vai: string; readonly gop: string; readonly chinh: MaTruc; readonly uocLuong: boolean }[];
};

export type ManGiaDinhVM = {
  readonly tenGiaDinh: string;
  readonly soThanhVien: number;
  readonly snapTen: string | null;
  readonly tinCay: number;
  readonly tinCayTot: boolean;
  readonly tang: readonly TangVM[];
  readonly thanhVien: readonly TheTvVM[];
  readonly khoaT3: { readonly khoa: boolean; readonly ly: string };
  readonly baoCao: BaoCaoGiaDinhVM | null;
  readonly han: HanCaNha | null;
};

export const duongLamBai = (tvId: string, cach?: CachLam) => `/portal/disc/lam-bai?nguoi=${encodeURIComponent(tvId)}${cach ? `&cach=${cach}` : ""}`;
export const duongCaNhan = (tvId: string) => `/portal/disc?muc=ca-nhan&nguoi=${encodeURIComponent(tvId)}`;
export const duongTheCap = (a?: string, b?: string) => `/portal/disc?muc=the-cap${a && b ? `&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : ""}`;
export const duongKeHoach = (ky?: string) => `/portal/disc?muc=ke-hoach${ky ? `&ky=${ky}` : ""}`;
export const duongThanhVien = () => "/portal/disc?muc=thanh-vien";

function phuTv(tv: ThanhVien, bayGio: Date): string {
  const tuoi = tuoiTuNamSinh(tv.namSinh, Number(ngayVN(bayGio).slice(0, 4)));
  const bo = boDeChoBai({ vaiTro: tv.vaiTro, lop: tv.lop, tuoi }, "TU_LAM");
  const parts: string[] = [];
  if (tuoi !== null) parts.push(`${tuoi} tuổi`);
  else if (tv.lop) parts.push(tv.lop === "mam-non" ? "Mầm non" : tv.lop === "tren-12" ? "Trên lớp 12" : `Lớp ${tv.lop}`);
  parts.push(bo.duoc ? `bộ ${bo.boDe}` : "chưa chọn được bộ đề");
  return parts.join(" · ");
}

export function dungTheThanhVien(dv: DauVaoMan): { the: TheTvVM[]; hoSo: ReadonlyMap<string, BaiLam | null> } {
  const hs = hoSoCaNha(dv.thanhVien, dv.bai);
  const the = dv.thanhVien.map((tv): TheTvVM => {
    const b = hs.get(tv.id) ?? null;
    const nhap = dv.dangNhap.get(tv.id);
    let trangThai: TrangThaiTv = "chua";
    if (b?.cachLam === "TU_LAM") trangThai = "xong";
    else if (b?.cachLam === "GOC_NHIN") trangThai = "uoc";
    else if (nhap) trangThai = "dang";
    const hc: HoSoChiSo | null = b ? hoSoChiSo(b.diem, b.kieu) : null;
    const hoSoText =
      trangThai === "xong" && hc
        ? `${hc.nhan} · cường độ ${hc.cuongDo}`
        : trangThai === "uoc" && hc
          ? `Có xu hướng ${NHAN_TRUC[hc.chinh]} · ước lượng qua mắt chủ sổ`
          : trangThai === "dang" && nhap
            ? `Còn bản nháp · đã làm ${nhap.daLam}/${nhap.tong} câu`
            : "Chưa có dữ liệu · làm ngay trên tài khoản này";
    const tuoi = tuoiTuNamSinh(tv.namSinh, Number(ngayVN(dv.bayGio).slice(0, 4)));
    const tuLam = boDeChoBai({ vaiTro: tv.vaiTro, lop: tv.lop, tuoi }, "TU_LAM");
    const nut =
      trangThai === "xong"
        ? { ten: `Xem báo cáo của ${tv.ten}`, href: duongCaNhan(tv.id), noiBat: false }
        : trangThai === "dang"
          ? { ten: "Làm tiếp bài đang dở", href: duongLamBai(tv.id), noiBat: true }
          : trangThai === "uoc"
            ? { ten: tuLam.duoc ? `Cho ${tv.ten} tự làm` : `Xem hồ sơ của ${tv.ten}`, href: tuLam.duoc ? duongLamBai(tv.id, "TU_LAM") : duongCaNhan(tv.id), noiBat: tuLam.duoc }
            : { ten: `Làm bài cho ${tv.ten}`, href: duongLamBai(tv.id), noiBat: true };
    return { id: tv.id, ten: tv.ten, chu: chuVietTat(tv.ten), phu: phuTv(tv, dv.bayGio), trangThai, nhanTrangThai: NHAN_TRANG_THAI[trangThai], hoSo: hoSoText, chinh: hc?.chinh ?? null, nut };
  });
  return { the, hoSo: hs };
}

function dungTang(t: TangBaoCao, soCo: number, idDau: string): TangVM[] {
  const nhapT = (d: boolean) => (d ? "nhap" : "mo");
  return [
    t.t1
      ? { n: 1, ten: "Báo cáo cá nhân", trangThai: "mo", nhanTrangThai: "Đã mở", ghi: `Mỗi người một báo cáo riêng, mở được ngay khi làm xong bài.`, href: duongCaNhan(idDau) }
      : { n: 1, ten: "Báo cáo cá nhân", trangThai: "khoa", nhanTrangThai: "Khoá", ghi: "Mở khi có ít nhất 1 người làm xong.", href: duongThanhVien() },
    t.t2
      ? { n: 2, ten: "Thẻ cặp hai chiều", trangThai: nhapT(t.nhap), nhanTrangThai: t.nhap ? "Bản nháp" : "Đã mở", ghi: `${t.soTheChieu} thẻ chiều cho ${soCo} người có dữ liệu.`, href: duongTheCap() }
      : { n: 2, ten: "Thẻ cặp hai chiều", trangThai: "khoa", nhanTrangThai: "Khoá", ghi: "Mở khi có 2 người tự làm xong.", href: duongThanhVien() },
    t.t3
      ? { n: 3, ten: "Báo cáo gia đình", trangThai: nhapT(t.nhap), nhanTrangThai: t.nhap ? "Bản nháp" : "Đã mở", ghi: t.nhap ? `Độ tin cậy ${t.tinCay}% (dưới ${NGUONG_TIN_CAY}%) — nên mời người còn lại làm bài thật.` : "Bản đồ, kiểu gia đình, cặp cần chú ý, vai trò.", href: "#h-bd" }
      : { n: 3, ten: "Báo cáo gia đình", trangThai: "khoa", nhanTrangThai: "Khoá", ghi: "Mở khi có ít nhất 3 hồ sơ, trong đó 2 người tự làm.", href: duongThanhVien() },
    t.ke7
      ? {
          n: 4,
          ten: "Kế hoạch hành động",
          trangThai: t.ke365 ? "mo" : "mot-phan",
          nhanTrangThai: t.ke365 ? "Đã mở" : "Mở một phần",
          ghi: t.ke365 ? "7 ngày · 1 tháng · 1 năm." : t.ke30 ? "7 ngày và 1 tháng. 1 năm khoá đến khi độ tin cậy từ 60%." : "7 ngày. 1 tháng mở khi có 3 hồ sơ, trong đó 2 người tự làm.",
          href: duongKeHoach(),
        }
      : { n: 4, ten: "Kế hoạch hành động", trangThai: "khoa", nhanTrangThai: "Khoá", ghi: "Mở khi có ít nhất 2 người đã có kết quả.", href: duongThanhVien() },
  ];
}

function dungBaoCaoGiaDinh(cs: ChiSoGiaDinh, nhap: boolean): BaoCaoGiaDinhVM {
  const nut: NutBanDo[] = cs.nguoi.map((n) => {
    const p = toaDoBanDo(n.hoSo.pace, n.hoSo.focus);
    return { id: n.id, nhan: chuVietTat(n.ten), x: p.x, y: p.y, chinh: n.hoSo.chinh, uocLuong: n.qua === "GOC_NHIN" };
  });
  const toa = new Map(nut.map((n) => [n.id, n]));
  const day: DayBanDo[] = cs.cap.map((c) => {
    const a = toa.get(c.aId)!;
    const b = toa.get(c.bId)!;
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, muc: c.muc, uocLuong: a.uocLuong || b.uocLuong };
  });
  const gd = toaDoBanDo(cs.diemGiaDinh.pace, cs.diemGiaDinh.focus);
  const mc = chonMucCan(cs);
  const thieu = cs.thieu;
  const nong0 = cs.capNong[0] ?? cs.capCanGiu;

  const dotPlot: DotVM[] = BON_TRUC.map((x) => {
    const top = [...cs.nguoi].sort((a, b) => b.diem[x] - a.diem[x])[0]!;
    return {
      k: x,
      ten: NHAN_TRUC[x],
      tb: Math.round(cs.trungBinh[x]),
      top: `${top.ten} ${Math.round(top.diem[x])}`,
      cham: cs.nguoi.map((n) => ({ id: n.id, ten: n.ten, chu: [...n.ten.trim()][0]?.toUpperCase() ?? "?", v: Math.round(n.diem[x]), chinh: n.hoSo.chinh, uocLuong: n.qua === "GOC_NHIN" })),
    };
  });

  const capDs: CapDsVM[] = cs.capTheoUuTien.map((c) => ({
    href: duongTheCap(c.aId, c.bId),
    ten: `${c.aTen} – ${c.bTen}`,
    kieu: `${c.aChinh}–${c.bChinh}`,
    qh: c.nhanQuanHe,
    muc: c.muc,
    nhanMuc: `${NHAN_MUC[c.muc]} ${Math.round(c.T)}`,
    diem: Math.round(c.T),
    canChuY: cs.capNong.some((n) => n.aId === c.aId && n.bId === c.bId),
  }));

  return {
    nhap,
    banDo: {
      nut,
      day,
      giaDinh: gd,
      aria: `Bản đồ gia đình: ${cs.nguoi.map((n) => `${n.ten} nhóm ${n.hoSo.chinh}`).join(", ")}. Trục dọc nhịp độ nhanh đến chậm, trục ngang việc đến người.`,
    },
    kieu: { ten: cs.kieu.ten, manh: cs.kieu.manh, rui: cs.kieu.rui },
    canBang: { v: cs.canBang, ghi: CHU_CAN_BANG[cs.nhanCanBang] },
    phu: BON_TRUC.map((k) => ({ k, ten: NHAN_TRUC[k], ai: cs.phu[k].length ? cs.phu[k].join(", ") : "Chưa ai từ 60 điểm", co: cs.phu[k].length > 0 })),
    phuGhi: thieu.length
      ? `Nhà mình đang thiếu nhóm ${thieu.join(", ")}. Việc bù: ${thieu.map((k) => VIEC_BU_THIEU[k]).join("; ")}.`
      : "Đủ 4 nhóm, không có phong cách bị thiếu.",
    motCau: `${cs.kieu.ten}${thieu.length ? `, còn thiếu nhóm ${thieu.join(", ")}` : ", đủ cả 4 nhóm"}.${nong0 ? ` Cặp nên chú ý trước: ${nong0.aTen} – ${nong0.bTen}.` : ""}`,
    kpi: [
      { nhan: "Kiểu gia đình", v: cs.kieu.ten.replace("Gia đình ", ""), ghi: cs.kieu.manh },
      { nhan: "Cân bằng", v: `${cs.canBang} / 100`, ghi: mc },
      { nhan: "Độ phủ", v: `${4 - thieu.length} / 4 nhóm`, ghi: thieu.length ? `thiếu ${thieu.join(", ")}` : "không thiếu nhóm nào" },
      { nhan: "Cặp va chạm cao", v: `${cs.soCapVaChamCao} / ${cs.cap.length}`, ghi: "cần ưu tiên trong kế hoạch" },
    ],
    dotPlot,
    capDs,
    capNong: [...cs.capNong, ...(cs.capCanGiu ? [cs.capCanGiu] : [])].map((c) => ({
      href: duongTheCap(c.aId, c.bId),
      ten: `${c.aTen} – ${c.bTen}`,
      muc: c.muc,
      nhanMuc: `${NHAN_MUC[c.muc]} · ${Math.round(c.T)}`,
      ghi: `${c.aChinh} – ${c.bChinh} · ${c.nhanQuanHe} · độ ưu tiên ${Math.round(c.uuTien)}`,
      loi: c.diemMuChung ? [`Điểm mù chung: ${DIEM_MU_CHUNG[c.diemMuChung]}`] : [],
      canGiu: cs.capNong.length === 0,
    })),
    vai: cs.vai.map((v) => ({ id: v.id, chu: chuVietTat(v.ten), ten: v.oc ? `${v.ten} (ước lượng)` : v.ten, vai: `${v.vai}${v.vaiChinh ? "" : " (phụ)"}`, gop: v.gop, chinh: v.truc, uocLuong: v.oc })),
  };
}

function chonMucCan(cs: ChiSoGiaDinh): string {
  return cs.canBang >= 70 ? "cân bằng" : cs.canBang >= 40 ? "lệch vừa" : "lệch mạnh";
}

/** Lời khuyên cho cặp nóng: «A → B: …» lấy NGUYÊN «việc của tôi» của engine (đã thay đại từ). Bỏ chiều trẻ → người lớn khi trẻ bậc nhỏ (không có bản phù hợp). */
export function loiChoCapNong(chup: BanChup, aId: string, bId: string): string[] {
  const kq: string[] = [];
  for (const [x, y] of [[aId, bId], [bId, aId]] as const) {
    // Trẻ bậc nhỏ (mầm non – lớp 2) không nhận việc tự làm: bảng «việc của tôi» viết cho trẻ đọc được, chưa có bản cho bậc này.
    const nguoiX = chup.nguoi.find((n) => n.id === x);
    if (nguoiX && nguoiX.laTre && bacCuaTre(nguoiX.lop ?? undefined) === "nho") continue;
    const t = theChieu(chup, x, y);
    const k = t?.lech[0];
    if (t && k) kq.push(`${t.toiTen} → ${t.kiaTen}: ${k.viecCuaToi}`);
  }
  return kq;
}

export function dungManGiaDinh(dv: DauVaoMan): ManGiaDinhVM {
  const { the, hoSo } = dungTheThanhVien(dv);
  let soTuLam = 0;
  let soCo = 0;
  for (const b of hoSo.values()) {
    if (!b) continue;
    soCo += 1;
    if (b.cachLam === "TU_LAM") soTuLam += 1;
  }
  const tang = tangBaoCaoMo(soTuLam, soCo, dv.thanhVien.length);
  const chup = dv.chup && laBanChupHopLe(dv.chup) ? dv.chup : null;
  const cs = chup ? chiSoTuChup(chup) : null;
  let baoCao: BaoCaoGiaDinhVM | null = null;
  if (tang.t3 && cs && chup) {
    baoCao = dungBaoCaoGiaDinh(cs, tang.nhap);
    baoCao = { ...baoCao, capNong: baoCao.capNong.map((c, i) => {
      const cap = [...cs.capNong, ...(cs.capCanGiu ? [cs.capCanGiu] : [])][i];
      return cap ? { ...c, loi: [...loiChoCapNong(chup, cap.aId, cap.bId), ...c.loi] } : c;
    }) };
  }
  const lyKhoa = tang.t3 ? "" : soCo < 3 ? "Cần ít nhất 3 hồ sơ để vẽ bản đồ gia đình." : "Cần ít nhất 2 người tự làm bài (hồ sơ ước lượng chưa đủ).";
  const homNay = ngayVN(dv.bayGio);
  const han = hanCaNha(
    dv.thanhVien.map((tv) => ({ id: tv.id, ten: tv.ten, ngayLamYmd: hoSo.get(tv.id) ? ngayVN(hoSo.get(tv.id)!.createdAt) : null })),
    homNay,
  );
  return {
    tenGiaDinh: dv.tenGiaDinh,
    soThanhVien: dv.thanhVien.length,
    snapTen: dv.soBan !== null && dv.taoLucPhanTich ? `BẢN TÍNH SỐ ${dv.soBan} · ${dd(dv.taoLucPhanTich)} ${gio(dv.taoLucPhanTich)}` : null,
    tinCay: tang.tinCay,
    tinCayTot: tang.tinCay >= NGUONG_TIN_CAY,
    tang: dungTang(tang, soCo, the.find((x) => x.trangThai === "xong" || x.trangThai === "uoc")?.id ?? ""),
    thanhVien: the,
    khoaT3: { khoa: !tang.t3, ly: lyKhoa },
    baoCao,
    han,
  };
}

/* ── Tab «Cá nhân» ────────────────────────────────────────────────────────── */

export type LanLamVM = {
  readonly id: string;
  readonly lan: string;
  readonly ngay: string;
  readonly kieu: string;
  readonly diem: string;
  readonly nhan: string;
  readonly chenh: string;
  readonly dangDung: boolean;
  readonly ghiDangDung: string;
};

export type ManCaNhanVM = {
  readonly id: string;
  readonly ten: string;
  readonly tieuDe: string;
  readonly meta: string;
  readonly cot: readonly { readonly k: MaTruc; readonly ten: string; readonly v: number }[];
  readonly nhan: string;
  readonly cuongDo: string;
  readonly pace: number;
  readonly focus: number;
  readonly chinh: MaTruc;
  readonly uocLuong: boolean;
  readonly viTri: { readonly x: number; readonly y: number };
  readonly soSanh: readonly { readonly k: MaTruc; readonly v: number; readonly tb: number; readonly ch: string }[] | null;
  readonly soSanhGhi: string | null;
  readonly dg: DienGiaiDay;
  readonly boDe: string;
  readonly lop: string | null;
  /** Nhân vật robot + một dòng giới thiệu của nhóm chính (engine config/disc-tu-dien) — dùng ở «Bản cho con». */
  readonly nhanVat: string;
  readonly motDong: string;
  readonly lichSu: readonly LanLamVM[];
  readonly han: { readonly ngayDen: string; readonly conNgay: number; readonly denHan: boolean } | null;
  readonly coDoiChieu: boolean;
};

const DAU = (n: number) => (n > 0 ? `+${String(n).replace(".", ",")}` : n < 0 ? `−${String(Math.abs(n)).replace(".", ",")}` : "0");
export const dinhDangDiem = (d: Readonly<Record<MaTruc, number>>) => BON_TRUC.map((k) => `${k}${String(Math.round(d[k] * 10) / 10).replace(".", ",")}`).join(" · ");

export function dungLichSu(bai: readonly BaiLam[]): LanLamVM[] {
  const ls = lichSuLanLam(bai);
  const dung = hoSoDangDung(bai);
  const tong = ls.length;
  return ls.map((b, i) => {
    const ch = chenhLechVoiLanTruoc(ls, i);
    const truoc = ls[i + 1];
    const chenh = !truoc ? "Lần đầu" : ch ? BON_TRUC.map((k) => `${k} ${DAU(ch[k])}`).join(" · ") : "Khác bộ câu hỏi với lần trước — chỉ tham khảo";
    const dungNay = dung?.id === b.id;
    return {
      id: b.id,
      lan: `Lần ${tong - i}`,
      ngay: hienNgay(ngayVN(b.createdAt)),
      kieu: b.cachLam === "TU_LAM" ? `Tự làm · bộ ${b.boDe}` : `Góc nhìn · qua mắt chủ sổ · bộ ${b.boDe}`,
      diem: dinhDangDiem(b.diem),
      nhan: `${b.cachLam === "GOC_NHIN" ? "có xu hướng " : ""}${hoSoChiSo(b.diem, b.kieu).nhan}`,
      chenh,
      dangDung: dungNay,
      ghiDangDung: dungNay ? "Đang dùng cho thẻ cặp" : b.cachLam === "GOC_NHIN" ? (dung?.cachLam === "TU_LAM" ? "Góc nhìn tham khảo" : "Đã được thay") : "Đã lưu",
    };
  });
}

export function dungManCaNhan(dv: DauVaoMan, tvId: string): ManCaNhanVM | null {
  const tv = dv.thanhVien.find((t) => t.id === tvId);
  if (!tv) return null;
  const baiCuaNguoi = dv.bai.filter((b) => b.thanhVienId === tv.id);
  const b = hoSoDangDung(baiCuaNguoi);
  if (!b) return null;
  const hc = hoSoChiSo(b.diem, b.kieu);
  const tuoi = tuoiTuNamSinh(tv.namSinh, Number(ngayVN(dv.bayGio).slice(0, 4)));
  const dg = layDienGiaiDay({ diem: b.diem, xepHang: xepHang(b.diem), maBoDe: b.boDe, ...(tuoi !== null ? { tuoi } : {}) });
  const chup = dv.chup && laBanChupHopLe(dv.chup) ? dv.chup : null;
  const cs = chup ? chiSoTuChup(chup) : null;
  const p = toaDoBanDo(hc.pace, hc.focus);
  const soSanh = cs && cs.nguoi.length >= 2 ? BON_TRUC.map((k) => {
    const tb = Math.round(cs.trungBinh[k]);
    const v = Math.round(b.diem[k]);
    return { k, v, tb, ch: DAU(v - tb) };
  }) : null;
  const dauHan = hanCaNha([{ id: tv.id, ten: tv.ten, ngayLamYmd: ngayVN(b.createdAt) }], ngayVN(dv.bayGio));
  return {
    id: tv.id,
    ten: tv.ten,
    tieuDe: `Báo cáo của ${tv.ten}`,
    meta: `${hc.nhan} · cường độ ${hc.cuongDo} · bộ ${b.boDe} · ${b.cachLam === "TU_LAM" ? "tự làm" : "qua mắt chủ sổ (ước lượng)"} ngày ${hienNgay(ngayVN(b.createdAt))}`,
    cot: BON_TRUC.map((k) => ({ k, ten: NHAN_TRUC[k], v: Math.round(b.diem[k]) })),
    nhan: hc.nhan,
    cuongDo: hc.cuongDo,
    pace: hc.pace,
    focus: hc.focus,
    chinh: hc.chinh,
    uocLuong: b.cachLam === "GOC_NHIN",
    viTri: p,
    soSanh,
    soSanhGhi: soSanh ? `${tv.ten} ${soSanh.filter((r) => r.v - r.tb > 0).length > 0 ? "cao hơn" : "thấp hơn"} trung bình cả nhà ở ${soSanh.filter((r) => r.v - r.tb > 0).map((r) => r.k).join(", ") || "không nhóm nào"}.` : null,
    dg,
    boDe: b.boDe,
    lop: tv.lop,
    nhanVat: TRUC[hc.chinh].nhanVat,
    motDong: TRUC[hc.chinh].motDong,
    lichSu: dungLichSu(baiCuaNguoi),
    han: dauHan ? { ngayDen: hienNgay(dauHan.som.ngayDen), conNgay: dauHan.som.conNgay, denHan: dauHan.som.denHan } : null,
    coDoiChieu: dg.banBoMe !== undefined || dg.banCon !== undefined,
  };
}

/* ── Tab «Thẻ cặp» ────────────────────────────────────────────────────────── */

export type OMaTran = { readonly aId: string; readonly bId: string; readonly t1: string; readonly t2: string; readonly muc: MucVaCham; readonly aria: string; readonly href: string };

export type ManTheCapVM = {
  readonly soThe: number;
  readonly nguoi: readonly { readonly id: string; readonly ten: string }[];
  readonly dangDung: readonly { readonly id: string; readonly ten: string; readonly lan: string }[];
  readonly hang: readonly { readonly id: string; readonly ten: string; readonly o: readonly (OMaTran | null)[] }[];
  readonly chon: { readonly aId: string; readonly bId: string } | null;
  readonly the: TheChieu | null;
  readonly muc: { readonly muc: MucVaCham; readonly nhan: string; readonly T: number; readonly mu: string | null; readonly nhanQuanHe: string } | null;
  readonly daoChieuHref: string | null;
  readonly khoa: string | null;
  readonly nhap: boolean;
};

export function dungManTheCap(dv: DauVaoMan, aId?: string, bId?: string): ManTheCapVM {
  const hs = hoSoCaNha(dv.thanhVien, dv.bai);
  const soTuLam = [...hs.values()].filter((b) => b?.cachLam === "TU_LAM").length;
  const soCo = [...hs.values()].filter(Boolean).length;
  const tang = tangBaoCaoMo(soTuLam, soCo, dv.thanhVien.length);
  const chup = dv.chup && laBanChupHopLe(dv.chup) ? dv.chup : null;
  const cs = chup ? chiSoTuChup(chup) : null;
  const rong: ManTheCapVM = { soThe: 0, nguoi: [], dangDung: [], hang: [], chon: null, the: null, muc: null, daoChieuHref: null, khoa: null, nhap: false };
  if (!tang.t2) return { ...rong, khoa: "Thẻ cặp mở khi có ít nhất 2 người tự làm bài xong." };
  if (!chup || !cs) return { ...rong, khoa: "Chưa có bản phân tích cả nhà. Mở lại sau khi một người làm xong bài." };

  const nguoi = chup.nguoi.map((n) => ({ id: n.id, ten: n.ten }));
  const capTheoKhoa = new Map(cs.cap.map((c) => [`${c.aId}|${c.bId}`, c]));
  const lay = (x: string, y: string) => capTheoKhoa.get(`${x}|${y}`) ?? capTheoKhoa.get(`${y}|${x}`) ?? null;
  const hang = chup.nguoi.map((a) => ({
    id: a.id,
    ten: a.ten,
    o: chup.nguoi.map((b): OMaTran | null => {
      if (a.id === b.id) return null;
      const c = lay(a.id, b.id)!;
      return { aId: a.id, bId: b.id, t1: `${a.ten.slice(0, 6)}→`, t2: `${NHAN_MUC[c.muc]} ${Math.round(c.T)}`, muc: c.muc, aria: `${a.ten} đến ${b.ten}: mức va chạm ${NHAN_MUC[c.muc]} ${Math.round(c.T)}`, href: duongTheCap(a.id, b.id) };
    }),
  }));
  const macDinh = cs.capNong[0] ?? cs.capTheoUuTien[0];
  const a = chup.nguoi.find((n) => n.id === aId)?.id ?? (macDinh ? macDinh.aId : null);
  let b = chup.nguoi.find((n) => n.id === bId && n.id !== a)?.id ?? null;
  if (a && !b) b = macDinh && macDinh.aId === a ? macDinh.bId : (chup.nguoi.find((n) => n.id !== a)?.id ?? null);
  const the = a && b ? theChieu(chup, a, b) : null;
  const c = a && b ? lay(a, b) : null;
  const dangDung = dv.thanhVien.flatMap((t) => {
    const x = hs.get(t.id);
    return x ? [{ id: t.id, ten: t.ten, lan: `${x.cachLam === "TU_LAM" ? "tự làm" : "góc nhìn"} ${hienNgay(ngayVN(x.createdAt))}` }] : [];
  });
  return {
    soThe: moiTheChieu(chup).length,
    nguoi,
    dangDung,
    hang,
    chon: a && b ? { aId: a, bId: b } : null,
    the,
    muc: c ? { muc: c.muc, nhan: NHAN_MUC[c.muc], T: Math.round(c.T), mu: c.diemMuChung ? DIEM_MU_CHUNG[c.diemMuChung] : null, nhanQuanHe: c.nhanQuanHe } : null,
    daoChieuHref: a && b ? duongTheCap(b, a) : null,
    khoa: null,
    nhap: tang.nhap,
  };
}


/* ── Tab «Thành viên & quyền» ─────────────────────────────────────────────── */

export type ThanhVienQuanLyVM = {
  readonly id: string;
  readonly ten: string;
  readonly chu: string;
  readonly phu: string;
  readonly vaiTro: ThanhVien["vaiTro"];
  readonly lop: string | null;
  readonly namSinh: number | null;
  readonly studentId: string | null;
  readonly laChuSo: boolean;
  readonly boTuLam: string | null;
  readonly lyDoTuLam: string | null;
  readonly boGocNhin: string | null;
  readonly trangThai: TrangThaiTv;
  readonly nhanTrangThai: string;
  readonly ghiTrangThai: string;
  readonly chinh: MaTruc | null;
};

export type ManThanhVienVM = {
  readonly tenGiaDinh: string;
  readonly thanhVien: readonly ThanhVienQuanLyVM[];
  readonly quanHe: readonly { readonly cap: string; readonly loai: string; readonly tag: string }[];
  readonly hocVienChuaNoi: readonly { readonly id: string; readonly ten: string }[];
  readonly coPin: boolean;
  readonly soBaiChuaXep: number;
  readonly namNay: number;
  readonly toiDa: number;
};

export function dungManThanhVien(
  dv: DauVaoMan,
  tenGiaDinh: string,
  hocVienChuaNoi: readonly { id: string; ten: string }[],
  coPin: boolean,
  laTre: (vai: ThanhVien["vaiTro"], lop: string | null) => boolean,
  toiDa: number,
): ManThanhVienVM {
  const { the } = dungTheThanhVien(dv);
  const namNay = Number(ngayVN(dv.bayGio).slice(0, 4));
  const thanhVien = dv.thanhVien.map((tv, i): ThanhVienQuanLyVM => {
    const t = the[i]!;
    const tuoi = tuoiTuNamSinh(tv.namSinh, namNay);
    const tuLam = boDeChoBai({ vaiTro: tv.vaiTro, lop: tv.lop, tuoi }, "TU_LAM");
    const gocNhin = boDeChoBai({ vaiTro: tv.vaiTro, lop: tv.lop, tuoi }, "GOC_NHIN");
    return {
      id: tv.id,
      ten: tv.ten,
      chu: t.chu,
      phu: t.phu,
      vaiTro: tv.vaiTro,
      lop: tv.lop,
      namSinh: tv.namSinh,
      studentId: tv.studentId,
      laChuSo: tv.id === dv.chuSoId,
      boTuLam: tuLam.duoc ? tuLam.boDe : null,
      lyDoTuLam: tuLam.duoc ? null : tuLam.lyDo,
      boGocNhin: gocNhin.duoc ? gocNhin.boDe : null,
      trangThai: t.trangThai,
      nhanTrangThai: t.nhanTrangThai,
      ghiTrangThai: t.hoSo,
      chinh: t.chinh,
    };
  });
  const quanHe: { cap: string; loai: string; tag: string }[] = [];
  for (let i = 0; i < dv.thanhVien.length; i++) {
    for (let j = i + 1; j < dv.thanhVien.length; j++) {
      const a = dv.thanhVien[i]!;
      const b = dv.thanhVien[j]!;
      const na = { laTre: laTre(a.vaiTro, a.lop), vaiTro: a.vaiTro };
      const nb = { laTre: laTre(b.vaiTro, b.lop), vaiTro: b.vaiTro };
      const he = heSoQuanHeBridge(na, nb);
      quanHe.push({ cap: `${a.ten} – ${b.ten}`, loai: nhanQuanHeBridge(na, nb), tag: `hệ số ưu tiên ×${String(he).replace(".", ",")}` });
    }
  }
  return {
    tenGiaDinh,
    thanhVien,
    quanHe,
    hocVienChuaNoi,
    coPin,
    soBaiChuaXep: dv.bai.filter((b) => b.thanhVienId === null).length,
    namNay,
    toiDa,
  };
}
