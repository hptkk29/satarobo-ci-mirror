// lib/portal/hv-tinh-cach-thuan.ts — Cổng học sinh, tab "Robot tính cách" (artifact HV-San-pham): phần THUẦN. Không DB.
//
// CHỈ hiện khi bé CÓ kết quả DISC thật (do phụ huynh làm trong Cổng phụ huynh, lưu ở `lib/disc`). Bản thiết kế còn có bài
// khám phá 3 câu "Chơi lại" — hệ thống DISC thật dùng bộ đề riêng nên KHÔNG vẽ nút đó; làm lại bài thì ba mẹ làm trong Cổng phụ huynh.

export type NhomDisc = "D" | "I" | "S" | "C";
export type DiemDiscHs = { D: number; I: number; S: number; C: number };

export const TEN_ROBOT: Record<NhomDisc, string> = {
  D: "Robot Tiên Phong",
  I: "Robot Năng Lượng",
  S: "Robot Bảo Vệ",
  C: "Robot Kỹ Sư",
};

export const TEN_TINH_CACH: Record<NhomDisc, string> = { D: "Quyết đoán", I: "Ảnh hưởng", S: "Kiên định", C: "Chuẩn xác" };

/** Màu thanh + nền thẻ theo token — KHÔNG hex: đổi sáng/tối cùng nhau. */
export const MAU_NHOM: Record<NhomDisc, { thanh: string; nen: string }> = {
  D: { thanh: "var(--sr-orange-text)", nen: "var(--sr-tint-orange)" },
  I: { thanh: "var(--sr-orange)", nen: "var(--sr-tint-orange)" },
  S: { thanh: "var(--sr-success)", nen: "var(--sr-success-bg)" },
  C: { thanh: "var(--sr-purple-text)", nen: "var(--sr-tint-purple)" },
};

export const KY_HIEU: Record<NhomDisc, string> = { D: "⚡", I: "★", S: "♥", C: "⚙" };

export type NoiDungNhom = { cau: string; manh: string[]; tot: string[]; meo: string[] };

/** Lời cho từng kiểu robot — chép từ bản thiết kế. */
export const NOI_DUNG: Record<NhomDisc, NoiDungNhom> = {
  I: {
    cau: "Em vui vẻ, thích kể chuyện và làm cả lớp cùng hào hứng.",
    manh: ["Nghĩ ra nhiều ý tưởng mới", "Làm bạn bè cười, kéo cả nhóm vào việc", "Dám đứng lên trình bày"],
    tot: ["Được làm cùng bạn", "Được kể cho mọi người nghe em làm gì", "Có trò chơi, có thử thách vui"],
    meo: ["Viết nhanh 3 ý trước khi nói để không quên", "Làm xong một phần rồi mới sang ý mới", "Nghe bạn nói hết rồi mới góp ý"],
  },
  C: {
    cau: "Em cẩn thận, thích hiểu vì sao và làm thật đúng.",
    manh: ["Làm đúng bản vẽ, ít sai", "Tìm ra lỗi chương trình rất giỏi", "Giải thích rõ ràng từng bước"],
    tot: ["Có hướng dẫn rõ ràng", "Có thời gian suy nghĩ", "Được kiểm tra lại bài"],
    meo: ["Chưa hoàn hảo cũng cứ thử — sai thì sửa", "Nói ý của em ra, cả nhóm cần nghe", "Đặt giờ để không làm một phần quá lâu"],
  },
  D: {
    cau: "Em thích dẫn đầu, quyết nhanh và muốn thắng thử thách.",
    manh: ["Dám nhận việc khó", "Giúp nhóm quyết định nhanh", "Không bỏ cuộc giữa chừng"],
    tot: ["Có mục tiêu rõ", "Được tự chọn cách làm", "Có thi đua, có kết quả"],
    meo: ["Hỏi ý bạn trước khi quyết", "Chậm lại một chút để kiểm tra kỹ", "Khen bạn khi bạn làm tốt"],
  },
  S: {
    cau: "Em hiền, kiên nhẫn và là người bạn ai cũng tin.",
    manh: ["Giúp bạn khi bạn gặp khó", "Làm đều tay đến cuối", "Giữ nhóm vui vẻ, không cãi nhau"],
    tot: ["Biết trước sẽ làm gì", "Làm cùng bạn thân", "Không bị vội"],
    meo: ["Mạnh dạn nói khi em không đồng ý", "Thử việc mới dù chưa quen", "Giơ tay hỏi khi chưa hiểu"],
  },
};

const THU_TU: NhomDisc[] = ["D", "I", "S", "C"];

export type RobotCuaBe = {
  chinh: NhomDisc;
  phu: NhomDisc;
  /** Phần trăm cả bốn kiểu (đã kẹp 0–100) cho thanh "ai cũng có một chút của cả bốn". */
  thanh: Record<NhomDisc, number>;
};

/**
 * Kiểu robot chính/phụ = hai điểm CAO NHẤT. Bằng điểm thì giữ thứ tự D, I, S, C (tất định). Cả bốn điểm bằng nhau hoặc toàn 0 ⇒
 * `null`: không có kiểu nào nổi bật thì KHÔNG gán nhãn cho một em nhỏ.
 */
export function chonRobot(diem: DiemDiscHs): RobotCuaBe | null {
  const keP = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
  const thanh: Record<NhomDisc, number> = { D: keP(diem.D), I: keP(diem.I), S: keP(diem.S), C: keP(diem.C) };
  const xep = [...THU_TU].sort((a, b) => thanh[b] - thanh[a] || THU_TU.indexOf(a) - THU_TU.indexOf(b));
  const [chinh, phu] = xep as [NhomDisc, NhomDisc];
  if (thanh[chinh] <= 0 || thanh[chinh] === thanh[xep[3] as NhomDisc]) return null;
  return { chinh, phu, thanh };
}

export type LichSuNguoiTho = {
  vaiTro: "PHU_HUYNH" | "HOC_SINH";
  hoTen: string;
  moc: { diem: DiemDiscHs }[];
};

const chuanTen = (t: string) => t.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");

/**
 * Tìm kết quả DISC của đúng em này trong lịch sử gia đình. Khớp theo VAI HỌC SINH + TÊN chuẩn hoá. Không khớp ai, hoặc khớp HƠN MỘT
 * người (hai anh em trùng tên) ⇒ `null`: gắn nhầm kết quả của anh chị cho em còn tệ hơn không hiện. Kết quả = lần làm MỚI NHẤT.
 * (Hạn chế đã biết: lịch sử gia đình chưa mang năm sinh nên chưa đối chiếu được năm sinh.)
 */
export function timDiemCuaBe(lichSu: readonly LichSuNguoiTho[], tenBe: string): DiemDiscHs | null {
  const khop = lichSu.filter((n) => n.vaiTro === "HOC_SINH" && chuanTen(n.hoTen) === chuanTen(tenBe));
  if (khop.length !== 1) return null;
  const moc = khop[0]!.moc;
  return moc.length > 0 ? moc[moc.length - 1]!.diem : null;
}
