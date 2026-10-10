// Ca [CTP-*] — TRONG CALLBACK `$transaction`, TỪ CHỐI PHẢI ĐỨNG TRƯỚC PHÉP GHI ĐẦU TIÊN.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT (chủ dự án chốt 17/09/2026, xem CLAUDE.md)
//
//   Trong callback của `prisma.$transaction`, **`return` KHÔNG rollback** — chỉ `throw` mới
//   rollback. Nên mọi cổng từ chối phải đứng TRƯỚC phép ghi đầu tiên; nếu buộc phải từ chối
//   sau khi đã ghi, dùng `throw` (đường gọi bắt và dịch thành thông báo).
//
// ⚠️ ĐÂY LÀ LUẬT CÓ GIÁ, KHÔNG PHẢI LUẬT CHO ĐẸP. Đo 17/09: cổng "đã xuất phiếu thu" trong
// `goGanTheoCon` nằm SAU `deleteMany`, nên nó trả `{ ok: false }` cho người dùng TRONG KHI phân
// bổ đã bị xoá và commit. Tức chính cái cổng sinh ra để chặn gỡ nửa vời lại tạo ra một lượt gỡ
// nửa vời. Ca `[GDC-c2]` bắt được, nhưng chỉ vì tôi tình cờ viết đúng ca đó — lưới dưới đây là
// thứ bắt được ca TIẾP THEO mà chưa ai nghĩ tới.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHẠM VI VÀ GIỚI HẠN — đọc trước khi tin
//
// Lưới soi VĂN BẢN mã (luật 11), nên nó hẹp có chủ đích: chỉ bắt hình dạng từ chối mà repo
// thật sự dùng (`return { ok: false`, `return fail(`, `return { loi:`). Nó KHÔNG hiểu ngữ nghĩa,
// nên hai thứ dưới đây được khai NGOẠI LỆ tường minh thay vì để nó đoán:
//
//   · `if (upd.count === 0) return { stale: … }` — phép ghi ngay trên nó là một `updateMany`
//     CÓ ĐIỀU KIỆN đã đổi 0 dòng. Commit một thứ không đổi gì thì vô hại, và đây là mẫu
//     chống-đua chuẩn của repo (FIX-H9). Ngoại lệ khai theo TỆP + hình dạng, và ca
//     `[CTP-02]` kiểm rằng hình dạng ấy còn đúng.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

/** Trần cho ca quét — cùng lý do với `feature.test.ts`: đọc hàng trăm tệp dưới tải. */
const TRAN_QUET_MS = 30_000;

const THU_MUC = [
  "lib/finance",
  "lib/payments",
  "app/(admin)/admin/orders",
  "app/(admin)/admin/payments",
  "app/(admin)/admin/bien-dong-so-du",
  "app/api/public/webhook",
];

/** Phép GHI vào DB bên trong transaction. */
const GHI =
  /\btx\.\w+\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\btx\.\$executeRaw|\b(?:recomputeRequestStatuses|materializeInstallmentRequests|revertInstallmentRequests|ensureOrderPaymentRecorded|issueReceipt|maybeAdvanceLeadToRegistered|xacNhanKhoanTrongTx|thucHienKeHoachGan|ganGhiDanhChoKhoanCuaDon)\s*\(/;

/** Hình dạng TỪ CHỐI mà repo dùng. Hẹp có chủ đích — xem chú thích đầu tệp. */
const TU_CHOI = /\breturn\s*(?:\{\s*(?:ok:\s*false|loi:)|fail\()/;

/**
 * Mẫu chống-đua HỢP LỆ: `updateMany` có điều kiện đổi 0 dòng ⇒ `return`.
 * Commit một phép ghi không đổi dòng nào là vô hại.
 */
const NGOAI_LE_DUA = /if\s*\(\s*\w+\.count\s*===\s*0\s*\)\s*return/;

function bocChuThich(v: string): string {
  return v
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Cắt thân callback bằng cách đếm ngoặc nhọn từ `{` đầu tiên sau mốc. */
function thanCallback(src: string, tu: number): { dau: number; cuoi: number } | null {
  const mo = src.indexOf("{", tu);
  if (mo === -1) return null;
  let sau = 0;
  for (let i = mo; i < src.length; i += 1) {
    if (src[i] === "{") sau += 1;
    else if (src[i] === "}") {
      sau -= 1;
      if (sau === 0) return { dau: mo, cuoi: i };
    }
  }
  return null;
}

type Callback = { tep: string; dong: number; than: string };

function moiCallback(): Callback[] {
  // ⚠️ `--others --exclude-standard` KHÔNG phải để cho đủ cờ — thiếu nó là một LỖ THẬT, đo
  // được 20/09/2026.
  //
  // `git ls-files` trần chỉ liệt kê tệp ĐÃ TRACK. Một tệp ghi tiền VỪA ĐƯỢC TẠO thì còn
  // untracked cho tới lúc `git add`, nên lưới này KHÔNG NHÌN THẤY NÓ — và `pnpm test:unit` ở
  // máy xanh suốt quãng viết mã. Nó chỉ đỏ sau khi commit, tức trên CI, tức sau khi người
  // viết đã tin rằng mình xanh.
  //
  // Đã xảy ra đúng như vậy với `lib/finance/phieu-gop.ts` (PHIÊN C): cổng "đã có phiếu gộp
  // đang mở" trả `{ ok: false }` từ trong `catch` của một phép `create` — đúng hình dạng lưới
  // này sinh ra để chặn — mà ba lượt `test:unit` liên tiếp ở máy vẫn báo xanh.
  //
  // `--exclude-standard` giữ cho `--others` không quét `node_modules`/`.next`: nó tôn trọng
  // `.gitignore`. Và phạm vi vốn đã bị `THU_MUC` bó lại.
  const tep = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...THU_MUC],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split(/\r?\n/)
    .filter((d) => /\.tsx?$/.test(d))
    .filter((d) => !/\.(test|spec)\.tsx?$/.test(d));

  const ra: Callback[] = [];
  for (const f of tep) {
    const src = bocChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
    const re = /(?:\$transaction\(|ghiTienChoDon\()/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const t = thanCallback(src, m.index);
      if (!t) continue;
      ra.push({
        tep: f,
        dong: src.slice(0, m.index).split("\n").length,
        than: src.slice(t.dau, t.cuoi + 1),
      });
    }
  }
  return ra;
}

const CALLBACK = moiCallback();

describe("[CTP-01] từ chối phải đứng TRƯỚC phép ghi đầu tiên", () => {
  it("quét ra đủ callback — lưới canh lưới", { timeout: TRAN_QUET_MS }, () => {
    // Phép quét trả rỗng thì ca dưới XANH VĨNH VIỄN mà chẳng soi gì. Ngưỡng đặt thấp hơn thực
    // tế (đo 17/09: 16 callback) để nó không vỡ khi repo co lại.
    expect(CALLBACK.length, "không quét được callback nào — `git ls-files` hỏng?").toBeGreaterThan(
      8,
    );
    // Và phải thấy đúng những tệp ta biết chắc có transaction.
    const tep = new Set(CALLBACK.map((c) => c.tep));
    for (const f of [
      "lib/finance/ghi-tien-don.ts",
      "lib/finance/payment.ts",
      "lib/payments/payos-ingest.ts",
    ]) {
      expect(tep, f).toContain(f);
    }
  });

  it("không callback nào TỪ CHỐI sau khi đã ghi", { timeout: TRAN_QUET_MS }, () => {
    const viPham: string[] = [];
    for (const c of CALLBACK) {
      const ghi = GHI.exec(c.than);
      if (!ghi) continue; // callback chỉ đọc — không có gì để rollback
      const sauGhi = c.than.slice(ghi.index + ghi[0].length);

      const tc = TU_CHOI.exec(sauGhi);
      if (!tc) continue;

      // Mẫu chống-đua hợp lệ: phép ghi ngay trên là `updateMany` đổi 0 dòng.
      const truocTuChoi = sauGhi.slice(Math.max(0, tc.index - 200), tc.index + 40);
      if (NGOAI_LE_DUA.test(truocTuChoi)) continue;

      const dongTuongDoi = c.than.slice(0, ghi.index + ghi[0].length + tc.index).split("\n").length;
      viPham.push(`${c.tep}:${c.dong + dongTuongDoi - 1}`);
    }

    expect(
      viPham,
      "Từ chối SAU phép ghi trong callback `$transaction` — `return` KHÔNG rollback.\n" +
        "Dời cổng lên trước phép ghi đầu tiên, hoặc đổi sang `throw`:\n" +
        viPham.join("\n"),
    ).toEqual([]);
  });
});

describe("[CTP-02] mẫu chống-đua được tha vẫn đúng hình dạng", () => {
  it("`if (x.count === 0) return` luôn đi NGAY SAU một `updateMany` có điều kiện", () => {
    // Ngoại lệ chết là ngoại lệ nguy hiểm: nếu ai đó đổi mẫu này thành `update` (ném khi không
    // thấy) hoặc bỏ điều kiện trong `where`, phép tha ở trên hoá ra tha một phép ghi THẬT.
    let daThay = 0;
    for (const c of CALLBACK) {
      const re = new RegExp(NGOAI_LE_DUA.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(c.than)) !== null) {
        daThay += 1;
        const truoc = c.than.slice(Math.max(0, m.index - 400), m.index);
        expect(truoc, `${c.tep}:${c.dong} — mẫu chống-đua phải bám một updateMany`).toMatch(
          /\btx\.\w+\.updateMany\(\{/,
        );
        expect(truoc, `${c.tep}:${c.dong} — updateMany phải CÓ ĐIỀU KIỆN trong where`).toMatch(
          /where:\s*\{/,
        );
      }
    }
    // Đo 17/09: 4 chỗ (payment.ts ×3, orders/_actions.ts ×1). Không ghim con số cứng — ghim
    // rằng mẫu này CÓ TỒN TẠI, kẻo phép tha ở [CTP-01] trở thành nhánh chết.
    expect(daThay, "không còn chỗ nào dùng mẫu chống-đua — gỡ ngoại lệ ở [CTP-01]").toBeGreaterThan(
      0,
    );
  });
});
