// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/core/bo-de/bam.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * BĂM NGÂN HÀNG CÂU HỎI — dùng chung giữa script sinh và test canh, để hai bên không
 * bao giờ tính khác nhau.
 *
 * 🔴 Vì sao cần: sửa nội dung một câu là ĐỔI Ý NGHĨA CỦA ĐIỂM SỐ. Bài làm hôm qua và
 * bài làm hôm nay không còn so được với nhau — nhưng "vùng lệch" vẫn sẽ tính, vẫn ra
 * một con số đầy thuyết phục, và sai. Băm biến luật "sửa câu thì tăng phiên bản" từ kỷ
 * luật con người thành thứ máy bắt được.
 *
 * Băm CẢ thang trả lời và câu dẫn, không chỉ nội dung câu: đổi nhãn "Thỉnh thoảng" thành
 * "Đôi khi" cũng là đổi thứ người ta đang trả lời.
 *
 * Thuộc TẦNG LÕI: không React, không DOM.
 */

import type { MaBoDe, NganHang } from "./kieu";

/**
 * Dựng chuỗi chuẩn tắc từ ngân hàng — thứ tự cố định, chuẩn hoá NFC, không phụ thuộc
 * thứ tự khoá của object.
 */
export function chuoiChuanTac(nganHang: NganHang): string {
  // Sắp khoá thay vì nhập MA_BO_DE: file này được cả `node` chạy thẳng (script sinh
  // checksum) lẫn bundler nạp. Chỉ giữ import KIỂU — kiểu bị xoá lúc chạy nên Node không
  // phải đi tìm file, và ta không cần đuôi ".ts" trong đường dẫn.
  const phan: string[] = [];
  const thuTuBo = (Object.keys(nganHang) as MaBoDe[]).sort();
  for (const ma of thuTuBo) {
    const bo = nganHang[ma];
    phan.push(
      [
        `BO:${bo.ma}`,
        `ten:${bo.ten}`,
        `thang:${bo.loaiThang}:${bo.mucToiDa}`,
        `nhan:${bo.thang.map((m) => `${m.giaTri}=${m.nhan}${m.mat ? `|${m.mat}` : ""}`).join(";")}`,
        `dan:${bo.cauDan}`,
        `manhinh:${bo.cauMoiMan}`,
      ].join("\n"),
    );
    for (const c of [...bo.cau].sort((a, b) => a.ma.localeCompare(b.ma))) {
      phan.push(
        `CAU:${c.ma}|${c.truc}|${c.dao ? "dao" : "thuan"}|${c.noiDung}|${(c.soiGuong ?? []).join(",")}`,
      );
    }
  }
  return phan.join("\n").normalize("NFC");
}

/** Băm SHA-256 dạng hex. Nhận hàm băm từ ngoài để phần lõi không phụ thuộc `node:crypto`. */
type HamBam = (chuoi: string) => string;

export function bamNganHang(nganHang: NganHang, bam: HamBam): string {
  return bam(chuoiChuanTac(nganHang));
}
