import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import type { PhieuThuPdfData } from "@/lib/pdf/phieu-thu";
import { vnYmd } from "@/lib/time/vn";
import { lookupMethodNameByCode } from "@/lib/payments/method-lookup";
import { nhaCungCapHieuLuc, phapNhanChoDon, phapNhanVoiNhaCungCap, type PhapNhan } from "./phap-nhan";
import { docNhaCungCapDaChon } from "./ket-noi/ket-noi-db";
import { cauHinhHoaDonChoMoiTruong } from "./phap-nhan-theo-moi-truong";
import type { DonChoHoaDon } from "./nguoi-mua";
import { docHocVienThemLuu } from "./hoc-vien-them";
import { dongDonCuaKhoan, dungPhieuThuData, tenHocVienChoKhoan } from "./phieu-thu-data";
import { suyCacDongKhoa } from "./ten-dong-hoc-phi";
import { napKhoaTheoDong } from "./ten-dong-hoc-phi-db";

// lib/finance/hoa-don/trang-phieu-cho.ts — nạp + dựng các TRANG của phiếu thu CHỜ cho một lần thu.
//
// Tách từ route `payments/hoa-don/phieu-cho` (30/09) để phát hành qua MISA dựng tờ hoá đơn từ CHÍNH dữ liệu
// kế toán vẫn in ra rồi gõ lại ở MISA — một đường nạp, một công thức (`dungPhieuThuData`). Route và action
// "Phát hành qua MISA" cùng gọi hàm này.
//
// ⚠️ Tập khoản + số RÒNG đến từ DÒNG loader đã dựng lại (`napHangChoHoaDon`), không bao giờ từ client.
// Người gọi đã kiểm quyền kế toán ĐÚNG cơ sở trên dòng đó.

export type TrangPhieuCho =
  | {
      ok: true;
      phapNhan: PhapNhan;
      trang: PhieuThuPdfData[];
      /** Khối người mua của đơn (route bấm dấu `bamNguoiMua` từ đây). */
      khoiDon: DonChoHoaDon & { code: string; type: string };
      /** Phương thức của từng khoản (mã + nhãn đã tra) — hình thức thanh toán trên tờ MISA. */
      phuongThuc: { ma: string; nhan: string }[];
      /**
       * Ba ô học viên ĐÃ LƯU trên đơn (01/11/2026), ngày sinh dạng dd/mm/yyyy. CHỈ phiếu chờ nội bộ đọc nó; đường phát hành
       * MISA bỏ qua (quyết định chủ dự án 01/11: thông tin học viên KHÔNG đẩy sang MISA — chưa có trường đã kiểm chứng).
       * `null` = đơn chưa khai ô nào.
       */
      hocVien: { ten: string | null; ngaySinh: string | null; cccd: string | null; maKhachHang: string | null; them: { ten: string; ngaySinh: string | null; cccd: string | null }[] } | null;
      /**
       * Tên học viên của TỪNG khoản (cùng thứ tự `row.khoan`; `null` = khoản không xác định được học viên) — lô đêm 23h dựng tên người mua «tiêu dùng»
       * từ đây (`tenHocVienChoLanThu`). Cùng hàm `tenHocVienChoKhoan` mà tờ phiếu thu in, nên tên trên hoá đơn khớp tên trên phiếu thu.
       */
      tenHocVienTheoKhoan: (string | null)[];
    }
  | { ok: false; status: 404 | 409; error: string };

export async function napTrangPhieuCho(
  actor: Actor,
  row: { orderId: string; ngayThuLabel: string; khoan: readonly { id: string; soTien: number }[] },
): Promise<TrangPhieuCho> {
  const sdb = scopedDb(actor);
  const don = await sdb.order.findUnique({
    where: { id: row.orderId },
    select: {
      code: true,
      type: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      customerAddress: true,
      customerWard: true,
      customerCity: true,
      customerCccd: true,
      invoiceStudentName: true,
      invoiceStudentDob: true,
      invoiceStudentCccd: true,
      invoiceHocVienThem: true,
      invoiceBuyerName: true,
      invoiceCompanyName: true,
      invoiceTaxCode: true,
      invoiceCustomerCode: true,
      invoiceEmail: true,
      center: { select: { code: true } },
      student: { select: { name: true } },
      // Dòng đơn — tên + đơn vị của tờ phiếu đơn KIT / THI (`dongDonCuaKhoan`).
      items: { select: { itemName: true, type: true, quantity: true, totalPrice: true, discountAmount: true, metadata: true, student: { select: { name: true } } } },
      payments: {
        where: { id: { in: row.khoan.map((k) => k.id) }, deletedAt: null },
        select: {
          id: true,
          method: true,
          recordedById: true,
          enrollment: {
            select: {
              class: { select: { name: true, course: { select: { name: true } } } },
              student: { select: { name: true } },
            },
          },
          orderItem: {
            select: { itemName: true, type: true, quantity: true, totalPrice: true, discountAmount: true, metadata: true, student: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!don) return { ok: false, status: 404, error: "Không tìm thấy lần thu" };

  // Bên bán là PHÁP NHÂN theo `Center.code` — xem chú thích route bản chính thức.
  const cauHinh = cauHinhHoaDonChoMoiTruong();
  const phapNhanMacDinh = phapNhanChoDon(don.center?.code ?? null, cauHinh);
  if (!phapNhanMacDinh) {
    return {
      ok: false,
      status: 409,
      error: "Chưa khai pháp nhân phát hành trong Cấu hình hoá đơn — không in phiếu với mã số thuế đoán bừa",
    };
  }

  // [05/11/2026] Dòng «… phát hành» in trên phiếu đọc `phanMem` — phải là nhà cung cấp ĐÃ CHỌN ở «Kết nối & ký», không phải hằng số trong mã.
  const phapNhan = phapNhanVoiNhaCungCap(phapNhanMacDinh, nhaCungCapHieuLuc(phapNhanMacDinh, await docNhaCungCapDaChon(phapNhanMacDinh.ma)));

  const theoId = new Map(don.payments.map((p) => [p.id, p]));
  const nguoiThuIds = [...new Set(don.payments.map((p) => p.recordedById).filter((x): x is string => Boolean(x)))];
  const maPt = [...new Set(don.payments.map((p) => p.method))];
  const [nguoiThu, nhanPt] = await Promise.all([
    nguoiThuIds.length === 0
      ? Promise.resolve([])
      : sdb.user.findMany({ where: { id: { in: nguoiThuIds } }, select: { id: true, name: true } }),
    Promise.all(maPt.map(async (m) => [m, (await lookupMethodNameByCode(m))?.trim() || m] as const)),
  ]);
  const tenNguoiThu = new Map(nguoiThu.map((u) => [u.id, u.name]));
  const tenPt = new Map(nhanPt);
  // Khoá của các dòng đơn (tên Sata3/Sata4… + số buổi mua) — một câu cho cả lần thu; dựng dòng «Học phí x buổi khoá y của <học viên>».
  const khoaTheoId = await napKhoaTheoDong(sdb, [...don.items, ...don.payments.flatMap((p) => (p.orderItem ? [p.orderItem] : []))]);
  // Tên học viên ĐÃ KHAI trên đơn (khối «Người mua trên hoá đơn») thắng học viên mặc định của đơn; khoản có ghi danh / dòng riêng vẫn theo bé của khoản.
  const hocVienCuaDon = don.invoiceStudentName?.trim() ? { name: don.invoiceStudentName.trim() } : don.student;

  const khoiDon = {
    code: don.code,
    type: don.type,
    customerName: don.customerName,
    customerPhone: don.customerPhone,
    customerEmail: don.customerEmail,
    customerAddress: don.customerAddress,
    customerWard: don.customerWard,
    customerCity: don.customerCity,
    customerCccd: don.customerCccd,
    invoiceBuyerName: don.invoiceBuyerName,
    invoiceCompanyName: don.invoiceCompanyName,
    invoiceTaxCode: don.invoiceTaxCode,
    invoiceCustomerCode: don.invoiceCustomerCode,
    invoiceEmail: don.invoiceEmail,
  };

  const trang: PhieuThuPdfData[] = [];
  const phuongThuc: { ma: string; nhan: string }[] = [];
  const tenHocVienTheoKhoan: (string | null)[] = [];
  for (const k of row.khoan) {
    const p = theoId.get(k.id);
    // Khoản vừa bị xoá mềm giữa hai câu tra — tờ in ra phải khớp lần thu, không in thiếu một trang.
    if (!p) return { ok: false, status: 409, error: "Lần thu vừa thay đổi — tải lại màn rồi thử lại" };
    const nhan = tenPt.get(p.method) ?? p.method;
    phuongThuc.push({ ma: p.method, nhan });
    // MỘT lần gọi `tenHocVienChoKhoan` cho mỗi khoản (lưới `[PTD-03]`): tên in trên tờ và tên lô đêm dựng người mua cùng đến từ đây.
    const tenHv = tenHocVienChoKhoan(p, hocVienCuaDon);
    tenHocVienTheoKhoan.push(tenHv);
    const dongDon = dongDonCuaKhoan(p, don.items);
    trang.push(
      dungPhieuThuData({
        maPhieu: null,
        ngayLap: row.ngayThuLabel,
        phapNhan,
        cauHinh,
        don: khoiDon,
        soTien: k.soTien,
        hinhThucThanhToan: nhan,
        tenKhoa: p.enrollment?.class?.course?.name ?? null,
        tenHocVien: tenHv,
        tenLop: p.enrollment?.class?.name ?? null,
        nguoiThu: p.recordedById ? (tenNguoiThu.get(p.recordedById) ?? null) : null,
        dongDon,
        cacDongKhoa: suyCacDongKhoa({ dongDon, khoaTheoId, khoaGhiDanh: p.enrollment?.class?.course ?? null }),
      }),
    );
  }
  const dd = don.invoiceStudentDob ? vnYmd(don.invoiceStudentDob).split("-").reverse().join("/") : null;
  // Các em còn lại (đơn nhiều con): ngày sinh đổi sang dd/mm/yyyy như em thứ nhất.
  const them = docHocVienThemLuu(don.invoiceHocVienThem).map((h) => ({ ten: h.ten, ngaySinh: h.ngaySinh ? h.ngaySinh.split("-").reverse().join("/") : null, cccd: h.cccd }));
  const hocVien =
    don.invoiceStudentName || dd || don.invoiceStudentCccd || don.invoiceCustomerCode || them.length > 0
      ? { ten: don.invoiceStudentName, ngaySinh: dd, cccd: don.invoiceStudentCccd, maKhachHang: don.invoiceCustomerCode, them }
      : null;
  return { ok: true, phapNhan, trang, khoiDon, phuongThuc, hocVien, tenHocVienTheoKhoan };
}
