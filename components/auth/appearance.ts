/**
 * Clerk <SignIn>/<SignUp> restyled to sit inside our auth layout: no card,
 * no Clerk header (our own headline sits above it), white Google button,
 * dark fields with the brand-blue focus ring and primary button.
 */
const BRAND_BLUE = "#3b82f6";
const BRAND_BLUE_TEXT = "#93c5fd";

export const authAppearance = {
  options: {
    logoPlacement: "none" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      maxWidth: "100%",
      boxShadow: "none",
      border: "none",
      borderRadius: 0,
      background: "transparent",
    },
    card: {
      background: "transparent",
      boxShadow: "none",
      border: "none",
      padding: 0,
      gap: "1.25rem",
    },
    header: { display: "none" },
    socialButtonsBlockButton: {
      height: "50px",
      borderRadius: "14px",
      background: "#ffffff",
      border: "none",
      boxShadow: "none",
      "&:hover": { background: "#efefef" },
    },
    socialButtonsBlockButtonText: { color: "#111111", fontSize: "15px", fontWeight: 600 },
    // Clerk's "Last used" tab normally hangs off the button's top edge, where
    // our layout clips it — sit it inside the button as a small pill instead.
    lastAuthenticationStrategyBadge: {
      position: "absolute",
      top: "50%",
      right: "12px",
      bottom: "auto",
      left: "auto",
      transform: "translateY(-50%)",
      margin: 0,
      height: "auto",
      padding: "3px 9px",
      borderRadius: "999px",
      border: "none",
      background: "#111111",
      color: BRAND_BLUE_TEXT,
      fontSize: "11px",
      fontWeight: 600,
      lineHeight: 1.4,
      boxShadow: "none",
    },
    dividerLine: { background: "rgba(255,255,255,0.1)" },
    dividerText: { color: "rgba(255,255,255,0.45)", fontSize: "12px" },
    formFieldLabel: { fontSize: "13px", fontWeight: 600, color: "#f5f5f4" },
    formFieldInput: {
      height: "50px",
      borderRadius: "14px",
      background: "#121214",
      border: "1px solid rgba(255,255,255,0.12)",
      boxShadow: "none",
      fontSize: "16px", // 16px keeps iOS from zooming into the field
      paddingInline: "16px",
      "&:focus, &:focus-visible": {
        borderColor: BRAND_BLUE,
        boxShadow: "0 0 0 4px rgba(59,130,246,0.18)",
      },
    },
    otpCodeFieldInput: { borderRadius: "12px", background: "#121214" },
    formButtonPrimary: {
      height: "54px",
      borderRadius: "14px",
      background: BRAND_BLUE,
      color: "#ffffff",
      fontSize: "16px",
      fontWeight: 700,
      textTransform: "none" as const,
      boxShadow: "0 0 50px -12px rgba(59,130,246,0.5)",
      "&:hover, &:focus": { background: "#2563eb" },
    },
    footer: { background: "transparent", "& > div": { background: "transparent" } },
    footerActionText: { color: "rgba(255,255,255,0.6)", fontSize: "14px" },
    footerActionLink: { color: BRAND_BLUE_TEXT, fontWeight: 600, fontSize: "14px" },
    identityPreview: { background: "#121214", borderRadius: "14px" },
  },
};
