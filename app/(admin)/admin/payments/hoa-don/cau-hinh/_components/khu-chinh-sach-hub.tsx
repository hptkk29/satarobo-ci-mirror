// Khu Hub của trang Cấu hình (S7) — SERVER component: nạp dữ liệu, tính cờ NÚT theo người xem, rồi giao cho `ChinhSachHoaDon` (client) và `NhaCungCapChiDoc`.
// Mọi đọc đi qua `scopedDb` (trong `chinh-sach-db.ts` / `cau-hinh-nha-cung-cap-db.ts`) — người xem không bao giờ nhận dòng của cơ sở ngoài phạm vi.
// Thiếu pháp nhân của cơ sở ⇒ NÓI THIẾU và không nạp gì (không đoán pháp nhân — OD-01).
import type { Actor } from "@/lib/auth/actor";
import { EmptyState } from "@/components/admin/ui/states";
import { phapNhanPhatHanhChoCoSo } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import { cauHinhHoaDonChoMoiTruong } from "@/lib/finance/hoa-don/phap-nhan-theo-moi-truong";
import type { DongCauHinh } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";
import { docCauHinhNhaCungCap } from "@/lib/finance/hoa-don/cau-hinh-nha-cung-cap-db";
import { docDanhSachChinhSach, docLichSuChinhSach, docMoPhongChoBan, docTenNguoi } from "@/lib/finance/hoa-don/chinh-sach-db";
import { phanTichNoiDung } from "@/lib/finance/hoa-don/chinh-sach-phien-ban";
import { duocGhiChinhSach, hanhDongChinhSachChoPhep } from "@/lib/finance/hoa-don/quyen";
import { ChinhSachHoaDon, type BanHienThi, type MoPhongHienThi } from "./chinh-sach-hoa-don";
import { NhaCungCapChiDoc } from "./nha-cung-cap-chi-doc";

/**
 * Trần số bản NHÁP được dựng mô phỏng mỗi lần tải. Bản CHỜ DUYỆT thì KHÔNG bao giờ bị cắt: người duyệt phải có bảng mô phỏng (và băm của nó) mới
 * duyệt được — cắt bản chờ duyệt là vẽ ra một nút Duyệt không bao giờ bật (luật 12).
 */
const TOI_DA_MO_PHONG_NHAP = 8;

export async function KhuChinhSachHub({ actor, coSo, dong, homNay }: { actor: Actor; coSo: { id: string; ma: string; ten: string }; dong: DongCauHinh[]; homNay: string }) {
  const tenCoSo = `${coSo.ma} · ${coSo.ten}`;
  const dsPhapNhan = cauHinhHoaDonChoMoiTruong().phapNhan;
  const pn = phapNhanPhatHanhChoCoSo({ cauHinh: dong.filter((d) => d.dangBat), centerId: coSo.id, ngay: homNay, danhSachPhapNhan: dsPhapNhan });
  if (!pn.ok) {
    return (
      <EmptyState
        title="Chưa xác định được pháp nhân của cơ sở"
        description={`${pn.error} Chính sách hoá đơn khai theo pháp nhân nên khu này chưa mở được.`}
      />
    );
  }
  const phapNhan = pn.phapNhan;

  const ds = await docDanhSachChinhSach(actor, { phapNhanMa: phapNhan.ma, centerId: coSo.id });
  const canMoPhong = [...ds.filter((b) => b.trangThai === "CHO_DUYET"), ...ds.filter((b) => b.trangThai === "NHAP").slice(0, TOI_DA_MO_PHONG_NHAP)];
  const [ten, lichSu, moPhong, nhaCungCap] = await Promise.all([
    docTenNguoi(ds.flatMap((b) => [b.nguoiTaoId, b.nguoiDuyetId ?? ""])),
    docLichSuChinhSach(ds.map((b) => b.id)),
    Promise.all(canMoPhong.map(async (b) => [b.id, await docMoPhongChoBan(actor, b.id)] as const)),
    docCauHinhNhaCungCap(actor, [coSo.id]),
  ]);
  const moPhongTheoId = new Map(moPhong);

  const ban: BanHienThi[] = ds.map((b) => {
    const p = phanTichNoiDung(b.noiDung);
    const m = moPhongTheoId.get(b.id);
    const mp: MoPhongHienThi | null = !m ? null : m.ok ? { ok: true, ketQua: m.ketQua, hash: m.hash } : { ok: false, loi: m.loi };
    return {
      id: b.id,
      phienBan: b.phienBan,
      centerId: b.centerId,
      trangThai: b.trangThai,
      hieuLucTu: b.hieuLucTu,
      hieuLucDen: b.hieuLucDen,
      tenNguoiTao: ten[b.nguoiTaoId] ?? b.nguoiTaoId,
      tenNguoiDuyet: b.nguoiDuyetId ? (ten[b.nguoiDuyetId] ?? b.nguoiDuyetId) : null,
      lyDo: b.lyDo,
      noiDung: p.ok ? p.noiDung : null,
      loiNoiDung: p.ok ? [] : p.loi,
      moPhong: mp,
      hanhDong: hanhDongChinhSachChoPhep(actor, b),
      lichSu: lichSu.filter((l) => l.chinhSachId === b.id).map((l) => ({ id: l.id, hanhDong: l.hanhDong, luc: l.luc, nguoi: l.nguoiSua, lyDo: l.lyDo })),
    };
  });

  return (
    <div className="flex flex-col gap-10">
      <ChinhSachHoaDon
        centerId={coSo.id}
        tenCoSo={tenCoSo}
        phapNhan={{ ma: phapNhan.ma, ten: phapNhan.ten, maSoThue: phapNhan.maSoThue }}
        ban={ban}
        coTheSoanRieng={duocGhiChinhSach(actor, coSo.id)}
        coTheSoanChung={duocGhiChinhSach(actor, null)}
      />
      {/* [05/11/2026] Bảng này đọc cấu hình nhà cung cấp THEO KÝ HIỆU (cột cũ của cấu hình cơ sở), KHÔNG phải kết nối thật ở Bước 2 — nên có lúc ghi «Chưa khai» trong khi Bước 2 đã dùng được.
          Hai bảng cạnh nhau là chỗ người dùng rối nhất của trang, nên thu gọn mặc định và nói thẳng nơi sửa thật. Vẫn render (children luôn có trong DOM) để dữ liệu không mất. */}
      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11">
          Bảng cấu hình theo ký hiệu (chỉ xem — dành cho kỹ thuật)
          <span className="ml-auto text-xs font-normal">Muốn đổi nhà cung cấp hoặc tài khoản: dùng Bước 2 ở trên</span>
        </summary>
        <div className="border-t border-border p-4">
          <NhaCungCapChiDoc tenCoSo={tenCoSo} dong={nhaCungCap} tenPhapNhan={Object.fromEntries(dsPhapNhan.map((p) => [p.ma, p.ten]))} />
        </div>
      </details>
    </div>
  );
}
