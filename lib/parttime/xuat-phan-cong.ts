// lib/parttime/xuat-phan-cong.ts — XUẤT phân công GV (lưới phân công GV · PR5). THUẦN: dựng workbook 4 dạng từ dữ liệu màn lưới.
// Nguồn là đúng `LuoiTuan` mà màn "Phân công giáo viên" vẽ (luật 12b: không dựng lại số), cộng bằng chứng chấm công +
// tuân thủ buổi theo assignmentId. Tiền là DỰ KIẾN (`ke`) và ĐÃ XÁC NHẬN (`thucTe`) — công tắc tiền Parttime TẮT nên không có số chi.
//   A · LUOI_TUAN  — người × ca × ngày, "KẾ HOẠCH → THỰC TẾ", giống màn
//   B · CHI_TIET   — một dòng / một phân công dạy hoặc một dòng trực
//   C · DOI_SOAT   — một dòng / một ô có việc: mã + tiền kế hoạch vs thực tế, trạng thái đối soát
//   D · THU_NHAP   — một dòng / GV × cơ sở: tiền dự kiến theo loại + tổng thực tế
import ExcelJS from "exceljs";
import type { LuoiTuan } from "./luoi-tuan-db";
import type { OLuoi } from "./luoi-tuan-ghep";
import { NHAN_NGUON_DIEU_CHINH, lyDoHienThi, tomTatDieuChinh, type DieuChinh } from "./ly-do-dieu-chinh";
import type { TrucDaHuy } from "./ly-do-dieu-chinh-db";

export type CoSoXuat = {
  ma: string;
  luoi: LuoiTuan;
  /** assignmentId → nhãn bằng chứng chấm công. */
  bangChung: ReadonlyMap<string, string>;
  /** assignmentId → trạng thái tuân thủ tổng (`overallStatus`). */
  tuanThu: ReadonlyMap<string, string>;
  /** PR7: lý do điều chỉnh từ nguồn đã ghi (sửa buổi đã qua · đơn từ · nhật ký trực · chuyển đổi). BẮT BUỘC (luật 7). */
  dieuChinh: { theoId: ReadonlyMap<string, readonly DieuChinh[]>; trucDaHuy: readonly TrucDaHuy[] };
};

/** "dd/mm/yyyy HH:mm" giờ VN — tệp xuất không phụ thuộc múi giờ máy. */
const lucVn = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
};
const COT_DIEU_CHINH = ["Nguồn thay đổi", "Lý do điều chỉnh", "Người yêu cầu", "Người duyệt", "Thời điểm", "Trước → sau", "Mã tham chiếu"];
/** Bảy cột điều chỉnh của MỘT dòng; nhiều điều chỉnh ⇒ nối " | " theo cùng thứ tự ở mọi cột. */
export function cotDieuChinh(ds: readonly DieuChinh[]): string[] {
  const noi = (f: (d: DieuChinh) => string) => ds.map(f).join(" | ");
  return [
    noi((d) => NHAN_NGUON_DIEU_CHINH[d.nguon]),
    noi(lyDoHienThi),
    noi((d) => d.nguoiYeuCau ?? ""),
    noi((d) => d.nguoiDuyet ?? ""),
    noi((d) => lucVn(d.luc)),
    noi((d) => d.truocSau ?? ""),
    noi((d) => d.maThamChieu),
  ];
}

export type TrangThaiDoiSoat = "KHOP" | "LECH" | "CHUA_XAC_NHAN" | "CHINH_SACH_CU";
export type LocXuat = { userId: string | null; trangThai: TrangThaiDoiSoat | null };

const CA = ["S", "C", "T"] as const;
const NHAN_TT: Record<TrangThaiDoiSoat, string> = { KHOP: "Khớp", LECH: "Lệch", CHUA_XAC_NHAN: "Chưa xác nhận", CHINH_SACH_CU: "Chính sách cũ" };
const NHAN_LOAI: Record<string, string> = { REGULAR: "Lớp", MAKEUP: "Học bù", ADVANCE: "Học vượt", SUBSTITUTE: "Dạy thay", TRIAL: "Trial" };

export const maKeHoach = (o: OLuoi) => (o.ke ? `${o.ke.ma ?? ""}${o.ke.coTrial ? "+TR" : ""}` || "X" : "");

export function trangThaiDoiSoat(o: OLuoi): TrangThaiDoiSoat {
  if (!o.ke) return "CHINH_SACH_CU";
  if (!o.thucTe) return "CHUA_XAC_NHAN";
  return o.thucTe.ma === o.ke.ma && o.thucTe.tong === o.ke.tong ? "KHOP" : "LECH";
}

const coViec = (o: OLuoi) => o.hoatDong.length > 0 || o.trucId != null;

type O = { cs: CoSoXuat; dong: LuoiTuan["dong"][number]; ngay: string; ca: string; o: OLuoi };
function moiO(ds: readonly CoSoXuat[], loc: LocXuat): O[] {
  const ra: O[] = [];
  for (const cs of ds)
    for (const dong of cs.luoi.dong) {
      if (loc.userId && dong.userId !== loc.userId) continue;
      for (const ngay of cs.luoi.ngays)
        for (const ca of CA) {
          const o = dong.o[ngay]?.[ca];
          if (!o || !coViec(o)) continue;
          if (loc.trangThai && trangThaiDoiSoat(o) !== loc.trangThai) continue;
          ra.push({ cs, dong, ngay, ca, o });
        }
    }
  return ra;
}

const VIEN = { style: "thin" as const, color: { argb: "FFD0D0D0" } };
function bang(ws: ExcelJS.Worksheet, tieuDe: string, dau: string[], dong: (string | number | null)[][]) {
  ws.getCell("A1").value = tieuDe;
  ws.getCell("A1").font = { bold: true, size: 13 };
  const h = ws.getRow(3);
  dau.forEach((c, i) => {
    const o = h.getCell(i + 1);
    o.value = c;
    o.font = { bold: true };
    o.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    o.border = { top: VIEN, left: VIEN, bottom: VIEN, right: VIEN };
  });
  dong.forEach((d, k) => d.forEach((v, i) => (ws.getRow(4 + k).getCell(i + 1).value = v)));
  ws.views = [{ state: "frozen", ySplit: 3 }];
  dau.forEach((_, i) => (ws.getColumn(i + 1).width = 14));
}

export function dungFileXuat(p: { tu: string; den: string; coSo: readonly CoSoXuat[]; loc: LocXuat }): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const os = moiO(p.coSo, p.loc);
  const pham = `${p.coSo.map((c) => c.ma).join(", ")} · ${p.tu} → ${p.den}`;

  // A · Lưới tuần — giữ cả ngày không việc để hình giống màn
  const a = wb.addWorksheet("A_LUOI_TUAN");
  const dongA: (string | number | null)[][] = [];
  const ngays = p.coSo[0]?.luoi.ngays ?? [];
  for (const cs of p.coSo)
    for (const d of cs.luoi.dong) {
      if (p.loc.userId && d.userId !== p.loc.userId) continue;
      for (const ca of CA)
        dongA.push([
          ca === "S" ? cs.ma : "",
          ca === "S" ? `${d.ten}${d.laMuon ? ` (mượn · ${d.tenCoSoGoc ?? "?"})` : ""}` : "",
          ca,
          ...ngays.map((n) => {
            const o = d.o[n]?.[ca];
            if (!o || !coViec(o)) return o?.ke ? "X" : "";
            const tt = o.thucTe ? ` → ${o.thucTe.ma ?? "X"}` : "";
            return `${maKeHoach(o)}${tt}`;
          }),
          null,
        ]);
      dongA.push([null, "Tổng ngày (dự kiến)", null, ...ngays.map((n) => d.tongNgay[n] ?? 0), d.tongTuan]);
    }
  bang(a, `A · LƯỚI PHÂN CÔNG (KẾ HOẠCH → THỰC TẾ) · ${pham}`, ["Cơ sở", "Giáo viên", "Ca", ...ngays, "Tổng"], dongA);

  // B · Chi tiết theo dòng
  const b = wb.addWorksheet("B_CHI_TIET");
  const dongB: (string | number | null)[][] = [];
  for (const x of os) {
    const chung = [x.dong.tenCoSoGoc ?? "", x.cs.ma, x.dong.ten, x.dong.rankTheoNgay[x.ngay] ?? null, x.ngay, x.ca];
    const thucTe = x.o.thucTe?.ma ?? "";
    const xn = x.o.thucTe ? "Đã xác nhận" : "Chưa xác nhận";
    const canh = x.o.canhBao.join(", ");
    for (const h of x.o.hoatDong) {
      const tien = x.o.ke?.dong.filter((d) => d.nguon.includes(h.id) && d.loai !== "TRUC") ?? [];
      dongB.push([
        ...chung,
        h.sourceType,
        h.sourceId,
        NHAN_LOAI[h.loai] ?? h.loai,
        h.vai === "MAIN" ? "Đứng chính" : "Trợ giảng",
        `${h.gioBatDau}–${h.gioKetThuc}`,
        maKeHoach(x.o),
        thucTe,
        x.o.trucId ? "CÓ" : "",
        h.trial?.soCoMat ?? null,
        h.trial?.trangThai ?? "",
        x.cs.bangChung.get(h.id) ?? "",
        x.cs.tuanThu.get(h.id) ?? "",
        xn,
        tien.map((t) => t.donGia).join(" + ") || null,
        tien.reduce((s, t) => s + (t.thanhTien ?? 0), 0),
        canh,
        ...cotDieuChinh(x.cs.dieuChinh.theoId.get(h.id) ?? []),
      ]);
    }
    if (x.o.trucId) {
      const t = x.o.ke?.dong.filter((d) => d.loai === "TRUC") ?? [];
      dongB.push([
        ...chung, "OPERATIONS_DUTY", x.o.trucId, "Trực", "Trực vận hành", "", maKeHoach(x.o), thucTe, "CÓ", null, "", "", "", xn,
        t.map((d) => d.donGia).join(" + ") || null, t.reduce((s, d) => s + (d.thanhTien ?? 0), 0), canh,
        ...cotDieuChinh(x.cs.dieuChinh.theoId.get(x.o.trucId) ?? []),
      ]);
    }
  }
  // Dòng trực ĐÃ HUỶ (không còn trên lưới) — là lý do kế hoạch khác ban đầu; chỉ khi không lọc trạng thái đối soát (chúng không có ô).
  if (!p.loc.trangThai) {
    for (const cs of p.coSo)
      for (const t of cs.dieuChinh.trucDaHuy) {
        if (p.loc.userId && t.userId !== p.loc.userId) continue;
        dongB.push([
          "", cs.ma, t.ten, null, t.ngay, t.shiftCode, "OPERATIONS_DUTY", t.id, "Trực đã huỷ", "Trực vận hành", "", "", "", "ĐÃ HUỶ", null, "", "", "", "", null, 0, "",
          ...cotDieuChinh(t.dieuChinh),
        ]);
      }
  }
  bang(b, `B · CHI TIẾT PHÂN CÔNG · ${pham}`, [
    "Cơ sở gốc", "Cơ sở dùng", "Giáo viên", "Rank đúng ngày", "Ngày", "Ca", "Loại nguồn", "Mã buổi / case / trực", "Hoạt động", "Vai", "Giờ dạy",
    "Mã KẾ HOẠCH", "Mã THỰC TẾ", "Trực", "Trial có mặt", "Điều kiện Trial", "Bằng chứng chấm công", "Tuân thủ buổi", "Xác nhận công", "Đơn giá áp dụng", "Tiền dự kiến", "Vấn đề",
    ...COT_DIEU_CHINH,
  ], dongB);

  // C · Đối soát
  const c = wb.addWorksheet("C_DOI_SOAT");
  bang(c, `C · ĐỐI SOÁT KẾ HOẠCH / THỰC TẾ · ${pham}`, ["Cơ sở dùng", "Cơ sở gốc", "Giáo viên", "Ngày", "Ca", "Mã KẾ HOẠCH", "Mã THỰC TẾ", "Tiền kế hoạch", "Tiền thực tế", "Chênh", "Trạng thái", "Vấn đề", "Lý do điều chỉnh"], os.map((x) => {
    const ke = x.o.ke?.tong ?? null;
    const tt = x.o.thucTe?.tong ?? null;
    // Lý do của Ô = điều chỉnh của mọi việc trong ô + dòng trực đã huỷ cùng (người, ngày, ca). Không suy lý do từ việc kế hoạch ≠ thực tế.
    const ids = [...x.o.hoatDong.map((h) => h.id), ...(x.o.trucId ? [x.o.trucId] : [])];
    const ly = [
      ...ids.flatMap((id) => x.cs.dieuChinh.theoId.get(id) ?? []),
      ...x.cs.dieuChinh.trucDaHuy.filter((t) => t.userId === x.dong.userId && t.ngay === x.ngay && t.shiftCode === x.ca).flatMap((t) => t.dieuChinh),
    ];
    return [x.cs.ma, x.dong.tenCoSoGoc ?? "", x.dong.ten, x.ngay, x.ca, maKeHoach(x.o), x.o.thucTe?.ma ?? "", ke, tt, ke != null && tt != null ? tt - ke : null, NHAN_TT[trangThaiDoiSoat(x.o)], x.o.canhBao.join(", "), tomTatDieuChinh(ly)];
  }));

  // D · Thu nhập dự kiến theo GV × cơ sở
  const d = wb.addWorksheet("D_THU_NHAP");
  const gom = new Map<string, { cs: string; ten: string; goc: string; main: number; ta: number; truc: number; trial: number; ke: number; thucTe: number; o: number }>();
  for (const x of os) {
    const k = `${x.cs.ma}|${x.dong.userId}`;
    const g = gom.get(k) ?? { cs: x.cs.ma, ten: x.dong.ten, goc: x.dong.tenCoSoGoc ?? "", main: 0, ta: 0, truc: 0, trial: 0, ke: 0, thucTe: 0, o: 0 };
    for (const t of x.o.ke?.dong ?? []) {
      const v = t.thanhTien ?? 0;
      if (t.loai === "MAIN") g.main += v;
      else if (t.loai === "TA") g.ta += v;
      else if (t.loai === "TRUC") g.truc += v;
      else g.trial += v;
    }
    g.ke += x.o.ke?.tong ?? 0;
    g.thucTe += x.o.thucTe?.tong ?? 0;
    g.o += 1;
    gom.set(k, g);
  }
  bang(d, `D · THU NHẬP DỰ KIẾN (chưa chi — công tắc tiền Parttime TẮT) · ${pham}`, ["Cơ sở dùng", "Cơ sở gốc", "Giáo viên", "Số ô có việc", "Đứng chính", "Trợ giảng", "Trực", "Hỗ trợ Trial", "Tổng dự kiến", "Tổng đã xác nhận"], [...gom.values()].map((g) => [g.cs, g.goc, g.ten, g.o, g.main, g.ta, g.truc, g.trial, g.ke, g.thucTe]));

  return wb;
}
