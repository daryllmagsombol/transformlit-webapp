import { redirect } from "next/navigation";

export default function AuthedIndex() {
  redirect("/announcements");
}
