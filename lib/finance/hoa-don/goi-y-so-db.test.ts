// Ca [GYL-*] — `goiYSoChoLanThu`: gợi ý số dùng CÙNG cổng pháp nhân với lúc LƯU (D1). Thiếu cấu hình ⇒ không gợi ý số cho
// một pháp nhân đoán; nếu hai bên lệch nhau thì kế toán thấy số đề xuất ở màn mà bấm Lưu lại bị từ chối (hoặc ngược lại).
// DB giả: bộ này không cần Postgres — luật nằm ở chỗ gọi `phapNhanTheoCauHinh` với chế độ nào.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cauHinh: vi.fn(async (_a: unknown, _ids: readonly string[]) => [] as unknown[]),
  hdFind: vi.fn(async (_q: unknown) => [] as unknown[]),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    hoaDonDienTu: { findMany: h.hdFind },
    center: { findMany: vi.fn(async () => [{ id: "cs1", code: "CS1" }]), findUnique: vi.fn(async () => ({ code: "CS1" })) },
  },
}));
vi.mock("./cau-hinh-co-so-db", () => ({ docCauHinhDangBat: h.cauHinh }));

import { goiYSoChoLanThu } from "./goi-y-so-db";

const ACTOR = {} as never;
const CH = { id: "c1", centerId: "cs1", phapNhanMa: "SATA_ROBO", kyHieu: "1C26MAI", hieuLucTu: "2026-01-01", hieuLucDen: "2026-12-31", dangBat: true };
const hoi = (ngay = "2026-10-20") => goiYSoChoLanThu({ actor: ACTOR, centerId: "cs1", centerCode: "CS1", kyHieu: "1C26MAI", ngay });

beforeEach(() => {
  h.cauHinh.mockReset();
  h.hdFind.mockReset();
  h.hdFind.mockResolvedValue([]);
});

describe("[GYL-01] D1 — gợi ý số bị CHẶN khi cơ sở thiếu cấu hình hợp lệ", () => {
  it("không có dòng cấu hình ⇒ lỗi tiếng Việt chỉ đường, KHÔNG tra số đã dùng của dãy nào", async () => {
    h.cauHinh.mockResolvedValue([]);
    const r = await hoi();
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/chưa khai cấu hình hoá đơn.*2026-10-20.*Cấu hình ký hiệu/) });
    expect(h.hdFind).not.toHaveBeenCalled();
  });

  it("có cấu hình nhưng NGÀY nằm ngoài khoảng hiệu lực ⇒ chặn", async () => {
    h.cauHinh.mockResolvedValue([CH]);
    expect(await hoi("2027-01-02")).toMatchObject({ ok: false });
  });

  it("đối chứng: có cấu hình hiệu lực ⇒ gợi ý theo dãy của pháp nhân CẤU HÌNH (không phải mặc định)", async () => {
    h.cauHinh.mockResolvedValue([CH]);
    h.hdFind.mockResolvedValue([{ soHoaDon: "8", phapNhanMst: "0402301783", kyHieu: "1C26MAI", centerId: "cs1" }]);
    expect(await hoi()).toMatchObject({ ok: true, mst: "0402301783", nguonPhapNhan: "CAU_HINH", goiY: { loai: "CO", so: 9 } });
  });
});
