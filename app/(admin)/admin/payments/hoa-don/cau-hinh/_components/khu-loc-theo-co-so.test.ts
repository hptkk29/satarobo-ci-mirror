// [LCS-*] «Kết nối & ký» và «Chính sách ký» CHỈ hiện pháp nhân của cơ sở đang chọn (chủ dự án 05/11/2026:
// «cho cơ sở nào thì mới hiện ra kết nối và hạn mức của cơ sở đó»). Hai khối là server component async — gọi thẳng,
// đọc `props` của phần tử trả về (không cần dựng DOM). Dữ liệu giả có ĐỦ ba pháp nhân để một lượt lọc sai là thấy ngay.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chinhSach: [] as Record<string, unknown>[],
  lichSuChinhSach: [] as Record<string, unknown>[],
  ketNoi: [] as Record<string, unknown>[],
  lichSuKetNoiGoiVoi: [] as string[][],
}));

vi.mock("@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db", () => ({
  docCacChinhSachKy: async () => h.chinhSach,
  docLichSuChinhSachKy: async () => h.lichSuChinhSach,
  docSuDungHanMuc: async () => null,
}));
vi.mock("@/lib/finance/hoa-don/quyen", () => ({ phamViKeToan: () => "ALL" }));
vi.mock("@/lib/finance/hoa-don/ket-noi/ket-noi-db", () => ({
  laKeToanHoiSo: () => true,
  docCacKetNoi: async () => h.ketNoi,
  docLichSuKetNoi: async (_a: unknown, ids: string[]) => {
    h.lichSuKetNoiGoiVoi.push([...ids]);
    return [];
  },
}));
vi.mock("@/lib/finance/hoa-don/ket-noi/khoa-bi-mat", () => ({ docKhoaBiMat: () => ({ ok: true }) }));
vi.mock("@/lib/security/client-ip", () => ({ laProductionThat: () => false }));
// Hai thành phần giao diện kéo theo server action → next-auth; test chỉ đọc `props` của phần tử trả về nên thay bằng khung rỗng.
vi.mock("./ket-noi-ky", () => ({ KetNoiKy: () => null }));
vi.mock("./ky-chinh-sach", () => ({ KyChinhSach: () => null }));

import type { Actor } from "@/lib/auth/actor";
import { moiTruongKetNoiTuMoiTruongChay } from "@/lib/finance/hoa-don/ket-noi/luat";
import { KhuKetNoiKy } from "./khu-ket-noi-ky";
import { KhuKyChinhSach } from "./khu-ky-chinh-sach";

const ACTOR = { userId: "u1", isSuperAdmin: true } as unknown as Actor;
const BA = ["SATA_ROBO", "NEW_VISION", "STEM_ROBOTICS_AI"];
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  h.lichSuKetNoiGoiVoi = [];
  h.chinhSach = BA.map((ma) => ({ phapNhanMa: ma, cuaSoPhut: null }));
  h.lichSuChinhSach = BA.map((ma, i) => ({ id: `ls${i}`, phapNhanMa: ma, action: "x", luc: "", nguoi: "", lyDo: null, maChiDao: null, truocSau: [] }));
  const mt = moiTruongKetNoiTuMoiTruongChay(false);
  h.ketNoi = BA.map((ma, i) => ({
    id: `kn${i}`, phapNhanMa: ma, moiTruong: mt, nhaCungCapMa: "VIN_HOADON", dangBat: true, baseUrl: null, mst: null, tenDangNhap: null,
    coMatKhau: false, matKhauCapNhatLuc: null, phuongThucKy: "USB_TOKEN", cheDoKy: "LO", chungThuSerial: null, chungThuThumbprint: null,
    chungThuChuTheMst: null, chungThuNhaPhatHanh: null, chungThuHetHan: null, misaAppId: null, misaLoaiHoaDon: null, kiemTraLuc: null,
    kiemTraKetQua: null, capNhatBoiId: "u", capNhatLuc: "",
  }));
});

type Props = { the: { phapNhanMa: string }[]; lichSu: { phapNhanMa?: string; ketNoiId?: string }[] };
const propsCua = async (p: Promise<unknown>) => (await p as { props: Props }).props;

describe("[LCS] hai khối chỉ hiện pháp nhân của cơ sở đang chọn", () => {
  it("[LCS-01] «Chính sách ký»: chọn NEW_VISION ⇒ đúng MỘT thẻ, và lịch sử chỉ của pháp nhân đó", async () => {
    const p = await propsCua(KhuKyChinhSach({ actor: ACTOR, phapNhanMa: "NEW_VISION" }));
    expect(p.the.map((t) => t.phapNhanMa)).toEqual(["NEW_VISION"]);
    expect(p.lichSu.map((l) => l.phapNhanMa)).toEqual(["NEW_VISION"]);
  });

  it("[LCS-02] «Kết nối & ký»: chọn STEM_ROBOTICS_AI ⇒ đúng MỘT thẻ, và chỉ tra lịch sử của ĐÚNG dòng kết nối đó", async () => {
    const p = await propsCua(KhuKetNoiKy({ actor: ACTOR, phapNhanMa: "STEM_ROBOTICS_AI" }));
    expect(p.the.map((t) => t.phapNhanMa)).toEqual(["STEM_ROBOTICS_AI"]);
    expect(h.lichSuKetNoiGoiVoi).toEqual([["kn2"]]);
  });

  it("[LCS-03] ĐỐI CHỨNG ÂM: mỗi pháp nhân lọc ra đúng chính nó (không ai bị nuốt, không ai lọt thêm)", async () => {
    for (const ma of BA) {
      expect((await propsCua(KhuKyChinhSach({ actor: ACTOR, phapNhanMa: ma }))).the.map((t) => t.phapNhanMa)).toEqual([ma]);
      expect((await propsCua(KhuKetNoiKy({ actor: ACTOR, phapNhanMa: ma }))).the.map((t) => t.phapNhanMa)).toEqual([ma]);
    }
  });

  it("[LCS-04] mã lạ (không phải pháp nhân nào) ⇒ KHÔNG thẻ nào — không rơi về «hiện tất cả»", async () => {
    expect((await propsCua(KhuKyChinhSach({ actor: ACTOR, phapNhanMa: "KHONG_CO" }))).the).toEqual([]);
    expect((await propsCua(KhuKetNoiKy({ actor: ACTOR, phapNhanMa: "KHONG_CO" }))).the).toEqual([]);
  });
});

describe("[LCS-W] trang truyền pháp nhân của cơ sở cho CẢ HAI khối", () => {
  const trang = bo(doc("app/(admin)/admin/payments/hoa-don/cau-hinh/page.tsx"));

  it("[LCS-W1] pháp nhân đang chọn suy từ Cây tổ chức (chỉ khi KHỚP), và cả hai khối nhận nó", () => {
    // [ĐẢO 05/11/2026] Pháp nhân của các bước 2–3 là pháp nhân ĐANG PHÁT HÀNH (cấu hình ký hiệu của cơ sở); chỉ khi chưa có cấu hình mới rơi về Cây tổ chức (khớp MST) — xem `[TQTL-08]`.
    expect(trang.match(/const phapNhanDangChon = phapNhanTheoCauHinh\?\.ma \?\? \(theoCay\.loai === "KHOP" \? theoCay\.ma : null\);/g)).toHaveLength(1);
    expect(trang.match(/<KhuKetNoiKy actor=\{actor\} phapNhanMa=\{phapNhanDangChon\} \/>/g)).toHaveLength(1);
    expect(trang.match(/<KhuKyChinhSach actor=\{actor\} phapNhanMa=\{phapNhanDangChon\} \/>/g)).toHaveLength(1);
  });

  it("[LCS-W2] ĐỐI CHỨNG ÂM: không còn lời gọi hai khối thiếu `phapNhanMa`, và khối chỉ vẽ khi ĐÃ chọn cơ sở", () => {
    expect(trang).not.toMatch(/<KhuKetNoiKy actor=\{actor\} \/>/);
    expect(trang).not.toMatch(/<KhuKyChinhSach actor=\{actor\} \/>/);
    expect(trang).toMatch(/\{coSo && phapNhanDangChon && laKeToanHoiSo\(actor\) \? \(/);
    expect(trang).toMatch(/\{coSo && phapNhanDangChon \? \(\s*<div id="chinh-sach-ky"/);
  });

  it("[LCS-W3] hai khối khai `phapNhanMa` là tham số BẮT BUỘC (không dấu ?) — quên truyền là lỗi biên dịch", () => {
    for (const f of ["khu-ket-noi-ky.tsx", "khu-ky-chinh-sach.tsx"]) {
      const s = bo(doc(`app/(admin)/admin/payments/hoa-don/cau-hinh/_components/${f}`));
      expect(s, f).toMatch(/\{ actor, phapNhanMa \}: \{ actor: Actor; phapNhanMa: string \}/);
    }
  });
});
