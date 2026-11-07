// Loader (server) của các trang khoá học công khai: học phí + giáo trình.
// Học phí đi theo CÙNG thứ tự ưu tiên với trang chi tiết cũ để hai nơi không in hai con số:
// CoursePackage.priceOriginal (admin) → Course.price (admin /courses) → hằng courses-pricing.ts.
import { cache } from "react";
import { db } from "@/lib/db";
import {
  getCourseBySlug,
  ungVienSlugKhoa,
  getCoursePackageFromDb,
  getRoadmapCourseBySlug,
} from "@/components/legacy-laptrinhrobot/_data/courses-helpers";
import { resolveCoursePrice } from "@/lib/courses/pricing";
import { NOI_DUNG_KHOA, THU_TU_KHOA_NAM, THU_TU_KHOA_THI } from "./noi-dung-khoa";
import {
  dungHocPhan,
  giaBoKhamPha,
  tongBuoiCuaKhoa,
  type HocPhanHienThi,
} from "./khoa-hoc-thuan";
import type { KhoaNoiDung } from "./kieu";

export const TAT_CA_SLUG_KHOA = [...THU_TU_KHOA_NAM, ...THU_TU_KHOA_THI] as const;

/**
 * Học phí niêm yết trong bảng `Course` — CHÍNH slug của trang thắng các cách viết khác (`sata-3`).
 * Helper cũ `getCourseListPriceFromDb` chọn theo `orderBy slug asc`: "sata-3" đứng trước "sata3" nên ở DB có cả hai
 * (DB local có hàng demo `sata-1..4`) trang in nhầm giá của hàng demo. Prod chỉ có `sata1…` nên không lệch.
 */
const giaKhoaTrongDb = cache(async (slug: string): Promise<number | null> => {
  try {
    const hang = await db.course.findMany({ where: { slug: { in: ungVienSlugKhoa(slug) } }, select: { slug: true, price: true } });
    const chon = hang.find((h) => h.slug === slug.toLowerCase()) ?? hang.sort((a, b) => a.slug.localeCompare(b.slug))[0];
    return chon?.price && chon.price > 0 ? chon.price : null;
  } catch {
    return null;
  }
});

/** Học phí niêm yết (VND) của một khoá. null khi không có nguồn nào (không bịa). */
export const layGiaNiemYet = cache(async (slug: string): Promise<number | null> => {
  const hang = getCourseBySlug(slug);
  const [goi, giaDb] = await Promise.all([getCoursePackageFromDb(slug), giaKhoaTrongDb(slug)]);
  if (!hang && !giaDb && !goi?.priceOriginal) return null;
  const { listPrice } = resolveCoursePrice(goi, {
    listPrice: giaDb ?? hang?.listPrice ?? 0,
    earlyBirdPrice: hang?.earlyBirdPrice,
  });
  return listPrice > 0 ? listPrice : null;
});

/** Học phí của mọi khoá có trang (slug → VND). Khoá thiếu giá không có trong kết quả. */
export const layBangGia = cache(async (): Promise<Record<string, number>> => {
  const cap = await Promise.all(
    TAT_CA_SLUG_KHOA.map(async (s) => [s, await layGiaNiemYet(s)] as const),
  );
  const kq: Record<string, number> = {};
  for (const [s, g] of cap) if (g) kq[s] = g;
  return kq;
});

/** Học phần hiển thị (có tên bài) của một khoá. */
export function layHocPhan(nd: KhoaNoiDung): HocPhanHienThi[] {
  const gt = nd.loai === "nam" ? getRoadmapCourseBySlug(nd.slug) : null;
  return dungHocPhan(nd, gt);
}

/** Một khoá trong bộ khám phá lộ trình (đã mang giá). */
export type KhoaKhamPha = {
  slug: string;
  theoNam: boolean;
  ma: string;
  ten: string;
  lop: string;
  mau: string;
  thietBi: string;
  moTa: string;
  suMenh: string;
  kyNang: string[];
  anhBo: string;
  thuVien: string[];
  gia: string | null;
  donVi: string;
  ghiChu: string;
  uuDaiTieuDe: string;
  uuDai: string;
  maGiaoTrinh: string;
  phienBanGiaoTrinh: string;
  hocPhan: HocPhanHienThi[];
};

export function dungKhoaKhamPha(slug: string, giaNiemYet: number | null): KhoaKhamPha {
  const nd = NOI_DUNG_KHOA[slug];
  const hocPhan = layHocPhan(nd);
  const tong = tongBuoiCuaKhoa(hocPhan);
  const theoNam = nd.loai === "nam";
  const g = giaNiemYet ? giaBoKhamPha(slug, nd.loai, giaNiemYet, tong) : null;
  return {
    slug,
    theoNam,
    ma: nd.ma,
    ten: nd.ten,
    lop: nd.lop,
    mau: nd.mau,
    thietBi: nd.thietBi,
    moTa: nd.moTa,
    suMenh: nd.suMenh,
    kyNang: nd.kyNang,
    anhBo: nd.anhBo,
    thuVien: nd.thuVien,
    gia: g?.so ?? null,
    donVi: g?.donVi ?? "",
    ghiChu: g?.ghiChu ?? "",
    uuDaiTieuDe: theoNam ? "Hỗ trợ trả góp" : "Ưu đãi",
    uuDai: theoNam ? "Trả góp theo tháng cho Sata3 – Sata7" : "Combo Sata1 + Sata2 tiết kiệm 704.000đ",
    maGiaoTrinh: nd.maGiaoTrinh,
    phienBanGiaoTrinh: nd.phienBanGiaoTrinh,
    hocPhan,
  };
}
