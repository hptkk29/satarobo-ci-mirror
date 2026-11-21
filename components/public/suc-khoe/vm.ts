"use client";
/**
 * VIEW-MODEL của trang «Sức khỏe cả nhà» — chuyển từ khối `renderVals` của thiết kế (artifact «Sata Robo — Website mới», SucKhoe.dc.html) sang React.
 * `suc-khoe-view.tsx` (sinh từ markup artifact) chỉ vẽ những gì hook này trả về; kiểu của view = `SucKhoeVm` (suy ra từ đây ⇒ thiếu khoá là lỗi biên dịch).
 *
 * Khác thiết kế (có chủ đích):
 *  · Câu xoay vòng lấy từ NGÂN HÀNG 1000 CÂU (`lib/suc-khoe/ngan-hang`), chọn MỘT LẦN khi người dùng sang bước «câu thêm hôm nay»
 *    (bản thiết kế chọn ngay trong lúc vẽ, bằng `setTimeout` — hiệu ứng phụ trong render).
 *  · Sổ lưu bền trong localStorage (thiết kế chỉ giữ trong bộ nhớ trang); ĐỌC LẠI sau khi trang đã vẽ (để HTML máy chủ và lần vẽ đầu của trình duyệt giống nhau).
 *  · «Tải bản sao lưu» tải thật một tệp JSON; «Tải PDF» mở hộp thoại in của trình duyệt (chọn «Lưu thành PDF») — chỉ phần kết quả được in.
 *  · Cổng «để lại thông tin» là hộp dùng chung `CongThongTinProvider` (nguồn `suc-khoe`); phiếu CHỈ mang liên hệ, KHÔNG kèm câu trả lời/số đo/kết quả.
 *
 * ⚠️ Luật 19: không đọc đồng hồ ở cấp module; ngày hôm nay hỏi `layHomNay()` mỗi lần cần.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCongThongTin } from "@/components/public/cong-thong-tin/hop-de-lai-thong-tin";
import * as Dong from "@/lib/suc-khoe/dong-co-goc";
import { KHUON_KET_QUA, type TenKhuon } from "@/lib/suc-khoe/khuon-ket-qua";
import { cauConLai, chonXoayVong, NGAN_HANG_XOAY_VONG, phanHoiCauKienThuc, thayTen, type CauXoayVong } from "@/lib/suc-khoe/ngan-hang/xoay-vong";
import { THEM_TRONG, type GioiTinh, type Nguoi, type Phien, type ThemNguoi, type TraLoi, type TrangThai } from "./kieu";
import { banSaoLuu, docSoLuu, ghiSoLuu, KHOA_LUU } from "./luu-tru";
import { nguoiViDu } from "./vi-du";

// ───────────── Động cơ (chép nguyên văn từ thiết kế, khai kiểu hẹp cho phần dùng ở đây) ─────────────
type Lua = readonly (readonly [string, string | number])[];
type CauLoi = {
  id: string;
  g: readonly string[];
  d: string;
  q: string;
  t?: "so" | "chon";
  o?: Lua;
  dv?: string;
  src?: string;
  goiY?: string;
  tuy?: boolean;
  min?: number;
  max?: number;
};
type KhoiDaoSau = { id: string; d: string; lyDo: string; cau: readonly Omit<CauLoi, "g" | "t" | "d">[] };
type MucKq = "on" | "cy" | "gap" | "chua";
type TheKq = { lv: string; muc: MucKq; soLieu: string; dong: readonly (readonly [string, string])[] };
type NguCanhKq = { bmi: number; can: number; nl: boolean; mt: boolean; phutTuan: number; gio: number; who5: number | null; coDo: boolean };
type NhomTuoi = "u5" | "c6" | "c12" | "nl" | "gia";
type NguoiDong = { ns: string; gt: GioiTinh; mt?: boolean };

const D = Dong as unknown as {
  TOI_DA_NGUOI: number;
  TOI_DA_LUOT: number;
  ngay07: unknown;
  NG: { thieu: number; thua: number };
  NGUON: Record<string, string>;
  LV: readonly { id: string; ten: string; moTa: string }[];
  LOI: readonly CauLoi[];
  DS: readonly { cau: readonly unknown[] }[];
  MUC: Record<MucKq, readonly [string, string]>;
  TEN_NHOM: Record<NhomTuoi, string>;
  layHomNay: () => string;
  ngayVN: (iso: string) => string;
  soGon: (n: number) => string;
  docSo: (s: unknown) => number;
  thangTuoi: (ns: string) => number | null;
  tuoiChu: (ns: string) => string;
  nhomTuoi: (ns: string) => NhomTuoi | null;
  laTre: (g: NhomTuoi | null) => boolean;
  manHinh: (ng: NguoiDong, a: TraLoi) => string[];
  cauCuaLv: (lv: string, ng: NguoiDong, a: TraLoi) => CauLoi[];
  daoSau: (lv: string, ng: NguoiDong, a: TraLoi) => KhoiDaoSau[];
  nhanTl: (it: CauLoi, v: unknown) => string;
  thuongDau: (t: string) => string;
  ngCtx: (ng: NguoiDong, a: TraLoi) => NguCanhKq & { coDo: boolean };
  ketQua: (ng: NguoiDong, a: TraLoi) => { the: TheKq[]; coDo: boolean; hoTro: boolean; c: NguCanhKq };
};

const TOI_DA_NGUOI = D.TOI_DA_NGUOI;
const TOI_DA_LUOT = D.TOI_DA_LUOT;
const NGAN_HANG_THEO_ID: ReadonlyMap<string, CauXoayVong> = new Map(NGAN_HANG_XOAY_VONG.map((c) => [c.id, c]));

const VAI_TRO = ["Bố", "Mẹ", "Con", "Ông", "Bà", "Người thân khác"] as const;

const chuDau = (t: string) => (Array.from(t.trim())[0] ?? "?").toUpperCase();
const thayAi = (s: string, tre: boolean) => s.replace(/\{ai\}/g, tre ? "bé" : "anh chị").replace(/\{Ai\}/g, tre ? "Bé" : "Anh chị");
const taoId = (tien: string) => tien + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
const phienMoi = (mid: string): Phien => ({ mid, buoc: 0, tl: {}, xoay: null, xtl: {}, loi: "" });
const giaTriO = (e: { target?: { value?: string } } | null | undefined) => (e && e.target && typeof e.target.value === "string" ? e.target.value : "");

/** Chọn 3 câu xoay vòng cho MỘT người: đúng nhóm tuổi, chưa từng thấy, ưu tiên 1 câu đố + mỗi lĩnh vực một câu. */
export function chonCauXoayChoNguoi(ng: Pick<Nguoi, "ns" | "daThay">, ngauNhien?: () => number): string[] {
  const tre = D.laTre(D.nhomTuoi(ng.ns));
  return chonXoayVong({ laTre: tre, daThay: ng.daThay, ngauNhien }).map((c) => c.id);
}

function trangThaiDau(): TrangThai {
  return {
    ds: nguoiViDu(),
    them: { ...THEM_TRONG },
    ph: phienMoi("vd-bo"),
    kqId: "vd-me",
    thu: {},
    toast: "",
    hop: null,
    moiNhat: null,
    vuaXong: null,
  };
}

function veCauHienThi(it: CauLoi, laDs: boolean, a: TraLoi, g: NhomTuoi | null, truoc: TraLoi | null, loiPhien: string, datTraLoi: (k: string, v: string | number) => void) {
  const tre = D.laTre(g);
  const v = a[it.id];
  const oo = (it.o ?? []).map((o) => ({
    t: o[0],
    cls: "sk-op" + (String(v) === String(o[1]) ? " on" : ""),
    on: String(v) === String(o[1]),
    pick: () => datTraLoi(it.id, o[1]),
  }));
  const tv = truoc && !laDs ? D.nhanTl(it, truoc[it.id]) : "";
  const sai = !!loiPhien && !it.tuy && (v == null || v === "");
  return {
    id: it.id,
    q: thayAi(it.q, tre),
    laSo: it.t === "so",
    laChon: it.t !== "so",
    ngan: it.o === D.ngay07,
    o: oo,
    dv: it.dv ?? "",
    v: v == null ? "" : String(v),
    nhap: (e: { target?: { value?: string } } | null) => datTraLoi(it.id, giaTriO(e)),
    tag: it.src ?? "",
    coTag: !!it.src,
    tagTitle: it.src ? (D.NGUON[it.src] ?? it.src) : "",
    coTruoc: !!tv,
    truoc: "Lần trước: " + tv,
    coGoiY: !!it.goiY,
    goiY: it.goiY ?? "",
    tuy: !!it.tuy,
    cls: "sk-cau" + (sai ? " sai" : "") + (laDs ? " sk-cau-ds" : ""),
    luoi: it.o === D.ngay07 ? "sk-ops sk-ops-ngay" : it.o && it.o.length > 4 ? "sk-ops sk-ops-doc" : "sk-ops",
  };
}

export function useSucKhoeVm() {
  const lg = useCongThongTin();
  const [S, setS] = useState<TrangThai>(trangThaiDau);
  const daNap = useRef(false);
  const henToast = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((p: Partial<TrangThai>) => setS((truoc) => ({ ...truoc, ...p })), []);

  // Đọc sổ đã lưu SAU khi vẽ lần đầu (tránh lệch HTML máy chủ). Có sổ ⇒ thay ví dụ; không ⇒ giữ ví dụ của thiết kế.
  useEffect(() => {
    let chuoi: string | null;
    try {
      chuoi = window.localStorage.getItem(KHOA_LUU);
    } catch {
      chuoi = null;
    }
    const so = docSoLuu(chuoi);
    if (so) setS((truoc) => ({ ...truoc, ds: so.ds, thu: so.thu, ph: null, kqId: so.ds.find((n) => n.luot.length)?.id ?? null }));
    daNap.current = true;
  }, []);

  // Ghi sổ mỗi khi danh sách / thử thách đổi (không ghi phiên đang dở, không ghi trước khi đọc xong).
  useEffect(() => {
    if (!daNap.current) return;
    try {
      window.localStorage.setItem(KHOA_LUU, ghiSoLuu(S.ds, S.thu));
    } catch {
      /* chế độ riêng tư / hết dung lượng: bỏ qua, trang vẫn dùng được trong phiên */
    }
  }, [S.ds, S.thu]);

  useEffect(() => () => {
    if (henToast.current) clearTimeout(henToast.current);
  }, []);

  // Dự phòng: đang ở bước «câu thêm hôm nay» mà chưa có câu (không xảy ra qua `tiep`, nhưng đừng để màn trống).
  const phienHT = S.ph;
  const ngPhienHT = phienHT ? S.ds.find((n) => n.id === phienHT.mid) : undefined;
  const canXoay = !!phienHT && !!ngPhienHT && phienHT.xoay === null && phienHT.buoc >= D.manHinh(ngPhienHT, phienHT.tl).length;
  useEffect(() => {
    if (!canXoay) return;
    setS((truoc) => {
      const ng = truoc.ph ? truoc.ds.find((n) => n.id === truoc.ph?.mid) : undefined;
      if (!truoc.ph || truoc.ph.xoay !== null || !ng) return truoc;
      return { ...truoc, ph: { ...truoc.ph, xoay: chonCauXoayChoNguoi(ng) } };
    });
  }, [canXoay]);

  const baoTin = useCallback(
    (t: string) => {
      set({ toast: t });
      if (henToast.current) clearTimeout(henToast.current);
      henToast.current = setTimeout(() => set({ toast: "" }), 6000);
    },
    [set],
  );
  const cuon = (id: string) =>
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);

  const homNay = D.layHomNay();

  // ───────────── [01] CẢ NHÀ GỒM AI ─────────────
  const T = S.them;
  const setT = (p: Partial<ThemNguoi>) => set({ them: { ...S.them, ...p } });
  const gT = T.ns ? D.nhomTuoi(T.ns) : null;

  const themNguoi = (xoaId?: string) => {
    const ten = T.ten.trim();
    if (!ten) return setT({ loi: "Anh chị nhập tên hoặc biệt danh nhé." });
    const thang = T.ns ? D.thangTuoi(T.ns) : null;
    if (!T.ns || thang == null || thang < 0) return setT({ loi: "Anh chị nhập ngày sinh hợp lệ nhé." });
    const ds = xoaId ? S.ds.filter((n) => n.id !== xoaId) : S.ds;
    if (ds.length >= TOI_DA_NGUOI) return set({ hop: { loai: "day", chon: null } });
    const id = taoId("n");
    const ng: Nguoi = { id, ten, vt: T.vt, ns: T.ns, gt: T.gt, mt: !!T.mt && gT === "nl" && T.gt === "nu", daThay: [], luot: [] };
    set({ ds: [ng, ...ds], them: { ...THEM_TRONG }, hop: null, moiNhat: id, ph: phienMoi(id) });
    baoTin("Đã thêm " + ten + ". Bắt đầu thăm dò ngay bên dưới.");
    cuon("sk-hoi");
  };

  const nguoi = S.ds.map((n, i) => {
    const g = D.nhomTuoi(n.ns);
    const l0 = n.luot[0];
    const bmis = n.luot
      .slice()
      .reverse()
      .map((l) => {
        const c = D.docSo(l.tl.can);
        const h = D.docSo(l.tl.cao);
        return c > 0 && h > 0 ? c / Math.pow(h / 100, 2) : Number.NaN;
      })
      .filter(Number.isFinite);
    let spark = "";
    let cx = "0";
    let cy = "0";
    if (bmis.length >= 2) {
      const mn = Math.min(...bmis);
      const r = Math.max(...bmis) - mn || 1;
      const d = bmis.map((y, j): [number, number] => [4 + j * (76 / (bmis.length - 1)), 22 - ((y - mn) / r) * 18]);
      spark = d.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
      cx = d[d.length - 1]![0].toFixed(1);
      cy = d[d.length - 1]![1].toFixed(1);
    }
    const dangHoi = S.ph?.mid === n.id;
    return {
      ten: n.ten,
      chu: chuDau(n.ten),
      vt: n.vt,
      nhom: g ? D.TEN_NHOM[g] : "",
      tuoi: D.tuoiChu(n.ns),
      viDu: !!n.viDu,
      moi: S.moiNhat === n.id,
      luot: n.luot.length + "/" + TOI_DA_LUOT + " lượt",
      ngay: l0 ? "Gần nhất " + D.ngayVN(l0.ngay) : "Chưa thăm dò",
      coSpark: bmis.length >= 2,
      spark,
      cx,
      cy,
      coKq: n.luot.length > 0,
      coMt: !!n.mt,
      tre: g === "u5" || g === "c6",
      cls: "sk-cn sk-c" + (i % 4) + (dangHoi ? " on" : ""),
      bdChu: dangHoi ? "Đang thăm dò" : n.luot.length ? "Thăm dò lần mới" : "Bắt đầu thăm dò",
      batDau: () => {
        set({ ph: phienMoi(n.id) });
        cuon("sk-hoi");
      },
      xemKq: () => {
        set({ kqId: n.id });
        cuon("sk-kq");
      },
      xoa: () => set({ hop: { loai: "nguoi", nid: n.id, ten: n.ten } }),
    };
  });

  // ───────────── [02] THĂM DÒ ─────────────
  const P = S.ph;
  const ngP = P ? S.ds.find((n) => n.id === P.mid) : undefined;
  type XoayMuc = { id: string; q: string; laKt: boolean; loai: string; nguon: string; o: { t: string; cls: string; pick: () => void }[]; coGiai: boolean; dung: boolean; giai: string };
  type CauHienThi = ReturnType<typeof veCauHienThi>;

  type Hoi =
    | { co: false }
    | {
        co: true;
        ten: string;
        chu: string;
        nhom: string;
        tuoi: string;
        ghiTre: string;
        coGhiTre: boolean;
        coTruoc: boolean;
        truocNgay: string;
        buocChu: string;
        pct: string;
        cham: { t: string; cls: string }[];
        laLoi: boolean;
        laXoay: boolean;
        lvTen: string;
        lvMoTa: string;
        laMoc: boolean;
        laDo: boolean;
        coDo: boolean;
        cau: CauHienThi[];
        coDs: boolean;
        ds: { lyDo: string; cau: CauHienThi[] }[];
        xoay: XoayMuc[];
        xoayCon: number;
        coLoi: boolean;
        loi: string;
        coLui: boolean;
        lui: () => void;
        tiep: () => void;
        xong: () => void;
        nutTiep: string;
        huy: () => void;
        phut: string;
      };
  let hoi: Hoi = { co: false };
  if (P && ngP) {
    const g = D.nhomTuoi(ngP.ns);
    const tre = D.laTre(g);
    const a = P.tl;
    const ds = D.manHinh(ngP, a);
    const tong = ds.length + 1;
    const buoc = Math.min(P.buoc, ds.length);
    const laXoay = buoc === ds.length;
    const lvId = ds[buoc] ?? "";
    const truoc = ngP.luot[0] ? ngP.luot[0].tl : null;
    const datTraLoi = (k: string, v: string | number) => set({ ph: { ...P, tl: { ...P.tl, [k]: v }, loi: "" } });
    const lv = D.LV.find((x) => x.id === lvId);
    let cau: CauHienThi[] = [];
    let dsBlocks: { lyDo: string; cau: CauHienThi[] }[] = [];
    let xoayItems: XoayMuc[] = [];
    const cauLv = laXoay ? [] : D.cauCuaLv(lvId, ngP, a);
    const khoiDs = laXoay ? [] : D.daoSau(lvId, ngP, a);
    if (!laXoay) {
      cau = cauLv.map((it) => veCauHienThi(it, false, a, g, truoc, P.loi, datTraLoi));
      dsBlocks = khoiDs.map((d) => ({
        lyDo: d.lyDo,
        cau: d.cau.map((it) => veCauHienThi({ t: "chon", g: [g ?? ""], d: lvId, ...it } as CauLoi, true, a, g, truoc, P.loi, datTraLoi)),
      }));
    } else {
      xoayItems = (P.xoay ?? [])
        .map((id) => NGAN_HANG_THEO_ID.get(id))
        .filter((c): c is CauXoayVong => c !== undefined)
        .map((c) => {
          const v = P.xtl[c.id];
          const daTl = v !== undefined;
          const kt = c.loai === "kt";
          const ph = daTl ? phanHoiCauKienThuc(c, v) : null;
          return {
            id: c.id,
            q: thayAi(thayTen(c.cau, tre), tre),
            laKt: kt,
            loai: kt ? "Đố vui" : "Thói quen",
            nguon: c.nguon,
            o: c.luaChon.map((t, j) => ({
              t,
              cls: "sk-op" + (v === j ? " on" : "") + (daTl && kt ? (j === c.dapAn ? " dung" : v === j ? " sai" : "") : ""),
              pick: () => set({ ph: { ...P, xtl: { ...P.xtl, [c.id]: j } } }),
            })),
            coGiai: daTl && kt,
            dung: ph?.dung ?? false,
            giai: ph?.loiGiai ?? "",
          };
        });
    }
    const tatCaCau: CauLoi[] = [
      ...cauLv,
      ...khoiDs.flatMap((d) => d.cau.map((x) => ({ g: [g ?? ""], d: lvId, ...x }) as CauLoi)),
    ];
    const thieu = !laXoay && tatCaCau.some((it) => !it.tuy && (a[it.id] == null || a[it.id] === ""));
    const ngoaiKhoang = laXoay
      ? undefined
      : cauLv.find((it) => it.t === "so" && a[it.id] != null && a[it.id] !== "" && !(D.docSo(a[it.id]) >= (it.min ?? -Infinity) && D.docSo(a[it.id]) <= (it.max ?? Infinity)));
    const c = D.ngCtx(ngP, a);
    const tiep = () => {
      if (thieu) return set({ ph: { ...P, loi: "Anh chị trả lời các câu còn trống giúp Sata Robo nhé." } });
      if (ngoaiKhoang) {
        return set({ ph: { ...P, loi: ngoaiKhoang.q.replace("{ai}", "").trim() + ": nên trong khoảng " + ngoaiKhoang.min + "–" + ngoaiKhoang.max + " " + (ngoaiKhoang.dv ?? "") + "." } });
      }
      const sangXoay = buoc + 1 === ds.length;
      set({ ph: { ...P, buoc: buoc + 1, loi: "", xoay: sangXoay && P.xoay === null ? chonCauXoayChoNguoi(ngP) : P.xoay } });
      cuon("sk-hoi");
    };
    const xong = () => {
      const l = { id: taoId("l"), ngay: D.layHomNay(), tl: { ...a }, xoay: (P.xoay ?? []).slice(), xtl: { ...P.xtl } };
      let luot = [l, ...ngP.luot];
      let tin = "Đã lưu lượt thăm dò của " + ngP.ten + ".";
      if (luot.length > TOI_DA_LUOT) {
        const bo = luot[luot.length - 1]!;
        luot = luot.slice(0, TOI_DA_LUOT);
        tin += " Lượt cũ nhất (" + D.ngayVN(bo.ngay) + ") đã được thay để giữ tối đa " + TOI_DA_LUOT + " lượt.";
      }
      const daThay = ngP.daThay.concat((P.xoay ?? []).filter((id) => !ngP.daThay.includes(id)));
      set({ ds: S.ds.map((n) => (n.id === ngP.id ? { ...n, luot, daThay } : n)), ph: null, kqId: ngP.id, vuaXong: ngP.id });
      baoTin(tin);
      cuon("sk-kq");
    };
    hoi = {
      co: true,
      ten: ngP.ten + (ngP.viDu ? " (ví dụ)" : ""),
      chu: chuDau(ngP.ten),
      nhom: g ? D.TEN_NHOM[g] : "",
      tuoi: D.tuoiChu(ngP.ns),
      ghiTre: g === "u5" || g === "c6" ? "Phụ huynh trả lời thay cho bé." : g === "c12" ? "Phần thể chất phụ huynh có thể trả lời; phần Tinh thần nên để bé tự trả lời." : "",
      coGhiTre: tre,
      coTruoc: !!truoc,
      truocNgay: truoc && ngP.luot[0] ? "Lần trước: " + D.ngayVN(ngP.luot[0].ngay) : "",
      buocChu: "Phần " + (buoc + 1) + "/" + tong,
      pct: Math.round(((buoc + 1) / tong) * 100) + "%",
      cham: ds
        .map((id, j) => ({ t: D.LV.find((x) => x.id === id)?.ten ?? id, cls: "sk-cham" + (j < buoc ? " xong" : j === buoc ? " on" : "") }))
        .concat([{ t: "Câu thêm hôm nay", cls: "sk-cham" + (laXoay ? " on" : "") }]),
      laLoi: !laXoay,
      laXoay,
      lvTen: laXoay ? "Câu hỏi thêm hôm nay (đổi mỗi lần)" : (lv?.ten ?? ""),
      lvMoTa: laXoay ? "Thói quen và đố vui nhỏ, không tính điểm. Mỗi lượt Sata Robo chọn câu mới, không lặp câu " + ngP.ten + " đã gặp." : (lv?.moTa ?? ""),
      laMoc: lvId === "moc",
      laDo: lvId === "do",
      coDo: lvId === "do" && c.coDo,
      cau,
      coDs: dsBlocks.length > 0,
      ds: dsBlocks,
      xoay: xoayItems,
      xoayCon: cauConLai(tre, ngP.daThay).length,
      coLoi: !!P.loi,
      loi: P.loi,
      coLui: buoc > 0,
      lui: () => {
        set({ ph: { ...P, buoc: Math.max(0, buoc - 1), loi: "" } });
        cuon("sk-hoi");
      },
      tiep,
      xong,
      nutTiep: buoc === ds.length - 1 ? "Sang câu thêm hôm nay" : "Phần tiếp theo",
      huy: () => set({ ph: null }),
      phut: g === "nl" || g === "gia" ? "khoảng 7–8 phút" : "khoảng 5 phút",
    };
  }

  // ───────────── [03] KẾT QUẢ ─────────────
  const ngK = S.ds.find((n) => n.id === S.kqId && n.luot.length) ?? S.ds.find((n) => n.luot.length);
  type Kq =
    | { co: false; the: []; chon: [] }
    | {
        co: true;
        ten: string;
        chu: string;
        nhom: string;
        ngay: string;
        vuaXong: boolean;
        tomTat: string;
        mo: boolean;
        khoa: boolean;
        xemKq: () => void;
        chon: { t: string; cls: string; pick: () => void }[];
        the: { ten: string; nhan: string; pill: string; cls: string; soLieu: string; coSoLieu: boolean; dong: { t: string; nguon: string }[] }[];
        gia: { ten: string }[];
        coDo: boolean;
        hoTro: boolean;
        coXh: boolean;
        xh: { t: string }[];
        xhNgay: string;
        tuan: { thu: string; viec: string }[];
        coTuan: boolean;
        thu: { t: string; on: boolean; cls: string; bat: () => void }[];
        ttXong: boolean;
        ttLoi: string;
        pdfChu: string;
        pdf: () => void;
        lamLai: () => void;
      };
  let kq: Kq = { co: false, the: [], chon: [] };
  const l0 = ngK?.luot[0];
  if (ngK && l0) {
    const g = D.nhomTuoi(ngK.ns);
    const r = D.ketQua(ngK, l0.tl);
    const lvMo = D.manHinh(ngK, l0.tl).length;
    const lTruoc = ngK.luot[1];
    const xh: string[] = [];
    if (lTruoc) {
      const r2 = D.ketQua(ngK, lTruoc.tl).c;
      const c = r.c;
      if (Number.isFinite(c.bmi) && Number.isFinite(r2.bmi)) {
        const d = c.can - r2.can;
        xh.push("Cân nặng " + (d > 0 ? "tăng " + D.soGon(d) : d < 0 ? "giảm " + D.soGon(-d) : "không đổi") + (d ? " kg" : ""));
      }
      // Số phút vận động và giờ ngủ nay là CHỌN khoảng (12/11/2026) ⇒ con số là ước tính; giờ ngủ nói bằng chính nhãn phương án đã chọn.
      if (c.nl && Number.isFinite(c.phutTuan) && Number.isFinite(r2.phutTuan)) xh.push("Vận động ≈ " + Math.round(r2.phutTuan) + " → ≈ " + Math.round(c.phutTuan) + " phút/tuần");
      if (Number.isFinite(c.gio) && Number.isFinite(r2.gio)) {
        const idNgu = g === "u5" ? "ngu_u5" : "ngu_gio";
        const cauNgu = D.LOI.find((x) => x.id === idNgu);
        const nayNgu = cauNgu ? D.thuongDau(D.nhanTl(cauNgu, l0.tl[idNgu])) : "";
        const truocNgu = cauNgu ? D.thuongDau(D.nhanTl(cauNgu, lTruoc.tl[idNgu])) : "";
        if (nayNgu && truocNgu) xh.push(nayNgu === truocNgu ? "Giấc ngủ giữ ở " + nayNgu : "Giấc ngủ " + truocNgu + " → " + nayNgu);
        else xh.push("Giấc ngủ " + D.soGon(r2.gio) + " → " + D.soGon(c.gio) + " giờ");
      }
      if (c.who5 != null && r2.who5 != null) xh.push("WHO-5 " + r2.who5 + " → " + c.who5);
    }
    const bmiK = Number.isFinite(r.c.bmi) && r.c.nl && !r.c.mt ? r.c.bmi : Number.NaN;
    const khuon: TenKhuon = D.laTre(g)
      ? g === "u5"
        ? "tre-nho"
        : "tre"
      : r.c.mt
        ? "dac-biet"
        : !Number.isFinite(bmiK)
          ? "nl-binh-thuong"
          : bmiK < D.NG.thieu
            ? "nl-nhe-can"
            : bmiK >= D.NG.thua
              ? "nl-can-chu-y"
              : "nl-binh-thuong";
    const kh = KHUON_KET_QUA[khuon];
    const thuDs = S.thu[ngK.id] ?? [false, false, false];
    const soXong = thuDs.filter(Boolean).length;
    kq = {
      co: true,
      ten: ngK.ten + (ngK.viDu ? " (ví dụ)" : ""),
      chu: chuDau(ngK.ten),
      nhom: g ? D.TEN_NHOM[g] : "",
      ngay: D.ngayVN(l0.ngay),
      vuaXong: S.vuaXong === ngK.id,
      tomTat: "Đã xong " + lvMo + "/" + lvMo + " phần",
      mo: lg.daMo,
      khoa: !lg.daMo,
      xemKq: () => lg.yeuCau(() => void cuon("sk-kq"), "xem-ket-qua"),
      chon: S.ds.filter((n) => n.luot.length).map((n) => ({ t: n.ten, cls: "sk-chip-n" + (n.id === ngK.id ? " on" : ""), pick: () => set({ kqId: n.id }) })),
      the: r.the.map((t) => {
        const m = D.MUC[t.muc];
        return {
          ten: D.LV.find((x) => x.id === t.lv)?.ten ?? t.lv,
          nhan: m[0],
          pill: m[1],
          cls: "sk-kq-the sk-kq-" + t.muc,
          soLieu: t.soLieu,
          coSoLieu: !!t.soLieu,
          dong: t.dong.map((d) => ({ t: d[0], nguon: d[1] })),
        };
      }),
      gia: r.the.map((t) => ({ ten: D.LV.find((x) => x.id === t.lv)?.ten ?? t.lv })),
      coDo: r.coDo,
      hoTro: r.hoTro,
      coXh: xh.length > 0,
      xh: xh.map((t) => ({ t })),
      xhNgay: lTruoc ? "So với lượt " + D.ngayVN(lTruoc.ngay) : "",
      tuan: (kh.vanDong.tuan ?? []).map((d) => ({ thu: d[0], viec: d[1] })),
      coTuan: !!(kh.vanDong.tuan && kh.vanDong.tuan.length),
      thu: kh.thuThach.map((tt, j) => ({
        t: tt,
        on: !!thuDs[j],
        cls: "sk-tt-o-wrap" + (thuDs[j] ? " on" : ""),
        bat: () => {
          const nx = thuDs.slice();
          nx[j] = !nx[j];
          set({ thu: { ...S.thu, [ngK.id]: nx } });
        },
      })),
      ttXong: soXong > 0,
      ttLoi: soXong === 3 ? "Tuyệt vời! Cả 3 thử thách tuần này đã xong." : "Đã xong " + soXong + "/3 — Sata Robo cổ vũ " + ngK.ten + "!",
      pdfChu: "Tải bản PDF của " + ngK.ten,
      pdf: () =>
        lg.yeuCau(() => {
          baoTin("Đang mở hộp thoại in — chọn «Lưu thành PDF» để tải bản PDF về máy.");
          setTimeout(() => window.print(), 150);
        }, "tai-pdf"),
      lamLai: () => {
        set({ ph: phienMoi(ngK.id) });
        cuon("sk-hoi");
      },
    };
  }

  // ───────────── HỘP XOÁ / ĐỦ NGƯỜI ─────────────
  const H = S.hop;
  const saoLuu = () => {
    try {
      const blob = new Blob([banSaoLuu(S.ds, S.thu)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sata-robo-suc-khoe-" + D.layHomNay() + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      baoTin("Đã tải bản sao lưu về máy.");
    } catch {
      baoTin("Chưa tải được bản sao lưu — anh chị thử lại giúp Sata Robo nhé.");
    }
  };
  const hop = { tieuDe: "", moTa: "", coDs: false, ds: [] as { t: string; on: boolean; cls: string; pick: () => void }[], coSaoLuu: false, nut: "Xoá", khoa: false, xoa: () => {}, huy: () => {}, nen: (_e?: unknown) => {}, saoLuu };
  if (H) {
    const dong = () => set({ hop: null });
    hop.huy = dong;
    hop.nen = (e) => {
      const ev = e as { target?: unknown; currentTarget?: unknown } | undefined;
      if (ev && ev.target === ev.currentTarget) dong();
    };
    if (H.loai === "day") {
      hop.tieuDe = "Cả nhà đã đủ " + TOI_DA_NGUOI + " người";
      hop.moTa = "Sổ chứa tối đa " + TOI_DA_NGUOI + " người. Để thêm " + (T.ten.trim() || "người mới") + ", anh chị chọn một người để xoá bớt (toàn bộ các lượt của người đó sẽ bị xoá khỏi máy):";
      hop.coDs = true;
      hop.coSaoLuu = true;
      hop.nut = "Xoá người đã chọn và thêm";
      hop.khoa = !H.chon;
      hop.ds = S.ds
        .slice()
        .reverse()
        .map((n) => ({ t: n.ten + " · " + D.tuoiChu(n.ns) + " · " + n.luot.length + " lượt", on: H.chon === n.id, cls: "sk-hop-o" + (H.chon === n.id ? " on" : ""), pick: () => set({ hop: { ...H, chon: n.id } }) }));
      hop.xoa = () => {
        if (H.chon) themNguoi(H.chon);
      };
    } else {
      hop.tieuDe = "Xoá " + H.ten + "?";
      hop.moTa = "Toàn bộ các lượt thăm dò của người này sẽ bị xoá khỏi máy.";
      hop.coSaoLuu = true;
      hop.xoa = () => {
        set({ ds: S.ds.filter((n) => n.id !== H.nid), hop: null, ph: S.ph && S.ph.mid === H.nid ? null : S.ph });
        baoTin("Đã xoá " + H.ten + " khỏi sổ.");
      };
    }
  }

  const tv = (k: "ten" | "ns" | "vt") => (e: { target?: { value?: string } } | null) => setT({ [k]: giaTriO(e), loi: "" });
  const soXv = useMemo(() => NGAN_HANG_XOAY_VONG.length, []);

  return {
    homNay,
    nguoi,
    soNguoi: S.ds.length + "/" + TOI_DA_NGUOI,
    soLuot: S.ds.reduce((s, n) => s + n.luot.length, 0),
    coViDu: S.ds.some((n) => n.viDu),
    xoaViDu: () => set({ ds: S.ds.filter((n) => !n.viDu), ph: S.ph && S.ph.mid.startsWith("vd-") ? null : S.ph, kqId: null }),
    trong: S.ds.length === 0,
    conCho: S.ds.length < TOI_DA_NGUOI,
    conChoChu: "còn " + (TOI_DA_NGUOI - S.ds.length) + " chỗ",
    them: T,
    themMo: !!T.mo,
    coThemLoi: !!T.loi,
    themNhom: gT ? "Nhóm: " + D.TEN_NHOM[gT] : "Nhóm tuổi tự xác định theo ngày sinh",
    coMtOpt: gT === "nl" && T.gt === "nu",
    moThem: () => {
      setT({ mo: !T.mo });
      if (!T.mo) setTimeout(() => document.getElementById("sk-ten")?.focus({ preventScroll: true }), 200);
    },
    tOn: {
      ten: tv("ten"),
      ns: tv("ns"),
      vt: tv("vt"),
      mt: (e: { target?: { checked?: boolean } } | null) => setT({ mt: !!(e && e.target && e.target.checked) }),
    },
    gtOpts: ([["nu", "Nữ"], ["nam", "Nam"]] as const).map((o) => ({ t: o[1], cls: "sk-seg-o" + (T.gt === o[0] ? " on" : ""), on: T.gt === o[0], pick: () => setT({ gt: o[0] }) })),
    vtOpts: VAI_TRO.map((t) => ({ v: t, t })),
    themNguoi: () => themNguoi(),
    hoi,
    coHoi: hoi.co,
    khongHoi: !hoi.co,
    kq,
    coKq: kq.co,
    soLoi: D.LOI.length,
    soDs: D.DS.reduce((s, d) => s + d.cau.length, 0),
    soXv,
    hopMo: !!H,
    hop,
    coToast: !!S.toast,
    toast: S.toast,
  };
}

export type SucKhoeVm = ReturnType<typeof useSucKhoeVm>;
