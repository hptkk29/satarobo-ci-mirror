// lib/parttime/mau-nhap-phan-cong.ts — FILE MẪU nhập phân công GV (lưới phân công GV · PR5). THUẦN: dựng workbook từ dữ liệu truyền vào.
// Bố cục theo file chủ dự án gửi 24/10/2026 (Mau_Import_Phan_Cong_Giao_Vien_Dong_Trial_Hoc_Bu_SR_QD_238.xlsx, 9 sheet) — chép lại
// bằng ExcelJS vì file gốc dùng namespace `x:` mà ExcelJS không đọc được. Khác bản gốc ở ba chỗ, đều có lý do:
//   · đơn giá trong MA_VA_GIA lấy từ CHÍNH SÁCH đang áp (`CompensationPolicyVersion`), không chép số cứng;
//   · danh sách cơ sở trong dropdown lấy từ DB (bản gốc ghi cứng CS1,CS2 — CLAUDE.md cấm cứng hoá danh sách cơ sở);
//   · thêm hai sheet tham khảo DS_GIAO_VIEN + DS_BUOI: SessionId là bắt buộc cho PHAN_CONG_TA mà QLCS không có chỗ nào khác để tra.
// Sheet NHAP_PHAN_CONG luôn TRỐNG dữ liệu (đề bài §26) — ví dụ chỉ nằm ở VI_DU.
import ExcelJS from "exceljs";
import type { ThamSoSrQd238 } from "./chinh-sach";
import { COT, THAO_TAC } from "./nhap-phan-cong";

export type DauVaoMauNhap = {
  tu: string;
  den: string;
  coSo: { ma: string; ten: string }[];
  thamSo: ThamSoSrQd238;
  /** Mức hỗ trợ Trial / HV có mặt đang áp (0 nếu chưa bật). */
  mucTrial: number;
  giaoVien: { maGV: string | null; ten: string; email: string | null; coSo: string[] }[];
  buoi: { sessionId: string; loai: string; coSo: string; ngay: string; ca: string | null; gio: string; lop: string; gvChinh: string; troGiang: string }[];
};

const VIEN = { style: "thin" as const, color: { argb: "FFD0D0D0" } };
const NEN_TIEU_DE = "FFEFEFEF";
const NEN_NHAP = "FFFFF2B3";
const SO_DONG_NHAP = 300;

function bang(ws: ExcelJS.Worksheet, tieuDe: string, ghiChu: string | null, dauCot: string[], dong: (string | number | null)[][], hangDau = ghiChu ? 4 : 3) {
  ws.getCell("A1").value = tieuDe;
  ws.getCell("A1").font = { bold: true, size: 13 };
  if (ghiChu) {
    ws.getCell("A2").value = ghiChu;
    ws.getCell("A2").font = { italic: true, color: { argb: "FF555555" } };
  }
  const h = ws.getRow(hangDau);
  dauCot.forEach((c, i) => {
    const o = h.getCell(i + 1);
    o.value = c;
    o.font = { bold: true };
    o.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEN_TIEU_DE } };
    o.border = { top: VIEN, left: VIEN, bottom: VIEN, right: VIEN };
  });
  dong.forEach((d, k) => {
    const r = ws.getRow(hangDau + 1 + k);
    d.forEach((v, i) => {
      const o = r.getCell(i + 1);
      o.value = v;
      o.border = { top: VIEN, left: VIEN, bottom: VIEN, right: VIEN };
      o.alignment = { vertical: "top", wrapText: true };
    });
  });
  ws.views = [{ state: "frozen", ySplit: hangDau }];
  return hangDau;
}

const rong = (ws: ExcelJS.Worksheet, w: number[]) => w.forEach((x, i) => (ws.getColumn(i + 1).width = x));

export function dungFileMauNhap(v: DauVaoMauNhap): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const g = v.thamSo.donGia;
  const r1 = g.mainTheoRank["1"] ?? 0;
  const ca = v.thamSo.ca;
  const moTaCa = ca.map((c) => `${c.ma}=${c.tu}–${c.den}`).join("; ");
  const maCoSo = v.coSo.map((c) => c.ma);

  // 1 · HUONG_DAN
  const hd = wb.addWorksheet("HUONG_DAN");
  bang(hd, "HƯỚNG DẪN QLCS – PHÂN CÔNG GV THEO CA / TRIAL / HỌC BÙ", "Lưu ý: file mẫu này chỉ nhập kế hoạch/đề nghị phân công; lịch dạy cố định và case Trial/Học bù lấy tự động từ hệ thống, không import lại bằng Excel.", ["Bước / lĩnh vực", "QLCS cần làm", "Hệ thống tự làm", "Được nhập trên Excel?", "Quy tắc / cảnh báo"], [
    ["1. Chọn cơ sở", `Chọn một trong: ${maCoSo.join(", ")}`, "Lọc GV theo cơ sở được quyền; cho mượn GV từ cơ sở khác", "CÓ", "Cơ sở dùng nhân sự khác cơ sở gốc; không đổi nơi công tác gốc"],
    ["2. Ca làm", "Lọc tuần/ngày, ca " + ca.map((c) => c.ma).join("/"), moTaCa, "CÓ", "Từ 15/10/2026 dùng SR.QD.238, trước đó legacy"],
    ["3. Lớp cố định", "Không nhập trùng", "Tự lấy buổi lớp theo lịch; giữ GV chính/trợ giảng mặc định", "KHÔNG", "Chỉ thay GV chính khi nghỉ/dạy thay được duyệt"],
    ["4. Trực vận hành", "Gán hoặc gỡ nhiệm vụ trực cho từng ca", "Tạo/huỷ dòng trực tường minh", "CÓ", "Không suy ca trực từ chấm công hay khoảng trống lịch"],
    ["5. Trợ giảng", "Phân công TA cho buổi có thật (SessionId ở sheet DS_BUOI)", "Kiểm buổi, lịch trùng, người thuộc cơ sở", "CÓ", "Không tự tạo buổi dạy mới"],
    ["6. Dạy thay", "Giáo viên gửi đơn đổi ca / đơn dạy thay; QLCS duyệt ở Đơn từ", "Đơn duyệt xong thì lưới tự đổi người đứng lớp", "KHÔNG ghi (dòng chỉ được đánh dấu CẦN DUYỆT)", "Dạy thay chỉ dựa vào đơn của giáo viên — Excel không tạo"],
    ["7. Học bù phát sinh", "Book/dời/huỷ ở module Học bù", "Tự cập nhật ca, vai, mã T/D/TD", "KHÔNG", "Không tạo case học bù từ Excel"],
    ["8. Trial phát sinh", "Book/dời/huỷ/điểm danh ở module Trial", "Tự cập nhật lớp phủ +TR", "KHÔNG", "Trial không phải tiết đứng chính; chỉ tính trên HV có mặt"],
    ["9. Rank", "QLCS đề xuất; Ban lãnh đạo duyệt (hồ sơ GV · màn Rank giáo viên)", "Lưu Rank theo hiệu lực; áp bảng giá đúng ngày buổi", "KHÔNG", Object.entries(g.mainTheoRank).map(([k, x]) => `R${k}=${x / 1000}k`).join("; ")],
    ["10. Trợ giảng", "Không nhập mức tiền", `Hệ thống dùng ${g.troGiang / 1000}k/tiết`, "KHÔNG", "SR.QD.238 không có TA theo Rank"],
    ["11. Chứng nhận Trial", "Phòng Đào tạo HO cấp/thu hồi", "Ghi hiệu lực từ/đến, người cấp", "KHÔNG", "QLCS không tự bật chứng nhận"],
    ["12. Hỗ trợ Trial", "HO/Kế toán duyệt chính sách có hiệu lực", "Bật + chứng nhận + phân công trước ca + HV có mặt ⇒ mức/HV", "KHÔNG", "Đổi công tắc không hồi tố"],
    ["13. Trả lương theo ca", "Không nhập tiền từ file", "Tính dự kiến/thực tế; lệch chuyển xem tay", "KHÔNG", "Công tắc tiền Parttime đang TẮT — chỉ xem trước"],
    ["14. Import", "Điền sheet NHAP_PHAN_CONG, tải lên, xem trước rồi xác nhận", "Kiểm quyền cơ sở, trùng ca, mã GV, buổi, kỳ công khoá, chạy lại không trùng", "CÓ", "Các hàng trong VI_DU tuyệt đối không dùng để import"],
    ["15. Export", "Lọc cơ sở/khoảng ngày rồi xuất", "Kế hoạch, thực tế, mã case, bằng chứng, lương dự kiến", "N/A", "Nhiều cơ sở chỉ khi có quyền"],
  ]);
  rong(hd, [22, 40, 48, 16, 52]);

  // 2 · MA_VA_GIA — đơn giá từ chính sách đang áp
  const mg = wb.addWorksheet("MA_VA_GIA");
  bang(mg, "MÃ HIỂN THỊ PHÂN CÔNG & ĐƠN GIÁ – PHÂN BIỆT KẾ HOẠCH VỚI THỰC TẾ", null, ["Mã hiển thị", "Nguồn tác vụ thật", "Tiết đứng chính", "Tiết trợ giảng", "Trực đang gán", "Hỗ trợ Trial", "Minh hoạ Rank 1 (đ)", "Lưu ý"], [
    ["X", "Không công việc", 0, 0, "NO", "NO", 0, "Chỉ khi không có buổi/trực; không dùng X để xoá lịch lớp"],
    ["D", "Buổi đứng chính (chính/bù/vượt/thay)", 1, 0, "NO", "NO", r1, "Không tự tạo từ mã D; dùng buổi thật"],
    ["T", "Dòng trực tường minh", 0, 0, "YES", "NO", g.trucCa, "Trực đủ ca khi không có tiết"],
    ["TG", "Buổi trợ giảng", 0, 1, "NO", "NO", g.troGiang, "TA cố định theo SR.QD.238"],
    ["TD", "1 tiết chính + trực", 1, 0, "YES", "NO", r1 + g.nuaCaTruc, "Nếu thực tế không trực thì thành D"],
    ["TTG", "1 tiết trợ giảng + trực", 0, 1, "YES", "NO", g.troGiang + g.nuaCaTruc, ""],
    ["D2", "2 tiết chính trong một ca", 2, 0, "NO/YES", "NO", 2 * r1, "Hai tiết đủ ⇒ 0 tiền trực"],
    ["D+TG", "1 tiết chính + 1 trợ giảng", 1, 1, "NO/YES", "NO", r1 + g.troGiang, "Hai tiết đủ ⇒ 0 tiền trực"],
    ["TG2", "2 tiết trợ giảng", 0, 2, "NO/YES", "NO", 2 * g.troGiang, "Hai tiết đủ ⇒ 0 tiền trực"],
    ["+TR", "Lớp phủ Trial", 0, 0, "GIỮ NGUYÊN", "YES", v.mucTrial, v.mucTrial ? "Ví dụ 1 HV có mặt + đủ chứng nhận + phân công trước ca" : "Hỗ trợ Trial đang TẮT"],
  ]);
  const hR = 17;
  bang(mg, "MÃ HIỂN THỊ PHÂN CÔNG & ĐƠN GIÁ – PHÂN BIỆT KẾ HOẠCH VỚI THỰC TẾ", null, ["Rank", "Tiết chính (đ)", "Tiết TA (đ)", "Trực / ca (đ)", "Nửa trực (đ)", "Trial / HV có mặt (đ)", "Nguồn"], Object.entries(g.mainTheoRank).map(([k, x]) => [`R${k}`, x, g.troGiang, g.trucCa, g.nuaCaTruc, v.mucTrial, "SR.QD.238"]), hR);
  mg.views = [{ state: "frozen", ySplit: 3 }];
  rong(mg, [10, 34, 14, 14, 14, 14, 18, 50]);

  // 3 · NHAP_PHAN_CONG — trống, ô vàng + dropdown
  const np = wb.addWorksheet("NHAP_PHAN_CONG");
  const hN = bang(np, "IMPORT CHỈ CÁC TÁC VỤ PHÂN CÔNG ĐƯỢC PHÉP – KHÔNG NHẬP TRIAL/HỌC BÙ", "Một dòng = một đề nghị thay đổi. Chỉ điền ô VÀNG từ hàng 5. Ví dụ ở sheet VI_DU — sheet này KHÔNG có dữ liệu mẫu để tránh import nhầm. Ngày gõ dạng YYYY-MM-DD.", [...COT], []);
  // Một luật cho cả DẢI (300 dòng) thay vì 300 luật lẻ. `dataValidations` có ở runtime ExcelJS nhưng thiếu trong khai báo kiểu.
  const dv = (np as unknown as { dataValidations: { add(range: string, v: ExcelJS.DataValidation): void } }).dataValidations;
  const ds = (cot: string, gt: string[]) =>
    dv.add(`${cot}${hN + 1}:${cot}${hN + SO_DONG_NHAP}`, { type: "list", allowBlank: true, formulae: [`"${gt.join(",")}"`], showErrorMessage: true, errorStyle: "stop" });
  ds("B", [...THAO_TAC]);
  ds("C", maCoSo);
  ds("E", ca.map((c) => c.ma));
  ds("H", ["MAIN", "TA", "OPS"]);
  ds("J", ["YES", "NO"]);
  for (let r = hN + 1; r <= hN + SO_DONG_NHAP; r++) {
    const row = np.getRow(r);
    for (let c = 1; c <= COT.length; c++) {
      const o = row.getCell(c);
      o.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEN_NHAP } };
      o.border = { top: VIEN, left: VIEN, bottom: VIEN, right: VIEN };
      o.numFmt = "@";
    }
  }
  rong(np, [24, 20, 12, 12, 8, 10, 24, 8, 28, 8, 14, 14, 30, 30, 12, 14]);

  // 4 · VI_DU — mô phỏng, KHÔNG import
  const vd = wb.addWorksheet("VI_DU");
  const cs = maCoSo[0] ?? "CS2";
  const csKhac = maCoSo[1] ?? cs;
  bang(vd, "VÍ DỤ MÔ PHỎNG – KHÔNG PHẢI DỮ LIỆU IMPORT", null, [...COT], [
    [`${cs}-20261027-S-OPS-01`, "GAN_TRUC", cs, "2026-10-27", "S", "GV001", "gv001@example.com", "OPS", "", "YES", "", csKhac, "Đã thống nhất mượn GV cơ sở khác", "GV trực", "", "MANUAL"],
    [`${cs}-20261028-C-TA-01`, "PHAN_CONG_TA", cs, "2026-10-28", "C", "GV002", "gv002@example.com", "TA", "SESSION_EXISTING_01", "", "", cs, "Bổ sung TA theo sĩ số", "Chỉ gán vào buổi có thật", "", "MANUAL"],
    [`${cs}-20261029-T-SUB-01`, "DE_NGHI_DAY_THAY", cs, "2026-10-29", "T", "GV003", "gv003@example.com", "MAIN", "SESSION_EXISTING_02", "", "GV004", cs, "GV chính có đơn nghỉ", "Chờ đơn dạy thay duyệt, không cập nhật trực tiếp", "", "WORK_REQUEST"],
    [`${cs}-20261030-C-OPS-02`, "HUY_TRUC", cs, "2026-10-30", "C", "GV001", "gv001@example.com", "OPS", "", "NO", "", csKhac, "Không còn phân công trực", "Không ảnh hưởng buổi dạy đang gán", "", "MANUAL"],
  ], 3);
  rong(vd, [24, 20, 12, 12, 8, 10, 24, 8, 22, 8, 14, 14, 30, 36, 12, 14]);

  // 5 · EVENT_TRIAL_BU
  const ev = wb.addWorksheet("EVENT_TRIAL_BU");
  bang(ev, "TRIAL / HỌC BÙ – SỰ KIỆN NGUỒN TỰ ĐỘNG THAY ĐỔI LƯỚI", null, ["Nguồn", "Sự kiện", "Lưới kế hoạch", "Lương dự kiến", "Sau điểm danh / thực tế"], [
    ["HỌC BÙ", "Đặt lịch", "Thêm tiết vào đúng ngày/ca theo case thật", "Còn trực + 1 tiết ⇒ TD dự kiến; không trực ⇒ D", "Chưa tự tính công khi mới đặt"],
    ["HỌC BÙ", "Dời lịch", "Gỡ khung cũ, gắn khung mới, không nhân đôi", "Tính lại cả hai ca", "Chưa tự trả công"],
    ["HỌC BÙ", "Huỷ", "Gỡ tiết còn sống, giữ lịch sử", "Không tính tiết cho case huỷ; trực giữ nguyên", "0 công bù nếu không có công đã xác nhận"],
    ["HỌC BÙ", "Hoàn tất có mặt", "Giữ bằng chứng đúng người", "Dự kiến chuyển thực tế sau xác nhận", "Chờ điểm danh, nhận xét và QLCS xác nhận"],
    ["TRIAL", "Đặt lịch", "Thêm lớp phủ +TR, không chiếm tiết chính", "Có trực ⇒ T+TR dự kiến", "Hỗ trợ chỉ sau chứng nhận + phân công trước ca + HV có mặt"],
    ["TRIAL", "Huỷ / không có bé", "Gỡ khỏi lớp phủ, không mất trực", "Hỗ trợ Trial = 0", "Không trả hỗ trợ khi case huỷ"],
    ["TRIAL", "Vắng hết", "Giữ điểm danh VẮNG", "Hỗ trợ Trial = 0", "Không coi thiếu điểm danh là vắng hết"],
    ["TRIAL", "Có mặt một phần", "Giữ case + trạng thái từng bé", "Mức × số HV có mặt nếu đủ điều kiện", "Không đếm một bé hai lần"],
    ["LỚP", "Dạy thay đã duyệt", "Giữ buổi, đổi người thực dạy", "Rank của người dạy thay theo ngày dạy", "Người dạy thực tế giữ công"],
    ["BẤT KỲ", "Sửa sau khi chốt kỳ", "Không sửa dữ kiện gốc", "Điều chỉnh sang kỳ sau được duyệt", "Kỳ đã chốt không ghi lại"],
  ], 3);
  rong(ev, [12, 20, 40, 40, 44]);

  // 6 · LUOI_TUAN — minh hoạ
  const lt = wb.addWorksheet("LUOI_TUAN");
  bang(lt, "MINH HOẠ GIAO DIỆN LƯỚI TUẦN – KHÔNG LÀ DỮ LIỆU LƯƠNG THẬT", "Mã được suy ra từ phân công/buổi/case thực tế, không nhập tay để tính lương. +TR là lớp phủ, không phải mã nền.", ["Giáo viên", "Ca/Thứ", "T2", "T3", "T4", "T5", "T6", "T7", "CN"], [
    ["GV ví dụ", "S", "X", "X", "D", "X", "T", "TD", "TD"],
    ["", "C", "X", "TG", "X", "X", "T", "T", "TD"],
    ["", "T", "D", "T", "D2", "X", "X", "T+TR", "D"],
  ]);
  rong(lt, [18, 10, 8, 8, 8, 8, 8, 8, 8]);

  // 7 · DOI_SOAT — mẫu cột của tệp xuất đối soát
  const dsoat = wb.addWorksheet("DOI_SOAT");
  bang(dsoat, "MẪU EXPORT / ĐỐI SOÁT – KẾ HOẠCH vs THỰC TẾ vs GIÁ TRỊ DỰ KIẾN", null, ["Cơ sở dùng", "Cơ sở gốc", "Ngày", "Ca", "GV", "Mã KẾ HOẠCH", "Mã THỰC TẾ", "Nguồn", "Chính/TG", "Đơn vị trực", "Trial có mặt", "Trạng thái", "Lý do / ghi chú"], [
    [cs, csKhac, "2026-10-27", "S", "GV001", "T", "TD", "MAKEUP_CASE …", "1 chính", 0.5, 0, "NEEDS_REVIEW", "Ca có buổi bù; chỉ TD nếu thực sự trực phần còn lại"],
    [cs, cs, "2026-10-28", "C", "GV002", "T+TR", "T+TR", "TRIAL_SESSION …", "0", 1, 1, "MATCH", "GV có chứng nhận + phân công trước ca"],
  ], 3);
  rong(dsoat, [10, 10, 12, 6, 10, 12, 12, 18, 10, 10, 10, 14, 50]);

  // 8 · RANK_TRIAL
  const rt = wb.addWorksheet("RANK_TRIAL");
  bang(rt, "QUẢN TRỊ RANK / CHỨNG NHẬN TRIAL / CÔNG TẮC HỖ TRỢ", null, ["Thiết lập", "Quyền chỉnh", "Hiệu lực", "Hành vi khi đổi", "Lưu ý"], [
    ["Rank (R1..R4)", "QLCS đề xuất; Ban lãnh đạo duyệt", "Theo ngày hiệu lực", "Áp đơn giá đúng ngày dạy; không sửa Rank quá khứ", "Không nhập qua Excel"],
    ["Đơn giá trợ giảng", "HO/Kế toán theo văn bản chính sách", "Phiên bản chính sách", `${g.troGiang / 1000}k cố định, không theo Rank`, "Đổi mức cần chính sách mới"],
    ["Chứng nhận Trial", "Phòng Đào tạo Hội sở", "Ngày cấp / thu hồi", "Xác định GV đủ điều kiện hỗ trợ Trial", "QLCS không nhập trong Excel"],
    ["Hỗ trợ Trial bật/tắt", "HO / Kế toán", "Theo cơ sở + ngày hiệu lực", "Bật: mức/HV có mặt nếu đủ điều kiện", "Không hồi tố; không đồng nghĩa bật trả lương"],
    ["Tiền Parttime bật/tắt", "Chủ dự án / HO", "Theo cơ sở", "Đang TẮT — chỉ xem trước", "Không tự bật khi làm import"],
  ], 3);
  rong(rt, [22, 32, 24, 40, 36]);

  // 9 · CHECKLIST
  const ck = wb.addWorksheet("CHECKLIST");
  bang(ck, "CHECKLIST IMPORT – CÁC BẤT BIẾN HỆ THỐNG KIỂM", null, ["#", "Luật", "Mã lỗi", "Kết quả"], [
    ["01", "Chỉ làm trên cơ sở có quyền", "CROSS_CENTER_RBAC", "Lỗi"],
    ["02", "Import không tạo lại buổi lớp / học bù / Trial", "DUPLICATE_SOURCE_OF_TRUTH", "Lỗi"],
    ["03", "Có SessionId hợp lệ cho TA", "SESSION_NOT_FOUND", "Lỗi"],
    ["04", "Không ghi trực từ mã T/TD nhập tự do", "NO_EXPLICIT_DUTY", "Lỗi"],
    ["05", "Không cấp chứng nhận Trial / đổi Rank qua import", "FORBIDDEN_POLICY_WRITE", "Lỗi"],
    ["06", "Chạy lại cùng dòng ra KHÔNG ĐỔI", "DUPLICATE_ASSIGNMENT", "Không đổi"],
    ["07", "Dạy thay chỉ từ đơn đổi ca / đơn dạy thay của GV; điều chỉnh quá khứ cần duyệt", "APPROVAL_REQUIRED", "Cần duyệt — không ghi"],
    ["08", "Ngày đã qua: bắt buộc lý do; kỳ công khoá thì không sửa", "CLOSED_PERIOD_MUTATION", "Lỗi"],
    ["11", "Không nhập tiền từ Excel", "IMPORTED_PAY_AMOUNT", "Lỗi"],
    ["13", "GV mượn cơ sở khác: không trùng trực toàn hệ thống", "CROSS_CENTER_OVERLAP", "Lỗi"],
  ], 3);
  rong(ck, [6, 56, 30, 14]);

  // 10 · DS_GIAO_VIEN + 11 · DS_BUOI — tham khảo cho QLCS
  const gv = wb.addWorksheet("DS_GIAO_VIEN");
  bang(gv, "GIÁO VIÊN TRONG PHẠM VI (tra MaGV / email)", null, ["MaGV", "Họ tên", "Email", "Cơ sở"], v.giaoVien.map((x) => [x.maGV ?? "(chưa có mã — dùng email)", x.ten, x.email ?? "", x.coSo.join(", ")]), 3);
  rong(gv, [14, 30, 32, 16]);
  const bu = wb.addWorksheet("DS_BUOI");
  bang(bu, `BUỔI TỪ ${v.tu} ĐẾN ${v.den} (tra SessionId cho PHAN_CONG_TA)`, null, ["SessionId", "Loại", "Cơ sở", "Ngày", "Ca", "Giờ", "Lớp / khoá", "GV chính", "Trợ giảng"], v.buoi.map((b) => [b.sessionId, b.loai, b.coSo, b.ngay, b.ca ?? "ngoài ca", b.gio, b.lop, b.gvChinh, b.troGiang]), 3);
  rong(bu, [28, 14, 8, 12, 8, 14, 30, 24, 24]);

  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 2, visibility: "visible" }];
  return wb;
}
