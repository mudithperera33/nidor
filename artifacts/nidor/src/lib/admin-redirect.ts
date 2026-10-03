const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);

type AdminSignInRedirectOptions = {
  currentOrigin: string;
  basePath: string;
  replitDevDomain?: string;
};

export function buildAdminSignInRedirectUrl({
  currentOrigin,
  basePath,
  replitDevDomain,
}: AdminSignInRedirectOptions): string {
  const currentUrl = new URL(currentOrigin);
  let redirectOrigin = currentUrl.origin;

  if (loopbackHosts.has(currentUrl.hostname.toLowerCase())) {
    const domain = replitDevDomain?.trim();
    if (!domain) {
      throw new Error(
        'This sign-in request started on localhost. Open NIDOR in the Replit preview and try again.',
      );
    }

    const hostedUrl = new URL(`https://${domain}`);
    if (!hostedUrl.hostname.endsWith('.replit.dev')) {
      throw new Error('The Replit preview domain is invalid.');
    }
    redirectOrigin = hostedUrl.origin;
  }

  const adminPath = `${basePath.replace(/\/?$/, '/')}admin/products`;
  return new URL(adminPath, redirectOrigin).toString();
}