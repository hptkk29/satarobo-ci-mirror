// lib/parttime/danh-sach-cong-viec-db.ts — dữ liệu của Lịch làm việc › Danh sách (site GV, từ 09/11/2026).
//
// Màn "Công việc của tôi" (`/teacher/phan-cong`) đã gỡ khỏi menu (chủ dự án 09/11/2026: Lịch + Bảng công đã đáp ứng); nội dung của nó
// dời vào Lịch › Danh sách. Đây là CHÍNH các lời gọi trang cũ dùng, gom về một chỗ để Lịch gọi một lần cho mọi view (dải "buổi cần xử
// lý" ở đầu Lịch hiện ở cả Tháng / Tuần) — không phép tính mới (luật 12b):
//   · phân công của CHÍNH mình (`docCongViecCuaToi`, userId từ PHIÊN — chỗ gọi truyền);
//   · bằng chứng chấm công P4 (`docBangChungCuaToi`) → nhãn `nhanBangChung`;
//   · tuân thủ buổi (`docTuanThu` + `docDichHoSo`) → `nhanTuanThu` + lối tắt `duongHoSo`;
//   · ca trực vận hành chờ nhận (`docTrucChoNhan`).
// Tab "Cần xử lý" = buổi đã qua mà hồ sơ buổi `NEEDS_REVIEW` (CÙNG trạng thái mà nhãn "Hồ sơ buổi chưa hoàn tất" đọc) — không luật mới.
import "server-only";
import { vnYmd } from "@/lib/time/vn";
import { docCongViecCuaToi, type PhanCongCuaToi } from "./bang-phan-cong";
import { chiaTab, SO_NGAY_DA_QUA, SO_NGAY_SAP_TOI } from "./cong-viec";
import { docBangChungCuaToi } from "./bang-chung-cong-db";
import { docTrucChoNhan } from "./truc-van-hanh-db";
import { nhanBangChung, type NhanBangChung } from "./nhan-bang-chung";
import { docDichHoSo, docTuanThu } from "./tuan-thu-buoi-db";
import { duongHoSo, nhanTuanThu, type NhanTuanThu } from "./nhan-tuan-thu";

export const MA_TAB_LICH = ["can-xac-nhan", "sap-toi", "hom-nay", "da-qua", "can-xu-ly", "doi-soat"] as const;
export type MaTabLich = (typeof MA_TAB_LICH)[number];
export const laMaTabLich = (x: string | undefined | null): x is MaTabLich => !!x && (MA_TAB_LICH as readonly string[]).includes(x);

export const NHAN_TAB_LICH: Record<MaTabLich, string> = {
  "can-xac-nhan": "Cần xác nhận",
  "sap-toi": "Sắp tới",
  "hom-nay": "Hôm nay",
  "da-qua": "Đã qua",
  "can-xu-ly": "Cần xử lý",
  "doi-soat": "Đối soát",
};

/** Hồ sơ buổi của CHÍNH mình (tuân thủ) + lối tắt sang đúng màn điểm danh / nhận xét đã có. */
export type HoSoCuaToi = { n: NhanTuanThu; canXuLy: boolean; diemDanh: string | null; nhanXet: string | null };

export type DanhSachCongViec = {
  homNay: string;
  tab: Record<MaTabLich, PhanCongCuaToi[]>;
  trucCho: Awaited<ReturnType<typeof docTrucChoNhan>>;
  hoSo: Map<string, HoSoCuaToi>;
  bangChung: Map<string, NhanBangChung>;
};

export async function docDanhSachCongViec(p: { userId: string; now: Date }): Promise<DanhSachCongViec> {
  const homNay = vnYmd(p.now);
  const tuNgay = new Date(new Date(`${homNay}T00:00:00Z`).getTime() - SO_NGAY_DA_QUA * 86_400_000).toISOString().slice(0, 10);
  const [ds, bangChung, trucCho] = await Promise.all([
    docCongViecCuaToi({ userId: p.userId, homNay, soNgayDaQua: SO_NGAY_DA_QUA, soNgaySapToi: SO_NGAY_SAP_TOI }),
    // Bằng chứng P4 của CHÍNH mình — tới hôm nay; buổi tương lai chưa có gì để chứng minh.
    docBangChungCuaToi({ userId: p.userId, tu: tuNgay, den: homNay, now: p.now }),
    // Trực vận hành TƯỜNG MINH đang chờ CHÍNH mình nhận (D-Q3).
    docTrucChoNhan({ userId: p.userId, now: p.now }),
  ]);
  const [tuanThu, dich] = await Promise.all([docTuanThu(bangChung, p.now), docDichHoSo(bangChung)]);
  const hoSo = new Map<string, HoSoCuaToi>();
  for (const [id, t] of tuanThu) {
    if (t.overallStatus === "NOT_STARTED" || t.overallStatus === "CANCELLED" || t.overallStatus === "POLICY_NOT_APPLICABLE") continue;
    const d = dich.get(id);
    hoSo.set(id, {
      n: nhanTuanThu(t),
      canXuLy: t.overallStatus === "NEEDS_REVIEW",
      diemDanh: d ? duongHoSo(d, "GIAO_VIEN", "diem-danh") : null,
      nhanXet: d ? duongHoSo(d, "GIAO_VIEN", "nhan-xet") : null,
    });
  }
  const nhan = new Map(
    bangChung.flatMap((r) => {
      const n = nhanBangChung(r);
      return n ? [[r.assignmentId, n] as const] : [];
    }),
  );
  const t = chiaTab(ds, homNay, p.userId);
  return {
    homNay,
    tab: { ...t, "can-xu-ly": t["da-qua"].filter((x) => hoSo.get(x.id)?.canXuLy === true) },
    trucCho,
    hoSo,
    bangChung: nhan,
  };
}
