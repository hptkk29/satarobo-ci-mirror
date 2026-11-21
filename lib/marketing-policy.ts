/**
 * Nội dung chính sách marketing (giải thưởng / quà tặng / cam kết) — DB-driven
 * qua SystemSetting registry (group "content").
 *
 * `getSetting("content.<x>")` đã tự fallback về default registry = static `_data`
 * khi DB trống. Bọc thêm try/catch: nếu bảng SystemSetting chưa tồn tại (migration
 * R6-A chưa apply) → trả thẳng static `_data` (2-phase additive, ZERO visual change,
 * không vỡ static generation).
 */
import { getSetting } from "@/lib/settings/service";
import {
  internalAwards as staticAwards,
  type InternalAwards,
} from "@/components/legacy-laptrinhrobot/_data/awards";
import { gifts as staticGifts, type Gift } from "@/components/legacy-laptrinhrobot/_data/gifts";
import {
  commitments as staticCommitments,
  type Commitment,
} from "@/components/legacy-laptrinhrobot/_data/commitments";

export async function getInternalAwards(): Promise<InternalAwards> {
  try {
    return (await getSetting("content.internalAwards")) as InternalAwards;
  } catch {
    return staticAwards;
  }
}

export async function getGifts(): Promise<Gift[]> {
  try {
    return (await getSetting("content.gifts")) as Gift[];
  } catch {
    return staticGifts;
  }
}

export async function getCommitments(): Promise<Commitment[]> {
  try {
    return (await getSetting("content.commitments")) as Commitment[];
  } catch {
    return staticCommitments;
  }
}
