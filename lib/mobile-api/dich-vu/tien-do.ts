import { getChuyenCan, type ChuyenCan } from "@/lib/portal/chuyen-can";
import { getStudentFeedback, type FeedbackItem } from "@/lib/portal/feedback";
import { getHanhTrinh } from "@/lib/portal/hanh-trinh";
import { getTongQuan } from "@/lib/portal/tong-quan";
import { evalNotesProse } from "@/lib/lms/session-eval-rubric";
import { vnParts } from "@/lib/time/vn";

import { nhanNgay } from "../dinh-dang";
import type { MaHocVienDaKiem } from "../so-huu";

/**
 * `GET /students/:id/progress` — GỘP ba nguồn có sẵn của web (hành trình · chuyên cần · nhận xét) thành một phản hồi, không tính lại số nào:
 *   hanhTrinh  ← `getHanhTrinh().tomTat` (số buổi) + `getTongQuan().hanhTrinh.hocPhan` (học phần + ô tiến độ, cùng nguồn với Tổng quan)
 *   chuyenCan  ← `getChuyenCan()` (`so`, `ketLuan`, các ô buổi)
 *   nhanXet    ← `getStudentFeedback()` (nhận xét buổi mới nhất trước)
 *
 * Quy tắc không bịa: phần trăm chuyên cần là `so.tiLe` của web (mẫu số 0 ⇒ `null`, KHÔNG tự đặt 0%/100%).
 * Các kiểu ô buổi mà hợp đồng app chưa có đổi bảo thủ: `xep` (đã xếp lịch bù) ⇒ `cho`; `ke` (buổi kế tiếp) ⇒ `sap`; `ngoai` (ngoài gói) ⇒ BỎ khỏi danh sách.
 * Bỏ: nút / đường dẫn web, điểm, bài về, sản phẩm, phiếu, lượt bù, năng lực (chưa có quyết định đưa lên app).
 */
export type KieuODto = "co" | "bu" | "cho" | "vang" | "chua-cham" | "sap" | "huy";
export type OBuoiDto = { id: string; n: number; kieu: KieuODto; ten: string; ngay: string };

/** V8.24 (BR-HT-01): «mốc lớn» (buổi cuối học phần, chưa diễn ra) và «tuần này / buổi kế tiếp» — lấy NGUYÊN từ hàm hành trình của web (`getHanhTrinh`), không tính lại. Chỉ chữ hiển thị. */
export type MocLonDto = { nhan: string; tieuDe: string; ngay: string };
export type TuanNayDto = { nhan: string; tieuDe: string; dong: string };

export type TienDoDto = {
  tenKhoa: string | null;
  tenLop: string | null;
  /** null khi không còn mốc lớn phía trước / chưa có buổi kế tiếp. */
  moc: MocLonDto | null;
  tuanNay: TuanNayDto | null;
  hanhTrinh: {
    daHoc: number;
    tong: number;
    conLai: number;
    hocPhan: Array<{ ma: string; ten: string; tong: number; daHoc: number; ong: Array<"xong" | "tiep" | "chua"> }>;
  };
  chuyenCan: {
    coMat: number;
    mauSo: number;
    phanTram: number | null;
    choBu: number;
    vangKhongBu: number;
    ketLuan: { tieuDe: string; giaiThich: string; sac: "tot" | "canh-bao" };
    ganDay: OBuoiDto[];
  };
  nhanXet: Array<{
    id: string;
    n: number;
    ngay: string;
    ten: string;
    giaoVien: string | null;
    chung: Array<{ nhan: string | null; text: string }>;
    moi: boolean;
  }>;
};

const KIEU: Record<string, KieuODto | null> = { co: "co", bu: "bu", cho: "cho", xep: "cho", vang: "vang", "chua-cham": "chua-cham", ke: "sap", sap: "sap", huy: "huy", ngoai: null };
const SO_O_GAN_DAY = 8;
const NGAY_MOI = 14;

export function doiChuyenCan(c: ChuyenCan): TienDoDto["chuyenCan"] {
  const o: OBuoiDto[] = [];
  for (const h of c.hang) {
    for (const x of h.o) {
      const k = KIEU[x.kieu] ?? null;
      if (k) o.push({ id: x.id, n: x.n, kieu: k, ten: x.ten, ngay: x.ngay });
    }
  }
  const daDienRa = o.filter((x) => x.kieu !== "sap").sort((a, b) => a.n - b.n);
  return {
    coMat: c.so.coMat,
    mauSo: c.so.tiLe?.mauSo ?? 0,
    phanTram: c.so.tiLe?.phanTram ?? null,
    choBu: c.so.choBu,
    vangKhongBu: c.so.vangKhongBu,
    ketLuan: { tieuDe: c.ketLuan.tieuDe, giaiThich: c.ketLuan.giaiThich, sac: c.ketLuan.sac },
    ganDay: daDienRa.slice(-SO_O_GAN_DAY),
  };
}

export function doiNhanXet(f: FeedbackItem, now: Date): TienDoDto["nhanXet"][number] {
  const loi = evalNotesProse(f.notes);
  const chung: Array<{ nhan: string | null; text: string }> =
    loi?.kind === "overall"
      ? [{ nhan: null, text: loi.text }]
      : loi?.kind === "legacy"
        ? loi.rows.map((r) => ({ nhan: r.label, text: r.text }))
        : f.comment.trim()
          ? [{ nhan: null, text: f.comment.trim() }]
          : [];
  const t = Date.parse(f.chamLucISO || f.dateISO);
  return {
    id: f.id,
    n: f.order ?? 0,
    ngay: nhanNgay(f.dateISO),
    ten: f.title,
    giaoVien: f.teacher,
    chung,
    moi: Number.isFinite(t) && now.getTime() - t <= NGAY_MOI * 86_400_000,
  };
}

export async function layTienDo(hocVienId: MaHocVienDaKiem, parentUserId: string, now: Date = new Date()): Promise<TienDoDto> {
  const p = vnParts(now);
  const [ht, cc, fb, tq] = await Promise.all([
    getHanhTrinh(hocVienId, { y: p.year, m0: p.month }, now),
    getChuyenCan(hocVienId, now),
    getStudentFeedback(hocVienId, 20),
    getTongQuan(hocVienId, parentUserId, now),
  ]);
  return {
    tenKhoa: ht.tenKhoa,
    tenLop: ht.tenLop,
    moc: ht.moc ? { nhan: ht.moc.nhan, tieuDe: ht.moc.tieuDe, ngay: ht.moc.ngay } : null,
    tuanNay: ht.tuanNay ? { nhan: ht.tuanNay.nhan, tieuDe: ht.tuanNay.tieuDe, dong: ht.tuanNay.dong } : null,
    hanhTrinh: {
      daHoc: ht.tomTat.daHoc,
      tong: ht.tomTat.tong,
      conLai: ht.tomTat.conLai,
      hocPhan: tq.hanhTrinh.hocPhan.map((h) => ({ ma: h.ma, ten: h.ten, tong: h.tong, daHoc: h.daHoc, ong: [...h.ong] })),
    },
    chuyenCan: doiChuyenCan(cc),
    nhanXet: fb.map((f) => doiNhanXet(f, now)),
  };
}
