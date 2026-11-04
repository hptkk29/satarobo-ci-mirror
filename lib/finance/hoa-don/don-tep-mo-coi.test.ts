// Ca [DTM-*] — NGƯỜI CHẠY dọn tệp mồ côi của kho hoá đơn: liệt kê → tra tham chiếu → chọn → xoá.
//
// Luật chọn nằm ở `tep-mo-coi.ts` (thuần, ca `[TMC-*]`). Ở đây canh phần mà hàm thuần không thấy được:
// liệt kê ĐÚNG bucket + tiền tố, tập tham chiếu tra MỘT câu và KHÔNG lọc trạng thái, xoá ĐÚNG bucket, kho
// chưa cấu hình thì bỏ qua êm, và log không mang khoá tệp.
//
// Client R2 giả lập ở tầng `send` — `kho-tep.ts` chạy THẬT (getter bucket, lệnh S3 dựng thật), nên ca
// nào đổi bucket / tiền tố ở tầng kho là đỏ ngay tại đây.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

type ListOut = {
  Contents?: { Key?: string; LastModified?: Date }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};

const h = vi.hoisted(() => ({
  send: vi.fn(),
  findMany: vi.fn(),
  trang: [] as ListOut[],
  loiXoa: [] as { Key: string }[],
}));
vi.mock("@/lib/storage/r2-client", async (goc) => ({
  ...(await goc<typeof import("@/lib/storage/r2-client")>()),
  getR2Client: () => ({ send: h.send }),
}));
vi.mock("@/lib/db", () => ({ db: { hoaDonDienTu: { findMany: h.findMany } } }));

import { donTepHoaDonMoCoi } from "./don-tep-mo-coi";
import { khoaTepHoaDon } from "./kho-tep";
import { laKhoaTepHoaDon, TIEN_TO_TEP_HOA_DON } from "./tep-mo-coi";

const NOW = new Date("2026-09-28T15:00:00.000Z");
const NGAY = 24 * 3600_000;
const cu = (ngay: number) => new Date(NOW.getTime() - ngay * NGAY);
const khoa = (i: number, duoi: "pdf" | "xml" = "pdf") => `hoa-don/CS1/2026/cmorder${i}/u${i}.${duoi}`;

const ENV_GOC = { ...process.env };
beforeEach(() => {
  process.env.R2_INVOICE_BUCKET_NAME = "satarobo-hoa-don";
  process.env.R2_BUCKET_NAME = "satarobo-uploads";
  process.env.R2_CHAT_BUCKET_NAME = "satarobo-chat";
  process.env.R2_ELEARNING_BUCKET_NAME = "satarobo-elearning";
  process.env.R2_CALL_BUCKET_NAME = "satarobo-ghi-am";
  process.env.R2_ACCOUNT_ID = "acc";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_PUBLIC_URL = "https://cdn.example.test";
  h.trang = [];
  h.loiXoa = [];
  h.send.mockReset();
  h.send.mockImplementation(async (cmd: unknown) => {
    if (cmd instanceof ListObjectsV2Command) {
      const token = cmd.input.ContinuationToken;
      const i = token ? Number(token.replace("trang-", "")) : 0;
      return h.trang[i] ?? { Contents: [] };
    }
    if (cmd instanceof DeleteObjectsCommand) return { Errors: h.loiXoa };
    throw new Error("lệnh R2 không mong đợi");
  });
  h.findMany.mockReset();
  h.findMany.mockResolvedValue([]);
});
afterEach(() => {
  process.env = { ...ENV_GOC };
  vi.restoreAllMocks();
});

const lenhList = () => h.send.mock.calls.map(([c]) => c).filter((c): c is ListObjectsV2Command => c instanceof ListObjectsV2Command);
const lenhXoa = () => h.send.mock.calls.map(([c]) => c).filter((c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand);
const khoaDaXoa = () => lenhXoa().flatMap((c) => (c.input.Delete?.Objects ?? []).map((o) => o.Key));

describe("[DTM-01] chỉ liệt kê tiền tố `hoa-don/` của bucket HOÁ ĐƠN, và xoá đúng bucket đó", () => {
  it("ListObjectsV2 + DeleteObjects đều mang Bucket = R2_INVOICE_BUCKET_NAME, Prefix = `hoa-don/`", async () => {
    h.trang = [{ Contents: [{ Key: khoa(1), LastModified: cu(30) }] }];
    await donTepHoaDonMoCoi(NOW);
    expect(lenhList().length).toBe(1);
    for (const c of lenhList()) {
      expect(c.input.Bucket).toBe("satarobo-hoa-don");
      expect(c.input.Prefix).toBe(TIEN_TO_TEP_HOA_DON);
    }
    expect(lenhXoa().map((c) => c.input.Bucket)).toEqual(["satarobo-hoa-don"]);
    expect(khoaDaXoa()).toEqual([khoa(1)]);
  });

  it("KHÔNG BAO GIỜ chạm bucket công khai: trùng tên với R2_BUCKET_NAME ⇒ bỏ qua, không lệnh R2 nào", async () => {
    process.env.R2_INVOICE_BUCKET_NAME = process.env.R2_BUCKET_NAME!;
    const kq = await donTepHoaDonMoCoi(NOW);
    expect(kq.boQua).toBe("KHO_CHUA_CAU_HINH");
    expect(h.send).not.toHaveBeenCalled();
  });

  it("phân trang: đi hết các trang theo ContinuationToken", async () => {
    h.trang = [
      { Contents: [{ Key: khoa(1), LastModified: cu(30) }], IsTruncated: true, NextContinuationToken: "trang-1" },
      { Contents: [{ Key: khoa(2), LastModified: cu(30) }] },
    ];
    const kq = await donTepHoaDonMoCoi(NOW);
    expect(lenhList().map((c) => c.input.ContinuationToken)).toEqual([undefined, "trang-1"]);
    expect(kq.daXet).toBe(2);
    expect(khoaDaXoa().sort()).toEqual([khoa(1), khoa(2)]);
  });

  it("khoá do `khoaTepHoaDon` sinh ra đạt hình dạng của bộ chọn — hai bên không trôi lệch", () => {
    const k = khoaTepHoaDon({ centerCode: "CS1", orderId: "cmorder1", loai: "pdf", nam: 2026, uuid: "0f1e2d3c-4b5a-6978" });
    expect(laKhoaTepHoaDon(k)).toBe(true);
    expect(laKhoaTepHoaDon(khoaTepHoaDon({ centerCode: "CS_2", orderId: "c-9", loai: "xml", nam: 2999, uuid: "u" }))).toBe(true);
  });
});

describe("[DTM-02] chỉ xoá tệp cũ hơn 7 ngày — tệp đang tải dở không bị đụng", () => {
  it("tệp 1 ngày tuổi không ai tham chiếu ⇒ GIỮ; tệp 8 ngày ⇒ xoá", async () => {
    h.trang = [
      {
        Contents: [
          { Key: khoa(1), LastModified: cu(1) },
          { Key: khoa(2), LastModified: cu(8) },
        ],
      },
    ];
    const kq = await donTepHoaDonMoCoi(NOW);
    expect(khoaDaXoa()).toEqual([khoa(2)]);
    expect(kq.daXoa).toBe(1);
  });
});

describe("[DTM-03] không xoá khoá đang được hoá đơn nào tham chiếu — MỌI trạng thái, tra MỘT câu", () => {
  it("một câu `findMany`, KHÔNG lọc trạng thái, đọc cả tepPdfKey lẫn tepXmlKey", async () => {
    h.trang = [{ Contents: [{ Key: khoa(1), LastModified: cu(30) }] }];
    await donTepHoaDonMoCoi(NOW);
    expect(h.findMany).toHaveBeenCalledTimes(1);
    const args = h.findMany.mock.calls[0]![0] as { where?: unknown; select: Record<string, unknown> };
    expect(JSON.stringify(args.where ?? {})).not.toMatch(/trangThai|hieuLuc/);
    expect(args.select).toMatchObject({ tepPdfKey: true, tepXmlKey: true });
  });

  it("khoá của bản ĐÃ HUỶ (THAY_THE) và của bản NHÁP ⇒ GIỮ; chỉ khoá không ai trỏ tới bị xoá", async () => {
    h.trang = [
      {
        Contents: [
          { Key: khoa(1), LastModified: cu(90) }, // PDF của bản đã huỷ
          { Key: khoa(2, "xml"), LastModified: cu(90) }, // XML của bản nháp
          { Key: khoa(3), LastModified: cu(90) }, // mồ côi
        ],
      },
    ];
    h.findMany.mockResolvedValue([
      { tepPdfKey: khoa(1), tepXmlKey: null },
      { tepPdfKey: null, tepXmlKey: khoa(2, "xml") },
    ]);
    const kq = await donTepHoaDonMoCoi(NOW);
    expect(khoaDaXoa()).toEqual([khoa(3)]);
    expect(kq).toMatchObject({ daXet: 3, moCoi: 1, daXoa: 1 });
  });

  it("tra tham chiếu SAU khi liệt kê — hoá đơn vừa lưu trong lúc liệt kê vẫn được thấy", async () => {
    h.trang = [{ Contents: [{ Key: khoa(1), LastModified: cu(30) }] }];
    await donTepHoaDonMoCoi(NOW);
    const thuTuList = h.send.mock.invocationCallOrder[0]!;
    const thuTuTra = h.findMany.mock.invocationCallOrder[0]!;
    expect(thuTuTra).toBeGreaterThan(thuTuList);
  });
});

describe("[DTM-04] trần số tệp mỗi lượt — phần còn lại lượt sau dọn", () => {
  it("250 tệp mồ côi ⇒ xoá đúng 200, báo còn 50", async () => {
    h.trang = [{ Contents: Array.from({ length: 250 }, (_, i) => ({ Key: khoa(i), LastModified: cu(10 + i) })) }];
    const kq = await donTepHoaDonMoCoi(NOW);
    expect(khoaDaXoa().length).toBe(200);
    expect(kq).toMatchObject({ moCoi: 250, daXoa: 200, conLai: 50 });
  });

  it("R2 báo lỗi vài khoá ⇒ đếm vào `loiXoa`, không tính là đã xoá", async () => {
    h.trang = [{ Contents: [1, 2, 3].map((i) => ({ Key: khoa(i), LastModified: cu(30) })) }];
    h.loiXoa = [{ Key: khoa(2) }];
    const kq = await donTepHoaDonMoCoi(NOW);
    expect(kq).toMatchObject({ daXoa: 2, loiXoa: 1 });
  });

  it("không có gì để xoá ⇒ KHÔNG gọi DeleteObjects", async () => {
    h.trang = [{ Contents: [{ Key: khoa(1), LastModified: cu(1) }] }];
    await donTepHoaDonMoCoi(NOW);
    expect(lenhXoa()).toEqual([]);
  });
});

describe("[DTM-05] kho chưa cấu hình ⇒ bỏ qua êm, không ném, không tra gì", () => {
  it("thiếu R2_INVOICE_BUCKET_NAME ⇒ { boQua }, 0 lệnh R2, 0 câu DB", async () => {
    delete process.env.R2_INVOICE_BUCKET_NAME;
    const kq = await donTepHoaDonMoCoi(NOW);
    expect(kq).toMatchObject({ boQua: "KHO_CHUA_CAU_HINH", daXet: 0, daXoa: 0 });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("thiếu khoá truy cập R2 ⇒ cũng bỏ qua", async () => {
    delete process.env.R2_SECRET_ACCESS_KEY;
    expect((await donTepHoaDonMoCoi(NOW)).boQua).toBe("KHO_CHUA_CAU_HINH");
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("[DTM-06] log chỉ mang SỐ ĐẾM, không mang khoá tệp", () => {
  it("một dòng log với số đã xét / đã xoá; không chuỗi `hoa-don/` nào lọt ra", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    h.trang = [{ Contents: [1, 2].map((i) => ({ Key: khoa(i), LastModified: cu(30) })) }];
    await donTepHoaDonMoCoi(NOW);
    const dong = log.mock.calls.map((c) => c.map(String).join(" "));
    expect(dong.length).toBe(1);
    expect(dong[0]).toMatch(/daXet=2/);
    expect(dong[0]).toMatch(/daXoa=2/);
    expect(dong.join("\n")).not.toContain("hoa-don/");
  });
});
