"use client";

import { Users, TrendingUp, DollarSign, Calendar } from "lucide-react";

// Design system imports
import { HeroParticles } from "@/components/design-system/heroes/hero-particles";
import { HeroSplit } from "@/components/design-system/heroes/hero-split";
import { HeroMinimal } from "@/components/design-system/heroes/hero-minimal";
import { SectionBase } from "@/components/design-system/sections/section-base";
import { SectionAlternate } from "@/components/design-system/sections/section-alternate";
import { SectionCircuit } from "@/components/design-system/sections/section-circuit";
import { SectionStats } from "@/components/design-system/sections/section-stats";
import { SectionMarquee } from "@/components/design-system/sections/section-marquee";
import { CourseCard } from "@/components/design-system/cards/course-card";
import { BlogCard } from "@/components/design-system/cards/blog-card";
import { EmployeeCard } from "@/components/design-system/cards/employee-card";
import { JobCard } from "@/components/design-system/cards/job-card";
import { TestimonialCard } from "@/components/design-system/cards/testimonial-card";
import { StatCard } from "@/components/design-system/cards/stat-card";
import { CTAPrimary } from "@/components/design-system/ctas/cta-primary";
import { CTASecondary } from "@/components/design-system/ctas/cta-secondary";
import { CTAGhost } from "@/components/design-system/ctas/cta-ghost";
import { CTAGradient } from "@/components/design-system/ctas/cta-gradient";
import { HeroKidRobot } from "@/components/design-system/illustrations/hero-kid-robot";
import { HeroClassroom } from "@/components/design-system/illustrations/hero-classroom";
import { HeroTeamWork } from "@/components/design-system/illustrations/hero-team-work";
import { HeroStemTools } from "@/components/design-system/illustrations/hero-stem-tools";
import { Sparkles } from "@/components/design-system/decorations/sparkles";
import { DotGrid } from "@/components/design-system/decorations/dot-grid";
import { StatCardAdmin } from "@/components/design-system/admin/stat-card-admin";
import { StatusBadge } from "@/components/design-system/admin/status-badge";
import { EmptyStateAdmin } from "@/components/design-system/admin/empty-state-admin";
import { DataTableShell } from "@/components/design-system/admin/data-table-shell";

export function DesignSystemDemo() {
  return (
    <div className="min-h-screen bg-card -m-6">
      {/* === HERO PARTICLES === */}
      <HeroParticles
        eyebrow="ROBOTICS & STEM K-12"
        title="Nuôi dưỡng thế hệ kỹ sư tương lai"
        subtitle="Hơn 4,000 học viên tin tưởng Sata Robo qua 6 năm xây dựng"
        trustIndicators={[
          { text: "8 trường K-12 đối tác" },
          { text: "24 giải RoboSim 2026" },
          { text: "4,000+ học viên" },
        ]}
      >
        <CTAPrimary href="#">Đăng ký tư vấn</CTAPrimary>
        <CTASecondary href="#">Xem khoá học</CTASecondary>
      </HeroParticles>

      {/* === HERO SPLIT === */}
      <HeroSplit
        eyebrow="LUYỆN THI ROBOSIM"
        title="Pass vòng loại Sáng tạo Robotics"
        subtitle="Platform mô phỏng cuộc thi đầu tiên tại Việt Nam — coaching 1-1 với mentor"
        illustration={<HeroKidRobot />}
      >
        <CTAPrimary href="#">Học trải nghiệm miễn phí</CTAPrimary>
        <CTAGhost href="#">Tìm hiểu thêm</CTAGhost>
      </HeroSplit>

      <HeroSplit
        eyebrow="LẬP TRÌNH ROBOT"
        title="Khoá Robotics Sata1-8 tại 2 cơ sở Đà Nẵng"
        subtitle="Học thực tế với robot vật lý, giáo viên 1:8, sĩ số nhỏ"
        illustration={<HeroClassroom />}
        illustrationPosition="left"
      >
        <CTAGradient href="#">Đăng ký lớp tháng 6</CTAGradient>
      </HeroSplit>

      {/* === HERO MINIMAL === */}
      <HeroMinimal
        eyebrow="TIN TỨC"
        title="Cập nhật từ Sata Robo"
        subtitle="Sự kiện, hoạt động và những câu chuyện đáng nhớ"
      />

      {/* === SECTION STATS === */}
      <SectionStats
        eyebrow="THÀNH TỰU"
        title="Sata Robo trong 6 năm"
        stats={[
          { value: 2000, suffix: "+", label: "Học viên" },
          { value: 2, label: "Cơ sở Đà Nẵng" },
          { value: 24, label: "Giải RoboSim 2026" },
          { value: 6, suffix: "+", label: "Năm xây dựng" },
        ]}
      />

      {/* === SECTION CIRCUIT — COURSE CARDS === */}
      <SectionCircuit eyebrow="KHOÁ HỌC" title="2 khoá học chủ lực" subtitle="Mỗi khoá thiết kế cho từng nhóm học viên cụ thể">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <CourseCard
            size="large"
            badge="LTR"
            title="Lập trình Robot (Sata1-8)"
            description="Khoá Robotics offline cho học sinh lớp 1-8 — robot vật lý, lớp 1:8, 2 cơ sở Đà Nẵng"
            href="#"
            price="Liên hệ tư vấn"
            duration="6 tháng"
            studentCount={1200}
          />
          <CourseCard
            size="large"
            badge="LTRS"
            title="Luyện thi RoboSim"
            description="Khoá luyện thi online + coaching 1-1 — pass vòng loại Sáng tạo Robotics R1/R2"
            href="#"
            price="Liên hệ tư vấn"
            duration="3-6 tháng"
            studentCount={800}
          />
        </div>
      </SectionCircuit>

      {/* === SECTION ALTERNATE — BLOG + JOB CARDS === */}
      <SectionAlternate eyebrow="NỘI DUNG" title="Blog & Tuyển dụng">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div>
            <h3 className="text-xl font-bold mb-4 text-foreground">Blog Cards</h3>
            <div className="space-y-4">
              <BlogCard
                title="Tại sao trẻ em cần học lập trình Robot từ sớm?"
                excerpt="5 lý do khoa học chứng minh lập trình Robot giúp trẻ phát triển tư duy, kỹ năng mềm và chuẩn bị cho tương lai số."
                href="#"
                publishedAt={new Date("2026-04-15")}
                readingTimeMin={5}
                authorName="Hồ Đắc Phúc"
                category="Phụ huynh"
              />
            </div>
          </div>
          <div>
            <h3 className="text-xl font-bold mb-4 text-foreground">Job Cards</h3>
            <div className="space-y-4">
              <JobCard
                title="Giảng viên Robotics & Lập trình"
                department="Đào tạo"
                location="Đà Nẵng"
                type="Toàn thời gian"
                salaryRange="8-15 triệu"
                openings={3}
                href="#"
              />
            </div>
          </div>
        </div>
      </SectionAlternate>

      {/* === EMPLOYEE + TESTIMONIAL CARDS === */}
      <SectionBase eyebrow="ĐỘI NGŨ & PHỤ HUYNH" title="Employee & Testimonial cards">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <EmployeeCard
            fullName="Lê Minh Tâm"
            jobTitle="Trưởng phòng Đào tạo"
            department="Đào tạo"
            bio="Dẫn dắt đội ngũ 12 giáo viên xây dựng giáo trình Robosim Master."
            href="#"
          />
          <TestimonialCard
            quote="Con tôi học được 3 tháng, bây giờ tự mày mò sửa đồ điện tử trong nhà. Quan trọng hơn là con không còn nản lòng khi gặp khó khăn nữa."
            authorName="Chị Thanh Hà"
            authorRole="Phụ huynh học viên lớp 5"
            rating={5}
          />
          <div className="grid grid-cols-2 gap-3 content-start">
            <StatCard
              value="98%"
              label="Hài lòng"
              description="Khảo sát phụ huynh 2025"
              accent="orange"
            />
            <StatCard
              value="4.9/5"
              label="Đánh giá"
              description="Trên Google + Facebook"
              accent="purple"
            />
          </div>
        </div>
      </SectionBase>

      {/* === SECTION MARQUEE === */}
      <SectionMarquee
        eyebrow="ĐỐI TÁC"
        title="Tin tưởng bởi 8 trường K-12 tại Đà Nẵng"
        items={[
          <span key="1" className="text-2xl font-bold text-muted-foreground">Trường Tiểu học Lê Văn Tám</span>,
          <span key="2" className="text-2xl font-bold text-muted-foreground">THCS Nguyễn Khuyến</span>,
          <span key="3" className="text-2xl font-bold text-muted-foreground">Trường Quốc tế Sky-Line</span>,
          <span key="4" className="text-2xl font-bold text-muted-foreground">FPT School Đà Nẵng</span>,
          <span key="5" className="text-2xl font-bold text-muted-foreground">SOS Children&apos;s Village</span>,
        ]}
      />

      {/* === HEROES WITH OTHER ILLUSTRATIONS === */}
      <HeroSplit
        eyebrow="ĐỘI NGŨ SATA ROBO"
        title="Đội ngũ giáo viên & mentor 6 năm kinh nghiệm"
        subtitle="Giảng viên Robotics + STEM được đào tạo bài bản theo chuẩn WRO"
        illustration={<HeroTeamWork />}
      >
        <CTAPrimary href="#">Gặp đội ngũ</CTAPrimary>
        <CTAGhost href="#">Xem tuyển dụng</CTAGhost>
      </HeroSplit>

      <HeroSplit
        eyebrow="HỌC CỤ"
        title="Bộ kit Robotics chuẩn quốc tế"
        subtitle="Robot Education vật lý + sensor + controller — tất cả Sata Robo cung cấp"
        illustration={<HeroStemTools />}
        illustrationPosition="left"
      >
        <CTAPrimary href="#">Xem học cụ</CTAPrimary>
      </HeroSplit>

      {/* === DECORATIONS DEMO === */}
      <SectionBase eyebrow="DECORATIONS" title="Subtle decoration components">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="relative h-48 rounded-xl border border-border bg-card overflow-hidden">
            <Sparkles className="absolute inset-0 w-full h-full text-primary" />
            <div className="absolute inset-0 flex items-center justify-center text-foreground font-semibold">
              &lt;Sparkles /&gt;
            </div>
          </div>
          <div className="relative h-48 rounded-xl border border-border bg-card overflow-hidden">
            <DotGrid className="absolute inset-0 w-full h-full text-primary" />
            <div className="absolute inset-0 flex items-center justify-center text-foreground font-semibold">
              &lt;DotGrid /&gt;
            </div>
          </div>
        </div>
      </SectionBase>

      {/* === ADMIN COMPONENTS === */}
      <SectionAlternate
        eyebrow="ADMIN"
        title="Polished admin components"
        subtitle="Utility-first, không animation daily-blocking — fast UX cho người dùng nội bộ"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <StatCardAdmin
            label="Leads tháng 5"
            value={132}
            trend={{ direction: "up", value: "+7% so với T4" }}
            icon={<Users className="w-4 h-4" />}
            iconColor="orange"
          />
          <StatCardAdmin
            label="Chuyển đổi"
            value={28}
            trend={{ direction: "up", value: "+18%" }}
            icon={<TrendingUp className="w-4 h-4" />}
            iconColor="purple"
          />
          <StatCardAdmin
            label="Doanh thu"
            value="158M"
            trend={{ direction: "up", value: "+22%" }}
            icon={<DollarSign className="w-4 h-4" />}
            iconColor="orange"
          />
          <StatCardAdmin
            label="Lớp đang chạy"
            value={14}
            icon={<Calendar className="w-4 h-4" />}
            iconColor="neutral"
          />
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          <StatusBadge variant="success">Đang hoạt động</StatusBadge>
          <StatusBadge variant="warning">Chờ duyệt</StatusBadge>
          <StatusBadge variant="error">Đã huỷ</StatusBadge>
          <StatusBadge variant="info">Mới</StatusBadge>
          <StatusBadge variant="neutral">Lưu trữ</StatusBadge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <EmptyStateAdmin
            title="Chưa có lead nào"
            description="Lead sẽ xuất hiện ở đây khi phụ huynh đăng ký form trên public site."
            action={<CTAPrimary size="sm" href="#">Tạo lead thủ công</CTAPrimary>}
          />
          <DataTableShell
            header={<div className="flex justify-between items-center text-sm font-semibold">Honors <span className="text-xs text-muted-foreground">5 records</span></div>}
            footer={<div className="text-xs text-muted-foreground text-right">Page 1/1</div>}
          >
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Tên</th>
                  <th className="px-4 py-3">Hạng mục</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr><td className="px-4 py-3 font-medium">Lê Minh Tâm</td><td className="px-4 py-3">GRAND_CHAMPION</td><td className="px-4 py-3 text-right"><StatusBadge variant="success">Published</StatusBadge></td></tr>
                <tr><td className="px-4 py-3 font-medium">Nguyễn Thị Mai</td><td className="px-4 py-3">IMPACT</td><td className="px-4 py-3 text-right"><StatusBadge variant="success">Published</StatusBadge></td></tr>
                <tr><td className="px-4 py-3 font-medium">Phạm Quốc Anh</td><td className="px-4 py-3">SPARK</td><td className="px-4 py-3 text-right"><StatusBadge variant="warning">Draft</StatusBadge></td></tr>
              </tbody>
            </table>
          </DataTableShell>
        </div>
      </SectionAlternate>

      {/* === CTA SHOWCASE === */}
      <SectionBase eyebrow="CTAs" title="5 button variants">
        <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
          <CTAPrimary>Primary Shimmer</CTAPrimary>
          <CTASecondary>Secondary Outline</CTASecondary>
          <CTAGhost>Ghost Link</CTAGhost>
          <CTAGradient>Premium Gradient</CTAGradient>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          &lt;CTAFloating&gt; chỉ hiện trên mobile (bottom-right) — kiểm tra DevTools
          responsive 375px.
        </p>
      </SectionBase>

      {/* End spacer */}
      <div className="py-12 bg-card text-center text-xs text-muted-foreground">
        End of design system preview · Phase 4.UI.1
      </div>
    </div>
  );
}
