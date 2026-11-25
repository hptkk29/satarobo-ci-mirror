import "server-only";
import { db } from "@/lib/db";
import type { ActionScopeActor } from "@/lib/lms/report-card-core";
import type { CongVin } from "@/lib/vin-hoadon/http";
import { writeAudit } from "@/lib/audit/audit-log";
import { batDauPhatHanh, kiemTraLaiKhongGuiLai, LoiPhatHanh, traCuuNhapDaKy, type NguonPhieu, type SauBuoc } from "./phat-hanh-misa";
import type { NhaCungCapApi } from "./phap-nhan";
import type { QuyetNguoiMua } from "./nguoi-mua-theo-con";

// lib/finance/hoa-don/nhan-nhap-da-ky.ts — «NHẬN» bản nháp mà nhà cung cấp ĐÃ KÝ (kế toán 25/11/2026).
//
// Chuyện gì xảy ra: pháp nhân có chứng thư số HSM (CS1) thì VIN KÝ LUÔN bản nháp lúc `LapHoaDonGoc` — nháp thành hoá đơn THẬT có số (kế toán đo: nháp ORD-261121-000001 ⇒ 1C26MAI·27). Hệ thống không biết, nên hoá đơn nằm
// ngoài sổ: không khoá khoản, không PDF/XML, không email cho phụ huynh; kế toán phải tải về rồi «Tải lên». Còn pháp nhân CHƯA có HSM (CS2) thì nháp vẫn là nháp — hàm này phải để yên.
//
// Vì sao theo DỮ LIỆU chứ không theo cấu hình: cả hai pháp nhân đều khai `HSM_NHA_CUNG_CAP` trong bảng kết nối nhưng CS2 chưa có chứng thư (VIN trả `VIN_13` khi phát hành, 8–14/11). Chỉ VIN biết nháp đã ký hay chưa
// ⇒ hỏi VIN (`traCuu` theo refId của nháp): có số ⇒ nhận; chưa ⇒ `CHUA_KY`, không ghi gì.
//
// Thứ tự an toàn (hoá đơn đã ký là chứng từ thuế, không xoá được): TRA CỨU trước (chỉ đọc) → chỉ khi VIN đã có số mới `batDauPhatHanh` với CHÍNH refId của nháp (khoá khoản, qua mọi cổng nghiệp vụ, dấu tờ phải khớp tờ đã gửi
// ⇒ bản chụp người mua = tờ thật ở VIN) → `kiemTraLaiKhongGuiLai` (tra cứu + tải PDF/XML + xác nhận + email; KHÔNG BAO GIỜ gửi lại).

export type NhanNhap =
  /** VIN chưa có số cho bản nháp này (chưa ký / chưa kịp ký) — chưa ghi gì. */
  | { loai: "CHUA_KY"; thongDiep: string }
  /** VIN đã có số: bản ghi hoá đơn đã tạo (khoá khoản) và đã đi tiếp `sau` bước. */
  | { loai: "DA_NHAN"; hoaDonId: string; sau: SauBuoc };

export type DauVaoNhanNhap = {
  nguoiBam: { id: string; name: string };
  actor: ActionScopeActor;
  orderId: string;
  centerId: string;
  lanThuKey: string;
  khoan: readonly { id: string; soTien: number }[];
  nguon: NguonPhieu;
  cheDo: Parameters<typeof batDauPhatHanh>[0]["cheDo"];
  nhaCungCap: NhaCungCapApi;
  now: Date;
  /** Cổng VIN của ĐÚNG pháp nhân (`layCongNhapVinChoPhapNhan`) — có `traCuu` + `taiTep`. */
  cong: CongVin;
  nhap: {
    refId: string;
    mstNguoiBan: string;
    /** Người mua đã chọn lúc gửi nháp + dấu của tờ đã gửi (audit `GUI_NHAP_VIN`). */
    nguoiMuaChon: QuyetNguoiMua;
    dauPhieu: string;
  };
  /** Độ trễ (ms) trước mỗi lần hỏi VIN — HSM có thể ký chậm vài giây. Mặc định hỏi ngay + sau 4 giây; test truyền `[0]`. */
  cho?: readonly number[];
};

const nghi = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function nhanNhapDaKy(i: DauVaoNhanNhap): Promise<NhanNhap> {
  let lyDo = "VIN chưa có số hoá đơn cho bản nháp này (chưa ký).";
  let daCoSo = false;
  for (const ms of i.cho ?? [0, 4000]) {
    if (ms > 0) await nghi(ms);
    let kq;
    try {
      kq = await traCuuNhapDaKy(i.cong, i.nhap.refId, i.nhap.mstNguoiBan);
    } catch {
      lyDo = "Chưa hỏi được VIN — thử lại sau.";
      continue;
    }
    if (kq.loai === "DA_PHAT_HANH") {
      daCoSo = true;
      break;
    }
    if (kq.loai === "KHONG_RO") lyDo = kq.thongDiep;
  }
  // Vết lượt tra cứu (chưa có hoá đơn nên chưa có dòng nhật ký lượt gọi): không PII — chỉ refId của nháp + kết quả.
  await writeAudit({
    actor: i.nguoiBam,
    module: "finance",
    entityType: "Order",
    entityId: i.orderId,
    action: "TRA_CUU_NHAP_VIN",
    newValues: { refId: i.nhap.refId, lanThuKey: i.lanThuKey, ketQua: daCoSo ? "DA_CO_SO" : "CHUA_KY" },
    orgUnitId: i.centerId,
  }).catch((e: unknown) => console.error(`[hoa-don-nhan-nhap] không ghi được vết: ${e instanceof Error ? e.message : String(e)}`));
  if (!daCoSo) return { loai: "CHUA_KY", thongDiep: lyDo };

  // VIN ĐÃ có số ⇒ hoá đơn thật đã tồn tại. Nhận về với CHÍNH refId của nháp; dấu tờ phải khớp tờ đã gửi (đơn đổi sau lúc gửi nháp ⇒ `PHIEU_DA_DOI` ⇒ người gọi dịch thành câu).
  const bd = await batDauPhatHanh({
    nguoiBam: i.nguoiBam,
    actor: i.actor,
    orderId: i.orderId,
    centerId: i.centerId,
    lanThuKey: i.lanThuKey,
    khoan: i.khoan,
    nguon: i.nguon,
    cheDo: i.cheDo,
    nhaCungCap: i.nhaCungCap,
    now: i.now,
    // Người bấm là bước kiểm tra — như «Phát hành»: không qua hạn mức ký tự động (hoá đơn đã được ký rồi, hạn mức không còn gì để giữ).
    kieu: "BAM_TAY",
    refIdCoSan: i.nhap.refId,
    nguoiMuaChon: i.nhap.nguoiMuaChon,
    phieuDaThay: i.nhap.dauPhieu,
  });
  const sau = await kiemTraLaiKhongGuiLai({ hoaDonId: bd.hoaDonId, cong: i.cong, now: new Date(), nguoiGoiId: i.nguoiBam.id });
  return { loai: "DA_NHAN", hoaDonId: bd.hoaDonId, sau };
}

/** Câu cho kế toán khi nhận nháp bị cổng từ chối — riêng ca «đơn đổi sau khi gửi nháp» nói rõ hoá đơn đã ký ở VIN mang thông tin CŨ. */
export function cauNhanNhapBiTuChoi(e: unknown): string | null {
  if (e instanceof LoiPhatHanh && e.ma === "PHIEU_DA_DOI") {
    return "Đơn đã đổi sau khi gửi nháp, nhưng VIN ĐÃ ký bản nháp cũ — hoá đơn đó mang thông tin cũ. Không nhận tự động: tải hoá đơn từ VIN rồi «Tải lên» (hoặc lập biên bản điều chỉnh nếu thông tin sai).";
  }
  return null;
}

/**
 * Bản nháp ĐÃ LƯU gần nhất của một lần thu — từ vết `GUI_NHAP_VIN` (refId · người mua đã chọn · dấu tờ đã gửi). Thiếu bất kỳ thứ nào (nháp gửi TRƯỚC khi có tính năng nhận, hoặc VIN không lưu) ⇒ `null`:
 * không đoán — nhận một hoá đơn đã ký mà không chứng minh được nó giống tờ hiện tại là ghi sai sổ thuế.
 */
export async function docNhapGanNhat(orderId: string, lanThuKey: string): Promise<{ refId: string; nguoiMuaChon: QuyetNguoiMua; dauPhieu: string } | null> {
  const vet = await db.auditLog.findFirst({
    where: { entityType: "Order", entityId: orderId, action: "GUI_NHAP_VIN", newValues: { path: ["lanThuKey"], equals: lanThuKey } },
    orderBy: { createdAt: "desc" },
    select: { newValues: true },
  });
  const nv = vet?.newValues;
  if (typeof nv !== "object" || nv === null || Array.isArray(nv)) return null;
  const o = nv as Record<string, unknown>;
  const { refId, nguoiMuaChon, dauPhieu, ketQua } = o;
  if (ketQua !== "DA_LUU" || typeof refId !== "string" || !refId.startsWith("nhap-")) return null;
  if (nguoiMuaChon !== "CON" && nguoiMuaChon !== "PHU_HUYNH") return null;
  if (typeof dauPhieu !== "string" || !/^[0-9a-f]{32}$/.test(dauPhieu)) return null;
  return { refId, nguoiMuaChon, dauPhieu };
}
