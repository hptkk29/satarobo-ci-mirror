import "server-only";
import { db } from "@/lib/db";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { khoHoaDonDaCauHinh } from "@/lib/finance/hoa-don/kho-tep";
import { thuMucKhoCucBo } from "@/lib/portal/hoa-don-kho-cuc-bo";
import {
  coNhuCauHoaDon,
  dungHoaDonHienThi,
  whereDonCoNhuCauCuaCon,
  whereHoaDonPhuHuynh,
  type HoaDonHienThi,
} from "@/lib/portal/hoa-don-phu-huynh-thuan";

// Cổng phụ huynh — mục «Hoá đơn» (03/11/2026). Luật chọn hoá đơn nào hiện + của ai nằm ở `hoa-don-phu-huynh-thuan.ts`
// (`whereHoaDonPhuHuynh`) — danh sách và route tải CÙNG gọi nó.
//
// Cố ý đọc `db` TRẦN, không qua `scopedDb`: actor PARENT không đứng ở đâu trong cây OrgUnit nên scope sẽ trả rỗng
// (xem `lib/portal/billing.ts`). Cổng sở hữu là điều kiện `studentIds` trong `whereHoaDonPhuHuynh` — studentIds PHẢI đến
// từ danh sách con của phụ huynh đang đăng nhập (`getChildren` / `requireActiveStudent`), KHÔNG BAO GIỜ từ URL/form.

const TOI_DA = 50;

export type MucHoaDon = {
  /**
   * Có vẽ mục «Hoá đơn» không: cờ hoá đơn (`billing.hoaDonEnabled`) BẬT **và** phụ huynh CÓ NHU CẦU (có ít nhất một đơn của con
   * đã khai người mua — `coNhuCauHoaDon`). Tắt cờ hoặc không nhu cầu ⇒ ẩn hẳn, kể cả trạng thái rỗng.
   */
  bat: boolean;
  items: HoaDonHienThi[];
};

const MUC_AN: MucHoaDon = { bat: false, items: [] };

/** Con `studentIds` có đơn nào CÓ NHU CẦU hoá đơn không (lọc thô ở DB, rồi kiểm lại bằng hàm thuần). */
async function conDonCoNhuCau(studentIds: readonly string[]): Promise<boolean> {
  const don = await db.order.findMany({
    where: whereDonCoNhuCauCuaCon(studentIds),
    select: { invoiceBuyerName: true, invoiceCompanyName: true, invoiceTaxCode: true, invoiceEmail: true },
    take: 20,
  });
  return don.some(coNhuCauHoaDon);
}

/**
 * Mục «Hoá đơn» của các con `studentIds`. Cờ tắt ⇒ ẩn và KHÔNG đụng DB hoá đơn; không có đơn nào có nhu cầu ⇒ ẩn; có nhu cầu nhưng
 * chưa có hoá đơn đã xuất ⇒ `bat:true, items:[]` (màn nói «sẽ hiện ở đây khi hệ thống xuất xong»).
 */
export async function docMucHoaDon(studentIds: readonly string[]): Promise<MucHoaDon> {
  if (!(await laHoaDonBat())) return MUC_AN;
  if (studentIds.length === 0) return MUC_AN;
  if (!(await conDonCoNhuCau(studentIds))) return MUC_AN;

  const rows = await db.hoaDonDienTu.findMany({
    where: whereHoaDonPhuHuynh(studentIds),
    select: {
      id: true,
      soHoaDon: true,
      kyHieu: true,
      ngayPhatHanh: true,
      xacNhanLuc: true,
      tongTien: true,
      tepPdfKey: true,
      tepXmlKey: true,
      order: { select: { invoiceBuyerName: true, invoiceCompanyName: true, invoiceTaxCode: true, invoiceEmail: true, items: { select: { itemName: true }, take: 5 } } },
      khoan: {
        where: { hieuLuc: true },
        select: { payment: { select: { enrollment: { select: { course: { select: { name: true } } } } } } },
      },
    },
    orderBy: [{ ngayPhatHanh: "desc" }, { xacNhanLuc: "desc" }],
    take: TOI_DA,
  });

  const khoOk = khoHoaDonDaCauHinh() || thuMucKhoCucBo() !== null; // kho cục bộ: chỉ dev (tắt cứng ở production)
  return {
    bat: true,
    items: rows
      .filter((r) => coNhuCauHoaDon(r.order))
      .map((r) =>
      dungHoaDonHienThi(
        {
          id: r.id,
          soHoaDon: r.soHoaDon,
          kyHieu: r.kyHieu,
          ngayPhatHanh: r.ngayPhatHanh,
          xacNhanLuc: r.xacNhanLuc,
          tongTien: r.tongTien,
          coPdf: !!r.tepPdfKey,
          coXml: !!r.tepXmlKey,
          tenKhoaTuKhoan: r.khoan.map((k) => k.payment.enrollment?.course?.name ?? null),
          tenDongDon: r.order.items.map((i) => i.itemName),
        },
        khoOk,
      ),
    ),
  };
}

export type HoaDonDeTai = {
  id: string;
  orgUnitId: string | null;
  kyHieu: string | null;
  soHoaDon: string | null;
  tepPdfKey: string | null;
  tepPdfTen: string | null;
  tepXmlKey: string | null;
  tepXmlTen: string | null;
};

/**
 * Tra MỘT hoá đơn để tải. `null` = không thấy (không tồn tại · không phải của con nào của phụ huynh · không phải bản
 * được phép hiện) — route trả 404 y hệt cho cả ba, không lộ sự tồn tại. `studentIds` = MỌI con của phụ huynh đang đăng nhập.
 */
export async function docHoaDonDeTai(studentIds: readonly string[], hoaDonId: string): Promise<HoaDonDeTai | null> {
  if (studentIds.length === 0 || !hoaDonId) return null;
  const hd = await db.hoaDonDienTu.findFirst({
    where: whereHoaDonPhuHuynh(studentIds, hoaDonId),
    select: {
      order: { select: { invoiceBuyerName: true, invoiceCompanyName: true, invoiceTaxCode: true, invoiceEmail: true } },
      id: true,
      orgUnitId: true,
      kyHieu: true,
      soHoaDon: true,
      tepPdfKey: true,
      tepPdfTen: true,
      tepXmlKey: true,
      tepXmlTen: true,
    },
  });
  // Kiểm lại NHU CẦU bằng hàm thuần (điều kiện DB chỉ là lọc thô): đơn không khai người mua ⇒ không thấy.
  if (!hd || !coNhuCauHoaDon(hd.order)) return null;
  const { order: _order, ...gon } = hd;
  void _order;
  return gon;
}

export type HoaDonMoiChoFeed = { id: string; soHoaDon: string | null; kyHieu: string | null; at: string; studentId: string | null };

/**
 * Hoá đơn ĐÃ XUẤT (DA_XAC_NHAN, không phải bản mô phỏng) của đơn CÓ NHU CẦU, thuộc các con `children` — nguồn của mục chuông
 * «Có hoá đơn mới». Đọc-khi-hiển-thị, không ghi gì. Cờ tắt ⇒ rỗng. Mới nhất trước, tối đa 10.
 */
export async function docHoaDonMoiChoFeed(children: readonly { id: string }[]): Promise<HoaDonMoiChoFeed[]> {
  if (children.length === 0 || !(await laHoaDonBat())) return [];
  const ids = children.map((c) => c.id);
  const rows = await db.hoaDonDienTu.findMany({
    where: whereHoaDonPhuHuynh(ids),
    select: {
      id: true,
      soHoaDon: true,
      kyHieu: true,
      xacNhanLuc: true,
      ngayPhatHanh: true,
      createdAt: true,
      order: { select: { studentId: true, invoiceBuyerName: true, invoiceCompanyName: true, invoiceTaxCode: true, invoiceEmail: true } },
      khoan: { where: { hieuLuc: true }, select: { payment: { select: { enrollment: { select: { studentId: true } } } } } },
    },
    orderBy: [{ xacNhanLuc: "desc" }, { createdAt: "desc" }],
    take: 10,
  });
  const cua = new Set(ids);
  return rows
    .filter((r) => coNhuCauHoaDon(r.order))
    .map((r) => {
      const tuKhoan = r.khoan.map((k) => k.payment.enrollment?.studentId).find((x): x is string => !!x && cua.has(x));
      const sid = r.order.studentId && cua.has(r.order.studentId) ? r.order.studentId : (tuKhoan ?? null);
      return {
        id: r.id,
        soHoaDon: r.soHoaDon,
        kyHieu: r.kyHieu,
        at: (r.xacNhanLuc ?? r.createdAt).toISOString(),
        studentId: sid,
      };
    });
}
