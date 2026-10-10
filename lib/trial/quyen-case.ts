/**
 * QUYỀN TRÊN MỘT CASE TRẢI NGHIỆM — hàm THUẦN, một chỗ duy nhất.
 *
 * Chủ dự án 23/09/2026: "sale được tuỳ thích gỡ gắn học viên vào case của mình, sale 1
 * cũng được gắn vào case của sale 2 được, nhưng sale 1 không thể gỡ học viên của sale 2
 * được, và sale cũng không thể xoá hoặc huỷ lớp".
 *
 * ── VÌ SAO TRẢ VỀ LÝ DO, KHÔNG PHẢI BOOLEAN ──────────────────────────────────────────
 * Một nút bị ẩn im lặng và một nút bấm vào thì báo lỗi đều để người dùng tự đoán. Luật
 * 12 của repo: affordance phải NÓI THẬT. Nên mỗi câu trả lời "không" mang theo câu chữ
 * mà giao diện in thẳng ra — và chính câu đó cũng là thông báo của Server Action, nên
 * hai cửa không thể nói hai kiểu.
 *
 * ── VÌ SAO "CỦA TÔI" ĐO BẰNG LEAD, KHÔNG BẰNG NGƯỜI GẮN ──────────────────────────────
 * Chủ dự án chốt: "chủ của lead thì gắn gỡ, ngoài ra qlcs/đào tạo hoặc admin gắn thì
 * sale chủ lead vẫn gỡ bth". Tức `TrialEnrollment.addedById` KHÔNG phải nguồn — nếu đo
 * bằng nó thì Quản lý cơ sở gắn hộ một lần là Sale chủ lead mất quyền gỡ chính khách
 * của mình, phải đi nhờ lại. Nguồn là `laLeadCuaToi` — cùng định nghĩa "lead của tôi"
 * mà `/admin/leads` và cửa GẮN đang dùng, không phải bản chép thứ hai.
 *
 * ⚠️ Hai câu hỏi KHÁC NHAU, đừng gộp:
 *   · Sửa/xoá CASE  → đo bằng NGƯỜI TẠO CASE (`TrialClassSession.createdById`).
 *   · Gỡ HỌC VIÊN   → đo bằng CHỦ LEAD của bé đó.
 * Một Sale có thể gỡ bé của mình ra khỏi case của người khác (đúng: đó là khách của
 * họ), nhưng không được sửa giờ case đó (đúng: đó là lịch hẹn của người khác).
 */
import { laLeadCuaToi } from "@/lib/lead/sharing";

export type KetQuyen = { duoc: true } | { duoc: false; lyDo: string };

const DUOC: KetQuyen = { duoc: true };

/**
 * Sửa giờ / phòng / giáo viên của một case, hoặc huỷ case đó.
 *
 * `nguoiTaoId === null` là case tạo TRƯỚC 23/09/2026 (cột `createdById` không backfill).
 * Những case đó **chỉ Quản lý cơ sở / Đào tạo đụng được**: không biết ai tạo thì cho
 * bất kỳ Sale nào sửa là mở toang, còn khoá hết mọi người thì lớp cũ không sửa nổi.
 */
export function quyenSuaCase(input: {
  nguoiTaoId: string | null;
  userId: string;
  /** Có `trials:create-class` — Quản lý cơ sở · Đào tạo · Quản trị tối cao. */
  laQuanLy: boolean;
}): KetQuyen {
  if (input.laQuanLy) return DUOC;
  if (input.nguoiTaoId === null) {
    return {
      duoc: false,
      lyDo:
        "Case này tạo trước 23/09/2026 nên hệ thống không biết của ai — " +
        "nhờ Quản lý cơ sở hoặc Đào tạo sửa hộ.",
    };
  }
  if (input.nguoiTaoId === input.userId) return DUOC;
  return {
    duoc: false,
    lyDo: "Case này do người khác tạo. Bạn xem được, nhưng chỉ người tạo hoặc Quản lý cơ sở mới sửa được giờ, phòng và giáo viên.",
  };
}

/**
 * Gỡ một học viên khỏi lớp / khỏi case.
 *
 * `lead === null` = bé không còn lead nào trỏ tới (lead đã xoá). Không suy ra chủ được
 * nên chỉ Quản lý cơ sở gỡ — fail-closed, và nói rõ vì sao.
 */
export function quyenGoHocVien(input: {
  lead: { assignedToId: string | null; createdById: string | null; isSharedWithTeam: boolean } | null;
  userId: string;
  /**
   * Là "quản lý khách trong lớp": có `trials:create-class` HOẶC `leads:view-all`
   * (Quản lý cơ sở · Đào tạo · Quản trị tối cao · Marketing Hội sở). Đường gọi quy sẵn
   * — xem `laQuanLyLead` ở `app/(admin)/admin/lop-trial/_actions.ts`.
   */
  laQuanLy: boolean;
  /** Tên Sale đang phụ trách lead, CHỈ để viết câu lỗi. Không tham gia phép quyết định. */
  tenSale?: string | null;
}): KetQuyen {
  if (input.laQuanLy) return DUOC;
  if (!input.lead) {
    return {
      duoc: false,
      lyDo: "Không tra được lead của bé này (lead đã xoá) — nhờ Quản lý cơ sở hoặc Đào tạo gỡ hộ.",
    };
  }
  if (laLeadCuaToi(input.lead, input.userId)) return DUOC;
  const ten = (input.tenSale ?? "").trim();
  return {
    duoc: false,
    lyDo: ten
      ? `Bé này thuộc lead của ${ten}. Bạn gắn thêm bé vào case được, nhưng chỉ người phụ trách lead, Quản lý cơ sở hoặc Đào tạo mới gỡ được.`
      : "Bé này thuộc lead của Sale khác. Bạn gắn thêm bé vào case được, nhưng chỉ người phụ trách lead, Quản lý cơ sở hoặc Đào tạo mới gỡ được.",
  };
}

/**
 * Xoá cả một case khi trong đó CÓ học viên của người khác.
 *
 * Vì sao phải hỏi riêng: `quyenSuaCase` chỉ nhìn người tạo case, nên chủ case sẽ xoá
 * được một case đang chứa khách của Sale khác — và bé đó rơi ra khỏi lịch hẹn mà người
 * phụ trách không hề biết. Xoá case là một lượt gỡ hàng loạt trá hình.
 *
 * `soHocVienNguoiKhac` đếm những bé mà NGƯỜI ĐANG BẤM không có quyền gỡ (tính bằng
 * `quyenGoHocVien` ở đường gọi — đừng đếm bằng luật thứ hai).
 */
export function quyenXoaCase(input: {
  nguoiTaoId: string | null;
  userId: string;
  laQuanLy: boolean;
  soHocVienNguoiKhac: number;
}): KetQuyen {
  const sua = quyenSuaCase(input);
  if (!sua.duoc) return sua;
  if (input.laQuanLy) return DUOC;
  if (input.soHocVienNguoiKhac > 0) {
    return {
      duoc: false,
      lyDo:
        `Case đang có ${input.soHocVienNguoiKhac} học viên của Sale khác. ` +
        "Xoá case là gỡ luôn lịch hẹn của họ — nhờ họ gỡ bé ra trước, hoặc nhờ Quản lý cơ sở xoá.",
    };
  }
  return DUOC;
}

/**
 * Dời GIỜ / NGÀY của một case (khác với chỉ đổi phòng / giáo viên).
 *
 * 23/09/2026 — dời giờ một case là dời giờ hẹn của MỌI phụ huynh có bé trong đó. Cửa
 * chuyển case và cửa huỷ case đã chặn Sale làm việc đó với khách của Sale khác; để cửa
 * sửa mở thì chủ case vẫn đổi được giờ hẹn của khách người khác, chỉ là qua cửa khác.
 *
 * Nhận `sua` là KẾT QUẢ của `quyenSuaCase` chứ không tự hỏi lại: không sửa được case thì
 * lý do phải là lý do của `quyenSuaCase`, không phải một câu thứ hai.
 *
 * `soHocVienNguoiKhac` đếm bằng `quyenGoHocVien` ở đường gọi — với Quản lý nó luôn là 0.
 */
export function quyenDoiGioCase(input: { sua: KetQuyen; soHocVienNguoiKhac: number }): KetQuyen {
  if (!input.sua.duoc) return input.sua;
  if (input.soHocVienNguoiKhac > 0) {
    return {
      duoc: false,
      lyDo:
        `Case đang có ${input.soHocVienNguoiKhac} học viên của Sale khác — đổi giờ là đổi lịch hẹn của phụ huynh họ. ` +
        "Chỉ đổi được phòng / giáo viên; muốn dời giờ thì nhờ họ chuyển bé sang case khác trước, hoặc nhờ Quản lý cơ sở.",
    };
  }
  return DUOC;
}

/**
 * Lý do khoá nút gỡ của bé đã HỌC XONG — server cũng từ chối (chỉ gỡ ghi danh ACTIVE).
 * Câu KHÔNG nói "khỏi lớp" hay "khỏi case": nó đứng trên cả hai nút (23/09).
 */
export const LY_DO_DA_HOC_XONG =
  "Bé đã học xong trải nghiệm — ghi danh này đã đóng, không còn gì để gỡ.";

/**
 * CHUYỂN một bé sang case khác (hoặc xếp bé đang "chưa xếp case").
 *
 * Luật y hệt `quyenGoHocVien` (chuyển case là đổi giờ hẹn — hại ngang gỡ), nhưng câu
 * chữ phải nói về việc CHUYỂN. Đo được 23/09: ô "Xếp vào case" bị khoá mượn câu của nút
 * Gỡ — "Bạn gắn thêm bé vào case được, nhưng…" — đọc trên chính ô xếp case thì như bảo
 * người dùng là họ xếp được.
 */
export function quyenChuyenCase(input: Parameters<typeof quyenGoHocVien>[0]): KetQuyen {
  const go = quyenGoHocVien(input);
  if (go.duoc) return go;
  if (!input.lead) {
    return {
      duoc: false,
      lyDo: "Không tra được lead của bé này (lead đã xoá) — nhờ Quản lý cơ sở hoặc Đào tạo chuyển hộ.",
    };
  }
  const ten = (input.tenSale ?? "").trim();
  return {
    duoc: false,
    lyDo:
      `Bé này thuộc lead của ${ten || "Sale khác"}. Chuyển case là đổi giờ hẹn với phụ huynh — ` +
      "chỉ người phụ trách lead, Quản lý cơ sở hoặc Đào tạo mới chuyển được.",
  };
}

/**
 * ĐIỂM DANH và HOÀN TẤT một case.
 *
 * Chủ dự án 23/09/2026 (hỏi: "Sale có được điểm danh và bấm Hoàn tất case của Sale khác
 * không?") — trả lời: "không". Case là đơn vị công việc của người mở nó; người khác
 * điểm danh thay là ghi có mặt cho khách không phải của mình, và "Hoàn tất" thì khoá case
 * vĩnh viễn (không có đường mở lại).
 *
 * ⚠️ CHỈ áp cho lớp THEO KHUNG. Lớp CŨ giữ nguyên hành vi trước đó (ai có
 * `trials:attendance` cũng điểm danh được): mọi buổi của lớp cũ có `createdById = NULL`
 * (cột mới, không backfill), nên áp luật "chỉ người tạo" ở đó là khoá điểm danh của MỌI
 * Sale trên toàn bộ lớp đang chạy trên prod.
 */
export function quyenDiemDanhCase(input: {
  /** BẮT BUỘC (luật 7) — thiếu nó thì không phân biệt nổi lớp cũ. */
  theoKhung: boolean;
  nguoiTaoId: string | null;
  userId: string;
  /** Có `trials:create-class` — Quản lý cơ sở · Đào tạo · Quản trị tối cao. */
  laQuanLy: boolean;
}): KetQuyen {
  if (!input.theoKhung) return DUOC;
  if (input.laQuanLy) return DUOC;
  if (input.nguoiTaoId !== null && input.nguoiTaoId === input.userId) return DUOC;
  return {
    duoc: false,
    lyDo:
      input.nguoiTaoId === null
        ? "Case này tạo trước 23/09/2026 nên không rõ của ai — nhờ Quản lý cơ sở hoặc Đào tạo điểm danh."
        : "Case này do Sale khác mở — chỉ người mở case, Quản lý cơ sở hoặc Đào tạo mới điểm danh và hoàn tất được.",
  };
}
