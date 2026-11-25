// lib/hoc-bu/phu-thuoc-thuan.ts — PHẦN THUẦN của cổng phụ thuộc học bù (T14): loại xoá, số đếm, và câu từ chối. Không DB.
// Phần chạm DB (đếm) ở `phu-thuoc.ts`.

export type LoaiXoa = "BUOI" | "BAI" | "DIEM_DANH";

/** Số bản ghi học bù đang trỏ tới thứ sắp xoá. Mọi trường đều ĐẾM CẢ bản ghi đã huỷ / đã bù xong (lịch sử). */
export type DemPhuThuoc = {
  /** `MakeupNeed` trỏ tới (theo đúng cột của loại xoá). */
  dongBu: number;
  /** `MakeupCaseStudent` (mục case) trỏ tới. */
  mucCase: number;
  /** `MakeupCase` / `MakeupCaseLesson` trỏ tới (chỉ có với bài). */
  caseTrongBo: number;
  /** `Attendance.makeupSessionId` trỏ tới (chỉ có với buổi: buổi này là nơi ai đó đã học bù). */
  diemDanhDaBu: number;
};

const TEN: Record<LoaiXoa, { vat: string; vai: string }> = {
  BUOI: { vat: "buổi học", vai: "buổi vắng gốc" },
  BAI: { vat: "bài học", vai: "bài vắng" },
  DIEM_DANH: { vat: "bản ghi điểm danh", vai: "điểm danh gốc" },
};

/** THUẦN. Trả lý do không xoá được, hoặc `null` khi không còn gì trỏ tới. Trả CHUỖI để người bấm biết vì sao (luật 12). */
export function lyDoChanXoa(loai: LoaiXoa, d: DemPhuThuoc): string | null {
  const vuong: string[] = [];
  if (d.dongBu > 0) vuong.push(`${d.dongBu} dòng học bù (${TEN[loai].vai}, kể cả đã huỷ hoặc đã bù xong)`);
  if (d.mucCase > 0) vuong.push(`${d.mucCase} mục trong case dạy bù`);
  if (d.caseTrongBo > 0) vuong.push(`${d.caseTrongBo} case dạy bù có bài này`);
  if (d.diemDanhDaBu > 0) vuong.push(`${d.diemDanhDaBu} bản ghi điểm danh đánh dấu "đã học bù" ở buổi này`);
  if (vuong.length === 0) return null;
  const thayVi =
    loai === "BUOI" ? 'HUỶ buổi (đổi trạng thái "Đã huỷ")' : loai === "BAI" ? "giữ bài và ngừng dùng nó" : "giữ bản ghi và sửa trạng thái điểm danh";
  return `Không xoá được ${TEN[loai].vat} này: đang có ${vuong.join(" · ")} dựa vào nó. Xoá là làm mất lịch sử học bù của học viên — hãy ${thayVi} thay vì xoá.`;
}
