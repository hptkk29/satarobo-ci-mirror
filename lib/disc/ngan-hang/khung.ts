/**
 * KHUNG CỦA NGÂN HÀNG CÂU MỞ RỘNG — nối 104 câu gốc với các HỌ HÀNH VI.
 *
 * 🔴 VÌ SAO CÓ KHUNG. Bộ đề gốc (`engine-goc/config/disc-cau-hoi.ts`) chốt cứng câu và thứ
 * tự để hai lần làm bài so được với nhau. Ngân hàng mở rộng muốn MỖI LẦN LÀM MỘT ĐỀ KHÁC mà
 * vẫn giữ được điều đó, nên nó không bốc câu tự do: mỗi câu gốc là MỘT Ô KHUNG, và một đề
 * mới chỉ thay câu trong từng ô bằng một câu CÙNG HỌ HÀNH VI, CÙNG TRỤC, CÙNG CHIỀU (thuận
 * hay đảo). Hệ quả, đúng theo cấu trúc chứ không nhờ may mắn:
 *   · số câu mỗi trục, số câu đảo mỗi trục, thứ tự trục trên màn — y hệt đề gốc;
 *   · `cham()` của engine gốc chấm đề mới mà KHÔNG sửa một dòng nào;
 *   · luật xếp thứ tự (`disc-thu-tu.ts`: vòng D-I-S-C, câu đảo không liền nhau, câu đầu là
 *     câu thuận) giữ nguyên vì đề mới đi theo đúng thứ tự ô của đề gốc.
 *
 * Thuộc TẦNG LÕI: hằng số + kiểu, không React, không DOM, không đọc đồng hồ.
 */

import type { MaBoDe, MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

/**
 * Phiên bản khung. ĐỔI khi đổi ánh xạ ô → họ, hoặc đổi nguyên liệu câu (`nguyen-lieu.ts`).
 * Hai bài khác phiên bản khung thì KHÔNG đối chiếu với nhau (cùng luật `KHAC_PHIEN_BAN` của
 * `doi-chieu.ts`).
 */
export const PHIEN_BAN_KHUNG = "nh1";

/** Mã họ hành vi. Hai chữ đầu là trục để đọc log cho nhanh; ĐỪNG suy trục từ mã ở mã nguồn. */
export const MA_HO = [
  // D — chủ động, quyết, thẳng
  "D-dan-dat",
  "D-xung-phong",
  "D-noi-thang",
  "D-canh-tranh",
  "D-giu-y",
  "D-dao",
  // I — giao tiếp, lan toả
  "I-ke-chuyen",
  "I-lam-quen",
  "I-bieu-dien",
  "I-khong-khi",
  "I-ket-noi",
  "I-dao",
  // S — ổn định, nhường, kiên nhẫn
  "S-nhuong",
  "S-biet-truoc",
  "S-kien-nhan",
  "S-an-ui",
  "S-nep-quen",
  "S-dao",
  // C — kỹ, đúng, có lý do
  "C-soat-lai",
  "C-chuan-muc",
  "C-huong-dan",
  "C-hoi-vi-sao",
  "C-ti-mi",
  "C-dao",
] as const;
export type MaHo = (typeof MA_HO)[number];

export type ThongTinHo = { readonly truc: MaTruc; readonly dao: boolean; readonly ten: string };

export const HO: Readonly<Record<MaHo, ThongTinHo>> = {
  "D-dan-dat": { truc: "D", dao: false, ten: "Dẫn dắt, chốt cách làm" },
  "D-xung-phong": { truc: "D", dao: false, ten: "Xung phong, nhận việc khó, dám thử" },
  "D-noi-thang": { truc: "D", dao: false, ten: "Nói thẳng, phản ứng ngay" },
  "D-canh-tranh": { truc: "D", dao: false, ten: "Thích thắng, đặt mục tiêu cao" },
  "D-giu-y": { truc: "D", dao: false, ten: "Giữ ý mình, tự quyết" },
  "D-dao": { truc: "D", dao: true, ten: "(đảo) Để người khác quyết" },
  "I-ke-chuyen": { truc: "I", dao: false, ten: "Kể chuyện, thuyết phục bằng câu chuyện" },
  "I-lam-quen": { truc: "I", dao: false, ten: "Làm quen, bắt chuyện" },
  "I-bieu-dien": { truc: "I", dao: false, ten: "Đứng trước đông người" },
  "I-khong-khi": { truc: "I", dao: false, ten: "Làm không khí vui, biểu cảm" },
  "I-ket-noi": { truc: "I", dao: false, ten: "Rủ rê, khen, được khen" },
  "I-dao": { truc: "I", dao: true, ten: "(đảo) Thích một mình, ngại đông" },
  "S-nhuong": { truc: "S", dao: false, ten: "Nhường để êm" },
  "S-biet-truoc": { truc: "S", dao: false, ten: "Cần biết trước, cần thời gian quen" },
  "S-kien-nhan": { truc: "S", dao: false, ten: "Kiên nhẫn chờ, nghe hết" },
  "S-an-ui": { truc: "S", dao: false, ten: "An ủi, được tìm đến để tâm sự" },
  "S-nep-quen": { truc: "S", dao: false, ten: "Giữ nếp, làm xong việc dở" },
  "S-dao": { truc: "S", dao: true, ten: "(đảo) Thích đổi, không ngại xáo trộn" },
  "C-soat-lai": { truc: "C", dao: false, ten: "Soát lại, tìm hiểu kỹ" },
  "C-chuan-muc": { truc: "C", dao: false, ten: "Ngăn nắp, khó chịu khi ẩu" },
  "C-huong-dan": { truc: "C", dao: false, ten: "Làm đúng hướng dẫn, đúng quy trình" },
  "C-hoi-vi-sao": { truc: "C", dao: false, ten: "Hỏi lý do, cần số liệu" },
  "C-ti-mi": { truc: "C", dao: false, ten: "Tỉ mỉ, ghi chép, lên kế hoạch" },
  "C-dao": { truc: "C", dao: true, ten: "(đảo) Làm trước tính sau" },
};

/**
 * Ô KHUNG → HỌ. Khoá là MÃ CÂU GỐC. Mỗi bộ đề dùng mỗi họ TỐI ĐA MỘT LẦN (test canh), nên
 * trong một đề không bao giờ có hai câu cùng hành vi.
 */
export const O_KHUNG: Readonly<Record<string, MaHo>> = {
  // MN — bé 3–7, bố mẹ trả lời hộ
  "MN-D1": "D-dan-dat", "MN-D2": "D-giu-y", "MN-D3": "D-noi-thang", "MN-D4": "D-xung-phong", "MN-D5": "D-dao",
  "MN-I1": "I-ke-chuyen", "MN-I2": "I-lam-quen", "MN-I3": "I-bieu-dien", "MN-I4": "I-khong-khi", "MN-I5": "I-dao",
  "MN-S1": "S-nhuong", "MN-S2": "S-biet-truoc", "MN-S3": "S-an-ui", "MN-S4": "S-nep-quen", "MN-S5": "S-dao",
  "MN-C1": "C-chuan-muc", "MN-C2": "C-huong-dan", "MN-C3": "C-ti-mi", "MN-C4": "C-hoi-vi-sao", "MN-C5": "C-dao",
  // TH — lớp 3–5 tự làm
  "TH-D1": "D-dan-dat", "TH-D2": "D-xung-phong", "TH-D3": "D-noi-thang", "TH-D4": "D-canh-tranh", "TH-D5": "D-dao",
  "TH-I1": "I-ke-chuyen", "TH-I2": "I-lam-quen", "TH-I3": "I-ket-noi", "TH-I4": "I-khong-khi", "TH-I5": "I-dao",
  "TH-S1": "S-kien-nhan", "TH-S2": "S-nhuong", "TH-S3": "S-nep-quen", "TH-S4": "S-an-ui", "TH-S5": "S-dao",
  "TH-C1": "C-chuan-muc", "TH-C2": "C-soat-lai", "TH-C3": "C-huong-dan", "TH-C4": "C-hoi-vi-sao", "TH-C5": "C-dao",
  // THCS — lớp 6–9 tự làm
  "THCS-D1": "D-dan-dat", "THCS-D2": "D-xung-phong", "THCS-D3": "D-noi-thang", "THCS-D4": "D-canh-tranh", "THCS-D5": "D-giu-y", "THCS-D6": "D-dao",
  "THCS-I1": "I-lam-quen", "THCS-I2": "I-ke-chuyen", "THCS-I3": "I-bieu-dien", "THCS-I4": "I-ket-noi", "THCS-I5": "I-khong-khi", "THCS-I6": "I-dao",
  "THCS-S1": "S-nep-quen", "THCS-S2": "S-an-ui", "THCS-S3": "S-nhuong", "THCS-S4": "S-biet-truoc", "THCS-S5": "S-kien-nhan", "THCS-S6": "S-dao",
  "THCS-C1": "C-soat-lai", "THCS-C2": "C-huong-dan", "THCS-C3": "C-chuan-muc", "THCS-C4": "C-hoi-vi-sao", "THCS-C5": "C-ti-mi", "THCS-C6": "C-dao",
  // PH — phụ huynh tự làm
  "PH-D1": "D-dan-dat", "PH-D2": "D-noi-thang", "PH-D3": "D-xung-phong", "PH-D4": "D-canh-tranh", "PH-D5": "D-giu-y", "PH-D6": "D-dao",
  "PH-I1": "I-lam-quen", "PH-I2": "I-ke-chuyen", "PH-I3": "I-khong-khi", "PH-I4": "I-bieu-dien", "PH-I5": "I-ket-noi", "PH-I6": "I-dao",
  "PH-S1": "S-nep-quen", "PH-S2": "S-nhuong", "PH-S3": "S-kien-nhan", "PH-S4": "S-biet-truoc", "PH-S5": "S-an-ui", "PH-S6": "S-dao",
  "PH-C1": "C-soat-lai", "PH-C2": "C-chuan-muc", "PH-C3": "C-huong-dan", "PH-C4": "C-hoi-vi-sao", "PH-C5": "C-ti-mi", "PH-C6": "C-dao",
  // QS — bố mẹ nhìn con 8–15
  "QS-D1": "D-giu-y", "QS-D2": "D-xung-phong", "QS-D3": "D-noi-thang", "QS-D4": "D-dao",
  "QS-I1": "I-ke-chuyen", "QS-I2": "I-lam-quen", "QS-I3": "I-bieu-dien", "QS-I4": "I-dao",
  "QS-S1": "S-nhuong", "QS-S2": "S-biet-truoc", "QS-S3": "S-kien-nhan", "QS-S4": "S-dao",
  "QS-C1": "C-soat-lai", "QS-C2": "C-hoi-vi-sao", "QS-C3": "C-chuan-muc", "QS-C4": "C-dao",
};

/**
 * Tầng câu chữ. Một bộ đề có thể bốc từ nhiều tầng (QS bốc cả câu tiểu học lẫn THCS vì bộ
 * QS phủ con 8–15 tuổi).
 */
export const TANG = ["be", "em", "teen", "lon"] as const;
export type Tang = (typeof TANG)[number];

/** Nhóm bối cảnh: h = học / chỗ làm · n = trong nhà · b = bạn bè, chỗ đông người. */
export type NhomBoiCanh = "h" | "n" | "b";

export type CachXung = {
  /** Chủ ngữ đứng đầu vế câu. Rỗng với MN: câu dẫn đã là "Bé thường…". */
  readonly chuNgu: string;
  /** Khi người đó là tân ngữ: "không làm {tan} khó chịu". */
  readonly tan: string;
  readonly tang: readonly Tang[];
  /**
   * Nhóm bối cảnh được dùng. QS chỉ lấy trong nhà và bạn bè: câu dẫn của bộ QS bắt bố mẹ
   * "chỉ trả lời theo những gì THẬT SỰ nhìn thấy", mà ở lớp thì bố mẹ không nhìn thấy.
   */
  readonly nhom: readonly NhomBoiCanh[];
};

export const CACH_XUNG: Readonly<Record<MaBoDe, CachXung>> = {
  MN: { chuNgu: "", tan: "bé", tang: ["be"], nhom: ["h", "n", "b"] },
  TH: { chuNgu: "em", tan: "em", tang: ["em"], nhom: ["h", "n", "b"] },
  THCS: { chuNgu: "mình", tan: "mình", tang: ["teen"], nhom: ["h", "n", "b"] },
  PH: { chuNgu: "tôi", tan: "tôi", tang: ["lon"], nhom: ["h", "n", "b"] },
  QS: { chuNgu: "con tôi", tan: "con", tang: ["em", "teen"], nhom: ["n", "b"] },
};

/**
 * CÂU BỊ GỠ KHỎI RỔ BỐC — mã câu → lý do (bắt buộc có lý do, có ngày, có người duyệt).
 *
 * Gỡ câu KHÔNG đổi ý nghĩa của điểm (câu còn lại vẫn cùng khung), nên KHÔNG tăng
 * `PHIEN_BAN_KHUNG`. Câu vẫn nằm trong ngân hàng để bài cũ đã dùng nó còn đọc lại được.
 * Nguồn đề xuất: `hieuChinh()` gắn thẻ `DE_XUAT_LOAI`.
 */
export const CAU_LOAI_TRU: Readonly<Record<string, string>> = {};

