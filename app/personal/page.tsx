import { redirect } from "next/navigation";

// Personal expenses now live in History (Type: Personal).
export default function PersonalPage() {
  redirect("/history?type=personal");
}
