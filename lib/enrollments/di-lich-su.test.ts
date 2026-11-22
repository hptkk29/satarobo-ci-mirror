import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  lapKeHoachDiLichSu,
  type BuoiDich,
  type DiemDanhNguon,
  type NhanXetNguon,
} from "@/lib/enrollments/ke-hoach-di-lich-su";

// =============================================================================
// ĐIỂM DANH + NHẬN XÉT ĐI THEO HỌC VIÊN KHI CHUYỂN LỚP [chủ dự án, 06/11/2026]
// Luật + lý do: lib/enrollments/ke-hoach-di-lich-su.ts. Mỗi ca dưới đây khoá đúng MỘT luật; thời gian TRUYỀN VÀO (luật 19 — không đọc đồng hồ).
// =============================================================================

const D = (s: string) => new Date(`${s}T03:00:00.000Z`);
const NOW = D("2026-11-06");

/** Lớp mới: bài L1..L4, L1-L3 đã diễn ra, L4 còn ở tương lai. */
const BUOI_DICH: BuoiDich[] = [
  { id: "b1", lessonId: "L1", date: D("2026-10-01"), status: "COMPLETED" },
  { id: "b2", lessonId: "L2", date: D("2026-10-08"), status: "COMPLETED" },
  { id: "b3", lessonId: "L3", date: D("2026-10-15"), status: "COMPLETED" },
  { id: "b4", lessonId: "L4", date: D("2026-11-20"), status: "SCHEDULED" },
];

const dd = (id: string, lessonId: string | null, status = "PRESENT", ngay = "2026-09-01"): DiemDanhNguon => ({
  id,
  sessionId: `s-${id}`,
  lessonId,
  ngayBuoi: D(ngay),
  status,
});
const nx = (id: string, lessonId: string | null, createdAt = "2026-09-01"): NhanXetNguon => ({
  id,
  sessionId: `s-${id}`,
  lessonId,
  createdAt: D(createdAt),
});

function lap(p: {
  diemDanh?: DiemDanhNguon[];
  nhanXet?: NhanXetNguon[];
  buoi?: BuoiDich[];
  ddCoSan?: string[];
  nxCoSan?: [string, { id: string; createdAt: Date }][];
  now?: Date;
}) {
  return lapKeHoachDiLichSu({
    buoiDich: p.buoi ?? BUOI_DICH,
    diemDanhNguon: p.diemDanh ?? [],
    nhanXetNguon: p.nhanXet ?? [],
    diemDanhDichCoSan: new Set(p.ddCoSan ?? []),
    nhanXetDichCoSan: new Map(p.nxCoSan ?? []),
    now: p.now ?? NOW,
  });
}

describe("[LSH] kế hoạch chuyển điểm danh + nhận xét sang lớp mới", () => {
  it("[LSH-01] ghép theo BÀI HỌC: buổi cũ của bài L1/L2 → buổi cùng bài ở lớp mới", () => {
    const k = lap({ diemDanh: [dd("a1", "L1"), dd("a2", "L2")], nhanXet: [nx("f1", "L1"), nx("f2", "L2")] });
    expect(k.diemDanhTao).toEqual([
      { nguonId: "a1", buoiDichId: "b1" },
      { nguonId: "a2", buoiDichId: "b2" },
    ]);
    expect(k.nhanXetTao).toEqual([
      { nguonId: "f1", buoiDichId: "b1" },
      { nguonId: "f2", buoiDichId: "b2" },
    ]);
    expect(k.nhanXetThay).toEqual([]);
  });

  it("[LSH-02] buổi lớp mới CHƯA DIỄN RA thì KHÔNG chuyển (điểm danh khống); biên: đúng giờ `now` tính là đã diễn ra", () => {
    const k = lap({ diemDanh: [dd("a4", "L4")], nhanXet: [nx("f4", "L4")] });
    expect(k.diemDanhTao).toEqual([]);
    expect(k.nhanXetTao).toEqual([]);
    expect(k.boQua.buoiDichChuaDienRa).toBe(2);
    const bien = lap({ diemDanh: [dd("a4", "L4")], now: D("2026-11-20") });
    expect(bien.diemDanhTao).toEqual([{ nguonId: "a4", buoiDichId: "b4" }]);
  });

  it("[LSH-03] điểm danh: chỉ CÓ MẶT / TRỄ đi theo; VẮNG (mọi loại) KHÔNG đi — vắng đi kèm dòng cần bù ở lớp cũ", () => {
    const k = lap({
      diemDanh: [dd("p", "L1", "PRESENT"), dd("l", "L2", "LATE"), dd("v", "L3", "ABSENT"), dd("e", "L3", "EXCUSED")],
    });
    expect(k.diemDanhTao.map((t) => t.nguonId)).toEqual(["p", "l"]);
    expect(k.boQua.diemDanhVang).toBe(2);
  });

  it("[LSH-04] lớp mới ĐÃ có dòng điểm danh cho buổi đó ⇒ GIỮ dòng của lớp mới, không tạo", () => {
    const k = lap({ diemDanh: [dd("a1", "L1"), dd("a2", "L2")], ddCoSan: ["b1"] });
    expect(k.diemDanhTao).toEqual([{ nguonId: "a2", buoiDichId: "b2" }]);
    expect(k.boQua.diemDanhDaCoOLopMoi).toBe(1);
  });

  it("[LSH-05] KHÁC KHOÁ: bài không có ở lớp mới ⇒ không ghép; buổi không gắn bài ⇒ không đoán theo số thứ tự", () => {
    const k = lap({ diemDanh: [dd("x", "L9"), dd("y", null)], nhanXet: [nx("fx", "L9"), nx("fy", null)] });
    expect(k.diemDanhTao).toEqual([]);
    expect(k.nhanXetTao).toEqual([]);
    expect(k.boQua.khongCoBuoiTuongUng).toBe(2);
    expect(k.boQua.khongCoBaiHoc).toBe(2);
  });

  it("[LSH-06] buổi lớp mới đã HUỶ không nhận; có buổi cùng bài khác không huỷ thì ghép buổi đó", () => {
    const buoi: BuoiDich[] = [
      { id: "huy", lessonId: "L1", date: D("2026-10-01"), status: "CANCELLED" },
      { id: "bu", lessonId: "L1", date: D("2026-10-03"), status: "COMPLETED" },
    ];
    const k = lap({ buoi, diemDanh: [dd("a1", "L1")] });
    expect(k.diemDanhTao).toEqual([{ nguonId: "a1", buoiDichId: "bu" }]);
    expect(lap({ buoi: [buoi[0]!], diemDanh: [dd("a1", "L1")] }).diemDanhTao).toEqual([]);
  });

  it("[LSH-07] NHẬN XÉT CHỒNG — nguồn viết SỚM HƠN bản đích ⇒ lấy CÁI ĐẦU: nguồn thay nội dung bản đích", () => {
    const k = lap({
      nhanXet: [nx("f2", "L2", "2026-09-10")],
      nxCoSan: [["b2", { id: "dich-f2", createdAt: D("2026-10-09") }]],
    });
    expect(k.nhanXetTao).toEqual([]);
    expect(k.nhanXetThay).toEqual([{ nguonId: "f2", nhanXetDichId: "dich-f2", buoiDichId: "b2" }]);
  });

  it("[LSH-08] NHẬN XÉT CHỒNG — bản đích viết TRƯỚC (hoặc cùng lúc) ⇒ GIỮ bản đích, không thay", () => {
    const sau = lap({
      nhanXet: [nx("f2", "L2", "2026-10-20")],
      nxCoSan: [["b2", { id: "dich-f2", createdAt: D("2026-10-09") }]],
    });
    expect(sau.nhanXetThay).toEqual([]);
    expect(sau.nhanXetTao).toEqual([]);
    expect(sau.boQua.nhanXetDichDaSomHon).toBe(1);
    const bang = lap({
      nhanXet: [nx("f2", "L2", "2026-10-09")],
      nxCoSan: [["b2", { id: "dich-f2", createdAt: D("2026-10-09") }]],
    });
    expect(bang.nhanXetThay).toEqual([]);
  });

  it("[LSH-09] hai buổi nguồn cùng một bài (học bù…) rơi vào cùng một buổi đích ⇒ chọn buổi SỚM NHẤT; nhận xét chọn theo createdAt", () => {
    const k = lap({
      diemDanh: [dd("muon", "L1", "PRESENT", "2026-09-20"), dd("som", "L1", "PRESENT", "2026-09-05")],
      nhanXet: [nx("fm", "L1", "2026-09-21"), nx("fs", "L1", "2026-09-06")],
    });
    expect(k.diemDanhTao).toEqual([{ nguonId: "som", buoiDichId: "b1" }]);
    expect(k.nhanXetTao).toEqual([{ nguonId: "fs", buoiDichId: "b1" }]);
    expect(k.boQua.trungBuoiNguonCungBai).toBe(2);
  });

  it("[LSH-10] IDEMPOTENT: áp kế hoạch rồi lập lại ⇒ rỗng (điểm danh đã có; nhận xét đích mang createdAt của nguồn)", () => {
    const ban = {
      diemDanh: [dd("a1", "L1"), dd("a2", "L2")],
      nhanXet: [nx("f1", "L1", "2026-09-02"), nx("f2", "L2", "2026-09-03")],
    };
    const lan1 = lap({ ...ban, nxCoSan: [["b2", { id: "d2", createdAt: D("2026-10-09") }]] });
    expect(lan1.diemDanhTao).toHaveLength(2);
    expect(lan1.nhanXetTao).toHaveLength(1);
    expect(lan1.nhanXetThay).toHaveLength(1);
    const lan2 = lap({
      ...ban,
      ddCoSan: ["b1", "b2"],
      nxCoSan: [
        ["b1", { id: "d1", createdAt: D("2026-09-02") }],
        ["b2", { id: "d2", createdAt: D("2026-09-03") }], // đã thay ⇒ mang createdAt của nguồn
      ],
    });
    expect(lan2.diemDanhTao).toEqual([]);
    expect(lan2.nhanXetTao).toEqual([]);
    expect(lan2.nhanXetThay).toEqual([]);
  });

  it("[LSH-11] không đọc đồng hồ thật: cùng dữ liệu, dời `now` về trước buổi ⇒ kết quả đổi theo `now` truyền vào", () => {
    const truoc = lap({ diemDanh: [dd("a3", "L3")], now: D("2026-10-14") });
    const sau = lap({ diemDanh: [dd("a3", "L3")], now: D("2026-10-16") });
    expect(truoc.diemDanhTao).toEqual([]);
    expect(sau.diemDanhTao).toEqual([{ nguonId: "a3", buoiDichId: "b3" }]);
  });
});

// ── LƯỚI GHIM MÃ NGUỒN ───────────────────────────────────────────────────────────────
// Luật cần khoá: MỌI đường chuyển ghi danh sang lớp khác đều gọi `diLichSuHocSangLopMoi` trong CÙNG transaction. Test hành vi của từng
// đường chuyển đều giả lập module này (hoặc chạm DB), nên quên gọi là KHÔNG ca nào đỏ. Neo vào BIỂU THỨC (tên hàm + số lần gọi).

function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}
const docMa = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[LSH-W] lưới ghim mã nguồn — mọi đường chuyển lớp đều mang lịch sử học theo", () => {
  it("[LSH-W1] chuyenLopTrongTx (chuyển lớp thường + đổi khoá) và approveTransfer (/chuyen-lop) mỗi nơi gọi đúng 1 lần", () => {
    expect(docMa("lib/enrollments/chuyen-lop.ts").match(/\bdiLichSuHocSangLopMoi\(/g)?.length).toBe(1);
    expect(docMa("lib/transfer/service.ts").match(/\bdiLichSuHocSangLopMoi\(/g)?.length).toBe(1);
  });

  it("[LSH-W2] hai đường đều nạp lớp nguồn THEO CHUỖI chuyển (A→B→C), không chỉ lớp liền trước", () => {
    expect(docMa("lib/enrollments/chuyen-lop.ts").match(/\blopNguonTheoChuoiChuyen\(/g)?.length).toBe(1);
    expect(docMa("lib/transfer/service.ts").match(/\blopNguonTheoChuoiChuyen\(/g)?.length).toBe(1);
  });

  it("[LSH-W3] chỉ HAI nơi chuyển ghi danh sang lớp khác (ghi TRANSFERRED kèm transferredToId) — thêm nơi thứ ba ⇒ phải nối lịch sử học vào đó", () => {
    const hits: string[] = [];
    const goc = process.cwd();
    const quet = (dir: string) => {
      for (const ten of readdirSync(dir)) {
        if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
        const p = join(dir, ten);
        if (statSync(p).isDirectory()) quet(p);
        else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten)) {
          const src = boChuThich(readFileSync(p, "utf8"));
          if (/status:\s*"TRANSFERRED"/.test(src) && /transferredToId/.test(src)) hits.push(p.slice(goc.length + 1).replace(/\\/g, "/"));
        }
      }
    };
    for (const d of ["app", "lib"]) quet(resolve(goc, d));
    expect(hits.sort()).toEqual(["lib/enrollments/chuyen-lop.ts", "lib/transfer/service.ts"]);
  }, 60_000); // quét cả cây: trần mặc định 15 giây không đủ khi test:unit chạy lúc máy tải nặng
});
