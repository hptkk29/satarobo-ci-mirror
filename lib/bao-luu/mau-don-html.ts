// lib/bao-luu/mau-don-html.ts — bản IN của "Đơn đăng ký bảo lưu khóa học" (SR.QD.236.002), dựng thành một tài liệu HTML
// tự đủ (không cần JS) để mở trong cửa sổ riêng rồi in / lưu PDF. Hàm thuần: chuỗi ra, test không cần DOM.
//
// ⚠️ ĐÂY LÀ BẢN CHÉP CHỮ của tệp .docx mẫu — chỗ DUY NHẤT chữ pháp lý nằm hai nơi. Chữ gốc là tệp .docx (công ty sửa ở
// đó). Lưới `[MD-PAR-*]` (`mau-don.test.ts`) đọc MỌI chữ trong .docx của từng cơ sở và đòi bản in này chứa đúng từng
// dòng — công ty sửa một chữ trong .docx mà quên sửa ở đây thì test đỏ, thay vì hai đầu ra lặng lẽ ghi hai nội dung.
import {
  MAU_DON,
  NHAN_O_TREN_DON,
  THU_TU_Y_DO,
  TIEU_DE_DANH_SACH_KHOA,
  coDanhSachKhoa,
  type DonBaoLuu,
  type MaMauDon,
} from "@/lib/bao-luu/mau-don";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** Bốn điều cam kết — đúng từng chữ như trong .docx. */
export const CAM_KET: readonly string[] = [
  "- Thời gian bảo lưu tối đa 03 tháng, được gia hạn 01 lần tối đa 01 tháng; mỗi khóa học chỉ được bảo lưu 01 lần. Không thu phí bảo lưu và phí học lại.",
  "- Học viên được giữ số buổi học còn lại và mức học phí đã đóng, nhưng không giữ chỗ trong lớp hiện tại. Khi học lại, Trung tâm xếp lớp phù hợp để học viên học tiếp từ buổi đã dừng.",
  "- Hết thời hạn bảo lưu, nếu tôi không phản hồi trong 07 ngày kể từ ngày Trung tâm gửi thông báo bằng văn bản, hoặc không làm thủ tục học lại/gia hạn, học viên được chuyển sang nghỉ học. Khi đó học phí còn lại không được hoàn trả; quà tặng, khóa học tặng kèm, sao tích lũy bị hủy và kit, quà tặng đã nhận phải hoàn trả.",
  "- Suất học đang bảo lưu không được chuyển nhượng cho người khác. Thiết bị đang thuê (nếu có) thực hiện theo hợp đồng thuê.",
];

const o = (nhan: string, giaTri: string) =>
  `<div class="o"><span class="nhan">${esc(nhan)}</span><span class="gt">${esc(giaTri)}</span></div>`;
const cap = (a: string, b: string) => `<div class="dong">${a}${b}</div>`;

/**
 * Tài liệu HTML của đơn. `logoUrl` là URL TUYỆT ĐỐI của logo (cửa sổ `about:blank` không phân giải được đường dẫn
 * tương đối). Giá trị người dùng nhập đi qua `esc` — tên phụ huynh/lý do là dữ liệu ngoài.
 */
export function dungDonHtml(don: DonBaoLuu, ma: MaMauDon, opts: { logoUrl: string }): string {
  const m = MAU_DON[ma];
  const h = m.dauTrang;
  const chon = new Set(don.lyDo);
  if (don.lyDoKhac.trim()) chon.add("OTHER");
  // Ô quá dài chỉ ghi "Xem danh sách khoá bên dưới"; danh sách đủ in ngay dưới mục II (cùng điều kiện với bản .docx).
  const dong = don.danhSachKhoa.map((d) => d.trim()).filter(Boolean);
  const khoiDs = coDanhSachKhoa(don)
    ? `<div class="ds-khoa"><p class="dam">${esc(TIEU_DE_DANH_SACH_KHOA)}</p>${dong.map((d, k) => `<p>${k + 1}. ${esc(d)}</p>`).join("")}</div>`
    : "";
  const tich = (ly: (typeof THU_TU_Y_DO)[number]) => `<span class="tich">${chon.has(ly) ? "☒" : "☐"}</span> ${esc(NHAN_O_TREN_DON[ly])}`;

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Đơn đăng ký bảo lưu khóa học — ${esc(don.hocVien.hoTen || "SR.QD.236.002")}</title>
<style>
  @page { size: A4 portrait; margin: 10mm 14mm; @bottom-right { content: "Trang " counter(page) "/" counter(pages); font: 10pt "Times New Roman", serif; } }
  * { box-sizing: border-box; }
  body { margin: 0; color: #000; font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.1; background: #e9e9e9; }
  .thanh { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: center; padding: 8px; background: #222; color: #fff; font: 13px system-ui, sans-serif; }
  .thanh button { font: inherit; padding: 6px 16px; border: 0; border-radius: 6px; background: #f97316; color: #fff; font-weight: 600; cursor: pointer; }
  .to { width: 210mm; min-height: 297mm; margin: 10px auto; padding: 12mm 14mm; background: #fff; }
  .dau { display: flex; gap: 10px; align-items: flex-start; border-bottom: 1px solid #000; padding-bottom: 3px; font-size: 10pt; line-height: 1.2; }
  .dau img { width: 38px; height: 38px; object-fit: contain; }
  .hai-cot { display: flex; justify-content: space-between; gap: 12px; margin-top: 6px; }
  .hai-cot > div { text-align: center; }
  .trai { width: 40%; } .phai { width: 60%; }
  b, .dam { font-weight: bold; }
  .nghieng { font-style: italic; }
  h1 { font-size: 15pt; text-align: center; margin: 10px 0 0; }
  .giua { text-align: center; margin: 2px 0 0; }
  h2 { font-size: 12pt; margin: 6px 0 1px; }
  .dong { display: flex; gap: 14px; margin-top: 2px; }
  .o { flex: 1 1 0; min-width: 0; display: flex; align-items: flex-end; gap: 4px; }
  .nhan { white-space: nowrap; }
  .gt { flex: 1 1 auto; min-width: 2em; border-bottom: 1px dotted #000; min-height: 1.25em; overflow-wrap: anywhere; }
  .y-do { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 14px; margin-top: 2px; }
  .tich { font-family: "Segoe UI Symbol", "Times New Roman", serif; }
  .ghi-chu { font-size: 11pt; margin: 2px 0 0; }
  .ds-khoa { margin-top: 2px; }
  .ds-khoa p { margin: 1px 0 0; padding-left: 14px; text-indent: -14px; }
  .ds-khoa p.dam { padding-left: 0; text-indent: 0; }
  /* Có danh sách khoá: lấy chỗ như bản .docx (mẫu gốc đầy đúng một trang) — danh sách 9pt, khoảng quanh tiêu đề mục thu lại. Chỗ ký GIỮ NGUYÊN. */
  .co-ds .ds-khoa { font-size: 9pt; }
  .co-ds { line-height: 1.04; }
  .co-ds h2 { margin: 1px 0 0; }
  .co-ds .dong, .co-ds .y-do { margin-top: 1px; }
  .co-ds .trung-tam { margin-top: 3px; }
  /* Không vừa một trang thì CẢ khối ký (cam kết + chữ ký + phần dành cho Trung tâm) sang trang sau, không tách ngang. */
  .khoi-ky { break-inside: avoid; }
  p { margin: 2px 0 0; }
  .cam-ket p { padding-left: 10px; text-indent: -8px; text-align: justify; }
  .ky { display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; margin-top: 4px; }
  .ky .tc { flex: 1; text-align: center; }
  .ky .tc div:last-child { height: 16mm; }
  .cam-doan { display: flex; justify-content: space-between; gap: 10px; margin-top: 4px; }
  .trung-tam { margin-top: 6px; padding-top: 4px; border-top: 1px dashed #000; break-inside: avoid; }
  .chan { margin-top: 6px; font-size: 10pt; }
  @media print {
    body { background: #fff; }
    .thanh { display: none; }
    .to { margin: 0; padding: 0; width: auto; min-height: 0; }
  }
</style></head><body>
<div class="thanh"><span>Kiểm tra đơn rồi bấm In. Chọn "Lưu dạng PDF" nếu muốn gửi qua Zalo.</span><button id="in-don" type="button">In đơn</button></div>
<div class="to${khoiDs ? " co-ds" : ""}">
  <div class="dau">
    <img src="${esc(opts.logoUrl)}" alt="">
    <div>
      <div>${esc(h.congTy)}   –   MST: ${esc(h.mst)}</div>
      <div>Địa chỉ: ${esc(h.diaChi)}</div>
      <div>Hotline: ${esc(h.hotline)}</div>
      <div>Email: ${esc(h.email)}</div>
    </div>
  </div>
  <div class="hai-cot">
    <div class="trai"><div class="dam">${esc(m.congTyHoa)}</div><div class="nghieng">Mẫu: SR.QD.236.002</div></div>
    <div class="phai"><div class="dam">CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM</div><div class="dam">Độc lập - Tự do - Hạnh phúc</div></div>
  </div>
  <h1>ĐƠN ĐĂNG KÝ BẢO LƯU KHÓA HỌC</h1>
  <p class="giua nghieng">(Ban hành kèm theo Quy chế bảo lưu học viên SR.QD.236)</p>
  <p class="giua"><b>Kính gửi: </b>${esc(m.congTyHoa)}</p>
  <p class="giua nghieng">${esc(m.trungTam)}</p>

  <h2>I. THÔNG TIN PHỤ HUYNH</h2>
  ${cap(o("Họ và tên:", don.phuHuynh.hoTen), o("Quan hệ với học viên:", don.phuHuynh.quanHe))}
  ${cap(o("Số điện thoại / Zalo:", don.phuHuynh.dienThoai), o("Email:", don.phuHuynh.email))}
  <h2>II. THÔNG TIN HỌC VIÊN</h2>
  ${cap(o("Họ và tên học viên:", don.hocVien.hoTen), o("Ngày sinh:", don.hocVien.ngaySinh))}
  ${cap(o("Mã học viên:", don.hocVien.ma), o("Khóa học:", don.hocVien.khoa))}
  ${cap(o("Lớp đang học:", don.hocVien.lop), o("Giáo viên phụ trách:", don.hocVien.giaoVien))}
  ${khoiDs}

  <h2>III. LÝ DO BẢO LƯU</h2>
  <div class="y-do"><div>${tich("ILLNESS")}</div><div>${tich("FAMILY")}</div><div>${tich("RELOCATION")}</div><div>${tich("SCHEDULE")}</div></div>
  <div class="dong"><div class="o"><span class="nhan">${tich("OTHER")}</span><span class="gt">${esc(don.lyDoKhac)}</span></div></div>
  <p class="ghi-chu nghieng">(*) Bảo lưu vì ốm đau trên 30 ngày cần nộp kèm giấy tờ y tế.</p>

  <h2>IV. THỜI GIAN ĐỀ NGHỊ BẢO LƯU</h2>
  ${cap(o("Bảo lưu từ ngày:", don.thoiGian.baoLuuTu), o("Dự kiến học lại (nếu có):", don.thoiGian.hocLaiDuKien))}
  <div class="dong">${o("Học viên đã nghỉ từ ngày (nếu bảo lưu lùi, tối đa 02 buổi):", don.thoiGian.nghiTuNgay)}</div>

  <div class="khoi-ky">
  <h2>V. CAM KẾT CỦA PHỤ HUYNH</h2>
  <div class="cam-ket">
    <p style="padding-left:0;text-indent:0">Tôi đã được Công ty giải thích và đồng ý với các điều kiện bảo lưu sau:</p>
    ${CAM_KET.map((c) => `<p>${esc(c)}</p>`).join("\n    ")}
  </div>
  <div class="cam-doan"><span>Tôi cam kết các thông tin trên là đúng sự thật.</span><span class="nghieng">Đà Nẵng, ngày …… tháng …… năm 20……</span></div>
  <div class="ky">
    <div class="tc"><div class="dam">PHỤ HUYNH</div><div class="nghieng">(Ký, ghi rõ họ tên)</div><div></div></div>
    <div class="tc"><div class="dam">NGƯỜI LẬP HỒ SƠ</div><div class="nghieng">(Ký, ghi rõ họ tên)</div><div></div></div>
    <div class="tc"><div class="dam">QUẢN LÝ TRUNG TÂM</div><div class="nghieng">(Duyệt, ký, ghi rõ họ tên)</div><div></div></div>
  </div>

  <div class="trung-tam">
    <p><b>PHẦN DÀNH CHO TRUNG TÂM</b>     Loại bảo lưu:  <span class="tich">☐</span> Do phụ huynh   <span class="tich">☐</span> Do Trung tâm</p>
    ${cap(o("Mã ghi danh:", ""), o("Ngày duyệt:", ""))}
    ${cap(o("Số buổi còn lại:", ""), o("Giá trị học phí còn lại:", ""))}
    ${cap(o("Hạn bảo lưu đến ngày:", ""), o("Công nợ quá hạn (số ngày):", ""))}
  </div>
  </div>
  <div class="chan">${esc(m.chanTrang)}</div>
</div>
</body></html>`;
}
