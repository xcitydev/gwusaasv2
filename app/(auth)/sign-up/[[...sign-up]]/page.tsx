import { SignUp } from "@clerk/nextjs";
import { SetupNotice } from "@/components/setup-notice";
import { AuthIntro, AuthSwitch, AuthTrust } from "@/components/auth/auth-intro";
import { authAppearance } from "@/components/auth/appearance";
import { isConfigured } from "@/lib/runtime";

export default function SignUpPage() {
  if (!isConfigured) return <SetupNotice page="sign-up" />;
  return (
    <>
      <AuthIntro mode="sign-up" />
      <SignUp appearance={authAppearance} />
      <AuthSwitch mode="sign-up" />
      <AuthTrust />
    </>
  );
}
