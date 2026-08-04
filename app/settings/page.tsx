import type { Metadata } from "next";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = {
  title: "Thiết lập",
  description:
    "Kết nối extension, cấu hình Facebook/Threads, từ khóa và phạm vi lấy post/comment/reply.",
};

export default function SettingsPage() {
  return <SettingsClient />;
}
