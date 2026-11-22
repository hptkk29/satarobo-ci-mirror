/**
 * Nhận (claim) bài DISC đang chờ — dịch vụ THUẦN theo cổng (tiêm vào), thiết kế lại theo chỉ đạo owner.
 *
 * MỐI NGUY: ai cũng gõ được SĐT của người khác ở màn Lưu. Bản cũ (`lietKeChoNhan`) liệt kê bài chỉ
 * dựa vào SĐT đã qua OTP — người gõ nhầm/giả mạo SĐT cấy được hồ sơ trẻ vào tài khoản chủ số, và chủ
 * số đọc được bài của người lạ. Đã GỠ.
 *
 * Nay nhận bài cần ĐỒNG THỜI (F-06, đợt 2):
 *   (a) SĐT đã xác minh OTP (purpose `DISC_CLAIM`, dùng `lib/otp/service` — KHÔNG tạo OTP mới), và
 *   (b) `maNhan` mà người LƯU được cấp lúc lưu (server chỉ giữ HMAC), và
 *   (c) THÁCH ĐỐ THỨ HAI: "năm sinh của con" khớp `DiscSubject(STUDENT).birthYear` của đúng bài khớp mã — chống SIM
 *       tái cấp/SIM-swap (OTP chỉ chứng minh ĐANG GIỮ số, không chứng minh là người đã làm bài).
 * (b)+(c) so khớp + đếm thử sai + khoá nằm trong MỘT phép ghi ở `thachDoStore.thu`: tối đa `TOI_DA_LAN_THU_NHAN` lần
 * thử trên cùng bài rồi khoá. Mọi lỗi (sai mã · sai năm sinh · hết hạn · đã khoá · bài của số khác · không có bài ·
 * sai dạng) trả CÙNG MỘT mã lỗi `MA_KHONG_KHOP` ⇒ phản hồi không tiết lộ "có bài hay không" hay "mã đúng nhưng năm sai".
 *
 * HAI GIÁ TRỊ SĐT — đừng nhầm (D2):
 *   · `sdtChuan`  = SĐT chuẩn hoá thô `84…`. Chỉ đi vào OTP (`otp.*`), tra `User.phone` (`taiKhoan.*`), so với phiên
 *                   đăng nhập, và lead.
 *   · `khoaSdt`   = `deps.khoaSdt(sdtChuan)` = HMAC. Chỉ đi vào bảng Disc* (`coBaiDangCho`, `thachDoStore`) và khoá
 *                   giới hạn tần suất. Đưa HMAC vào OTP ⇒ `normalizeOtpTarget` biến nó thành chuỗi không phải SĐT và
 *                   không tin nào được gửi.
 *
 * Thứ tự ở bước 2 (quan trọng): kiểm dạng (không tốn gì) → khớp phiên → TIÊU OTP → xét tài khoản → thách đố nguyên tử →
 * tạo/kích hoạt tài khoản → gắn có điều kiện. Bộ đếm thử CHỈ nhúc nhích SAU khi OTP đã chứng minh giữ số; nếu đếm
 * trước OTP thì ai chỉ biết SĐT cũng đốt được 3 lượt của chủ số. Tài khoản chỉ được tạo/kích hoạt SAU khi thách đố
 * qua — thử sai không để lại tài khoản ma.
 *
 * Hai bước công khai, đều do tầng action gọi:
 *   1. `yeuCauOtpNhan`  — gửi OTP CHỈ khi số này có bài đang chờ VÀ người nhận hợp lệ; phản hồi đồng nhất (không oracle).
 *   2. `nhanBaiDisc`    — xác minh OTP + mã nhận + năm sinh, rồi gắn bài.
 *
 * Tài khoản (phương án A đã chốt):
 *   · số CHƯA có User  ⇒ sau OTP + thách đố hợp lệ mới TẠO User PARENT (đặt mật khẩu như /kich-hoat);
 *   · số có User PENDING_ACTIVATION (vai PARENT) ⇒ kích hoạt như /kich-hoat;
 *   · số có User ACTIVE ⇒ BẮT BUỘC đang đăng nhập đúng tài khoản đó + OTP step-up. QUYẾT ĐỊNH (F-12): `yeuCauOtpNhan`
 *     KHÔNG gửi OTP khi số có User ACTIVE (hoặc vai khác / trạng thái lạ) mà người gọi chưa đăng nhập đúng tài khoản
 *     đó — và vẫn trả phản hồi CHUNG như mọi nhánh khác, nên không phải oracle dò "số này có tài khoản chưa". Không
 *     tiêu OTP/tiền ZNS cho một lượt chắc chắn bị từ chối. `CAN_DANG_NHAP` ở bước 2 chỉ còn là lưới an toàn cho
 *     ca đua (tài khoản ACTIVE xuất hiện giữa hai bước); nó chỉ lộ SAU khi người gọi đã chứng minh giữ SĐT.
 */
import { canonicalPhone } from "@/lib/phone";
import { bamMaNhan, chuanHoaMaNhan } from "./luu";
import { layKhoaDisc } from "./phone-key";

/** @deprecated Cổng liệt kê-theo-SĐT của bản cũ; `dangCho`/`nhan` đã bị gỡ ở store. Chỉ còn `tuChoi` cho store cũ. */
export type NhanStore = {
  dangCho: (phoneKey: string, now: Date) => Promise<Array<{ id: string; createdAt: Date; tenPhuHuynh: string; tenHocSinh: string }>>;
  nhan: (ids: string[], phoneKey: string, userId: string, now: Date) => Promise<number>;
  tuChoi: (ids: string[], phoneKey: string, now: Date) => Promise<number>;
};

/** "Nguyễn Thị Mai" ⇒ "N. T. M." — dùng khi cần hiển thị tên đã che. */
export function cheTen(ten: string): string {
  const phan = ten.trim().split(/\s+/).filter(Boolean);
  if (!phan.length) return "***";
  return phan.map((p) => `${p[0]!.toLocaleUpperCase("vi")}.`).join(" ");
}

export const MAT_KHAU_TOI_THIEU = 8;
/** Số lần thử (mã + năm sinh) tối đa cho MỘT bài trước khi khoá nhận. Đếm cả lần đúng — lần đúng kết thúc việc thử. */
export const TOI_DA_LAN_THU_NHAN = 3;
/** Trần số lần GỬI OTP nhận bài cho mỗi số mỗi ngày (F-10). Hằng cố định: thêm tham số vận hành = sửa registry (ngoài phạm vi). */
export const TRAN_OTP_NHAN_MOI_SDT_MOI_NGAY = 3;
/** Trần số lượt tiêu OTP nhận bài (đã có mã nhận đúng) cho mỗi HMAC-SĐT mỗi giờ (N3). */
export const TRAN_THU_NHAN_MOI_SDT_MOI_GIO = 10;

export type TrangThaiTaiKhoan = "ACTIVE" | "PENDING_ACTIVATION" | "KHAC";
export type TaiKhoanTimThay = { id: string; trangThai: TrangThaiTaiKhoan; laPhuHuynh: boolean };

/**
 * Năm sinh người dùng gõ ("2015" hoặc 2015). Sai dạng ⇒ null. Khoảng 1950–2100 chỉ để loại rác; việc "đúng/sai" do store so
 * với bản ghi — ở đây KHÔNG so với năm hiện tại để không lộ thông tin về bài.
 */
export function chuanHoaNamSinhCon(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && /^\s*\d{4}\s*$/.test(raw)) n = Number(raw.trim());
  else return null;
  return Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null;
}

/**
 * MỘT phép ghi nguyên tử, điều kiện nằm TRONG phép ghi (store Prisma làm trong một transaction):
 *  1. tăng `claimAttempts` cho các dòng PENDING_CLAIM của `phoneKey` còn dưới `toiDaLanThu` (chưa xoá, chưa hết hạn)
 *     — KHÔNG dòng nào tăng được ⇒ đã khoá ⇒ null (không phân biệt với "sai mã");
 *  2. CHỈ trong số dòng vừa được tăng: tìm dòng có `claimCodeHash` = maHash ∧ năm sinh của học sinh = namSinhCon;
 *  3. trả `{ submissionId }` nếu khớp, null nếu không. KHÔNG gắn bài (việc của `gan`) và KHÔNG ném khi sai — transaction
 *     PHẢI commit để bộ đếm được giữ lại.
 * Gửi song song N lượt đoán cũng chỉ được tối đa `toiDaLanThu` lượt chạm tới bước 2.
 */
export type ThachDoStore = {
  thu: (p: { phoneKey: string; maHash: string; namSinhCon: number; now: Date; toiDaLanThu: number }) => Promise<{ submissionId: string } | null>;
  /** Gắn có điều kiện: `PENDING_CLAIM ∧ phoneKey khớp ∧ chưa xoá` ⇒ `CLAIMED`. true = lượt này thắng (hai phiên đua ⇒ một thắng). */
  gan: (p: { submissionId: string; phoneKey: string; userId: string; now: Date }) => Promise<boolean>;
};

export type NhanDeps = {
  now: Date;
  thachDoStore: ThachDoStore;
  /** SĐT chuẩn hoá → khoá HMAC cho bảng Disc* (D2). Bắt buộc: quên truyền là `tsc` báo, không phải lỗi câm. */
  khoaSdt: (sdtChuan: string) => string;
  /** Số này (theo khoá HMAC) có bài PENDING_CLAIM còn hạn không (CHỈ để quyết định có gửi OTP — không bao giờ trả ra ngoài). */
  coBaiDangCho: (khoaSdt: string, now: Date) => Promise<boolean>;
  /**
   * Trần gửi OTP theo SỐ theo NGÀY. Gọi ĐÚNG MỘT LẦN, ngay trước khi gửi (tức đã qua mọi cổng khác), nên kẻ bơm yêu cầu
   * cho số lạ không tiêu hạn mức. true = được gửi. Hết hạn mức ⇒ nuốt về phản hồi chung.
   */
  choPhepGuiOtp: (khoaSdt: string) => Promise<boolean>;
  /**
   * CỔNG TRƯỚC `otp.xacMinh` (N3). Mỗi lượt `xacMinh` sai đốt 1/5 lượt thử của OTP THẬT đang treo của chủ số, nên không ai chỉ
   * biết SĐT được phép đốt nó. Cổng trả true CHỈ khi (a) số này có dòng PENDING_CLAIM còn hạn, chưa khoá, KHỚP `maHash`
   * (đọc thuần, KHÔNG đếm thử — không thêm oracle vì mọi lỗi sau đó ra cùng một thông điệp) và (b) chưa quá
   * `TRAN_THU_NHAN_MOI_SDT_MOI_GIO` lượt cho HMAC-SĐT. Ném/false ⇒ dừng, fail-closed. Bắt buộc: quên truyền là `tsc` báo.
   */
  choPhepThuOtp: (p: { khoaSdt: string; maHash: string; now: Date }) => Promise<boolean>;
  otp: {
    yeuCau: (sdtChuan: string) => Promise<{ ok: true; cooldownSec: number } | { ok: false; error: string; systemHalt?: boolean }>;
    xacMinh: (sdtChuan: string, code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  taiKhoan: {
    tim: (sdtChuan: string) => Promise<TaiKhoanTimThay | null>;
    taoPhuHuynh: (p: { phoneKey: string; matKhauHash: string; now: Date }) => Promise<{ id: string }>;
    kichHoat: (p: { userId: string; matKhauHash: string; now: Date }) => Promise<void>;
    /** Dọn tài khoản VỪA tạo trong chính lượt này khi bước gắn bài thất bại (không để lại tài khoản ma). */
    huyTaoMoi: (userId: string) => Promise<void>;
  };
  bamMatKhau: (matKhau: string) => Promise<string>;
  /** Khoá băm mã nhận; mặc định secret ký của ứng dụng (test tiêm khoá cố định). */
  khoaBam?: () => string;
  /**
   * Sau khi gắn bài thành công (chủ số đã qua OTP): bật đồng ý tiếp thị trên lead nếu bài có ghi nhận (F-09).
   * Best-effort — lỗi bị nuốt, không bao giờ làm hỏng việc nhận.
   */
  sauKhiNhan?: (p: { submissionId: string; sdtChuan: string; chuSoDongY: boolean }) => Promise<unknown>;
};

// ── Bước 1: xin OTP ──────────────────────────────────────────────────────────

export type PhienDangNhap = { userId: string; phoneKey: string | null };

export type PhanHoiYeuCauOtp =
  | { ok: true; cooldownSec: number }
  | { ok: false; loi: "SDT_KHONG_HOP_LE" | "HE_THONG_NGUNG"; thongBao: string };

/**
 * Phản hồi ĐỒNG NHẤT: số có bài / không có bài / tài khoản ACTIVE chưa đăng nhập / quá trần số-ngày / OTP đang cooldown /
 * quá hạn mức OTP / gửi hỏng đều ra `{ ok: true, cooldownSec }`. Chỉ lỗi KHÔNG phụ thuộc số (sai định dạng, hệ thống
 * ngắt) mới nói thật. Lớp trên PHẢI đã rate-limit theo IP và kéo thời gian phản hồi về một sàn (`padTiming`).
 */
export async function yeuCauOtpNhan(p: {
  soDienThoai: string;
  cooldownMacDinhSec: number;
  /** Phiên đăng nhập hiện tại (nếu có). Số có User ACTIVE chỉ được xin OTP khi đang đăng nhập đúng tài khoản đó. */
  phien: PhienDangNhap | null;
  deps: Pick<NhanDeps, "now" | "khoaSdt" | "coBaiDangCho" | "choPhepGuiOtp" | "otp" | "taiKhoan">;
}): Promise<PhanHoiYeuCauOtp> {
  const sdtChuan = canonicalPhone(p.soDienThoai);
  if (!sdtChuan) return { ok: false, loi: "SDT_KHONG_HOP_LE", thongBao: "Số điện thoại không hợp lệ" };
  const chung: PhanHoiYeuCauOtp = { ok: true, cooldownSec: p.cooldownMacDinhSec };
  const { deps } = p;
  const khoa = deps.khoaSdt(sdtChuan);

  // Không có bài chờ ⇒ KHÔNG đốt tiền Zalo cho số người lạ; vẫn trả đồng nhất.
  let co: boolean;
  try {
    co = await deps.coBaiDangCho(khoa, deps.now);
  } catch {
    return chung;
  }
  if (!co) return chung;

  // Người nhận hợp lệ? Đang đăng nhập khác số ⇒ bước 2 chắc chắn từ chối ⇒ đừng tốn OTP. Chưa đăng nhập đúng số này thì số
  // phải CHƯA có tài khoản, hoặc đang chờ kích hoạt (vai phụ huynh) — còn lại (ACTIVE / vai khác / trạng thái lạ) phải đăng nhập trước.
  const phienKhop = !!p.phien && p.phien.phoneKey === sdtChuan;
  if (p.phien && !phienKhop) return chung;
  if (!phienKhop) {
    let tk: TaiKhoanTimThay | null;
    try {
      tk = await deps.taiKhoan.tim(sdtChuan);
    } catch {
      return chung; // không xác định được ⇒ thà không gửi
    }
    if (tk && !(tk.trangThai === "PENDING_ACTIVATION" && tk.laPhuHuynh)) return chung;
  }

  // Trần theo số theo ngày — đặt SAU mọi cổng để kẻ bơm yêu cầu số lạ/không có bài không tiêu hạn mức của chủ số (F-10).
  let duoc: boolean;
  try {
    duoc = await deps.choPhepGuiOtp(khoa);
  } catch {
    return chung; // hạ tầng giới hạn lỗi ⇒ fail-closed (không gửi)
  }
  if (!duoc) return chung;

  const r = await deps.otp.yeuCau(sdtChuan);
  if (!r.ok && r.systemHalt) return { ok: false, loi: "HE_THONG_NGUNG", thongBao: r.error };
  return chung;
}

// ── Bước 2: xác minh + nhận ──────────────────────────────────────────────────

export type PhanHoiNhan =
  | { ok: true; submissionId: string; taoTaiKhoanMoi: boolean }
  | {
      ok: false;
      loi: "DU_LIEU_KHONG_HOP_LE" | "CAN_DANG_NHAP" | "MA_KHONG_KHOP" | "KHONG_HOP_LE";
      thongBao: string;
    };

const KHONG_NHAN_DUOC: PhanHoiNhan = {
  ok: false,
  loi: "MA_KHONG_KHOP",
  thongBao: "Không nhận được bài với thông tin này. Hãy kiểm tra số điện thoại, mã nhận và năm sinh của con, hoặc làm lại bài kiểm tra. Nếu bạn đã có tài khoản Sata Robo, hãy đăng nhập trước rồi nhận bài.",
};

export async function nhanBaiDisc(p: {
  soDienThoai: string;
  otp: string;
  maNhan: unknown;
  /** Năm sinh của con (thách đố thứ hai). */
  namSinhCon: unknown;
  /** Bắt buộc khi chưa đăng nhập (đặt mật khẩu cho tài khoản mới/chưa kích hoạt). */
  matKhau?: string | null;
  /** Ô tích RIÊNG của chủ số ở form nhận (sau OTP) — đồng ý tiếp thị của chính họ (N7). Mặc định false. */
  dongYTiepThi?: boolean;
  phien: PhienDangNhap | null;
  deps: NhanDeps;
}): Promise<PhanHoiNhan> {
  const { deps } = p;
  const sdtChuan = canonicalPhone(p.soDienThoai);
  // Server action là điểm vào công khai: kiểu TS không có hiệu lực lúc chạy. `otp` không phải chuỗi ⇒ lỗi dữ liệu (không ném TypeError).
  if (!sdtChuan || typeof p.otp !== "string" || !/^\d{6}$/.test(p.otp.trim())) {
    return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", thongBao: "Số điện thoại hoặc mã xác minh chưa đúng định dạng" };
  }
  // Mã nhận / năm sinh sai dạng ⇒ cùng thông điệp với sai giá trị (chưa tiêu OTP, chưa đếm thử — không có gì để đếm).
  const ma = chuanHoaMaNhan(p.maNhan);
  const namSinhCon = chuanHoaNamSinhCon(p.namSinhCon);
  if (!ma || namSinhCon === null) return KHONG_NHAN_DUOC;

  // Đang đăng nhập nhưng KHÔNG phải tài khoản của số này ⇒ từ chối trước khi tiêu OTP.
  if (p.phien && p.phien.phoneKey !== sdtChuan) {
    return { ok: false, loi: "KHONG_HOP_LE", thongBao: "Hãy đăng nhập đúng tài khoản dùng số điện thoại này, hoặc đăng xuất rồi thử lại." };
  }
  const matKhau = typeof p.matKhau === "string" ? p.matKhau.trim() : ""; // sai kiểu ⇒ coi như rỗng ⇒ bị chặn ngay dưới (khi chưa đăng nhập)
  if (!p.phien && matKhau.length < MAT_KHAU_TOI_THIEU) {
    return { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", thongBao: `Mật khẩu tối thiểu ${MAT_KHAU_TOI_THIEU} ký tự` };
  }

  // (a0) Cổng trước OTP (N3): không có mã nhận khớp / quá trần theo SĐT ⇒ dừng, KHÔNG đốt lượt OTP của chủ số.
  const khoaSdt = deps.khoaSdt(sdtChuan);
  const maHash = bamMaNhan(ma, (deps.khoaBam ?? layKhoaDisc)());
  let choThu: boolean;
  try {
    choThu = await deps.choPhepThuOtp({ khoaSdt, maHash, now: deps.now });
  } catch {
    return KHONG_NHAN_DUOC;
  }
  if (!choThu) return KHONG_NHAN_DUOC;

  // (a) Chứng minh giữ SĐT. Tiêu mã nguyên tử trong dịch vụ OTP. Lỗi OTP KHÔNG chuyển nguyên văn (D3: "Còn N lần thử" /
  // "đã dùng" / "hết hạn" phân biệt được trạng thái OTP của số) — cùng thông điệp với mọi lỗi nhận khác.
  const v = await deps.otp.xacMinh(sdtChuan, p.otp.trim());
  if (!v.ok) return KHONG_NHAN_DUOC;

  // (b) Xét tài khoản — chỉ đến đây khi người gọi ĐÃ chứng minh giữ SĐT (nên thông điệp riêng không phải oracle). Làm TRƯỚC thách
  // đố để ca "cần đăng nhập" không đốt lượt thử của bài.
  let tk: TaiKhoanTimThay | null = null;
  if (!p.phien) {
    try {
      tk = await deps.taiKhoan.tim(sdtChuan);
    } catch {
      return KHONG_NHAN_DUOC;
    }
    if (tk && tk.trangThai === "ACTIVE") {
      return { ok: false, loi: "CAN_DANG_NHAP", thongBao: "Số này đã có tài khoản. Vui lòng đăng nhập rồi nhận bài (cần xác minh mã mới)." };
    }
    if (tk && (tk.trangThai !== "PENDING_ACTIVATION" || !tk.laPhuHuynh)) {
      return { ok: false, loi: "KHONG_HOP_LE", thongBao: "Không thể nhận bài cho số này. Vui lòng liên hệ trung tâm." };
    }
  }

  // (c) Thách đố nguyên tử: mã nhận + năm sinh của con. Đếm thử sai + khoá nằm TRONG phép ghi của store.
  const thu = await deps.thachDoStore.thu({
    phoneKey: khoaSdt,
    maHash,
    namSinhCon,
    now: deps.now,
    toiDaLanThu: TOI_DA_LAN_THU_NHAN,
  });
  if (!thu) return KHONG_NHAN_DUOC;

  // (d) Tài khoản đích — chỉ tạo/kích hoạt SAU khi thách đố qua.
  let userId: string;
  let taoMoi = false;
  try {
    if (p.phien) {
      userId = p.phien.userId;
    } else {
      const hash = await deps.bamMatKhau(matKhau);
      if (tk) {
        userId = tk.id;
        await deps.taiKhoan.kichHoat({ userId, matKhauHash: hash, now: deps.now });
      } else {
        // Đua hai lượt cùng SĐT ⇒ unique(phone) ném: lượt thua KHÔNG được ghi đè tài khoản của lượt thắng.
        userId = (await deps.taiKhoan.taoPhuHuynh({ phoneKey: sdtChuan, matKhauHash: hash, now: deps.now })).id;
        taoMoi = true;
      }
    }
  } catch {
    return KHONG_NHAN_DUOC;
  }

  // (e) Gắn có điều kiện. Hai phiên cùng thắng thách đố ⇒ chỉ MỘT gắn được; bên thua dọn tài khoản vừa tạo.
  let daGan: boolean;
  try {
    daGan = await deps.thachDoStore.gan({ submissionId: thu.submissionId, phoneKey: khoaSdt, userId, now: deps.now });
  } catch {
    daGan = false;
  }
  if (!daGan) {
    if (taoMoi) await deps.taiKhoan.huyTaoMoi(userId).catch(() => {});
    return KHONG_NHAN_DUOC;
  }

  if (deps.sauKhiNhan) {
    try {
      await deps.sauKhiNhan({ submissionId: thu.submissionId, sdtChuan, chuSoDongY: p.dongYTiepThi === true });
    } catch {
      /* best-effort: việc nhận đã xong, thiếu bước bật tiếp thị còn hơn làm hỏng nhận */
    }
  }
  return { ok: true, submissionId: thu.submissionId, taoTaiKhoanMoi: taoMoi };
}
