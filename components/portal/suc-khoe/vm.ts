"use client";
/**
 * VIEW-MODEL «Sức khỏe cả nhà» ở CỔNG PHỤ HUYNH — chuyển từ khối `renderVals` của thiết kế (artifact «Cổng Phụ Huynh — Thiết kế lại»: Suc-khoe.dc.html +
 * Suc-khoe-khao-sat.dc.html) sang React. Hai view sinh từ markup artifact chỉ vẽ những gì hook này trả về; kiểu của view = `SucKhoeCongVm` / `KhaoSatCongVm`.
 *
 * Quyết định của chủ dự án (08/11/2026): dữ liệu ở lại TRÊN MÁY (localStorage `sata.portal-suc-khoe.v1`); khuyến nghị DÙNG CHUNG khuôn với trang công khai.
 *
 * Khác thiết kế (có chủ đích, đều vì dữ liệu THẬT — không bịa):
 *  · Thiết kế mẫu có 4 người bịa; ở đây bắt đầu TRỐNG, thêm người qua form «Thêm số đo mới» (mục «＋ Thêm người mới» của thiết kế cần thêm tên/ngày sinh/giới tính/vai trò).
 *  · Trẻ em: thiết kế ghi «trong vùng tham khảo thông thường» (số mẫu). Sata Robo CHƯA có bảng chuẩn WHO nên KHÔNG phân loại, nói rõ là chưa đánh giá.
 *  · CHƯA có quy tắc biến câu trả lời khảo sát thành lời khuyên riêng (thiết kế chỉ có kết quả mẫu viết tay: «Vì Bin ngại rau lá…»). Hồ sơ thói quen được lưu và hiển thị,
 *    nhưng lời khuyên / lịch tuần / thử thách hiện chọn theo nhóm tuổi + số đo (khuôn dùng chung với trang công khai).
 *  · Đồng ý lưu dữ liệu nhạy cảm: giữ ô tích MỘT lần, nhưng nội dung nói đúng sự thật «lưu trên thiết bị này, không gửi lên máy chủ».
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { cssSangObject } from "@/components/portal/tu-sach/vm";
import { KHAO_SAT_CONG, type CauKhaoSat } from "@/lib/suc-khoe/khao-sat-cong";
import { KHUON_KET_QUA } from "@/lib/suc-khoe/khuon-ket-qua";
import { layHomNay, thangTuoi, tuoiChu } from "@/lib/suc-khoe/dong-co-goc";
import {
  bmiCua,
  COT_THUOC,
  diemXuHuong,
  f1,
  f1Gon,
  khuonCua,
  kiemBan,
  laTreEm,
  nangLuongUocTinh,
  ngayHienThi,
  ngayNgan,
  nhanThu,
  phanLoaiBmi,
  themBan,
  TOI_DA_BAN,
  TOI_DA_NGUOI_CONG,
  type Ban,
  type HoatDong,
  type KhaoSatDaLam,
  type LoiBan,
  type NguoiCong,
} from "@/lib/suc-khoe/so-cong";
import { banSaoLuuCong, docSoCong, ghiSoCong, KHOA_LUU_CONG } from "./luu-tru";

type Nhom = "an" | "vd" | "ng";
type Man = "tq" | "ks";
export type FormSoDo = {
  mo: boolean;
  nguoiId: string;
  ngay: string;
  nang: string;
  cao: string;
  eo: string;
  hoatDong: HoatDong;
  mt: boolean;
  benhNen: boolean;
  ten: string;
  vt: string;
  ns: string;
  gt: "nu" | "nam";
  loi: string;
};
type UiKs = { ni: string | null; b: number; tl: Record<string, number | number[]>; ai: number; dy: boolean };

export const VAI_TRO_CONG = ["Bố", "Mẹ", "Con", "Ông", "Bà", "Người thân khác"] as const;
const MOI = "moi";

const formTrong = (nguoiId: string = MOI): FormSoDo => ({ mo: false, nguoiId, ngay: "", nang: "", cao: "", eo: "", hoatDong: "vua", mt: false, benhNen: false, ten: "", vt: "Con", ns: "", gt: "nu", loi: "" });

const boGach = (s: string) => s.replace(/\*\*/g, "");
const chuDau = (t: string) => (Array.from(t.trim())[0] ?? "?").toUpperCase();
const taoId = (tien: string) => tien + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
const docSoNhap = (s: string): number => {
  const t = s.trim().replace(",", ".");
  return t === "" ? Number.NaN : Number(t);
};

const MAU_NEN_AVATAR = ["#fde7da", "#ffe3c4", "#f3eaf8", "#e3f3ea"];
const CHIP: Record<"ok" | "cy" | "chua", string> = {
  ok: "background: #e3f3ea; color: #1d7a46;",
  cy: "background: #fde7da; color: #a5561a;",
  chua: "background: #f3eaf8; color: #620c8b;",
};

const LOI_BAN: Record<LoiBan, string> = {
  THIEU_NGAY: "Anh chị chọn ngày đo nhé.",
  NGAY_TUONG_LAI: "Ngày đo chưa tới — anh chị chọn ngày hôm nay hoặc trước đó nhé.",
  CAO_SAI: "Chiều cao nên trong khoảng 40–230 cm.",
  NANG_SAI: "Cân nặng nên trong khoảng 2–250 kg.",
  EO_SAI: "Vòng eo nên trong khoảng 30–200 cm.",
};

const NHOM_KS: readonly (readonly [string, string, string])[] = [
  ["🥦", "Ăn uống", "Bữa sáng, rau, món thích và món ngại"],
  ["🏃", "Vận động", "Môn yêu thích, thời gian mỗi ngày"],
  ["😴", "Giấc ngủ và màn hình", "Giờ đi ngủ, thời gian xem màn hình"],
  ["🗓️", "Thời gian rảnh", "Lúc cả nhà vận động cùng được"],
];

const cauCuaNguoi = (n: NguoiCong, ten = n.ten): CauKhaoSat[] =>
  (laTreEm(n.ns) ? KHAO_SAT_CONG.tre : KHAO_SAT_CONG.lon).map((c) => [c[0], c[1], c[2].replace(/\{ten\}/g, ten), c[3], c[4], c[5]] as const);

export function useSucKhoeCongVm() {
  const [ds, setDs] = useState<NguoiCong[]>([]);
  const [thu, setThu] = useState<Record<string, boolean[]>>({});
  const [dongY, setDongY] = useState(false);
  const [daNap, setDaNap] = useState(false);
  const [man, setMan] = useState<Man>("tq");
  const [chon, setChon] = useState<string | null>(null);
  const [nhom, setNhom] = useState<Nhom>("an");
  const [moCu, setMoCu] = useState(false);
  const [xoa, setXoa] = useState(false);
  const [form, setForm] = useState<FormSoDo>(formTrong());
  const [ui, setUi] = useState<UiKs>({ ni: null, b: -1, tl: {}, ai: 0, dy: false });
  const [toast, setToast] = useState("");
  const henToast = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Đọc sổ SAU khi vẽ lần đầu (HTML máy chủ = lần vẽ đầu của trình duyệt).
  useEffect(() => {
    let chuoi: string | null;
    try {
      chuoi = window.localStorage.getItem(KHOA_LUU_CONG);
    } catch {
      chuoi = null;
    }
    const so = docSoCong(chuoi);
    if (so) {
      setDs(so.ds);
      setThu(so.thu);
      setDongY(so.dongY);
      setChon(so.ds[0]?.id ?? null);
    }
    setDaNap(true);
  }, []);
  useEffect(() => {
    if (!daNap) return;
    try {
      window.localStorage.setItem(KHOA_LUU_CONG, ghiSoCong({ ds, thu, dongY }));
    } catch {
      /* chế độ riêng tư / hết dung lượng: bỏ qua, trang vẫn dùng được trong phiên */
    }
  }, [daNap, ds, thu, dongY]);
  useEffect(() => () => {
    if (henToast.current) clearTimeout(henToast.current);
  }, []);

  const baoTin = useCallback((t: string) => {
    setToast(t);
    if (henToast.current) clearTimeout(henToast.current);
    henToast.current = setTimeout(() => setToast(""), 5200);
  }, []);
  const cuon = (id: string) =>
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);

  const nguoiDangXem = ds.find((n) => n.id === chon) ?? ds[0] ?? null;
  const homNay = layHomNay();

  // ───────────── FORM «Thêm số đo mới» ─────────────
  const capNhatForm = (p: Partial<FormSoDo>) => setForm((f) => ({ ...f, ...p, loi: "" }));
  const moForm = () => {
    setForm({ ...formTrong(nguoiDangXem?.id ?? MOI), mo: true, ngay: homNay, hoatDong: nguoiDangXem?.hoatDong ?? "vua", mt: nguoiDangXem?.mt ?? false, benhNen: nguoiDangXem?.benhNen ?? false });
    cuon("form-sk");
  };
  const dongForm = () => setForm((f) => ({ ...f, mo: false }));
  const chonNguoiForm = (id: string) => {
    const n = ds.find((x) => x.id === id);
    setForm((f) => ({ ...f, nguoiId: id, loi: "", ...(n ? { hoatDong: n.hoatDong, mt: n.mt, benhNen: n.benhNen } : {}) }));
  };

  const luuForm = () => {
    const loi = (t: string) => setForm((f) => ({ ...f, loi: t }));
    const laMoi = form.nguoiId === MOI || !ds.some((n) => n.id === form.nguoiId);
    const cao = docSoNhap(form.cao);
    const nang = docSoNhap(form.nang);
    const eo = form.eo.trim() === "" ? null : docSoNhap(form.eo);
    if (laMoi) {
      if (!form.ten.trim()) return loi("Anh chị nhập tên hoặc biệt danh của người này nhé.");
      const thang = form.ns ? thangTuoi(form.ns) : null;
      if (thang === null || thang < 0) return loi("Anh chị nhập ngày sinh hợp lệ nhé.");
      if (ds.length >= TOI_DA_NGUOI_CONG) return loi(`Sổ chứa tối đa ${TOI_DA_NGUOI_CONG} người — anh chị xoá bớt một người trước nhé.`);
    }
    if (!Number.isFinite(cao) || !Number.isFinite(nang)) return loi("Anh chị nhập đủ cân nặng và chiều cao nhé.");
    const sai = kiemBan({ ngay: form.ngay, cao, nang, eo: eo !== null && Number.isFinite(eo) ? eo : eo === null ? null : Number.NaN });
    if (sai) return loi(LOI_BAN[sai]);
    const ban: Ban = { id: taoId("b"), ngay: form.ngay, cao, nang, eo };
    if (laMoi) {
      const n: NguoiCong = { id: taoId("n"), ten: form.ten.trim().slice(0, 40), vt: form.vt, ns: form.ns, gt: form.gt, hoatDong: form.hoatDong, mt: form.mt && !laTreEm(form.ns) && form.gt === "nu", benhNen: form.benhNen, ban: [ban], ks: null };
      setDs((d) => [n, ...d]);
      setChon(n.id);
      baoTin(`Đã thêm ${n.ten} và lưu số đo đầu tiên.`);
    } else {
      const hien = ds.find((x) => x.id === form.nguoiId)!;
      const kq = themBan(hien.ban, ban);
      setDs((d) => d.map((x) => (x.id === hien.id ? { ...x, ban: kq.ban, hoatDong: form.hoatDong, mt: form.mt && !laTreEm(x.ns) && x.gt === "nu", benhNen: form.benhNen } : x)));
      setChon(hien.id);
      baoTin(kq.bi_thay ? `Đã lưu số đo mới cho ${hien.ten}. Bản cũ nhất (${ngayHienThi(kq.bi_thay.ngay)}) đã được thay để giữ tối đa ${TOI_DA_BAN} bản.` : `Đã lưu số đo mới cho ${hien.ten}.`);
    }
    setForm(formTrong());
    setNhom("an");
    setMoCu(false);
    cuon("ct-sk");
  };

  // ───────────── TỔNG QUAN ─────────────
  const nguoi = ds.map((n, i) => {
    const moi = n.ban[0]!;
    const bmi = bmiCua(moi);
    const pl = phanLoaiBmi(n, bmi);
    const on = n.id === nguoiDangXem?.id;
    return {
      ten: n.ten,
      tat: chuDau(n.ten),
      tuoi: tuoiChu(n.ns) + (laTreEm(n.ns) ? ` · ${n.vt.toLowerCase()}` : ""),
      ngay: ngayNgan(moi.ngay),
      soBan: n.ban.length,
      bmi: f1(bmi),
      xu: diemXuHuong(n.ban),
      mau: pl.mau,
      loai: pl.ten,
      on: on ? "true" : "false",
      xem: on ? "Đang xem ▴" : n.ks ? "Bấm để xem chi tiết ▾" : "Chưa làm khảo sát · bấm để xem",
      chipS: cssSangObject(`align-self: flex-start; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; ${CHIP[pl.loai]}`),
      av: cssSangObject(`flex: none; width: 44px; height: 44px; border-radius: 999px; background: ${MAU_NEN_AVATAR[i % 4]}; color: #241133; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px;`),
      o: cssSangObject(
        "display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 18px; font-family: inherit; color: #241133; text-align: left; " +
          (on ? "background: #ffffff; border: 2px solid #620c8b; box-shadow: 0 6px 18px rgba(98,12,139,0.12);" : "background: #ffffff; border: 2px solid #e6daee;"),
      ),
      bam: () => {
        setChon(n.id);
        setNhom("an");
        setMoCu(false);
        setXoa(false);
      },
    };
  });

  let ct = null as null | {
    ten: string;
    soBan: number;
    ngay: string;
    chao: string;
    so: { nhan: string; so: string; dv: string; doi: string; doiS: CSSProperties }[];
    vungTen: string;
    vung: string;
    vungS: CSSProperties;
    thang: CSSProperties;
    kim: CSSProperties;
    giaiThich: string;
    cu: { ngay: string; cao: string; nang: string; bmi: string; xoa: () => void }[];
  };
  let loi = { tieuDe: "", tomTat: "", muc: [] as { ky: string; t: string; tag: string; coTag: boolean; o: CSSProperties }[], luuY: "", coLuuY: false };
  let tuan: { thu: string; viec: string; o: CSSProperties }[] = [];
  let thuV: { t: string; on: string; tick: string; bam: () => void; s: CSSProperties; box: CSSProperties }[] = [];
  let soXong = 0;
  let ksV = { ngay: "", ai: "", the: [] as { t: string; s: CSSProperties }[] };
  let tuanGhi = "";

  const n0 = nguoiDangXem;
  if (n0) {
    const moi = n0.ban[0]!;
    const truoc = n0.ban[1];
    const bmi = bmiCua(moi);
    const pl = phanLoaiBmi(n0, bmi);
    const tre = laTreEm(n0.ns);
    const khuon = KHUON_KET_QUA[khuonCua(n0, bmi)];
    const doi = (a: number, b: number | undefined, dv: string): [string, CSSProperties] => {
      const mau = cssSangObject("font-size: 12px; color: #6b5a78;");
      if (b === undefined || !truoc) return ["Lần đo đầu tiên", mau];
      const d = a - b;
      if (Math.abs(d) < 0.05) return [`Không đổi so với ${ngayNgan(truoc.ngay)}`, mau];
      return [`${d > 0 ? "Tăng" : "Giảm"} ${f1Gon(Math.abs(d))} ${dv} so với ${ngayNgan(truoc.ngay)}`, mau];
    };
    const dc = doi(moi.cao, truoc?.cao, "cm");
    const dn = doi(moi.nang, truoc?.nang, "kg");
    const so: NonNullable<typeof ct>["so"] = [
      { nhan: "Chiều cao", so: f1Gon(moi.cao), dv: "cm", doi: dc[0], doiS: dc[1] },
      { nhan: "Cân nặng", so: f1Gon(moi.nang), dv: "kg", doi: dn[0], doiS: dn[1] },
      { nhan: "BMI", so: f1(bmi), dv: "", doi: tre ? "BMI thô — chưa so bảng chuẩn WHO" : "Theo ngưỡng châu Á", doiS: cssSangObject("font-size: 12px; color: #6b5a78;") },
    ];
    const nl = nangLuongUocTinh(n0, moi);
    if (!tre && nl !== null) so.push({ nhan: "Năng lượng ≈", so: String(nl).replace(/\B(?=(\d{3})+(?!\d))/g, "."), dv: "kcal/ngày", doi: "Ước tính tham khảo, không phải chỉ tiêu", doiS: cssSangObject("font-size: 12px; color: #6b5a78;") });
    if (tre) {
      const dau = n0.ban[n0.ban.length - 1]!;
      so.push({ nhan: "Lớn thêm", so: n0.ban.length > 1 ? f1Gon(moi.cao - dau.cao) : "—", dv: n0.ban.length > 1 ? "cm" : "", doi: n0.ban.length > 1 ? `Từ ${ngayNgan(dau.ngay)} tới nay` : "Cần 2 lần đo trở lên", doiS: cssSangObject("font-size: 12px; color: #6b5a78;") });
    }
    const coThuoc = !tre && !n0.mt;
    const kimPhanTram = Math.max(2, Math.min(98, ((bmi - 15) / 17) * 100));
    ct = {
      ten: n0.ten,
      soBan: n0.ban.length,
      ngay: ngayHienThi(moi.ngay),
      chao: boGach(khuon.loiChao).replace(/\{ten\}/g, n0.ten),
      so,
      vungTen: tre ? "BMI thô của bé" : "BMI theo ngưỡng châu Á",
      vung: pl.ten,
      vungS: cssSangObject(`font-size: 14px; font-weight: 700; color: ${pl.mau};`),
      thang: cssSangObject(coThuoc ? `position: relative; height: 14px; border-radius: 999px; overflow: hidden; display: grid; grid-template-columns: ${COT_THUOC};` : "display: none;"),
      kim: cssSangObject(coThuoc ? `position: absolute; top: 0; left: ${kimPhanTram.toFixed(1)}%; transform: translateX(-50%); font-size: 14px; line-height: 14px; color: #241133;` : "display: none;"),
      giaiThich: tre
        ? "Trẻ dưới 18 tuổi phải so BMI-theo-tuổi với chuẩn WHO (0–5 tuổi: chuẩn 2006; 5–19 tuổi: tham chiếu 2007). Sata Robo đang chờ bảng chuẩn nên chưa đánh giá. Xin đừng tự cho bé ăn kiêng; cân đo định kỳ ở trạm y tế hoặc ở trường là cách theo dõi tăng trưởng đáng tin nhất."
        : n0.mt
          ? "BMI không áp dụng khi mang thai hoặc cho con bú; tăng cân thai kỳ cần theo chuẩn riêng — anh chị trao đổi với bác sĩ sản khoa."
          : "Theo ngưỡng BMI châu Á: dưới 18,5 nhẹ cân · 18,5–22,9 bình thường · 23–24,9 thừa cân · từ 25 béo phì. BMI không phân biệt cơ và mỡ nên chỉ là mốc tham khảo.",
      cu: n0.ban.slice(1).map((b) => ({
        ngay: ngayHienThi(b.ngay),
        cao: f1Gon(b.cao),
        nang: f1Gon(b.nang),
        bmi: f1(bmiCua(b)),
        xoa: () => {
          setDs((d) => d.map((x) => (x.id === n0.id ? { ...x, ban: x.ban.filter((y) => y.id !== b.id) } : x)));
          baoTin("Đã xoá bản đo này.");
        },
      })),
    };

    const kh = nhom === "an" ? khuon.anUong : nhom === "vd" ? khuon.vanDong : khuon.nghiNgoi;
    loi = {
      tieuDe: kh.tieuDe,
      tomTat: kh.tomTat,
      luuY: kh.luuY ?? "",
      coLuuY: !!kh.luuY,
      muc: kh.muc.map((m) => ({ ky: m[0], t: boGach(m[1]), tag: "", coTag: false, o: cssSangObject("display: flex; gap: 12px; padding: 12px 14px; border-radius: 14px; font-size: 15px; line-height: 23px; background: #fff8f0;") })),
    };
    const nayThu = nhanThu(homNay);
    tuan = (khuon.vanDong.tuan ?? []).map((t) => ({
      thu: t[0],
      viec: t[1],
      o: cssSangObject(`display: flex; flex-direction: column; gap: 4px; padding: 8px 4px; border-radius: 10px; text-align: center; min-height: 72px; ${t[0] === nayThu ? "background: #620c8b; color: #ffffff;" : "background: #fff8f0; color: #241133;"}`),
    }));
    const tick = thu[n0.id] ?? [false, false, false];
    thuV = khuon.thuThach.map((t, i) => {
      const on = !!tick[i];
      if (on) soXong++;
      return {
        t,
        on: on ? "true" : "false",
        tick: on ? "✓" : "",
        bam: () => {
          const nx = (thu[n0.id] ?? [false, false, false]).slice();
          nx[i] = !nx[i];
          setThu((x) => ({ ...x, [n0.id]: nx }));
        },
        s: cssSangObject(
          "display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border-radius: 12px; border: none; background: #ffffff; color: #241133; font-family: inherit; font-size: 14px; font-weight: 600; text-align: left;" +
            (on ? " text-decoration: line-through; text-decoration-color: #1d7a46;" : ""),
        ),
        box: cssSangObject("flex: none; width: 22px; height: 22px; border-radius: 7px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #ffffff; " + (on ? "background: #1d7a46;" : "border: 2px solid #c9b3d9;")),
      };
    });
    tuanGhi = "Gợi ý chung theo nhóm tuổi và số đo";
    if (n0.ks) {
      const cau = cauCuaNguoi(n0);
      const theoNhom = new Map<string, string>();
      cau.forEach((c, i) => {
        const v = n0.ks!.tl[String(i)];
        if (v === undefined || theoNhom.has(c[0])) return;
        const chonT = (Array.isArray(v) ? v : [v]).map((k) => c[4][k]).filter(Boolean).join(", ");
        if (chonT) theoNhom.set(c[0], `${c[1].replace(/^\S+\s/, "").toLowerCase().replace(/^./, (x) => x.toUpperCase())}: ${chonT}`);
      });
      ksV = {
        ngay: ngayNgan(n0.ks.ngay),
        ai: n0.ks.ai,
        the: [...theoNhom.values()].slice(0, 8).map((t) => ({ t, s: cssSangObject("padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; background: #fff8f0; color: #4a3a57; border: 1px solid #e6daee;") })),
      };
    }
  }

  const batDauKhaoSat = (id: string | undefined) => {
    const n = ds.find((x) => x.id === id) ?? ds[0];
    if (!n) return;
    setMan("ks");
    setUi((u) => ({ ...u, ni: n.id, b: -1, tl: (n.ks?.tl as Record<string, number | number[]> | undefined) ?? {}, ai: 0 }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tq = {
    coNguoi: ds.length > 0,
    khongNguoi: ds.length === 0,
    soNguoi: ds.length,
    toiDaNguoi: TOI_DA_NGUOI_CONG,
    soBanTong: ds.reduce((s, n) => s + n.ban.length, 0),
    conCho: TOI_DA_NGUOI_CONG - ds.length,
    soCauKs: n0 ? cauCuaNguoi(n0).length : KHAO_SAT_CONG.lon.length,
    nguoi,
    ct: ct ?? {
      ten: "",
      soBan: 0,
      ngay: "",
      chao: "",
      so: [],
      vungTen: "",
      vung: "",
      vungS: {},
      thang: {},
      kim: {},
      giaiThich: "",
      cu: [],
    },
    coKs: !!n0?.ks,
    chuaKs: !!n0 && !n0.ks,
    ks: ksV,
    nhomKs: NHOM_KS.map((g) => ({ ky: g[0], ten: g[1], mo: g[2] })),
    lamKs: (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      batDauKhaoSat(n0?.id);
    },
    lamLaiKs: (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      batDauKhaoSat(n0?.id);
    },
    nhom: ([["an", "🥦 Ăn uống"], ["vd", "🏃 Vận động"], ["ng", "😴 Nghỉ ngơi"]] as const).map((g) => {
      const on = g[0] === nhom;
      return {
        ten: g[1],
        on: on ? "true" : "false",
        bam: () => setNhom(g[0]),
        s: cssSangObject(
          "height: 42px; border-radius: 10px; border: none; font-family: inherit; font-size: 14px; " +
            (on ? "background: #ffffff; color: #241133; font-weight: 700; box-shadow: 0 1px 2px rgba(36,17,51,0.12);" : "background: transparent; color: #6b5a78; font-weight: 600;"),
        ),
      };
    }),
    loi,
    tuan,
    tuanGhi,
    thu: thuV,
    thuXong: soXong,
    xongHet: soXong === 3,
    // form
    coForm: form.mo,
    moForm,
    dongForm,
    form,
    capNhatForm,
    chonNguoiForm,
    luuForm,
    dsChonNguoi: ds.map((n) => ({ id: n.id, nhan: `${n.ten} · ${tuoiChu(n.ns)}` })),
    // xoá / bản cũ
    moCu,
    moCuOn: moCu ? "true" : "false",
    cuTen: ct && ct.cu.length ? (moCu ? "Ẩn các bản cũ ▴" : `Các bản cũ hơn (${ct.cu.length}) ▾`) : "Chưa có bản cũ",
    batCu: () => setMoCu((v) => !v),
    coXoa: xoa,
    moXoa: () => setXoa(true),
    huyXoa: () => setXoa(false),
    xoaThat: () => {
      if (!n0) return;
      setDs((d) => d.filter((x) => x.id !== n0.id));
      setThu((t) => {
        const { [n0.id]: _bo, ...con } = t;
        return con;
      });
      setChon(null);
      setXoa(false);
      baoTin(`Đã xoá ${n0.ten} khỏi sổ.`);
    },
    saoLuu: () => {
      try {
        const url = URL.createObjectURL(new Blob([banSaoLuuCong({ ds, thu, dongY })], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `sata-robo-suc-khoe-cong-${homNay}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        baoTin("Chưa tải được bản sao lưu — anh chị thử lại giúp Sata Robo nhé.");
      }
    },
  };

  // ───────────── KHẢO SÁT ─────────────
  const nKs = ds.find((n) => n.id === ui.ni) ?? n0;
  const tre = nKs ? laTreEm(nKs.ns) : false;
  const CAU = nKs ? cauCuaNguoi(nKs) : [];
  const tong = CAU.length;
  const b = ui.b;
  const dem = new Map<string, number>();
  CAU.forEach((c) => dem.set(c[1], (dem.get(c[1]) ?? 0) + 1));
  const cauHienTai = b >= 0 && b < tong ? CAU[b]! : null;
  const vHienTai = ui.tl[String(b)];
  const nhieu = cauHienTai ? cauHienTai[3] === 2 : false;
  const daTraLoi = cauHienTai ? (nhieu ? Array.isArray(vHienTai) && vHienTai.length > 0 : typeof vHienTai === "number") : false;
  const gom = new Map<string, { nhan: string; the: { q: string; t: string }[] }>();
  CAU.forEach((c, i) => {
    const v = ui.tl[String(i)];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) return;
    const ts = (Array.isArray(v) ? v : [v]).map((k) => c[4][k]).filter(Boolean);
    const g = gom.get(c[0]) ?? { nhan: c[1], the: [] };
    g.the.push({ q: c[2], t: ts.join(", ") });
    gom.set(c[0], g);
  });
  const nhanAi = nKs ? (tre ? (ui.ai === 0 ? `Ba mẹ trả lời cho ${nKs.ten}` : `${nKs.ten} cùng trả lời với ba mẹ`) : `${nKs.ten} tự trả lời`) : "";

  const ks = {
    nguoi: ds.map((n) => {
      const on = n.id === nKs?.id;
      return {
        ten: n.ten,
        on: on ? "true" : "false",
        da: n.ks ? " ✓" : "",
        daS: cssSangObject(`font-size: 12px; color: ${on ? "#ffd3a8" : "#1d7a46"};`),
        bam: () => setUi((u) => ({ ...u, ni: n.id, b: -1, tl: (n.ks?.tl as Record<string, number | number[]> | undefined) ?? {}, ai: 0 })),
        s: cssSangObject(
          "height: 38px; padding: 0 14px; border-radius: 999px; font-family: inherit; font-size: 14px; font-weight: 600; " +
            (on ? "background: #620c8b; color: #ffffff; border: 1px solid #620c8b;" : "background: #ffffff; color: #241133; border: 1px solid #e6daee;"),
        ),
      };
    }),
    ten: nKs?.ten ?? "",
    laTre: tre,
    ai: [
      [`Ba mẹ trả lời cho ${nKs?.ten ?? ""}`, "Nhanh nhất, ba mẹ tự chọn"],
      [`${nKs?.ten ?? ""} cùng trả lời với ba mẹ`, "Ba mẹ đọc câu hỏi, bé chọn — vui hơn"],
    ].map((a, i) => {
      const on = i === ui.ai;
      return {
        ten: a[0]!,
        mo: a[1]!,
        on: on ? "true" : "false",
        bam: () => setUi((u) => ({ ...u, ai: i })),
        s: cssSangObject(
          "display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px; border-radius: 14px; font-family: inherit; color: #241133; text-align: left; " +
            (on ? "background: #f3eaf8; border: 2px solid #620c8b;" : "background: #ffffff; border: 2px solid #e6daee;"),
        ),
      };
    }),
    nhom: [...dem.entries()].map(([k, so]) => {
      const p = k.split(" ");
      return { ky: p[0]!, ten: k.slice(p[0]!.length + 1).toLowerCase().replace(/^./, (x) => x.toUpperCase()), so };
    }),
    tong,
    gioiThieu: tre
      ? `Số đo chỉ cho biết ${nKs?.ten ?? ""} đang ở đâu. Để gợi ý ăn uống, vận động và giấc ngủ hợp với ${nKs?.ten ?? ""}, Sata Robo cần biết bé thích ăn gì, ngại món gì, mê môn nào và ngủ lúc mấy giờ. Không có đáp án đúng hay sai — cứ trả lời như ngày thường của bé.`
      : "Số đo chỉ cho biết anh/chị đang ở đâu. Để gợi ý hợp với nhịp sống của anh/chị, Sata Robo cần biết thói quen ăn uống, vận động, giấc ngủ và mục tiêu. Không có đáp án đúng hay sai.",
    aiTraLoi: nhanAi,
    laGioiThieu: b < 0,
    laCau: b >= 0 && b < tong,
    laTong: b >= tong && tong > 0,
    canDongY: !dongY,
    dongY: ui.dy,
    dyDau: ui.dy ? "✓" : "",
    dyO: cssSangObject(
      "flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; color: #ffffff; " +
        (ui.dy ? "background: #620c8b; border: 2px solid #620c8b;" : "background: #ffffff; border: 2px solid #9c86ad;"),
    ),
    tickDongY: () => setUi((u) => ({ ...u, dy: !u.dy })),
    batDau: () => {
      if (!dongY && !ui.dy) return baoTin("Cần đồng ý lưu dữ liệu sức khoẻ thì mới làm khảo sát được");
      if (!dongY) setDongY(true);
      setUi((u) => ({ ...u, b: 0 }));
    },
    lui: () => setUi((u) => ({ ...u, b: u.b <= 0 ? -1 : u.b - 1 })),
    tien: () => {
      if (!daTraLoi) return baoTin("Chọn ít nhất một ý, hoặc bấm “Bỏ qua câu này”.");
      setUi((u) => ({ ...u, b: u.b + 1 }));
    },
    boQua: () => setUi((u) => ({ ...u, b: u.b + 1 })),
    sua: () => setUi((u) => ({ ...u, b: 0 })),
    cau: cauHienTai
      ? {
          nhom: cauHienTai[1],
          so: b + 1,
          hoi: cauHienTai[2],
          goiY: nhieu ? "Chọn bao nhiêu cũng được" : "Chọn một",
          coLuuY: !!cauHienTai[5],
          luuY: cauHienTai[5],
          khoa: daTraLoi ? "false" : "true",
          thanh: cssSangObject(`height: 100%; width: ${Math.round(((b + 1) / tong) * 100)}%; background: #fe8f2d; border-radius: 999px;`),
          tienTen: b === tong - 1 ? "Xem hồ sơ thói quen" : "Câu tiếp theo ›",
          tienS: cssSangObject(
            "height: 48px; padding: 0 22px; border-radius: 12px; border: none; font-family: inherit; font-size: 15px; font-weight: 700; " + (daTraLoi ? "background: #fe8f2d; color: #241133;" : "background: #f3eaf8; color: #6b5a78;"),
          ),
          chon: cauHienTai[4].map((t, i) => {
            const on = nhieu ? Array.isArray(vHienTai) && vHienTai.includes(i) : vHienTai === i;
            return {
              t,
              on: on ? "true" : "false",
              vai: nhieu ? "checkbox" : "radio",
              dau: on ? "✓" : "",
              dauS: cssSangObject(
                `flex: none; width: 22px; height: 22px; box-sizing: border-box; border-radius: ${nhieu ? "7px" : "999px"}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #ffffff; ` +
                  (on ? "background: #620c8b;" : "border: 2px solid #c9b3d9;"),
              ),
              s: cssSangObject(
                "display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 14px; border-radius: 14px; font-family: inherit; font-size: 15px; font-weight: 600; color: #241133; text-align: left; " +
                  (on ? "background: #f3eaf8; border: 2px solid #620c8b;" : "background: #ffffff; border: 2px solid #e6daee;"),
              ),
              bam: () =>
                setUi((u) => {
                  const hien = u.tl[String(b)];
                  if (nhieu) {
                    const a = Array.isArray(hien) ? hien.slice() : [];
                    const k = a.indexOf(i);
                    if (k >= 0) a.splice(k, 1);
                    else a.push(i);
                    return { ...u, tl: { ...u.tl, [String(b)]: a } };
                  }
                  return { ...u, tl: { ...u.tl, [String(b)]: i } };
                }),
            };
          }),
        }
      : { nhom: "", so: 0, hoi: "", goiY: "", chon: [] as never[], thanh: {} as CSSProperties, khoa: "true", tienS: {} as CSSProperties, tienTen: "", coLuuY: false, luuY: "" },
    tom: [...gom.values()].map((g) => {
      const p = g.nhan.split(" ");
      return { ky: p[0]!, ten: g.nhan.slice(p[0]!.length + 1).toLowerCase().replace(/^./, (x) => x.toUpperCase()), the: g.the };
    }),
    luu: (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      if (!nKs) return;
      const daLam: KhaoSatDaLam = { ngay: homNay, ai: nhanAi, tl: ui.tl };
      setDs((d) => d.map((x) => (x.id === nKs.id ? { ...x, ks: daLam } : x)));
      setChon(nKs.id);
      setNhom("an");
      setMan("tq");
      baoTin(`Đã lưu hồ sơ thói quen của ${nKs.ten}.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    veTongQuan: (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      setMan("tq");
    },
  };

  return { man, tq, ks, daNap, toast, coToast: toast !== "" };
}

export type SucKhoeCongVm = ReturnType<typeof useSucKhoeCongVm>["tq"];
export type KhaoSatCongVm = ReturnType<typeof useSucKhoeCongVm>["ks"];
