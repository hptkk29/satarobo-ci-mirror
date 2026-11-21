/**
 * [XKD-*] cổng của `xoaKetQuaDiscAction` (không chạm DB — store giả):
 *   [XKD-01] cờ tắt / chưa đăng nhập ⇒ từ chối, KHÔNG gọi store
 *   [XKD-02] thiếu xác nhận ⇒ từ chối; input rác ⇒ từ chối; KHÔNG gọi store
 *   [XKD-03] hợp lệ ⇒ store nhận userId LẤY TỪ PHIÊN (không từ input), id từ input
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const phien = vi.fn();
const xoaBai = vi.fn();
vi.mock("./_lib/phien-disc", () => ({ docPhienDisc: () => phien() }));
vi.mock("@/lib/disc/store-prisma", () => ({ xoaCuaChuStore: { xoaBaiCuaChu: (...a: unknown[]) => xoaBai(...a) } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { xoaKetQuaDiscAction } from "./_actions";

beforeEach(() => {
  phien.mockReset();
  xoaBai.mockReset();
  xoaBai.mockResolvedValue(1);
});

describe("[XKD] xoaKetQuaDiscAction", () => {
  it("[XKD-01] không phiên ⇒ từ chối, không chạm store", async () => {
    phien.mockResolvedValue({ ok: false, loai: "CHUA_DANG_NHAP" });
    expect((await xoaKetQuaDiscAction({ xacNhan: "XOA" })).ok).toBe(false);
    phien.mockResolvedValue({ ok: false, loai: "CO_TAT" });
    expect((await xoaKetQuaDiscAction({ xacNhan: "XOA" })).ok).toBe(false);
    expect(xoaBai).not.toHaveBeenCalled();
  });

  it("[XKD-02] thiếu xác nhận / input rác ⇒ từ chối, không chạm store", async () => {
    phien.mockResolvedValue({ ok: true, userId: "u1" });
    for (const input of [{}, { xacNhan: "xoa" }, { xacNhan: "" }, null, "x", { xacNhan: "XOA", id: 5 }, { xacNhan: "XOA", id: "" }]) {
      expect((await xoaKetQuaDiscAction(input)).ok).toBe(false);
    }
    expect(xoaBai).not.toHaveBeenCalled();
  });

  it("[XKD-03] userId từ phiên, bỏ qua userId do client gửi", async () => {
    phien.mockResolvedValue({ ok: true, userId: "u-phien" });
    const r = await xoaKetQuaDiscAction({ xacNhan: "XOA", id: "b1", userId: "u-ke-tan-cong" });
    expect(r).toEqual({ ok: true, soBai: 1 });
    expect(xoaBai).toHaveBeenCalledTimes(1);
    expect(xoaBai.mock.calls[0]![0]).toMatchObject({ userId: "u-phien", id: "b1" });
  });
});
