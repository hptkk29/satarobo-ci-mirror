"use client";

import { LineChart } from "@/components/charts/line-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { FunnelChart } from "@/components/charts/funnel-chart";

const sampleLeadData = [
  { date: "T1", leads: 23, enrollments: 5 },
  { date: "T2", leads: 35, enrollments: 8 },
  { date: "T3", leads: 42, enrollments: 12 },
  { date: "T4", leads: 51, enrollments: 14 },
  { date: "T5", leads: 67, enrollments: 19 },
];

const sampleSourceData = [
  { source: "Facebook", count: 45 },
  { source: "Google Ads", count: 32 },
  { source: "Organic SEO", count: 28 },
  { source: "Referral", count: 15 },
  { source: "Direct", count: 12 },
];

const sampleFunnelData = [
  { name: "NEW (132)", value: 132 },
  { name: "CONTACTED (89)", value: 89 },
  { name: "DEMO (42)", value: 42 },
  { name: "ENROLLED (28)", value: 28 },
];

export function ChartsTestClient() {
  return (
    <div className="space-y-8">
      <section className="bg-card border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">
          📈 Line Chart — Leads vs Enrollments
        </h2>
        <LineChart
          data={sampleLeadData}
          xKey="date"
          lines={[
            { key: "leads", name: "Leads", color: "#F97316" },
            { key: "enrollments", name: "Enrollments", color: "#7C3AED" },
          ]}
        />
      </section>

      <section className="bg-card border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">📊 Bar Chart — Top Lead Sources</h2>
        <BarChart
          data={sampleSourceData}
          xKey="source"
          bars={[{ key: "count", name: "Số lượng leads", color: "#F97316" }]}
        />
      </section>

      <section className="bg-card border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">
          ⏬ Funnel Chart — Conversion Pipeline
        </h2>
        <FunnelChart data={sampleFunnelData} />
      </section>
    </div>
  );
}
