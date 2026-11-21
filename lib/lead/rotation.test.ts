// Đợt D (kế hoạch Site Sale) — test viết TRƯỚC hiện thực (luật cứng #5).
//
// Chủ dự án chốt Q7 (21/08/2026), nguyên văn:
//
//   "đều theo khối lượng lead, tuyệt đối không được sai, làm đúng như tôi mô tả
//    qua ngày không reset mà vẫn luân phiên, không phân biệt người nhiều việc
//    người ít việc, cứ có lead đổ vào là chia đều cho tất cả các sale"
//
// Ba chữ quan trọng nhất trong câu đó, và cái mỗi chữ loại bỏ:
//   · "luân phiên"        → đơn vị công bằng là SỐ LƯỢT, không phải số lead đang ôm.
//   · "qua ngày không reset" → bộ đếm PHẢI bền, không có mốc nào về 0.
//   · "không phân biệt người nhiều việc người ít việc" → CẤM cân tải.
//
// ⚠️ Quyết định này ĐẢO đề xuất của chính bản đặc tả (plan/15 Q2 đề xuất giữ cân
// tải) và thay hành vi đang chạy prod: `pickRoundRobin` hôm nay chọn người có ÍT
// LEAD MỞ NHẤT — tức là thưởng người đóng lead nhanh, kể cả đóng bằng cách bỏ.
// Chủ dự án đã được trình bày đánh đổi đó và giữ nguyên lựa chọn.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  pickFairTurn,
  planFairTurns,
  rotationBoardScope,
  seedTurnsForNewcomer,
  type RotationCandidate,
} from "./rotation";

const c = (id: string, turns: number, lastTurnAt: Date | null = null): RotationCandidate => ({
  id,
  turns,
  lastTurnAt,
});

describe("[Đợt D] pickFairTurn — công bằng theo SỐ LƯỢT", () => {
  it("chọn người ÍT lượt nhất", () => {
    expect(pickFairTurn([c("a", 5), c("b", 3), c("c", 7)])).toBe("b");
  });

  it("KHÔNG có ứng viên → null (không được bịa ra người)", () => {
    expect(pickFairTurn([])).toBeNull();
  });

  it("bằng lượt → ai tới lượt LÂU NHẤT đi trước", () => {
    const r = pickFairTurn([
      c("a", 4, new Date("2026-08-20T10:00:00Z")),
      c("b", 4, new Date("2026-08-18T10:00:00Z")),
      c("c", 4, new Date("2026-08-19T10:00:00Z")),
    ]);
    expect(r).toBe("b");
  });

  it("người CHƯA từng tới lượt đứng trước người đã từng (cùng số lượt)", () => {
    expect(pickFairTurn([c("a", 4, new Date("2026-08-01T00:00:00Z")), c("b", 4, null)])).toBe("b");
  });

  it("bằng cả lượt lẫn mốc → xếp theo id, để kết quả TÁI LẬP ĐƯỢC", () => {
    // Không dùng random: chia lead mà không giải thích được thì không ai tin.
    const t = new Date("2026-08-20T10:00:00Z");
    expect(pickFairTurn([c("z", 2, t), c("a", 2, t), c("m", 2, t)])).toBe("a");
  });

  it("KHÔNG nhìn tải: người ôm 100 lead vẫn tới lượt nếu ít lượt hơn", () => {
    // Đây chính là câu "không phân biệt người nhiều việc người ít việc".
    // Hàm thuần này CỐ Ý không nhận tham số nào về số lead đang mở.
    const r = pickFairTurn([c("dang-om-100-lead", 1), c("ranh-roi", 2)]);
    expect(r).toBe("dang-om-100-lead");
  });
});

describe("[Đợt D][SS-LR-13a] 1.000 lead / 3 sale → lệch lượt ≤ 1", () => {
  it("chia đều tuyệt đối, không phụ thuộc thứ tự tới", () => {
    const turns = new Map([["a", 0], ["b", 0], ["c", 0]]);
    const last = new Map<string, Date | null>([["a", null], ["b", null], ["c", null]]);
    for (let i = 0; i < 1000; i++) {
      const cands = [...turns.keys()].map((id) => c(id, turns.get(id)!, last.get(id)!));
      const picked = pickFairTurn(cands)!;
      turns.set(picked, turns.get(picked)! + 1);
      last.set(picked, new Date(2026, 7, 1, 0, i)); // mốc tăng dần, không dùng Date.now()
    }
    const vals = [...turns.values()];
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
    expect(vals.reduce((s, v) => s + v, 0)).toBe(1000);
  });

  it("QUA NGÀY KHÔNG RESET — bộ đếm chỉ tăng, ngày mới vẫn tiếp vòng cũ", () => {
    // Ngày 1 lệch sẵn 1 lượt (số lead lẻ). Ngày 2 phải BÙ cho người thiệt,
    // chứ không phải bắt đầu lại từ 0 rồi lệch tiếp về cùng một người.
    const turns = new Map([["a", 2], ["b", 1]]); // hết ngày 1: a hơn b 1 lượt
    const last = new Map<string, Date | null>([
      ["a", new Date("2026-08-20T17:00:00Z")],
      ["b", new Date("2026-08-20T16:00:00Z")],
    ]);
    const picked = pickFairTurn([...turns.keys()].map((id) => c(id, turns.get(id)!, last.get(id)!)))!;
    expect(picked).toBe("b"); // lead đầu tiên của ngày 2 về tay người thiệt
    turns.set(picked, turns.get(picked)! + 1);
    expect([...turns.values()]).toEqual([2, 2]);
  });

  it("5 sale / 97 lead (số lẻ) — lệch đúng 1, không ai bị bỏ đói", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const turns = new Map(ids.map((id) => [id, 0]));
    const last = new Map<string, Date | null>(ids.map((id) => [id, null]));
    for (let i = 0; i < 97; i++) {
      const picked = pickFairTurn(ids.map((id) => c(id, turns.get(id)!, last.get(id)!)))!;
      turns.set(picked, turns.get(picked)! + 1);
      last.set(picked, new Date(2026, 7, 1, 0, i));
    }
    const vals = [...turns.values()];
    expect(Math.max(...vals) - Math.min(...vals)).toBe(1);
    expect(Math.min(...vals)).toBeGreaterThan(0);
  });
});

describe("[Đợt D] seedTurnsForNewcomer — người mới vào vòng ở đâu", () => {
  it("vào NGANG người ít lượt nhất, KHÔNG phải từ 0", () => {
    // Nếu để 0 thì người mới nhận liên tiếp cho tới khi đuổi kịp — với vòng đã
    // chạy vài trăm lượt là hàng trăm lead dồn vào người chưa quen việc. "Luân
    // phiên" nghĩa là nhập vòng, không phải được trả nợ quá khứ.
    expect(seedTurnsForNewcomer([c("a", 40), c("b", 37), c("c", 41)])).toBe(37);
  });

  it("vòng còn trống → bắt đầu từ 0", () => {
    expect(seedTurnsForNewcomer([])).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LỖI BẮT ĐƯỢC KHI CHẠY THẬT TRÊN POSTGRES 22/08/2026 — sổ lượt bị THỔI PHỒNG
// ═══════════════════════════════════════════════════════════════════════════
//
// 4/5 ca e2e đỏ. Bệnh: khi vòng đang LẤP ĐẦY, `seedTurnsForNewcomer` lấy min
// trên *những dòng đã có*, mà lúc đó mới có đúng một dòng (người vừa nhận, =1).
// ⇒ người thứ hai vào vòng bị ghi khởi điểm 1, nhận 1 lead thành 2. Sổ nói người
// đó đã tới lượt 2 lần trong khi thực tế 1. 6 lead chia ra thành 8 lượt.
//
// Vì sao test thuần cũ KHÔNG bắt được: nó gọi `pickFairTurn` trên một danh sách
// ứng viên ĐÃ ĐẦY ĐỦ, tức đã giả định sẵn cái mà tầng DB phải tự dựng. Đó là
// khoảng trống giữa "toán đúng" và "ghi sổ đúng".
//
// Cách vá: tầng DB tạo dòng cho MỌI ứng viên NGAY LẦN ĐẦU thấy họ, ở đúng khởi
// điểm của lúc đó, rồi mới chọn. Vòng trống ⇒ mọi người khởi điểm 0.
describe("[Đợt D] khởi điểm phải chốt MỘT LẦN lúc vào vòng, không tính lại mỗi lượt", () => {
  it("vòng trống, 3 người cùng vào → tất cả khởi điểm 0", () => {
    // Đây là ca đã sai trên DB thật: min-của-dòng-đã-có cho ra 1, không phải 0.
    expect(seedTurnsForNewcomer([])).toBe(0);
  });

  it("mô phỏng đúng cách tầng DB làm: tạo dòng trước, chọn sau → 6 lead = 6 lượt", () => {
    const ids = ["a", "b", "c"];
    const so = new Map<string, { turns: number; lastTurnAt: Date | null }>();
    for (let i = 0; i < 6; i++) {
      // Bước 1 — mọi ứng viên chưa có dòng thì tạo, ở khởi điểm hiện tại.
      const daCo = ids.filter((id) => so.has(id)).map((id) => c(id, so.get(id)!.turns));
      const khoiDiem = seedTurnsForNewcomer(daCo);
      for (const id of ids) if (!so.has(id)) so.set(id, { turns: khoiDiem, lastTurnAt: null });
      // Bước 2 — chọn trên danh sách đã đầy đủ.
      const picked = pickFairTurn(ids.map((id) => c(id, so.get(id)!.turns, so.get(id)!.lastTurnAt)))!;
      so.set(picked, { turns: so.get(picked)!.turns + 1, lastTurnAt: new Date(2026, 7, 1, 0, i) });
    }
    const vals = [...so.values()].map((v) => v.turns);
    expect(vals.reduce((s, v) => s + v, 0), "6 lead phải sinh đúng 6 lượt").toBe(6);
    expect(vals.sort()).toEqual([2, 2, 2]);
  });
});

describe("[Đợt D] planFairTurns — chia MỘT LÔ lead (sale nghỉ việc)", () => {
  it("lô 6 lead / 3 người → mỗi người đúng 2, thứ tự luân phiên", () => {
    const plan = planFairTurns([c("a", 0), c("b", 0), c("c", 0)], 6);
    expect(plan).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  it("lô nối tiếp sổ lượt cũ, không bắt đầu lại", () => {
    // a đang hơn 2 lượt ⇒ lô 4 lead phải bù cho b trước.
    expect(planFairTurns([c("a", 5), c("b", 3)], 4)).toEqual(["b", "b", "a", "b"]);
  });

  it("lô 0 lead → mảng rỗng; không ứng viên → mảng rỗng", () => {
    expect(planFairTurns([c("a", 0)], 0)).toEqual([]);
    expect(planFairTurns([], 5)).toEqual([]);
  });

  it("một người duy nhất → nhận hết, không kẹt vòng lặp", () => {
    expect(planFairTurns([c("a", 9)], 3)).toEqual(["a", "a", "a"]);
  });

  it("tổng lượt sau lô = tổng trước + số lead (không mất, không đẻ thêm)", () => {
    const before = [c("a", 4), c("b", 7), c("c", 1)];
    const plan = planFairTurns(before, 25);
    expect(plan).toHaveLength(25);
    const dem = new Map<string, number>();
    for (const id of plan) dem.set(id, (dem.get(id) ?? 0) + 1);
    const sau = before.map((x) => x.turns + (dem.get(x.id) ?? 0));
    expect(Math.max(...sau) - Math.min(...sau)).toBeLessThanOrEqual(1);
  });
});

describe("[Đợt D] chốt chặn nguồn — không còn đường chia nào bỏ qua sổ lượt", () => {
  // Bài học 21/08: 69% lead prod không đi qua vòng chia. Nếu còn một đường chia
  // tự động nào dùng cách cũ thì "chia đều tuyệt đối" chỉ đúng trên giấy. Test
  // này quét NGUỒN, nên nó bắt được cả đường mới ai đó thêm sau này.
  it("auto-assign.ts và assign.ts không còn fallback chia xuyên cơ sở", () => {
    for (const f of ["lib/lead/auto-assign.ts", "lib/lead/assign.ts"]) {
      const src = fs.readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      expect(src, `${f} còn gọi lấy sale TOÀN HỆ THỐNG làm fallback`).not.toMatch(
        /get(SaleStats|SalesLoad)\(\s*null\s*\)/,
      );
    }
  });

  it("mọi đường chia tự động đều gọi sổ lượt", () => {
    for (const f of ["lib/lead/auto-assign.ts", "lib/lead/assign.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, `${f} không import lib/lead/rotation`).toMatch(/from "@\/lib\/lead\/rotation"/);
    }
  });
});

describe("[Đợt D][SS-LR-06] khoá chống hai lead cùng tiêu một lượt", () => {
  // Không có Postgres ở máy này (Windows không fork nổi backend — "could not
  // reserve shared memory region", 22/08) nên phần CHẠY THẬT nằm ở
  // tests/e2e/crm/lead-rotation-fair.spec.ts. Ba ca dưới quét NGUỒN, và chúng bắt
  // đúng ba cách mà kiểu khoá này đã hỏng thật trong repo.
  const doc = () => fs.readFileSync("lib/lead/rotation.ts", "utf8");

  it("dùng $executeRaw cho pg_advisory_xact_lock, KHÔNG dùng $queryRaw", () => {
    // Prisma không giải mã nổi kiểu `void` → "Failed to deserialize column of
    // type 'void'". Đúng lỗi này đã giết mọi lần refresh token Zalo trên prod
    // 31/07. Cùng bẫy, nên khoá lại bằng test chứ không bằng trí nhớ.
    const src = doc();
    expect(src).toMatch(/\$executeRaw`SELECT pg_advisory_xact_lock/);
    expect(src).not.toMatch(/\$queryRaw`SELECT pg_advisory_xact_lock/);
  });

  it("ĐỌC SỔ SAU khi giành khoá — đọc trước thì khoá vô nghĩa", () => {
    const src = doc();
    const viTriKhoa = src.indexOf("pg_advisory_xact_lock");
    const viTriDoc = src.indexOf("leadRotationTurn.findMany");
    expect(viTriKhoa).toBeGreaterThan(-1);
    expect(viTriDoc).toBeGreaterThan(viTriKhoa);
  });

  it("chọn NGƯỜI và ghi lượt nằm CÙNG một transaction", () => {
    // Tách ra hai transaction thì giữa hai cái đó có một khe, và khe đó đủ để
    // hai lead cùng chọn một người — đúng lỗi mà luồng cũ đang mắc.
    const src = doc();
    const tx = src.indexOf("db.$transaction");
    expect(tx).toBeGreaterThan(-1);
    // Ba bước PHẢI nằm sau mốc mở transaction: ghi danh người mới, chọn, ghi lượt.
    // Ghi danh mà rơi ra ngoài thì hai lượt đồng thời tạo hai dòng cho cùng một
    // người và một trong hai đổ vì ràng buộc duy nhất.
    expect(src.indexOf("leadRotationTurn.create")).toBeGreaterThan(tx);
    expect(src.indexOf("planFairTurns(candidates, count)")).toBeGreaterThan(tx);
    expect(src.indexOf("leadRotationTurn.update")).toBeGreaterThan(tx);
  });
});

describe("[S-5] rotationBoardScope — sổ lượt mở cho tổ Sale nhưng KHÔNG mở ra ngoài cơ sở", () => {
  // Màn kiểm chứng sinh ra để dập tin đồn thiên vị, mà người cần thuyết phục
  // nhất — chính tổ Sale — lại là người duy nhất không mở được (gate cũ:
  // `leads:view-all`, vai SALES_CSM không có). Mở cửa cho họ mà không mở luôn
  // sổ của cơ sở khác thì phạm vi phải tính bằng MỘT hàm thuần, test được.
  it("Sale gắn cơ sở → CHỈ cơ sở đó (không phải toàn hệ)", () => {
    expect(rotationBoardScope({ superAdmin: false, xemToanBo: false, centerId: "cs1" })).toEqual({
      kind: "one-center",
      centerId: "cs1",
    });
  });

  it("Sale KHÔNG gắn cơ sở nào → KHÔNG cơ sở nào (đóng, không mở toang)", () => {
    // Hồ sơ hỏng (thiếu centerId) phải ra bảng rỗng, không được rơi vào nhánh
    // "không lọc" — đó đúng là cách một màn chỉ-đọc biến thành lỗ xem chéo.
    expect(rotationBoardScope({ superAdmin: false, xemToanBo: false, centerId: null })).toEqual({
      kind: "none",
    });
  });

  it("Quản lý cơ sở giữ nguyên hành vi cũ: gắn cơ sở → chỉ cơ sở đó", () => {
    expect(rotationBoardScope({ superAdmin: false, xemToanBo: true, centerId: "cs2" })).toEqual({
      kind: "one-center",
      centerId: "cs2",
    });
  });

  it("người Hội sở (xem toàn bộ, không gắn cơ sở) → toàn hệ", () => {
    expect(rotationBoardScope({ superAdmin: false, xemToanBo: true, centerId: null })).toEqual({
      kind: "all",
    });
  });

  it("quản trị tối cao → toàn hệ, kể cả khi hồ sơ có gắn một cơ sở", () => {
    expect(rotationBoardScope({ superAdmin: true, xemToanBo: true, centerId: "cs1" })).toEqual({
      kind: "all",
    });
  });
});
