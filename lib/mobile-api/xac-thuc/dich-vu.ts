import bcrypt from "bcryptjs";
import { z } from "zod";
import type { MobileSession, Prisma } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { lyDoMatKhauYeu } from "@/lib/auth/mat-khau-yeu";
import { canonicalPhone } from "@/lib/phone";
import { isLoginLimiterV2Enabled } from "@/lib/flags";
import { duocTatChanTanSuatDangNhap } from "@/lib/security/client-ip";
import { LoiKhongDemDuoc as LoiKhongDemDuocChung, kiemTruocDangNhap, type KetQuaKiemTruoc } from "@/lib/security/gioi-han-dang-nhap/cong";
import { loginSchema } from "@/lib/validators/auth";

import { LoiKhongDemDuoc, demDangNhap, demMotKhoa } from "./dem-lan-thu";
import { MOBILE_AUTH, type LyDoThuHoi } from "./hang-so";
import { bamBiMat, bamKhoaDem, bamKhop, phatCapToken, sinhMaTra, tachToken, type CapToken } from "./token";
import { thuHoiTokenCuaPhien } from "./thu-hoi-token-push";

/**
 * DỊCH VỤ XÁC THỰC DI ĐỘNG — docs/mobile/11_BACKEND_MOBILE_API_DESIGN.md mục 3 (bảng quyết định R0–R6, thu hồi, cổng chung).
 *
 * Không biết gì về HTTP: route chỉ gọi hàm ở đây rồi đổi `LoiApiMobile` thành phản hồi. Không bao giờ ghi token / băm / mật khẩu / định danh
 * đăng nhập (ca thất bại) ra log hay nhật ký kiểm toán.
 */

export class LoiApiMobile extends Error {
  /** V8.43 — dữ liệu có cấu trúc đi kèm lỗi nghiệp vụ (đặt bằng Object.assign); `traLoi` đưa vào `error.chiTiet`. */
  chiTiet?: unknown;
  constructor(
    public readonly code:
      | "INVALID_CREDENTIALS"
      | "UNAUTHENTICATED"
      | "TOKEN_EXPIRED"
      | "TOKEN_REVOKED"
      | "RATE_LIMITED"
      | "SERVER"
      | "ROLE_NOT_ALLOWED"
      | "POLICY_REQUIRED"
      | "NOT_FOUND"
      | "VALIDATION"
      | "FORBIDDEN"
      | "PASSWORD_INCORRECT"
      // LMS (B-LMS2/3): mã nghiệp vụ riêng cho bài tập / bài thi
      | "DA_DONG"
      | "DA_CHAM"
      | "TEP_CHUA_HO_TRO"
      | "NOI_DUNG_DA_DOI"
      | "LUOT_DA_NOP"
      | "TEP_KHONG_HOP_LE"
      | "HET_GIO"
      | "HET_LUOT"
      | "CHUA_MO"
      | "DE_CHUA_HO_TRO"
      // V8.20: đánh giá giáo viên (H-Danh-gia)
      | "DOT_DA_DONG"
      | "KHONG_DUOC_DANH_GIA"
      | "DA_DANH_GIA"
      // V8.2: kho ảnh buổi học chưa cấu hình ký URL ⇒ không phục vụ ảnh (không bao giờ URL công khai)
      | "MEDIA_CHUA_SAN_SANG"
      // V8.5: chat phụ huynh
      | "CHAT_POLICY_REQUIRED"
      | "CHAT_KHONG_GUI_DUOC"
      // V8.6: kho tệp hoá đơn chưa sẵn sàng ⇒ không cấp liên kết tải (không bao giờ URL công khai)
      | "KHO_HOA_DON_CHUA_SAN_SANG"
      // V8.9: mã lỗi ỔN ĐỊNH của lõi E-learning Online (bảng HTTP_THEO_MA_LOI của `hoc-vien-dto.ts`) — app hiện câu chữ theo mã
      | "KHONG_CO_QUYEN"
      | "DA_THU_HOI"
      | "HET_HAN"
      | "KHOA_CHUA_PHAT_HANH"
      | "BAI_KHONG_TON_TAI"
      | "BAI_DA_AN"
      | "BAI_CHUA_MO"
      | "DA_HOAN_THANH_KHONG_XEM_LAI"
      | "CAI_DAT_KHONG_HOP_LE"
      // V8.12: ghi tiến độ + làm bài (cùng bảng HTTP_THEO_MA_LOI của E)
      | "LOAI_BAI_KHONG_GHI_TRUC_TIEP"
      | "THIEU_DU_LIEU"
      | "BAI_KHONG_PHAI_DANH_GIA"
      | "CHUA_GAN_DE"
      | "DE_KHONG_HOAT_DONG"
      | "DE_RONG"
      | "HET_LUOT"
      | "HET_GIO"
      | "LUOT_KHONG_TON_TAI"
      | "DE_KHONG_TON_TAI"
      // ONLINE P2 (mua khoá): mã nghiệp vụ của `lib/online-checkout/tao-don.ts` + huỷ đơn
      | "GIO_RONG" | "QUA_NHIEU_DONG" | "THIEU_HOC_VIEN" | "THIEU_KHOA" | "TRUNG_CAP_KHOA_HOC_VIEN" | "DU_LIEU_SAI"
      | "THIEU_HO_SO_PHU_HUYNH" | "THIEU_HO_SO_HOC_VIEN" | "KHOA_KHONG_TON_TAI" | "KHOA_KHONG_DANG_BAN" | "GIA_KHONG_HOP_LE"
      | "DA_TRON_DOI" | "KHOA_KHONG_CHO_GIA_HAN" | "KY_HAN_THIEU" | "CHUA_CO_QUYEN_DE_GIA_HAN" | "CHUA_DU_TIEN_QUYET"
      | "MA_KHONG_TON_TAI" | "MA_KHONG_DUNG_DUOC" | "MA_HET_LUOT_CUA_CON" | "MA_HET_SUAT" | "DON_0_DONG" | "DA_CO_DON_DANG_CHO"
      | "DA_CO_TIEN" | "DA_CAP_QUYEN" | "SAI_TRANG_THAI"
      // V8.24: nháp / tiếp tục bài thi Online (khung adapter — mã TẠM chờ lõi E chốt; xem lib/mobile-api/online-thi/hop-dong.ts)
      | "DRAFT_VERSION_CONFLICT" | "ATTEMPT_CLOSED" | "CAU_HOI_KHONG_THUOC_DE" | "DAP_AN_KHONG_HOP_LE"
      // V8.45: OTP kích hoạt / đặt lại mật khẩu (`lib/mobile-api/dich-vu/otp-tai-khoan.ts`) — mã ổn định cho client
      | "OTP_INVALID" | "OTP_EXPIRED" | "OTP_TOO_MANY_ATTEMPTS" | "OTP_SERVICE_PAUSED",
    public readonly status: number,
    message: string,
    public readonly retryAfterGiay?: number,
    /** V8.30 — mã CHI TIẾT ổn định (không dịch) cho xung đột nghiệp vụ; `code` giữ nguyên (VD `VALIDATION`). Tuỳ chọn: client cũ bỏ qua trường lạ. */
    public readonly maChiTiet?: string,
  ) {
    super(message);
    this.name = "LoiApiMobile";
  }
}

const loi = {
  thongTinSai: () => new LoiApiMobile("INVALID_CREDENTIALS", 401, "Số điện thoại / email hoặc mật khẩu chưa đúng."),
  chuaDangNhap: () => new LoiApiMobile("UNAUTHENTICATED", 401, "Chưa đăng nhập hoặc phiên không còn hợp lệ."),
  hetHan: () => new LoiApiMobile("TOKEN_EXPIRED", 401, "Phiên truy cập đã hết hạn."),
  daThuHoi: () => new LoiApiMobile("TOKEN_REVOKED", 401, "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại."),
  chamTran: (giay: number) => new LoiApiMobile("RATE_LIMITED", 429, "Thử quá nhiều lần. Vui lòng chờ một lát rồi thử lại.", giay),
  bận: (giay: number) => new LoiApiMobile("SERVER", 503, "Hệ thống đang bận. Vui lòng thử lại sau ít phút.", giay),
};

export type NguCanh = { ip: string; now: Date };

/** Băm bcrypt (cost 10) của một chuỗi vô nghĩa — chỉ để tốn thời gian so sánh khi không có tài khoản dùng được. KHÔNG phải mật khẩu của ai. */
const BAM_GIA = "$2b$10$MwsLjwcc.VjR.B9EamwjduX2UgEpyKVySxSSOP/TyPRBbA.5ysDj2";
export type ThietBi = { maThietBi: string; nenTang: "ios" | "android"; tenMay?: string; phienBanApp?: string };
export type PhanHoiToken = { accessToken: string; refreshToken: string; hetHanSau: number };

/** "Phụ huynh thuần" (mục 3.6): `role = PARENT` VÀ mọi phần tử của `roles[]` đều là PARENT (hợp của cả hai cột). */
export function laPhuHuynhThuan(u: { role: string; roles: string[] }): boolean {
  const roles = u.roles.length > 0 ? u.roles : [u.role];
  return u.role === "PARENT" && roles.every((r) => r === "PARENT");
}

const hetHanSau = (): number => Math.floor(MOBILE_AUTH.accessTtlMs / 1000);

function hanAccess(now: Date, tuyetDoi: Date): Date {
  return new Date(Math.min(now.getTime() + MOBILE_AUTH.accessTtlMs, tuyetDoi.getTime()));
}
function hanKhongDung(now: Date, tuyetDoi: Date): Date {
  return new Date(Math.min(now.getTime() + MOBILE_AUTH.khongDungTtlMs, tuyetDoi.getTime()));
}

type Client = Prisma.TransactionClient | typeof db;

/**
 * THU HỒI — MỘT lệnh ghi, MỘT hàm (bản rà P-11): đặt `thuHoiLuc`, `lyDoThuHoi` và xoá BỐN cột token trong cùng một UPDATE có điều kiện
 * `thuHoiLuc IS NULL`. Trả `true` khi lệnh này là lệnh thu hồi (false = đã bị thu hồi từ trước).
 */
export async function thuHoi(client: Client, id: string, lyDo: LyDoThuHoi, now: Date): Promise<boolean> {
  const r = await client.mobileSession.updateMany({
    where: { id, thuHoiLuc: null },
    data: { thuHoiLuc: now, lyDoThuHoi: lyDo, accessHash: null, accessHetHan: null, refreshHash: null, refreshHashTruoc: null },
  });
  const daThuHoi = r.count === 1;
  // V8.1 — token push của phiên chết CÙNG phiên (một điểm thu hồi duy nhất ⇒ đăng xuất / đổi mật khẩu / hết hạn / khoá tài khoản đều đi qua đây).
  if (daThuHoi) await thuHoiTokenCuaPhien(client, id, lyDo, now);
  return daThuHoi;
}

async function ghiKiemToan(
  userId: string | null,
  sessionId: string,
  action: string,
  ctx: NguCanh,
  newValues?: Record<string, unknown>,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  // Không ghi token, băm, mật khẩu, định danh. Mã tra KHÔNG vào đây (dùng `id` của dòng phiên).
  try {
    await writeAudit({
      actor: { id: userId, name: userId ? "Phụ huynh (app)" : "Hệ thống (app)" },
      module: "mobile-auth",
      entityType: "MobileSession",
      entityId: sessionId,
      action,
      newValues: newValues ?? null,
      ip: ctx.ip,
      tx,
    });
  } catch {
    // Kiểm toán hỏng không được làm hỏng việc đăng xuất / thu hồi (thu hồi là hướng an toàn).
    if (tx) throw new Error("ghi kiểm toán thất bại");
  }
}

// ───────────────────────────── ĐĂNG NHẬP ─────────────────────────────

export async function dangNhap(
  input: { dinhDanh: string; matKhau: string; thietBi: ThietBi },
  ctx: NguCanh,
): Promise<PhanHoiToken> {
  // 1. Lược đồ + chuẩn hoá định danh như web (loginSchema, canonicalPhone).
  const parsed = loginSchema.safeParse({ identifier: input.dinhDanh, password: input.matKhau });
  if (!parsed.success) throw loi.thongTinSai();
  const identifier = parsed.data.identifier;
  const canonical = canonicalPhone(identifier);

  // 2. Giới hạn tần suất: khoá CHUẨN HOÁ trước (canonical / lowercase). Không đếm được ⇒ 503, không cho qua.
  // B4: cờ `LOGIN_LIMITER_V2` (mặc định TẮT) ⇒ bộ giới hạn DÙNG CHUNG với web; TẮT ⇒ đúng đường cũ.
  let luotDangNhap: Extract<KetQuaKiemTruoc, { cho: true }> | null = null;
  if (!duocTatChanTanSuatDangNhap() && isLoginLimiterV2Enabled()) {
    try {
      const q = await kiemTruocDangNhap("mobile", ctx.ip, identifier, ctx.now);
      if (!q.cho) {
        await ghiKiemToan(null, "rate-limit", "LOGIN_RATE_LIMITED", ctx);
        throw loi.chamTran(q.thuLaiSauGiay);
      }
      luotDangNhap = q;
    } catch (e) {
      if (e instanceof LoiKhongDemDuocChung) throw loi.bận(30);
      throw e;
    }
  } else if (!duocTatChanTanSuatDangNhap()) {
    try {
      const d = MOBILE_AUTH.dangNhap;
      const kq = await demDangNhap({
        khoaIp: bamKhoaDem("login:ip", ctx.ip),
        khoaDinhDanh: bamKhoaDem("login:id", canonical ?? identifier.toLowerCase()),
        now: ctx.now,
        cuaSoMs: d.cuaSoMs,
        nguongIp: d.nguongIp,
        nguongDinhDanh: d.nguongDinhDanh,
      });
      if (kq.chamTran) {
        await ghiKiemToan(null, "rate-limit", "LOGIN_RATE_LIMITED", ctx);
        throw loi.chamTran(Math.ceil(d.cuaSoMs / 1000));
      }
    } catch (e) {
      if (e instanceof LoiKhongDemDuoc) throw loi.bận(30);
      throw e;
    }
  }

  // 3. Tra tài khoản và so mật khẩu như web (email giữ nguyên hoa/thường như web).
  const user = await db.user.findFirst({
    where: canonical ? { phone: canonical } : { email: identifier },
    select: { id: true, name: true, password: true, role: true, roles: true, isActive: true, deletedAt: true, accountStatus: true },
  });
  // KHÔNG lộ "tài khoản có tồn tại không" qua THỜI GIAN phản hồi (B3.5): mọi nhánh thất bại đều tốn đúng MỘT lượt bcrypt (so với băm giả khi không có tài khoản dùng được).
  // Tài khoản nhân viên (mật khẩu băm cost 12 ở màn Cài đặt web) KHÔNG được so bằng băm thật: app này chỉ nhận phụ huynh (băm cost 10), nên so băm thật của nhân viên sẽ chậm gấp ~4 lần
  // và lộ "số này là nhân viên". Mọi nhánh thất bại ⇒ đúng một lượt so cost 10.
  const dungDuoc = !!user && !!user.password && !user.deletedAt && user.isActive && user.accountStatus === "ACTIVE" && laPhuHuynhThuan(user);
  const dung = await bcrypt.compare(parsed.data.password, dungDuoc ? (user!.password as string) : BAM_GIA);
  if (!dungDuoc || !dung || !user) throw loi.thongTinSai();

  // 4. Chỉ nhận phụ huynh thuần. Cùng một mã lỗi với sai mật khẩu (không lộ "đây là tài khoản nhân viên").
  if (!laPhuHuynhThuan(user)) throw loi.thongTinSai();
  await luotDangNhap?.thanhCong(); // B4: chỉ khi ĐÚNG mật khẩu VÀ là phụ huynh thuần (cờ BẬT)

  // 5. Ghi lastLoginAt SAU khi điều kiện đạt (tài khoản nhân viên bị app từ chối không bị ghi đăng nhập).
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: ctx.now } });

  // 6. Tạo phiên — một giao dịch.
  const maTra = sinhMaTra();
  const cap = phatCapToken(maTra);
  const tuyetDoi = new Date(ctx.now.getTime() + MOBILE_AUTH.tuyetDoiTtlMs);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`; // $executeRaw: cột trả về kiểu void, $queryRaw không đọc được
    const tv = await tx.user.findUnique({ where: { id: user.id }, select: { tokenVersion: true } });
    if (!tv) throw loi.thongTinSai();

    // (a) thay phiên sống của ĐÚNG (user, thiết bị) này
    const cu = await tx.mobileSession.findFirst({ where: { userId: user.id, maThietBi: input.thietBi.maThietBi, thuHoiLuc: null }, select: { id: true } });
    if (cu) await thuHoi(tx, cu.id, "dang-nhap-lai", ctx.now);

    // (b) đánh dấu hết hạn các phiên quá hạn chưa đánh dấu, rồi giữ tối đa N phiên sống
    const quaHan = await tx.mobileSession.findMany({
      where: { userId: user.id, thuHoiLuc: null, OR: [{ hetHanKhongDung: { lte: ctx.now } }, { hetHanTuyetDoi: { lte: ctx.now } }] },
      select: { id: true },
    });
    for (const p of quaHan) await thuHoi(tx, p.id, "het-han", ctx.now);
    const song = await tx.mobileSession.findMany({
      where: { userId: user.id, thuHoiLuc: null },
      select: { id: true, lanDungCuoi: true, createdAt: true },
    });
    const du = song.length - (MOBILE_AUTH.toiDaPhienSong - 1);
    if (du > 0) {
      const xep = [...song].sort(
        (a, b) =>
          (a.lanDungCuoi ?? a.createdAt).getTime() - (b.lanDungCuoi ?? b.createdAt).getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
      for (const p of xep.slice(0, du)) await thuHoi(tx, p.id, "vuot-so-thiet-bi", ctx.now);
    }

    // (c) phiên mới, cặp token ở trạng thái CHƯA xác nhận
    const moi = await tx.mobileSession.create({
      data: {
        userId: user.id,
        maTra,
        maThietBi: input.thietBi.maThietBi,
        nenTang: input.thietBi.nenTang,
        tenMay: input.thietBi.tenMay ?? null,
        phienBanApp: input.thietBi.phienBanApp ?? null,
        accessHash: cap.accessHash,
        accessHetHan: hanAccess(ctx.now, tuyetDoi),
        refreshHash: cap.refreshHash,
        refreshHashTruoc: null,
        xoayLuc: ctx.now,
        xacNhanLuc: null,
        hetHanKhongDung: hanKhongDung(ctx.now, tuyetDoi),
        hetHanTuyetDoi: tuyetDoi,
        tokenVersionLucCap: tv.tokenVersion,
        lanDungCuoi: ctx.now,
      },
      select: { id: true },
    });
    await ghiKiemToan(user.id, moi.id, "SESSION_CREATED", ctx, { nenTang: input.thietBi.nenTang }, tx);
  });

  return { accessToken: cap.accessToken, refreshToken: cap.refreshToken, hetHanSau: hetHanSau() };
}

// ───────────────────────────── CỔNG ACCESS TOKEN ─────────────────────────────

/** `hocSinhId` ≠ null ⇒ phiên đang KHOÁ ở chế độ học sinh (H-S3) vào đúng học viên này — cổng chung (`cong.ts`) chặn mọi endpoint ngoài danh sách học sinh được xem. */
export type NguoiGoi = { userId: string; sessionId: string; name: string; email: string; phone: string | null; hocSinhId: string | null; /** Phiên bản app client KHAI lúc đăng nhập (`MobileSession.phienBanApp`) — chỉ dùng cho TƯƠNG THÍCH (cổng phiên bản tối thiểu của DISC PIN), KHÔNG phải bằng chứng bảo mật. */ phienBanApp?: string | null };

/**
 * Cổng chung xác thực access token (mục 2.1 / 3.3 / 3.4). Mọi endpoint đã đăng nhập đi qua đây.
 *  - Token sai dạng / không tra ra phiên / bí mật không khớp băm hiện hành ⇒ 401 UNAUTHENTICATED (KHÔNG thu hồi: ca lành tính của yêu cầu đang bay).
 *  - Phiên đã thu hồi ⇒ 401 TOKEN_REVOKED.
 *  - Khớp băm nhưng access hết hạn ⇒ XÁC NHẬN cặp rồi mới trả 401 TOKEN_EXPIRED (nó chứng minh app đã nhận cặp này).
 *  - Phiên quá hạn không dùng / quá trần tuyệt đối ⇒ thu hồi `het-han`, 401 UNAUTHENTICATED.
 *  - User không còn / bị khoá / xoá mềm / accountStatus khác ACTIVE / tokenVersion lệch / không còn phụ huynh thuần ⇒ thu hồi `tai-khoan`, 401 TOKEN_REVOKED.
 */
export async function xacThucAccess(authorization: string | null, ctx: NguCanh): Promise<NguoiGoi> {
  const raw = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  const tok = tachToken(raw, "access");
  if (!tok) throw loi.chuaDangNhap();
  const p = await db.mobileSession.findUnique({ where: { maTra: tok.maTra } });
  if (!p) throw loi.chuaDangNhap();
  if (p.thuHoiLuc) throw loi.daThuHoi();
  if (!bamKhop(bamBiMat(tok.biMat), p.accessHash)) throw loi.chuaDangNhap();

  // Xác nhận cặp (một lệnh ghi có điều kiện; hai yêu cầu song song: một bên ghi, bên kia ghi 0 dòng).
  if (!p.xacNhanLuc) {
    await db.mobileSession.updateMany({
      where: { id: p.id, accessHash: p.accessHash, xacNhanLuc: null, thuHoiLuc: null },
      data: { xacNhanLuc: ctx.now, lanDungCuoi: ctx.now },
    });
  }
  if (!p.accessHetHan || p.accessHetHan <= ctx.now) throw loi.hetHan();

  if (p.hetHanKhongDung <= ctx.now || p.hetHanTuyetDoi <= ctx.now) {
    await thuHoi(db, p.id, "het-han", ctx.now);
    throw loi.chuaDangNhap();
  }
  const u = await docNguoiDung(p.userId);
  if (!u || !nguoiDungConSong(u, p)) {
    if (await thuHoi(db, p.id, "tai-khoan", ctx.now)) await ghiKiemToan(p.userId, p.id, "SESSION_REVOKED", ctx, { lyDo: "tai-khoan" });
    throw loi.daThuHoi();
  }
  return { userId: u.id, sessionId: p.id, name: u.name ?? "", email: u.email ?? "", phone: u.phone, hocSinhId: p.hocSinhId, phienBanApp: p.phienBanApp ?? null };
}

async function docNguoiDung(id: string) {
  return db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, phone: true, role: true, roles: true, isActive: true, deletedAt: true, accountStatus: true, tokenVersion: true },
  });
}
function nguoiDungConSong(
  u: { role: string; roles: string[]; isActive: boolean; deletedAt: Date | null; accountStatus: string; tokenVersion: number },
  p: Pick<MobileSession, "tokenVersionLucCap">,
): boolean {
  return u.isActive && !u.deletedAt && u.accountStatus === "ACTIVE" && u.tokenVersion === p.tokenVersionLucCap && laPhuHuynhThuan(u);
}

// ───────────────────────────── LÀM MỚI (R0–R6) ─────────────────────────────

/**
 * Làm mới token theo ĐÚNG bảng quyết định ở mục 3.3 (R0…R6). `h` là SHA-256 của bí mật gửi lên;
 * `H` = băm refresh hiện hành, `T` = băm liền trước, `X` = thời điểm cặp hiện hành được dùng lần đầu.
 */
/** SEC-13: tối đa bấy nhiêu lần CẤP LẠI (R5) trong cửa sổ này; lần kế tiếp ⇒ thu hồi phiên (dùng lại token). */
const R5_TOI_DA = 2;
const R5_CUA_SO_MS = 15 * 60_000;

export async function lamMoi(refreshToken: unknown, ctx: NguCanh): Promise<PhanHoiToken> {
  const tok = tachToken(refreshToken, "refresh"); // R0 (gồm access token gửi nhầm)
  const ip = bamKhoaDem("refresh:ip", ctx.ip);

  if (!tok) {
    await chanTheoIp("refresh", ip, ctx.now, MOBILE_AUTH.lamMoi.cuaSoMs, MOBILE_AUTH.lamMoi.nguongIp);
    throw loi.chuaDangNhap();
  }

  for (let luot = 0; luot < 2; luot++) {
    const p = await db.mobileSession.findUnique({ where: { maTra: tok.maTra } });
    if (!p) {
      await chanTheoIp("refresh", ip, ctx.now, MOBILE_AUTH.lamMoi.cuaSoMs, MOBILE_AUTH.lamMoi.nguongIp); // R0: mã tra không ứng với phiên nào
      throw loi.chuaDangNhap();
    }
    await chanTheoPhien(p.id, ctx.now);
    if (p.thuHoiLuc) throw loi.daThuHoi(); // R1

    if (p.hetHanKhongDung <= ctx.now || p.hetHanTuyetDoi <= ctx.now) {
      await thuHoi(db, p.id, "het-han", ctx.now); // R2
      throw loi.chuaDangNhap();
    }
    const u = await docNguoiDung(p.userId);
    if (!u || !nguoiDungConSong(u, p)) {
      if (await thuHoi(db, p.id, "tai-khoan", ctx.now)) await ghiKiemToan(p.userId, p.id, "SESSION_REVOKED", ctx, { lyDo: "tai-khoan" }); // R3
      throw loi.daThuHoi();
    }

    const h = bamBiMat(tok.biMat);
    const tuyetDoi = p.hetHanTuyetDoi;
    const cap = phatCapToken(p.maTra);

    if (bamKhop(h, p.refreshHash)) {
      // R4 — XOAY: T := H; H + băm access := mới; X := trống; gia hạn "không dùng".
      const r = await db.mobileSession.updateMany({
        where: { id: p.id, refreshHash: p.refreshHash, thuHoiLuc: null },
        data: {
          refreshHashTruoc: p.refreshHash,
          refreshHash: cap.refreshHash,
          accessHash: cap.accessHash,
          accessHetHan: hanAccess(ctx.now, tuyetDoi),
          xoayLuc: ctx.now,
          xacNhanLuc: null,
          hetHanKhongDung: hanKhongDung(ctx.now, tuyetDoi),
          lanDungCuoi: ctx.now,
        },
      });
      if (r.count === 1) return traCap(cap);
      continue; // trạng thái đổi giữa lúc đọc và lúc ghi: đọc lại, xét lại ĐÚNG một lần
    }

    if (bamKhop(h, p.refreshHashTruoc) && !p.xacNhanLuc) {
      // R5 — CẤP LẠI: H + băm access := mới; T GIỮ NGUYÊN; X vẫn trống. Cặp phát lần trước mất hiệu lực.
      // SEC-13 (V8.45): R5 là cửa DUY NHẤT mà kẻ giữ refresh CŨ có thể xin cặp mới (vô hiệu cặp hợp lệ của app) mà không kích hoạt phát hiện dùng lại.
      // Cấp lại hợp lệ rất hiếm (app mất phản hồi của lần xoay rồi thử lại) ⇒ vượt `R5_TOI_DA` lần trong `R5_CUA_SO_MS` ⇒ coi là dùng lại token: thu hồi + kiểm toán.
      // Đếm bằng chính nhật ký kiểm toán `REFRESH_REISSUE` (không thêm cột): kiểm toán hỏng ⇒ chỉ mất độ nhạy của ngưỡng, KHÔNG mất chức năng cấp lại.
      const daCapLai = await db.auditLog.count({
        where: { module: "mobile-auth", entityType: "MobileSession", entityId: p.id, action: "REFRESH_REISSUE", createdAt: { gte: new Date(ctx.now.getTime() - R5_CUA_SO_MS) } },
      });
      if (daCapLai >= R5_TOI_DA) {
        if (await thuHoi(db, p.id, "dung-lai-token", ctx.now)) await ghiKiemToan(p.userId, p.id, "REFRESH_REISSUE_LIMIT", ctx, { soLanCapLai: daCapLai });
        throw loi.daThuHoi();
      }
      const r = await db.mobileSession.updateMany({
        where: { id: p.id, refreshHashTruoc: p.refreshHashTruoc, xacNhanLuc: null, refreshHash: p.refreshHash, thuHoiLuc: null },
        data: {
          refreshHash: cap.refreshHash,
          accessHash: cap.accessHash,
          accessHetHan: hanAccess(ctx.now, tuyetDoi),
          xoayLuc: ctx.now,
          hetHanKhongDung: hanKhongDung(ctx.now, tuyetDoi),
          lanDungCuoi: ctx.now,
        },
      });
      if (r.count === 1) {
        await ghiKiemToan(p.userId, p.id, "REFRESH_REISSUE", ctx);
        return traCap(cap);
      }
      continue;
    }

    // R6 — DÙNG LẠI TOKEN: thu hồi + kiểm toán.
    if (await thuHoi(db, p.id, "dung-lai-token", ctx.now)) await ghiKiemToan(p.userId, p.id, "REFRESH_TOKEN_REUSE", ctx);
    throw loi.daThuHoi();
  }
  throw loi.chuaDangNhap(); // trượt lần hai: không ghi gì
}

function traCap(cap: CapToken): PhanHoiToken {
  return { accessToken: cap.accessToken, refreshToken: cap.refreshToken, hetHanSau: hetHanSau() };
}

async function chanTheoIp(ngan: string, khoaIp: string, now: Date, cuaSoMs: number, nguong: number): Promise<void> {
  try {
    const n = await demMotKhoa({ khoa: khoaIp, now, cuaSoMs });
    if (n > nguong) throw loi.chamTran(Math.ceil(cuaSoMs / 1000));
  } catch (e) {
    if (e instanceof LoiKhongDemDuoc) throw loi.bận(30);
    throw e;
  }
  void ngan;
}

async function chanTheoPhien(sessionId: string, now: Date): Promise<void> {
  try {
    const d = MOBILE_AUTH.lamMoi;
    const n = await demMotKhoa({ khoa: bamKhoaDem("refresh:phien", sessionId), now, cuaSoMs: d.cuaSoMs });
    if (n > d.nguongPhien) throw loi.chamTran(Math.ceil(d.cuaSoMs / 1000));
  } catch (e) {
    if (e instanceof LoiKhongDemDuoc) throw loi.bận(30);
    throw e;
  }
}

// ───────────────────────────── ĐĂNG XUẤT ─────────────────────────────

/**
 * Đăng xuất: KHÔNG đòi access token. Phiên còn sống và bí mật khớp băm hiện hành HOẶC băm liền trước ⇒ thu hồi `dang-xuat`.
 * Mọi trường hợp khác (token sai dạng, phiên không có, đã thu hồi, bí mật không khớp) ⇒ không làm gì. Luôn trả bình thường:
 * đăng xuất không được thành phép thử token. Ngăn theo IP chỉ đếm token KHÔNG tra ra phiên sống.
 */
export async function dangXuat(refreshToken: unknown, ctx: NguCanh): Promise<void> {
  const tok = tachToken(refreshToken, "refresh");
  let traRaSong = false;
  if (tok) {
    const p = await db.mobileSession.findUnique({ where: { maTra: tok.maTra } });
    if (p && !p.thuHoiLuc) {
      traRaSong = true;
      const h = bamBiMat(tok.biMat);
      if (bamKhop(h, p.refreshHash) || bamKhop(h, p.refreshHashTruoc)) {
        if (await thuHoi(db, p.id, "dang-xuat", ctx.now)) await ghiKiemToan(p.userId, p.id, "SESSION_REVOKED", ctx, { lyDo: "dang-xuat" });
      }
    }
  }
  if (!traRaSong) {
    await chanTheoIp("logout", bamKhoaDem("logout:ip", ctx.ip), ctx.now, MOBILE_AUTH.dangXuat.cuaSoMs, MOBILE_AUTH.dangXuat.nguongIp);
  }
}

// ───────────────────────────── ĐỔI MẬT KHẨU ───────────────────────────────────

/** Đổi mật khẩu: 5 lần / 15 phút theo NGƯỜI DÙNG (mỗi lượt gọi đều đếm — kẻ cầm phiên bị đánh cắp không được dò mật khẩu hiện tại). */
const DOI_MAT_KHAU = { cuaSoMs: 15 * 60_000, nguong: 5 } as const;
export const doiMatKhauSchema = z.object({
  matKhauHienTai: z.string().min(1, "Nhập mật khẩu hiện tại.").max(200),
  matKhauMoi: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(72, "Mật khẩu tối đa 72 ký tự"),
});

/**
 * `POST /parent/password` (thiết kế 11 §3.4). Mật khẩu hiện tại được so (bcrypt) TRƯỚC khi mở giao dịch; sai ⇒ `PASSWORD_INCORRECT` 400 (KHÔNG phải 401: app coi 401 là phiên hỏng).
 * MỘT giao dịch duy nhất: (1) đổi mật khẩu + `tokenVersion + 1` có điều kiện trên giá trị đã đọc (0 dòng ⇒ huỷ, «thử lại»); (2) cấp cặp token MỚI cho CHÍNH phiên đang gọi, `tokenVersionLucCap = tv + 1`,
 * `refreshHashTruoc` TRỐNG (refresh cũ của thiết bị này không được xin cặp mới). Mọi phiên khác (web + di động) chết ở yêu cầu kế tiếp vì `tokenVersion` lệch. Tách hai bước ⇒ chính thiết bị vừa đổi bị đăng xuất.
 * Ghi kiểm toán KHÔNG chứa mật khẩu / băm / token.
 */
export async function doiMatKhau(nguoi: NguoiGoi, input: z.infer<typeof doiMatKhauSchema>, ctx: NguCanh): Promise<PhanHoiToken> {
  try {
    const n = await demMotKhoa({ khoa: bamKhoaDem("doi-mat-khau:nguoi", nguoi.userId), now: ctx.now, cuaSoMs: DOI_MAT_KHAU.cuaSoMs });
    if (n > DOI_MAT_KHAU.nguong) throw loi.chamTran(Math.ceil(DOI_MAT_KHAU.cuaSoMs / 1000));
  } catch (e) {
    if (e instanceof LoiKhongDemDuoc) throw loi.bận(30);
    throw e;
  }

  const u = await db.user.findUnique({ where: { id: nguoi.userId }, select: { password: true, tokenVersion: true, isActive: true, deletedAt: true, role: true, roles: true, phone: true, email: true } });
  // Mọi nhánh «không đổi được» tốn đúng một lượt bcrypt (không phân biệt qua thời gian).
  const dungHienTai = await bcrypt.compare(input.matKhauHienTai, u?.password ?? BAM_GIA);
  if (!u || !u.password || u.deletedAt || !u.isActive || !laPhuHuynhThuan(u)) throw loi.daThuHoi();
  if (!dungHienTai) throw new LoiApiMobile("PASSWORD_INCORRECT", 400, "Mật khẩu hiện tại chưa đúng.");
  if (await bcrypt.compare(input.matKhauMoi, u.password)) throw new LoiApiMobile("VALIDATION", 400, "Mật khẩu mới phải khác mật khẩu hiện tại.");
  // SEC-12: chặn mật khẩu quá yếu (dãy số, từ thông dụng, chứa SĐT / tên email của chính tài khoản) — kiểm Ở MÁY CHỦ.
  const yeu = lyDoMatKhauYeu(input.matKhauMoi, { sdt: u.phone, email: u.email });
  if (yeu) throw new LoiApiMobile("VALIDATION", 400, yeu, undefined, "MAT_KHAU_YEU");

  const hashed = await bcrypt.hash(input.matKhauMoi, 10);
  const phien = await db.mobileSession.findUnique({ where: { id: nguoi.sessionId }, select: { maTra: true, hetHanTuyetDoi: true } });
  if (!phien) throw loi.daThuHoi();
  const cap = phatCapToken(phien.maTra);

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${nguoi.userId}))`;
    const doi = await tx.user.updateMany({ where: { id: nguoi.userId, tokenVersion: u.tokenVersion }, data: { password: hashed, tokenVersion: { increment: 1 } } });
    if (doi.count !== 1) throw new LoiApiMobile("VALIDATION", 409, "Tài khoản vừa thay đổi. Vui lòng thử lại.", undefined, "TAI_KHOAN_VUA_DOI");
    const sp = await tx.mobileSession.updateMany({
      where: { id: nguoi.sessionId, thuHoiLuc: null },
      data: {
        refreshHash: cap.refreshHash,
        refreshHashTruoc: null,
        accessHash: cap.accessHash,
        accessHetHan: hanAccess(ctx.now, phien.hetHanTuyetDoi),
        xoayLuc: ctx.now,
        xacNhanLuc: null,
        hetHanKhongDung: hanKhongDung(ctx.now, phien.hetHanTuyetDoi),
        tokenVersionLucCap: u.tokenVersion + 1,
        lanDungCuoi: ctx.now,
      },
    });
    if (sp.count !== 1) throw loi.daThuHoi(); // phiên bị thu hồi giữa chừng ⇒ cuộn lại: mật khẩu KHÔNG đổi
    await writeAudit({ actor: { id: nguoi.userId, name: nguoi.name }, module: "mobile-auth", entityType: "User", entityId: nguoi.userId, action: "mobile.password_changed", newValues: { phien: nguoi.sessionId }, tx });
  });

  return { accessToken: cap.accessToken, refreshToken: cap.refreshToken, hetHanSau: hetHanSau() };
}
