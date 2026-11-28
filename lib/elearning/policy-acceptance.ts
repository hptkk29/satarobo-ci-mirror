import "server-only";

import { db } from "@/lib/db";

/**
 * EL-03 PR2 — CỬA DUY NHẤT hỏi "người này đã chấp nhận chính sách chưa".
 *
 * Cùng tinh thần luật cứng #1 của Nền Hệ thống với `can()`: CẤM rải điều kiện
 * chấp nhận vào component hay từng Server Action. Rải ra thì mỗi chỗ kiểm một
 * kiểu, và chỗ nào quên kiểm sẽ ghi nhịp học của người CHƯA đồng ý — đúng thứ
 * ba văn bản pháp lý cấm, và không có cách nào phát hiện bằng mắt.
 *
 * ─── Ba luật của QĐ-CDA-12, hiện thực ở đây ──────────────────────────────────
 *  1. Xác nhận TRƯỚC lượt học đầu tiên. Mọi đường ghi nhịp học (nhịp đọc EL-04,
 *     heartbeat video EL-12) gọi hàm này TRƯỚC KHI GHI. Chưa chấp nhận phiên bản
 *     đang hiệu lực ⇒ ném và 0 dòng tiến độ được ghi.
 *  2. Đổi phạm vi dữ liệu thu ⇒ TĂNG phiên bản ⇒ xác nhận lại. KHÔNG sửa tại chỗ:
 *     không có đường mã nào `update` một dòng đã ghi, TRỪ việc đóng `revokedAt`.
 *     Dòng cũ là bằng chứng bất biến rằng người đó đã được thông báo phạm vi CŨ,
 *     vào ngày ấy.
 *  3. Người học xem được bản ghi của chính mình (màn `/elearning/du-lieu-cua-toi`,
 *     EL-04) — chiều đối trọng của chiều THU thập.
 */

/**
 * Khoá chính sách của module. Một khoá cho toàn bộ việc theo dõi học tập —
 * không tách nhỏ theo từng cơ chế đo, vì người dùng đồng ý một lần với MỘT bản
 * mô tả phạm vi, không đồng ý với tám mảnh rời.
 */
export const ELEARNING_POLICY_KEY = "elearning.learning-tracking";

/**
 * Phiên bản ĐANG HIỆU LỰC. Đọc từ env để đổi được mà không cần deploy, nhưng có
 * mặc định để môi trường chưa khai vẫn chạy đúng.
 *
 * ⚠️ TĂNG SỐ NÀY LÀ MỘT HÀNH ĐỘNG CÓ HẬU QUẢ: mọi người quay về trạng thái CHƯA
 * chấp nhận và bị chặn ghi nhịp cho tới khi xác nhận lại. Chỉ tăng khi PHẠM VI
 * DỮ LIỆU THU THẬT SỰ ĐỔI, và phải kèm cập nhật danh mục trường dữ liệu trong
 * tài liệu chính sách. Đổi danh mục mà giữ nguyên phiên bản là làm hỏng chính
 * chuỗi bằng chứng mà cả 8 cơ chế giám sát dựa vào.
 */
export function currentPolicyVersion(): string {
  return process.env.ELEARNING_POLICY_VERSION?.trim() || "v1";
}

export type PolicyAcceptanceState = {
  /** Đã chấp nhận ĐÚNG phiên bản đang hiệu lực và chưa rút. */
  accepted: boolean;
  /** Phiên bản đang hiệu lực — thứ người dùng cần xác nhận. */
  currentVersion: string;
  /** Phiên bản người này đã chấp nhận gần nhất (kể cả bản cũ). null = chưa bao giờ. */
  acceptedVersion: string | null;
  /** Thời điểm chấp nhận bản đó. */
  acceptedAt: Date | null;
  /** Có thì nghĩa là đã rút đồng ý — coi như chưa chấp nhận. */
  revokedAt: Date | null;
};

/**
 * Trạng thái chấp nhận của MỘT người với phiên bản đang hiệu lực.
 *
 * Cố ý KHÔNG ném: màn "dữ liệu của tôi" cần đọc được cả trạng thái chưa chấp
 * nhận để hiện nút xác nhận. Đường GHI dùng `assertPolicyAccepted` bên dưới.
 */
export async function getPolicyAcceptance(
  userId: string,
  policyKey: string = ELEARNING_POLICY_KEY,
): Promise<PolicyAcceptanceState> {
  const currentVersion = currentPolicyVersion();

  // Lấy bản gần nhất theo thời điểm chấp nhận, KHÔNG lọc sẵn theo phiên bản:
  // màn "dữ liệu của tôi" phải nói được "bạn đã đồng ý bản v1 ngày ..., bản đang
  // hiệu lực là v2" — lọc sẵn thì mất đúng câu đó.
  const row = await db.trnPolicyAcceptance.findFirst({
    where: { userId, policyKey },
    orderBy: { acceptedAt: "desc" },
    select: { policyVersion: true, acceptedAt: true, revokedAt: true },
  });

  return {
    accepted:
      row != null && row.policyVersion === currentVersion && row.revokedAt == null,
    currentVersion,
    acceptedVersion: row?.policyVersion ?? null,
    acceptedAt: row?.acceptedAt ?? null,
    revokedAt: row?.revokedAt ?? null,
  };
}

/** Ném khi chưa chấp nhận — bắt ở tầng action để trả `POLICY_NOT_ACCEPTED`. */
export class PolicyNotAcceptedError extends Error {
  readonly code = "POLICY_NOT_ACCEPTED";
  constructor(readonly currentVersion: string) {
    super(
      "Chưa xác nhận chính sách theo dõi học tập — vào mục Dữ liệu của tôi để xem và xác nhận",
    );
    this.name = "PolicyNotAcceptedError";
  }
}

/**
 * CỔNG cho mọi đường GHI nhịp học. Gọi TRƯỚC KHI ghi, không phải sau.
 *
 * Gọi sau khi ghi là đã thu mất một nhịp của người chưa đồng ý — và một nhịp đã
 * ghi thì không "chưa thu" lại được.
 */
export async function assertPolicyAccepted(
  userId: string,
  policyKey: string = ELEARNING_POLICY_KEY,
): Promise<void> {
  const state = await getPolicyAcceptance(userId, policyKey);
  if (!state.accepted) throw new PolicyNotAcceptedError(state.currentVersion);
}

/**
 * Ghi một lần chấp nhận. IDEMPOTENT: bấm hai lần cùng phiên bản vẫn đúng MỘT
 * dòng, và KHÔNG báo lỗi cho người dùng — với họ, bấm hai lần thì kết quả vẫn là
 * "đã đồng ý", không có gì sai để báo.
 *
 * Bắt P2002 thay vì `upsert`: `upsert` sẽ chạy nhánh `update` và chạm vào một
 * dòng đã ghi — thứ luật 2 cấm. Bắt lỗi trùng là cách duy nhất giữ dòng cũ
 * nguyên vẹn từng byte.
 */
export async function acceptPolicy(
  userId: string,
  policyKey: string = ELEARNING_POLICY_KEY,
): Promise<{ version: string }> {
  const version = currentPolicyVersion();
  try {
    await db.trnPolicyAcceptance.create({
      data: { userId, policyKey, policyVersion: version },
    });
  } catch (err) {
    if (!laLoiTrung(err)) throw err;
    // Đã có dòng cho đúng (userId, policyKey, version) — không tạo dòng thứ hai,
    // không sửa dòng cũ, không báo lỗi.
  }
  return { version };
}

function laLoiTrung(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}
