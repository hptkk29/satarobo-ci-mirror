// Hẹn giờ popup đặt buổi học thử — ĐÚNG hành vi artifact (Main.dc.html: `schedulePopup(20000)`; `closePopup → schedulePopup(60000)`;
// đã gửi form thì không hiện nữa). Tách thuần để test bằng đồng hồ giả.

/** Lần đầu: hiện sau 20 giây kể từ lúc vào trang. */
export const POPUP_LAN_DAU_MS = 20_000;
/** Đóng rồi (nút ×, "Để sau", bấm nền, Esc) thì 60 giây sau hiện lại. */
export const POPUP_SAU_KHI_DONG_MS = 60_000;
/** Đã GỬI form (ở bất kỳ nơi nào của popup) thì không hiện nữa — lưu localStorage. */
export const POPUP_DA_GUI_KEY = "satarobo-popup-hoc-thu-da-gui";

type KhoLuu = Pick<Storage, "getItem" | "setItem">;

export function docDaGui(kho: KhoLuu | null | undefined): boolean {
  try {
    return kho?.getItem(POPUP_DA_GUI_KEY) === "1";
  } catch {
    return false;
  }
}

export function ghiDaGui(kho: KhoLuu | null | undefined): void {
  try {
    kho?.setItem(POPUP_DA_GUI_KEY, "1");
  } catch {
    /* chế độ riêng tư: lần sau popup có thể hiện lại, chấp nhận */
  }
}

/** Độ trễ tới lần hiện kế tiếp; `null` = không hẹn nữa (đã gửi). */
export function doTreKeTiep(luc: "vao-trang" | "dong", daGui: boolean): number | null {
  if (daGui) return null;
  return luc === "vao-trang" ? POPUP_LAN_DAU_MS : POPUP_SAU_KHI_DONG_MS;
}
