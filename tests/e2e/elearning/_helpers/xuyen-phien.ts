/**
 * Giàn đo cho điều tra "xuyên phiên" (V9.4 P0): ai gửi cookie nào, máy chủ trả Set-Cookie của AI, và nội dung trả về thuộc AI.
 *
 * ⚠️ KHÔNG BAO GIỜ ghi giá trị cookie / token ra log hay tệp. Mọi thứ ghi ra chỉ là NHÃN (vd "DAO_TAO"), tên cookie,
 * mã trạng thái, tiêu đề cache. Token được GIẢI MÃ trong tiến trình test bằng khoá TEST (`NEXTAUTH_SECRET` của `.env.test`,
 * chuỗi vô hại) chỉ để biết token đó thuộc người dùng fixture nào.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { decode } from "next-auth/jwt";

export type Nhan = string; // nhãn người dùng fixture, vd "DAO_TAO"

const TEN_COOKIE_PHIEN = /session-token$/;

/** Giải mã token phiên → nhãn người dùng (theo email fixture). `null` nếu không giải mã được (rỗng/hỏng/khác khoá). */
export async function nhanCuaToken(
  tenCookie: string,
  giaTri: string,
  emailSangNhan: Map<string, Nhan>,
): Promise<Nhan | null> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || !giaTri) return null;
  try {
    const payload = await decode({ token: giaTri, secret, salt: tenCookie });
    const email = typeof payload?.email === "string" ? payload.email : null;
    return email ? (emailSangNhan.get(email) ?? `LA:${email.length}`) : null;
  } catch {
    return null;
  }
}

function tachCookie(chuoi: string): { ten: string; giaTri: string } {
  const [cap] = chuoi.split(";");
  const i = cap.indexOf("=");
  return { ten: cap.slice(0, i).trim(), giaTri: cap.slice(i + 1).trim() };
}

export type SuKien = {
  /** ms từ lúc bắt đầu ghi */
  t: number;
  loai: "phan-hoi";
  duongDan: string;
  trangThai: number;
  tai: string; // resource type
  /** Chủ của cookie phiên GỬI ĐI cùng yêu cầu ("-" = không có cookie phiên) */
  gui: Nhan | "-" | "?";
  /** Chủ của từng Set-Cookie phiên trong phản hồi ("xoa" = Max-Age=0/Expires quá khứ) */
  datCookie: (Nhan | "xoa" | "?")[];
  cacheControl: string;
  vary: string;
};

/** Gắn bộ ghi vào một trang. Trả hàm lấy danh sách sự kiện + mốc thời gian. */
export function ghiPhienTrenTrang(page: Page, emailSangNhan: Map<string, Nhan>) {
  const t0 = Date.now();
  const suKien: SuKien[] = [];
  const dangXuLy: Promise<void>[] = [];
  page.on("response", (r) => {
    dangXuLy.push(
      (async () => {
        try {
          const req = r.request();
          const [dauGui, dauNhan] = await Promise.all([req.allHeaders(), r.headersArray()]);
          const url = new URL(r.url());
          let gui: SuKien["gui"] = "-";
          const ck = dauGui["cookie"] ?? "";
          for (const phan of ck.split(";")) {
            const { ten, giaTri } = tachCookie(phan);
            if (TEN_COOKIE_PHIEN.test(ten)) gui = (await nhanCuaToken(ten, giaTri, emailSangNhan)) ?? "?";
          }
          const dat: SuKien["datCookie"] = [];
          for (const h of dauNhan) {
            if (h.name.toLowerCase() !== "set-cookie") continue;
            const { ten, giaTri } = tachCookie(h.value);
            if (!TEN_COOKIE_PHIEN.test(ten)) continue;
            const xoa = /max-age=0|expires=thu, 01 jan 1970/i.test(h.value) || giaTri === "";
            dat.push(xoa ? "xoa" : ((await nhanCuaToken(ten, giaTri, emailSangNhan)) ?? "?"));
          }
          const tim = (ten: string) => dauNhan.find((h) => h.name.toLowerCase() === ten)?.value ?? "";
          suKien.push({
            t: Date.now() - t0,
            loai: "phan-hoi",
            duongDan: url.pathname + (url.search ? "?…" : ""),
            trangThai: r.status(),
            tai: req.resourceType(),
            gui,
            datCookie: dat,
            cacheControl: tim("cache-control"),
            vary: tim("vary"),
          });
        } catch {
          /* trang đã đóng giữa chừng — bỏ qua */
        }
      })(),
    );
  });
  return {
    t0,
    suKien,
    async hoiTu() {
      await Promise.all(dangXuLy);
      return suKien;
    },
  };
}

/** Chủ của cookie phiên đang nằm trong "hũ" của ngữ cảnh. */
export async function chuHuCookie(ctx: BrowserContext, emailSangNhan: Map<string, Nhan>): Promise<Nhan | "-" | "?"> {
  const ck = (await ctx.cookies()).find((c) => TEN_COOKIE_PHIEN.test(c.name));
  if (!ck) return "-";
  return (await nhanCuaToken(ck.name, ck.value, emailSangNhan)) ?? "?";
}

/** Danh tính theo MÁY CHỦ: `/api/auth/session` đọc bằng chính cookie của trang. Trả nhãn hoặc "-" (chưa đăng nhập). */
export async function danhTinhMayChu(page: Page, emailSangNhan: Map<string, Nhan>): Promise<Nhan | "-" | "?"> {
  const j = await page.evaluate(async () => {
    const r = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
    return (await r.json()) as { user?: { email?: string } } | null;
  });
  const email = j?.user?.email;
  if (!email) return "-";
  return emailSangNhan.get(email) ?? "?";
}

/** Tên hiển thị của người dùng fixture xuất hiện trong văn bản trang (để biết trang vẽ cho AI). */
export function tenXuatHien(vanBan: string, tenTheoNhan: Map<Nhan, string>): Nhan[] {
  return [...tenTheoNhan].filter(([, ten]) => vanBan.includes(ten)).map(([nhan]) => nhan);
}
