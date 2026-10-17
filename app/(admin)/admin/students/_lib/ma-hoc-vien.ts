// Ai được đặt / đổi MÃ HỌC VIÊN (26/09/2026). THUẦN.
//
// Chủ dự án 26/09: "mã học viên không được chỉnh sửa, chỉ admin được chỉnh". Quyền đã có sẵn
// từ R7-05 C10 — `students:change-code`, chỉ Quản trị tối cao — nhưng chưa từng được NỐI vào
// đâu: form cho mọi người có `students:edit` gõ đè mã, và action ghi thẳng.
//
// Mã là khoá tra cứu ở mọi màn (danh sách, điểm danh, đơn hàng, nội dung chuyển khoản), và là
// khoá upsert của màn nhập Excel — đổi tay là cắt đứt những chỗ đang trỏ vào mã cũ.
//
//   · TẠO: không có quyền ⇒ bỏ mã gửi lên, hệ thống tự sinh theo mã cơ sở (form không hiện ô
//     cho vai đó; mã có mặt nghĩa là một POST tay).
//   · SỬA: mã gửi lên KHÁC mã hiện có mà không có quyền ⇒ TỪ CHỐI (nói rõ, không lặng lẽ bỏ —
//     người sửa phải biết thay đổi của mình không được lưu). Mã gửi lên TRÙNG mã hiện có là vô
//     hại (form cũ gửi cả tờ) ⇒ cho qua.

export const LOI_DOI_MA_HOC_VIEN =
  "Chỉ Quản trị tối cao được sửa mã học viên — mã giữ nguyên, các ô khác chưa được lưu.";

export type QuyetDinhMa = { ok: true; ma: string | null | undefined } | { ok: false; loi: string };

export function quyetDinhMaHocVien(input: {
  cheDo: "tao" | "sua";
  /** Mã form gửi lên sau khi qua validator (`undefined` = không gửi). */
  maGui: string | null | undefined;
  /** Mã đang lưu (chế độ tạo: `null`). */
  maHienTai: string | null;
  duocDoiMa: boolean;
}): QuyetDinhMa {
  const gui = input.maGui ?? undefined;
  if (input.duocDoiMa) return { ok: true, ma: input.maGui };
  if (input.cheDo === "tao") return { ok: true, ma: undefined };
  if (gui === undefined || gui.trim() === (input.maHienTai ?? "").trim()) {
    return { ok: true, ma: undefined };
  }
  return { ok: false, loi: LOI_DOI_MA_HOC_VIEN };
}
