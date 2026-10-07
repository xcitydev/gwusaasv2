import { SignIn } from "@clerk/nextjs";
import { SetupNotice } from "@/components/setup-notice";
import { AuthIntro, AuthSwitch } from "@/components/auth/auth-intro";
import { authAppearance } from "@/components/auth/appearance";
import { isConfigured } from "@/lib/runtime";

export default function SignInPage() {
  if (!isConfigured) return <SetupNotice page="sign-in" />;
  return (
    <>
      <AuthIntro mode="sign-in" />
      <SignIn appearance={authAppearance} />
      <AuthSwitch mode="sign-in" />
    </>
  );
}
