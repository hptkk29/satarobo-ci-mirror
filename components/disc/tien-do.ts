/** Tính tiến độ hành trình — thuần. Hồ sơ = 1 bước, mỗi câu = 1 bước, màn lưu = 1 bước. */
import type { Buoc } from "./ban-nhap";

export const NHAN_BUOC: Record<Buoc, string> = {
  hoSo: "Nhà mình",
  phuHuynh: "Bài của ba/mẹ",
  hocSinh: "Bài của con",
  hoanThanh: "Lưu kết quả",
};

export function tinhTienDo(d: {
  buoc: Buoc;
  tongCauPH: number;
  tongCauHS: number;
  daTraLoiPH: number;
  daTraLoiHS: number;
}): { phanTram: number; daXong: number; tong: number } {
  const tong = 1 + d.tongCauPH + d.tongCauHS + 1;
  let daXong: number;
  if (d.buoc === "hoSo") daXong = 0;
  else if (d.buoc === "phuHuynh") daXong = 1 + Math.min(d.daTraLoiPH, d.tongCauPH);
  else if (d.buoc === "hocSinh") daXong = 1 + d.tongCauPH + Math.min(d.daTraLoiHS, d.tongCauHS);
  else daXong = tong - 1;
  const phanTram = tong <= 0 ? 0 : Math.round((daXong / tong) * 100);
  return { phanTram, daXong, tong };
}
