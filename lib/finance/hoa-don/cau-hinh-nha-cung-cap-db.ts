import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";

// lib/finance/hoa-don/cau-hinh-nha-cung-cap-db.ts — ĐỌC (chỉ đọc) các CỘT NHẠY CẢM của `CauHinhHoaDonCoSo` cho khu "Nhà cung cấp & ký" (lát S7).
//
// ⚠️ Cố ý KHÔNG thêm các cột này vào `CHON` / `sangDong` của `cau-hinh-co-so-db.ts`: tập `CHON` nuôi `luuCauHinh`, `kiemSuaCauHinh` và các
//    test của đường sửa hiện có — thêm vào đó là dịch chuyển đường GHI cũ. Đây là bộ đọc RIÊNG, không có hàm ghi nào đi kèm.
// ⚠️ KHÔNG có action nào sửa các cột này ở lát S7: đổi chúng là đổi AI đứng tên hoá đơn, gửi TỚI ĐÂU, bằng credential NÀO (04 §2.8 quy tắc 1) —
//    cần action riêng Hội sở + maker-checker, chưa làm. Giao diện chỉ HIỆN.
// ⚠️ `khoaBiMat` chỉ là KHOÁ ENUM trong mã (ánh xạ sang tiền tố biến môi trường) — không bao giờ là giá trị bí mật (TD-06). Vẫn chỉ hiện tên khoá.

export type CauHinhNhaCungCapChiDoc = {
  id: string;
  centerId: string;
  phapNhanMa: string;
  kyHieu: string;
  hieuLucTu: string;
  hieuLucDen: string;
  dangBat: boolean;
  legalEntityId: string | null;
  nhaCungCapMa: string | null;
  moiTruongNcc: string | null;
  loaiHoaDon: string | null;
  phuongThucKy: string | null;
  khoaBiMat: string | null;
  chungThuHetHan: string | null;
  cheDoHub: string | null;
};

const ngay = (d: Date) => d.toISOString().slice(0, 10);

/** Cấu hình các cơ sở cho khu chỉ-đọc (qua `scopedDb`): mọi dòng của cơ sở trong tầm nhìn, đang bật trước, mới nhất trước. */
export async function docCauHinhNhaCungCap(actor: Actor, centerIds: readonly string[]): Promise<CauHinhNhaCungCapChiDoc[]> {
  if (centerIds.length === 0) return [];
  const ds = await scopedDb(actor).cauHinhHoaDonCoSo.findMany({
    where: { centerId: { in: [...centerIds] } },
    orderBy: [{ dangBat: "desc" }, { hieuLucTu: "desc" }, { id: "asc" }],
    select: {
      id: true,
      centerId: true,
      phapNhanMa: true,
      kyHieu: true,
      hieuLucTu: true,
      hieuLucDen: true,
      dangBat: true,
      legalEntityId: true,
      nhaCungCapMa: true,
      moiTruongNcc: true,
      loaiHoaDon: true,
      phuongThucKy: true,
      khoaBiMat: true,
      chungThuHetHan: true,
      cheDoHub: true,
    },
  });
  return ds.map((d) => ({
    id: d.id,
    centerId: d.centerId,
    phapNhanMa: d.phapNhanMa,
    kyHieu: d.kyHieu,
    hieuLucTu: ngay(d.hieuLucTu),
    hieuLucDen: ngay(d.hieuLucDen),
    dangBat: d.dangBat,
    legalEntityId: d.legalEntityId,
    nhaCungCapMa: d.nhaCungCapMa,
    moiTruongNcc: d.moiTruongNcc,
    loaiHoaDon: d.loaiHoaDon,
    phuongThucKy: d.phuongThucKy,
    khoaBiMat: d.khoaBiMat,
    chungThuHetHan: d.chungThuHetHan ? ngay(d.chungThuHetHan) : null,
    cheDoHub: d.cheDoHub,
  }));
}
