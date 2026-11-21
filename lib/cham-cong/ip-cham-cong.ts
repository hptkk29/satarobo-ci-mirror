// lib/cham-cong/ip-cham-cong.ts — luật DANH SÁCH IP khi chấm công tại điểm (P2.4, 11/10/2026). THUẦN.
//
// Bốn chế độ (`shift.ipCheDo`):
//   OFF      — không kiểm (mặc định).
//   OBSERVE  — kiểm và GHI kết quả (`StaffTimeLog.ipRule`) — không cờ, không chặn. Thu dữ liệu trước khi siết.
//   WARNING  — như OBSERVE + gắn cờ `IP_NGOAI_DANH_SACH` để quản lý rà, người chấm thấy cảnh báo. Không chặn.
//   ENFORCE  — ngoài danh sách ⇒ CHẶN.
//
// Ba lối KHÔNG BAO GIỜ chặn — để không khoá cửa hàng loạt:
//   · ngữ cảnh được miễn (`quyenChamNgoai`: ca công tác · đi công tác · làm từ xa · chấm ngoài địa điểm đã duyệt);
//   · điểm chấm CHƯA khai danh sách IP;
//   · không đọc được IP tin cậy (proxy cấu hình sai ⇒ cả công ty cùng "không IP") — gắn cờ thay vì chặn.
import { mucKhop } from "@/lib/security/ip-cidr";

export const CHE_DO_IP = ["OFF", "OBSERVE", "WARNING", "ENFORCE"] as const;
export type CheDoIp = (typeof CHE_DO_IP)[number];

export const CO_IP = { NGOAI_DS: "IP_NGOAI_DANH_SACH", KHONG_XAC_DINH: "IP_KHONG_XAC_DINH" } as const;

/** Giá trị `StaffTimeLog.ipRule` không phải một mục danh sách. */
export const LUAT_IP = {
  MIEN: "MIEN", // + ":<lý do>"
  CHUA_KHAI: "CHUA_KHAI",
  KHONG_XAC_DINH: "KHONG_XAC_DINH_IP",
  NGOAI_DS: "NGOAI_DS",
} as const;

export type KetQuaIp =
  | { ipRule: string | null; cho: true; co: string | null }
  | { ipRule: string; cho: false; loi: string };

export function quyetDinhIp(input: {
  cheDo: CheDoIp;
  danhSach: readonly string[];
  /** IP nguồn TIN CẬY (`ipNguonTinCay`) — null = không xác định được. */
  ip: string | null;
  /** Lý do miễn của ngữ cảnh (`quyenChamNgoai(...).lyDo`), null = không miễn. BẮT BUỘC khai (luật 7). */
  mien: string | null;
}): KetQuaIp {
  if (input.cheDo === "OFF") return { ipRule: null, cho: true, co: null };
  if (input.mien) return { ipRule: `${LUAT_IP.MIEN}:${input.mien}`, cho: true, co: null };
  if (input.danhSach.length === 0) return { ipRule: LUAT_IP.CHUA_KHAI, cho: true, co: null };
  if (!input.ip) {
    return { ipRule: LUAT_IP.KHONG_XAC_DINH, cho: true, co: input.cheDo === "OBSERVE" ? null : CO_IP.KHONG_XAC_DINH };
  }
  const khop = mucKhop(input.ip, input.danhSach);
  if (khop) return { ipRule: khop, cho: true, co: null };
  if (input.cheDo === "OBSERVE") return { ipRule: LUAT_IP.NGOAI_DS, cho: true, co: null };
  if (input.cheDo === "WARNING") return { ipRule: LUAT_IP.NGOAI_DS, cho: true, co: CO_IP.NGOAI_DS };
  return {
    ipRule: LUAT_IP.NGOAI_DS,
    cho: false,
    loi: "Mạng bạn đang dùng không thuộc mạng của cơ sở — kết nối Wi-Fi của cơ sở rồi chấm lại. Nếu đang làm ngoài, nộp đơn làm từ xa / chấm ngoài địa điểm.",
  };
}

/** OBSERVE/WARNING đọc lại: lượt này nếu ở ENFORCE thì có bị chặn không. */
export const seBiChan = (ipRule: string | null) => ipRule === LUAT_IP.NGOAI_DS;
