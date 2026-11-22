/**
 * Email của DISC — "XÁC MINH TRƯỚC, GỬI SAU". Phần THUẦN + dịch vụ theo cổng (tiêm vào).
 *
 * Địa chỉ email do khách gõ ở màn Lưu, CHƯA ai chứng minh là của họ. Gửi báo cáo có thông tin trẻ tới
 * một địa chỉ chưa xác minh = đưa dữ liệu trẻ cho người lạ. Nên:
 *   1. Lưu xong, email ở `VERIFICATION_REQUIRED`. `guiLinkXacMinh` gửi MỘT thư chỉ chứa liên kết xác minh
 *      (không tên trẻ/phụ huynh, không điểm), token ngẫu nhiên, lưu HASH, dùng một lần. HẠN nằm ở CỘT
 *      `emailVerifyExpiresAt` (nguồn sự thật — kiểm trong chính phép ghi CAS); hạn nhúng trong chuỗi token chỉ là lớp thứ hai.
 *      Gửi lại CHỈ khi token cũ đã hết hạn, và chịu HAI trần (theo địa chỉ email · theo bài) — F-07/F-08: địa chỉ do khách gõ,
 *      chưa ai chứng minh là của họ, nên nếu không có trần thì đây là máy gửi thư rác tới địa chỉ tuỳ ý.
 *   2. `xacMinhEmail` (người bấm nút xác nhận) đổi `VERIFICATION_REQUIRED → QUEUED` bằng MỘT phép ghi có
 *      điều kiện; chỉ lượt THẮNG phép ghi đó mới xếp thư báo cáo ⇒ chống gửi trùng theo submissionId kể cả
 *      khi bấm đúp / hai tab / bot quét liên kết.
 *   3. Thư báo cáo CHỈ có thông báo + liên kết tới trang nhận bài có xác thực (OTP + mã nhận). Không đính
 *      kèm hồ sơ trẻ, không chép tên/điểm vào thân thư.
 *   4. `DiscEmailStatus` nói thật: xếp hàng ≠ đã gửi. `QUEUED` chỉ chuyển `SENT`/`FAILED` khi
 *      `dongBoTrangThaiEmail` đọc được kết quả THẬT của hàng đợi.
 *
 * KHÔNG gửi thật từ đây: việc gửi là của `processEmailQueue` (cron) sau khi thư nằm trong hàng đợi.
 */
import { createHash, randomBytes } from "node:crypto";

/** Số thư xác minh tối đa tới MỘT địa chỉ mỗi ngày (mọi bài cộng lại) và cho MỘT bài mỗi ngày. Hằng cố định — thêm tham số vận hành = sửa registry (ngoài phạm vi). */
export const TRAN_THU_XAC_MINH_MOI_DIA_CHI_MOI_NGAY = 3;
export const TRAN_THU_XAC_MINH_MOI_BAI_MOI_NGAY = 3;

export const HAN_LINK_XAC_MINH_PHUT = 60;
export const NGU_CANH_XAC_MINH = "DISC_EMAIL_VERIFY";
export const NGU_CANH_BAO_CAO = "DISC_REPORT";

export type TrangThaiEmailBai = "NONE" | "VERIFICATION_REQUIRED" | "QUEUED" | "SENT" | "FAILED";

export type BaiEmail = {
  id: string;
  emailTo: string | null;
  emailStatus: TrangThaiEmailBai;
  emailVerifiedAt: Date | null;
  /** Hạn của token xác minh đang sống (cột `emailVerifyExpiresAt`). null = chưa có token HOẶC dữ liệu cũ ⇒ coi là không hợp lệ (fail-closed). */
  emailVerifyExpiresAt: Date | null;
  claimStatus: "PENDING_CLAIM" | "CLAIMED" | "EXPIRED" | "REVOKED";
  deletedAt: Date | null;
};

export type EmailStore = {
  layBai: (id: string) => Promise<BaiEmail | null>;
  /**
   * CAS: chỉ đặt khi bài còn `VERIFICATION_REQUIRED`, có `emailTo`, chưa xoá, và CHƯA có token HOẶC token cũ đã HẾT HẠN (`hetHan` cũ ≤ `now`) —
   * ghi cả `emailVerifyTokenHash` lẫn `emailVerifyExpiresAt = hetHan`. true = lượt này thắng.
   */
  datTokenLanDau: (id: string, tokenHash: string, hetHan: Date, now: Date) => Promise<boolean>;
  /** Gỡ đúng token này (hoàn tác khi xếp thư thất bại để gửi lại được). */
  goTokenNeuKhop: (id: string, tokenHash: string) => Promise<void>;
  /** CAS: `VERIFICATION_REQUIRED ∧ hash khớp ∧ emailVerifyExpiresAt > now` ⇒ `QUEUED`, đặt emailVerifiedAt, xoá token + hạn. true = lượt này thắng. */
  xacMinhNeuKhop: (id: string, tokenHash: string, now: Date) => Promise<boolean>;
  /** CAS theo trạng thái cũ. */
  doiTrangThai: (id: string, tu: TrangThaiEmailBai, den: TrangThaiEmailBai) => Promise<boolean>;
  /** Trạng thái THẬT của thư báo cáo trong hàng đợi (null = chưa có). */
  trangThaiHangDoi: (ngucCanh: string, id: string) => Promise<string | null>;
};

export type XepThu = (e: {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  context: { type: string; id: string };
}) => Promise<{ ok: boolean }>;

/** Cổng giới hạn tần suất (tiêm vào; bản thật dùng rateLimit). true = còn hạn mức. Khoá nhận vào đã BĂM — không đưa email thô vào Redis. */
export type GioiHanEmail = {
  theoDiaChi: (khoaDiaChi: string) => Promise<boolean>;
  theoBai: (submissionId: string) => Promise<boolean>;
};

/** Khoá giới hạn theo địa chỉ: sha256 của địa chỉ đã chuẩn hoá (chữ thường, bỏ khoảng trắng đầu/cuối). `A@x.vn` và ` a@X.vn ` là MỘT địa chỉ. */
export function khoaDiaChiEmail(diaChi: string): string {
  return createHash("sha256").update(`disc-email-v1:${diaChi.trim().toLowerCase()}`).digest("hex");
}

// ── token ────────────────────────────────────────────────────────────────────

export const bamToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** `v1.<submissionId>.<hạn base36>.<ngẫu nhiên>` — hạn nằm TRONG chuỗi được băm nên sửa hạn ⇒ hash lệch. */
export function taoTokenXacMinh(submissionId: string, now: Date, ngauNhien: () => string = () => randomBytes(24).toString("base64url")) {
  const hetHan = new Date(now.getTime() + HAN_LINK_XAC_MINH_PHUT * 60_000);
  const token = `v1.${submissionId}.${hetHan.getTime().toString(36)}.${ngauNhien()}`;
  return { token, hash: bamToken(token), hetHan };
}

export function phanTichToken(token: unknown): { submissionId: string; hetHanMs: number; hash: string } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const p = token.split(".");
  if (p.length !== 4 || p[0] !== "v1" || !p[1] || !/^[a-z0-9]+$/.test(p[2]!) || !p[3]) return null;
  const hetHanMs = parseInt(p[2]!, 36);
  if (!Number.isFinite(hetHanMs)) return null;
  return { submissionId: p[1], hetHanMs, hash: bamToken(token) };
}

// ── mẫu thư (tiếng Việt, KHÔNG có thông tin trẻ) ─────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const khung = (tieuDe: string, dong: string[]) =>
  `<div style="font-family:system-ui,sans-serif;color:#333"><h2 style="color:#F97316">${esc(tieuDe)}</h2>${dong.map((l) => `<p>${l}</p>`).join("")}<p style="color:#999;font-size:12px">— Trung tâm Sata Robo</p></div>`;

export function mauThuXacMinh(linkXacMinh: string) {
  const subject = "Xác nhận email để nhận kết quả DISC của gia đình";
  const bodyText = `Chào bạn,\nEmail này vừa được nhập khi làm bài DISC tại Sata Robo. Để nhận kết quả, vui lòng xác nhận tại liên kết dưới đây (hiệu lực ${HAN_LINK_XAC_MINH_PHUT} phút):\n${linkXacMinh}\nNếu không phải bạn, hãy bỏ qua thư này — chúng tôi sẽ không gửi gì thêm.\n\n— Trung tâm Sata Robo`;
  const bodyHtml = khung("Xác nhận email", [
    "Chào bạn,",
    "Email này vừa được nhập khi làm bài DISC tại Sata Robo. Để nhận kết quả, vui lòng xác nhận:",
    `<a href="${esc(linkXacMinh)}">Xác nhận email</a> (hiệu lực ${HAN_LINK_XAC_MINH_PHUT} phút)`,
    "Nếu không phải bạn, hãy bỏ qua thư này — chúng tôi sẽ không gửi gì thêm.",
  ]);
  return { subject, bodyText, bodyHtml };
}

export function mauThuBaoCao(linkNhan: string) {
  const subject = "Kết quả DISC của gia đình bạn đã sẵn sàng";
  const bodyText = `Chào bạn,\nKết quả DISC của gia đình bạn đã sẵn sàng. Vì đây là thông tin của trẻ nên thư này không kèm nội dung kết quả.\nĐể xem và tải báo cáo, hãy vào ${linkNhan} và nhập số điện thoại đã dùng khi làm bài cùng mã nhận bài hiển thị lúc lưu.\n\n— Trung tâm Sata Robo`;
  const bodyHtml = khung("Kết quả DISC đã sẵn sàng", [
    "Chào bạn,",
    "Kết quả DISC của gia đình bạn đã sẵn sàng. Vì đây là thông tin của trẻ nên thư này không kèm nội dung kết quả.",
    `Để xem và tải báo cáo, hãy <a href="${esc(linkNhan)}">nhận bài tại đây</a> bằng số điện thoại đã dùng khi làm bài và mã nhận bài hiển thị lúc lưu.`,
  ]);
  return { subject, bodyText, bodyHtml };
}

// ── dịch vụ ──────────────────────────────────────────────────────────────────

const chuaCoTheXacMinh = (b: BaiEmail | null): b is BaiEmail =>
  !!b && !!b.emailTo && b.emailStatus === "VERIFICATION_REQUIRED" && !b.emailVerifiedAt && !b.deletedAt && b.claimStatus !== "REVOKED" && b.claimStatus !== "EXPIRED";

export type KetQuaGuiLink = { ok: true } | { ok: false; loi: "KHONG_CAN" | "DA_GUI" | "QUA_HAN_MUC" | "XEP_HANG_THAT_BAI" };

/**
 * Gửi link xác minh. Gọi lặp khi token còn hạn ⇒ `DA_GUI`, không thêm thư; chỉ gửi lại được SAU khi token cũ hết hạn.
 * Hai trần (địa chỉ · bài) được hỏi SAU khi đã thắng CAS token — gọi lặp/đua không tiêu hạn mức — và nếu vượt thì GỠ token vừa đặt.
 * `gioiHan` BẮT BUỘC (không có mặc định): đây là hàm gửi thư tới địa chỉ do khách gõ.
 */
export async function guiLinkXacMinh(p: { submissionId: string; goc: string; store: EmailStore; xepThu: XepThu; now: Date; gioiHan: GioiHanEmail }): Promise<KetQuaGuiLink> {
  const bai = await p.store.layBai(p.submissionId);
  if (!chuaCoTheXacMinh(bai)) return { ok: false, loi: "KHONG_CAN" };
  const t = taoTokenXacMinh(bai.id, p.now);
  if (!(await p.store.datTokenLanDau(bai.id, t.hash, t.hetHan, p.now))) return { ok: false, loi: "DA_GUI" };
  let duocGui: boolean;
  try {
    duocGui = (await p.gioiHan.theoBai(bai.id)) && (await p.gioiHan.theoDiaChi(khoaDiaChiEmail(bai.emailTo!)));
  } catch {
    duocGui = false; // hạ tầng giới hạn lỗi ⇒ fail-closed
  }
  if (!duocGui) {
    await p.store.goTokenNeuKhop(bai.id, t.hash);
    return { ok: false, loi: "QUA_HAN_MUC" };
  }
  const mau = mauThuXacMinh(`${p.goc}/disc/xac-minh-email?t=${encodeURIComponent(t.token)}`);
  let xep: boolean;
  try {
    xep = (await p.xepThu({ to: bai.emailTo!, ...mau, context: { type: NGU_CANH_XAC_MINH, id: bai.id } })).ok;
  } catch {
    xep = false;
  }
  if (!xep) {
    await p.store.goTokenNeuKhop(bai.id, t.hash);
    return { ok: false, loi: "XEP_HANG_THAT_BAI" };
  }
  return { ok: true };
}

/** Một thông điệp lỗi cho MỌI nguyên nhân (token lạ · hết hạn · đã dùng · bài bị xoá) — không thành oracle. */
export type KetQuaXacMinh = { ok: true; xepBaoCao: boolean } | { ok: false; loi: "LINK_KHONG_HOP_LE" };

export async function xacMinhEmail(p: { token: unknown; goc: string; store: EmailStore; xepThu: XepThu; now: Date }): Promise<KetQuaXacMinh> {
  const t = phanTichToken(p.token);
  if (!t || t.hetHanMs < p.now.getTime()) return { ok: false, loi: "LINK_KHONG_HOP_LE" };
  const bai = await p.store.layBai(t.submissionId);
  if (!bai || !bai.emailTo) return { ok: false, loi: "LINK_KHONG_HOP_LE" };
  // Hạn theo CỘT là nguồn sự thật: thiếu cột hoặc đã quá hạn ⇒ không hợp lệ (cùng lỗi với token lạ).
  if (!bai.emailVerifyExpiresAt || bai.emailVerifyExpiresAt.getTime() <= p.now.getTime()) return { ok: false, loi: "LINK_KHONG_HOP_LE" };
  // CAS: chỉ một lượt thắng; thua (đã dùng · hash lệch · bài đã đổi trạng thái) ⇒ cùng lỗi.
  if (!(await p.store.xacMinhNeuKhop(t.submissionId, t.hash, p.now))) return { ok: false, loi: "LINK_KHONG_HOP_LE" };

  // Lượt thắng ⇒ DUY NHẤT được xếp thư báo cáo.
  let xep: boolean;
  try {
    xep = (await p.xepThu({ to: bai.emailTo, ...mauThuBaoCao(`${p.goc}/kich-hoat?disc=1`), context: { type: NGU_CANH_BAO_CAO, id: bai.id } })).ok;
  } catch {
    xep = false;
  }
  if (!xep) {
    // Nói thật: không xếp được ⇒ FAILED (không để QUEUED mãi mãi). Có thể thử lại bằng đường vận hành.
    await p.store.doiTrangThai(bai.id, "QUEUED", "FAILED");
    return { ok: true, xepBaoCao: false };
  }
  return { ok: true, xepBaoCao: true };
}

/** Ánh xạ trạng thái hàng đợi → trạng thái DISC. Không rõ ⇒ null (giữ nguyên, không đoán). */
export function anhXaTrangThaiHangDoi(s: string | null): "SENT" | "FAILED" | null {
  if (s === "SENT") return "SENT";
  if (s === "FAILED") return "FAILED";
  return null;
}

/** Đọc kết quả thật của hàng đợi và cập nhật `QUEUED → SENT/FAILED`. Cron/đường vận hành gọi. */
export async function dongBoTrangThaiEmail(p: { submissionId: string; store: EmailStore }): Promise<"SENT" | "FAILED" | "GIU_NGUYEN"> {
  const bai = await p.store.layBai(p.submissionId);
  if (!bai || bai.emailStatus !== "QUEUED") return "GIU_NGUYEN";
  const moi = anhXaTrangThaiHangDoi(await p.store.trangThaiHangDoi(NGU_CANH_BAO_CAO, bai.id));
  if (!moi) return "GIU_NGUYEN";
  return (await p.store.doiTrangThai(bai.id, "QUEUED", moi)) ? moi : "GIU_NGUYEN";
}
