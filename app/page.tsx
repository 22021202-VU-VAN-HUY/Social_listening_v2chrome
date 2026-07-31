import type { Metadata } from "next";
import { DashboardClient } from "./dashboard-client";

export const metadata: Metadata = {
  title: "Tổng quan",
  description:
    "Tổng quan sắc thái bình luận và phản hồi về Vinsmart Future theo thời gian thực.",
};

export default function Home() {
  return <DashboardClient />;
}
