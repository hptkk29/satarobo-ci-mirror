// @vitest-environment node
// [LRB-L*] Tài liệu lắp ráp 3D của bài trong ca dạy bù — phần DỮ LIỆU: lấy từ `Lesson` bằng MỘT câu, đúng bài, đã kiểm lại.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  baiTrongDb: [] as Record<string, unknown>[],
  goi: [] as { where: { id: { in: string[] } }; select: Record<string, unknown> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/hoc-bu/case-db", () => ({ LoiHocBu: class extends Error {} }));
vi.mock("@/lib/lms/assignment", () => ({ computeHomeworkDueAt: () => new Date(0) }));
vi.mock("@/lib/db", () => ({
  db: {
    // Giả lập TÔN TRỌNG `where.id.in` và `select`: quên một cột ở loader là ca đỏ, không xanh nhờ fixture quá đủ.
    lesson: {
      findMany: async (a: { where: { id: { in: string[] } }; select: Record<string, unknown> }) => {
        h.goi.push(a);
        return h.baiTrongDb
          .filter((b) => a.where.id.in.includes(b.id as string))
          .map((b) => Object.fromEntries(Object.keys(a.select).filter((k) => a.select[k]).map((k) => [k, b[k]])));
      },
    },
  },
}));

import { layLapRap3dCacBai } from "./tai-lieu-bu";
import { gomLapRap3d, lapRap3dCuaBai } from "./lap-rap-3d";

const URL_A = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car";
const URL_B = "https://www.zmrobo.net/modelmanual/model?modelUrl=Beta%20Set%20B/07.Robot%20Arm";
const bai = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Tiêu đề ${id}`, // cột KHÔNG được xin ⇒ fake không trả — chứng minh loader không kéo dư
  assemblyManualUrl: null,
  assemblyManualSetName: null,
  assemblyManualModelName: null,
  ...over,
});

beforeEach(() => {
  h.baiTrongDb = [];
  h.goi = [];
});

describe("[LRB-L] lấy liên kết lắp ráp 3D cho các bài của ca bù", () => {
  it("[LRB-L01] ca 3 bài ⇒ ĐÚNG MỘT câu findMany theo `id in` (không N+1), xin đủ ba cột", async () => {
    h.baiTrongDb = [bai("b1"), bai("b2"), bai("b3")];
    await layLapRap3dCacBai(["b1", "b2", "b3"]);
    expect(h.goi).toHaveLength(1);
    expect(h.goi[0]!.where.id.in).toEqual(["b1", "b2", "b3"]);
    expect(Object.keys(h.goi[0]!.select).sort()).toEqual(["assemblyManualModelName", "assemblyManualSetName", "assemblyManualUrl", "id"]);
  });

  it("[LRB-L02] mỗi bài nhận ĐÚNG liên kết của chính nó (không nhầm bài, không lệch thứ tự)", async () => {
    h.baiTrongDb = [
      bai("b3", { assemblyManualUrl: URL_B, assemblyManualSetName: "Beta Set B", assemblyManualModelName: "07.Robot Arm" }),
      bai("b1", { assemblyManualUrl: URL_A, assemblyManualSetName: "Alpha Set A", assemblyManualModelName: "03.Catapult Car" }),
      bai("b2"),
    ];
    const m = await layLapRap3dCacBai(["b1", "b2", "b3"]);
    expect(m.get("b1")).toEqual({ url: URL_A, setName: "Alpha Set A", modelName: "03.Catapult Car" });
    expect(m.get("b3")).toEqual({ url: URL_B, setName: "Beta Set B", modelName: "07.Robot Arm" });
    expect(m.has("b2")).toBe(false); // bài không gắn ⇒ vắng khỏi map ⇒ không nút
  });

  it("[LRB-L03] đường dẫn bẩn trong DB (javascript:, host lạ, http, thêm tham số) bị LOẠI ở tầng đọc — dù lúc lưu có thể đã lọt", async () => {
    h.baiTrongDb = [
      bai("x1", { assemblyManualUrl: "javascript:alert(1)" }),
      bai("x2", { assemblyManualUrl: "https://zmrobo.net.evil.com/modelmanual/model?modelUrl=a" }),
      bai("x3", { assemblyManualUrl: "http://www.zmrobo.net/modelmanual/model?modelUrl=a" }),
      bai("x4", { assemblyManualUrl: `${URL_A}&token=abc` }),
      bai("ok", { assemblyManualUrl: URL_A }),
    ];
    const m = await layLapRap3dCacBai(["x1", "x2", "x3", "x4", "ok"]);
    expect([...m.keys()]).toEqual(["ok"]);
  });

  it("[LRB-L04] không có bài nào ⇒ KHÔNG gọi DB; id trùng được gộp", async () => {
    expect((await layLapRap3dCacBai([])).size).toBe(0);
    expect(h.goi).toHaveLength(0);
    await layLapRap3dCacBai(["b1", "b1", "b2"]);
    expect(h.goi[0]!.where.id.in).toEqual(["b1", "b2"]);
  });

  it("[LRB-L05] tên bộ / tên mô hình rỗng hoặc chỉ khoảng trắng ⇒ null; URL không bị đổi hay thêm gì (không mã HV, lớp, token)", () => {
    const v = lapRap3dCuaBai({ assemblyManualUrl: URL_A, assemblyManualSetName: "  ", assemblyManualModelName: " Xe  " });
    expect(v).toEqual({ url: URL_A, setName: null, modelName: "Xe" });
    expect(new URL(v!.url).search).toBe("?modelUrl=Alpha%20Set%20A/03.Catapult%20Car");
  });

  it("[LRB-L06] gomLapRap3d: dữ liệu thiếu ⇒ map rỗng, không ném", () => {
    expect(gomLapRap3d([]).size).toBe(0);
    expect(gomLapRap3d([{ id: "a", assemblyManualUrl: null, assemblyManualSetName: null, assemblyManualModelName: null }]).size).toBe(0);
  });
});
