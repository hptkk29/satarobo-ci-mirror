// [NKL-*] Nhật ký từng lượt gọi nhà cung cấp — phần THUẦN (phân loại kết quả, che, băm) + LƯỚI GHIM: mọi lời gọi `phatHanh` / `traCuu` / `taiTep`
// trong `lib/finance/hoa-don` phải đi qua `goiCoNhatKy`. Phần hành vi trên Postgres thật nằm ở `tests/finance/hoa-don-phat-hanh-misa.test.ts` ([NKG-*]).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bamPhieuLuotGoi, phanLoaiKetQua, rutThongDiepNhatKy } from "./nhat-ky-luot-goi";

const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => bo(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[NKL] phân loại kết quả → dòng nhật ký", () => {
  it("[NKL-01] bốn kết quả của hợp đồng cổng, mỗi cái một ketQua; TU_CHOI mang mã nhà cung cấp", () => {
    expect(phanLoaiKetQua({ loai: "DA_PHAT_HANH" })).toEqual({ ketQua: "DA_PHAT_HANH", maNhaCungCap: null, thongDiep: null });
    expect(phanLoaiKetQua({ loai: "CHUA_CO" })).toEqual({ ketQua: "CHUA_CO", maNhaCungCap: null, thongDiep: null });
    expect(phanLoaiKetQua({ loai: "KHONG_RO", thongDiep: "timeout" })).toEqual({ ketQua: "KHONG_RO", maNhaCungCap: null, thongDiep: "timeout" });
    expect(phanLoaiKetQua({ loai: "TU_CHOI", ma: "VIN_08", thongDiep: "sai dữ liệu" })).toEqual({ ketQua: "TU_CHOI", maNhaCungCap: "VIN_08", thongDiep: "sai dữ liệu" });
  });

  it("[NKL-02] thông điệp bị CẮT ở 300 ký tự và qua bộ che bí mật (mật khẩu/token trong thông điệp nhà cung cấp không vào nhật ký)", () => {
    expect(rutThongDiepNhatKy("x".repeat(500))).toHaveLength(300);
    expect(rutThongDiepNhatKy("lỗi password=Sup3rSecret rồi")).not.toContain("Sup3rSecret");
    expect(rutThongDiepNhatKy("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
    expect(rutThongDiepNhatKy("")).toBeNull();
    expect(rutThongDiepNhatKy(null)).toBeNull();
  });

  it("[NKL-03] băm phiếu: ổn định cho cùng nội dung, đổi khi nội dung đổi, 64 ký tự hex — và KHÔNG chứa thân phiếu", () => {
    const a = bamPhieuLuotGoi({ refId: "R1", nguoiMua: { hoTen: "Nguyễn Văn A" } });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(bamPhieuLuotGoi({ refId: "R1", nguoiMua: { hoTen: "Nguyễn Văn A" } }));
    expect(a).not.toBe(bamPhieuLuotGoi({ refId: "R2", nguoiMua: { hoTen: "Nguyễn Văn A" } }));
    expect(a).not.toContain("Nguy");
  });
});

describe("[NKL-W] lưới ghim: không lời gọi nhà cung cấp nào lọt ra ngoài nhật ký", () => {
  const phatHanh = doc("lib/finance/hoa-don/phat-hanh-misa.ts");

  it("[NKL-W1] mỗi lời gọi cổng nằm TRONG `goi: () =>` của `goiCoNhatKy` — đúng MỘT lần mỗi loại, loại lượt khớp lời gọi", () => {
    expect(phatHanh.match(/\bcong\.phatHanh\(/g)).toHaveLength(1);
    expect(phatHanh.match(/\bcong\.traCuu\(/g)).toHaveLength(1);
    expect(phatHanh.match(/\bcong\.taiTep\(/g)).toHaveLength(1);
    expect(phatHanh.match(/goi: \(\) => cong\.phatHanh\(/g)).toHaveLength(1);
    expect(phatHanh.match(/goi: \(\) => cong\.traCuu\(/g)).toHaveLength(1);
    expect(phatHanh.match(/goi: \(\) => cong\.taiTep\(/g)).toHaveLength(1);
    // Loại lượt đi đúng cặp (đổi nhầm PHAT_HANH ↔ TRA_CUU là nhật ký nói sai «đã gửi» thành «đã tra cứu»).
    expect(phatHanh).toMatch(/loaiLuot: "PHAT_HANH"[\s\S]{0,260}goi: \(\) => cong\.phatHanh\(/);
    expect(phatHanh).toMatch(/loaiLuot: "TRA_CUU"[\s\S]{0,260}goi: \(\) => cong\.traCuu\(/);
    expect(phatHanh).toMatch(/loaiLuot: "TAI_TEP"[\s\S]{0,260}goi: \(\) => cong\.taiTep\(/);
  });

  it("[NKL-W2] không tệp nào khác trong lib/finance/hoa-don gọi thẳng `phatHanh` / `traCuu` / `taiTep` của một cổng (đi vòng nhật ký)", () => {
    const goc = resolve(process.cwd(), "lib/finance/hoa-don");
    const tep: string[] = [];
    const duyet = (d: string) => {
      for (const t of readdirSync(d)) {
        const p = join(d, t);
        if (statSync(p).isDirectory()) duyet(p);
        else if (/\.tsx?$/.test(t) && !/\.test\.tsx?$/.test(t) && !/testdata/.test(t)) tep.push(p);
      }
    };
    duyet(goc);
    // Ba tệp được phép chỉ vì chúng là LỚP BỌC chuyển tiếp, không phải nơi quyết định gọi: `cong-theo-phap-nhan` (cổng đối chiếu MST rồi chuyển tiếp) và hai adapter
    // `nha-cung-cap/*` (bọc một cổng thành hợp đồng chung). Lời gọi THẬT vẫn do `phat-hanh-misa.ts` phát ra qua `goiCoNhatKy` (ca W1).
    const LOP_BOC = ["phat-hanh-misa.ts", "nhat-ky-luot-goi.ts", "cong-theo-phap-nhan.ts", "misa-adapter.ts", "vin-adapter.ts"];
    const loi = tep.filter((p) => !LOP_BOC.some((t) => p.endsWith(t)) && /\bcong\w*\.(phatHanh|traCuu|taiTep)\(/.test(bo(readFileSync(p, "utf8"))));
    expect(loi).toEqual([]);
  });

  it("[NKL-W3] `nguoiGoiId` là tham số BẮT BUỘC (không dấu ?) ở ba hàm công khai — quên truyền là lỗi biên dịch", () => {
    expect(phatHanh).toMatch(/export async function guiPhatHanh\(input: \{[^}]*\bnguoiGoiId: string \| null;/);
    expect(phatHanh).toMatch(/export async function kiemTraMotBan\(input: \{[\s\S]*?\bnguoiGoiId: string \| null;\s*\}\)/);
    expect(phatHanh).toMatch(/export function kiemTraLaiKhongGuiLai\(input: \{[^}]*\bnguoiGoiId: string \| null/);
    expect(phatHanh).not.toMatch(/nguoiGoiId\?:/);
  });
});
