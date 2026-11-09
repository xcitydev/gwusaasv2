import type { Metadata } from "next";
import Link from "next/link";
import { LegalHeader, LegalSection, Mail } from "@/components/marketing/legal-page";
import { OptOutForm } from "@/components/marketing/opt-out-form";
import { LEGAL, LEGAL_LINKS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Do Not Sell or Share / Opt out",
  description: "Remove your details from our lead data and stop emails sent through our platform.",
};

/**
 * Public opt-out (CCPA "Do Not Sell or Share", data-broker style removal,
 * and the unsubscribe link in every campaign email footer).
 */
export default function OptOutPage() {
  return (
    <article>
      <LegalHeader
        title="Do Not Sell or Share My Personal Information"
        intro={
          <>
            <p>
              {LEGAL.productName} keeps a library of publicly available business contact details that our customers
              can search. Use this form to unsubscribe from emails sent through our platform and to have your
              details removed from that library. No account is needed.
            </p>
            <p>
              We delete matching entries and keep a minimal record (the email or phone number you submit) only so
              we can make sure you are never added or emailed again.
            </p>
          </>
        }
      />
      <OptOutForm />
      <LegalSection title="What happens next">
        <p>
          Removal from our lead library is immediate. Customers who already imported your details into their own
          account control that copy, but an opted-out email can no longer be emailed through our platform. For
          anything else — access, correction or deletion of other data — email <Mail to={LEGAL.privacyEmail} /> or
          see our <Link href={LEGAL_LINKS.privacy}>Privacy Policy</Link>.
        </p>
      </LegalSection>
    </article>
  );
}
