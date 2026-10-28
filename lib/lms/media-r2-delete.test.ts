// @vitest-environment node
/**
 * F-03 / L-F4 — TỪ CHỐI hoặc GỠ ảnh lớp phải làm TỆP biến mất, không chỉ dòng DB.
 *
 * Lỗ đang mở trên prod trước tệp này: `reviewMedia(REJECTED)`, `deleteMedia` và
 * `deleteDraftMedia` chỉ đổi/xoá bản ghi. Tệp vẫn nằm trên bucket công khai
 * (`R2_PUBLIC_URL` = CDN mở), nên ai giữ link cũ vẫn tải được ảnh học viên —
 * vô danh, vĩnh viễn, không có vết nào trong hệ thống.
 *
 * Bất biến tệp này khoá:
 *  1. Kho R2 xoá TRƯỚC, DB ghi SAU. Kho lỗi ⇒ KHÔNG được đụng DB. Thứ tự ngược lại
 *     là mất bản ghi mà tệp còn sống — không ai lần ra nổi nó là ảnh của em nào.
 *  2. Không xoá tệp mà bản ghi KHÁC còn trỏ tới. `fileUrl` do người gửi truyền lên
 *     (chỉ bị chặn ở tiền tố kho hệ thống), nên nếu bỏ rào này thì việc "xoá ảnh nháp
 *     của lớp mình" phá được ảnh ĐÃ DUYỆT của lớp khác chỉ bằng cách chép lại URL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  send: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  DeleteObjectsCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: h.send }),
  getR2Bucket: () => "bucket-test",
  getR2PublicUrl: () => "https://cdn.example.test",
}));

vi.mock("@/lib/db", () => ({
  db: { classSessionMedia: { findMany: h.findMany } },
}));

import {
  urlsSafeToDelete,
  deleteMediaObjectsByUrl,
  purgeMediaFilesThen,
  MediaFilePurgeError,
} from "@/lib/lms/media-r2-delete";

const CDN = "https://cdn.example.test";

beforeEach(() => {
  h.send.mockReset().mockResolvedValue({});
  h.findMany.mockReset().mockResolvedValue([]);
});

/** Lấy danh sách Key trong lệnh DeleteObjects thứ `i`. */
function sentKeys(i = 0): string[] {
  const cmd = h.send.mock.calls[i]![0] as { input: { Delete: { Objects: { Key: string }[] } } };
  return cmd.input.Delete.Objects.map((o) => o.Key);
}

describe("urlsSafeToDelete — THUẦN", () => {
  it("không ai khác trỏ tới ⇒ xoá được", () => {
    expect(
      urlsSafeToDelete([{ id: "m1", fileUrl: `${CDN}/class-media/s1/m1.jpg` }], []),
    ).toEqual([`${CDN}/class-media/s1/m1.jpg`]);
  });

  it("bản ghi KHÁC còn trỏ tới cùng tệp ⇒ GIỮ tệp", () => {
    // Đây là rào chống phá hoại chéo lớp: `fileUrl` là dữ liệu người gửi truyền lên,
    // ai cũng chép được URL ảnh đã duyệt của lớp khác vào một ảnh nháp của lớp mình
    // rồi bấm "xoá khỏi kho". Không có rào này thì cái bấm đó xoá ảnh của lớp kia.
    expect(
      urlsSafeToDelete([{ id: "m1", fileUrl: `${CDN}/a.jpg` }], [`${CDN}/a.jpg`]),
    ).toEqual([]);
  });

  it("hai dòng đích dùng chung một tệp ⇒ chỉ trả một lần", () => {
    expect(
      urlsSafeToDelete(
        [
          { id: "m1", fileUrl: `${CDN}/a.jpg` },
          { id: "m2", fileUrl: `${CDN}/a.jpg` },
        ],
        [],
      ),
    ).toEqual([`${CDN}/a.jpg`]);
  });

  it("bỏ dòng không có tệp", () => {
    expect(
      urlsSafeToDelete(
        [
          { id: "m1", fileUrl: null },
          { id: "m2", fileUrl: "" },
          { id: "m3", fileUrl: `${CDN}/a.jpg` },
        ],
        [],
      ),
    ).toEqual([`${CDN}/a.jpg`]);
  });
});

describe("deleteMediaObjectsByUrl", () => {
  it("gửi đúng bucket + key tách từ URL công khai", async () => {
    const n = await deleteMediaObjectsByUrl([
      `${CDN}/class-media/s1/m1.jpg`,
      `${CDN}/class-media/s1/m2.mp4`,
    ]);
    expect(n).toBe(2);
    expect(h.send).toHaveBeenCalledTimes(1);
    const cmd = h.send.mock.calls[0]![0] as { input: { Bucket: string } };
    expect(cmd.input.Bucket).toBe("bucket-test");
    expect(sentKeys()).toEqual(["class-media/s1/m1.jpg", "class-media/s1/m2.mp4"]);
  });

  it("URL ngoài kho hệ thống ⇒ không gửi lệnh xoá nào", async () => {
    // Không tách được key thì lệnh xoá sẽ nhắm vào key rác — im lặng bỏ qua an toàn
    // hơn, và đường ghi đã chặn URL ngoài từ đầu (isOwnStorageUrl).
    const n = await deleteMediaObjectsByUrl(["https://ke-khac.example/anh.jpg"]);
    expect(n).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("danh sách rỗng ⇒ không gọi kho", async () => {
    expect(await deleteMediaObjectsByUrl([])).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("kho lỗi ⇒ THROW ra ngoài, không nuốt lỗi", async () => {
    h.send.mockRejectedValueOnce(new Error("R2 500"));
    await expect(deleteMediaObjectsByUrl([`${CDN}/a.jpg`])).rejects.toThrow();
  });
});

describe("purgeMediaFilesThen — THỨ TỰ CỨNG: kho trước, DB sau", () => {
  it("xoá xong tệp mới chạy phần ghi DB", async () => {
    const order: string[] = [];
    h.send.mockImplementationOnce(async () => {
      order.push("r2");
      return {};
    });
    const res = await purgeMediaFilesThen([{ id: "m1", fileUrl: `${CDN}/a.jpg` }], async () => {
      order.push("db");
      return "xong";
    });
    expect(res).toBe("xong");
    expect(order).toEqual(["r2", "db"]);
  });

  it("kho lỗi ⇒ phần ghi DB KHÔNG chạy", async () => {
    // Bất biến đắt nhất của tệp này. Nếu DB chạy trước/vẫn chạy khi kho lỗi, ta mất
    // bản ghi duy nhất trỏ tới tệp — tệp thành mồ côi trên CDN công khai, không ai
    // biết nó thuộc lớp nào, em nào, để mà đi dọn.
    h.send.mockRejectedValueOnce(new Error("R2 500"));
    const writeDb = vi.fn();
    await expect(
      purgeMediaFilesThen([{ id: "m1", fileUrl: `${CDN}/a.jpg` }], writeDb),
    ).rejects.toBeInstanceOf(MediaFilePurgeError);
    expect(writeDb).not.toHaveBeenCalled();
  });

  it("lỗi của phần ghi DB KHÔNG bị đội lốt lỗi kho", async () => {
    // Caller đọc kiểu lỗi để chọn câu báo cho người dùng. Gộp hai loại lại thì lỗi DB
    // hiện ra thành "thử lại đi" trong khi tệp đã bị xoá thật — người bấm sẽ thử lại
    // mãi mà không hiểu vì sao.
    const boom = new Error("DB down");
    await expect(
      purgeMediaFilesThen([{ id: "m1", fileUrl: `${CDN}/a.jpg` }], async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("bản ghi khác còn trỏ tới tệp ⇒ giữ tệp nhưng VẪN ghi DB", async () => {
    h.findMany.mockResolvedValueOnce([{ fileUrl: `${CDN}/a.jpg` }]);
    const writeDb = vi.fn().mockResolvedValue(1);
    await purgeMediaFilesThen([{ id: "m1", fileUrl: `${CDN}/a.jpg` }], writeDb);
    expect(h.send).not.toHaveBeenCalled();
    expect(writeDb).toHaveBeenCalledTimes(1);
  });

  it("hỏi 'còn ai trỏ tới' bằng đường KHÔNG lọc phạm vi, và loại chính các dòng đích", async () => {
    // Nếu hỏi qua scopedDb thì bản ghi của cơ sở khác bị ẩn ⇒ tưởng là không ai
    // dùng ⇒ xoá mất tệp của cơ sở đó. Rào an toàn phải nhìn TOÀN hệ thống.
    await purgeMediaFilesThen([{ id: "m1", fileUrl: `${CDN}/a.jpg` }], async () => null);
    expect(h.findMany).toHaveBeenCalledTimes(1);
    const arg = h.findMany.mock.calls[0]![0] as {
      where: { fileUrl: { in: string[] }; id: { notIn: string[] } };
    };
    expect(arg.where.fileUrl.in).toEqual([`${CDN}/a.jpg`]);
    expect(arg.where.id.notIn).toEqual(["m1"]);
  });

  it("không có dòng nào có tệp ⇒ bỏ qua kho, vẫn ghi DB", async () => {
    const writeDb = vi.fn().mockResolvedValue(0);
    await purgeMediaFilesThen([{ id: "m1", fileUrl: null }], writeDb);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(writeDb).toHaveBeenCalledTimes(1);
  });
});
