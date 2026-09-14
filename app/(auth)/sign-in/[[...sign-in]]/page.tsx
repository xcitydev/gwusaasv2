import { SignIn } from "@clerk/nextjs";
import { SetupNotice } from "@/components/setup-notice";
import { isConfigured } from "@/lib/runtime";

export default function SignInPage() {
  if (!isConfigured) return <SetupNotice page="sign-in" />;
  return <SignIn />;
}
