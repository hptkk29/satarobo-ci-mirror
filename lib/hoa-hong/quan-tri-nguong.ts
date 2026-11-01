// lib/hoa-hong/quan-tri-nguong.ts — ĐỌC ngưỡng duyệt hai cấp (`hoaHong.nguongDuyetHaiCap`) THẲNG từ `SystemSetting` trong transaction.
//
// Vì sao KHÔNG qua `getSetting`: nó cache 300 giây, còn ngưỡng được CHỤP vào đề xuất lúc lập (`thresholdSnapshot`) — đọc cache là chụp một giá trị có thể cũ 5 phút
// của chính người vừa sửa nó. Cùng khuôn `docMocCutover` (cutover.ts).
//
// Ba kết cục, và hai trong ba KHÔNG phải "một người":
//   · không có dòng setting      ⇒ MẶC ĐỊNH của registry (10.000.000 đ), nguồn "MAC_DINH" — admin chưa đụng tới là tình trạng bình thường của bản triển khai mới,
//                                  KHÔNG phải sự cố; ép cấp hai ở đây là bắt hai người duyệt mọi thứ mà không ai biết vì sao;
//   · có dòng, hợp lệ            ⇒ giá trị đó, nguồn "SETTING";
//   · có dòng nhưng sai hình/sai miền ⇒ `null`, nguồn "HONG" — fail-closed: `quyetQuanTri` đẩy mọi đề xuất lên cấp hai cho tới khi có người sửa.
import type { Prisma, PrismaClient } from "@prisma/client";

import { SETTINGS } from "@/lib/settings/registry";

type Khach = PrismaClient | Prisma.TransactionClient;

export const KHOA_NGUONG_DUYET_HAI_CAP = "hoaHong.nguongDuyetHaiCap" as const;

export type NguongDuyet = { nguong: number | null; nguon: "MAC_DINH" | "SETTING" | "HONG" };

export async function docNguongDuyetHaiCap(client: Khach): Promise<NguongDuyet> {
  const def = SETTINGS[KHOA_NGUONG_DUYET_HAI_CAP];
  const row = await client.systemSetting.findUnique({ where: { key: KHOA_NGUONG_DUYET_HAI_CAP }, select: { valueJson: true } });
  if (!row) return { nguong: def.default, nguon: "MAC_DINH" };
  const r = def.schema.safeParse(row.valueJson);
  return r.success ? { nguong: r.data, nguon: "SETTING" } : { nguong: null, nguon: "HONG" };
}
