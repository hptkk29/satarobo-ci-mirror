// Danh sách thiết bị nhận thông báo của CHÍNH một người.
//
// Bộ này trả luôn món nợ ghi ở Đợt 3 ("`lib/push/thiet-bi.ts` chưa có test") và pin ràng buộc
// mới của Đợt 5: kết quả hàm này là PROP của một Client Component, tức nó được tuần tự hoá
// thẳng vào HTML trang — nên nó TUYỆT ĐỐI không được chứa `endpoint` / `p256dh` / `auth`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const findMany = vi.fn(async (_a: unknown) => [] as Record<string, unknown>[]);
  return { findMany, mockDb: { webPushSubscription: { findMany } } };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));

import { layThietBiCuaToi } from "./thiet-bi";
import { bamEndpoint, nhanEndpoint } from "./ket-qua";

const EP = "https://fcm.googleapis.com/wp/dien-thoai-cua-sale-a-XyZ987";
const EP2 = "https://updates.push.services.mozilla.com/wp/may-ban-cua-sale-a";

/** Một dòng ĐÚNG hình dạng `select` của hàm — thiếu cột là test kiểm một thứ không tồn tại. */
function dong(x: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sub_1",
    endpoint: EP,
    deviceLabel: null,
    userAgent: "Mozilla/5.0 (iPhone)",
    origin: "https://admin.satarobo.vn",
    displayMode: "standalone",
    // Cột `Timestamptz` trên DB thật ⇒ Prisma trả `Date`, không phải chuỗi. Fixture trả chuỗi
    // là test một hình dạng không tồn tại, và bước `.toISOString()` sẽ không được kiểm.
    lastSuccessAt: new Date("2026-09-12T10:00:00.000Z"),
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    ...x,
  };
}

/** Tham số của lần `findMany` gần nhất. */
function goi(): { where: Record<string, unknown>; orderBy: unknown; select: Record<string, true> } {
  const c = h.findMany.mock.calls.at(-1)?.[0];
  if (!c) throw new Error("findMany chưa được gọi lần nào");
  return c as { where: Record<string, unknown>; orderBy: unknown; select: Record<string, true> };
}

beforeEach(() => {
  h.findMany.mockReset().mockResolvedValue([dong()]);
});

describe("[PUSH-D5-T09] KHÔNG lộ endpoint / khoá ra ngoài", () => {
  it("kết quả KHÔNG chứa endpoint đầy đủ ở bất kỳ trường nào", async () => {
    // Đây là ràng buộc chính của Đợt 5. Endpoint là một KHẢ NĂNG GỬI: ai có chuỗi đó bắn được
    // push rỗng vào máy nhân viên (service worker hiện câu mặc định), không cần `p256dh`/`auth`.
    // Và nó cũng là đầu vào DUY NHẤT mà kẻ muốn chiếm đăng ký của người khác cần.
    const ra = await layThietBiCuaToi("usr_a");
    expect(JSON.stringify(ra)).not.toContain(EP);
    expect(JSON.stringify(ra)).not.toContain("wp/dien-thoai-cua-sale-a");
  });

  it("KHÔNG đọc `p256dh`/`auth` lên khỏi DB — không có gì để lộ thì không lộ được", async () => {
    // Mạnh hơn "không trả ra": hai cột đó không được nằm trong `select`. Đọc lên rồi tin vào
    // việc mình nhớ bỏ đi là đặt cược vào trí nhớ của người sửa sau.
    await layThietBiCuaToi("usr_a");
    expect(goi().select).not.toHaveProperty("p256dh");
    expect(goi().select).not.toHaveProperty("auth");
  });

  it("trả BĂM khớp đúng `bamEndpoint` — đó là thứ client so để biết 'máy này'", async () => {
    const ra = await layThietBiCuaToi("usr_a");
    expect(ra[0]?.bam).toBe(bamEndpoint(EP));
    expect(ra[0]?.bam).toMatch(/^[0-9a-f]{16}$/);
  });

  it("trả NHÃN CẮT có host (để người dùng phân biệt máy) mà không dựng lại được endpoint", async () => {
    const ra = await layThietBiCuaToi("usr_a");
    expect(ra[0]?.nhan).toBe(nhanEndpoint(EP));
    expect(ra[0]?.nhan).toContain("fcm.googleapis.com");
    expect(String(ra[0]?.nhan).length).toBeLessThan(EP.length);
  });

  it("hai máy khác nhau ra hai băm khác nhau — nhãn không được nhập nhằng", async () => {
    h.findMany.mockResolvedValue([dong(), dong({ id: "sub_2", endpoint: EP2 })]);
    const ra = await layThietBiCuaToi("usr_a");
    expect(ra[0]?.bam).not.toBe(ra[1]?.bam);
  });
});

describe("[PUSH-D5-T10] ranh giới quyền và bộ lọc", () => {
  it("lọc ĐÚNG người + chỉ thiết bị ACTIVE, mới nhất trước", async () => {
    // `REVOKED`/`EXPIRED` không còn là thiết bị của ai — để trong danh sách là mời người dùng
    // bấm "Gỡ" một thứ đã gỡ rồi.
    await layThietBiCuaToi("usr_a");
    expect(goi().where).toEqual({ userId: "usr_a", status: "ACTIVE" });
    expect(goi().orderBy).toEqual({ createdAt: "desc" });
  });

  it("userId rỗng ⇒ KHÔNG gọi DB (một câu thiếu vế where là đọc thiết bị cả công ty)", async () => {
    expect(await layThietBiCuaToi("")).toEqual([]);
    expect(h.findMany).not.toHaveBeenCalled();
  });
});

describe("[PUSH-D5-T11] tuần tự hoá qua ranh giới server → client", () => {
  it("mốc thời gian ra chuỗi ISO, `null` giữ nguyên `null`", async () => {
    // `Date` không tuần tự hoá được qua ranh giới RSC → Client Component.
    h.findMany.mockResolvedValue([dong(), dong({ id: "sub_2", lastSuccessAt: null })]);
    const ra = await layThietBiCuaToi("usr_a");
    expect(ra[0]?.lastSuccessAt).toBe("2026-09-12T10:00:00.000Z");
    expect(ra[0]?.createdAt).toBe("2026-09-01T08:00:00.000Z");
    expect(ra[1]?.lastSuccessAt).toBeNull();
  });

  it("kết quả đi qua JSON nguyên vẹn (đúng thứ ranh giới RSC làm)", async () => {
    const ra = await layThietBiCuaToi("usr_a");
    expect(JSON.parse(JSON.stringify(ra))).toEqual(ra);
  });
});
