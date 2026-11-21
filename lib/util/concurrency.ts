/**
 * Chạy song song CÓ TRẦN — dùng cho các vòng lặp side-effect trong Server Action.
 *
 * Vì sao không dùng thẳng `Promise.all(items.map(fn))`: mỗi lượt thường tốn vài truy vấn
 * Prisma, nên một lớp 20 học viên là ~120 truy vấn bắn cùng lúc vào pool (mặc định nhỏ) —
 * đủ để mọi request khác của hệ thống xếp hàng chờ. Còn `for … await` tuần tự thì đúng
 * nhưng chậm tuyến tính, và Server Action có trần thời gian.
 *
 * Giữ NGUYÊN thứ tự kết quả theo thứ tự đầu vào. Lỗi của một phần tử làm cả hàm reject
 * (giống Promise.all) — chỗ gọi nào cần "best-effort" thì tự bọc try/catch bên trong `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const max = Math.max(1, Math.floor(limit));
  const out = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(max, items.length) }, () => worker()));
  return out;
}
