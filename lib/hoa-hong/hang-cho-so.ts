// lib/hoa-hong/hang-cho-so.ts — TRÌNH BÀY hàng chờ trước sổ ở tab Sổ (06 §2.2, §4.1, §6): đổi lý do của engine thành chữ người đọc được và nêu BƯỚC KẾ TIẾP
// kèm link đúng chỗ. THUẦN (không DB, không next/*).
//
// ── MỘT định nghĩa hàng chờ sổ ─────────────────────────────────────────────────────────────────────────────
// Nhóm + nhãn mã + nhãn lý do treo nằm ở `hang-cho-so-nhom.ts`; việc ĐỌC (đếm, phân trang, scope cơ sở) nằm ở `hang-cho-so-doc.ts` (`docHangChoSo`).
// Tệp này chỉ thêm phần TRÌNH BÀY (lý do đầy đủ câu, bước kế tiếp, link) — không giữ bảng nhóm/nhãn thứ hai. Đừng thêm.
//
// ── Đơn không lead ─────────────────────────────────────────────────────────────────────────────────────────
// Engine ghi hàng chờ mềm `UNRESOLVED_BENEFICIARY` với `detail.lyDo = "KHONG_CO_LEAD"` (quet-khoan.ts). Đó KHÔNG phải một nguồn: màn nói
// "Đơn chưa nối lead" và dẫn tới ĐƠN (nơi nối), tuyệt đối không dẫn tới "gán nguồn" — đơn chưa có lead thì chưa có nguồn nào để gán (không bịa
// nguồn, không gán UNKNOWN chỉ để chạy).
//
// ── Luật 12 (affordance nói thật) ──────────────────────────────────────────────────────────────────────────
// `hanhDongTiep` chỉ trả `lienKet` khi người xem THẬT SỰ mở được trang đích (`QuyenLienKet` do trang tính từ đúng cổng của trang đích).
// Thiếu quyền ⇒ vẫn nêu VIỆC CẦN LÀM bằng chữ nhưng KHÔNG có link: một link dẫn tới trang đá người ta về /dashboard là lời hứa suông.
import type { MaHold } from "./hang-cho";
import { nhanLyDoTreo } from "./hang-cho-so-nhom";

export type { MaHold };

/** `detail` của hàng chờ là JSON do engine ghi — KHÔNG tin hình dạng (đọc qua đây, không `as`). */
function docChuoi(detail: unknown, khoa: string): string | null {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const v = (detail as Record<string, unknown>)[khoa];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Các dòng chênh lệch của vai chủ nguồn trong `detail.chenh` của INPUT_DRIFT (`key` = `<mã vai>|<loại>|<id>`, `chenh` = kỳ vọng − sổ ròng). Không tin hình dạng JSON.
 * `null` = không có dòng nào của vai này; ngược lại `thuHoi` = Σ phần ÂM (số đồng sẽ bị THU HỒI nếu người duyệt «Áp dụng»).
 */
function chenhVaiChuNguon(detail: unknown): { thuHoi: number } | null {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const chenh = (detail as Record<string, unknown>).chenh;
  if (!Array.isArray(chenh)) return null;
  let co = false;
  let thuHoi = 0;
  for (const c of chenh) {
    if (typeof c !== "object" || c === null) continue;
    const { key, chenh: so } = c as Record<string, unknown>;
    if (typeof key !== "string" || !key.startsWith(`${VAI_CHU_NGUON}|`)) continue;
    co = true;
    if (typeof so === "number" && Number.isFinite(so) && so < 0) thuHoi += -so;
  }
  return co ? { thuHoi } : null;
}

const soTienVN = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const KHONG_CO_LEAD = "KHONG_CO_LEAD";

/** Hàng chờ này là ca "đơn chưa nối lead" (06 §6, quyết định chủ dự án 08/10)? */
export function laDonChuaNoiLead(ma: MaHold, detail: unknown): boolean {
  return ma === "UNRESOLVED_BENEFICIARY" && docChuoi(detail, "lyDo") === KHONG_CO_LEAD;
}

/**
 * Mô tả của MÃ khi engine không ghi câu cụ thể (`detail.lyDo` thiếu/rác). KHÔNG được trùng chữ trên pill (nhãn mã): hai dòng liền nhau cùng một câu là nhiễu
 * (reviewer độc lập chỉ ra trên ảnh) — và đây là đường DUY NHẤT trong mã có thể tái tạo lỗi đó.
 */
export const MO_TA_MA_HANG_CHO: Record<MaHold, string> = {
  UNRESOLVED_BENEFICIARY: "Chưa tìm ra người nhận phần hoa hồng của vai này.",
  POLICY_OVERLAP: "Có nhiều chính sách cùng áp dụng cho khoản này, không chọn được một chính sách.",
  PENDING_REGULATION: "Trường hợp này đang chờ văn bản quy định của công ty.",
  CAP_EXCEEDED: "Tổng tỉ lệ các vai vượt trần cho phép; không ghi dòng nào cho khoản này.",
  NO_ORG_UNIT: "Cơ sở của khoản thu chưa nằm trong cây đơn vị nên chưa quy được kỳ.",
  CHUA_GAN_CON: "Khoản thu chưa được gắn cho bé nào trong đơn.",
  CHO_HOC_VIEN: "Dòng học phí chưa có hồ sơ học viên để xác định lần mua.",
  INTERNAL_TRANSFER: "Cặp chuyển tiền giữa hai bé cần người duyệt xác nhận.",
  NEGATIVE_WITHOUT_ORIGIN: "Bút toán âm không có khoản thu gốc để đảo hoa hồng.",
  INPUT_DRIFT: "Dữ liệu đầu vào đã đổi sau khi hoa hồng được tính.",
  PAYMENT_WITHDRAWN: "Khoản thu đã có hoa hồng nhưng không còn được tính là thực thu.",
  MANUAL_REVIEW_REQUIRED: "Cần người duyệt quyết định cách tính khoản này.",
  NEGATIVE_BALANCE: "Tổng hoa hồng của kỳ âm sau khi đảo; phần âm kết chuyển sang kỳ sau.",
};

/**
 * Lý do bằng chữ của MỘT hàng chờ.
 * @param tenVai tên vai (BeneficiaryRole.name) của `detail.vai`, hoặc null — để câu nêu đúng vai bị treo.
 */
export function lyDoHienThi(ma: MaHold, detail: unknown, tenVai: string | null): string {
  if (ma === "UNRESOLVED_BENEFICIARY") {
    const chu = nhanLyDoTreo(docChuoi(detail, "lyDo")) ?? MO_TA_MA_HANG_CHO[ma];
    return tenVai ? `Vai ${tenVai}: ${chu}` : chu;
  }
  return docChuoi(detail, "lyDo") ?? MO_TA_MA_HANG_CHO[ma];
}

// ── Bước kế tiếp ───────────────────────────────────────────────────────────────────────────────────────────
/** Người xem mở được trang đích nào — trang tính từ ĐÚNG cổng của trang đích, hàm này chỉ nhận kết quả. */
export type QuyenLienKet = {
  don: boolean;
  lead: boolean;
  chinhSach: boolean;
  nguoiPhuTrach: boolean;
  /** Mở được TRANG CHI TIẾT NGUỒN (`/nguon-hoa-hong/nguon/<mã>`) — chỗ khai/đổi chủ nguồn và chụp lại chủ nguồn cho lead cũ. */
  nguon: boolean;
};

export type BuocKeTiep = { buoc: string; lienKet: { nhan: string; href: string } | null };

const HREF_CHINH_SACH = "/nguon-hoa-hong/chinh-sach";
const HREF_MA_TRAN = "/nguon-hoa-hong/chinh-sach?xem=tat-ca";
const HREF_NGUOI_PHU_TRACH = "/crm/commission/nguoi-huong";
/** Mã vai (BeneficiaryRole.code) của người phụ trách NGUỒN — cùng mã mà resolver ghi vào `detail.vai`. Đây là mã VAI, không phải mã nguồn. */
export const VAI_CHU_NGUON = "SOURCE_OWNER";
/** Đích «Đối tượng liên quan» của trang chi tiết nguồn (id của tiêu đề mục — `MucChiTiet`). */
const hrefChiTietNguon = (code: string) => `/nguon-hoa-hong/nguon/${encodeURIComponent(code)}#muc-doi-tuong`;

export function hanhDongTiep(
  /** `nguonCode` = mã nguồn HIỆN HÀNH của lead của hàng chờ (null: đơn không lead / lead chưa có quy nguồn). BẮT BUỘC khai (luật 7) — quên là link chủ nguồn câm. */
  i: { ma: MaHold; detail: unknown; orderId: string | null; leadId: string | null; nguonCode: string | null },
  q: QuyenLienKet,
): BuocKeTiep {
  const don = (nhan: string): BuocKeTiep["lienKet"] => (q.don && i.orderId ? { nhan, href: `/orders/${i.orderId}` } : null);
  const lead = (nhan: string): BuocKeTiep["lienKet"] => (q.lead && i.leadId ? { nhan, href: `/leads/${i.leadId}` } : null);
  const chinhSach = (nhan: string, href: string): BuocKeTiep["lienKet"] => (q.chinhSach ? { nhan, href } : null);
  const nguon = (nhan: string): BuocKeTiep["lienKet"] => (q.nguon && i.nguonCode ? { nhan, href: hrefChiTietNguon(i.nguonCode) } : null);

  switch (i.ma) {
    case "UNRESOLVED_BENEFICIARY": {
      const lyDo = docChuoi(i.detail, "lyDo");
      if (lyDo === KHONG_CO_LEAD) return { buoc: "Nối đơn với lead rồi Tính lại kỳ", lienKet: don("Mở đơn") };
      if (lyDo === "CHUA_KHAI_NGUOI_PHU_TRACH") {
        return { buoc: "Khai người phụ trách của cơ sở", lienKet: q.nguoiPhuTrach ? { nhan: "Khai người phụ trách", href: HREF_NGUOI_PHU_TRACH } : null };
      }
      if (lyDo === "LEAD_THIEU_NGUOI") return { buoc: "Ghi người phụ trách trên lead", lienKet: lead("Mở lead") };
      // Hai hold của nguồn động (res3 MEDIUM-6, luật 12): chỗ sửa thật là LEAD (khối Nguồn), không phải màn Chính sách — trước đây cả hai rơi vào nhánh mặc định «Mở chính sách».
      // Sale phụ trách PH là BẢN CHỤP lúc ghi nhận nên không tự lành: phải điền tay (`boSungSalePhuHuynh`).
      if (lyDo === "THIEU_SALE_PHU_HUYNH") return { buoc: "Bổ sung Sale phụ trách phụ huynh ở khối Nguồn của lead", lienKet: lead("Mở lead") };
      // Chủ nguồn là BẢN CHỤP lúc ghi nhận (`signals.nguon`): khai/đổi chủ ở nguồn một mình KHÔNG làm lead đã ghi nhận đổi theo. Đường thoát hàng loạt là nút «Chụp lại chủ nguồn cho lead cũ» ở mục
      // «Đối tượng liên quan» của chính nguồn (cần sources:manage ∧ commission_policies:activate). Không có quyền xem nguồn thì còn lối «Đổi nguồn» từng lead ở trang lead.
      if (lyDo === "NGUON_CHUA_CO_NGUOI_PHU_TRACH") {
        return {
          buoc: "Khai người phụ trách ở nguồn (nhân sự còn làm việc, đã có tài khoản), rồi bấm «Chụp lại chủ nguồn cho lead cũ» — cần quyền sửa nguồn và kích hoạt chính sách",
          lienKet: nguon("Mở nguồn") ?? lead("Mở lead"),
        };
      }
      // `NGUOI_HUONG_NGHI` của vai KHÁC (Sale đã nghỉ…) không có đường chụp lại: rơi xuống nhánh mặc định như cũ.
      if (lyDo === "NGUOI_HUONG_NGHI" && docChuoi(i.detail, "vai") === VAI_CHU_NGUON) {
        return {
          buoc:
            "Người phụ trách nguồn đã nghỉ: đổi người phụ trách ở nguồn, rồi bấm «Chụp lại chủ nguồn cho lead cũ» — cần quyền sửa nguồn và kích hoạt chính sách. " +
            "Lead đã có khoản chi cho chủ cũ thì GIỮ chủ cũ (nút không chụp lại lead đó). Muốn chuyển người nhận của lead ấy chỉ có «Đổi nguồn» từng lead: nó TỰ GHI điều chỉnh thu hồi phần đã chi cho chủ cũ, không qua người duyệt",
          lienKet: nguon("Mở nguồn") ?? lead("Mở lead"),
        };
      }
      if (lyDo === "KHONG_QUY_VE_CO_SO") return { buoc: "Kiểm tra cơ sở của đơn", lienKet: don("Mở đơn") };
      return { buoc: "Kiểm tra cách xác định người nhận", lienKet: chinhSach("Mở chính sách", HREF_CHINH_SACH) };
    }
    case "POLICY_OVERLAP":
      return { buoc: "Sửa chính sách đang chồng nhau", lienKet: chinhSach("Xem ma trận chính sách", HREF_MA_TRAN) };
    case "CAP_EXCEEDED":
      return { buoc: "Giảm tỉ lệ cho tổng không vượt trần", lienKet: chinhSach("Xem ma trận chính sách", HREF_MA_TRAN) };
    case "PENDING_REGULATION":
      return { buoc: "Chờ văn bản quy định cho ca này", lienKet: chinhSach("Mở chính sách", HREF_CHINH_SACH) };
    case "NO_ORG_UNIT":
      return { buoc: "Gắn cơ sở của đơn vào cây đơn vị", lienKet: don("Mở đơn") };
    case "CHUA_GAN_CON":
      return { buoc: "Gắn khoản thu cho từng bé", lienKet: don("Mở đơn") };
    case "CHO_HOC_VIEN":
      return { buoc: "Chờ hồ sơ học viên được tạo", lienKet: don("Mở đơn") };
    case "INTERNAL_TRANSFER":
      return { buoc: "Duyệt: xác nhận cặp chuyển tiền", lienKet: don("Mở đơn") };
    case "NEGATIVE_WITHOUT_ORIGIN":
      return { buoc: "Tìm khoản thu gốc của bút toán âm", lienKet: don("Mở đơn") };
    case "INPUT_DRIFT": {
      // Chênh lệch ở vai CHỦ NGUỒN thường do đổi/chụp lại chủ nguồn hoặc chủ nghỉ việc: nhật ký của nguồn ghi LÝ DO và chủ cũ của từng lead (NGUON_CHUP_LAI_CHU) — người duyệt cần biết chỗ đọc.
      const chuNguon = chenhVaiChuNguon(i.detail);
      if (chuNguon) {
        // «Áp dụng» với phần ÂM là THU HỒI tiền đã tính cho người đó — nói thẳng số đồng, không để người duyệt tự suy từ chữ «chênh lệch».
        const thuHoi = chuNguon.thuHoi > 0 ? `«Áp dụng» sẽ THU HỒI ${soTienVN(chuNguon.thuHoi)} đ đã tính cho chủ nguồn cũ (đã nghỉ hoặc bị thay); «Giữ nguyên» nếu khoản đó phải được giữ. ` : "";
        return {
          buoc: `Duyệt: áp dụng hoặc giữ nguyên. ${thuHoi}Chênh lệch ở vai chủ nguồn — nếu vừa chụp lại chủ nguồn hoặc đổi người phụ trách, đọc nhật ký của nguồn (lý do và chủ cũ từng lead) trước khi quyết`,
          lienKet: don("Mở đơn"),
        };
      }
      return { buoc: "Duyệt: áp dụng hoặc giữ nguyên", lienKet: don("Mở đơn") };
    }
    case "PAYMENT_WITHDRAWN":
      return { buoc: "Duyệt: xác nhận khoản thu bị rút", lienKet: don("Mở đơn") };
    case "MANUAL_REVIEW_REQUIRED":
      return { buoc: "Duyệt: quyết định cách tính", lienKet: don("Mở đơn") };
    case "NEGATIVE_BALANCE":
      return { buoc: "Sổ âm ròng — kết chuyển kỳ sau", lienKet: null };
  }
}
