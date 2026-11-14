import "server-only";
import { randomUUID } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import type { ActionScopeActor } from "@/lib/lms/report-card-core";
import type { CongVin } from "@/lib/vin-hoadon/http";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { dungPhieuNhap, LoiPhatHanh, thongDiepLoiPhatHanh, type NguonPhieu } from "./phat-hanh-misa";
import { LoiChotHoaDon } from "./chot-hoa-don";
import { MA_TU_CHAN } from "@/lib/vin-hoadon/anh-xa";
import { rutThongDiepNhatKy } from "./nhat-ky-luot-goi";

// lib/finance/hoa-don/gui-nhap-vin.ts — «GỬI NHÁP LÊN VIN» (chủ dự án 08/11/2026): lưu MỘT bản hoá đơn NHÁP (hàm LapHoaDonGoc, KHÔNG ký) lên VIN bằng CHÍNH dữ liệu của một lần thu thật,
// để kế toán xem VIN có nhận đúng không (MST, ký hiệu, người mua, số tiền) TRƯỚC khi cho hệ thống tự phát hành. HSM chưa kích hoạt vẫn thử được: nháp không cần ký.
//
// ⚠️ Nháp KHÔNG phải hoá đơn: không số, không chứng từ thuế, xoá được ở trang quản trị VIN (VISNAM 02/11/2026). Vì thế hàm này:
//   · KHÔNG tạo `HoaDonDienTu`, KHÔNG khoá khoản, KHÔNG giữ chỗ hạn mức, KHÔNG đổi trạng thái nghĩa vụ — chỉ dựng phiếu bằng đúng các cổng + cách dựng của phát hành thật (`dungPhieuNhap`, rollback)
//     rồi gọi `luuNhap`;
//   · dùng `refId` RIÊNG (`nhap-<uuid>`): refId của phát hành thật sinh lúc tạo hoá đơn, và `ma_hoadon` trùng ở VIN là lỗi 03 — nháp mang cùng mã sẽ chặn chính hoá đơn thật sau này;
//   · chỉ vết là `AuditLog` (hành động `GUI_NHAP_VIN`, KHÔNG lưu thân phiếu / PII — chỉ khoá, ký hiệu, tổng tiền, kết quả).

export type TomTatNhap = {
  kyHieu: string;
  mstNguoiBan: string;
  tongThanhToan: number;
  soDong: number;
  /** Tên người mua như phiếu mang đi (kế toán đối chiếu với trang VIN). */
  nguoiMuaTen: string;
  nguoiMuaMst: string | null;
};

export type KetQuaGuiNhap =
  | { ok: true; refId: string; maGiaoDich: string; tomTat: TomTatNhap }
  /** `ma`: mã VIN trả (VIN_08…) hoặc mã nội bộ; `thongDiep` đã viết bằng lời cho kế toán. `daGui`: có chạm VIN hay không (cổng nghiệp vụ từ chối ⇒ false). */
  | { ok: false; ma: string; thongDiep: string; daGui: boolean; refId: string | null; tomTat: TomTatNhap | null };

function tomTat(p: PhieuPhatHanh): TomTatNhap {
  return {
    kyHieu: p.kyHieu,
    mstNguoiBan: p.mstNguoiBan,
    tongThanhToan: p.tongThanhToan,
    soDong: p.dong.length,
    nguoiMuaTen: p.nguoiMua.donVi?.trim() || p.nguoiMua.hoTen || "",
    nguoiMuaMst: p.nguoiMua.mst ?? null,
  };
}

export type DauVaoGuiNhap = {
  nguoiBam: { id: string; name: string };
  actor: ActionScopeActor;
  orderId: string;
  centerId: string;
  lanThuKey: string;
  khoan: readonly { id: string; soTien: number }[];
  nguon: NguonPhieu;
  now: Date;
  /** Cổng VIN của ĐÚNG pháp nhân (`layCongNhapVinChoPhapNhan`). */
  cong: CongVin;
};

export async function guiNhapLenVin(i: DauVaoGuiNhap): Promise<KetQuaGuiNhap> {
  // 1) Cổng nghiệp vụ + dựng phiếu = ĐÚNG đường phát hành thật; không ghi gì. Cổng từ chối ⇒ chưa chạm VIN.
  let phieuGoc: PhieuPhatHanh;
  let phapNhanMa: string;
  try {
    const d = await dungPhieuNhap({
      nguoiBam: i.nguoiBam,
      actor: i.actor,
      orderId: i.orderId,
      centerId: i.centerId,
      lanThuKey: i.lanThuKey,
      khoan: i.khoan,
      nguon: i.nguon,
      cheDo: i.cong.cheDo,
      now: i.now,
      nhaCungCap: "VIN_HOADON",
    });
    phieuGoc = d.phieu;
    phapNhanMa = d.phapNhanMa;
  } catch (e) {
    const cau = thongDiepLoiPhatHanh(e);
    if (cau === null) throw e; // lỗi lạ (DB, bug) — để nổi lên, không giả làm «cổng từ chối»
    const ma = e instanceof LoiPhatHanh || e instanceof LoiChotHoaDon ? e.ma : "PHIEU_KHONG_HOP_LE";
    return { ok: false, ma, thongDiep: cau, daGui: false, refId: null, tomTat: null };
  }

  // 2) refId RIÊNG của nháp — không bao giờ dùng lại refId của bản thật (xem đầu tệp).
  const phieu: PhieuPhatHanh = { ...phieuGoc, refId: `nhap-${randomUUID()}` };
  const tt = tomTat(phieu);

  // 3) Lưu nháp. `luuNhap` tự kiểm phiếu theo luật VIN trước khi gửi (không gửi nếu chắc chắn bị từ chối).
  const kq = await i.cong.kyUsb.luuNhap(phieu);

  // 4) Vết kiểm toán — không thân phiếu, không PII. Ghi hỏng ⇒ chỉ log (nháp đã gửi, không thu hồi được).
  await writeAudit({
    actor: i.nguoiBam,
    module: "finance",
    entityType: "Order",
    entityId: i.orderId,
    action: "GUI_NHAP_VIN",
    newValues: {
      refId: phieu.refId,
      lanThuKey: i.lanThuKey,
      phapNhanMa,
      kyHieu: tt.kyHieu,
      tongThanhToan: tt.tongThanhToan,
      ketQua: kq.loai,
      ...(kq.loai === "TU_CHOI" ? { ma: kq.ma } : {}),
      ...(kq.loai === "DA_LUU" ? { maGiaoDich: kq.maGiaoDich } : {}),
    },
    orgUnitId: i.centerId,
  }).catch((e: unknown) => console.error(`[hoa-don-gui-nhap] không ghi được vết: ${e instanceof Error ? e.message : String(e)}`));

  if (kq.loai === "DA_LUU") return { ok: true, refId: phieu.refId, maGiaoDich: kq.maGiaoDich, tomTat: tt };
  if (kq.loai === "TU_CHOI") return { ok: false, ma: kq.ma, thongDiep: rutThongDiepNhatKy(kq.thongDiep) ?? "VIN từ chối.", daGui: kq.ma !== MA_TU_CHAN, refId: phieu.refId, tomTat: tt };
  return { ok: false, ma: "KHONG_RO", thongDiep: rutThongDiepNhatKy(kq.thongDiep) ?? "Chưa rõ VIN đã lưu nháp hay chưa.", daGui: true, refId: phieu.refId, tomTat: tt };
}
