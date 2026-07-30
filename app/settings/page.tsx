import type { Metadata } from "next";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = {
  title: "Thiết lập",
  description:
    "Kết nối extension, chọn Facebook Group, từ khóa và phạm vi lấy comment/reply.",
};

export default function SettingsPage() {
  return <SettingsClient />;
}
