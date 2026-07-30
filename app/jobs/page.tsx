import type { Metadata } from "next";
import { JobsClient } from "./jobs-client";

export const metadata: Metadata = {
  title: "Tiến trình",
  description:
    "Theo dõi tiến độ lấy group, comment/reply và AI sentiment.",
};

export default function JobsPage() {
  return <JobsClient />;
}
