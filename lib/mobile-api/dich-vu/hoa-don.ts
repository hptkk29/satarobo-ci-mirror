import { z } from "zod";

import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { khoHoaDonDaCauHinh, kyUrlTaiVeHoaDon } from "@/lib/finance/hoa-don/kho-tep";
import { docHoaDonDeTai, docMucHoaDon } from "@/lib/portal/hoa-don-phu-huynh";
import { kyUrlXemPdfHoaDon } from "@/lib/portal/hoa-don-phu-huynh-url";
import { huongChungTu, tenTepTaiVe } from "@/lib/portal/hoa-don-phu-huynh-thuan";
import { KHOAN_DA_DONG } from "@/lib/finance/debt";
import { taoPdfPhieuThuChoPhuHuynh } from "@/lib/portal/phieu-thu-ph";
import { khoanOnlineTaiDuoc, taoPdfPhieuThuOnlineChoPhuHuynh } from "@/lib/online-checkout/phieu-thu-online";

import { kiemLienKetPhieuThu, taoLienKetPhieuThu, TTL_LIEN_KET_PHIEU_THU_GIAY } from "../lien-ket-phieu-thu";
import { chanNeuCanQuyDinh, type MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.6 — HOÁ ĐƠN ĐIỆN TỬ phía phụ huynh: chỉ ĐỌC + cấp liên kết tải; lớp MỎNG bọc đúng domain web (`lib/portal/hoa-don-phu-huynh*`, `lib/finance/hoa-don/*`).
 * KHÔNG tạo / sửa / ký / phát hành hoá đơn (không có đường ghi nào ở đây).
 *
 *   · Hoá đơn nào hiện + của ai: MỘT truy vấn `whereHoaDonPhuHuynh` của web (đúng con của phụ huynh trong PHIÊN; bản NHÁP/THAY_THẾ/GIẢ_LẬP không hiện; đơn không có nhu cầu hoá đơn không hiện). Không thấy / của người khác / không phải bản được hiện ⇒ cùng 404.
 *   · `studentIds` lấy từ DB theo `parentUserId` của PHIÊN — không từ tham số client.
 *   · Cờ hoá đơn tắt ⇒ 404 (như web). Chưa đồng ý Quy định đào tạo của app ⇒ 403 POLICY_REQUIRED.
 *   · Liên kết tải: AUDIT trước (ném ⇒ 503 và KHÔNG ký), rồi ký URL GET 300 giây từ bucket RIÊNG; kho chưa cấu hình ⇒ 503 `KHO_HOA_DON_CHUA_SAN_SANG` (không bao giờ URL công khai; không có kho cục bộ trên app). Chế độ học sinh KHÔNG truy cập.
 */
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
export const TTL_LIEN_KET_HOA_DON_GIAY = 300;

/** `hocVienId`/`tenHocVien`: con mà hoá đơn thuộc về (từ đơn, hoặc từ ghi danh của khoản trên hoá đơn); `null` khi suy không ra MỘT con duy nhất — app KHÔNG lọc theo con trong trường hợp đó. */
export type HoaDonDto = { id: string; tieuDe: string; phu: string; khoa: string | null; tongTien: number; coPdf: boolean; coXml: boolean; tepDangChuanBi: boolean; hocVienId: string | null; tenHocVien: string | null };
export type DanhSachHoaDonDto = { hienMuc: boolean; muc: HoaDonDto[] };

async function conCuaPhuHuynh(nguoi: NguoiGoi): Promise<string[]> {
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  if (!(await laHoaDonBat().catch(() => false))) throw khongThay();
  await chanNeuCanQuyDinh(nguoi.userId); // cổng quy định của app (cùng cổng mọi endpoint dữ liệu); cổng «Chính sách website» của web là luồng cookie riêng — app chưa có (B-INV-POLICY)
  const cs = await db.student.findMany({ where: { parentUserId: nguoi.userId, deletedAt: null }, select: { id: true } });
  return cs.map((c) => c.id);
}

export async function danhSachHoaDon(nguoi: NguoiGoi): Promise<DanhSachHoaDonDto> {
  const ids = await conCuaPhuHuynh(nguoi);
  const m = await docMucHoaDon(ids);
  const conCua = await conCuaTungHoaDon(ids, m.items.map((h) => h.id));
  return {
    hienMuc: m.bat,
    muc: m.items.map((h) => ({ id: h.id, tieuDe: h.tieuDe, phu: h.phu, khoa: h.khoa, tongTien: h.tongTien, coPdf: h.hrefPdf !== null || (h.tepDangChuanBi && h.hrefXml === null), coXml: h.hrefXml !== null, tepDangChuanBi: h.tepDangChuanBi, hocVienId: conCua.get(h.id)?.id ?? null, tenHocVien: conCua.get(h.id)?.ten ?? null })),
  };
}

/** Con của từng hoá đơn: `Order.studentId` nếu có; không thì các ghi danh của khoản trên hoá đơn — CHỈ khi suy ra ĐÚNG MỘT con (của phụ huynh). Nhiều con / không rõ ⇒ không có mục (null). */
async function conCuaTungHoaDon(studentIds: readonly string[], hoaDonIds: readonly string[]): Promise<Map<string, { id: string; ten: string }>> {
  const kq = new Map<string, { id: string; ten: string }>();
  if (hoaDonIds.length === 0 || studentIds.length === 0) return kq;
  const hd = await db.hoaDonDienTu.findMany({
    where: { id: { in: [...hoaDonIds] } },
    select: { id: true, order: { select: { studentId: true } }, khoan: { where: { hieuLuc: true }, select: { payment: { select: { enrollment: { select: { studentId: true } } } } } } },
  });
  const cua = new Set(studentIds);
  const ten = new Map((await db.student.findMany({ where: { id: { in: [...studentIds] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  for (const h of hd) {
    const ds = new Set<string>();
    if (h.order.studentId) ds.add(h.order.studentId);
    for (const k of h.khoan) {
      const sid = k.payment.enrollment?.studentId;
      if (sid) ds.add(sid);
    }
    const trongNha = [...ds].filter((x) => cua.has(x));
    if (trongNha.length === 1) kq.set(h.id, { id: trongNha[0]!, ten: ten.get(trongNha[0]!) ?? "" });
  }
  return kq;
}

export const lienKetTaiSchema = z.object({ loai: z.enum(["pdf", "xml"]), cachMo: z.enum(["xem", "tai"]).default("tai") }).strict();
export type LienKetTaiBody = z.infer<typeof lienKetTaiSchema>;
export type LienKetTaiDto = { url: string; hetHanSauGiay: number; tenTep: string };

export async function lienKetTaiHoaDon(nguoi: NguoiGoi, hoaDonId: string, body: LienKetTaiBody): Promise<LienKetTaiDto> {
  const ids = await conCuaPhuHuynh(nguoi);
  const id = hoaDonId.trim();
  if (!id || id.length > 64) throw khongThay();
  const hd = await docHoaDonDeTai(ids, id);
  if (!hd) throw khongThay();
  const khoa = body.loai === "pdf" ? hd.tepPdfKey : hd.tepXmlKey;
  if (!khoa) throw khongThay(); // chưa có tệp loại này (cùng 404)
  if (!khoHoaDonDaCauHinh()) throw new LoiApiMobile("KHO_HOA_DON_CHUA_SAN_SANG", 503, "Kho lưu hoá đơn chưa sẵn sàng. Vui lòng thử lại sau hoặc liên hệ trung tâm.");
  const xem = body.loai === "pdf" && body.cachMo === "xem";
  try {
    await writeAudit({
      actor: { id: nguoi.userId, name: nguoi.name || nguoi.email || nguoi.userId },
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: hd.id,
      action: "PH_TAI_TEP_HOA_DON",
      // KHÔNG chép khoá tệp hay URL.
      newValues: { loai: body.loai, cachMo: xem ? "XEM" : "TAI_VE", nguoiTai: "PHU_HUYNH", kenh: "APP" },
      orgUnitId: hd.orgUnitId,
    });
  } catch {
    throw new LoiApiMobile("SERVER", 503, "Chưa tải được hoá đơn lúc này. Vui lòng thử lại.", 5); // không để lại dấu thì không ký
  }
  const tenTep = tenTepTaiVe({ kyHieu: hd.kyHieu, soHoaDon: hd.soHoaDon, loai: body.loai, tenDaLuu: body.loai === "pdf" ? hd.tepPdfTen : hd.tepXmlTen });
  try {
    const url = xem ? await kyUrlXemPdfHoaDon(khoa, TTL_LIEN_KET_HOA_DON_GIAY) : await kyUrlTaiVeHoaDon(khoa, tenTep, TTL_LIEN_KET_HOA_DON_GIAY);
    return { url, hetHanSauGiay: TTL_LIEN_KET_HOA_DON_GIAY, tenTep };
  } catch {
    throw new LoiApiMobile("KHO_HOA_DON_CHUA_SAN_SANG", 503, "Kho lưu hoá đơn đang lỗi. Vui lòng thử lại.");
  }
}

export type PhieuThuPdf = { pdf: Uint8Array; tenTep: string };

/**
 * PHIẾU THU PDF của khoản ĐÃ ĐÓNG cho con mình (đơn thuộc nhóm «phiếu thu», không phải nhóm hoá đơn). Sở hữu + luật nhóm chứng từ nằm TRONG `taoPdfPhieuThuChoPhuHuynh` của web (một truy vấn, `childIds` từ DB theo phiên). Không thấy / của người khác / sai nhóm ⇒ cùng 404; tạo PDF lỗi ⇒ 503.
 * Cờ hoá đơn KHÔNG áp: phiếu thu có ngay cả khi màn hoá đơn tắt — đúng như web.
 */
export async function phieuThuPdf(nguoi: NguoiGoi, paymentId: string): Promise<PhieuThuPdf> {
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  await chanNeuCanQuyDinh(nguoi.userId);
  const id = paymentId.trim();
  if (!id || id.length > 64) throw khongThay();
  const cs = await db.student.findMany({ where: { parentUserId: nguoi.userId, deletedAt: null }, select: { id: true } });
  // V8.19: khoản của đơn ONLINE không có ghi danh Offline ⇒ đường web trả null; thử đường Online (sở hữu theo `Order.createdById`, pháp nhân theo `Order.legalEntityId`).
  const kq = (await taoPdfPhieuThuChoPhuHuynh(cs.map((c) => c.id), id)) ?? (await taoPdfPhieuThuOnlineChoPhuHuynh(nguoi.userId, id));
  if (!kq) throw khongThay();
  if (!kq.ok) {
    if (kq.status === 404) throw khongThay();
    throw new LoiApiMobile("SERVER", 503, "Chưa tạo được phiếu thu. Vui lòng thử lại sau hoặc liên hệ trung tâm.", 5);
  }
  return { pdf: kq.pdf, tenTep: kq.tenTep };
}

/**
 * Các khoản (của MỘT con) mà phụ huynh TẢI ĐƯỢC phiếu thu: ĐÚNG điều kiện của `taoPdfPhieuThuChoPhuHuynh` (đã đóng, loại PAYMENT, có biên nhận ACTIVE) + đơn thuộc nhóm «phiếu thu» (không phải nhóm hoá đơn) — để app không vẽ nút chắc chắn lỗi.
 * MỘT truy vấn cho cả danh sách; sở hữu nằm trong `where` (enrollment.studentId = con ĐÃ kiểm).
 */
export async function khoanTaiDuocPhieuThu(hs: MaHocVienDaKiem, paymentIds: readonly string[]): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set();
  const ds = await db.payment.findMany({
    where: { id: { in: [...paymentIds] }, ...KHOAN_DA_DONG, paymentType: "PAYMENT", enrollment: { studentId: hs, deletedAt: null }, receipts: { some: { status: "ACTIVE", deletedAt: null } } },
    select: { id: true, order: { select: { createdAt: true, invoiceBuyerName: true, invoiceCompanyName: true, invoiceTaxCode: true, invoiceEmail: true } } },
  });
  return new Set(ds.filter((p) => p.order && huongChungTu(p.order) === "PHIEU_THU").map((p) => p.id));
}

export const lienKetPhieuThuSchema = z.object({}).strict();
export type LienKetPhieuThuDto = { url: string; hetHanSauGiay: number };

/**
 * `POST /parent/receipts/:paymentId/download-link` — cấp URL tự ký (300 giây) để mở phiếu thu bằng trình duyệt hệ thống. KIỂM sở hữu + nhóm chứng từ TRƯỚC khi cấp (cùng điều kiện với `khoanTaiDuocPhieuThu`),
 * ghi AuditLog `PH_TAI_PHIEU_THU` TRƯỚC khi ký (ném ⇒ 503, không ký). Không có/của người khác/sai nhóm ⇒ cùng 404.
 */
export async function lienKetTaiPhieuThu(nguoi: NguoiGoi, paymentId: string, goc: string, now = new Date()): Promise<LienKetPhieuThuDto> {
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  await chanNeuCanQuyDinh(nguoi.userId);
  const id = paymentId.trim();
  if (!id || id.length > 64) throw khongThay();
  const cs = await db.student.findMany({ where: { parentUserId: nguoi.userId, deletedAt: null }, select: { id: true } });
  let thay = false;
  for (const c of cs) {
    if ((await khoanTaiDuocPhieuThu(c.id as MaHocVienDaKiem, [id])).has(id)) {
      thay = true;
      break;
    }
  }
  if (!thay) thay = await khoanOnlineTaiDuoc(nguoi.userId, id); // V8.19: phiếu thu đơn Online
  if (!thay) throw khongThay();
  try {
    await writeAudit({
      actor: { id: nguoi.userId, name: nguoi.name || nguoi.email || nguoi.userId },
      module: "finance",
      entityType: "Payment",
      entityId: id,
      action: "PH_TAI_PHIEU_THU",
      newValues: { nguoiTai: "PHU_HUYNH", kenh: "APP" }, // KHÔNG chép token/URL
    });
  } catch {
    throw new LoiApiMobile("SERVER", 503, "Chưa tải được phiếu thu lúc này. Vui lòng thử lại.", 5);
  }
  const { token } = taoLienKetPhieuThu(nguoi.userId, id, now);
  return { url: `${goc.replace(/\/$/, "")}/api/dl/phieu-thu/${token}`, hetHanSauGiay: TTL_LIEN_KET_PHIEU_THU_GIAY };
}

/** Đổi token lấy PDF (route công khai `/api/dl/phieu-thu/:token`): chữ ký + hạn, rồi KIỂM LẠI người dùng còn hoạt động + khoản còn thuộc con của họ. Mọi thất bại ⇒ cùng «không có». */
export async function pdfTheoLienKet(token: string, now = new Date()): Promise<PhieuThuPdf | null> {
  const k = kiemLienKetPhieuThu(token, now);
  if (!k.ok) return null;
  const u = await db.user.findFirst({ where: { id: k.userId, deletedAt: null, isActive: true }, select: { id: true } });
  if (!u) return null;
  const cs = await db.student.findMany({ where: { parentUserId: u.id, deletedAt: null }, select: { id: true } });
  // KIỂM LẠI sở hữu + nhóm chứng từ lúc tải (khoản đổi chủ / đơn đổi nhóm sau khi cấp ⇒ vô hiệu), rồi mới dựng PDF.
  let conSoHuu = false;
  for (const c of cs) {
    if ((await khoanTaiDuocPhieuThu(c.id as MaHocVienDaKiem, [k.paymentId])).has(k.paymentId)) {
      conSoHuu = true;
      break;
    }
  }
  if (!conSoHuu) conSoHuu = await khoanOnlineTaiDuoc(u.id, k.paymentId); // V8.19: phiếu thu đơn Online (kiểm lại sở hữu lúc tải)
  if (!conSoHuu) return null;
  const kq = (await taoPdfPhieuThuChoPhuHuynh(cs.map((c) => c.id), k.paymentId)) ?? (await taoPdfPhieuThuOnlineChoPhuHuynh(u.id, k.paymentId));
  if (!kq || !kq.ok) return null;
  return { pdf: kq.pdf, tenTep: kq.tenTep };
}

