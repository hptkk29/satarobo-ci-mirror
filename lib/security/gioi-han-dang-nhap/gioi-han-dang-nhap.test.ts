import { describe, expect, it } from "vitest";

import { ipChoRateLimit } from "@/lib/security/client-ip";

import { CHINH_SACH_DE_XUAT as CS } from "./chinh-sach";
import { dinhDanhChuanHoa } from "./chuan-hoa";
import { LoiKhongDemDuoc, docGiamSat, taoGioiHan } from "./dong-co";
import { KhoBoNho, type KhoDem } from "./kho";

/**
 * Kịch bản của bộ giới hạn đăng nhập DÙNG CHUNG (B4; mã ca: GHD) — mô phỏng thuần với đồng hồ giả, không DB (kho Postgres: `tests/mobile-api/gioi-han-dang-nhap.spec.ts`).
 * `mauHienTai` là mô hình bộ giới hạn CŨ (cờ TẮT): đếm MỌI lượt, 10/phút/IP + 5/phút/định danh, mỗi kênh một bộ đếm — để thấy bộ mới tốt hơn ở đâu.
 * ⚠️ B4 đã BỎ "thiết bị quen do client khai": không còn tham số thiết bị; "quen" chỉ là dấu ấy máy chủ ghi sau một lần đăng nhập thành công của cặp (định danh, IP).
 */
const T0 = new Date("2026-11-17T08:00:00+07:00");
const sau = (ms: number) => new Date(T0.getTime() + ms);

type KQ = "VAO" | "SAI" | "CHAN";
function mo(kho: KhoBoNho = new KhoBoNho()) {
  const gh = taoGioiHan(kho);
  /** Một lượt đăng nhập: kiểm trước → (nếu qua) so mật khẩu → đúng thì `thanhCong()`. */
  async function thu(o: { ip: string; id: string; dung?: boolean; now?: Date }): Promise<KQ> {
    const q = await gh.kiemTruoc({ ip: o.ip, dinhDanh: o.id, now: o.now ?? T0 });
    if (!q.cho) return "CHAN";
    if (o.dung) {
      await q.thanhCong();
      return "VAO";
    }
    return "SAI";
  }
  return { gh, thu, kho };
}

function mauHienTai() {
  const dem = new Map<string, { tu: number; so: number }>();
  const tang = (k: string, now: Date, max: number) => {
    const d = dem.get(k);
    if (!d || d.tu <= now.getTime() - 60_000) {
      dem.set(k, { tu: now.getTime(), so: 1 });
      return true;
    }
    d.so += 1;
    return d.so <= max;
  };
  return (kenh: "web" | "mobile", ip: string, id: string, now: Date) => {
    const a = tang(`${kenh}:ip:${ip}`, now, 10);
    const b = tang(`${kenh}:id:${id}`, now, 5);
    return a && b;
  };
}

/** Đẩy bộ đếm toàn cục của một định danh vượt ngưỡng L3 bằng dò phân tán (nhiều IP, mỗi IP 2 lượt). */
async function doPhanTan(thu: ReturnType<typeof mo>["thu"], id: string, soIp = 15) {
  for (let ip = 0; ip < soIp; ip++) for (let l = 0; l < 2; l++) await thu({ ip: `198.51.100.${ip}`, id, dung: false });
}

describe("bộ giới hạn đăng nhập dùng chung", () => {
  it("[GHD-01] NHIỀU NGƯỜI CHUNG IP (NAT): 60 phụ huynh đăng nhập đúng, 20 người gõ nhầm 1 lần ⇒ KHÔNG ai bị chặn; bộ cũ chặn 50/60", async () => {
    const { thu } = mo();
    const kq: KQ[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `8496${String(i).padStart(7, "0")}`;
      if (i < 20) kq.push(await thu({ ip: "203.0.113.7", id, dung: false }));
      kq.push(await thu({ ip: "203.0.113.7", id, dung: true }));
    }
    expect(kq.filter((x) => x === "CHAN")).toHaveLength(0);
    expect(kq.filter((x) => x === "VAO")).toHaveLength(60);
    const cu = mauHienTai();
    let bi = 0;
    for (let i = 0; i < 60; i++) if (!cu("web", "203.0.113.7", `8496${String(i).padStart(7, "0")}`, T0)) bi++;
    expect(bi).toBe(50);
  });

  it("[GHD-02] NAT ngày xấu: sai liên tục từ một IP chạm trần 40 lượt SAI / 15 phút rồi bị chặn — và mở lại sau cửa sổ", async () => {
    const { thu } = mo();
    for (let i = 0; i < CS.ipSai; i++) expect(await thu({ ip: "203.0.113.8", id: `id${i}`, dung: false })).toBe("SAI");
    expect(await thu({ ip: "203.0.113.8", id: "id-moi", dung: false })).toBe("CHAN");
    expect(await thu({ ip: "203.0.113.8", id: "id-moi", dung: true, now: sau(CS.cuaSoMs + 1000) })).toBe("VAO");
  });

  it("[GHD-03] DÒ PHÂN TÁN vào MỘT tài khoản từ 200 IP: đúng 20 lượt chạm bước so mật khẩu; sau đó đoán TRÚNG từ máy lạ vẫn bị chặn", async () => {
    const { thu } = mo();
    let chamMk = 0;
    for (let ip = 0; ip < 200; ip++)
      for (let l = 0; l < 2; l++) if ((await thu({ ip: `198.51.100.${ip}`, id: "84966000001", dung: false })) === "SAI") chamMk++;
    expect(chamMk).toBe(CS.dinhDanhToanCuc);
    expect(await thu({ ip: "198.51.100.250", id: "84966000001", dung: true })).toBe("CHAN");
  });

  it("[GHD-04] CHỦ TÀI KHOẢN đã từng đăng nhập ĐÚNG từ IP này, nay tài khoản bị dò phân tán: vào được, nhưng cặp 'quen' chỉ có TRẦN RIÊNG — thử SAI quá `quenToiDa` lượt bị chặn (không miễn trừ)", async () => {
    const { thu, gh } = mo();
    expect(await thu({ ip: "192.0.2.10", id: "84966000002", dung: true })).toBe("VAO"); // dấu ấy do máy chủ ghi
    await doPhanTan(thu, "84966000002", 12);
    expect(await thu({ ip: "192.0.2.99", id: "84966000002", dung: true })).toBe("CHAN"); // IP lạ chưa từng thành công
    expect(await thu({ ip: "192.0.2.10", id: "84966000002", dung: true })).toBe("VAO"); // cặp quen vào được
    const q = await gh.kiemTruoc({ ip: "192.0.2.10", dinhDanh: "84966000002", now: T0 });
    expect(q.cho && q.quen).toBe(true);
    if (q.cho) await q.hoan();
    const kq: KQ[] = [];
    for (let i = 0; i < 6; i++) kq.push(await thu({ ip: "192.0.2.10", id: "84966000002", dung: false }));
    expect(kq.filter((x) => x === "SAI")).toHaveLength(CS.quenToiDa);
    expect(kq.at(-1)).toBe("CHAN");
  });

  it("[GHD-05] KHÔNG KHOÁ NHẦM NẠN NHÂN: kẻ xấu 100 lượt từ IP X bị chặn ở lượt 6; nạn nhân từ IP Y vào ngay. Bộ cũ: nạn nhân bị khoá", async () => {
    const { thu } = mo();
    const kq: KQ[] = [];
    for (let i = 0; i < 100; i++) kq.push(await thu({ ip: "203.0.113.50", id: "84966000003", dung: false }));
    expect(kq.slice(0, CS.capDinhDanhIp)).toEqual(Array(CS.capDinhDanhIp).fill("SAI"));
    expect(kq.slice(CS.capDinhDanhIp).every((x) => x === "CHAN")).toBe(true);
    expect(await thu({ ip: "192.0.2.77", id: "84966000003", dung: true })).toBe("VAO");
    const cu = mauHienTai();
    for (let i = 0; i < 5; i++) cu("web", "203.0.113.50", "84966000003", T0);
    expect(cu("web", "192.0.2.77", "84966000003", T0)).toBe(false);
  });

  it("[GHD-06] kẻ xấu đã bị chặn KHÔNG làm phồng bộ đếm toàn cục của nạn nhân: 1000 lượt từ một IP chỉ đóng góp ≤ 5 vào bộ đếm định danh; nạn nhân nơi khác vẫn vào", async () => {
    const { thu } = mo();
    for (let i = 0; i < 1000; i++) await thu({ ip: "203.0.113.51", id: "84966000004", dung: false });
    expect(await thu({ ip: "192.0.2.78", id: "84966000004", dung: true })).toBe("VAO");
  });

  it("[GHD-07] PHUN MẬT KHẨU: một IP thử 1 lượt vào 500 tài khoản ⇒ bị chặn ở lượt thứ 41 (L2)", async () => {
    const { thu } = mo();
    const kq: KQ[] = [];
    for (let i = 0; i < 500; i++) kq.push(await thu({ ip: "203.0.113.60", id: `phun${i}`, dung: false }));
    expect(kq.indexOf("CHAN")).toBe(CS.ipSai);
  });

  it("[GHD-08] GIẢ HEADER không đổi được khoá: đổi XFF (đầu chuỗi), x-vercel-forwarded-for, x-real-ip, x-e2e-client-ip, User-Agent mỗi lượt ⇒ vẫn một IP ⇒ chặn ở lượt 6", async () => {
    const env = { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;
    const { thu } = mo();
    const kq: KQ[] = [];
    for (let i = 0; i < 50; i++) {
      const h = new Headers({
        "x-forwarded-for": `${i}.${i}.${i}.${i}, 203.0.113.99`,
        "x-vercel-forwarded-for": `9.9.9.${i}`,
        "x-real-ip": `8.8.8.${i}`,
        "x-e2e-client-ip": `7.7.7.${i}`,
        "user-agent": `UA-${i}`,
      });
      kq.push(await thu({ ip: ipChoRateLimit(h, env), id: "84966000005", dung: false }));
    }
    expect(kq.filter((x) => x === "SAI")).toHaveLength(CS.capDinhDanhIp);
    expect(kq.slice(CS.capDinhDanhIp).every((x) => x === "CHAN")).toBe(true);
  });

  it("[GHD-09] ĐỒNG THỜI: 100 yêu cầu song song cùng cặp ⇒ ĐÚNG 5 yêu cầu chạm tới bước so mật khẩu", async () => {
    const { gh } = mo();
    const kq = await Promise.all(Array.from({ length: 100 }, () => gh.kiemTruoc({ ip: "203.0.113.70", dinhDanh: "84966000006", now: T0 })));
    expect(kq.filter((r) => r.cho)).toHaveLength(CS.capDinhDanhIp);
  });

  it("[GHD-10] kho lỗi ⇒ ném LoiKhongDemDuoc (nơi gọi từ chối / 503) — KHÔNG cho qua", async () => {
    const hong: KhoDem = { tang: async () => Promise.reject(new Error("db chết")), hoan: async () => undefined, doc: async () => 0 };
    await expect(taoGioiHan(hong).kiemTruoc({ ip: "1.1.1.1", dinhDanh: "x", now: T0 })).rejects.toBeInstanceOf(LoiKhongDemDuoc);
  });

  it("[GHD-11] KHÔNG LỘ tài khoản có tồn tại hay không: quỹ đạo chặn của SĐT có thật và chuỗi vô nghĩa giống từng lượt", async () => {
    const quyDao = async (id: string) => {
      const { gh } = mo();
      const r: string[] = [];
      for (let i = 0; i < 8; i++) {
        const q = await gh.kiemTruoc({ ip: "203.0.113.80", dinhDanh: dinhDanhChuanHoa(id), now: T0 });
        r.push(q.cho ? "cho" : `chan:${q.lyDo}:${q.thuLaiSauGiay}`);
      }
      return r;
    };
    expect(await quyDao("0966109876")).toEqual(await quyDao("khong.ton.tai@vi-du.vn"));
  });

  it("[GHD-12] CHUẨN HOÁ DÙNG CHUNG (canonicalPhone thật): các dạng `0966…`, `+84…`, `84…` ra CÙNG một khoá; trộn các dạng ⇒ lượt thứ 6 bị chặn", async () => {
    const dang = ["0966 109 876", "+84966109876", "84966109876", "0966-109-876", "(+84) 966109876"];
    expect(new Set(dang.map(dinhDanhChuanHoa)).size).toBe(1);
    expect(dinhDanhChuanHoa("Ph.Huynh@Vi-Du.VN")).toBe(dinhDanhChuanHoa("ph.huynh@vi-du.vn"));
    const { thu } = mo();
    for (const d of dang) expect(await thu({ ip: "203.0.113.81", id: dinhDanhChuanHoa(d), dung: false })).toBe("SAI");
    expect(await thu({ ip: "203.0.113.81", id: dinhDanhChuanHoa("0966109876"), dung: false })).toBe("CHAN");
  });

  it("[GHD-13] KÊNH DÙNG CHUNG: 5 sai trộn web + mobile cùng (định danh, IP) ⇒ lượt thứ 6 bị chặn. Bộ cũ (hai bộ đếm tách): được 10", async () => {
    const { thu } = mo();
    for (let i = 0; i < 5; i++) await thu({ ip: "203.0.113.82", id: "84966000009", dung: false });
    expect(await thu({ ip: "203.0.113.82", id: "84966000009", dung: false })).toBe("CHAN");
    const cu = mauHienTai();
    let qua = 0;
    for (let i = 0; i < 5; i++) if (cu("web", "203.0.113.82", "84966000009", T0)) qua++;
    for (let i = 0; i < 5; i++) if (cu("mobile", "203.0.113.82", "84966000009", T0)) qua++;
    expect(qua).toBe(10);
  });

  it("[GHD-14] LƯỢT ĐÚNG không đẩy bộ đếm: 100 lần đăng nhập đúng liên tiếp cùng cặp không bị chặn", async () => {
    const { thu } = mo();
    for (let i = 0; i < 100; i++) expect(await thu({ ip: "203.0.113.83", id: "84966000010", dung: true })).toBe("VAO");
  });

  it("[GHD-15] đăng nhập ĐÚNG vào tài khoản của chính kẻ tấn công KHÔNG xoá bộ đếm IP: 39 sai + 1 đúng + 2 sai ⇒ lượt sai thứ 2 bị chặn", async () => {
    const { thu } = mo();
    for (let i = 0; i < 39; i++) await thu({ ip: "203.0.113.84", id: `nan-nhan${i}`, dung: false });
    expect(await thu({ ip: "203.0.113.84", id: "tai-khoan-cua-ke-tan-cong", dung: true })).toBe("VAO");
    expect(await thu({ ip: "203.0.113.84", id: "nan-nhan-a", dung: false })).toBe("SAI");
    expect(await thu({ ip: "203.0.113.84", id: "nan-nhan-b", dung: false })).toBe("CHAN");
  });

  it("[GHD-16] KHÔNG CÓ ĐƯỜNG KHAI 'THIẾT BỊ QUEN': dấu ấy chỉ ghi sau đăng nhập ĐÚNG và chỉ có tác dụng ở CHÍNH cặp (định danh, IP) đó", async () => {
    const { thu } = mo();
    // (a) dấu ấy ở IP A KHÔNG mở cửa cho IP B
    expect(await thu({ ip: "192.0.2.10", id: "84966000011", dung: true })).toBe("VAO");
    await doPhanTan(thu, "84966000011", 12);
    expect(await thu({ ip: "192.0.2.11", id: "84966000011", dung: true })).toBe("CHAN");
    // (b) dấu ấy của MỘT định danh không giúp định danh KHÁC từ cùng IP
    expect(await thu({ ip: "192.0.2.10", id: "84966000012", dung: true })).toBe("VAO");
    await doPhanTan(thu, "84966000013", 12);
    expect(await thu({ ip: "192.0.2.10", id: "84966000013", dung: true })).toBe("CHAN");
  });

  it("[GHD-16b] kiểu của DauVao KHÔNG có trường thiết bị (tsc canh: bỏ `@ts-expect-error` mà vẫn biên dịch được là lỗi)", async () => {
    const { gh } = mo();
    // @ts-expect-error — đường 'thiết bị quen do client khai' đã BỊ GỠ ở B4
    const q = await gh.kiemTruoc({ ip: "1.1.1.1", dinhDanh: "x", now: T0, thietBiQuen: true });
    expect(q.cho).toBe(true); // tham số thừa bị bỏ qua: không có hiệu lực nào
  });

  it("[GHD-17] kẻ dò KHÔNG tạo được dấu ấy bằng lượt SAI: 2 lượt sai từ IP E (còn dưới mọi trần), dò phân tán đẩy L3 vượt ngưỡng, rồi E ĐOÁN TRÚNG ⇒ vẫn bị chặn ở L3", async () => {
    const { thu } = mo();
    for (let i = 0; i < 2; i++) expect(await thu({ ip: "192.0.2.50", id: "84966000014", dung: false })).toBe("SAI");
    await doPhanTan(thu, "84966000014", 12);
    expect(await thu({ ip: "192.0.2.50", id: "84966000014", dung: true })).toBe("CHAN");
  });

  it("[GHD-18] cặp 'quen' VẪN bị L1: 5 lượt sai liên tiếp ⇒ chặn 'dinh-danh-ip' (không miễn trừ ở các lớp khác)", async () => {
    const { thu, gh } = mo();
    expect(await thu({ ip: "192.0.2.20", id: "84966000015", dung: true })).toBe("VAO");
    for (let i = 0; i < CS.capDinhDanhIp; i++) expect(await thu({ ip: "192.0.2.20", id: "84966000015", dung: false })).toBe("SAI");
    const q = await gh.kiemTruoc({ ip: "192.0.2.20", dinhDanh: "84966000015", now: T0 });
    expect(q.cho).toBe(false);
    if (!q.cho) expect(q.lyDo).toBe("dinh-danh-ip");
  });

  it("[GHD-19] cặp 'quen' VẪN bị L2 (IP tổng): IP đã vượt 40 lượt sai thì chủ tài khoản quen cũng bị chặn 'ip'", async () => {
    const { thu, gh } = mo();
    expect(await thu({ ip: "192.0.2.30", id: "84966000016", dung: true })).toBe("VAO");
    for (let i = 0; i < CS.ipSai; i++) await thu({ ip: "192.0.2.30", id: `khac${i}`, dung: false });
    const q = await gh.kiemTruoc({ ip: "192.0.2.30", dinhDanh: "84966000016", now: T0 });
    expect(q.cho).toBe(false);
    if (!q.cho) expect(q.lyDo).toBe("ip");
  });

  it("[GHD-20] GIÁM SÁT: mỗi lần chặn tăng bộ đếm ẩn danh theo lý do; bộ đếm không chứa định danh/IP", async () => {
    const { thu, kho } = mo();
    for (let i = 0; i < 8; i++) await thu({ ip: "203.0.113.90", id: "84966000017", dung: false });
    await doPhanTan(thu, "84966000018", 15);
    const gs = await docGiamSat(kho, T0);
    expect(gs["dinh-danh-ip"]).toBeGreaterThanOrEqual(3);
    expect(gs["dinh-danh-toan-cuc"]).toBeGreaterThanOrEqual(1);
    for (const k of kho.dong.keys()) expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[GHD-21] kho giám sát hỏng KHÔNG đổi quyết định chặn (vẫn chặn, không ném)", async () => {
    const goc = new KhoBoNho();
    const hongGiamSat: KhoDem = {
      tang: async (k, n, c) => (c === CS.giamSatMs ? Promise.reject(new Error("giám sát hỏng")) : goc.tang(k, n, c)),
      hoan: (k, n, c) => goc.hoan(k, n, c),
      doc: (k, n, c) => goc.doc(k, n, c),
    };
    const gh = taoGioiHan(hongGiamSat);
    for (let i = 0; i < CS.capDinhDanhIp; i++) await gh.kiemTruoc({ ip: "203.0.113.91", dinhDanh: "x1", now: T0 });
    const q = await gh.kiemTruoc({ ip: "203.0.113.91", dinhDanh: "x1", now: T0 });
    expect(q.cho).toBe(false);
  });

  it("[GHD-22] GIỚI HẠN CHẤP NHẬN (ghi rõ): chủ tài khoản đổi sang IP MỚI đúng lúc bị dò phân tán bị chặn tạm tới hết cửa sổ (không có đường vòng qua ID thiết bị)", async () => {
    const { thu } = mo();
    expect(await thu({ ip: "192.0.2.40", id: "84966000019", dung: true })).toBe("VAO");
    await doPhanTan(thu, "84966000019", 12);
    expect(await thu({ ip: "192.0.2.41", id: "84966000019", dung: true })).toBe("CHAN");
    expect(await thu({ ip: "192.0.2.41", id: "84966000019", dung: true, now: sau(CS.cuaSoMs + 1000) })).toBe("VAO");
  });
});
