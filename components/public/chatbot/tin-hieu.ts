// Tín hiệu giữa khung chat "Hỏi Sata Robo" và popup học thử 1-1 [chủ dự án 07/11/2026: "khi đang chat với
// chatbot thì không cho hiện popup… khó chịu"]. Hai component nằm ở hai nhánh khác nhau của layout public nên
// nói chuyện bằng MỘT sự kiện trình duyệt, không qua state chung.
//  · `mo`    — khung chat vừa mở / đóng ⇒ popup huỷ / hẹn lại đồng hồ.
//  · `daGui` — phụ huynh đã để lại thông tin qua chatbot ⇒ popup coi như đã gửi form, không hiện nữa.

export const SU_KIEN_CHATBOT = "satarobo:chatbot";

export type TinHieuChatbot = { mo: boolean } | { daGui: true };

export function phatTinHieuChatbot(tin: TinHieuChatbot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TinHieuChatbot>(SU_KIEN_CHATBOT, { detail: tin }));
}

/** Đăng ký nghe; trả hàm huỷ (dùng thẳng làm cleanup của `useEffect`). */
export function ngheTinHieuChatbot(xuLy: (tin: TinHieuChatbot) => void): () => void {
  const nghe = (e: Event) => {
    const tin = (e as CustomEvent<TinHieuChatbot>).detail;
    if (tin) xuLy(tin);
  };
  window.addEventListener(SU_KIEN_CHATBOT, nghe);
  return () => window.removeEventListener(SU_KIEN_CHATBOT, nghe);
}
