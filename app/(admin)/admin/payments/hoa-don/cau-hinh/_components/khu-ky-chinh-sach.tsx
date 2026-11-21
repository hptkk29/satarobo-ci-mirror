import type { Actor } from "@/lib/auth/actor";
import { docCacChinhSachKy, docLichSuChinhSachKy, docSuDungHanMuc } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";
import { cauHinhHoaDonChoMoiTruong } from "@/lib/finance/hoa-don/phap-nhan-theo-moi-truong";
import { phamViKeToan } from "@/lib/finance/hoa-don/quyen";
import { KyChinhSach, type TheChinhSach } from "./ky-chinh-sach";

/**
 * Khu «Chính sách ký» (BGĐ 04/11/2026): trạng thái tạm dừng + hạn mức theo PHÁP NHÂN. Mọi kế toán thấy TRẠNG THÁI tạm dừng (để biết vì sao nút không chạy);
 * chỉ kế toán Hội sở (phạm vi ALL) thấy hạn mức và lịch sử; chỉ Quản trị tối cao có nút thay đổi (`actor.isSuperAdmin`, cùng điều kiện lớp DB kiểm lại).
 *
 * 05/11/2026 — CHỈ hiện pháp nhân của cơ sở đang chọn (`phapNhanMa`, suy từ Cây tổ chức theo MST), kể cả lịch sử thay đổi. BẮT BUỘC (luật 7): để tuỳ chọn thì quên
 * truyền = lặng lẽ quay về hiện cả ba pháp nhân. Hạn mức vẫn là dữ liệu cấp PHÁP NHÂN — đây chỉ là bộ lọc hiển thị.
 */
export async function KhuKyChinhSach({ actor, phapNhanMa }: { actor: Actor; phapNhanMa: string }) {
  const pham = phamViKeToan(actor);
  if (pham !== "ALL" && pham.length === 0) return null;
  const hoiSo = pham === "ALL";
  const [tatCa, lichSuTatCa] = await Promise.all([docCacChinhSachKy(), hoiSo ? docLichSuChinhSachKy() : Promise.resolve([])]);
  const cacChinhSach = tatCa.filter((c) => c.phapNhanMa === phapNhanMa);
  const lichSu = lichSuTatCa.filter((l) => l.phapNhanMa === phapNhanMa);
  const theoPn = new Map(cacChinhSach.map((c) => [c.phapNhanMa, c]));
  // Số ĐÃ DÙNG: cùng hàm `docSuDungHanMuc` với cổng giữ chỗ (nên màn và cổng không thể nói hai con số). Chỉ kế toán Hội sở xem hạn mức nên chỉ họ được nạp.
  const bayGio = new Date();
  const suDungTheoPn = new Map(
    await Promise.all(
      cacChinhSach.map(async (c) => [c.phapNhanMa, hoiSo && c.cuaSoPhut !== null ? await docSuDungHanMuc(c.phapNhanMa, c.cuaSoPhut, bayGio) : null] as const),
    ),
  );
  const the: TheChinhSach[] = cauHinhHoaDonChoMoiTruong()
    .phapNhan.filter((p) => p.bat && p.ma === phapNhanMa)
    .map((p) => ({ phapNhanMa: p.ma, ten: p.ten, chinhSach: theoPn.get(p.ma) ?? null, suDung: suDungTheoPn.get(p.ma) ?? null }));
  // Kế toán cơ sở chỉ thấy cờ tạm dừng — số hạn mức là cấu hình cấp pháp nhân, không phải việc của họ.
  const thuGon = hoiSo ? the : the.map((t) => ({ ...t, chinhSach: t.chinhSach ? { ...t.chinhSach, hanMucMoiHoaDon: null, hanMucMoiNgay: null, soToiDa: null, cuaSoPhut: null, nguongTanSuat: null } : null }));
  return <KyChinhSach the={thuGon} lichSu={lichSu} duocSua={actor.isSuperAdmin} xemHanMuc={hoiSo} />;
}
