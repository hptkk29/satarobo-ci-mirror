// lib/hoa-hong/boi-canh.ts — BỐI CẢNH của một lượt quét: cấu hình + danh mục nạp MỘT lần rồi truyền xuống.
//
// Nguồn: docs/source-commission/04 L11 (hàm DB chỉ nạp + ghi), §8 (trần), 05 §2.2.
//
// Mọi con số "cấu hình" của lượt quét (trần 9%, VAT, thứ tự phạm vi, cửa sổ ghi công, mốc cutover) đi qua đây, nên:
//   · không hàm tính nào tự đọc `getSetting` giữa chừng (hai khoản trong cùng một lượt quét mà thấy hai trần khác nhau là sai);
//   · "engine tắt" và "chưa có mốc" là MỘT câu trả lời ở MỘT chỗ — chỗ gọi không phải nhớ kiểm hai lần.
import type { Prisma, PrismaClient } from "@prisma/client";

import { layCuaSoGhiCongNgay } from "@/lib/nguon/feature";

import { docMocCutover } from "./cutover";
import { laEngineHoaHongBat } from "./feature";
import { docHoaHongContext } from "./chinh-sach-service";
import type { HoaHongContext } from "./kieu";

type Khach = PrismaClient | Prisma.TransactionClient;

export type BoiCanhQuet = {
  /** Đồng hồ của lượt quét — BẮT BUỘC từ chỗ gọi (luật 19): hàm tính không tự đọc `new Date()`. */
  now: Date;
  hoaHong: HoaHongContext;
  /** "YYYY-MM". Engine mới không bao giờ ghi kỳ < mốc (L9). */
  kyCutover: string;
  cuaSoNgay: number;
  nhomUnknown: { id: string; code: string };
  /** `roleCode → BeneficiaryRole.id` (cột FK của dòng sổ). */
  idVai: ReadonlyMap<string, string>;
  /** Có rule phạm vi ROLE ⇒ phải nạp vai RBAC của người hưởng (đắt, chỉ làm khi cần). */
  coPhamViRole: boolean;
};

export type KetQuaBoiCanh =
  | { loai: "TAT"; lyDo: "ENGINE_TAT" | "CHUA_CO_MOC_CUTOVER" }
  | { loai: "BAT"; bc: BoiCanhQuet };

export async function dungBoiCanhQuet(client: PrismaClient, now: Date): Promise<KetQuaBoiCanh> {
  if (!(await laEngineHoaHongBat())) return { loai: "TAT", lyDo: "ENGINE_TAT" };
  const kyCutover = await docMocCutover(client);
  if (kyCutover === null) return { loai: "TAT", lyDo: "CHUA_CO_MOC_CUTOVER" };
  return { loai: "BAT", bc: await dungBoiCanhTuMoc(client, now, kyCutover) };
}

/**
 * Dựng bối cảnh khi ĐÃ biết mốc — cho thử tính / "dự kiến của bạn" (chỉ đọc), chạy được cả khi engine tắt.
 * Engine thật PHẢI đi qua `dungBoiCanhQuet` (kiểm cờ + mốc).
 */
export async function dungBoiCanhTuMoc(client: Khach, now: Date, kyCutover: string): Promise<BoiCanhQuet> {
  const [hoaHong, unknown, vai, cuaSoNgay] = await Promise.all([
    docHoaHongContext(client),
    client.leadSourceGroup.findFirst({ where: { code: "UNKNOWN" }, select: { id: true, code: true } }),
    client.beneficiaryRole.findMany({ select: { id: true, code: true } }),
    layCuaSoGhiCongNgay(),
  ]);
  if (!unknown) throw new Error("Thiếu nhóm nguồn UNKNOWN (seed của migration PR1) — dừng, không đoán.");
  return {
    now,
    hoaHong,
    kyCutover,
    cuaSoNgay,
    nhomUnknown: unknown,
    idVai: new Map(vai.map((v) => [v.code, v.id])),
    coPhamViRole: hoaHong.quyTac.some((q) => q.scopeType === "ROLE"),
  };
}
