// lib/phan-cong/chi-tiet-buoi-db.ts — CHI TIẾT BUỔI cho panel màn Phân công gộp (GĐ7). CHỈ ĐỌC.
// Đưa những gì trước đây CHỈ có ở "Bảng theo buổi" (`?xem=buoi`) vào panel, bằng CHÍNH các hàm đọc của bảng đó — không engine thứ hai:
//   · bằng chứng chấm công          → `docBangChungCong` + `nhanBangChung`       (khoá: id phân công)
//   · tuân thủ buổi dạy             → `DongDoiSoat.tuanThu` + `nhanTuanThu`       (khoá: id phân công đứng chính)
//   · xác nhận (CONFIRMED)          → `docDoiSoatThucHien` + `nhanXacNhanBuoi`    (rẽ theo luật kỳ)
//   · sửa buổi đã qua               → `laBuoiDaQua` + `loiSuaBuoiDaQua` + `docKyDaChot` (cùng hàm action dùng)
//   · nhật ký sửa / lịch sử         → đã có trong `BuoiTrongTuan` (`docTuanPhanCong`)
//   · có mặt ngoài phân công        → `bc.luotKhongGan`
// Bằng chứng đọc MỘT lần rồi truyền cho đối soát (`docDoiSoatThucHien({ bc })`). Mọi câu tra trong một lô `Promise.all` ([DST-01]).
import "server-only";
import { docBangChungCong } from "@/lib/parttime/bang-chung-cong-db";
import type { LuotKhongGan } from "@/lib/parttime/bang-chung-cong";
import type { BuoiTrongTuan, DongPhanCong } from "@/lib/parttime/bang-phan-cong";
import { nhanBangChung, type NhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import { nhanTuanThu, type NhanTuanThu } from "@/lib/parttime/nhan-tuan-thu";
import { laBuoiDaQua, loiSuaBuoiDaQua } from "@/lib/parttime/sua-buoi-da-qua";
import { docKyDaChot, type DongNhatKySua } from "@/lib/parttime/sua-buoi-da-qua-db";
import { docDoiSoatThucHien } from "@/lib/parttime/workunit-db";
import { luatNgay } from "./cong-o";
import { docKyLuatMoi } from "./ky-luat-db";
import { nhanXacNhanBuoi, type NhanXacNhanBuoi } from "./chi-tiet-buoi";

export type ChiTietBuoi = {
  tinhTrang: BuoiTrongTuan["tinhTrang"];
  lyDoDong: string | null;
  apDung: boolean;
  /** Buổi đã qua (cùng vị từ với "Sửa buổi đã qua"): ô giao / gỡ thường không còn áp. */
  daQua: boolean;
  /** null = buổi chưa qua. `loi` = vì sao không sửa được (null = sửa được) — CÙNG hàm `suaBuoiDaQuaAction` dùng. */
  suaQua: { loi: string | null } | null;
  main: DongPhanCong | null;
  ta: DongPhanCong | null;
  /** Người được quy công dạy (buổi lớp) — so với kế hoạch để thấy dạy thay / lệch. */
  nguoiDungLop: string | null;
  lichSu: DongPhanCong[];
  nhatKySua: DongNhatKySua[];
  /** Thực tế: bằng chứng chấm công theo id phân công. */
  bangChung: Record<string, NhanBangChung>;
  /** Tuân thủ buổi dạy của người đứng chính (null = chưa tới giờ / huỷ / ngoài SR.QD.238). */
  hoSo: NhanTuanThu | null;
  /** Xác nhận theo id phân công. */
  xacNhan: Record<string, NhanXacNhanBuoi>;
};

const BO_HO_SO = new Set(["NOT_STARTED", "CANCELLED", "POLICY_NOT_APPLICABLE"]);

export async function docChiTietBuoiGop(p: {
  centerId: string;
  tu: string;
  den: string;
  now: Date;
  homNay: string;
  /** Buổi ĐÃ ĐỌC bằng `docTuanPhanCong` (cùng lượt đọc của lưới — không đọc lại). */
  buoi: readonly BuoiTrongTuan[];
}): Promise<{ chiTiet: Record<string, ChiTietBuoi>; luotKhongGan: LuotKhongGan[] }> {
  const thang = [...new Set([p.tu.slice(0, 7), p.den.slice(0, 7)])];
  const bc = await docBangChungCong({ centerId: p.centerId, tu: p.tu, den: p.den, now: p.now });
  const [doiSoat, kyDaChot, tuKy] = await Promise.all([
    docDoiSoatThucHien({ centerId: p.centerId, tu: p.tu, den: p.den, now: p.now, bc }),
    docKyDaChot(p.centerId, thang),
    docKyLuatMoi(),
  ]);

  const nhanBc: Record<string, NhanBangChung> = {};
  for (const r of bc.phanCong) {
    const n = nhanBangChung(r);
    if (n) nhanBc[r.assignmentId] = n;
  }
  const dsTheoPc = new Map(doiSoat.dong.map((d) => [d.bc.assignmentId, d]));

  const chiTiet: Record<string, ChiTietBuoi> = {};
  for (const b of p.buoi) {
    const pcs = [b.main, b.ta].filter((x): x is DongPhanCong => !!x);
    const luat = luatNgay(b.ngay, tuKy);
    const xacNhan: Record<string, NhanXacNhanBuoi> = {};
    for (const pc of pcs) {
      const d = dsTheoPc.get(pc.id);
      if (!d) continue; // phân công không vào đối soát (vai không sinh đơn vị / buổi ngoài SR.QD.238) — không bịa trạng thái
      xacNhan[pc.id] = nhanXacNhanBuoi({
        luat,
        quyetDinh: d.xacNhan?.decision ?? null,
        lyDo: d.xacNhan?.reason ?? null,
        donVi: d.donVi?.hieuLuc ?? null,
        kyKhoa: d.kyKhoa,
      });
    }
    const tt = b.main ? dsTheoPc.get(b.main.id)?.tuanThu : null;
    const daQua = laBuoiDaQua(b, p.homNay);
    chiTiet[b.key] = {
      tinhTrang: b.tinhTrang,
      lyDoDong: b.lyDoDong,
      apDung: b.apDung,
      daQua,
      suaQua: daQua
        ? { loi: loiSuaBuoiDaQua({ ngay: b.ngay, homNay: p.homNay, tinhTrang: b.tinhTrang, apDung: b.apDung, kyDaChot: kyDaChot.has(b.ngay.slice(0, 7)), lyDo: null }) }
        : null,
      main: b.main,
      ta: b.ta,
      nguoiDungLop: b.nguoiDungLop,
      lichSu: b.lichSu,
      nhatKySua: b.nhatKySua,
      bangChung: Object.fromEntries(pcs.flatMap((pc) => (nhanBc[pc.id] ? [[pc.id, nhanBc[pc.id]!]] : []))),
      hoSo: tt && !BO_HO_SO.has(tt.overallStatus) ? nhanTuanThu(tt) : null,
      xacNhan,
    };
  }
  return { chiTiet, luotKhongGan: bc.luotKhongGan };
}
