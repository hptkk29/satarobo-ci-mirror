// @vitest-environment node
/**
 * [TLD-*] Ô TÌM LEAD DÙNG CHUNG (13/11/2026) trên Postgres THẬT — `timIdLead` (lib/lead/tim-lead-db.ts).
 *
 * Hai lỗi câm của ô tìm cũ, mỗi lỗi một nhóm ca:
 *   · tên con chỉ so với `Lead.childName` (đứa ĐẦU) ⇒ bé thứ hai trong `LeadChild` không bao giờ ra          → [TLD-02]
 *   · so đúng dấu ⇒ gõ «khai» không ra «Khải», «nguyen an» không ra «Nguyễn An»                              → [TLD-03]
 * Cộng cổng PII (S-1): thiếu quyền xem SĐT thì SĐT/email KHÔNG được dùng để tìm (đối chứng DƯƠNG đi kèm)      → [TLD-05]
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `TLD`. LUẬT 18: mỗi ca tự dựng hiện trường.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { timIdLead } from "../../lib/lead/tim-lead-db";

const P = "TLD";
const id = (s: string) => `${P}-${s}`;

async function don() {
  await db.leadChild.deleteMany({ where: { leadId: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
}

/** Ba phiếu mẫu có hình dạng THẬT (tên có dấu, nhiều con, SĐT hai kiểu lưu, một phiếu đã xoá mềm). */
async function dung() {
  await don();
  await db.lead.create({ data: { id: id("a"), parentName: "Nguyễn Thị Ngọc Ánh", phone: "84905123456", email: "anh.nguyen@example.test", childName: "Bé Khải", status: "MOI" } });
  await db.leadChild.createMany({
    data: [
      { id: id("a1"), leadId: id("a"), fullName: "Bé Khải" },
      { id: id("a2"), leadId: id("a"), fullName: "Đặng Gia Hân" }, // bé THỨ HAI — bản cũ không bao giờ tìm ra
    ],
  });
  await db.lead.create({ data: { id: id("b"), parentName: "Trần Văn Bình", phone: "0905 777 888", childName: "Lê Minh Quân", status: "MOI" } });
  await db.lead.create({ data: { id: id("c"), parentName: "Phạm Thu Hà", phone: "84988111222", childName: "Khải Hoàn", status: "MOI", deletedAt: new Date("2026-01-01T00:00:00Z") } });
}

const tim = async (q: string, duoc = true) => ((await timIdLead({ q, duocTimSdtEmail: duoc }))?.ids ?? []).filter((x) => x.startsWith(P)).sort();

describe.skipIf(!RUN_DB_TESTS)("[TLD] ô tìm lead dùng chung — Postgres thật", () => {
  beforeEach(dung);
  afterAll(don);

  it("[TLD-00] ĐỐI CHỨNG DƯƠNG: gõ ĐÚNG, CÓ DẤU tên PH ⇒ ra (nếu không, các ca «không dấu» xanh vì chẳng gì tìm được)", async () => {
    expect(await tim("Nguyễn Thị Ngọc Ánh")).toEqual([id("a")]);
    expect(await tim("   ")).toEqual([]); // chuỗi rỗng ⇒ hàm trả null ⇒ không có id nào (nơi gọi không lọc)
    expect(await timIdLead({ q: "   ", duocTimSdtEmail: true })).toBeNull();
  });

  it("[TLD-01] tên con trên phiếu (Lead.childName) ra — gồm tên đứa thứ nhất", async () => {
    expect(await tim("Lê Minh Quân")).toEqual([id("b")]);
    expect(await tim("Khải")).toEqual([id("a")]); // phiếu c cũng có «Khải Hoàn» nhưng đã xoá mềm ⇒ không bao giờ ra
  });

  it("[TLD-02] 🔴 bé THỨ HAI trong LeadChild ra — vế mà ô tìm cũ không có", async () => {
    expect(await tim("Đặng Gia Hân")).toEqual([id("a")]);
    expect(await tim("Gia Hân")).toEqual([id("a")]);
  });

  it("[TLD-03] 🔴 gõ KHÔNG DẤU / sai hoa-thường vẫn ra: «khai», «dang gia han», «nguyen thi ngoc anh», «ĐẶNG»", async () => {
    expect(await tim("khai")).toEqual([id("a")]);
    expect(await tim("dang gia han")).toEqual([id("a")]);
    expect(await tim("nguyen thi ngoc anh")).toEqual([id("a")]);
    expect(await tim("ĐẶNG")).toEqual([id("a")]);
    expect(await tim("tran van binh")).toEqual([id("b")]);
  });

  it("[TLD-04] nhiều tiếng KHÔNG cần đúng thứ tự, nhưng phải khớp CÙNG MỘT trường: «an nguyen» ra phiếu a; «Ánh Hân» (PH + bé) KHÔNG ghép chéo hai trường", async () => {
    expect(await tim("anh nguyen")).toEqual([id("a")]);
    expect(await tim("Ánh Hân")).toEqual([]);
  });

  it("[TLD-05] 🔴 CỔNG PII (S-1): được xem SĐT ⇒ tìm ra bằng số/email; KHÔNG được ⇒ cùng số, cùng email KHÔNG ra gì (tên vẫn ra)", async () => {
    // đối chứng DƯƠNG: cả hai kiểu lưu 84… / 0… (có dấu cách), gõ kiểu nào cũng ra
    expect(await tim("0905123456", true)).toEqual([id("a")]);
    expect(await tim("84905123456", true)).toEqual([id("a")]);
    expect(await tim("0905777888", true)).toEqual([id("b")]);
    expect(await tim("anh.nguyen@example", true)).toEqual([id("a")]);
    // thiếu quyền ⇒ nhánh SĐT/email biến mất
    expect(await tim("0905123456", false)).toEqual([]);
    expect(await tim("0905777888", false)).toEqual([]);
    expect(await tim("anh.nguyen@example", false)).toEqual([]);
    expect(await tim("Nguyễn Thị Ngọc Ánh", false)).toEqual([id("a")]);
  });

  it("[TLD-06] ký tự đặc biệt của LIKE là chữ thường: `%` và `_` không khớp tất cả; không lỗi SQL với dấu nháy", async () => {
    expect(await tim("%")).toEqual([]);
    expect(await tim("_")).toEqual([]);
    expect(await tim("' OR 1=1 --")).toEqual([]);
  });
});
