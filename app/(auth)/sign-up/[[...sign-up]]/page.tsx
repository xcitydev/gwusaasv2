import { SignUp } from "@clerk/nextjs";
import { SetupNotice } from "@/components/setup-notice";
import { isConfigured } from "@/lib/runtime";

export default function SignUpPage() {
  if (!isConfigured) return <SetupNotice page="sign-up" />;
  return <SignUp />;
}
