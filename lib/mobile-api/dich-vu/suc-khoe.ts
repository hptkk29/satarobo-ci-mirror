import type { NextResponse } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/response";
import { laNgayHopLe } from "@/lib/format/thoi-gian-vn";
import { isSucKhoeEnabled } from "@/lib/flags";
import { layHomNay, nhomTuoi, thangTuoi } from "@/lib/suc-khoe/dong-co-goc";
import { KHAO_SAT_CONG, type CauKhaoSat } from "@/lib/suc-khoe/khao-sat-cong";
import { thongTinLuuTru, type ThongTinLuuTru } from "@/lib/suc-khoe/luu-may-chu";
import { KHUON_KET_QUA, type KhoiGoiY, type TenKhuon } from "@/lib/suc-khoe/khuon-ket-qua";
import {
  bmiCua,
  khuonCua,
  kiemBan,
  laTreEm,
  nangLuongUocTinh,
  phanLoaiBmi,
  SO_CAU_THU_THACH,
  TOI_DA_BAN,
  TOI_DA_NGUOI_CONG,
  type HoatDong,
  type LoiBan,
} from "@/lib/suc-khoe/so-cong";

import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * V8.23 — «Sức khoẻ cả nhà» + «Khảo sát thói quen» (P-Suc-khoe, P-Suc-khoe-ks) trên app. Dùng lại ĐÚNG miền của cổng phụ huynh web (`lib/suc-khoe/**`) — không có động cơ / bảng thứ hai.
 *
 * ⚠️ MIỀN NÀY KHÔNG CÓ LƯU TRỮ PHÍA MÁY CHỦ. Chủ dự án chốt 08/11/2026 (`components/portal/suc-khoe/luu-tru.ts`, `vm.ts`): sổ số đo, câu trả lời khảo sát, thử thách ở lại TRÊN THIẾT BỊ,
 * «KHÔNG BAO GIỜ gửi lên máy chủ». Thành viên trong sổ cũng KHÔNG phải `Student` (tên tự gõ, ≤ 6 người, phụ huynh chưa có con vẫn dùng được) ⇒ không có chủ thể dữ liệu để gắn
 * `studentId`, không có bảng, không có migration, không có lịch sử phía máy chủ. Vì vậy ở đây CHỈ có:
 *   1. `layNoiDungSucKhoe` — nội dung THAM CHIẾU tĩnh (bộ câu khảo sát, khuôn lời khuyên, giới hạn, khoảng số đo). Không chứa dữ liệu sức khoẻ của ai.
 *   2. `danhGiaSucKhoe` — tính THUẦN, KHÔNG LƯU, KHÔNG GHI LOG: BMI + phân loại + khuôn + năng lượng ước tính từ số đo gửi lên, đúng các hàm của `so-cong.ts`.
 *      ⚠️ Việc gửi số đo lên máy chủ để tính (kể cả không lưu) trái LỜI của quyết định 08/11 — chưa được chủ dự án duyệt riêng (xem tài liệu SUC-KHOE-API-V823.md, câu hỏi 1).
 * Cờ `SUC_KHOE_ENABLED` TẮT (mặc định) ⇒ 404 như web. Không có lời khuyên / điểm / ngưỡng nào do tầng này tự đặt: mọi chữ lấy từ `khuon-ket-qua.ts` / `khao-sat-cong.ts`.
 */

const KHONG_LUU = { "Cache-Control": "no-store" } as const;

/** Cờ tắt ⇒ 404 (route gọi TRƯỚC khi đọc thân để cờ tắt luôn là 404 chứ không lộ 400). Trả null khi cờ bật. */
export function motSucKhoeTat(): NextResponse | null {
  return isSucKhoeEnabled() ? null : fail("NOT_FOUND", "Không tìm thấy.", { status: 404, headers: KHONG_LUU });
}

function chanNeuTat(): void {
  if (!isSucKhoeEnabled()) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
}

// ───────────────────────── 1. NỘI DUNG THAM CHIẾU ─────────────────────────

export type CauKhaoSatDto = {
  /** Vị trí trong bộ câu của nhóm (web lưu câu trả lời theo khoá này). */
  chiSo: number;
  maLinhVuc: string;
  nhanNhom: string;
  /** Có thể chứa `{ten}` — app thay bằng tên người đang trả lời. */
  cau: string;
  kieu: "MOT" | "NHIEU";
  luaChon: string[];
  ghiChu: string | null;
};
type KhoiGoiYDto = { tieuDe: string; tomTat: string; muc: Array<{ bieuTuong: string; noiDung: string }>; luuY: string | null; tuan: Array<{ thu: string; viec: string }> | null };
export type KhuonKetQuaDto = { giaiThich: string; loiChao: string; anUong: KhoiGoiYDto; vanDong: KhoiGoiYDto; nghiNgoi: KhoiGoiYDto; thuThach: string[] };

/**
 * Khoảng hợp lệ của số đo — NHÂN BẢN số trong `kiemBan` (`so-cong.ts`, không export). Lưới `[SKM-04]` đo lại bằng chính `kiemBan` ở đúng các biên ⇒ lệch là đỏ.
 * Chỉ để chặn gõ nhầm, KHÔNG phải ngưỡng chẩn đoán.
 */
export const KHOANG_SO_DO = {
  chieuCaoCm: { tu: 40, den: 230 },
  canNangKg: { tu: 2, den: 250 },
  vongEoCm: { tu: 30, den: 200 },
} as const;

export type NoiDungSucKhoeDto = {
  phienBan: 1;
  gioiHan: { toiDaNguoi: number; toiDaBanMoiNguoi: number; soCauThuThach: number };
  khoangSoDo: typeof KHOANG_SO_DO;
  hoatDong: readonly HoatDong[];
  gioiTinh: readonly ["nu", "nam"];
  khaoSat: { tre: CauKhaoSatDto[]; nguoiLon: CauKhaoSatDto[] };
  khuon: Record<TenKhuon, KhuonKetQuaDto>;
  /** Chép từ đầu `khao-sat-cong.ts` / `khuon-ket-qua.ts`: nội dung chưa qua thẩm định y khoa (chủ dự án chốt khuyến nghị đơn giản, 07/11/2026). */
  luuY: string;
  /** V8.39 — chính sách lưu trữ có chủ đích: app hiển thị (không hardcode) và so phiên bản để xin đồng ý lại. */
  luuTru: ThongTinLuuTru;
};

const LUU_Y_NOI_DUNG = "Nội dung tham khảo, chưa qua thẩm định y khoa (chủ dự án chốt khuyến nghị đơn giản, 07/11/2026). Không phải chẩn đoán hay chỉ định điều trị.";

const cauDto = (c: CauKhaoSat, chiSo: number): CauKhaoSatDto => ({
  chiSo,
  maLinhVuc: c[0],
  nhanNhom: c[1],
  cau: c[2],
  kieu: c[3] === 2 ? "NHIEU" : "MOT",
  luaChon: [...c[4]],
  ghiChu: c[5] === "" ? null : c[5],
});

const khoiDto = (k: KhoiGoiY): KhoiGoiYDto => ({
  tieuDe: k.tieuDe,
  tomTat: k.tomTat,
  muc: k.muc.map(([bieuTuong, noiDung]) => ({ bieuTuong, noiDung })),
  luuY: k.luuY ?? null,
  tuan: k.tuan ? k.tuan.map(([thu, viec]) => ({ thu, viec })) : null,
});

export function layNoiDungSucKhoe(): NoiDungSucKhoeDto {
  chanNeuTat();
  const khuon = {} as Record<TenKhuon, KhuonKetQuaDto>;
  for (const ten of Object.keys(KHUON_KET_QUA) as TenKhuon[]) {
    const k = KHUON_KET_QUA[ten];
    khuon[ten] = { giaiThich: k.giaiThich, loiChao: k.loiChao, anUong: khoiDto(k.anUong), vanDong: khoiDto(k.vanDong), nghiNgoi: khoiDto(k.nghiNgoi), thuThach: [...k.thuThach] };
  }
  return {
    phienBan: 1,
    gioiHan: { toiDaNguoi: TOI_DA_NGUOI_CONG, toiDaBanMoiNguoi: TOI_DA_BAN, soCauThuThach: SO_CAU_THU_THACH },
    khoangSoDo: KHOANG_SO_DO,
    hoatDong: ["it", "vua", "nhieu"],
    gioiTinh: ["nu", "nam"],
    khaoSat: { tre: KHAO_SAT_CONG.tre.map(cauDto), nguoiLon: KHAO_SAT_CONG.lon.map(cauDto) },
    khuon,
    luuY: LUU_Y_NOI_DUNG,
    luuTru: thongTinLuuTru(process.env),
  };
}

// ───────────────────────── 2. ĐÁNH GIÁ KHÔNG LƯU ─────────────────────────

/** Thông báo lỗi dựng sẵn: KHÔNG bao giờ chèn giá trị người dùng gửi (số đo của người nhà / trẻ nhỏ là dữ liệu nhạy cảm, không được lọt vào phản hồi lỗi hay log). */
const MSG = {
  chung: "Yêu cầu không hợp lệ.",
  la: "Có trường không được hỗ trợ.",
  ma: "Mã thành viên chỉ gồm chữ, số, gạch ngang hoặc gạch dưới, tối đa 40 ký tự.",
  maTrung: "Mã thành viên bị trùng.",
  ngaySinh: "Ngày sinh không hợp lệ (định dạng YYYY-MM-DD, không ở tương lai).",
  gioiTinh: "Giới tính phải là nu hoặc nam.",
  hoatDong: "Mức vận động phải là it, vua hoặc nhieu.",
  soNguoi: `Gửi từ 1 đến ${TOI_DA_NGUOI_CONG} người mỗi lần.`,
  soBan: `Mỗi người gửi từ 1 đến ${TOI_DA_BAN} bản số đo.`,
  so: "Số đo phải là số.",
} as const;

const LOI_BAN: Record<LoiBan, string> = {
  THIEU_NGAY: "Ngày đo không hợp lệ (định dạng YYYY-MM-DD).",
  NGAY_TUONG_LAI: "Ngày đo không được ở tương lai.",
  CAO_SAI: `Chiều cao ngoài khoảng ${KHOANG_SO_DO.chieuCaoCm.tu}–${KHOANG_SO_DO.chieuCaoCm.den} cm.`,
  NANG_SAI: `Cân nặng ngoài khoảng ${KHOANG_SO_DO.canNangKg.tu}–${KHOANG_SO_DO.canNangKg.den} kg.`,
  EO_SAI: `Vòng eo ngoài khoảng ${KHOANG_SO_DO.vongEoCm.tu}–${KHOANG_SO_DO.vongEoCm.den} cm.`,
};
const TRUONG_LOI_BAN: Record<LoiBan, "ngay" | "chieuCaoCm" | "canNangKg" | "vongEoCm"> = {
  THIEU_NGAY: "ngay",
  NGAY_TUONG_LAI: "ngay",
  CAO_SAI: "chieuCaoCm",
  NANG_SAI: "canNangKg",
  EO_SAI: "vongEoCm",
};

const loiChungCuaObject = (iss: { code: string }): string => (iss.code === "unrecognized_keys" ? MSG.la : MSG.chung);
const ngayChuoi = z
  .string({ error: MSG.chung })
  .regex(/^\d{4}-\d{2}-\d{2}$/, MSG.chung)
  .refine(laNgayHopLe, MSG.chung);
const soThuc = z.number({ error: MSG.so });

const soDoSchema = z.strictObject(
  { ngay: ngayChuoi, chieuCaoCm: soThuc, canNangKg: soThuc, vongEoCm: soThuc.nullable().optional() },
  { error: loiChungCuaObject },
);

const nguoiSchema = z.strictObject(
  {
    ma: z.string({ error: MSG.ma }).regex(/^[A-Za-z0-9_-]{1,40}$/, MSG.ma),
    ngaySinh: ngayChuoi,
    gioiTinh: z.enum(["nu", "nam"], { error: MSG.gioiTinh }),
    // Mặc định «vừa» và `false` = đúng giá trị khởi tạo của sổ ở web (`docNguoi` / biểu mẫu).
    hoatDong: z.enum(["it", "vua", "nhieu"], { error: MSG.hoatDong }).default("vua"),
    mangThaiHoacChoConBu: z.boolean({ error: MSG.chung }).default(false),
    benhNen: z.boolean({ error: MSG.chung }).default(false),
    soDo: z.array(soDoSchema, { error: MSG.soBan }).min(1, MSG.soBan).max(TOI_DA_BAN, MSG.soBan),
  },
  { error: loiChungCuaObject },
);

export const danhGiaSucKhoeSchema = z
  .strictObject({ nguoi: z.array(nguoiSchema, { error: MSG.soNguoi }).min(1, MSG.soNguoi).max(TOI_DA_NGUOI_CONG, MSG.soNguoi) }, { error: loiChungCuaObject })
  .superRefine((v, ctx) => {
    const homNay = layHomNay();
    const thay = new Set<string>();
    v.nguoi.forEach((n, i) => {
      if (thay.has(n.ma)) ctx.addIssue({ code: "custom", message: MSG.maTrung, path: ["nguoi", i, "ma"] });
      thay.add(n.ma);
      const thang = thangTuoi(n.ngaySinh, homNay);
      if (thang === null || thang < 0) ctx.addIssue({ code: "custom", message: MSG.ngaySinh, path: ["nguoi", i, "ngaySinh"] });
      n.soDo.forEach((b, j) => {
        // `kiemBan` là kiểm của web (cùng khoảng, cùng thứ tự); ở đây chỉ đổi mã lỗi thành câu KHÔNG chứa giá trị.
        const sai = kiemBan({ ngay: b.ngay, cao: b.chieuCaoCm, nang: b.canNangKg, eo: b.vongEoCm ?? null }, homNay);
        if (sai) ctx.addIssue({ code: "custom", message: LOI_BAN[sai], path: ["nguoi", i, "soDo", j, TRUONG_LOI_BAN[sai]] });
      });
    });
  });
export type DanhGiaSucKhoeBody = z.infer<typeof danhGiaSucKhoeSchema>;

export type NhomTuoi = "u5" | "c6" | "c12" | "nl" | "gia";
export type NguoiDanhGiaDto = {
  ma: string;
  tuoi: { thang: number; nhom: NhomTuoi; laTreEm: boolean };
  /** Cờ SAU chuẩn hoá như web: chỉ áp cho nữ người lớn (nam / trẻ em gửi `true` ⇒ trả `false`). */
  mangThaiHoacChoConBuApDung: boolean;
  /** Mới nhất đứng đầu (sắp theo ngày đo giảm dần). */
  soDo: Array<{ ngay: string; chieuCaoCm: number; canNangKg: number; vongEoCm: number | null; bmi: number }>;
  /** `ok` bình thường · `cy` nên chú ý · `chua` chưa đánh giá (trẻ em / mang thai — web cố ý KHÔNG phân loại, chưa có bảng chuẩn WHO). */
  phanLoaiBmi: { ma: "ok" | "cy" | "chua"; ten: string };
  /** Khoá vào `khuon` của `GET /parent/health/content`. */
  khuon: TenKhuon;
  nangLuongUocTinhKcal: number | null;
  soVoiBanTruoc: { ngayBanTruoc: string; chieuCaoCm: number; canNangKg: number } | null;
  /** Chỉ trẻ em có ≥ 2 bản (web: «Lớn thêm»). */
  lonThemTuBanDau: { ngayBanDau: string; cm: number } | null;
};
export type DanhGiaSucKhoeDto = { nguoi: NguoiDanhGiaDto[] };

/** Làm tròn 1 chữ số thập phân (đúng độ chính xác web hiển thị), không bao giờ trả -0. */
const lamTron1 = (x: number): number => {
  const v = Math.round(x * 10) / 10;
  return v === 0 ? 0 : v;
};

/**
 * Tính THUẦN từ số đo gửi lên: không DB, không ghi, không log. Ngày «hôm nay» = `layHomNay()` (container chạy TZ Asia/Ho_Chi_Minh; test đóng băng bằng `datHomNay`).
 * Mỗi người ≤ 3 bản, ≤ 6 người — giống giới hạn của sổ web.
 */
export function danhGiaSucKhoe(body: DanhGiaSucKhoeBody): DanhGiaSucKhoeDto {
  chanNeuTat();
  return {
    nguoi: body.nguoi.map((n) => {
      const thang = thangTuoi(n.ngaySinh) as number;
      const nhom = nhomTuoi(n.ngaySinh) as NhomTuoi;
      const tre = laTreEm(n.ngaySinh);
      // Chuẩn hoá như `vm.ts`: `mt && !laTreEm && gt === "nu"`.
      const mt = n.mangThaiHoacChoConBu && !tre && n.gioiTinh === "nu";
      const ban = [...n.soDo].sort((a, b) => (a.ngay < b.ngay ? 1 : a.ngay > b.ngay ? -1 : 0));
      const moi = ban[0]!;
      const truoc = ban[1];
      const dau = ban[ban.length - 1]!;
      const bmi = bmiCua({ cao: moi.chieuCaoCm, nang: moi.canNangKg });
      const nguoiSo = { ns: n.ngaySinh, gt: n.gioiTinh, hoatDong: n.hoatDong, mt, benhNen: n.benhNen };
      const pl = phanLoaiBmi(nguoiSo, bmi);
      return {
        ma: n.ma,
        tuoi: { thang, nhom, laTreEm: tre },
        mangThaiHoacChoConBuApDung: mt,
        soDo: ban.map((b) => ({ ngay: b.ngay, chieuCaoCm: b.chieuCaoCm, canNangKg: b.canNangKg, vongEoCm: b.vongEoCm ?? null, bmi: lamTron1(bmiCua({ cao: b.chieuCaoCm, nang: b.canNangKg })) })),
        phanLoaiBmi: { ma: pl.loai, ten: pl.ten },
        khuon: khuonCua(nguoiSo, bmi),
        nangLuongUocTinhKcal: nangLuongUocTinh(nguoiSo, { cao: moi.chieuCaoCm, nang: moi.canNangKg }),
        soVoiBanTruoc: truoc ? { ngayBanTruoc: truoc.ngay, chieuCaoCm: lamTron1(moi.chieuCaoCm - truoc.chieuCaoCm), canNangKg: lamTron1(moi.canNangKg - truoc.canNangKg) } : null,
        lonThemTuBanDau: tre && ban.length > 1 ? { ngayBanDau: dau.ngay, cm: lamTron1(moi.chieuCaoCm - dau.chieuCaoCm) } : null,
      };
    }),
  };
}
