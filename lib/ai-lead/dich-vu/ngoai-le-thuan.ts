// lib/ai-lead/dich-vu/ngoai-le-thuan.ts — PHẦN THUẦN của «Ngoại lệ» (Exception Center) cho hồ sơ AI Lead. KHÔNG DB, KHÔNG đồng hồ (`now` luôn là tham số), KHÔNG import @/lib/db.
//
// Ba loại ngoại lệ, xếp theo ƯU TIÊN (một hồ sơ chỉ thuộc MỘT loại — loại đứng trên thắng, để cùng một hồ sơ không bị đếm hai lần):
//   1. SYSTEM_EXCEPTION   — tạo lead lỗi hạ tầng/CRM (`taoLeadTuHoSo` hoặc đường AUTO đánh dấu). Nhân viên có thể «thử lại» khi lỗi do hệ thống.
//   2. ASSIGNMENT_PENDING — lead ĐÃ tạo nhưng CRM chưa chia được sale. Việc chia là của màn lead; ở đây chỉ «đánh dấu đã xử lý» SAU khi lead đã có người.
//   3. QUA_HAN_SLA        — hồ sơ còn mở mà quá hạn nhận/xử lý (đúng `mucSla` — MỘT định nghĩa quá hạn cho cả danh sách chính lẫn màn này).
//
// ═══ NGUYÊN TẮC PII ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// `resultNote` của hồ sơ là MÃ do mã nguồn ghi (không phải văn bản người gõ), nhưng cột là `String?` nên KHÔNG tin: chỉ mã nằm trong BẢNG TRẮNG dưới đây mới được dịch ra câu
// tiếng Việt; mã lạ ⇒ câu chung «không ghi rõ nguyên nhân» và KHÔNG BAO GIỜ in lại nguyên văn (một giá trị lạ có thể là lỗi Prisma kèm SĐT).
import { laKetThuc, NHAN_THIEU, type ThieuDieuKien } from "./dieu-kien";
import { laQuaHan, mucSla, type MucSla } from "./sla";
import type { TrangThaiNut } from "./hanh-dong-kha-dung";

export type LoaiNgoaiLe = "SYSTEM_EXCEPTION" | "ASSIGNMENT_PENDING" | "QUA_HAN_SLA";

/** Thứ tự ưu tiên hiển thị & phân loại (đứng trước = nặng hơn). */
export const THU_TU_LOAI: readonly LoaiNgoaiLe[] = ["SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING", "QUA_HAN_SLA"];

export const NHAN_LOAI: Record<LoaiNgoaiLe, string> = {
  SYSTEM_EXCEPTION: "Lỗi tạo lead",
  ASSIGNMENT_PENDING: "Lead chờ phân công", // tên LOẠI (theo trạng thái hồ sơ): đúng cả khi lead đã có sale mà hồ sơ chưa được đóng
  QUA_HAN_SLA: "Quá hạn SLA",
};

export type DauVaoPhanLoai = {
  state: string;
  claimedById: string | null;
  slaClaimDueAt: Date | null;
  slaResolveDueAt: Date | null;
};

/** Hồ sơ thuộc loại ngoại lệ nào (hoặc không phải ngoại lệ). Quá hạn dùng ĐÚNG `mucSla` — không có định nghĩa thứ hai. */
export function phanLoaiNgoaiLe(d: DauVaoPhanLoai, now: Date): LoaiNgoaiLe | null {
  if (d.state === "SYSTEM_EXCEPTION") return "SYSTEM_EXCEPTION";
  if (d.state === "ASSIGNMENT_PENDING") return "ASSIGNMENT_PENDING";
  if (laKetThuc(d.state)) return null;
  return laQuaHan(mucSla(d, now)) ? "QUA_HAN_SLA" : null;
}

// ─── LÝ DO (câu người đọc được) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LyDoNgoaiLe = {
  /** Mã trong bảng trắng, hoặc `null` (không có / không nhận ra). Chỉ để tra cứu — không phải PII. */
  ma: string | null;
  cau: string;
  goiY: string;
  /** `true` ⇒ lỗi do hệ thống/tạm thời, thử lại có cơ hội thành công; `false` ⇒ dữ liệu hồ sơ phải sửa trước (thử lại sẽ lỗi lại ⇒ nút khoá, luật 12). */
  thuLaiDuoc: boolean;
};

const SUA_HO_SO = "Mở hồ sơ, kiểm tra và bổ sung thông tin rồi duyệt lại.";
const LOI_TAM = "Thường là lỗi tạm thời. Bấm «Thử lại»; nếu vẫn lỗi, báo bộ phận kỹ thuật kèm mã hồ sơ.";

/** Bảng TRẮNG: mọi mã mà mã nguồn thật sự ghi vào `resultNote` khi hồ sơ rơi SYSTEM_EXCEPTION (tao-lead.ts `danhDauNgoaiLe` · intake.ts `tuTaoLeadRoiBao`). */
const BANG_LY_DO: Record<string, Omit<LyDoNgoaiLe, "ma">> = {
  // Lead chính thức KHÔNG được rơi UNKNOWN/không-nguồn: chưa cấu hình nguồn Marketing HO cho Page ⇒ giữ hồ sơ ở đây (không mất khách) cho tới khi cấu hình xong.
  NGUON_CHUA_CAU_HINH: {
    cau: "Nguồn lead của Page này chưa được cấu hình (nhóm «Marketing HO» và ánh xạ Page).",
    goiY: "Người quản lý nguồn lead cấu hình nhóm nguồn cho Page ở module Nguồn lead, rồi bấm «Thử lại». Hồ sơ không mất.",
    thuLaiDuoc: true,
  },
  AUTO_NGUON_CHUA_CAU_HINH: {
    cau: "Nguồn lead của Page này chưa được cấu hình (nhóm «Marketing HO» và ánh xạ Page).",
    goiY: "Người quản lý nguồn lead cấu hình nhóm nguồn cho Page ở module Nguồn lead, rồi bấm «Thử lại». Hồ sơ không mất.",
    thuLaiDuoc: true,
  },
  INGEST_NEM_LOI: { cau: "Hệ thống gặp lỗi khi ghi lead vào CRM.", goiY: LOI_TAM, thuLaiDuoc: true },
  AUTO_LOI_INGEST: { cau: "Tạo lead tự động gặp lỗi khi ghi vào CRM.", goiY: LOI_TAM, thuLaiDuoc: true },
  INGEST_GHI: { cau: "CRM không ghi được lead của hồ sơ này.", goiY: LOI_TAM, thuLaiDuoc: true },
  INGEST_KHONG_CO_LEAD: { cau: "CRM báo đã nhận nhưng không tìm thấy lead vừa tạo.", goiY: LOI_TAM, thuLaiDuoc: true },
  AUTO_TU_DONG_TAT: {
    cau: "Tạo lead tự động bị tắt đúng lúc hồ sơ đang được xử lý.",
    goiY: "Nhân viên bấm «Thử lại» không phụ thuộc cờ tự động.",
    thuLaiDuoc: true,
  },
  INGEST_SDT: { cau: "CRM từ chối số điện thoại của hồ sơ.", goiY: SUA_HO_SO, thuLaiDuoc: false },
  INGEST_TEN: { cau: "CRM từ chối tên phụ huynh của hồ sơ.", goiY: SUA_HO_SO, thuLaiDuoc: false },
  INGEST_TU_CHOI: { cau: "CRM từ chối tạo lead từ hồ sơ này.", goiY: SUA_HO_SO, thuLaiDuoc: false },
  AUTO_CO_SO_KHONG_HOP_LE: {
    cau: "Cơ sở của hồ sơ không còn nhận khách từ Page này.",
    goiY: "Mở hồ sơ, chọn lại cơ sở rồi duyệt lại.",
    thuLaiDuoc: false,
  },
};

const LY_DO_KHONG_RO: Omit<LyDoNgoaiLe, "ma"> = {
  cau: "Hồ sơ bị đánh dấu lỗi hệ thống nhưng không ghi rõ nguyên nhân.",
  goiY: "Bấm «Thử lại»; nếu vẫn lỗi, mở hồ sơ để kiểm tra rồi báo bộ phận kỹ thuật.",
  thuLaiDuoc: true,
};

/** Mã có trong bảng trắng không — dùng cả cho audit (chỉ ghi mã đã biết). */
export function maHopLe(resultNote: string | null | undefined): string | null {
  return resultNote && Object.prototype.hasOwnProperty.call(BANG_LY_DO, resultNote) ? resultNote : null;
}

/** `leadDaCoNguoi` BẮT BUỘC (luật 7): lead ĐÃ có sale thì câu «chưa có sale» là nói dối và nút «Đánh dấu» đang sáng — hai thứ phải cùng một sự thật. */
export function lyDoNgoaiLe(x: { loai: LoaiNgoaiLe; resultNote: string | null; mucSla: MucSla; leadDaCoNguoi: boolean | null }): LyDoNgoaiLe {
  if (x.loai === "SYSTEM_EXCEPTION") {
    const ma = maHopLe(x.resultNote);
    return ma ? { ma, ...BANG_LY_DO[ma] } : { ma: null, ...LY_DO_KHONG_RO };
  }
  if (x.loai === "ASSIGNMENT_PENDING") {
    if (x.leadDaCoNguoi === true) {
      return {
        ma: null,
        cau: "Lead đã có sale phụ trách; hồ sơ AI chỉ còn chờ được đóng.",
        goiY: "Hệ thống tự đóng ngoại lệ này trong vài phút (cron 10 phút/lần). Muốn đóng ngay: bấm «Đánh dấu đã xử lý».",
        thuLaiDuoc: false,
      };
    }
    return {
      ma: null,
      cau: "Lead đã được tạo nhưng chưa có sale phụ trách.",
      goiY: "Giao sale ở màn lead. Khi lead có sale phụ trách, hệ thống tự đóng ngoại lệ này trong vài phút.",
      thuLaiDuoc: false,
    };
  }
  if (x.mucSla === "QUA_HAN_XU_LY") {
    return { ma: null, cau: "Quá hạn xử lý: hồ sơ chưa được xử lý xong đúng hạn.", goiY: "Xử lý ngay hoặc chuyển cho người khác.", thuLaiDuoc: false };
  }
  return { ma: null, cau: "Quá hạn nhận: chưa có ai nhận hồ sơ này.", goiY: "Nhận xử lý ngay hoặc chuyển cho người khác.", thuLaiDuoc: false };
}

/** Mốc để tính «tuổi» của ngoại lệ + nhãn mốc. Lỗi/chờ giao: lần cập nhật cuối của hồ sơ; quá hạn: hạn đã trôi qua (xử lý nặng hơn nhận). */
export function mocNgoaiLe(
  loai: LoaiNgoaiLe,
  d: { updatedAt: Date; claimedById: string | null; slaClaimDueAt: Date | null; slaResolveDueAt: Date | null },
  now: Date,
): { moc: Date; nhan: string } {
  if (loai === "SYSTEM_EXCEPTION") return { moc: d.updatedAt, nhan: "Lỗi cách đây" };
  if (loai === "ASSIGNMENT_PENDING") return { moc: d.updatedAt, nhan: "Chờ phân công cách đây" };
  const xuLyQuaHan = d.slaResolveDueAt !== null && d.slaResolveDueAt.getTime() < now.getTime();
  const han = xuLyQuaHan ? d.slaResolveDueAt : d.slaClaimDueAt;
  return { moc: han ?? d.updatedAt, nhan: "Quá hạn" };
}

// ─── NÚT NÀO HIỆN / SÁNG / VÌ SAO TỐI ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DauVaoNutNgoaiLe = {
  loai: LoaiNgoaiLe;
  state: string;
  coQuyenXuLy: boolean;
  claimedById: string | null;
  claimedBoiToi: boolean;
  claimedTen: string | null;
  thieu: readonly ThieuDieuKien[];
  thuLaiDuoc: boolean;
  leadId: string | null;
  /** `null` = không áp dụng/không biết. */
  leadDaCoNguoi: boolean | null;
  soUngVien: number;
};

export type BangNutNgoaiLe = {
  thuLai: TrangThaiNut;
  giaoNguoi: TrangThaiNut;
  danhDauDaXuLy: TrangThaiNut;
  ghiChu: string | null;
};

const AN: TrangThaiNut = { hien: false, bat: false, lyDoKhoa: null };
const SANG: TrangThaiNut = { hien: true, bat: true, lyDoKhoa: null };
const toi = (lyDo: string): TrangThaiNut => ({ hien: true, bat: false, lyDoKhoa: lyDo });

/** Hồ sơ nhận chuyển người được ở trạng thái nào — ĐỐI CHIẾU `nhanVienXuLyDuoc` (cổng thật của `chuyenNguoi`). */
const TRANG_THAI_CHUYEN_DUOC = new Set(["PENDING_INFO", "WAITING_QLCS", "IN_PROGRESS", "READY_FOR_REVIEW", "SYSTEM_EXCEPTION"]);

export function bangNutNgoaiLe(x: DauVaoNutNgoaiLe): BangNutNgoaiLe {
  if (!x.coQuyenXuLy) {
    return { thuLai: AN, giaoNguoi: AN, danhDauDaXuLy: AN, ghiChu: "Bạn chỉ có quyền xem. Cần quyền ai-leads:review để xử lý ngoại lệ." };
  }
  const nguoiKhac = x.claimedById !== null && !x.claimedBoiToi;
  const khoaNguoiKhac = `Đang do ${x.claimedTen ?? "người khác"} xử lý.`;

  if (x.loai === "ASSIGNMENT_PENDING") {
    let danhDau: TrangThaiNut;
    if (!x.leadId) danhDau = toi("Hồ sơ chưa gắn lead nào để kiểm tra người phụ trách.");
    else if (x.leadDaCoNguoi !== true) danhDau = toi("Lead chưa có người phụ trách. Giao sale ở màn lead trước, rồi quay lại đây.");
    else danhDau = SANG;
    return { thuLai: AN, giaoNguoi: AN, danhDauDaXuLy: danhDau, ghiChu: null };
  }

  let thuLai: TrangThaiNut = AN;
  if (x.loai === "SYSTEM_EXCEPTION") {
    if (nguoiKhac) thuLai = toi(khoaNguoiKhac);
    else if (x.thieu.length > 0) thuLai = toi(`Hồ sơ còn thiếu: ${x.thieu.map((t) => NHAN_THIEU[t]).join("; ")}. Bổ sung ở màn chi tiết rồi duyệt.`);
    else if (!x.thuLaiDuoc) thuLai = toi("Lỗi này do dữ liệu hồ sơ — thử lại sẽ lỗi lại. Mở hồ sơ để sửa rồi duyệt.");
    else thuLai = SANG;
  }

  let giao: TrangThaiNut;
  if (!TRANG_THAI_CHUYEN_DUOC.has(x.state)) giao = toi("Agent còn đang thu thập thông tin; chưa chuyển người được.");
  else if (nguoiKhac) giao = toi(khoaNguoiKhac);
  else if (x.soUngVien === 0) giao = toi("Không có quản lý nào khác ở cơ sở này đủ điều kiện nhận hồ sơ.");
  else giao = SANG;

  return { thuLai, giaoNguoi: giao, danhDauDaXuLy: AN, ghiChu: null };
}
