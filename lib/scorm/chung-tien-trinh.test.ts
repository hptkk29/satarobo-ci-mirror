// @vitest-environment node
// TRẠNG THÁI CẤP TIẾN TRÌNH DÙNG CHUNG GIỮA CÁC BẢN MODULE (24/10/2026). Lỗi gốc đo trên bản production `next start`: trang play (làm nóng qua `after()`)
// và route asset được đóng gói riêng nên nạp RIÊNG hai bản `dem-dia.ts` ⇒ bản đồ "đang tải" ở cấp module bị nhân đôi ⇒ single-flight không gộp được
// (259/345 khoá bị gọi R2 hai lần). Mọi test khác của thư mục này chạy MỘT bản module nên không bao giờ thấy lỗi ấy — ca dưới đây cố ý nạp HAI bản
// (`vi.resetModules()` giữa hai lần import) và đòi chúng thấy chung một trạng thái.
//
// Luật 14: các ca này đã được cấy lại lỗi (đưa bản đồ về `new Map()` cấp module) và phải ĐỎ — xem báo cáo của đợt.
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const send = vi.fn();
vi.mock("@/lib/storage/r2-client", () => ({
  getR2Client: () => ({ send: (cmd: unknown, opts: unknown) => send(cmd, opts) }),
  getR2Bucket: () => "bucket-test",
}));

type DemDia = typeof import("./dem-dia");

/** Mỗi lần gọi trả MỘT bản `dem-dia` MỚI (module registry sạch) — giống hai điểm vào của Next, mỗi bên một bản. */
async function nap(): Promise<DemDia> {
  vi.resetModules();
  return import("./dem-dia");
}

beforeEach(() => {
  send.mockReset();
  process.env.SCORM_CACHE_OFF = "";
  process.env.SCORM_CACHE_DIR = "";
});
afterEach(() => {
  vi.resetModules();
});

describe("[CTT] trạng thái cấp tiến trình dùng chung giữa các bản module", () => {
  it("[CTT-01] hai bản nạp riêng của chung-tien-trinh cùng tên ⇒ CÙNG một đối tượng; khác tên ⇒ khác đối tượng", async () => {
    vi.resetModules();
    const a = await import("./chung-tien-trinh");
    vi.resetModules();
    const b = await import("./chung-tien-trinh");
    expect(a).not.toBe(b); // đúng là hai bản module riêng
    const ten = `ctt01-${Math.random()}`;
    const x = a.chungTienTrinh(ten, () => new Map<string, number>());
    const y = b.chungTienTrinh(ten, () => new Map<string, number>());
    expect(y).toBe(x);
    expect(b.chungTienTrinh(`${ten}-khac`, () => new Map<string, number>())).not.toBe(x);
  });

  it("[CTT-02] khởi tạo chỉ chạy MỘT lần dù có hai bản module", async () => {
    vi.resetModules();
    const a = await import("./chung-tien-trinh");
    vi.resetModules();
    const b = await import("./chung-tien-trinh");
    const ten = `ctt02-${Math.random()}`;
    const khoiTao = vi.fn(() => ({ n: 0 }));
    a.chungTienTrinh(ten, khoiTao);
    b.chungTienTrinh(ten, khoiTao);
    expect(khoiTao).toHaveBeenCalledTimes(1);
  });

  it("[CTT-03] HAI bản dem-dia: cùng một khoá tệp nhỏ tải đồng thời từ hai bản ⇒ ĐÚNG 1 lệnh GetObject (lỗi đo ở production: 2)", async () => {
    const A = await nap();
    const B = await nap();
    expect(A).not.toBe(B);
    A._datLaiTrangThai();
    let moLenh!: () => void;
    const cho = new Promise<void>((ok) => (moLenh = ok));
    send.mockImplementation(async () => {
      await cho; // giữ lượt tải đầu "đang bay" cho tới khi bản thứ hai đã xin xong
      return { Body: Readable.from([Buffer.from("x".repeat(500))]), ContentLength: 500, ContentType: "text/plain", ETag: '"e"' };
    });
    const key = `scorm/ctt03-${Math.random()}/res/a.js`;
    const pA = A.taiTepNhoDungChung(key, { bietNho: true });
    const pB = B.taiTepNhoDungChung(key, { bietNho: true });
    moLenh();
    const [ra, rb] = await Promise.all([pA, pB]);
    expect(ra.loai).toBe("nho");
    expect(rb.loai).toBe("nho");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("[CTT-04] ĐỐI CHỨNG: hai khoá KHÁC nhau từ hai bản ⇒ 2 lệnh GetObject (gộp theo khoá, không gộp mù)", async () => {
    const A = await nap();
    const B = await nap();
    A._datLaiTrangThai();
    send.mockImplementation(async () => ({ Body: Readable.from([Buffer.from("y".repeat(100))]), ContentLength: 100, ContentType: "text/plain", ETag: '"e"' }));
    const base = `scorm/ctt04-${Math.random()}/res/`;
    await Promise.all([A.taiTepNhoDungChung(`${base}a.js`, { bietNho: true }), B.taiTepNhoDungChung(`${base}b.js`, { bietNho: true })]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("[CTT-05] khoá tệp LỚN được nhớ ở bản này thì bản kia cũng biết (không dò R2 lần nữa)", async () => {
    const A = await nap();
    const B = await nap();
    A._datLaiTrangThai();
    const lon = 5 * 1024 * 1024; // > NGUONG_DEM_BYTE
    send.mockImplementation(async () => ({ Body: Readable.from([Buffer.alloc(10)]), ContentLength: lon, ContentType: "video/mp4", ETag: '"e"' }));
    const key = `scorm/ctt05-${Math.random()}/res/v.mp4`;
    const ra = await A.taiTepNhoDungChung(key);
    expect(ra.loai).toBe("lon");
    expect(send).toHaveBeenCalledTimes(1);
    // Chờ entry in-flight của lượt đầu được dọn: nếu không, bản B bám vào lượt đã xong (single-flight) chứ không đi qua `tepLonBiet` — cấy M2 từng xanh vì thế.
    await new Promise((ok) => setTimeout(ok, 50));
    const rb = await B.taiTepNhoDungChung(key);
    expect(rb.loai).toBe("lon");
    expect(send).toHaveBeenCalledTimes(1); // bản B không gọi R2 nữa
  });

  it("[CTT-06] mốc nghỉ sau lỗi R2 đặt ở bản này ⇒ bản kia cũng nghỉ làm nóng ('dang-nghi'), không đập thêm vào R2 đang ốm", async () => {
    const A = await nap();
    const B = await nap();
    A._datLaiTrangThai();
    A.ghiNhanLoiR2(Date.now());
    const kq = await B.lamNongGoi(`scorm/ctt06-${Math.random()}/`);
    expect(kq.dung).toBe("dang-nghi");
    expect(send).not.toHaveBeenCalled();
  });
});
