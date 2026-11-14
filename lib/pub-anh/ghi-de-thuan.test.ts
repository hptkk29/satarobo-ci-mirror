// @vitest-environment node
import { describe, expect, it } from "vitest";
import { KICH_THUOC_ANH } from "@/components/public/pub-design/pub-anh-kich-thuoc";
import { ANH_KHOA_HOC } from "@/components/public/khoa-hoc/anh-khoa-hoc";
import {
  canhBaoDoNet,
  dongGoiGhiDe,
  hostChoPhep,
  kichThuocXuat,
  lyDoUrlKhongHopLe,
  phanTichGhiDe,
  tiLeKhop,
  tinhKhungCat,
} from "./ghi-de-thuan";
import { THU_TU_NHOM_TRANG, layOAnh, moiOAnh } from "./danh-muc";
import { VI_TRI_DUNG_ANH } from "./vi-tri-dung";

const CDN = ["cdn.satarobo.vn"];
const ANH = "https://cdn.satarobo.vn/uploads/images/2026-11/anh-public-659c3039-1a2b3c4d.webp";

describe("[PAN-01] host được phép", () => {
  it("luôn có CDN mặc định; thêm host của R2_PUBLIC_URL (có hoặc không có scheme)", () => {
    expect(hostChoPhep(undefined)).toEqual(["cdn.satarobo.vn"]);
    expect(hostChoPhep("https://img.example.com/")).toEqual(["cdn.satarobo.vn", "img.example.com"]);
    expect(hostChoPhep("img.example.com")).toEqual(["cdn.satarobo.vn", "img.example.com"]);
    expect(hostChoPhep("http://[bad")).toEqual(["cdn.satarobo.vn"]);
  });
});

describe("[PAN-02] URL ảnh thay: chỉ ảnh đã tải lên kho (chống đưa máy chủ đi tải URL tuỳ ý qua /_next/image)", () => {
  it("URL đúng ⇒ hợp lệ", () => {
    expect(lyDoUrlKhongHopLe(ANH, CDN)).toBeNull();
    expect(lyDoUrlKhongHopLe(ANH.replace(".webp", ".PNG"), CDN)).toBeNull();
  });
  it.each([
    ["http", "http://cdn.satarobo.vn/uploads/images/a.webp"],
    ["host lạ", "https://evil.com/uploads/images/a.webp"],
    ["host giả bằng tài khoản", "https://cdn.satarobo.vn@evil.com/uploads/images/a.webp"],
    ["host giả bằng tên miền con", "https://cdn.satarobo.vn.evil.com/uploads/images/a.webp"],
    ["cổng lạ", "https://cdn.satarobo.vn:8443/uploads/images/a.webp"],
    ["ngoài thư mục ảnh", "https://cdn.satarobo.vn/scorm/goi/a.webp"],
    ["đi ngược thư mục", "https://cdn.satarobo.vn/uploads/images/../x/a.webp"],
    ["SVG", "https://cdn.satarobo.vn/uploads/images/a.svg"],
    ["có query", "https://cdn.satarobo.vn/uploads/images/a.webp?x=1"],
    ["có fragment", "https://cdn.satarobo.vn/uploads/images/a.webp#x"],
    ["không phải URL", "không phải url"],
  ])("từ chối: %s", (_ten, url) => {
    expect(lyDoUrlKhongHopLe(url, CDN)).not.toBeNull();
  });
});

describe("[PAN-03] đọc giá trị đã lưu — hỏng thì coi như không ghi đè, không ném lỗi", () => {
  it("vòng khứ hồi", () => {
    const g = { url: ANH, w: 1200, h: 1595 };
    expect(phanTichGhiDe(dongGoiGhiDe(g), CDN)).toEqual(g);
  });
  it.each([
    ["JSON hỏng", "{không"],
    ["không phải object", "42"],
    ["null", "null"],
    ["thiếu w", JSON.stringify({ url: ANH, h: 500 })],
    ["w nhỏ hơn biên", JSON.stringify({ url: ANH, w: 10, h: 500 })],
    ["h không nguyên", JSON.stringify({ url: ANH, w: 500, h: 500.5 })],
    ["w quá lớn", JSON.stringify({ url: ANH, w: 99999, h: 500 })],
    ["host lạ", JSON.stringify({ url: "https://evil.com/uploads/images/a.webp", w: 500, h: 500 })],
  ])("%s ⇒ null", (_ten, raw) => {
    expect(phanTichGhiDe(raw, CDN)).toBeNull();
  });
  it("host bị gỡ khỏi danh sách cho phép SAU khi đã lưu ⇒ ảnh mặc định (không phục vụ host cũ)", () => {
    expect(phanTichGhiDe(dongGoiGhiDe({ url: ANH, w: 500, h: 500 }), ["khac.example.com"])).toBeNull();
  });
});

describe("[PAN-04] tỉ lệ khung", () => {
  it("khớp trong sai số 2%, lệch hơn thì không", () => {
    expect(tiLeKhop(1200, 1600, 1200, 1600)).toBe(true);
    expect(tiLeKhop(1200, 1600, 900, 1200)).toBe(true);
    expect(tiLeKhop(1200, 1600, 1199, 1600)).toBe(true); // làm tròn
    expect(tiLeKhop(1200, 1600, 1600, 1200)).toBe(false);
    expect(tiLeKhop(1200, 1600, 1200, 1500)).toBe(false);
  });
});

describe("[PAN-05] vùng cắt kiểu cover", () => {
  it("nguồn NGANG hơn ô ⇒ cắt hai bên, giữ nguyên chiều cao; vị trí 0/0.5/1 trượt dọc theo chiều ngang", () => {
    // ô 3:4 (900x1200), nguồn 4000x3000 → vùng cắt 2250x3000
    expect(tinhKhungCat(4000, 3000, 900, 1200, 0)).toEqual({ sx: 0, sy: 0, sw: 2250, sh: 3000 });
    expect(tinhKhungCat(4000, 3000, 900, 1200, 0.5)).toEqual({ sx: 875, sy: 0, sw: 2250, sh: 3000 });
    expect(tinhKhungCat(4000, 3000, 900, 1200, 1)).toEqual({ sx: 1750, sy: 0, sw: 2250, sh: 3000 });
  });
  it("nguồn CAO hơn ô ⇒ cắt trên/dưới, giữ nguyên chiều rộng", () => {
    // ô 4:3 (1200x900), nguồn 3000x4000 → vùng cắt 3000x2250
    expect(tinhKhungCat(3000, 4000, 1200, 900, 0.5)).toEqual({ sx: 0, sy: 875, sw: 3000, sh: 2250 });
  });
  it("nguồn ĐÚNG tỉ lệ ⇒ lấy cả ảnh, vị trí không có tác dụng", () => {
    expect(tinhKhungCat(1200, 1600, 900, 1200, 0)).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 1600 });
    expect(tinhKhungCat(1200, 1600, 900, 1200, 1)).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 1600 });
  });
  it("vị trí ngoài [0,1] / NaN bị kẹp, vùng cắt luôn nằm trong ảnh và đúng tỉ lệ ô", () => {
    for (const v of [-5, 7, Number.NaN]) {
      const c = tinhKhungCat(4000, 3000, 900, 1200, v);
      expect(c.sx).toBeGreaterThanOrEqual(0);
      expect(c.sx + c.sw).toBeLessThanOrEqual(4000);
      expect(tiLeKhop(900, 1200, c.sw, c.sh)).toBe(true);
    }
  });
});

describe("[PAN-06] kích thước xuất", () => {
  it("gấp đôi ô nhưng ≥1600 và ≤2000 cạnh dài; giữ đúng tỉ lệ ô", () => {
    const lon = { sx: 0, sy: 0, sw: 4000, sh: 4000 };
    expect(kichThuocXuat(576, 768, lon)).toEqual({ w: 1200, h: 1600 }); // 2×768=1536 → sàn 1600
    expect(kichThuocXuat(1400, 934, lon)).toEqual({ w: 2000, h: 1334 }); // 2×1400 → trần 2000
    const r = kichThuocXuat(900, 896, lon);
    expect(tiLeKhop(900, 896, r.w, r.h)).toBe(true);
  });
  it("KHÔNG phóng to quá vùng cắt thật", () => {
    const nho = { sx: 0, sy: 0, sw: 600, sh: 800 };
    expect(kichThuocXuat(576, 768, nho)).toEqual({ w: 600, h: 800 });
  });
});

describe("[PAN-07] cảnh báo độ nét", () => {
  it("nhỏ hơn ảnh hiện tại / hơi nhỏ / ổn", () => {
    expect(canhBaoDoNet(1200, 1600, { sx: 0, sy: 0, sw: 600, sh: 800 })).toBe("nho-hon-anh-cu");
    expect(canhBaoDoNet(576, 768, { sx: 0, sy: 0, sw: 750, sh: 900 })).toBe("hoi-nho");
    expect(canhBaoDoNet(576, 768, { sx: 0, sy: 0, sw: 1200, sh: 1600 })).toBeNull();
  });
});

describe("[PAN-08] danh mục ô ảnh khớp với bảng kích thước thật", () => {
  const tatCa = new Set([...Object.keys(KICH_THUOC_ANH), ...Object.keys(ANH_KHOA_HOC)]);
  it("mọi mã ảnh của giao diện public đều là một ô; mã lạ / sai dạng thì không", () => {
    expect(moiOAnh()).toHaveLength(tatCa.size);
    for (const id of tatCa) expect(layOAnh(id), id).not.toBeNull();
    expect(layOAnh("0".repeat(32))).toBeNull();
    expect(layOAnh("../../etc/passwd")).toBeNull();
    expect(layOAnh("")).toBeNull();
  });
  it("ô lấy đúng kích thước và đường dẫn mặc định giống PubAnh", () => {
    const id = "659c303937fe76b0d2be11b04c59889e";
    const k = KICH_THUOC_ANH[id]!;
    expect(layOAnh(id)).toMatchObject({ w: k[0], h: k[1], macDinh: `/pub/${id}.${k[2]}` });
  });
  it("mọi nhóm trang trong bảng sinh ra đều có trong THU_TU_NHOM_TRANG (nhóm lạ sẽ không hiện ở bộ lọc)", () => {
    const nhom = new Set(Object.values(VI_TRI_DUNG_ANH).flat());
    expect([...nhom].filter((n) => !(THU_TU_NHOM_TRANG as readonly string[]).includes(n))).toEqual([]);
  });
  it("ô sắp theo nhóm ưu tiên: ô đầu thuộc Trang chủ, hạng nhóm đầu không giảm; nhóm của một ô cũng theo thứ tự đó", () => {
    const ds = moiOAnh();
    expect(ds[0]!.nhomTrang[0]).toBe("Trang chủ");
    const hangDau = ds.map((o) => THU_TU_NHOM_TRANG.indexOf((o.nhomTrang[0] ?? "") as (typeof THU_TU_NHOM_TRANG)[number]));
    const khongRong = hangDau.filter((h) => h >= 0);
    expect(khongRong).toEqual([...khongRong].sort((a, b) => a - b));
    for (const o of ds) {
      const hang = o.nhomTrang.map((n) => THU_TU_NHOM_TRANG.indexOf(n as (typeof THU_TU_NHOM_TRANG)[number]));
      expect(hang).toEqual([...hang].sort((a, b) => a - b));
    }
  });
  it("bảng 'dùng ở trang nào' phủ đủ mọi ô (chạy lại scripts/pub/gen-vi-tri-anh.mjs khi thêm ảnh)", () => {
    expect(Object.keys(VI_TRI_DUNG_ANH).sort()).toEqual([...tatCa].sort());
  });
});
