/**
 * MỌI ĐƯỜNG ĐỔI CHỦ / XOÁ LEAD ĐỀU PHẢI ĐỘNG TỚI CHUÔNG — cổng chống tái phát.
 *
 * ── VÌ SAO CẦN MỘT CỔNG QUÉT MÃ NGUỒN ────────────────────────────────────────────────────
 * Sự cố 15/09/2026 không phải một hàm viết sai. Nó là bốn đường đổi chủ lead ra đời ở bốn
 * thời điểm khác nhau, mỗi đường quên cùng một bước: thu hồi chuông của chủ cũ. Không cổng nào
 * bắt được, vì mỗi đường xét riêng đều "chạy đúng" — lead đổi chủ thật, audit ghi thật.
 *
 * Thứ duy nhất nối chúng lại là một BẤT BIẾN xuyên tệp: đổi chủ (hoặc xoá) lead thì chuông
 * phải đi theo. Không phép khẳng định hành vi nào bắt được "một hàm TƯƠNG LAI quên gọi", nên
 * chỗ này buộc phải quét mã nguồn.
 *
 * ── ⚠️ BẢN ĐẦU CỦA CHÍNH BỘ NÀY LÀ MỘT CỔNG KHÔNG BITE ───────────────────────────────────
 * Bản đầu xét theo TỆP: "tệp này có gọi `thuHoiChuongLeadCu` ở đâu đó không". Phép cấy lỗi
 * bắt ngay: gỡ lời gọi trong `reassignOpenLeads` thì `lib/lead/assign.ts` VẪN còn lời gọi ở
 * `autoAssignLead` ⇒ cổng xanh. Gỡ lời gọi trong `deleteLead` cũng xanh, vì hàm đó xoá mềm
 * chứ không ghi `assignedToId` nên rơi hẳn khỏi tầm quét.
 *
 * Tức bản đầu chỉ bắt được ca "cả tệp chưa từng biết tới chuông" — đúng ca đã vá xong, và
 * KHÔNG bắt được ca thật sự nguy hiểm: thêm một hàm mới vào tệp đã có sẵn lời gọi.
 *
 * Bản này xét theo TỪNG HÀM, và có hai luật thay vì một. Đây là lý do phải cấy lỗi trước khi
 * tin một cổng — cổng im lặng còn tệ hơn không có cổng.
 *
 * ⚠️ Luật 11 của repo xếp test grep mã nguồn là loại MONG MANH NHẤT, nên bộ này tự ràng mình:
 * neo hẹp vào hình dạng LỆNH GHI (không phải chữ `assignedToId` trần, vốn có ở `select`/
 * `where`/`oldValues`), khẳng định luôn số hàm quét được, và có ALLOWLIST kèm lý do.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const THU_MUC = [
  path.join(ROOT, "lib", "lead"),
  path.join(ROOT, "lib", "lead-handover"),
  path.join(ROOT, "lib", "crm"),
  path.join(ROOT, "app", "(admin)", "admin", "leads"),
];

/**
 * Hàm được phép ghi/xoá mà không đụng chuông — khoá dạng `đường/dẫn.ts#tenHam`.
 * Thêm dòng ở đây là một QUYẾT ĐỊNH, không phải thao tác dọn dẹp.
 */
const MIEN: Record<string, string> = {
  "lib/lead/assignment.ts#assignmentWrite":
    "chỉ DỰNG mảnh dữ liệu `{assignedToId, assignedAt}` cho nơi khác ghi — không chạm DB, " +
    "nên không có thời điểm nào để gọi chuông.",
  "lib/crm/handover.ts#assignSale":
    "mã CHẾT: grep toàn repo không nơi nào gọi (đo 15/09/2026). Nối lại đường gọi thì phải " +
    "đồng bộ chuông trước khi gỡ dòng miễn này.",
};

function quet(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ten of fs.readdirSync(dir)) {
    const p = path.join(dir, ten);
    if (fs.statSync(p).isDirectory()) quet(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

interface Khoi {
  khoa: string;
  than: string;
}

/**
 * Cắt tệp thành từng hàm cấp cao nhất.
 *
 * Thô nhưng đủ: mọi đường đổi chủ lead trong repo đều là `function` cấp cao nhất, không phải
 * arrow lồng trong object. Ca test "đếm được bao nhiêu hàm" bên dưới canh giả định đó.
 */
function catTheoHam(duong: string, src: string): Khoi[] {
  const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
  const moc: { ten: string; vt: number }[] = [];
  for (const m of src.matchAll(re)) moc.push({ ten: m[1]!, vt: m.index! });
  return moc.map((x, i) => ({
    khoa: `${duong}#${x.ten}`,
    than: src.slice(x.vt, moc[i + 1]?.vt ?? src.length),
  }));
}

/**
 * LUẬT A — khối này có ghi quyền sở hữu lead không.
 *
 * ⚠️ Phải neo vào ĐÚNG lệnh ghi bảng `Lead`, không chỉ vào chữ `assignedToId` nằm trong một
 * khối `data:`. Bản trước neo lỏng và bắt nhầm hai chỗ hoàn toàn vô hại — cả hai ghi
 * `assignedToId` của bảng KHÁC:
 *   · `ghiNhanNhapLai` → `leadAssignmentLog.create` (một dòng sổ, không đổi chủ);
 *   · `addLeadTask`    → `leadTask.create` (người phụ trách VIỆC, không phải chủ lead).
 *
 * Dương tính giả trong một cổng chống tái phát còn tệ hơn im lặng: nó dạy người ta khai bừa
 * vào ALLOWLIST, và lần sau lỗi thật đi qua đúng con đường đó.
 *
 * `\blead\.` không khớp `leadAssignmentLog.` hay `leadTask.` vì ngay sau "lead" phải là dấu chấm.
 */
function ghiQuyenSoHuu(than: string): boolean {
  for (const m of than.matchAll(/\blead\.(update|updateMany|create)\s*\(/g)) {
    const doan = than.slice(m.index!, m.index! + 600);
    // CHỈ xét phần `data:` — `assignedToId` còn xuất hiện ở `select:`/`where:` của chính lệnh
    // đó. `ghiNhanNhapLai` là ca thật: nó `lead.update` với `data: { lastInboundAt … }` nhưng
    // `select: { assignedToId: true }` — đọc chủ ra để ghi sổ, tuyệt đối không đổi chủ.
    const phanData = doan.match(/\bdata:\s*(?:assignmentWrite\s*\(|\{[^}]*)/);
    if (!phanData) continue;
    if (/assignmentWrite/.test(phanData[0])) return true;
    if (/\bassignedToId\s*:/.test(phanData[0])) return true;
  }
  return false;
}

/** LUẬT B — khối này có XOÁ MỀM một lead không. */
function xoaMemLead(than: string): boolean {
  // KHÔNG dùng cờ `/s`: `tsconfig` của repo nhắm ES2017 nên `tsc` từ chối nó (TS1501), và
  // luật 11 cũng cấm cờ đó trong test quét mã nguồn — `.` nuốt cả xuống dòng là cách nhanh
  // nhất để một bộ chọn khớp lan sang khối bên cạnh. `[^}]*` đã đủ và không cần cờ nào.
  return (
    /\blead\.update\s*\(/.test(than) &&
    /\bdata:\s*\{[^}]*\bdeletedAt\s*:\s*new Date/.test(than)
  );
}

/** Khối này có đồng bộ chuông không. */
function dongBoChuong(than: string): boolean {
  return /\b(baoSaleCoLeadMoi|thuHoiChuongLeadCu)\s*\(/.test(than);
}

const KHOI: Khoi[] = THU_MUC.flatMap((d) => quet(d)).flatMap((p) =>
  catTheoHam(path.relative(ROOT, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")),
);

const KHOI_GHI = KHOI.filter((k) => ghiQuyenSoHuu(k.than));
const KHOI_XOA = KHOI.filter((k) => xoaMemLead(k.than));

describe("[LEAD-T52] đổi chủ / xoá lead ⇒ phải đồng bộ chuông", () => {
  it("phép quét tự kiểm: cắt được hàm, và tìm thấy cả hai loại khối", () => {
    // Guard cho chính bộ chọn. Regex hỏng thì hai danh sách rỗng và MỌI ca dưới xanh giả.
    expect(KHOI.length, "không cắt được hàm nào").toBeGreaterThan(40);
    expect(KHOI_GHI.length, `khối ghi quyền sở hữu: ${KHOI_GHI.map((k) => k.khoa)}`)
      .toBeGreaterThanOrEqual(5);
    expect(KHOI_XOA.length, "phải thấy ít nhất một hàm xoá mềm lead").toBeGreaterThanOrEqual(1);
  });

  it("bốn đường đã vá 15/09 đều nằm trong tầm quét — theo ĐÚNG TÊN HÀM", () => {
    // Neo theo tên hàm chứ không theo tên tệp: bản đầu neo theo tệp và đó chính là chỗ nó
    // không bite.
    const khoa = new Set([...KHOI_GHI, ...KHOI_XOA].map((k) => k.khoa));
    for (const k of [
      "lib/lead-handover/service.ts#bulkReassignLeads",
      "lib/lead/assign.ts#reassignOpenLeads",
      "lib/lead/assign.ts#autoAssignLead",
      "app/(admin)/admin/leads/actions.ts#deleteLead",
    ]) {
      expect([...khoa], `${k} phải bị quét`).toContain(k);
    }
  });

  it("⚠️ LUẬT A — mọi hàm GHI quyền sở hữu đều đồng bộ chuông", () => {
    const thieu = KHOI_GHI.filter((k) => !(k.khoa in MIEN) && !dongBoChuong(k.than)).map(
      (k) => k.khoa,
    );
    expect(
      thieu,
      "Đổi chủ lead mà không đụng chuông ⇒ chủ cũ giữ lại một cái chuông trỏ tới lead họ " +
        "không còn giữ (sự cố 15/09/2026). Gọi `thuHoiChuongLeadCu` — và `baoSaleCoLeadMoi` " +
        "nếu đây là đường MỘT lead — hoặc khai vào MIEN kèm lý do:\n  - " +
        thieu.join("\n  - "),
    ).toEqual([]);
  });

  it("⚠️ LUẬT B — mọi hàm XOÁ MỀM lead đều thu hồi chuông", () => {
    // Luật riêng vì hàm xoá KHÔNG ghi `assignedToId` nên luật A không với tới — và đây đúng
    // là ca khớp triệu chứng được báo: "lead trong dữ liệu không còn, chuông vẫn đó".
    const thieu = KHOI_XOA.filter((k) => !(k.khoa in MIEN) && !dongBoChuong(k.than)).map(
      (k) => k.khoa,
    );
    expect(
      thieu,
      "Xoá lead mà không thu hồi chuông ⇒ người đang giữ nhận một thông báo trỏ tới lead " +
        "không còn tồn tại:\n  - " + thieu.join("\n  - "),
    ).toEqual([]);
  });

  it("⚠️ cờ `imLangChuong` KHÔNG được che luôn phần THU HỒI", () => {
    // Cờ này sinh ra 15/09 cho đường nhập hàng loạt: tắt chuông "bạn có lead mới" để nơi gọi
    // gộp thành một tin. Nó CHỈ được tắt nửa BÁO.
    //
    // Nếu ai đó kéo `thuHoiChuongLeadCu` vào trong khối `if (!input.imLangChuong)` — một
    // thao tác gom dòng trông rất hợp lý khi đọc lướt — thì mỗi lượt nhập Excel lại để lại
    // đúng những cái chuông mồ côi mà bản vá 15/09 vừa dẹp, và KHÔNG ca hành vi nào đỏ:
    // hàm `chiaChoLead` cần DB thật nên không mock gọi thẳng được.
    const src = KHOI.find((k) => k.khoa === "lib/lead/assign-lead.ts#chiaChoLead")?.than;
    expect(src, "không cắt được `chiaChoLead` — bộ chọn hỏng").toBeTruthy();

    const mo = src!.indexOf("if (!input.imLangChuong)");
    expect(mo, "không còn khối `if (!input.imLangChuong)` — cờ đã đổi hình dạng").toBeGreaterThan(0);

    // Cắt đúng thân khối bằng đếm ngoặc, không đoán theo số dòng.
    const dau = src!.indexOf("{", mo);
    let sau = 0;
    let cuoi = src!.length;
    for (let i = dau; i < src!.length; i++) {
      if (src![i] === "{") sau++;
      else if (src![i] === "}") {
        sau--;
        if (sau === 0) {
          cuoi = i;
          break;
        }
      }
    }
    const trongKhoi = src!.slice(dau, cuoi + 1);

    expect(
      /thuHoiChuongLeadCu/.test(trongKhoi),
      "`thuHoiChuongLeadCu` đang nằm TRONG khối im chuông. Thu hồi chuông chủ cũ là phép sửa " +
        "đúng trong MỌI ca — đưa nó ra ngoài khối `if`.",
    ).toBe(false);
    expect(
      /thuHoiChuongLeadCu/.test(src!),
      "`chiaChoLead` phải vẫn còn gọi `thuHoiChuongLeadCu` ở đâu đó",
    ).toBe(true);
  });

  it("⚠️ LUẬT C — ba đường chia HÀNG LOẠT đều báo cho NGƯỜI NHẬN", () => {
    // Chốt 15/09/2026 đợt hai. Trước đó bàn giao và chia-lại-khi-sale-nghỉ im hoàn toàn với
    // người nhận: họ được giao lead mà không ai đánh động, phải tự mở danh sách mới biết.
    //
    // Luật A ở trên KHÔNG với tới đây — nó chỉ đòi "có đụng chuông", mà thu hồi chuông chủ cũ
    // đã thoả điều đó. Tức cả hai đường này từng XANH ở luật A trong khi vẫn câm với người
    // nhận. Đây là lý do phải có luật riêng thay vì nới luật A.
    //
    // Neo theo TÊN HÀM và liệt kê đích danh: đây là một quyết định vận hành có ngày tháng,
    // không phải một quy tắc suy ra được từ hình dạng mã.
    const DUONG_HANG_LOAT = [
      "lib/lead-handover/service.ts#bulkReassignLeads",
      "lib/lead/assign.ts#reassignOpenLeads",
    ];
    const con = new Map(KHOI.map((k) => [k.khoa, k.than] as const));
    const thieu = DUONG_HANG_LOAT.filter((k) => {
      const than = con.get(k);
      // Không cắt được hàm cũng tính là thiếu — im lặng vì bộ chọn hỏng là xanh giả.
      return than === undefined || !/\bbaoLoLeadMoi\s*\(/.test(than);
    });
    expect(
      thieu,
      "Đường chia hàng loạt phải gọi `baoLoLeadMoi` — nó tự gộp thành MỘT tin mỗi người, nên " +
        "không có cớ 'sợ bão push' nữa:\n  - " + thieu.join("\n  - "),
    ).toEqual([]);
  });

  it("đường nhập danh sách cũng đi qua `baoLoLeadMoi`", () => {
    // Route handler nằm ngoài THU_MUC nên đọc thẳng tệp. Đọc bằng đường dẫn thật để tệp bị
    // dời chỗ thì ca này đỏ chứ không âm thầm bỏ qua.
    const duong = path.join(ROOT, "app", "api", "admin", "import", "leads", "route.ts");
    expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
    expect(/\bbaoLoLeadMoi\s*\(/.test(fs.readFileSync(duong, "utf8"))).toBe(true);
  });

  it("danh sách MIỄN không có dòng chết", () => {
    const con = new Map(KHOI.map((k) => [k.khoa, k.than] as const));
    const chet = Object.keys(MIEN).filter((k) => {
      const than = con.get(k);
      return than === undefined || dongBoChuong(than);
    });
    expect(chet, `Dòng MIỄN không còn cần thiết:\n  - ${chet.join("\n  - ")}`).toEqual([]);
  });

  it("mỗi dòng MIỄN đều có lý do viết ra", () => {
    for (const [k, lyDo] of Object.entries(MIEN)) {
      expect(lyDo.trim().length, `${k} thiếu lý do`).toBeGreaterThan(30);
    }
  });
});
