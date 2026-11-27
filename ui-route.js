import { join } from 'node:path';

import { contribute } from './lib/community.mjs';
import { routeRejection } from './lib/guard.mjs';

export const name = 'dsh-procedures-ui';
export const inject = ['webServer', 'workingDirectory', 'agents'];

/**
 * HTTP companion for the client panel: turns the current workspace's local cards
 * into pre-filled GitHub issue links, so "submit my cards" is one click and needs no token.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-procedures/contribute/open',
    resource: async (request) => {
      // Reading local cards and minting issues on the owner's behalf must pass the
      // Connection Host/Origin and browser-authentication checks first.
      const denied = routeRejection(ctx.get('connection'), request);
      if (denied) {
        return new Response(JSON.stringify({ error: '请求来源校验未通过' }), {
          status: denied,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const url = new URL(request.url);
      let base = url.searchParams.get('dir') ?? '';
      if (!base) {
        try {
          const agent = ctx.agents.list?.()[0];
          base = agent ? ctx.workingDirectory.get(agent.session) : process.cwd();
        } catch {
          base = process.cwd();
        }
      }
      try {
        const result = await contribute({ dirs: [join(base, 'procedures')], open: true, dryRun: true });
        const urls = result.urls ?? [];

        // Skip cards that already have an open submission issue.
        const issuesResponse = await fetch(
          `https://api.github.com/repos/fubai-fenzhi/dsh-procedures-community/issues?state=open&labels=card-submission&per_page=100`,
          { headers: { Accept: 'application/vnd.github+json' } },
        ).catch(() => null);
        const openIssues = issuesResponse?.ok ? await issuesResponse.json() : [];
        const openByTitle = new Map(openIssues.map((issue) => [issue.title, issue.number]));

        const duplicates = [];
        const fresh = [];
        for (const url of urls) {
          const target = new URL(url);
          const title = target.searchParams.get('title') ?? '';
          const name = title.replace(/^\[card\]\s*/, '');
          const number = openByTitle.get(`[card] ${name}`);
          if (number) duplicates.push({ name, number });
          else fresh.push(url);
        }

        return Response.json({ urls: fresh, duplicates, candidates: result.candidates ?? 0 });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    },
  }));
}
