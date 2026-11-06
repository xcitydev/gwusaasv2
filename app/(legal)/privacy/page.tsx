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
  title: "Privacy Policy",
  description: `How ${LEGAL.productName} collects, uses and protects personal information.`,
};

/** Service providers that process personal data for us, by function. */
const SUBPROCESSORS: [string, string][] = [
  ["Clerk", "Account sign-in and authentication"],
  ["Convex", "Application database, file storage and backend hosting"],
  ["Vercel", "Website and application hosting"],
  ["Whop", "Payments, subscriptions, refunds and referral payouts"],
  ["Anthropic", "AI language models (assistant, reply drafting, summaries, classification)"],
  ["Bland", "AI phone calls, phone numbers, call recording and voice cloning"],
  ["ElevenLabs", "Voice cloning and text-to-speech"],
  ["Recall.ai", "Meeting bot that records and transcribes meetings you send it to"],
  ["fal", "AI image, video and audio generation"],
  ["Higgsfield", "AI image and video generation"],
  ["Apify", "Collection of publicly available business and social-profile data for lead search"],
  ["Explorium", "Licensed B2B company and contact data"],
  ["Instantly", "Email sending infrastructure, inbox warm-up and reply collection"],
  ["GoHighLevel (LeadConnector)", "Instagram direct-message connection and delivery"],
  ["Cal.com", "Meeting booking links and calendar scheduling"],
];

export default function PrivacyPage() {
  const product = LEGAL.productName;
  return (
    <article>
      <LegalHeader
        title="Privacy Policy"
        intro={
          <>
            <p>
              This policy explains how {LEGAL.companyName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses,
              shares and protects personal information when you use {product} (the &ldquo;Service&rdquo;) or visit
              our website, and the choices you have.
            </p>
            <p>
              Two roles apply. For your account, billing and website use, <strong>we are the controller</strong>.
              For the data our customers put into the Service — their contacts, leads, recordings and messages —{" "}
              <strong>we act as a service provider/processor</strong> on the customer&apos;s instructions. For
              business lead data we compile from public and licensed sources, we are the controller (see section 3
              and the <Link href={LEGAL_LINKS.optOut}>opt-out page</Link>).
            </p>
          </>
        }
      />

      <LegalSection id="collect" title="1. Information we collect">
        <LegalList
          items={[
            <><strong>Account data</strong> — name, email, profile image, workspace and team details, sign-in
              records.</>,
            <><strong>Billing data</strong> — plan, purchases, credit history and referral earnings. Card details are
              collected and held by our payment processor, not by us.</>,
            <><strong>Content you create or upload</strong> — campaign scripts, prompts, images, video, audio,
              forms, support tickets and AI chat history.</>,
            <><strong>Contacts and leads you import</strong> — names, business emails, phone numbers, company,
              title, location and notes.</>,
            <><strong>Email outreach data</strong> — connected inbox addresses (passwords are encrypted), sent
              emails, replies and engagement statistics.</>,
            <><strong>Call recordings and transcripts</strong> — audio, transcripts, summaries and metadata from
              calls made or answered by the AI receptionist and qualifier.</>,
            <><strong>Meeting recordings and transcripts</strong> — audio/video, transcripts, participant names,
              chat messages and AI notes from meetings you send the note taker to.</>,
            <><strong>Voice samples</strong> — recordings you provide to clone a voice (see section 4).</>,
            <><strong>Instagram messages</strong> — conversations, contact names and handles from accounts you
              connect.</>,
            <><strong>Connected-service data</strong> — calendar events and tokens for integrations you connect
              (for example calendars, task tools).</>,
            <><strong>Usage and device data</strong> — IP address, browser, pages viewed, actions taken and error
              logs, collected through cookies and similar technologies needed to run the Service.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="lead-data" title="2. Business lead data we compile">
        <p>
          To power lead search, we collect publicly available business information — such as names, job titles,
          company names, business email addresses, business phone numbers, websites, locations and public social
          profile details (for example Instagram usernames and bios) — from public web sources, business listings
          and licensed data providers. We store it in a shared lead library, record the source it came from, and
          delete entries older than 12 months. Customers who search see contact details only after they import a
          lead.
        </p>
        <p>
          If you are in our lead data and don&apos;t want to be, use the{" "}
          <Link href={LEGAL_LINKS.optOut}>Do Not Sell / Opt-out page</Link>. We remove matching entries from the
          library and add you to a suppression list so you are not re-added or emailed through our platform.
        </p>
      </LegalSection>

      <LegalSection id="use" title="3. How we use information">
        <LegalList
          items={[
            "to provide, operate and secure the Service, including running the features you choose;",
            "to process payments, credits, refunds and referral commissions;",
            "to send service messages (receipts, security notices, changes to terms);",
            "to provide customer support and investigate abuse;",
            "to improve and debug the Service using aggregated or de-identified data;",
            "to comply with law and enforce our Terms.",
          ]}
        />
        <p>
          We do not use customer content (recordings, transcripts, messages, voice samples, leads you import) to
          train AI models. Legal bases under the GDPR: performance of a contract, legitimate interests (security,
          improvement, B2B lead data), consent (where asked), and legal obligation.
        </p>
      </LegalSection>

      <LegalSection id="biometric" title="4. Voice samples and biometric notice">
        <p>
          When you clone a voice, the recording you upload or record is sent to our voice providers to create a
          voice model. A voice model may be considered a biometric identifier under some laws (such as Illinois
          BIPA). By cloning a voice you confirm that you are the speaker, or that the speaker has given written
          consent after being told about this collection, its purpose and retention.
        </p>
        <LegalList
          items={[
            "Purpose: only to generate speech in that voice for your account (calls, voice notes, audio).",
            "We never sell, lease or trade voice samples or voice models, and never use them to identify people.",
            "Retention: kept while the voice exists in your account. When you delete the voice, or close your account, we delete the sample and request deletion of the model from our providers within 30 days — and in any case within 3 years of your last interaction with the Service.",
            <>To have a voice deleted that was cloned without your consent, email <Mail to={LEGAL.privacyEmail} />.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="recordings" title="5. Call and meeting recordings">
        <p>
          The AI receptionist and qualifier record and transcribe calls, and the note taker records meetings it
          joins and announces in the meeting chat that it is recording. Our customers decide when these features
          are used and are responsible for giving notice and getting consent where the law requires. Recordings
          and transcripts are kept until the customer deletes them or closes their account, then deleted from our
          systems within 30 days (backups roll off within 90 days).
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="6. How we share information">
        <p>We share personal information only:</p>
        <LegalList
          items={[
            "with the service providers listed below, who process it on our behalf under contract;",
            "with the third-party services you choose to connect;",
            "within your workspace, with team members you invite;",
            "if required by law or to protect rights, safety and the Service;",
            "in a merger, acquisition or sale of assets, subject to this policy.",
          ]}
        />
        <p>
          <strong>We do not sell personal information for money.</strong> Because customers can obtain business
          contact details from our lead library, that may be treated as a &ldquo;sale&rdquo; or
          &ldquo;sharing&rdquo; under some state laws — which is why we offer the opt-out described in section 8.
          We do not use third-party advertising cookies.
        </p>
      </LegalSection>

      <LegalSection id="subprocessors" title="7. Service providers (subprocessors)">
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-white/90">
              <tr>
                <th className="px-4 py-2.5 font-medium">Provider</th>
                <th className="px-4 py-2.5 font-medium">Function</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {SUBPROCESSORS.map(([name, fn]) => (
                <tr key={name}>
                  <td className="px-4 py-2.5 text-white/90">{name}</td>
                  <td className="px-4 py-2.5">{fn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Most providers are located in the United States. We may update this list as our providers change.</p>
      </LegalSection>

      <LegalSection id="ccpa" title="8. Your US state privacy rights (including California)">
        <p>
          Depending on where you live (for example California, Colorado, Connecticut, Virginia, Texas, Oregon), you
          may have the right to know what personal information we hold, to access, correct and delete it, to
          obtain a portable copy, to opt out of the sale or sharing of personal information and of targeted
          advertising, and not to be discriminated against for exercising these rights.
        </p>
        <p>
          <strong>Do Not Sell or Share My Personal Information:</strong> submit the{" "}
          <Link href={LEGAL_LINKS.optOut}>opt-out form</Link> — no account needed. For any other request, email{" "}
          <Mail to={LEGAL.privacyEmail} />. We verify requests by matching information you provide, respond within
          45 days, and accept requests from authorized agents with proof of authorization. You may appeal a denied
          request by replying to our decision.
        </p>
        <p>
          Categories collected in the last 12 months: identifiers, commercial information, internet activity,
          audio/electronic information (recordings), professional information, and — for voice clones — biometric
          information. Sources and purposes are described above.
        </p>
      </LegalSection>

      <LegalSection id="gdpr" title="9. Rights in the EEA, UK and Switzerland">
        <p>
          You have the right to access, rectify, erase, restrict or object to processing of your personal data, to
          data portability, and to withdraw consent at any time. You may object at any time to processing based on
          legitimate interests, including the business lead library. Contact <Mail to={LEGAL.privacyEmail} />. You
          may also complain to your local data-protection authority. Where data is transferred outside your
          region, we rely on Standard Contractual Clauses or other lawful transfer mechanisms. If the data was put
          into the Service by one of our customers, we will refer your request to that customer and assist them.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="10. Retention">
        <LegalList
          items={[
            "Account and workspace data: while your account is open, then deleted within 30 days of closure (backups within 90 days).",
            "Billing and tax records: as long as the law requires (typically 7 years).",
            "Shared lead library entries: up to 12 months from collection.",
            "Opt-out and unsubscribe (suppression) records: kept indefinitely, so we can keep honoring them.",
            "Recordings, transcripts and voice samples: see sections 4 and 5.",
            "Security and error logs: up to 12 months.",
          ]}
        />
      </LegalSection>

      <LegalSection id="security" title="11. Security">
        <p>
          We use encryption in transit, encryption at rest for credentials and sensitive fields, access controls
          and least-privilege access for staff. No system is perfectly secure; we will notify you of a breach
          affecting your data as required by law.
        </p>
      </LegalSection>

      <LegalSection id="children" title="12. Children">
        <p>
          The Service is for adults 18 and over. We do not knowingly collect personal information from children.
          Contact us if you believe a child has provided us data and we will delete it.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="13. Changes">
        <p>
          We will post updates here and, for material changes, notify account holders in the app or by email.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="14. Contact">
        <ContactBlock />
        <p>
          Privacy requests: <Mail to={LEGAL.privacyEmail} />
        </p>
      </LegalSection>
    </article>
  );
}
