// lib/hoc-bu/ke-hoach-sua.ts — KẾ HOẠCH SỬA DỮ LIỆU HỌC BÙ từ kết quả checker (T15, 08/10/2026). THUẦN, không chạm DB.
//
// Checker (T01) CHỈ ĐỌC và nêu phát hiện. File này trả lời câu tiếp theo: với MỖI phát hiện, ai sửa và sửa bằng gì —
//   · TU_DONG      có hàm sửa tất định, idempotent, có nhật ký (`sua-du-lieu-db.ts`); chạy bằng `--ap-dung --luat=… --expect=N`;
//   · SCRIPT_RIENG đã có script riêng (dry-run + `--expect`) — kế hoạch chỉ chỉ đường tới nó;
//   · CHI_NEU      cần người quyết (tiền, bằng chứng thiếu, nghiệp vụ chưa chốt) — KHÔNG có đường tự động.
//
// LUẬT CỨNG của đợt này (bản duyệt T15):
//   · Phát hiện chỉ được `TU_DONG` khi checker đã phân loại nó AUTO_FIXABLE — NEEDS_MANUAL_REVIEW / INVALID / SAFE KHÔNG BAO GIỜ có đường tự động.
//   · KHÔNG BỊA trạng thái vắng: dòng buổi gốc bị ghi đè "có mặt" chỉ được khôi phục khi nhật ký audit chứng minh MỘT trạng thái vắng duy nhất
//     (`lienQuan.trangThaiGoc`); thiếu bằng chứng ⇒ CHI_NEU, dù ai đó muốn đoán "vắng có phép".
//   · `--expect=N` là cổng chống nhầm: số phát hiện đủ điều kiện của luật ĐANG chạy phải đúng N, lệch ⇒ dừng, chưa ghi gì.
import type { Finding, MaLuat, PhanLoai } from "@/lib/hoc-bu/toan-ven";

export type CachSua = "TU_DONG" | "SCRIPT_RIENG" | "CHI_NEU";

type MucSua = {
  cachSua: CachSua;
  /** Tên việc sửa — hiện trong báo cáo. */
  ten: string;
  /** Với SCRIPT_RIENG: lệnh/đường dẫn script (dry-run mặc định, có `--expect`). */
  script?: string;
  /** Với TU_DONG: dữ liệu máy đọc mà hàm sửa BẮT BUỘC có trong `lienQuan` (thiếu ⇒ phát hiện đó không tự sửa được). */
  canLienQuan?: readonly string[];
  /** Vì sao CHI_NEU (nói thật cho người đọc). */
  lyDoThuCong?: string;
};

/**
 * Bảng sửa cho MỌI luật đang chạy (`LUAT`). Lưới `[KHS-01]` đòi bảng đủ — thêm luật mới mà quên khai cách sửa là đỏ, để không có phát hiện nào "rơi vào khoảng trống".
 */
export const KHO_SUA: Record<MaLuat, MucSua> = {
  "TV-01": { cachSua: "CHI_NEU", ten: "Buổi gốc đã bị xoá", lyDoThuCong: "Buổi đã mất — không dựng lại được; quản lý quyết huỷ dòng có lý do." },
  "TV-02": { cachSua: "CHI_NEU", ten: "Bài của dòng không còn", lyDoThuCong: "Cần đối chiếu giáo trình; không đoán bài." },
  "TV-03": { cachSua: "TU_DONG", ten: "Điền bài còn thiếu từ buổi gốc (điền chỗ trống, không đổi giá trị đã có)", canLienQuan: ["baiBuoiGoc"] },
  "TV-04": { cachSua: "CHI_NEU", ten: "Con trỏ đơn phí hỏng", lyDoThuCong: "Phí đã thu thì kế toán đối soát trước khi gỡ con trỏ." },
  "TV-05": { cachSua: "CHI_NEU", ten: "Đơn phí đã huỷ/hoàn mà dòng đã vào case / đã bù", lyDoThuCong: "Đường tự động là `order.voided` (T06) cho đơn mới; dữ liệu cũ cần người rà (tiền)." },
  "TV-06": { cachSua: "CHI_NEU", ten: "Miễn phí nhưng đơn phí còn sống", lyDoThuCong: "Huỷ đơn chưa thu hoặc hoàn tiền — việc của kế toán." },
  "TV-07": { cachSua: "CHI_NEU", ten: "Đơn phí bù mồ côi / trùng", lyDoThuCong: "Tiền — kế toán quyết huỷ hay giữ (đã thu thì không tự động)." },
  "TV-08": { cachSua: "SCRIPT_RIENG", ten: "Tạo dòng cần bù cho buổi vắng chưa có dòng", script: "scripts/bu-vang-tu-ngay.ts (dry-run mặc định, --expect)" },
  "TV-09": { cachSua: "CHI_NEU", ten: "Dòng của khoá TẮT học bù", lyDoThuCong: "Không phải lỗi — dòng hiện ra khi khoá bật lại." },
  "TV-10": { cachSua: "TU_DONG", ten: "Case hết bé nhưng vẫn 'sắp dạy' ⇒ chốt lại (tự huỷ)", canLienQuan: [] },
  "TV-11": { cachSua: "TU_DONG", ten: "Case kẹt (hết bé chờ điểm danh) ⇒ chốt lại theo điểm danh các bé", canLienQuan: [] },
  "TV-12": { cachSua: "CHI_NEU", ten: "Case ở tương lai mà đã có bé điểm danh", lyDoThuCong: "Cần biết ngày thật của buổi." },
  "TV-13": { cachSua: "CHI_NEU", ten: "Case quá giờ còn bé chưa điểm danh", lyDoThuCong: "Giáo viên phải điểm danh (hoặc quản lý ghi đè có lý do) — không bịa điểm danh." },
  "TV-14": { cachSua: "CHI_NEU", ten: "Bé trong case lệch nhóm", lyDoThuCong: "Cần quyết gỡ bé hay đổi case." },
  "TV-15": { cachSua: "CHI_NEU", ten: "Trạng thái dòng lệch bản ghi trong case", lyDoThuCong: "Hai nguồn mâu thuẫn — người xem bản ghi nào đúng." },
  "TV-16": { cachSua: "CHI_NEU", ten: "Dòng đã bù xong nhưng không có buổi bù có mặt", lyDoThuCong: "Không bịa buổi bù." },
  "TV-17": { cachSua: "CHI_NEU", ten: "Lượt đã tiêu / dòng không khớp", lyDoThuCong: "Sổ lượt — xử lý bằng ADJUSTMENT có lý do (script nhập sổ), không sửa tay." },
  "TV-18": { cachSua: "CHI_NEU", ten: "Case trỏ giáo viên / phòng / bài / khoá không còn", lyDoThuCong: "Chọn lại giáo viên/phòng — việc xếp lịch." },
  "TV-19": { cachSua: "CHI_NEU", ten: "Bé đang chờ thuộc lớp đã huỷ/xoá", lyDoThuCong: "Quyết định 10: lớp huỷ không tự huỷ dòng — quản lý quyết từng bé." },
  "TV-20": { cachSua: "TU_DONG", ten: "Khôi phục trạng thái VẮNG của buổi gốc bị ghi đè 'có mặt' — CHỈ khi nhật ký chứng minh", canLienQuan: ["buoiGoc", "hocVien", "trangThaiGoc"] },
  "TV-21": { cachSua: "CHI_NEU", ten: "Nhãn học bù trên điểm danh gốc lệch dòng", lyDoThuCong: "Đối chiếu từng dòng — dòng cần bù thường đúng." },
  "TV-22": { cachSua: "CHI_NEU", ten: "Dòng đã bù xong mà buổi gốc không có điểm danh", lyDoThuCong: "Cần bằng chứng nguồn (học vượt từ chuyển đổi đơn?) — chưa tự phân loại." },
  "TV-23": { cachSua: "SCRIPT_RIENG", ten: "Buổi lớp trùng (cùng lớp, cùng thời điểm)", script: "scripts/don-buoi-lop-trung.ts (dry-run mặc định, --expect)" },
  "TV-24": { cachSua: "SCRIPT_RIENG", ten: "Buổi lớp trùng ngày", script: "scripts/don-buoi-lop-trung.ts (dry-run mặc định, --expect)" },
  "TV-25": { cachSua: "CHI_NEU", ten: "Case trùng giờ giáo viên", lyDoThuCong: "Đổi giờ/giáo viên — việc xếp lịch." },
  "TV-26": { cachSua: "CHI_NEU", ten: "Case trùng giờ phòng", lyDoThuCong: "Đổi giờ/phòng — việc xếp lịch." },
  "TV-27": { cachSua: "CHI_NEU", ten: "Case trùng lịch học viên", lyDoThuCong: "Đổi giờ — việc xếp lịch." },
  "TV-28": { cachSua: "CHI_NEU", ten: "Đơn xin bù còn mở mà dòng không còn chờ", lyDoThuCong: "Từ T11 hệ thống tự đóng đơn khi dòng đổi trạng thái; đơn tồn cũ đóng tay có phản hồi." },
  "TV-30": { cachSua: "CHI_NEU", ten: "Khoá lưu trên dòng lệch khoá của lớp", lyDoThuCong: "Phải biết khoá nào đúng." },
  "TV-31": { cachSua: "TU_DONG", ten: "Nối lại điểm danh gốc cho dòng nguồn ABSENCE", canLienQuan: ["diemDanh"] },
  "TV-32": { cachSua: "CHI_NEU", ten: "Số trên tài khoản lượt khác tổng bút toán", lyDoThuCong: "Chỉ lệch khi ai đó sửa SQL trực tiếp — điều tra nguồn trước khi chỉnh." },
  "TV-33": { cachSua: "CHI_NEU", ten: "`held` thừa / thiếu", lyDoThuCong: "Quyết RELEASE hay ADJUSTMENT theo từng bé (lượt là quyền lợi học viên)." },
  "TV-34": { cachSua: "CHI_NEU", ten: "`consumed` lệch số dòng đã tiêu", lyDoThuCong: "Như TV-33." },
  "TV-35": { cachSua: "SCRIPT_RIENG", ten: "Nhập sổ lượt cho học viên chưa có tài khoản", script: "scripts/so-luot-khoi-tao.ts (workflow bấm tay, dry-run + --expect)" },
  "TV-40": { cachSua: "SCRIPT_RIENG", ten: "Nâng case đời cũ lên mô hình nhiều bài", script: "scripts/hoc-bu-case-v2-backfill.ts (dry-run mặc định, --ap-dung --expect=N)" },
  "TV-41": { cachSua: "CHI_NEU", ten: "Hai tầng điểm danh lệch nhau", lyDoThuCong: "Hai nguồn mâu thuẫn — xem điểm danh nào đúng." },
  "TV-42": { cachSua: "CHI_NEU", ten: "Bộ bài của case sai luật", lyDoThuCong: "Cần quyết bộ bài đúng." },
  "TV-43": { cachSua: "CHI_NEU", ten: "Trạng thái case không khớp suy từ các bé", lyDoThuCong: "Xem TV-11: nếu kẹt thì chốt lại; khác thì người rà." },
  "TV-50": { cachSua: "TU_DONG", ten: "Xét lại phí thu thiếu sau hoàn một phần: gỡ bé chưa học khỏi case", canLienQuan: ["donPhi"] },
  "TV-51": { cachSua: "CHI_NEU", ten: "Học viên rời khoá mà còn nợ bù", lyDoThuCong: "Quyết định nghiệp vụ chưa chốt (còn bù hay huỷ có lý do)." },
  "TV-93": { cachSua: "CHI_NEU", ten: "Công dạy bù ngoài bản chốt kỳ", lyDoThuCong: "Kế toán/BLĐ quyết mở lại kỳ hay bù ở kỳ đang mở — hệ thống không sửa bản chốt." },
};

export type DongKeHoach = {
  luat: MaLuat;
  id: string;
  phanLoai: PhanLoai;
  nghiemTrong: Finding["nghiemTrong"];
  cachSua: CachSua;
  /** Có sửa tự động được KHÔNG (cách sửa là TU_DONG + checker nói AUTO_FIXABLE + đủ dữ liệu máy đọc). */
  tuDongDuoc: boolean;
  /** Vì sao không tự động dù luật có hàm sửa (hoặc ghi chú thủ công). */
  ghiChu: string;
  script?: string;
  finding: Finding;
};

/**
 * Một phát hiện có sửa TỰ ĐỘNG được không. Ba điều kiện cùng lúc, thiếu một là KHÔNG:
 *   1. luật có hàm sửa (`TU_DONG`);
 *   2. checker phân loại phát hiện này là AUTO_FIXABLE (NEEDS_MANUAL_REVIEW / INVALID / SAFE ⇒ không bao giờ);
 *   3. mọi trường máy đọc cần thiết có mặt trong `lienQuan` (không phải đọc ngược từ câu chữ).
 */
export function tuDongDuoc(f: Finding): { duoc: boolean; lyDo: string } {
  const m = KHO_SUA[f.luat];
  if (m.cachSua !== "TU_DONG") return { duoc: false, lyDo: m.cachSua === "SCRIPT_RIENG" ? `Dùng ${m.script}` : (m.lyDoThuCong ?? "Cần người quyết.") };
  if (f.phanLoai !== "AUTO_FIXABLE") {
    return { duoc: false, lyDo: `Checker phân loại ${f.phanLoai} — không có đường tự động (không đoán).` };
  }
  const thieu = (m.canLienQuan ?? []).filter((k) => !f.lienQuan?.[k]);
  if (thieu.length > 0) return { duoc: false, lyDo: `Thiếu dữ liệu máy đọc: ${thieu.join(", ")} — không đủ bằng chứng để tự sửa.` };
  return { duoc: true, lyDo: "" };
}

export type KeHoachSua = {
  dong: DongKeHoach[];
  /** Đếm theo luật × cách sửa — kể cả luật ra 0 (im lặng là nói dối). */
  demTheoLuat: Record<MaLuat, { tong: number; tuDong: number; scriptRieng: number; chiNeu: number }>;
};

export function lapKeHoachSua(findings: readonly Finding[]): KeHoachSua {
  const dong: DongKeHoach[] = findings.map((f) => {
    const m = KHO_SUA[f.luat];
    const t = tuDongDuoc(f);
    return {
      luat: f.luat,
      id: f.id,
      phanLoai: f.phanLoai,
      nghiemTrong: f.nghiemTrong,
      cachSua: t.duoc ? "TU_DONG" : m.cachSua === "TU_DONG" ? "CHI_NEU" : m.cachSua,
      tuDongDuoc: t.duoc,
      ghiChu: t.duoc ? m.ten : t.lyDo,
      ...(m.script ? { script: m.script } : {}),
      finding: f,
    };
  });
  const dem = Object.fromEntries(
    (Object.keys(KHO_SUA) as MaLuat[]).map((l) => [l, { tong: 0, tuDong: 0, scriptRieng: 0, chiNeu: 0 }]),
  ) as KeHoachSua["demTheoLuat"];
  for (const d of dong) {
    const o = dem[d.luat];
    o.tong++;
    if (d.cachSua === "TU_DONG") o.tuDong++;
    else if (d.cachSua === "SCRIPT_RIENG") o.scriptRieng++;
    else o.chiNeu++;
  }
  return { dong, demTheoLuat: dem };
}

/** Các dòng ĐỦ ĐIỀU KIỆN sửa tự động của MỘT luật — tập mà `--expect=N` phải khớp. */
export function dongTuDongCuaLuat(kh: KeHoachSua, luat: MaLuat): DongKeHoach[] {
  return kh.dong.filter((d) => d.luat === luat && d.tuDongDuoc);
}

export class LoiExpect extends Error {}

/** Cổng `--expect`: số dòng tự sửa được của luật phải đúng N. Lệch ⇒ ném (CHƯA ghi gì). */
export function kiemExpect(kh: KeHoachSua, luat: MaLuat, expect: number): DongKeHoach[] {
  if (!Number.isInteger(expect) || expect < 0) throw new LoiExpect("--expect phải là số nguyên không âm (số dòng thấy ở dry-run).");
  if (KHO_SUA[luat].cachSua !== "TU_DONG") {
    throw new LoiExpect(`Luật ${luat} không có đường sửa tự động (${KHO_SUA[luat].cachSua}).`);
  }
  const ds = dongTuDongCuaLuat(kh, luat);
  if (ds.length !== expect) {
    throw new LoiExpect(`--expect=${expect} nhưng ${luat} hiện có ${ds.length} phát hiện đủ điều kiện sửa tự động — dữ liệu đã đổi kể từ dry-run. DỪNG, chưa ghi gì.`);
  }
  return ds;
}

/** Báo cáo markdown ngắn cho người đọc (bản JSON mới là bản đủ). */
export function dungBaoCaoKeHoach(kh: KeHoachSua, meta: { db: string; luc: string }): string {
  const L: string[] = [];
  L.push(`# Kế hoạch sửa dữ liệu học bù`);
  L.push(`DB \`${meta.db}\` · ${meta.luc} · CHỈ ĐỌC — không dòng nào ở đây đã được sửa.`);
  L.push("");
  L.push("| Luật | Việc | Tổng | Tự động | Script riêng | Cần người |");
  L.push("|---|---|---:|---:|---:|---:|");
  for (const [luat, c] of Object.entries(kh.demTheoLuat) as [MaLuat, KeHoachSua["demTheoLuat"][MaLuat]][]) {
    if (c.tong === 0) continue;
    L.push(`| ${luat} | ${KHO_SUA[luat].ten} | ${c.tong} | ${c.tuDong} | ${c.scriptRieng} | ${c.chiNeu} |`);
  }
  const tong = kh.dong.length;
  const tuDong = kh.dong.filter((d) => d.tuDongDuoc).length;
  L.push("");
  L.push(`Tổng ${tong} phát hiện · **${tuDong}** sửa tự động được · ${kh.dong.filter((d) => d.cachSua === "SCRIPT_RIENG").length} có script riêng · ${kh.dong.filter((d) => d.cachSua === "CHI_NEU").length} cần người.`);
  const lenh = (Object.keys(KHO_SUA) as MaLuat[]).filter((l) => kh.demTheoLuat[l].tuDong > 0);
  if (lenh.length > 0) {
    L.push("");
    L.push("Chạy thật (qua workflow được duyệt, KHÔNG chạy tay với chuỗi prod):");
    for (const l of lenh) L.push(`- \`pnpm exec tsx scripts/hoc-bu-sua-du-lieu.ts --ap-dung --luat=${l} --expect=${kh.demTheoLuat[l].tuDong}\``);
  }
  return L.join("\n");
}
