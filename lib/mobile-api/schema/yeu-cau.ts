import { z } from "zod";

import { CHU_DE_KHAC, KHUNG_GIO_MONG_MUON, LY_DO_BAO_LUU } from "@/lib/portal/yeu-cau-loai";
import { lyDoBaoNghi } from "@/lib/portal/hoc-bu-thuan";

/**
 * `POST /students/:id/requests` (B4.8) — MỘT cửa gửi yêu cầu cho cả sáu loại của cổng phụ huynh web (`/portal/yeu-cau/<loại>`).
 *
 * App gửi **dữ liệu có cấu trúc**, KHÔNG gửi câu chữ: máy chủ tự ghép cột `content` bằng đúng các hàm của web (`noiDungYeuCau`, `noiDungBaoNghi`), từ đúng các danh sách lựa chọn của web
 * (`LY_DO_BAO_LUU`, `CHU_DE_KHAC`, `KHUNG_GIO_MONG_MUON`, `lyDoBaoNghi`). Nhờ vậy nhân viên đọc cùng một khuôn chữ dù yêu cầu đến từ web hay từ app, và app không thể gửi một loại / trạng thái
 * mà web không có. Lựa chọn nằm ngoài danh sách ⇒ 400 (không cho chữ tự do chen vào trường chọn sẵn).
 */
const id = z.string().min(1).max(64);
const ghiChu = z.string().trim().max(500).optional();
const ngayYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày chưa đúng dạng");
const gioHm = z.string().regex(/^\d{2}:\d{2}$/, "Giờ chưa đúng dạng");

const lyDoNghi = z.enum(lyDoBaoNghi as unknown as [string, ...string[]]);
const lyDoLuu = z.enum(LY_DO_BAO_LUU as unknown as [string, ...string[]]);
const chuDe = z.enum(CHU_DE_KHAC as unknown as [string, ...string[]]);
const khungGio = z.enum(KHUNG_GIO_MONG_MUON as unknown as [string, ...string[]]);

/**
 * D01-CL / D01-CCS (chủ dự án chốt 19/11/2026): chuyển lớp và chuyển cơ sở cho phụ huynh chọn NHIỀU ngày mong muốn trong tuần + khung giờ + ngày muốn bắt đầu + ghi chú.
 * Danh sách ngày là của thiết kế (`P-YC-Chuyen-lop`, `P-YC-Chuyen-cs`: Thứ Ba … Chủ nhật — trung tâm nghỉ Thứ Hai); máy chủ trả lại cho app trong `tuyChon.ngayTrongTuan`
 * để app không gõ cứng. Chỉ TẠO YÊU CẦU: không có đường nào ở đây đổi lớp / đổi cơ sở (trung tâm duyệt rồi mới làm theo quy trình hiện hành).
 */
export const NGAY_TRONG_TUAN_MONG_MUON = ["Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"] as const;
const ngayTrongTuan = z.enum(NGAY_TRONG_TUAN_MONG_MUON);
const dsNgayTrongTuan = z.array(ngayTrongTuan).max(NGAY_TRONG_TUAN_MONG_MUON.length).refine((a) => new Set(a).size === a.length, "Ngày mong muốn bị lặp").optional();
const dsKhungGio = z.array(khungGio).max(KHUNG_GIO_MONG_MUON.length).refine((a) => new Set(a).size === a.length, "Khung giờ bị lặp").optional();

export const guiYeuCauSchema = z.discriminatedUnion("loai", [
  z.object({ loai: z.literal("hoc-bu"), nhuCauBuId: id, ngay: ngayYmd, gio: gioHm, ghiChu }),
  z.object({ loai: z.literal("nghi"), buoiId: id, lyDo: lyDoNghi.optional(), muonBu: z.boolean().optional(), ghiChu }),
  z.object({ loai: z.literal("bao-luu"), lyDo: lyDoLuu, ngay: ngayYmd.optional(), ghiChu }),
  z.object({ loai: z.literal("doi-lop"), ngayMongMuon: dsNgayTrongTuan, khungGio: dsKhungGio, tuNgay: ngayYmd.optional(), ghiChu }),
  z.object({ loai: z.literal("doi-co-so"), coSoId: id, ngayMongMuon: dsNgayTrongTuan, khungGio: dsKhungGio, tuNgay: ngayYmd.optional(), ghiChu }),
  z.object({ loai: z.literal("khac"), chuDe: chuDe.optional(), ghiChu: z.string().trim().min(5, "Ba mẹ mô tả yêu cầu giúp nhé (ít nhất vài chữ).").max(2000) }),
]);

export type GuiYeuCauInput = z.infer<typeof guiYeuCauSchema>;

export const huyYeuCauParams = z.object({ requestId: id });
