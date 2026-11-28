// lib/online-revenue/doi-soat.ts — TỰ KIỂM báo cáo doanh thu Online: các con số API phải khớp với phép cộng độc lập trên sổ.
//
// "Độc lập" nghĩa là: vế đối chiếu lấy bằng `aggregate` thẳng trên bảng (không đi qua phép phân loại/quy khoá của `tinh.ts`), nên một lỗi ở phân loại hoặc phân bổ
// (bỏ một loại dòng, chia dư/thiếu đồng, đếm trùng) làm hai vế LỆCH NHAU. Hai vế cùng dùng `dieuKienKhoanOnline` (tập "đã ghi nhận") là CỐ Ý — đối soát này
// kiểm phép TÍNH, còn định nghĩa "đã ghi nhận" là của `lib/finance/ghi-nhan.ts`.
import type { PrismaClient } from "@prisma/client";

import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { dieuKienKhoanOnline, tinhDoanhThuOnline } from "./doc";
import type { KhoangNgay, NhomThoiGian } from "./thoi-gian";

export type MucDoiSoat = { ma: string; moTa: string; api: number; doiChieu: number; lech: number; dat: boolean };
const muc = (ma: string, moTa: string, api: number, doiChieu: number): MucDoiSoat => ({ ma, moTa, api, doiChieu, lech: api - doiChieu, dat: api === doiChieu });

export async function doiSoatDoanhThuOnline(db: PrismaClient, p: { khoang: KhoangNgay; nhom: NhomThoiGian }) {
  const { khoang, nhom } = p;
  const bc = await tinhDoanhThuOnline(db, { khoang, nhom, khoaId: null });
  const tuNgayDenNgay = { gte: khoang.batDau, lt: khoang.ketThuc };
  const dkTien = dieuKienKhoanOnline(khoang, null);

  const [rongSoCai, rongXacNhanSoCai, hoanSoCai, hoanYeuCau, giaTriDonSoCai] = await Promise.all([
    db.payment.aggregate({ where: dkTien, _sum: { amount: true } }),
    db.payment.aggregate({ where: { AND: [dkTien, WHERE_THUC_THU] }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { AND: [dkTien, { accountantStatus: "REFUNDED", refundRequestId: { not: null } }] }, _sum: { amount: true } }),
    db.refundRequest.aggregate({ where: { kenh: "ONLINE", status: "PAID", paidAt: tuNgayDenNgay, orderItem: { order: { deletedAt: null } } }, _sum: { approvedAmount: true } }),
    db.order.aggregate({ where: { type: "ONLINE", deletedAt: null, status: { notIn: ["CANCELLED", "DRAFT"] }, createdAt: tuNgayDenNgay }, _sum: { totalAmount: true } }),
  ]);

  const tong = (xs: readonly { rong: number }[]) => xs.reduce((s, x) => s + x.rong, 0);
  const kiemTra: MucDoiSoat[] = [
    muc("RONG_SO_CAI", "Ròng (thu − hoàn + điều chỉnh) của API = Σ Payment đã ghi nhận trong khoảng trên cùng bộ lọc", bc.tien.rong, rongSoCai._sum.amount ?? 0),
    muc("DANG_THUC", "thu − hoàn + điều chỉnh = ròng", bc.tien.thu - bc.tien.hoan + bc.tien.dieuChinh, bc.tien.rong),
    muc("TONG_THEO_KHOA", "Σ ròng theo khoá (gồm nhóm Học cụ & phí giao) = ròng", tong(bc.theoKhoa.map((k) => k.tien)), bc.tien.rong),
    muc("TONG_THEO_KY", "Σ ròng theo kỳ = ròng", tong(bc.theoThoiGian.map((k) => k.tien)), bc.tien.rong),
    muc("TONG_THEO_PHAP_NHAN", "Σ ròng theo pháp nhân (gồm nhóm chưa có pháp nhân) = ròng", tong(bc.theoPhapNhan), bc.tien.rong),
    muc("HOAN_SO_CAI_KHOP_YEU_CAU", "Hoàn có yêu cầu trên sổ thu = Σ số tiền đã duyệt của yêu cầu hoàn Online đã CHI trong khoảng", 0 - (hoanSoCai._sum.amount ?? 0), hoanYeuCau._sum.approvedAmount ?? 0),
    muc("GIA_TRI_DON_SO_CAI", "Giá trị đơn (niêm yết − giảm + phí giao) = Σ Order.totalAmount của đơn hiệu lực tạo trong khoảng", bc.donHang.giaTriDon, giaTriDonSoCai._sum.totalAmount ?? 0),
    muc("RONG_DA_XAC_NHAN", "Ròng đã kế toán xác nhận (CONFIRMED + REFUNDED) = aggregate độc lập theo `WHERE_THUC_THU`", bc.tien.rongDaXacNhanKeToan, rongXacNhanSoCai._sum.amount ?? 0),
  ];
  return {
    khop: kiemTra.every((k) => k.dat),
    kiemTra,
    tomTat: { rong: bc.tien.rong, rongDaXacNhanKeToan: bc.tien.rongDaXacNhanKeToan, rongChoXacNhanKeToan: bc.tien.rongChoXacNhanKeToan },
    quyTheoTyLe: bc.quyTheoTyLe,
    canhBao: bc.canhBao,
  };
}
