// lib/trial/sau-khi-huy-case.ts — phần SAU KHI một case trial đã chuyển CANCELLED. MỘT chỗ cho mọi đường huỷ: huỷ tay
// (`cancelLopTrialSessionAction`), tự huỷ khi "Hoàn tất buổi" mà không ai có mặt, tự huỷ case cũ bị dời trống (21/10/2026,
// `lib/trial/ket-cuc-case.ts`), và lệnh dọn dữ liệu cũ (`scripts/trial-huy-case-vang-het.ts`). Bản chép là chỗ để lệch: quên
// Parttime ⇒ phân công còn treo và cờ Control Tower còn đỏ; quên báo GV ⇒ GV tới dạy case đã huỷ.
//
// Tự huỷ KHÔNG qua cổng `quyenXoaCase` (chủ case / khách của Sale khác) — có chủ đích: kết cục do DỮ LIỆU điểm danh/ghi danh
// quyết, không phải lựa chọn của người bấm; người bấm vẫn phải qua cổng của chính thao tác họ làm (hoàn tất / chuyển case).
//
// Gọi SAU khi phép ghi CANCELLED đã commit; từng bước tự nuốt lỗi của mình (đồng bộ Parttime đã ghi audit lỗi) — thao tác đã
// lưu không được biến thành "thất bại" trên màn.
import { danhDauVaDongBo } from "@/lib/parttime/dong-bo";
import { ghiTuongTacNhieuLead, layLeadTrongCaseTrial } from "@/lib/lead/tuong-tac/ghi";
import { notifyTrialTeacherAssigned } from "@/lib/trial/service";

/** Nhãn ngày VN cho nội dung thông báo (cột `@db.Date` = UTC-midnight ngày VN). */
const nhanNgay = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

export async function sauKhiHuyCase(p: {
  ses: { id: string; trialClassId: string; seq: number; date: Date; startTime: string; endTime: string; teacherId: string | null };
  tenLop: string;
  lopTheoKhung: boolean;
  lyDo: string;
  /** Tự huỷ theo luật (không phải người bấm "Huỷ buổi") — tin báo GV nói rõ và nhắc không tính công. */
  tuDong: boolean;
  nguoi: { id: string | null; name: string };
  /**
   * BẮT BUỘC (không mặc định): có báo giáo viên không. Huỷ trên màn ⇒ có (GV phải biết để không tới dạy). Lệnh dọn dữ liệu cũ
   * ⇒ không — case đã qua từ lâu, đẩy tin hàng loạt về những buổi cũ chỉ gây nhiễu.
   */
  baoGiaoVien: boolean;
}): Promise<void> {
  const { ses } = p;
  // Parttime (P3a): buổi trial huỷ ⇒ phân công chưa chốt đóng (đã chốt thì giữ, báo ngoại lệ).
  await danhDauVaDongBo([{ sourceType: "TRIAL_SESSION", sourceId: ses.id }], "TRIAL_HUY", p.nguoi);

  // Huỷ case KHÔNG đụng ghi danh (khác huỷ LỚP) — cố ý: bé vẫn trỏ vào case đã huỷ để còn vết "từng ở case nào", và màn lớp
  // đưa những bé đó vào khối "Chưa xếp case" (`laChuaXepCase`, lib/trial/nghia-null.ts) để xếp sang case khác. Chỉ lead có bé
  // TRONG CASE NÀY (23/09/2026) — huỷ case của Sale 2 không phải chuyện của phụ huynh ở case của Sale 1.
  await ghiTuongTacNhieuLead({
    leadIds: await layLeadTrongCaseTrial({ sessionId: ses.id, trialClassId: ses.trialClassId, lopTheoKhung: p.lopTheoKhung }),
    actorId: p.nguoi.id,
    actorName: p.nguoi.name,
    moc: new Date(),
    sk: { viec: "trial.huy-buoi", tenLop: p.tenLop, ngay: ses.date, lyDo: p.lyDo },
  });

  if (p.baoGiaoVien && ses.teacherId) {
    await notifyTrialTeacherAssigned({
      teacherId: ses.teacherId,
      title: p.tuDong ? "Case trải nghiệm đã tự huỷ" : "Buổi trải nghiệm đã bị huỷ",
      body:
        `Buổi ${ses.seq} · ${nhanNgay(ses.date)} ${ses.startTime}–${ses.endTime} đã huỷ ` +
        `và đã gỡ khỏi lịch dạy của bạn. Lý do: ${p.lyDo}` +
        (p.tuDong ? " — case huỷ thì không tính công dạy." : ""),
      dedupeKey: `trial-session.cancelled:${ses.id}`,
      entityId: ses.id,
    });
  }
}
