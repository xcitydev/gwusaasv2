const authConfig = {
  providers: [
    {
      // Set CLERK_JWT_ISSUER_DOMAIN on the Convex deployment (Convex dashboard →
      // Settings → Environment Variables). It is the Clerk "Frontend API URL",
      // e.g. https://your-app.clerk.accounts.dev
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
