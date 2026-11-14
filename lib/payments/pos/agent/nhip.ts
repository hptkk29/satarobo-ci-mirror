// lib/payments/pos/agent/nhip.ts — NHỊP gọi của máy đồng bộ (`nextPollMs`, GĐ4 POS — T17). THUẦN.
//
// Hợp đồng §5: 2000 khi agent có job PENDING tạo trong 2 phút gần nhất (đặc tả), HOẶC cơ sở của agent có
// phiếu thu thẻ ĐANG MỞ tạo trong 10 phút gần nhất (T17 — sale bấm Kiểm tra thì server chỉ chờ 8″, agent
// phải đang ở chế độ nhanh từ lúc sale TẠO phiếu, không đợi alarm 1 phút); còn lại 60000.
import type { PosIntentStatus } from "@prisma/client";
import { JOB_SONG_MS, NEXT_POLL_CHAM, NEXT_POLL_NHANH, PHIEU_MO_GAN_MS } from "./hop-dong";
import { laPhieuMo } from "../phieu-pos-luat";

export function tinhNextPollMs(x: {
  now: Date;
  centerIdAgent: string;
  /** Job PENDING của CHÍNH agent (người gọi đã lọc agent + PENDING). */
  jobPending: readonly { createdAt: Date }[];
  phieu: readonly { createdAt: Date; centerId: string; status: PosIntentStatus }[];
}): number {
  const n = x.now.getTime();
  // Job "trẻ" = tạo trong 2 phút (biên ĐÚNG 2′ còn trẻ — khớp `docJobChoAgent`: createdAt ≥ now − 2′).
  const coJob = x.jobPending.some((j) => n - j.createdAt.getTime() <= JOB_SONG_MS && j.createdAt.getTime() <= n);
  // Phiếu "mới mở" = tạo trong 10 phút (biên ĐÚNG 10′ đã cũ), cùng cơ sở, còn MỞ.
  const coPhieu = x.phieu.some(
    (p) =>
      p.centerId === x.centerIdAgent &&
      laPhieuMo(p.status) &&
      n - p.createdAt.getTime() < PHIEU_MO_GAN_MS &&
      p.createdAt.getTime() <= n,
  );
  return coJob || coPhieu ? NEXT_POLL_NHANH : NEXT_POLL_CHAM;
}
