// lib/finance/hoa-don/khoi-hoc-vien-noi-bo.ts — các dòng «Học viên (nội bộ)» in trên PHIẾU CHỜ của kế toán. THUẦN. 01/11/2026.
//
// Chủ dự án chốt 01/11/2026: tên · ngày sinh · CCCD học viên chỉ hiện trên phiếu chờ nội bộ (kế toán nhìn để nhập MISA), KHÔNG đẩy
// sang MISA (chưa có trường người mua nào đã kiểm chứng cho CCCD/ghi chú, và hoá đơn VAT gửi cơ quan thuế). Luật «chỉ bản chờ» nằm
// ở MỘT hàm này để tờ PDF và test cùng gọi: tờ chính thức (đã có số phiếu) đưa tận tay phụ huynh, không bao giờ được in khối này.

export type HocVienNoiBo = { ten: string | null; ngaySinh: string | null; cccd: string | null };

export function dongHocVienNoiBo(data: { maPhieu: string | null; hocVien?: HocVienNoiBo | null }): { nhan: string; giaTri: string }[] {
  if (data.maPhieu !== null || !data.hocVien) return [];
  const hv = data.hocVien;
  const ra: { nhan: string; giaTri: string }[] = [];
  if (hv.ten?.trim()) ra.push({ nhan: "Học viên (nội bộ)", giaTri: hv.ten.trim() });
  if (hv.ngaySinh?.trim()) ra.push({ nhan: "Ngày sinh học viên", giaTri: hv.ngaySinh.trim() });
  if (hv.cccd?.trim()) ra.push({ nhan: "CCCD học viên", giaTri: hv.cccd.trim() });
  return ra;
}
