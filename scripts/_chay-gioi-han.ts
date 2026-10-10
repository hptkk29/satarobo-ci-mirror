/**
 * Chạy một danh sách việc với SỐ LUỒNG giới hạn — dùng cho script seed đi qua hàm lõi thật.
 *
 * Vì sao cần (đo 26/09/2026): workflow "Seed dữ liệu TEST" chạy trên runner GitHub ở Mỹ, còn DB
 * test ở Tokyo ⇒ mỗi lượt đi-về ~0,8 giây. Một phiếu nhận xét qua `saveSessionEvalCore` là ~10
 * lượt NỐI ĐUÔI (dựng actor, cổng buổi, danh sách buổi, phiếu cũ, upsert, event) ⇒ ~8 giây; 737
 * phiếu tuần tự là hơn một tiếng, và job bị cắt ở trần 30 phút.
 *
 * Chỉ song song hoá những việc ĐỘC LẬP nhau (mỗi việc ghi dòng riêng của mình). Việc ném lỗi thì
 * cả lô ném theo — y như vòng lặp tuần tự cũ.
 */
export async function chayGioiHan(viec: ReadonlyArray<() => Promise<void>>, soLuong: number): Promise<void> {
  let ke = 0;
  const luong = Math.max(1, Math.min(soLuong, viec.length));
  await Promise.all(
    Array.from({ length: luong }, async () => {
      while (ke < viec.length) {
        const i = ke++;
        await viec[i]!();
      }
    }),
  );
}
