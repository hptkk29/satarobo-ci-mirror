import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { genStudentCodeV2ChoCoSo, randomStudentCodeBody, yy } from "@/lib/codegen";
import { LOI_DANG_MA_HOC_VIEN, STUDENT_CODE_V2_CHARSET, loiMaHocVien } from "@/lib/students/ma-hoc-vien-dang";

// =============================================================================
// MÃ HỌC VIÊN — MỘT DẠNG DUY NHẤT `CS1-26-AB3K9P` [chủ dự án chốt 06/11/2026]
//
// Sự cố: màn Học viên hiện `COSONGUYENHUUTHO-26-FD8Q6T` cạnh `CS1-26-XVM455`. Gốc: `Center.id` của hai cơ sở
// thật là SLUG (`co-so-nguyen-huu-tho`); `chuyen-doi-ghi.ts` truyền `centerId` vào hàm nhận MÃ cơ sở, và cả hai đều là
// `string` nên `tsc` im lặng. Đo prod: 3 học viên sống mang mã sai tiền tố, 147/148 đúng dạng v2.
// Yêu cầu kèm theo: "từ nay về sau không được bị lại nữa" ⇒ chỉ MỘT lối sinh mã (tự đọc Center.code) + MỘT cổng cho mọi
// lối nhận mã từ người/tệp.
// =============================================================================

const DANG_V2 = /^[A-Z0-9]+-\d{2}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

type CoSo = { id: string; code: string | null };

/** Client giả: `center.findUnique` theo id; `student.findUnique` luôn "chưa có mã này". */
function clientGia(coSo: CoSo[]) {
  const hoi: string[] = [];
  const client = {
    center: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        hoi.push(where.id);
        const c = coSo.find((x) => x.id === where.id);
        return c ? { code: c.code } : null;
      },
    },
    student: { findUnique: async () => null },
  };
  return { client: client as unknown as PrismaClient, hoi };
}

const CS_THAT: CoSo[] = [
  { id: "co-so-nguyen-huu-tho", code: "CS1" },
  { id: "co-so-hoang-dieu", code: "CS2" },
  { id: "hoi-so", code: "HO" },
];

describe("[MHV] genStudentCodeV2ChoCoSo — mã theo MÃ cơ sở, không theo id", () => {
  it("[MHV-01] id slug của cơ sở thật ⇒ tiền tố là Center.code (CS1/CS2), KHÔNG phải slug", async () => {
    const { client } = clientGia(CS_THAT);
    const a = await genStudentCodeV2ChoCoSo("co-so-nguyen-huu-tho", client);
    const b = await genStudentCodeV2ChoCoSo("co-so-hoang-dieu", client);
    expect(a).toMatch(/^CS1-\d{2}-[A-Z2-9]{6}$/);
    expect(b).toMatch(/^CS2-\d{2}-[A-Z2-9]{6}$/);
    expect(a).toMatch(DANG_V2);
    // Đúng mã đã lên prod: slug sanitize ra `COSONGUYENHUUTHO` / `COSOHOANGDIEU`.
    expect(a).not.toContain("COSO");
    expect(b).not.toContain("COSO");
  });

  it("[MHV-02] hàm chỉ HỎI Center đúng id được truyền (đọc mã từ DB, không đoán từ chuỗi)", async () => {
    const { client, hoi } = clientGia(CS_THAT);
    await genStudentCodeV2ChoCoSo("hoi-so", client);
    expect(hoi).toEqual(["hoi-so"]);
  });

  it("[MHV-03] mã cơ sở có chữ thường / dấu gạch ⇒ vẫn ra dạng v2 hợp lệ", async () => {
    const { client } = clientGia([{ id: "c1", code: "cs-3" }]);
    expect(await genStudentCodeV2ChoCoSo("c1", client)).toMatch(/^CS3-\d{2}-[A-Z2-9]{6}$/);
  });

  it("[MHV-04] cơ sở KHÔNG tồn tại ⇒ ném lỗi, không rơi về mã lệch dạng `-26-ABC123`", async () => {
    const { client } = clientGia(CS_THAT);
    await expect(genStudentCodeV2ChoCoSo("khong-co", client)).rejects.toThrow(/chưa có mã|cơ sở/);
  });

  it("[MHV-05] cơ sở chưa có mã (null / rỗng / toàn ký tự bị bỏ) ⇒ ném lỗi", async () => {
    for (const code of [null, "", "  ", "---"]) {
      const { client } = clientGia([{ id: "c1", code }]);
      await expect(genStudentCodeV2ChoCoSo("c1", client)).rejects.toThrow(/chưa có mã/);
    }
  });

  it("[MHV-06] thiếu centerId (null) ⇒ ném lỗi, không gọi DB", async () => {
    const { client, hoi } = clientGia(CS_THAT);
    await expect(genStudentCodeV2ChoCoSo(null, client)).rejects.toThrow(/thiếu cơ sở/);
    expect(hoi).toEqual([]);
  });

  it("[MHV-07] đụng mã đã có ⇒ thử lại và ra mã khác (giữ hành vi unique)", async () => {
    let n = 0;
    // Lượt 1 rand ra thân `AAAAAA` (đã có), lượt 2 đổi thân mã.
    const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const rand = () => seq[n++ % seq.length]!;
    const trung = `CS1-${yy()}-AAAAAA`;
    const client = {
      center: { findUnique: async () => ({ code: "CS1" }) },
      student: {
        findUnique: async ({ where }: { where: { studentCode: string } }) =>
          where.studentCode === trung ? { id: "da-co" } : null,
      },
    } as unknown as PrismaClient;
    const ma = await genStudentCodeV2ChoCoSo("c1", client, { rand });
    expect(ma).not.toBe(trung);
    expect(ma).toMatch(DANG_V2);
  });

  it("[MHV-08] mã sinh ra luôn qua được cổng kiểm của chính nó (tính chất, 500 mẫu ngẫu nhiên)", async () => {
    const { client } = clientGia(CS_THAT);
    for (let i = 0; i < 500; i++) {
      const ma = await genStudentCodeV2ChoCoSo("co-so-hoang-dieu", client, { rand: Math.random });
      expect(loiMaHocVien(ma, "CS2"), ma).toBeNull();
    }
  });
});

// ── CỔNG KIỂM THUẦN: loiMaHocVien ────────────────────────────────────────────────────

describe("[MHV-D] loiMaHocVien — một dạng, đúng tiền tố", () => {
  it("[MHV-D1] mã đúng dạng + đúng tiền tố ⇒ hợp lệ (chuỗi / mảng / null)", () => {
    expect(loiMaHocVien("CS1-26-AB3K9P", "CS1")).toBeNull();
    expect(loiMaHocVien("CS2-26-Z35FCT", ["CS1", "CS2", "HO"])).toBeNull();
    expect(loiMaHocVien("CS1-26-AB3K9P", null)).toBeNull();
  });

  it("[MHV-D2] ĐÚNG MÃ ĐÃ LÊN PROD: COSONGUYENHUUTHO-26-FD8Q6T khớp HÌNH DẠNG nhưng sai TIỀN TỐ ⇒ phải bị từ chối", () => {
    // Đây là lý do cổng phải nhận mã cơ sở: chỉ kiểm hình dạng (maCoSo = null) thì mã sai vẫn lọt.
    expect(loiMaHocVien("COSONGUYENHUUTHO-26-FD8Q6T", null)).toBeNull();
    expect(loiMaHocVien("COSONGUYENHUUTHO-26-FD8Q6T", "CS1")).toMatch(/CS1-/);
    expect(loiMaHocVien("COSONGUYENHUUTHO-26-FD8Q6T", ["CS1", "CS2", "HO"])).toMatch(/cơ sở có thật/);
    expect(loiMaHocVien("COSOHOANGDIEU-26-Z35FCT", "CS2")).toMatch(/CS2-/);
  });

  it("[MHV-D3] tiền tố của cơ sở KHÁC ⇒ từ chối (mã CS2 gán cho học viên CS1)", () => {
    expect(loiMaHocVien("CS2-26-AB3K9P", "CS1")).toMatch(/CS1-/);
  });

  it("[MHV-D4] dạng cũ và các dạng lệch ⇒ từ chối bằng câu nói rõ dạng đúng", () => {
    for (const ma of [
      "CS1.HV.26.001", // dạng cũ đã gỡ
      "cs1-26-ab3k9p", // chữ thường
      "CS1-26-AB3K9", // thiếu ký tự
      "CS1-26-AB3K9PQ", // thừa ký tự
      "CS1-2026-AB3K9P", // năm 4 số
      "CS1-26-AB3K9O", // O — ký tự bị loại khỏi charset
      "CS1-26-AB3K91", // 1 — ký tự bị loại
      "CS1-26-ABIK9P", // I — ký tự bị loại
      "CS1-26-AB3L9P", // L — ký tự bị loại
      "-26-AB3K9P", // thiếu tiền tố (kết quả của `centerId ?? ""`)
      "",
    ]) {
      expect(loiMaHocVien(ma, "CS1"), JSON.stringify(ma)).toBe(LOI_DANG_MA_HOC_VIEN);
    }
  });

  it("[MHV-D5] mã cơ sở có dấu gạch / chữ thường được chuẩn hoá khi đối chiếu; khoảng trắng hai đầu mã được bỏ", () => {
    expect(loiMaHocVien("CS3-26-AB3K9P", "cs-3")).toBeNull();
    expect(loiMaHocVien("  CS1-26-AB3K9P  ", "CS1")).toBeNull();
  });

  it("[MHV-D6] thân mã do randomStudentCodeBody sinh ra luôn qua được cổng (tính chất)", () => {
    for (let i = 0; i < 2000; i++) {
      expect(loiMaHocVien(`CS1-26-${randomStudentCodeBody()}`, "CS1")).toBeNull();
    }
  });
});

// ── LƯỚI GHIM MÃ NGUỒN ───────────────────────────────────────────────────────────────
// Luật cần khoá: (1) chỉ MỘT lối sinh mã học viên, và nó tự đọc Center.code; (2) mọi lối NHẬN mã từ người/tệp qua cổng kiểm.
// Đường hành vi ở trên chỉ chứng minh hàm MỚI đúng; nó không thể cấm ai đó thêm lại một lối sinh/nhận mã bằng đối số sai. Neo
// vào BIỂU THỨC (tên hàm + số lần gọi), không neo vào chỗ đặt chữ `await` hay tên biến.

function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

function docMa(duongDan: string): string {
  return boChuThich(readFileSync(resolve(process.cwd(), duongDan), "utf8"));
}

function quetCay(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    const st = statSync(p);
    if (st.isDirectory()) quetCay(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten)) ra.push(p);
  }
  return ra;
}

/** Tệp (mã chạy thật, đã bỏ chú thích) khớp `mau`, kèm số lần khớp. */
/**
 * Cây mã chạy thật ĐỌC MỘT LẦN (đã bỏ chú thích) rồi dùng chung cho mọi ca. Bản đầu đọc lại cả cây ở từng lần gọi (ba lần) và hết 15 giây
 * khi `test:unit` đầy đủ chạy lúc máy đang tải nặng (06/11/2026) — xanh ở CI nhưng là bom hẹn giờ.
 */
let CAY: { tep: string; src: string }[] | null = null;
function cay(): { tep: string; src: string }[] {
  if (CAY) return CAY;
  const goc = process.cwd();
  CAY = [];
  for (const thuMuc of ["app", "lib", "components", "scripts", "prisma"]) {
    for (const tep of quetCay(resolve(goc, thuMuc))) {
      CAY.push({ tep: tep.slice(goc.length + 1).replace(/\\/g, "/"), src: boChuThich(readFileSync(tep, "utf8")) });
    }
  }
  return CAY;
}

function tepKhop(mau: RegExp): Map<string, number> {
  const kq = new Map<string, number>();
  for (const { tep, src } of cay()) {
    const n = src.match(mau)?.length ?? 0;
    if (n > 0) kq.set(tep, n);
  }
  return kq;
}

describe("[MHV-W] lưới ghim mã nguồn — một lối sinh, một cổng nhận", () => {
  it("[MHV-W1] không nơi nào gọi `genStudentCodeV2(` / `genStudentCode(` (hàm nhận-mã-cơ-sở cũ), và codegen không export chúng", () => {
    expect([...tepKhop(/\bgenStudentCodeV2\(/g).keys()]).toEqual([]);
    expect([...tepKhop(/\bgenStudentCode\(/g).keys()]).toEqual([]);
    const codegen = docMa("lib/codegen.ts");
    expect(codegen.match(/export (async )?function (genStudentCodeV2|genStudentCode|sinhMaV2)\b/g) ?? []).toHaveLength(0);
    expect(codegen.match(/export \{[^}]*\b(genStudentCodeV2|sinhMaV2)\b/g) ?? []).toHaveLength(0);
  }, 60_000);

  it("[MHV-W2] đúng BA nơi sinh mã học viên, tất cả qua genStudentCodeV2ChoCoSo — thêm nơi thứ tư phải sửa lưới này có chủ đích", () => {
    const dung = tepKhop(/\bgenStudentCodeV2ChoCoSo\(/g);
    dung.delete("lib/codegen.ts"); // chính định nghĩa
    expect([...dung.entries()].sort()).toEqual(
      [
        ["app/(admin)/admin/students/_actions.ts", 1],
        ["lib/crm/convert-lead-v2.ts", 1],
        ["lib/orders/chuyen-doi-ghi.ts", 1],
      ].sort(),
    );
  }, 60_000);

  it("[MHV-W3] mỗi nơi sinh mã truyền `centerId` (không phải mã cơ sở tự tính) và không còn tra Center.code tại chỗ", () => {
    expect(docMa("lib/orders/chuyen-doi-ghi.ts")).toMatch(/genStudentCodeV2ChoCoSo\(duLieu\.centerId,/);
    expect(docMa("lib/crm/convert-lead-v2.ts")).toMatch(/genStudentCodeV2ChoCoSo\(lead\.centerId,/);
    expect(docMa("app/(admin)/admin/students/_actions.ts")).toMatch(/genStudentCodeV2ChoCoSo\(data\.centerId,/);
    // Bản cũ tra `center.code` tại chỗ rồi tự truyền — chính kiểu việc làm này đã sinh ra mã COSONGUYENHUUTHO-…
    expect(docMa("lib/crm/convert-lead-v2.ts")).not.toMatch(/center\?\.code \?\? "CS"/);
  });

  it("[MHV-W4] mọi lối NHẬN mã từ người/tệp đi qua cổng kiểm: Sửa mã · form tạo + sửa · nhập Excel", () => {
    expect(docMa("lib/students/change-code.ts").match(/loiMaHocVienTheoCoSo\(newCode,/g)?.length).toBe(1);
    expect(docMa("app/(admin)/admin/students/_actions.ts").match(/loiMaHocVienTheoCoSo\(/g)?.length).toBe(2);
    const route = docMa("app/api/admin/import/students/route.ts");
    expect(route.match(/loiMaHocVien\(entry\.data\.studentCode, maCoSoHopLe\)/g)?.length).toBe(1);
    expect(route.match(/layMaCoSoHopLe\(\)/g)?.length).toBe(1);
  });

  it("[MHV-W5] trigger ở DB tồn tại và dùng ĐÚNG charset + dạng của TypeScript (hai nơi định nghĩa không được lệch nhau)", () => {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261126090000_student_code_dang_duy_nhat/migration.sql"), "utf8")
      .split(/\r?\n/)
      .filter((d) => !d.trim().startsWith("--"))
      .join(" ");
    expect(sql).toContain(`'^[A-Z0-9]+-[0-9]{2}-[${STUDENT_CODE_V2_CHARSET}]{6}$'`);
    expect(sql.match(/CREATE TRIGGER "Student_studentCode_dang_trg"/g)?.length).toBe(1);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF "studentCode" ON "Student"/);
    // Vế đối chiếu TIỀN TỐ với Center.code — vế mà CHECK chỉ-hình-dạng không có, và là vế đã bắt được sự cố 06/11/2026.
    expect(sql).toMatch(/tien_to <> ma_co_so/);
  });
});
