/**
 * MỘT SỐ ĐIỆN THOẠI DUY NHẤT trên toàn bộ mặt công khai [chủ dự án chốt 24/09/2026].
 *
 * Trước hôm nay mỗi cơ sở mang một số riêng và số ấy nằm rải ở ~30 màn. Sau khi gộp về
 * `SATA_ROBO_PHONE`, thứ dễ xảy ra nhất là **một số cũ sót lại ở một màn không ai mở**, hoặc
 * người sau chép tay một số mới vào một trang — không lỗi biên dịch, không ca test nào đỏ,
 * và chỉ phụ huynh bấm nhầm mới biết.
 *
 * ⚠️ Đây là LƯỚI QUÉT MÃ NGUỒN, loại mong manh nhất (luật 11). Ba việc để nó không vô dụng:
 *  1. Chỉ soi mặt CÔNG KHAI — màn quản trị có số mẫu của riêng nó, không liên quan.
 *  2. **Bóc chú thích trước khi soi** (`.ts`/`.tsx`): chú thích giải thích bản vá có ghi
 *     đúng những số đang cấm, và đã một lần làm chính phép kiểm này đỏ oan.
 *  3. Mẫu số hẹp: đúng 10 chữ số, mở đầu `0[35789]`. Nới ra là dính **dữ liệu đường SVG**
 *     của các icon (đo thật: `007179246694`, `027241806224`, `01630160002`… đều là `<path d>`).
 *
 * Đã CẤY LẠI LỖI và thấy đỏ trước khi tin — xem commit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SATA_ROBO_PHONE } from "./locations";

/** Mặt người dùng cuối nhìn thấy. Không gồm `app/(admin)` và `app/(portal)`. */
const THU_MUC = [
  "app/(public)",
  "app/(legacy)",
  "app/(auth)",
  "components/public",
  "components/sections",
  "components/home",
  "components/khoa-hoc",
  "components/legacy-laptrinhrobot",
  "components/legacy-luyenthirobosim",
  "components/blog",
  "components/jobs",
  "components/honors",
  "components/seo",
  "content/legal",
];

/**
 * Số ĐƯỢC PHÉP xuất hiện ngoài số công ty — mỗi dòng kèm LÝ DO.
 *
 * Đây là số MẪU chỉ cho phụ huynh biết gõ số của CHÍNH HỌ theo dạng nào. Đổi chúng thành
 * số công ty là sai nghĩa: ô nhập sẽ gợi ý người dùng gõ số của trung tâm.
 */
const CHO_PHEP: Record<string, string> = {
  "0905123456": "số MẪU trong ô nhập SĐT của phụ huynh (kích hoạt / quên mật khẩu)",
  "0912345678": "số MẪU trong câu báo lỗi 'Số điện thoại không hợp lệ (VD: …)'",
};

const SO_CONG_TY = SATA_ROBO_PHONE.tho;

/**
 * Đúng 10 chữ số, mở đầu bằng đầu số di động VN, cho phép `.` hoặc `-` chen giữa.
 *
 * ⚠️ CỐ Ý KHÔNG nhận khoảng trắng làm dấu ngăn. Đo thật: cho phép khoảng trắng thì chuỗi
 * `05 6.34 6.34 0 0` trong `<path d="…">` của một icon ở chân trang khớp mẫu, và lưới đỏ
 * oan. Cái giá là dạng `0837 312 860` (ngăn bằng dấu cách) sẽ lọt — chấp nhận, vì `[SDT-02]`
 * vẫn bắt buộc số công ty phải có mặt thật, và không chỗ nào trong repo viết kiểu đó.
 */
const MAU_SDT = /(?<![0-9])0[35789](?:[.-]?\d){8}(?![0-9])/g;

function bocChuThich(s: string): string {
  const khongKhoi = s.replace(/\/\*[\s\S]*?\*\//g, "");
  return khongKhoi
    .split("\n")
    .map((d) => d.replace(/\/\/.*$/, ""))
    .join("\n");
}

function quet(goc: string, ra: string[]): void {
  let muc: string[];
  try {
    muc = readdirSync(goc);
  } catch {
    return; // thư mục không có thì thôi — danh sách trên là mặt công khai, không phải hợp đồng
  }
  for (const ten of muc) {
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) {
      if (ten === "node_modules" || ten === ".next") continue;
      quet(p, ra);
    } else if (/\.(ts|tsx|md)$/.test(ten) && !/\.(test|spec)\.tsx?$/.test(ten)) {
      ra.push(p);
    }
  }
}

describe("[SDT] một số điện thoại duy nhất trên mặt công khai", () => {
  const goc = process.cwd();
  const tep: string[] = [];
  for (const t of THU_MUC) quet(join(goc, ...t.split("/")), tep);

  it("[SDT-00] bộ đo có chạm tới mã thật — không quét vào khoảng không", () => {
    // Thiếu ca này thì một đường dẫn gõ sai làm mọi ca dưới xanh vì không đọc tệp nào.
    expect(tep.length).toBeGreaterThan(40);
    const co = tep.some((p) => p.endsWith(join("content", "legal", "chinh-sach-bao-mat.md")));
    expect(co, "không thấy chinh-sach-bao-mat.md — danh sách thư mục sai?").toBe(true);
  });

  it("[SDT-01] không màn công khai nào in một số khác số công ty", () => {
    const la: string[] = [];
    for (const p of tep) {
      const tho = readFileSync(p, "utf8");
      const noiDung = p.endsWith(".md") ? tho : bocChuThich(tho);
      for (const khop of noiDung.match(MAU_SDT) ?? []) {
        const so = khop.replace(/[.\-\s]/g, "");
        if (so === SO_CONG_TY || so in CHO_PHEP) continue;
        la.push(`${relative(goc, p).split(sep).join("/")}: ${khop}`);
      }
    }
    expect(
      la,
      "Số điện thoại trên site phải là MỘT số duy nhất của công ty " +
        `(${SATA_ROBO_PHONE.hien}). Số mẫu trong ô nhập thì khai vào CHO_PHEP kèm lý do; ` +
        "số liên hệ thật thì sửa về `SATA_ROBO_PHONE`.",
    ).toEqual([]);
  });

  it("[SDT-02] số công ty có thật trên mặt công khai, không phải hằng chết", () => {
    // Đối chứng DƯƠNG cho [SDT-01]: một ca chỉ khẳng định "không có số lạ" sẽ ĐẠT cả khi
    // site không in số nào (luật cứng #11).
    const coSo = tep.filter((p) => readFileSync(p, "utf8").includes(SATA_ROBO_PHONE.hien));
    expect(coSo.length, "không trang công khai nào in số công ty").toBeGreaterThan(5);
  });

  it("[SDT-03] các dạng của số khớp nhau", () => {
    expect(SATA_ROBO_PHONE.hien.replace(/\./g, "")).toBe(SATA_ROBO_PHONE.tho);
    expect(SATA_ROBO_PHONE.e164).toBe("+84" + SATA_ROBO_PHONE.tho.slice(1));
    expect(SATA_ROBO_PHONE.zalo).toBe("https://zalo.me/" + SATA_ROBO_PHONE.tho);
  });

  it("[SDT-04] cơ sở KHÔNG mang lại trường SĐT riêng", () => {
    // Gỡ bốn trường khỏi `SataRoboLocation` là thứ ép ~30 màn phải thu về một nút. Thêm lại
    // một trường tên na ná là mở đường cho từng màn lặng lẽ quay về hai số.
    const nguon = readFileSync(join(goc, "lib", "locations.ts"), "utf8");
    const than = bocChuThich(nguon);
    const khai = than.slice(than.indexOf("export interface SataRoboLocation"));
    const thanKhai = khai.slice(0, khai.indexOf("}"));
    for (const cam of ["hotline", "zalo", "phone", "sdt"]) {
      expect(thanKhai.toLowerCase(), `SataRoboLocation không được có trường "${cam}"`).not.toContain(
        cam,
      );
    }
  });
});
