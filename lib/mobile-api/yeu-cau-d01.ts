// lib/mobile-api/yeu-cau-d01.ts — ghép nội dung + ngày mong muốn cho «Chuyển lớp» và «Chuyển cơ sở» (D01-CL / D01-CCS, chủ dự án chốt 19/11/2026). THUẦN, không DB.
//
// Chỉ TẠO YÊU CẦU: hàm ở đây không đổi lớp, không đổi cơ sở. `preferredDate` = NGÀY MUỐN BẮT ĐẦU (đầu ngày giờ VN) — cột sẵn có của `ParentRequest`, nhân viên đọc cùng với `content`.
// Khuôn chữ dùng lại `noiDungYeuCau` của web nên nhân viên đọc một kiểu chữ dù đơn đến từ web hay app.
import { noiDungYeuCau } from "@/lib/portal/yeu-cau-loai";
import { parseVnYmd, vnYmd } from "@/lib/time/vn";

export type DauVaoDoiLop = {
  ngayMongMuon?: readonly string[];
  khungGio?: readonly string[];
  tuNgay?: string;
  ghiChu?: string;
};

export type DauVaoDoiCoSo = DauVaoDoiLop & { tenCoSo: string; diaChiCoSo: string };

export type KetQuaGhep = { ok: true; content: string; preferredDate: Date | null } | { ok: false; loi: string };

/** Ngày muốn bắt đầu: không được ở quá khứ (so theo `YYYY-MM-DD` giờ VN), đúng dạng. */
function docTuNgay(tuNgay: string | undefined, homNay: string): { ok: true; ngay: Date | null } | { ok: false; loi: string } {
  if (!tuNgay) return { ok: true, ngay: null };
  const ngay = parseVnYmd(tuNgay);
  // `parseVnYmd` KHÔNG từ chối ngày không có thật (2026-13-45 tràn sang năm sau) ⇒ kiểm vòng tròn: đọc ra rồi in lại phải ra đúng chuỗi.
  if (!ngay || vnYmd(ngay) !== tuNgay) return { ok: false, loi: "Ngày chưa đúng dạng" };
  if (tuNgay < homNay) return { ok: false, loi: "Ngày muốn bắt đầu đã qua — ba mẹ chọn một ngày sắp tới nhé." };
  return { ok: true, ngay };
}

const dong = (nhan: string, ds: readonly string[] | undefined): string | false => !!ds && ds.length > 0 && `${nhan}: ${ds.join(", ")}.`;
const ngayDmy = (ymd: string): string => ymd.split("-").reverse().join("/");

export function ghepDoiLop(v: DauVaoDoiLop, homNay: string): KetQuaGhep {
  const ghiChu = v.ghiChu?.trim() ?? "";
  const coLua = (v.ngayMongMuon?.length ?? 0) > 0 || (v.khungGio?.length ?? 0) > 0;
  if (!coLua && ghiChu.length < 5) return { ok: false, loi: "Ba mẹ chọn ngày, khung giờ mong muốn hoặc ghi chú giúp nhé." };
  const t = docTuNgay(v.tuNgay, homNay);
  if (!t.ok) return t;
  return {
    ok: true,
    preferredDate: t.ngay,
    content: noiDungYeuCau([
      "Xin chuyển lớp.",
      dong("Ngày mong muốn", v.ngayMongMuon),
      dong("Khung giờ mong muốn", v.khungGio),
      v.tuNgay && `Muốn chuyển từ ngày ${ngayDmy(v.tuNgay)}.`,
      ghiChu && `Ghi chú: ${ghiChu}`,
    ]),
  };
}

export function ghepDoiCoSo(v: DauVaoDoiCoSo, homNay: string): KetQuaGhep {
  const t = docTuNgay(v.tuNgay, homNay);
  if (!t.ok) return t;
  const ghiChu = v.ghiChu?.trim() ?? "";
  return {
    ok: true,
    preferredDate: t.ngay,
    content: noiDungYeuCau([
      `Xin chuyển sang cơ sở ${v.tenCoSo} (${v.diaChiCoSo}).`,
      dong("Ngày học mong muốn ở cơ sở mới", v.ngayMongMuon),
      dong("Khung giờ mong muốn", v.khungGio),
      v.tuNgay && `Muốn chuyển từ ngày ${ngayDmy(v.tuNgay)}.`,
      ghiChu && `Ghi chú: ${ghiChu}`,
    ]),
  };
}
