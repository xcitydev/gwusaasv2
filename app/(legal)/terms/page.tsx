import type { Metadata } from "next";
import Link from "next/link";
import {
  ContactBlock,
  LegalHeader,
  LegalList,
  LegalSection,
  Mail,
} from "@/components/marketing/legal-page";
import { LEGAL, LEGAL_LINKS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The agreement that governs your use of ${LEGAL.productName}.`,
};

/**
 * Terms of Service. Company facts come from lib/legal.ts; section ids are
 * linked from the app (#subscriptions, #credits, #referrals, #ai-content).
 */
export default function TermsPage() {
  const co = LEGAL.companyName;
  const product = LEGAL.productName;
  return (
    <article>
      <LegalHeader
        title="Terms of Service"
        intro={
          <>
            <p>
              These Terms of Service (the &ldquo;Terms&rdquo;) are a binding agreement between you and {co}{" "}
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;) and govern your use of {product}, its website, apps and
              related services (the &ldquo;Service&rdquo;). By creating an account, clicking to accept, or using
              the Service you agree to these Terms, our <Link href={LEGAL_LINKS.privacy}>Privacy Policy</Link> and
              our <Link href={LEGAL_LINKS.acceptableUse}>Acceptable Use Policy</Link>.
            </p>
            <p>
              <strong>Please read section 16 carefully: it requires most disputes to be resolved by individual
              binding arbitration and waives class actions and jury trials.</strong>
            </p>
          </>
        }
      />

      <LegalSection id="eligibility" title="1. Eligibility and accounts">
        <p>
          You must be at least <strong>18 years old</strong> and able to form a binding contract to use the
          Service. If you use the Service for a business, you confirm you are authorized to bind that business,
          and &ldquo;you&rdquo; includes it. You are responsible for your account credentials, for everything
          done under your account (including by team members you invite), and for keeping your account
          information accurate. Tell us promptly at <Mail to={LEGAL.contactEmail} /> if you suspect unauthorized
          access.
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. The Service">
        <p>
          The Service provides tools for sales and marketing, including cold email outreach, lead search, an AI
          phone receptionist and call qualifier, voice cloning, Instagram direct-message management, an AI
          meeting note taker, and AI image, video and audio generation. Many features rely on third-party
          providers. Features may change, be added or be removed over time, and some are offered as beta
          features &ldquo;as is&rdquo;. AI output can be inaccurate; you must review it before relying on or
          sending it.
        </p>
      </LegalSection>

      <LegalSection id="customer-responsibility" title="3. Your responsibility for consent and compliance">
        <p>
          You decide whom you email, call, text, message, record, scrape, clone or depict with the Service, and
          what you send or generate. <strong>You are solely responsible for having every consent, notice and
          legal basis required for that activity</strong>, including under:
        </p>
        <LegalList
          items={[
            <>the Telephone Consumer Protection Act (TCPA), the Telemarketing Sales Rule, state telemarketing and
              &ldquo;mini-TCPA&rdquo; laws and Do-Not-Call registries — including prior express written consent
              before any AI-voice or prerecorded call to a mobile phone where required;</>,
            <>the CAN-SPAM Act, Canada&apos;s CASL, and similar email laws — including honest headers and subject
              lines, a valid postal address, and honoring opt-outs within 10 business days;</>,
            <>the GDPR, UK GDPR, CCPA/CPRA and other privacy laws — including a lawful basis for processing
              personal data you import, scrape or upload, and honoring data-subject requests;</>,
            <>call- and meeting-recording laws, including all-party (two-party) consent states — you must tell
              participants they are being recorded and obtain consent where required;</>,
            <>biometric privacy laws (such as Illinois BIPA, Texas and Washington law) for any voice sample you
              upload or record;</>,
            <>right-of-publicity, likeness and intellectual-property laws for any person, voice, brand or work you
              upload, clone, imitate or generate.</>,
          ]}
        />
        <p>
          The Service adds certain safeguards (for example an unsubscribe footer on campaign emails and a meeting
          bot that announces it is recording), but those safeguards do not make your use lawful and do not shift
          your obligations to us. We act as your service provider / processor for personal data you put into the
          Service.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="4. Acceptable use">
        <p>
          You must follow our <Link href={LEGAL_LINKS.acceptableUse}>Acceptable Use Policy</Link>, which forms
          part of these Terms. We may suspend or remove content, campaigns, numbers or accounts that we believe
          violate it, put the Service or others at risk, or expose us to liability.
        </p>
      </LegalSection>

      <LegalSection id="ai-content" title="5. AI-generated content and voice clones">
        <p>
          You own the inputs you provide and, as between you and us, the outputs the Service generates for you,
          subject to the rights of third parties and the terms of the underlying model providers. You may not
          use the Service to create, and you must not upload material for:
        </p>
        <LegalList
          items={[
            "any likeness or voice of a real person without that person's documented consent (no non-consensual likeness or voice clones, deepfakes or face-swaps);",
            "any depiction of a minor in a sexual, suggestive, violent or exploitative context, or any sexual content involving a minor — which we report to authorities;",
            "sexually explicit or pornographic content;",
            "impersonation of any person, business, brand or public official, or content designed to mislead people about who is speaking;",
            "content that is defamatory, harassing, hateful, violent, or that infringes intellectual property.",
          ]}
        />
        <p>
          When you clone a voice you confirm it is your own voice or that you hold the speaker&apos;s written
          consent to clone it and use it for your stated purpose. To report AI content or a voice clone that
          misuses your likeness, email <Mail to={LEGAL.abuseEmail} /> with a link or description; we review
          reports promptly and remove infringing content.
        </p>
      </LegalSection>

      <LegalSection id="subscriptions" title="6. Subscriptions, automatic renewal and cancellation">
        <p>
          Paid plans are billed in advance through our payment processor, Whop. <strong>Your subscription renews
          automatically at the end of each billing period (monthly unless stated otherwise) at the then-current
          price, and your payment method is charged, until you cancel.</strong> The price, billing period and any
          included credits are shown before you pay. We will give you advance notice of any price change, which
          applies from your next renewal.
        </p>
        <p>
          <strong>How to cancel:</strong> go to Settings → Billing in the app and choose &ldquo;Manage or cancel
          subscription&rdquo;, which opens your Whop memberships page, or cancel directly at whop.com under your
          account&apos;s Memberships. You can also email <Mail to={LEGAL.contactEmail} /> and we will cancel for
          you. Cancellation stops future renewals; you keep paid access until the end of the current period.
          Except where the law requires otherwise or we state a specific refund window, fees already paid are not
          refunded for partial periods.
        </p>
      </LegalSection>

      <LegalSection id="credits" title="7. Credits">
        <p>
          Many features consume prepaid credits (1 credit = US$0.01 unless shown otherwise). Credits are included
          with paid plans or bought in packs, and the cost of an action is shown or estimated before you run it.
          Credits:
        </p>
        <LegalList
          items={[
            "do not expire while your account remains open and in good standing;",
            "are a license to use the Service, not money, property or a stored-value account — they have no cash value and cannot be transferred, sold or exchanged;",
            <><strong>are non-refundable, except as required by law</strong> or where we refund credits for an
              action that failed on our side;</>,
            "may be reversed if the payment that bought them is refunded or charged back, and are forfeited if your account is closed for breach of these Terms.",
          ]}
        />
        <p>Estimates can differ from final cost where a provider bills by actual usage (for example call minutes).</p>
      </LegalSection>

      <LegalSection id="referrals" title="8. Referral program">
        <LegalList
          items={[
            "Eligible members earn a commission of 15% of the net amount (after refunds, taxes and fees) paid by each customer they refer, for as long as that referred customer keeps paying, unless a different rate is shown in your account.",
            "A referral counts only when the new customer signs up through your link and is not already a customer. Self-referrals, referrals of your own other accounts or businesses, and referrals obtained through spam, misleading ads, bidding on our brand terms or coupon sites are not eligible.",
            "Commissions stay pending until the referred payment's 14-day refund window has passed. A commission is voided if the underlying payment is refunded or charged back, including after payout (we may offset it against future commissions).",
            "Payouts are made through our payment processor once you meet any minimum shown in the app, and you are responsible for any taxes on what you earn and for providing required tax information.",
            "We may change or end the program with notice; commissions earned before the change are honored. We may withhold commissions and close referral access for fraud or abuse.",
          ]}
        />
      </LegalSection>

      <LegalSection id="your-data" title="9. Your content and data">
        <p>
          You keep ownership of the content and data you put into the Service (&ldquo;Customer Data&rdquo;). You
          grant us a worldwide, non-exclusive license to host, process, transmit and display Customer Data only to
          provide, secure and improve the Service and as described in our{" "}
          <Link href={LEGAL_LINKS.privacy}>Privacy Policy</Link>. You confirm you have the rights and consents
          needed for us to do so. Lead data we supply from public and licensed sources is provided for your
          lawful business outreach only; you may not resell it as a dataset.
        </p>
      </LegalSection>

      <LegalSection id="third-party" title="10. Third-party services">
        <p>
          The Service connects to third-party services (for example Instagram, calendars, meeting platforms,
          email inboxes and AI model providers). Your use of those services is governed by their terms, and we
          are not responsible for them. Model and product names are shown to describe what is available and do
          not imply endorsement or partnership.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="11. Suspension and termination">
        <p>
          You may stop using the Service and close your account at any time. We may suspend or terminate your
          access if you breach these Terms, if required by law, or to protect the Service, users or third parties.
          Sections that by their nature should survive (including 3, 7, 12–17) survive termination.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" title="12. Disclaimers">
        <p className="uppercase">
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent
          permitted by law we disclaim all warranties, express or implied, including merchantability, fitness for
          a particular purpose, non-infringement, and any warranty that the Service, AI output, lead data or
          deliverability will be accurate, uninterrupted or error-free. We do not guarantee any business result.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="13. Limitation of liability">
        <p className="uppercase">
          To the fullest extent permitted by law, neither we nor our suppliers will be liable for any indirect,
          incidental, special, consequential, exemplary or punitive damages, or for lost profits, revenue, data or
          goodwill. Our total liability for all claims relating to the Service is limited to the greater of
          (a) the amounts you paid us in the 12 months before the event giving rise to the claim and (b) US$100.
        </p>
        <p>Some jurisdictions do not allow these limits, so they apply only to the extent permitted.</p>
      </LegalSection>

      <LegalSection id="indemnity" title="14. Indemnity">
        <p>
          You will defend, indemnify and hold harmless {co} and its officers, employees and contractors from any
          claim, fine, penalty, loss or expense (including reasonable legal fees) arising from: your Customer
          Data; anything you send, call, text, message, record, scrape, clone or generate with the Service; your
          failure to obtain consent or give notice under the TCPA, CAN-SPAM, CASL, GDPR, CCPA, recording,
          biometric or right-of-publicity laws; your violation of these Terms or the Acceptable Use Policy; or
          your violation of any law or third-party right.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="15. Changes to these Terms">
        <p>
          We may update these Terms. For material changes we will notify you in the app or by email and ask you
          to accept the updated Terms; continuing to use the Service after they take effect means you accept them.
        </p>
      </LegalSection>

      <LegalSection id="arbitration" title="16. Dispute resolution, arbitration and class-action waiver">
        <p>
          <strong>Informal resolution first.</strong> Before filing a claim, contact us at{" "}
          <Mail to={LEGAL.contactEmail} /> and give us 30 days to try to resolve it.
        </p>
        <p>
          <strong>Binding arbitration.</strong> Any dispute arising from these Terms or the Service will be
          resolved by final, binding individual arbitration administered by the American Arbitration Association
          under its applicable rules, seated in {LEGAL.governingLawState}, except that either party may bring an
          individual claim in small-claims court or seek injunctive relief for intellectual-property misuse.
        </p>
        <p>
          <strong>Class-action and jury waiver.</strong> You and we each waive the right to a jury trial and to
          bring or join any class, collective or representative action. If this waiver is found unenforceable for
          a claim, that claim must be decided in court, not arbitration.
        </p>
        <p>
          <strong>Opt-out.</strong> You may opt out of this arbitration agreement by emailing{" "}
          <Mail to={LEGAL.contactEmail} /> within 30 days of first accepting these Terms.
        </p>
      </LegalSection>

      <LegalSection id="general" title="17. Governing law and general terms">
        <p>
          These Terms are governed by the laws of the State of {LEGAL.governingLawState} and applicable US federal
          law, without regard to conflict-of-law rules. Subject to section 16, courts in {LEGAL.venue} have
          exclusive jurisdiction. These Terms, with the policies they reference, are the entire agreement between
          us. If any part is unenforceable, the rest remains in effect. You may not assign these Terms without our
          consent. Our failure to enforce a provision is not a waiver.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="18. Contact">
        <ContactBlock />
        <p>
          Abuse and takedown reports: <Mail to={LEGAL.abuseEmail} />
        </p>
      </LegalSection>
    </article>
  );
}
