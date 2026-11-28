// lib/hoa-hong/doi-nguon-chua-xong.ts — "ĐỔI NGUỒN SAU THU CHƯA ĐI HẾT QUY TRÌNH DUYỆT" (THUẦN, không DB).
//
// Câu hỏi: lead này có một lượt đổi nguồn sau thanh toán (`nguon.da-doi-sau-thanh-toan`) mà đề xuất điều chỉnh của nó CHƯA được ghi sổ trên ô đang xét không?
// Có ⇒ phần chênh lệch có nguyên nhân là ĐỔI NGUỒN / NGƯỜI HƯỞNG không được một người "Áp dụng" ở hàng chờ INPUT_DRIFT (hướng B+C: tiền chỉ đổi qua đề xuất một/hai cấp).
//
// Vì sao phải dựa trên SỰ KIỆN chứ không trên "ô có từng có đề xuất STALE/REJECTED" (cổng cũ `deXuatDoiNguonKetThucKhongGhi`):
//   · Khoảng giữa lúc đổi nguồn và lúc consumer lập đề xuất, lượt QUÉT THƯỜNG sinh INPUT_DRIFT mang đúng phần chênh do nguồn (probe RVX-C của rà vòng 2) — ô CHƯA có đề xuất nào.
//   · `tachChenhDoiNguon` chỉ nói VAI nào di chuyển, không nói VÌ SAO: `SOURCE_OWNER` là vai acquisition nên "chụp lại chủ nguồn" (cố ý KHÔNG phát sự kiện — đó không phải đổi nguồn của lead)
//     cũng rơi vào `deXuat`. Chỉ sự kiện của `doiNguonLead` (phát CÙNG transaction với mọi lượt đổi nguồn sau thu) nói đúng nguyên nhân.
//
// Một sự kiện "chưa xong" trên ô khi:
//   · chưa được consumer xử lý xong (`status` ≠ DONE: PENDING / PROCESSING / FAILED), HOẶC
//   · đã có đề xuất của sự kiện đó trên ô này mà KHÔNG phải POSTED (bị từ chối / lỗi thời / đang chờ) —
// và KHÔNG có đề xuất nào của chính sự kiện đó đã POSTED trên ô (đã ghi sổ ⇒ ô khớp nguồn mới).
// Sự kiện DONE mà ô không có đề xuất nào ⇒ consumer đã xem và không có gì để lập: không chặn. (Giới hạn đã biết: consumer cũng trả DONE khi engine TẮT — 08 §17.x.)
//
// KHÔNG so thời gian giữa `DomainEvent.createdAt` (đồng hồ DB) và `bc.now`/ngày fixture (luật 19) — chỉ quan hệ trạng thái.
//
// NGOẠI LỆ DUY NHẤT — sự kiện `FAILED` (vá §17.v4.Q, khe "khoá vĩnh viễn" của §17.R3b mục 1): handler hết lượt retry thì sự kiện nằm ở FAILED mãi (dispatcher không có đường requeue), và đề xuất
// lập ở đường backfill mang `refEventId = audit:<id>` chứ không phải `DomainEvent.id` nên "POSTED giải sự kiện" ở trên không bao giờ khớp ⇒ mọi "Áp dụng" của lead bị chặn vĩnh viễn.
// Nay FAILED được coi là XONG khi ô có một đề xuất đổi nguồn `POSTED` (bất kể refEventId) được LẬP TỪ LÚC sự kiện sinh ra trở đi: engine tính chênh với attribution HIỆN HÀNH và đối chiếu lại lúc duyệt,
// nên đề xuất ghi sổ sau sự kiện đã đưa ô về khớp nguồn hiện hành. So sánh hai mốc `createdAt` ĐỀU là mặc định `@default(now())` của schema (Prisma sinh lúc INSERT từ đồng hồ máy chủ ứng dụng; migration cũng có `DEFAULT CURRENT_TIMESTAMP`) — không phải `bc.now` hay ngày fixture nên không dính luật 19. Đề xuất backfill luôn lập SAU sự kiện hàng giờ/ngày (script chạy tay), nên độ lệch đồng hồ giữa các máy không đổi kết quả. Ràng buộc "từ lúc sự kiện" là
// cái giữ cho một đề xuất CŨ (của lần đổi nguồn trước) không mở khoá cho lần đổi nguồn mới — nếu không, đường một-người sống lại. Chỉ FAILED được mở như vậy: PENDING / PROCESSING còn chờ consumer.

export type SuKienDoiNguon = { id: string; status: string; createdAt: Date };
export type DeXuatDoiNguonCuaO = { refEventId: string | null; status: string; createdAt: Date };

export function suKienDoiNguonChuaXong(suKien: readonly SuKienDoiNguon[], deXuatCuaO: readonly DeXuatDoiNguonCuaO[]): SuKienDoiNguon[] {
  const ra: SuKienDoiNguon[] = [];
  for (const e of suKien) {
    const cua = deXuatCuaO.filter((d) => d.refEventId === e.id);
    if (cua.some((d) => d.status === "POSTED")) continue;
    if (e.status === "FAILED" && deXuatCuaO.some((d) => d.status === "POSTED" && d.createdAt.getTime() >= e.createdAt.getTime())) continue;
    if (e.status !== "DONE" || cua.length > 0) ra.push(e);
  }
  return ra;
}
