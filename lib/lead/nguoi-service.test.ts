/**
 * PHÂN BỔ LẠI LEAD NGUỘI — ba luật chốt 16/09/2026.
 *
 * Cả ba đều là loại luật KHÔNG chứng minh được bằng test hàm thuần: thứ cần khoá là một lời
 * gọi cụ thể trong đường ghi (`chiaChoLead` truyền cơ sở nào, `canManualAssign` nhận
 * `actorIsHoLevel` gì, hai đường ghi ghi chú có nhảy `lastActivityAt` không). Repo gọi đây là
 * LƯỚI GHIM MÃ NGUỒN — xem mục cùng tên trong CLAUDE.md, gồm cả bước bắt buộc: cấy lại lỗi và
 * thấy lưới ĐỎ trước khi tin nó.
 *
 * ⚠️ Luật 11 xếp test quét mã nguồn là loại mong manh nhất, nên mỗi ca dưới đây: gỡ chú thích
 * trước khi soi (chú thích giải thích bản vá luôn chứa đúng chuỗi đang tìm), neo hẹp, và có ca
 * TỰ KIỂM để regex hỏng không thành xanh giả.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Gỡ chú thích rồi mới soi. */
function goChuThich(s: string): string {
  return s.replace(/\/\*[^]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function doc(...p: string[]): string {
  const duong = path.join(ROOT, ...p);
  expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
  return goChuThich(fs.readFileSync(duong, "utf8"));
}

const DICH_VU = doc("lib", "lead", "nguoi-service.ts");
const ACTIONS_LEAD = doc("app", "(admin)", "admin", "leads", "actions.ts");

describe("[NGUOI-T20] phép quét tự kiểm", () => {
  it("đọc được cả hai tệp và bộ gỡ chú thích hoạt động", () => {
    // Regex hỏng thì mọi ca dưới xanh giả.
    expect(DICH_VU.length).toBeGreaterThan(2000);
    expect(ACTIONS_LEAD.length).toBeGreaterThan(5000);
    const thu = ["a /* x */ b // y", "c"].join(String.fromCharCode(10));
    expect(goChuThich(thu)).toBe(["a   b  ", "c"].join(String.fromCharCode(10)));
  });
});

describe("[NGUOI-T21] ⚠️ KHÔNG BAO GIỜ chia lead qua cơ sở khác", () => {
  // Chốt 16/09/2026: "lead nằm ở cs nào thì chia đều lại cs đó, chứ không được chia qua cs
  // khác". Sai luật này là lead rơi vào tay người KHÔNG MỞ ĐƯỢC NÓ (`Lead` nằm trong
  // `SCOPED_MODELS`), tức vừa mất lead vừa không ai biết.

  it("chia vòng lấy cơ sở của CHÍNH lead, không phải cơ sở nào khác", () => {
    expect(DICH_VU).toContain("targetCenterId: lead.centerId");
  });

  it("giao đích danh PHẢI đi qua `canManualAssign`", () => {
    // Đừng chép lại luật gán tay — repo đã có một bản, và bản đó còn nói đúng câu người dùng
    // cần nghe ("Dùng Chuyển lead nếu muốn đổi cơ sở").
    expect(DICH_VU).toContain("canManualAssign(");
  });

  it("⚠️ và phải truyền `actorIsHoLevel: false` — kể cả khi người bấm là Hội sở", () => {
    // `canManualAssign` CÓ cửa cho HO đi xuyên cơ sở, và cửa đó đúng ở màn "giao tay một
    // lead". Ở màn này thì SAI: đây là "phân bổ lại", không phải "chuyển cơ sở". Truyền
    // `true` (hoặc truyền biến) là mở lại đúng lỗ vừa bịt, và không cổng nào khác canh.
    expect(DICH_VU).toMatch(/actorIsHoLevel:\s*false/);
    expect(DICH_VU).not.toMatch(/actorIsHoLevel:\s*(true|actor|params)/);
  });
});

describe("[NGUOI-T22] ⚠️ ghi chú của Sale PHẢI reset đồng hồ", () => {
  // Chốt 16/09/2026: "lần gần nhất tương tác lead tính cả ghi chú lead luôn".
  //
  // Đo trước bản vá: CẢ HAI đường ghi `note` đều chỉ `lead.update({ data: { note } })` —
  // không sinh dòng hoạt động, không đụng `lastActivityAt`. Hệ quả ở hai chỗ:
  //   · `/lead-nguoi` chấm lead vừa được ghi chú là "chưa ai chăm", mà màn đó phân bổ HÀNG
  //     LOẠT ⇒ giật lead khỏi tay người đang làm;
  //   · `isLeadIdle` (`lib/crm/sla.ts`) đọc đúng cột đó nên cảnh báo SLA cũng nổ nhầm.

  /** Cắt thân một hàm cấp cao nhất theo tên. */
  function than(src: string, ten: string): string {
    const i = src.indexOf(`export async function ${ten}`);
    expect(i, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
    const sau = src.slice(i + 1).search(/^export (async )?function /m);
    return sau === -1 ? src.slice(i) : src.slice(i, i + 1 + sau);
  }

  it("đường ghi chú riêng (`updateLeadNote`) nhảy `lastActivityAt`", () => {
    expect(than(ACTIONS_LEAD, "updateLeadNote")).toContain("lastActivityAt");
  });

  it("đường biểu mẫu đầy đủ (`updateLeadFields`) cũng nhảy", () => {
    // Vá một đường mà quên đường kia thì lỗ chỉ chuyển chỗ chứ không mất — người dùng sửa
    // ghi chú bằng form đầy đủ vẫn bị chấm là bỏ bê.
    expect(than(ACTIONS_LEAD, "updateLeadFields")).toContain("lastActivityAt");
  });

  it("⚠️ chỉ nhảy khi ghi chú THỰC SỰ đổi", () => {
    // Nhảy vô điều kiện thì mở lead ra bấm Lưu mà không sửa gì cũng reset đồng hồ — biến
    // phép đo thành "lần cuối có người MỞ lead", không còn là "lần cuối có người chăm".
    const tNote = than(ACTIONS_LEAD, "updateLeadNote");
    const tFields = than(ACTIONS_LEAD, "updateLeadFields");
    expect(tNote).toMatch(/newNote !== before\.note/);
    expect(tFields).toMatch(/updateData\.note !== before\.note/);
  });
});

describe("[NGUOI-T23] phân trang cắt ở TẦNG DB", () => {
  it("nhận `trang` + `soDong`, không nạp cả sổ rồi cắt ở trình duyệt", () => {
    // Bản đầu nạp tối đa 500 dòng rồi cắt trang ở client: với sổ 1.279 lead thì 779 dòng
    // cuối KHÔNG AI THẤY, mà màn hình vẫn báo "tìm thấy 1.279".
    expect(DICH_VU).toMatch(/trang:\s*number/);
    expect(DICH_VU).toMatch(/soDong:\s*number/);
    expect(DICH_VU).toContain("db.lead.count(");
  });

  it("nói ra khi vượt trần quét, không âm thầm cắt", () => {
    // Cắt im lặng ở một màn phân bổ hàng loạt là để người dùng tưởng mình đã xử lý hết.
    expect(DICH_VU).toContain("quetThieu");
  });

  it("màn hình dùng đúng bộ phân trang của `/leads`, không dựng bộ riêng", () => {
    const man = doc("app", "(admin)", "admin", "lead-nguoi", "_components", "bang-lead-nguoi.tsx");
    expect(man).toContain("ChonSoDong");
    expect(man).toContain("DieuHuongTrang");
  });

  it("⚠️ số dòng đọc qua `docSoDong`, không tin thẳng `?size=` của URL", () => {
    // `?size=` là chuỗi do người dùng gõ. Truyền thẳng vào `take` là để một lượt gõ
    // `?size=999999` kéo cả sổ lead về; `docSoDong` kẹp về đúng 4 mức [10,20,50,100].
    const trang = doc("app", "(admin)", "admin", "lead-nguoi", "page.tsx");
    expect(trang).toContain("docSoDong(");
    expect(trang).not.toMatch(/soDong\s*[=:]\s*Number\(/);
  });
});
