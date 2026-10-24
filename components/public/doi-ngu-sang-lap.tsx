import Image from "next/image";
import type { ReactNode } from "react";
import { Quote } from "lucide-react";
import { PortraitReveal } from "@/components/motion/portrait-reveal";
import { RevealOnScroll } from "@/components/motion/reveal-on-scroll";

// Đội ngũ sáng lập — nội dung chép từ 3 ảnh giới thiệu gốc ở `websatarobo data/founder/*.jpg`.
// Thứ tự hiển thị chủ dự án chốt 02/10/2026: Phúc → Lợi → Khiêm.

const Hl = ({ children }: { children: ReactNode }) => (
  <span className="font-semibold text-orange-600">{children}</span>
);

interface Muc {
  title: ReactNode;
  desc?: ReactNode;
}

interface NhaSangLap {
  slug: string;
  name: string;
  photo: string;
  role: ReactNode;
  tagline: string;
  /** true = câu trích dẫn (in nghiêng có dấu ngoặc), false = dòng chuyên môn. */
  taglineIsQuote: boolean;
  items: [Muc, Muc, Muc, Muc];
  final: { title: string; lines: ReactNode[] };
}

const FOUNDERS: NhaSangLap[] = [
  {
    slug: "ho-dac-phuc",
    name: "Ông Hồ Đắc Phúc",
    photo: "/images/founders/ho-dac-phuc.png",
    role: (
      <>
        Founder <Hl>SataWorld</Hl> · Sáng lập &amp; CEO <Hl>Sata Robo</Hl>
      </>
    ),
    tagline: "AI làm phần lặp lại. Con người làm phần tử tế.",
    taglineIsQuote: true,
    items: [
      {
        title: "Founder hệ sinh thái giáo dục SataWorld",
        desc: (
          <>
            2026: 10 cơ sở Satamath · 2 Sata Robo
            <br />
            40+ kỳ thi quốc tế · 12+ năm học liệu
          </>
        ),
      },
      {
        title: "Sáng lập & Tổng giám đốc",
        desc: "CTCP Công nghệ Giáo dục Sata Robo",
      },
      {
        title: "Quản trị doanh nghiệp bằng AI",
        desc: "Vận hành AI-First bằng hệ thống AI Agent",
      },
      { title: "Chuyên gia tài chính & tái cấu trúc doanh nghiệp" },
    ],
    final: {
      title: "Kinh nghiệm chuyên môn",
      lines: [
        <>
          <Hl>15 năm</Hl> vận hành doanh nghiệp
        </>,
        <>
          <Hl>11 năm</Hl> ngân hàng · Phó phòng thẻ
        </>,
        <>
          <Hl>7 năm</Hl> lĩnh vực F&amp;B
        </>,
        <>
          <Hl>5 năm</Hl> phân phối hàng tiêu dùng
        </>,
        <>
          <Hl>3 năm</Hl> thương mại điện tử quốc tế
        </>,
        <>
          Cựu thành viên đội <Hl>Robocon</Hl> ĐH Bách khoa Đà Nẵng
        </>,
      ],
    },
  },
  {
    slug: "phung-ngoc-loi",
    name: "Ông Phùng Ngọc Lợi",
    photo: "/images/founders/phung-ngoc-loi.png",
    role: (
      <>
        Đồng sáng lập <Hl>Sata Robo</Hl> · Sáng lập <Hl>Satamath</Hl>
      </>
    ),
    tagline: "Cố vấn chuyên môn · Phương pháp học tập thông minh cho trẻ",
    taglineIsQuote: false,
    items: [
      {
        title: "Đồng sáng lập & Cố vấn chuyên môn",
        desc: "Phương pháp học tập thông minh cho trẻ từ 5 đến 15 tuổi",
      },
      {
        title: "Sáng lập & Điều hành",
        desc: "Hệ thống Học viện Toán tư duy Quốc tế Satamath",
      },
      {
        title: "Người tiên phong",
        desc: "Đưa 40+ kỳ thi quốc tế về khu vực miền Trung",
      },
      {
        title: "Tác giả",
        desc: "Nhiều bộ sách Toán phát triển tư duy",
      },
    ],
    final: {
      title: "Tổng Giám đốc điều hành (CEO)",
      lines: [
        <>
          Chuỗi học viện Toán <Hl>Satamath Academy</Hl>
        </>,
        <>
          <Hl>40+</Hl> kỳ thi quốc tế · Chuyên gia giáo dục trẻ <Hl>5–15 tuổi</Hl>
        </>,
      ],
    },
  },
  {
    slug: "nguyen-khiem",
    name: "Ông Nguyễn Khiêm",
    photo: "/images/founders/nguyen-khiem.png",
    role: (
      <>
        Đồng sáng lập <Hl>Sata Robo</Hl> · Đồng sáng lập <Hl>SOVA</Hl>
      </>
    ),
    tagline: "Chiến lược tăng trưởng · Huy động vốn · M&A",
    taglineIsQuote: false,
    items: [
      {
        title: "Đồng sáng lập CTCP Công nghệ SOVA",
        desc: "Chiến lược tăng trưởng · Hệ sinh thái · Đối tác chiến lược quy mô lớn",
      },
      {
        title: "Giám đốc Chiến lược & Huy động vốn",
        desc: "Cấu trúc vốn · Định giá · Mạng lưới VC, Angel Investors",
      },
      {
        title: "Kiến trúc hệ thống & Tự động hoá",
        desc: "Chuẩn hoá luồng dữ liệu · Automation trong vận hành & thẩm định đầu tư",
      },
      {
        title: "Cố vấn M&A & Phát triển thương vụ",
        desc: "Deal Structuring · Thẩm định tăng trưởng · Bảo vệ cổ đông",
      },
    ],
    final: {
      title: "Kinh nghiệm chuyên môn",
      lines: [
        <>
          <Hl>15+ năm</Hl> kết nối đầu tư &amp; tư vấn tài chính doanh nghiệp
        </>,
        <>
          <Hl>15+ năm</Hl> mạng lưới đối tác, quỹ đầu tư &amp; tổ chức tài chính
        </>,
        <>
          <Hl>10+ năm</Hl> quản trị chiến lược, phát triển thị trường &amp; Scale-up
        </>,
        <>
          Chuyên sâu: <Hl>hệ thống số · tự động hoá · mô hình định giá</Hl>
        </>,
      ],
    },
  },
];

function SoThuTu({ n }: { n: number }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4A1D7A] text-base font-bold text-white shadow-sm">
      {n}
    </span>
  );
}

function TheNhaSangLap({ f, reverse }: { f: NhaSangLap; reverse: boolean }) {
  return (
    <article
      id={f.slug}
      className={`grid grid-cols-1 items-center gap-8 lg:gap-12 ${
        reverse ? "lg:grid-cols-[7fr_5fr]" : "lg:grid-cols-[5fr_7fr]"
      }`}
    >
      {/* Ảnh — khung zoom in, người trồi lên khi cuộn tới (xem PortraitReveal) */}
      <PortraitReveal
        side={reverse ? 1 : -1}
        className={`mx-auto w-full max-w-[340px] ${reverse ? "lg:order-2" : ""}`}
        frameClassName="relative aspect-[471/720] w-full overflow-hidden rounded-[2rem] bg-gradient-to-br from-purple-700 via-purple-600 to-orange-500 shadow-2xl shadow-purple-900/25"
        backdrop={
          <>
            <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-orange-400/40 blur-3xl" />
            <div className="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-purple-950/40 blur-3xl" />
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
                backgroundSize: "22px 22px",
              }}
            />
          </>
        }
      >
        <Image
          src={f.photo}
          alt={f.name}
          fill
          sizes="(min-width: 1024px) 340px, 90vw"
          className="object-cover object-bottom"
        />
      </PortraitReveal>

      {/* Nội dung */}
      <div className={reverse ? "lg:order-1" : undefined}>
        <RevealOnScroll delay={0.15}>
          <h3 className="text-3xl font-extrabold leading-tight text-[#3B1466] md:text-4xl">
            {f.name}
          </h3>
          <p className="mt-2 text-base font-semibold text-neutral-800 md:text-lg">
            {f.role}
          </p>
          {f.taglineIsQuote ? (
            <p className="mt-3 flex items-start gap-2 text-neutral-600 italic">
              <Quote className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
              <span>&ldquo;{f.tagline}&rdquo;</span>
            </p>
          ) : (
            <p className="mt-3 text-neutral-600 italic">{f.tagline}</p>
          )}
        </RevealOnScroll>

        <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {f.items.map((it, i) => (
            <RevealOnScroll key={i} delay={0.25 + i * 0.08} distance={20}>
              <div className="flex gap-3">
                <SoThuTu n={i + 1} />
                <div>
                  <h4 className="font-bold leading-snug text-neutral-900">{it.title}</h4>
                  {it.desc ? (
                    <p className="mt-1 text-sm leading-relaxed text-neutral-600">{it.desc}</p>
                  ) : null}
                </div>
              </div>
            </RevealOnScroll>
          ))}
        </div>

        <RevealOnScroll delay={0.6} distance={20}>
          <div className="mt-6 flex gap-3 rounded-2xl border border-purple-100 bg-gradient-to-r from-purple-50/70 to-orange-50/70 p-4">
            <SoThuTu n={5} />
            <div>
              <h4 className="font-bold text-neutral-900">{f.final.title}</h4>
              <ul
                className={`mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-neutral-700 ${
                  f.final.lines.length > 3 ? "md:grid-cols-2" : ""
                }`}
              >
                {f.final.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </RevealOnScroll>
      </div>
    </article>
  );
}

export function DoiNguSangLap() {
  return (
    <div className="mx-auto max-w-6xl space-y-20 md:space-y-28">
      {FOUNDERS.map((f, i) => (
        <TheNhaSangLap key={f.slug} f={f} reverse={i % 2 === 1} />
      ))}
    </div>
  );
}
