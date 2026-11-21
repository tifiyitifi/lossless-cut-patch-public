import { githubUrl } from './links.ts';
import { getAppLinkUrl, websiteUrl } from './websiteUrls.ts';

export { githubUrl, supportEmail } from './links.ts';

// patch: the fork's own release source. The update check, the "Download {{version}}" menu item and
// the "All release notes" link all follow these constants. They must point at this fork's public
// repository, never at upstream: comparing against upstream releases would offer the official build
// as an "update" and replace this fork.
export const forkReleaseOwner = 'tifiyitifi';
export const forkReleaseRepoName = 'lossless-cut-patch-public';
export const isForkReleaseConfigured = () => Boolean(forkReleaseOwner) && Boolean(forkReleaseRepoName);

// patch: canonical repository URLs for this build vs upstream. `forkGithubUrl` is what
// "Source code", the About panel "This build" line and fork issues resolve to;
// `githubUrl` (from links.ts) stays the upstream original for the second line / item.
export const forkGithubUrl = `https://github.com/${forkReleaseOwner}/${forkReleaseRepoName}`;

export const homepageUrl = `${websiteUrl}/`;
export const getReleaseUrl = (version: string) => {
  if (isForkReleaseConfigured()) return `https://github.com/${forkReleaseOwner}/${forkReleaseRepoName}/releases/tag/v${version}`;
  return `${githubUrl}/releases/tag/v${version}`;
};
export const compareReleasesUrl = (fromVersion: string, toVersion: string) => `${githubUrl}/compare/v${fromVersion}...v${toVersion}`;
export const licensesUrl = getAppLinkUrl('licenses');
export const thanksUrl = getAppLinkUrl('thanks');
export const discussionsUrl = getAppLinkUrl('discussions');
export const discordUrl = getAppLinkUrl('discord');
// Link to losslesscut.app pages (and anything that may move) only through websiteUrls.ts, see the rules there.
export const usageUrl = getAppLinkUrl('usage');
export const faqUrl = getAppLinkUrl('faq');
export const featureRequestUrl = getAppLinkUrl('feature-request');
export const publicBugReportUrl = getAppLinkUrl('bug-report');
export const troubleshootingUrl = getAppLinkUrl('troubleshooting');
export const exportedFileNameTemplateHelpUrl = getAppLinkUrl('file-name-template');
export const selectSegmentByExpressionHelpUrl = getAppLinkUrl('select-segments-by-expression');
export const editSegmentByExpressionHelpUrl = getAppLinkUrl('edit-segments-by-expression');
export const changeEnabledStreamsExpressionHelpUrl = getAppLinkUrl('select-tracks-by-expression');
