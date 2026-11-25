/**
 * lib/nguon/nhom-nhan-su-mac-dinh.ts — GIÁ TRỊ HỢP LỆ của setting `nguon.nhomNhanSuMacDinh` (nguồn khi CHỈ BIẾT "đây là nhân sự giới thiệu").
 *
 * ── Vì sao có (res3 LOW-10 · res4 MEDIUM-2, 09/10/2026) ──────────────────────────────────────────────────────
 * Registry chỉ biết `z.string().min(1)`: gõ nhầm mã, trỏ vào nguồn đã ngừng hoặc nguồn KHÔNG cần nhân sự thì lưu vẫn thành công, rồi luật `NV_GIOI_THIEU` / `KHAI_TAY` rơi UNKNOWN IM LẶNG cho mọi
 * lead có nhân sự giới thiệu (cột «Mã NV giới thiệu» của Excel, ô chọn nhân sự). Nhãn trên màn Cấu hình đã hứa «phải là nguồn đang hoạt động và loại nhân sự» (`nhan-van-hanh.ts`) — lời hứa suông.
 * Registry là Zod thuần, không đọc được DB, nên phép kiểm này chạy Ở NƠI LƯU (`setGlobalSetting` → `lib/settings/kiem-theo-db.ts`); phía ĐỌC vẫn chịu được giá trị xấu (`nhomNhanSuDung` trong
 * `quy-nguon.ts`: trỏ sai thì rơi xuống luật sau, không ghi người vào nhóm không cần người) vì giá trị cũ/ghi tay vào DB không đi qua cổng này.
 *
 * Phần luật là THUẦN (`loiNhomNhanSuMacDinh`), phần đọc DB ở `kiemNhomNhanSuMacDinhTheoDb`. `now` BẮT BUỘC (luật 19).
 */
import { db } from "@/lib/db";
import { nguonChonDuoc, type NguonChonDuocTho } from "./hieu-luc-nguon";

export type NhomKiemMacDinh = NguonChonDuocTho & { referrerRequirement: string };

/** Câu lỗi tiếng Việt, hoặc `null` nếu `ma` là nguồn hợp lệ làm «nguồn mặc định của nhân sự giới thiệu». */
export function loiNhomNhanSuMacDinh(ma: string, nhom: NhomKiemMacDinh | null, now: Date): string | null {
  if (nhom === null) return `Không có nguồn nào mã «${ma}» — nhập đúng mã một nguồn đang có trong danh mục.`;
  if (nhom.referrerRequirement !== "EMPLOYEE") {
    return `Nguồn «${ma}» không phải nguồn kiểu NHÂN SỰ giới thiệu (yêu cầu người giới thiệu = ${nhom.referrerRequirement}) — chọn nguồn kiểu nhân sự giới thiệu.`;
  }
  if (!nguonChonDuoc(nhom, now)) {
    return `Nguồn «${ma}» hiện không chọn được cho lead mới (đang ngừng / lưu trữ / tắt chọn / ngoài khoảng hiệu lực) — dùng nguồn đang hoạt động.`;
  }
  return null;
}

/** Đọc nguồn theo mã (client KHÔNG scope: danh mục nguồn là dữ liệu chung) rồi áp `loiNhomNhanSuMacDinh`. */
export async function kiemNhomNhanSuMacDinhTheoDb(ma: string, now: Date): Promise<string | null> {
  const nhom = await db.leadSourceGroup.findUnique({
    where: { code: ma },
    select: { status: true, selectable: true, effectiveFrom: true, effectiveTo: true, referrerRequirement: true },
  });
  return loiNhomNhanSuMacDinh(ma, nhom, now);
}
