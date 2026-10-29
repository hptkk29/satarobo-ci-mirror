// Sự kiện trình duyệt: "phụ huynh vừa đọc hết thông báo đang hiện".
//
// Badge chuông được dựng ở LAYOUT (Server Component), còn việc đánh dấu đã đọc xảy ra
// ở trang con sau khi trang đã hiện. Đo 04/09: `router.refresh()` + `revalidatePath`
// đều KHÔNG kéo badge của layout về 0 trong cùng một lượt xem — số chỉ đúng từ lần
// điều hướng kế tiếp. Người dùng ngồi lại trang Thông báo thì vẫn thấy con số cũ,
// đúng cái triệu chứng vé này định chữa.
//
// Nên badge tự trừ ngay ở client khi nhận sự kiện này; lượt tải sau server vẫn là
// nguồn đúng, client chỉ đi trước một nhịp.
export const SU_KIEN_DA_DOC_THONG_BAO = "satarobo:thong-bao-da-doc";

export function baoDaDocThongBao(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SU_KIEN_DA_DOC_THONG_BAO));
}
