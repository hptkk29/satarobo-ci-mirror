/**
 * TẦNG GHI NHẬN CÔNG DẠY KHÔNG ĐƯỢC BIẾT TỚI LOẠI HỢP ĐỒNG.
 *
 * ── Luật (chốt chủ dự án 07/09/2026) ────────────────────────────────────────────────────
 *   TẦNG GHI NHẬN — theo buổi cho TẤT CẢ. Mọi giáo viên, mọi `contractType`, đều sinh bản ghi
 *   công dạy cho từng buổi. Một luồng dữ liệu duy nhất, KHÔNG rẽ nhánh ở tầng này.
 *   TẦNG QUY ĐỔI TIỀN — rẽ theo `contractType`, và CHỈ ở đó.
 *
 *   "Không được rẽ nhánh contractType ở tầng ghi nhận. Nếu thấy mình đang viết `if contractType`
 *    trong code sinh bản ghi buổi thì dừng lại, thiết kế sai."
 *
 * ── Vì sao cần TEST chứ không cần một dòng chú thích ────────────────────────────────────
 * Ràng buộc bằng lời hứa thì sáu tháng nữa sẽ có người thêm một `if` — và nó sẽ trông rất hợp lý
 * ở thời điểm đó ("chỉ Fulltime mới cần ghi dòng này thôi mà"). Hậu quả không lộ ra ngay: tầng ghi
 * nhận rẽ nhánh thì hai nhóm nhân sự có hai bộ dữ liệu khác nhau, và mọi phép đối chiếu về sau —
 * kỳ công, định mức, báo cáo — đều phải tự nhớ nhánh nào áp cho ai.
 *
 * Cùng khuôn với `components/admin/nav-coverage.test.ts` và `components/ui/bang-coverage.test.ts`:
 * quét văn bản nguồn, đỏ ngay tại chỗ vi phạm.
 *
 * ── Cách "sửa" khi test đỏ ──────────────────────────────────────────────────────────────
 *  · Cần biết loại hợp đồng để TÍNH TIỀN → viết ở tầng quy đổi, và khai file vào `DUOC_PHEP`.
 *  · Cần biết loại hợp đồng để GHI NHẬN → **thiết kế sai**, dừng lại.
 * Đừng xoá test, và đừng nới `DUOC_PHEP` cho một file thuộc tầng ghi nhận.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * TẦNG GHI NHẬN — file nào sinh/đọc bản ghi công dạy.
 *
 * Khai bằng ĐƯỜNG DẪN CỤ THỂ chứ không bằng glob rộng: một glob quét thư mục trống sẽ luôn xanh,
 * và một test luôn xanh vì không quét gì là tệ hơn không có test.
 */
const TANG_GHI_NHAN = [
  "lib/cham-cong/cong-day.ts",
  "lib/cham-cong/cong-day-db.ts",
  "lib/lms/session-lifecycle.ts",
];

/** Thư mục tầng ghi nhận sẽ mọc ra khi làm tiếp — quét nếu có, không có thì thôi. */
const THU_MUC_GHI_NHAN = ["lib/payroll/ghi-nhan"];

/**
 * Định danh cấm ở tầng ghi nhận. Không chỉ `contractType`: cả cụm trường phân hạng lương đều là
 * thứ chỉ tầng quy đổi tiền mới được biết.
 */
const CAM = ["contractType", "ContractType", "salaryRank", "salaryLevel", "bhxhBase"];

/**
 * File dưới `lib/payroll/**` ĐƯỢC PHÉP nhắc tới các định danh trên — mỗi dòng phải nêu lý do.
 *
 * Hôm nay danh sách này RỖNG có chủ đích: tầng quy đổi tiền chưa được code (chờ 13 câu nghiệp vụ
 * ở `docs/cham-cong/VE-DIEU-KIEN-TIEN-QUYET-DINH-MUC.md` §3 có lời). Khi làm, điểm rẽ nhánh DUY
 * NHẤT là `lib/payroll/mo-hinh.ts` — xem `docs/cham-cong/THIET-KE-LUONG-GIANG-DAY.md` §2.
 */
const DUOC_PHEP: Record<string, string> = {
  "lib/payroll/tang-ghi-nhan.test.ts": "chính test này — phải nhắc tên định danh mới quét được",
};

function docFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Mọi file .ts/.tsx dưới `rel`, đường dẫn tương đối gốc repo. Thư mục chưa tồn tại ⇒ mảng rỗng. */
function quetThuMuc(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const ra: string[] = [];
  // Đệ quy tay thay vì `readdirSync(..., { recursive: true })`: tuỳ phiên bản Node mà cờ đó trả
  // string[] hay Dirent[], và Dirent lại đổi `path` thành `parentPath` — ép kiểu cho qua là để
  // test này vỡ âm thầm ở máy có Node khác.
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const con = `${rel}/${e.name}`;
    if (e.isDirectory()) ra.push(...quetThuMuc(con));
    else if (e.isFile() && /\.tsx?$/.test(e.name)) ra.push(con);
  }
  return ra;
}

/** Bỏ chú thích trước khi quét — nói VỀ `contractType` khác với RẼ NHÁNH theo nó. */
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("tầng ghi nhận công dạy không rẽ nhánh theo loại hợp đồng", () => {
  it("mọi đường dẫn khai trong TANG_GHI_NHAN đều tồn tại thật", () => {
    // Chống test rỗng: đổi tên file mà quên sửa danh sách thì luật im lặng ngừng có hiệu lực.
    const mat = TANG_GHI_NHAN.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    expect(mat, `File đã đổi tên/xoá — cập nhật TANG_GHI_NHAN: ${mat.join(", ")}`).toEqual([]);
    expect(TANG_GHI_NHAN.length).toBeGreaterThan(0);
  });

  it.each(TANG_GHI_NHAN)("%s — không nhắc tới loại hợp đồng / bậc lương", (rel) => {
    const src = boChuThich(docFile(rel));
    const thay = CAM.filter((k) => src.includes(k));
    expect(
      thay,
      `${rel} đang dùng ${thay.join(", ")} ở TẦNG GHI NHẬN.\n` +
        "Cần loại hợp đồng để TÍNH TIỀN ⇒ viết ở tầng quy đổi (lib/payroll/mo-hinh.ts).\n" +
        "Cần loại hợp đồng để GHI NHẬN ⇒ thiết kế sai, dừng lại.",
    ).toEqual([]);
  });

  it("thư mục tầng ghi nhận (khi đã mọc ra) cũng sạch", () => {
    const files = THU_MUC_GHI_NHAN.flatMap(quetThuMuc);
    const pham = files
      .map((f) => ({ f, thay: CAM.filter((k) => boChuThich(docFile(f)).includes(k)) }))
      .filter((x) => x.thay.length > 0);
    expect(pham.map((x) => `${x.f}: ${x.thay.join(", ")}`)).toEqual([]);
  });

  it("dưới lib/payroll, chỉ file trong DUOC_PHEP mới được nhắc tới loại hợp đồng", () => {
    // Cổng thứ hai: nó bắt được cả trường hợp ai đó dựng tầng ghi nhận ở một thư mục CHƯA khai
    // trong hai danh sách trên — miễn là thư mục đó nằm dưới `lib/payroll`.
    const pham = quetThuMuc("lib/payroll")
      .filter((f) => !(f in DUOC_PHEP))
      .map((f) => ({ f, thay: CAM.filter((k) => boChuThich(docFile(f)).includes(k)) }))
      .filter((x) => x.thay.length > 0);
    expect(
      pham.map((x) => `${x.f}: ${x.thay.join(", ")}`),
      "File mới dưới lib/payroll dùng contractType — nếu đó là tầng QUY ĐỔI TIỀN thì khai vào " +
        "DUOC_PHEP kèm lý do; nếu là tầng GHI NHẬN thì thiết kế sai.",
    ).toEqual([]);
  });
});
