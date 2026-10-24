import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import type { PhieuThuPdfData } from "@/lib/pdf/phieu-thu";
import { lookupMethodNameByCode } from "@/lib/payments/method-lookup";
import { CAU_HINH_HOA_DON_MAC_DINH, phapNhanChoDon, type PhapNhan } from "./phap-nhan";
import type { DonChoHoaDon } from "./nguoi-mua";
import { dongDonCuaKhoan, dungPhieuThuData, tenHocVienChoKhoan } from "./phieu-thu-data";

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
      invoiceBuyerName: true,
      invoiceCompanyName: true,
      invoiceTaxCode: true,
      invoiceEmail: true,
      center: { select: { code: true } },
      student: { select: { name: true } },
      // Dòng đơn — tên + đơn vị của tờ phiếu đơn KIT / THI (`dongDonCuaKhoan`).
      items: { select: { itemName: true, type: true, quantity: true, totalPrice: true, discountAmount: true } },
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
            select: { itemName: true, type: true, quantity: true, totalPrice: true, discountAmount: true, student: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!don) return { ok: false, status: 404, error: "Không tìm thấy lần thu" };

  // Bên bán là PHÁP NHÂN theo `Center.code` — xem chú thích route bản chính thức.
  const cauHinh = CAU_HINH_HOA_DON_MAC_DINH;
  const phapNhan = phapNhanChoDon(don.center?.code ?? null, cauHinh);
  if (!phapNhan) {
    return {
      ok: false,
      status: 409,
      error: "Chưa khai pháp nhân phát hành trong Cấu hình hoá đơn — không in phiếu với mã số thuế đoán bừa",
    };
  }

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
    invoiceEmail: don.invoiceEmail,
  };

  const trang: PhieuThuPdfData[] = [];
  const phuongThuc: { ma: string; nhan: string }[] = [];
  for (const k of row.khoan) {
    const p = theoId.get(k.id);
    // Khoản vừa bị xoá mềm giữa hai câu tra — tờ in ra phải khớp lần thu, không in thiếu một trang.
    if (!p) return { ok: false, status: 409, error: "Lần thu vừa thay đổi — tải lại màn rồi thử lại" };
    const nhan = tenPt.get(p.method) ?? p.method;
    phuongThuc.push({ ma: p.method, nhan });
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
        tenHocVien: tenHocVienChoKhoan(p, don.student),
        tenLop: p.enrollment?.class?.name ?? null,
        nguoiThu: p.recordedById ? (tenNguoiThu.get(p.recordedById) ?? null) : null,
        dongDon: dongDonCuaKhoan(p, don.items),
      }),
    );
  }
  return { ok: true, phapNhan, trang, khoiDon, phuongThuc };
}
