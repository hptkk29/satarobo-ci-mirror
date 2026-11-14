// lib/parttime/quyen-rank.ts — "người đang xem có xem được màn Rank giáo viên không" (chốt 25/10/2026: màn con của mục Giáo viên).
// `parttime_rank:view` là quyền phạm vi CENTER với QLCS ⇒ hỏi trần (không cơ sở) là false; phải hỏi TỪNG cơ sở như trang Rank.
// MỘT hàm cho ba nơi: màn Rank, tab trên `/teachers`, và lối chuyển của `/teachers` cho người chỉ có quyền Rank.
import "server-only";
import { checkPermission } from "@/lib/auth/check-permission";
import { docDanhSachCoSo } from "./rank-don-gia-db";

/** Các cơ sở người xem có `parttime_rank:view` (đúng thứ tự `docDanhSachCoSo`). */
export async function coSoXemRank(): Promise<{ id: string; nhan: string }[]> {
  const coSo = await docDanhSachCoSo();
  const duoc = await Promise.all(coSo.map((c) => checkPermission("parttime_rank:view", { centerId: c.id })));
  return coSo.filter((_, i) => duoc[i]);
}

export async function xemRankOMotCoSo(): Promise<boolean> {
  return (await coSoXemRank()).length > 0;
}
