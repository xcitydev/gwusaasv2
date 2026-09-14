import { redirect } from "next/navigation";

// No marketing landing page — the agency site links here. Middleware sends
// signed-out visitors to /sign-in.
export default function Home() {
  redirect("/dashboard");
}
