// components/public/disc/bo-cau-hoi.ts — TÓM TẮT "mỗi người một bài hợp độ tuổi" cho trang giới thiệu DISC.
//
// HÀM THUẦN: nhận hàm `chonBoDe` của động cơ rồi trả các dòng của bảng "Bộ câu hỏi". Số câu, thang trả lời,
// "ba/mẹ trả lời hộ" đều ĐỌC TỪ ĐỘNG CƠ — KHÔNG gõ cứng ở giao diện (artifact ghi 20/24 câu; nếu bộ đề đổi,
// bảng tự đổi theo, không thành lời hứa sai). Trang `/disc` gọi nó ở server sau `ensureDiscEngine()`.
import type { BoDeDisc, DiscEngine } from "@/lib/disc/engine";

export type DongBoCauHoi = {
  /** Nhãn "Ai": "Bé mầm non, lớp 1–2" · "Lớp 3–5" · "Ba/mẹ hoặc người giám hộ". */
  nhan: string;
  /** Người lớn quan sát và trả lời hộ (bộ dành cho bé nhỏ). */
  nguoiLonTraLoiHo: boolean;
  soCau: number;
  soMuc: number;
  /** Nhãn hai đầu thang ("Hầu như không → Hầu như luôn"). null nếu bộ đề không khai thang. */
  nhanThang: string | null;
  /** Thang có mặt cười (bộ cho bé tự làm). */
  coMat: boolean;
};

const BAC_HOC = ["MN", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;

function dongTu(nhan: string, bo: BoDeDisc): DongBoCauHoi {
  const thang = bo.thang ?? [];
  const dau = thang[0]?.nhan;
  const cuoi = thang[thang.length - 1]?.nhan;
  return {
    nhan,
    nguoiLonTraLoiHo: bo.nguoiLonTraLoiHo,
    soCau: bo.cauHoi.length,
    soMuc: thang.length,
    nhanThang: dau && cuoi ? `${dau} → ${cuoi}` : null,
    coMat: thang.some((m) => Boolean(m.mat)),
  };
}

/** "Lớp 1–2", "Lớp 6–9", "Bé mầm non, lớp 1–2": gộp các bậc liên tiếp dùng CÙNG một bộ đề. */
function nhanNhom(bac: readonly string[]): string {
  const lop = bac.filter((b) => b !== "MN").map(Number);
  const coMN = bac.includes("MN");
  const phanLop = lop.length === 0 ? "" : lop.length === 1 ? `lớp ${lop[0]}` : `lớp ${lop[0]}–${lop[lop.length - 1]}`;
  if (coMN) return phanLop ? `Bé mầm non, ${phanLop}` : "Bé mầm non";
  return phanLop.charAt(0).toUpperCase() + phanLop.slice(1);
}

export function boCauHoiTheoDoTuoi(
  engine: Pick<DiscEngine, "chonBoDe">,
  namNay: number,
): DongBoCauHoi[] {
  const dong: DongBoCauHoi[] = [];
  let nhom: string[] = [];
  let boNhom: BoDeDisc | null = null;
  const chot = () => {
    if (boNhom && nhom.length) dong.push(dongTu(nhanNhom(nhom), boNhom));
    nhom = [];
    boNhom = null;
  };
  for (const bac of BAC_HOC) {
    // Năm sinh GIẢ ĐỊNH theo bậc chỉ để chọn bộ đề (không bao giờ hiển thị).
    const tuoi = bac === "MN" ? 5 : Number(bac) + 6;
    const bo = engine.chonBoDe({ vai: "HS", bacHoc: bac, namSinh: namNay - tuoi, namNay });
    if (!bo) {
      chot();
      continue;
    }
    if (boNhom && boNhom.ma !== bo.ma) chot();
    boNhom = bo;
    nhom.push(bac);
  }
  chot();
  const ph = engine.chonBoDe({ vai: "PH", namSinh: namNay - 38, namNay });
  if (ph) dong.push(dongTu("Ba/mẹ hoặc người giám hộ", ph));
  return dong;
}
