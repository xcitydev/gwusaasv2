import type { Metadata } from "next";
import Link from "next/link";
import { LegalHeader, LegalList, LegalSection, Mail } from "@/components/marketing/legal-page";
import { LEGAL, LEGAL_LINKS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: `What you may and may not do with ${LEGAL.productName}.`,
};

/** Acceptable Use Policy — part of the Terms (section 4). */
export default function AcceptableUsePage() {
  return (
    <article>
      <LegalHeader
        title="Acceptable Use Policy"
        intro={
          <p>
            This policy is part of our <Link href={LEGAL_LINKS.terms}>Terms of Service</Link>. It applies to
            everything you do with {LEGAL.productName}: emails, calls, messages, recordings, lead searches and AI
            generations. If we believe you have broken it, we may remove content, pause campaigns or numbers, or
            suspend your account.
          </p>
        }
      />

      <LegalSection title="Email outreach">
        <LegalList
          items={[
            "Send only to business contacts with a legitimate reason to hear from you, and only lawful, truthful content.",
            "Never use false or misleading sender names, headers or subject lines.",
            "Keep the unsubscribe footer and your postal address in every campaign email, and never re-add anyone who opted out.",
            "No purchased consumer lists, harvested personal (non-business) addresses, or sending to people who asked not to be contacted.",
            "Do not try to evade sending limits, spam filters or deliverability controls.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Calls, voice agents and texts">
        <LegalList
          items={[
            "Have prior express (written, where required) consent before placing AI-voice or prerecorded calls to mobile numbers, and honor the National Do-Not-Call Registry and internal do-not-call requests.",
            "Call only within lawful calling hours for the recipient's time zone.",
            "Disclose that the caller is an AI or automated system where the law requires it, and identify your business.",
            "Tell people when a call is recorded and get consent in all-party-consent jurisdictions.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Meetings and recordings">
        <LegalList
          items={[
            "Only send the note-taker bot to meetings you are allowed to record. It announces in the meeting chat that it is recording — do not hide, rename or disable that notice.",
            "Remove the bot when any participant objects.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Lead data and scraping">
        <LegalList
          items={[
            "Use lead data only for your own lawful business outreach; do not resell or publish it.",
            "Do not search for, compile or contact people based on sensitive traits (health, religion, sexual orientation, ethnicity, etc.), or target minors.",
            "Do not use the Service to stalk, track, dox or harass anyone.",
          ]}
        />
      </LegalSection>

      <LegalSection title="AI content and voice clones">
        <LegalList
          items={[
            "No likeness or voice of a real person without their documented consent — including deepfakes and face-swaps.",
            "No sexual content of any kind involving minors, and no content depicting minors in a sexual, suggestive or exploitative way. We report such content to the authorities.",
            "No sexually explicit or pornographic content.",
            "No impersonation of people, businesses, brands or officials, and no content designed to deceive people about who is speaking.",
            "No defamation, harassment, hate, threats, content promoting violence or self-harm, or political disinformation.",
            "No content that infringes copyrights, trademarks or other rights.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Instagram and other connected platforms">
        <LegalList
          items={[
            "Follow the rules of each connected platform (for example Meta's messaging policies).",
            "Do not give us, or anyone, your platform passwords — connect accounts only through the in-app connection flow.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Security and the platform">
        <LegalList
          items={[
            "No malware, phishing, credential collection or fraud.",
            "No probing, scanning or load-testing the Service, bypassing usage limits or credit charges, or reverse-engineering it.",
            "No reselling or sharing accounts outside your team, except as your plan allows.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Reporting abuse">
        <p>
          Report spam, unwanted calls, misuse of your likeness or any other abuse to <Mail to={LEGAL.abuseEmail} />.
          To have your details removed from our lead data, use the{" "}
          <Link href={LEGAL_LINKS.optOut}>opt-out page</Link>.
        </p>
      </LegalSection>
    </article>
  );
}
