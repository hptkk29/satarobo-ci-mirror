// app/(admin)/admin/nguon-hoa-hong/so/_components/nut-khieu-nai-dong.tsx — NỐI nút "Khiếu nại dòng này" (track Khiếu nại) vào chỗ neo `hanhDong` của BangSo (track Sổ).
//
// Luật 12: nút vẽ ra ⇔ Server Action chạy được. `taoKhieuNaiAction` đòi `KEY_TAO_KHIEU_NAI` VÀ dòng phải là dòng CỦA MÌNH (`laDongCuaToi`, khieu-nai-dich.ts) — nên nút chỉ
// vẽ khi người xem GIỮ key ấy ∧ người hưởng của dòng là CHÍNH họ (USER, cùng id). QLCS / Kế toán xem dòng của người khác: `TaoKhieuNaiNut` tự trả `null` khi `coQuyenGui=false`.
// Luôn trả MỘT phần tử (không `null`): "có vẽ nút hay không" là việc của `coQuyenGui` bên trong, để chỗ gọi không phải nhân đôi điều kiện.
import type { ReactElement } from "react";

import { TaoKhieuNaiNut } from "@/components/admin/nguon-hoa-hong/tao-khieu-nai-nut";
import type { DongSoTrang } from "@/lib/hoa-hong/doc-so-giao-dien";
import { veNutKhieuNaiDong } from "@/lib/hoa-hong/khieu-nai-ma";

export function nutKhieuNaiDong(d: Pick<DongSoTrang, "id" | "nguoiHuong">, nguoiXemId: string, coKeyTaoKhieuNai: boolean): ReactElement {
  return <TaoKhieuNaiNut dich={{ loai: "DONG", id: d.id }} coQuyenGui={veNutKhieuNaiDong(d, nguoiXemId, coKeyTaoKhieuNai)} />;
}
