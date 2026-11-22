/**
 * Làm bài DISC NGAY TRONG cổng học viên — người đã đăng nhập (PARENT) không phải nhập lại hồ sơ.
 *
 * Quy tắc:
 *  - Hồ sơ dựng từ TÀI KHOẢN + học viên của chính họ (tên, SĐT đăng nhập, năm sinh/lớp của con). Chỉ hỏi PHẦN CÒN THIẾU
 *    (năm sinh của ba/mẹ, năm sinh của con) — những thứ hệ thống chưa lưu ở đâu.
 *  - `userId` và quyền với `studentId` lấy từ PHIÊN + DB (`docNguon` trả null khi con không thuộc tài khoản) — KHÔNG tin client.
 *  - Lưu bằng đúng đường `luuKetQuaDisc` (server tự chấm, cùng cổng hạn mức/idempotent) rồi gắn bài về tài khoản NGAY
 *    (đã đăng nhập ⇒ không cần OTP/mã nhận như người lạ nhận bài). Không tạo lead: họ đã là khách của Sata Robo.
 *  - Lớp của con suy theo NĂM HỌC từ năm sinh (`bacHocTuNamSinh`); chỉ khi chưa có ngày sinh mới dùng `currentGrade` đã lưu.
 */
import { bacHocTuNamSinh, BAC_HOC, type BacHoc } from "./ho-so";
import type { PhanHoiLuu } from "./luu";

/** Dữ liệu đọc từ DB về gia đình này; `null` ở từng trường = hệ thống chưa có. */
export type NguonHoSoPortal = {
  /** SĐT đăng nhập của tài khoản (dạng đã lưu). null ⇒ tài khoản đăng nhập bằng email, chưa có SĐT. */
  soDienThoai: string | null;
  tenPhuHuynh: string | null;
  tenHocSinh: string;
  namSinhPhuHuynh: number | null;
  namSinhHocSinh: number | null;
  /** Lớp đã lưu trên hồ sơ học viên (1–12); chỉ dùng khi chưa có năm sinh. */
  lopDaLuu: number | null;
};

export type BoSungHoSo = { namSinhPhuHuynh?: number; namSinhHocSinh?: number };

export type TruongThieu = "namSinhPhuHuynh" | "namSinhHocSinh";

export type HoSoPortal = {
  phuHuynh: { hoTen: string; vaiTro: "NGUOI_GIAM_HO"; namSinh: number };
  hocSinh: { hoTen: string; namSinh: number; bacHoc: BacHoc };
};

const namHopLe = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1900 && n <= 2100;

/**
 * Dựng hồ sơ từ nguồn + phần bổ sung. THUẦN. Thiếu gì ⇒ trả danh sách thiếu (UI chỉ hỏi đúng các mục đó).
 * Tuổi/độ hợp lý vẫn do `kiemTraHoSo` trong `luuKetQuaDisc` kiểm lại — hàm này không tự bịa số nào.
 */
export function dungHoSoPortal(
  nguon: NguonHoSoPortal,
  boSung: BoSungHoSo,
  now: Date,
): { ok: true; hoSo: HoSoPortal } | { ok: false; thieu: TruongThieu[] } {
  const nsPH = namHopLe(nguon.namSinhPhuHuynh) ? nguon.namSinhPhuHuynh : namHopLe(boSung.namSinhPhuHuynh) ? boSung.namSinhPhuHuynh : null;
  const nsHS = namHopLe(nguon.namSinhHocSinh) ? nguon.namSinhHocSinh : namHopLe(boSung.namSinhHocSinh) ? boSung.namSinhHocSinh : null;
  const thieu: TruongThieu[] = [];
  if (nsPH === null) thieu.push("namSinhPhuHuynh");
  if (nsHS === null) thieu.push("namSinhHocSinh");
  if (nsPH === null || nsHS === null) return { ok: false, thieu };

  // Lớp: theo năm sinh + năm học; chỉ khi năm sinh nằm ngoài khoảng suy được thì dùng lớp đã lưu.
  let bac: BacHoc | null = bacHocTuNamSinh(nsHS, now);
  if (!bac && nguon.lopDaLuu !== null && BAC_HOC.includes(String(nguon.lopDaLuu) as BacHoc)) bac = String(nguon.lopDaLuu) as BacHoc;
  if (!bac) return { ok: false, thieu: ["namSinhHocSinh"] };

  return {
    ok: true,
    hoSo: {
      phuHuynh: { hoTen: nguon.tenPhuHuynh?.trim() || "Phụ huynh", vaiTro: "NGUOI_GIAM_HO", namSinh: nsPH },
      hocSinh: { hoTen: nguon.tenHocSinh, namSinh: nsHS, bacHoc: bac },
    },
  };
}

export type YeuCauLuuPortal = {
  userId: string;
  studentId: string;
  idempotencyKey: string;
  boSung: BoSungHoSo;
  /** Câu trả lời thô của hai bộ (cùng hình với `LuuInput["bai"]`). */
  bai: unknown;
};

export type KetQuaLuuPortal =
  | { ok: true; submissionId: string }
  | {
      ok: false;
      loi: "KHONG_CO_QUYEN" | "THIEU_SDT" | "THIEU_HO_SO" | "DU_LIEU_KHONG_HOP_LE" | "LUU_THAT_BAI" | "ENGINE_CHUA_SAN_SANG" | "QUA_NHIEU_YEU_CAU";
      thieu?: TruongThieu[];
      chiTiet?: Array<{ truong: string; thongBao: string }>;
    };

export type LuuPortalDeps = {
  /** Đọc gia đình CỦA userId; con không thuộc tài khoản ⇒ null. */
  docNguon: (userId: string, studentId: string) => Promise<NguonHoSoPortal | null>;
  /** Đường lưu thật (`luuKetQuaDisc` đã gắn store/engine). Nhận object thô như body của /api/disc/luu. */
  luu: (raw: unknown) => Promise<PhanHoiLuu>;
  /** Gắn bài về tài khoản (PENDING_CLAIM ⇒ CLAIMED, có điều kiện). true = gắn được. */
  ganChoChu: (d: { submissionId: string; soDienThoai: string; userId: string; now: Date }) => Promise<boolean>;
  /** Xoá bài vừa lưu khi không gắn được (không để bài mồ côi chờ "nhận" bởi người lạ). */
  huyBai: (d: { submissionId: string; soDienThoai: string; now: Date }) => Promise<void>;
  now?: () => Date;
};

export async function luuBaiTrongPortal(y: YeuCauLuuPortal, deps: LuuPortalDeps): Promise<KetQuaLuuPortal> {
  const now = (deps.now ?? (() => new Date()))();
  const nguon = await deps.docNguon(y.userId, y.studentId);
  if (!nguon) return { ok: false, loi: "KHONG_CO_QUYEN" };
  if (!nguon.soDienThoai) return { ok: false, loi: "THIEU_SDT" };

  const h = dungHoSoPortal(nguon, y.boSung, now);
  if (!h.ok) return { ok: false, loi: "THIEU_HO_SO", thieu: h.thieu };

  const r = await deps.luu({
    idempotencyKey: y.idempotencyKey,
    soDienThoai: nguon.soDienThoai,
    email: null,
    // Đồng ý xử lý hồ sơ do người dùng tích ở bước xác nhận (server action đã đòi `true`); KHÔNG đồng ý tiếp thị ở luồng này.
    dongY: { xuLyHoSo: true, tiepThi: false },
    phuHuynh: h.hoSo.phuHuynh,
    hocSinh: h.hoSo.hocSinh,
    bai: y.bai,
  });
  if (!r.ok) {
    return { ok: false, loi: r.loi, ...(r.chiTiet ? { chiTiet: r.chiTiet } : {}) };
  }

  const ganDuoc = await deps
    .ganChoChu({ submissionId: r.submissionId, soDienThoai: nguon.soDienThoai, userId: y.userId, now })
    .catch(() => false);
  if (!ganDuoc) {
    // Không để dữ liệu của trẻ nằm chờ ở trạng thái "ai có mã thì nhận được".
    try {
      await deps.huyBai({ submissionId: r.submissionId, soDienThoai: nguon.soDienThoai, now });
    } catch {
      /* cron hết hạn sẽ dọn */
    }
    return { ok: false, loi: "LUU_THAT_BAI" };
  }
  return { ok: true, submissionId: r.submissionId };
}

