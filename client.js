window.__ModuleLoader__.load({
  id: 'dsh-procedures',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const FEED_REPO = 'fubai-fenzhi/dsh-procedures-community';
    const FEED_TTL = 60 * 60 * 1000;
    const FEED_KEY = 'dsh-procedures-community-feed';
    const PLUGIN_NAME = 'dsh-procedures';
    const PLUGIN_VERSION = '1.6.5';
    const UPDATE_KEY = 'dsh-procedures-update-check';

    function compareVersions(left, right) {
      const a = String(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
      const b = String(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
      for (let index = 0; index < 3; index += 1) {
        if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0) ? 1 : -1;
      }
      return 0;
    }

    async function fetchLatestVersion() {
      try {
        const cached = JSON.parse(window.localStorage.getItem(UPDATE_KEY) ?? 'null');
        if (cached && Date.now() - cached.at < FEED_TTL) return cached.version;
        const response = await fetch(`https://registry.npmjs.org/${PLUGIN_NAME}`, {
          headers: { Accept: 'application/vnd.npm.install-v1+json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const version = data?.['dist-tags']?.latest ?? null;
        window.localStorage.setItem(UPDATE_KEY, JSON.stringify({ at: Date.now(), version }));
        return version;
      } catch {
        return null;
      }
    }

    function useUpdate(refreshTick) {
      const [latest, setLatest] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        fetchLatestVersion()
          .then((version) => {
            if (alive && version) setLatest(version);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, [refreshTick]);
      return latest;
    }

    const store = { open: false, refresh: 0, subs: new Set() };
    function notify() {
      for (const listener of store.subs) listener();
    }
    function setStoreOpen(value) {
      store.open = value;
      notify();
    }
    function bumpRefresh() {
      store.refresh += 1;
      notify();
    }
    function useStore() {
      const [state, setState] = React.useState({ open: store.open, refresh: store.refresh });
      React.useEffect(() => {
        const listener = () => setState({ open: store.open, refresh: store.refresh });
        store.subs.add(listener);
        return () => store.subs.delete(listener);
      }, []);
      return state;
    }

    function readCachedFeed() {
      try {
        const raw = window.localStorage.getItem(FEED_KEY);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        return cached && cached.feed ? cached : null;
      } catch {
        return null;
      }
    }

    async function fetchFeed({ force = false } = {}) {
      const cached = readCachedFeed();
      if (!force && cached && Date.now() - cached.at < FEED_TTL) return cached.feed;
      try {
        const headers = { Accept: 'application/vnd.github+json' };
        const [listResponse, commitResponse] = await Promise.all([
          fetch(`https://api.github.com/repos/${FEED_REPO}/contents/cards`, { headers }),
          fetch(`https://api.github.com/repos/${FEED_REPO}/commits?per_page=10`, { headers }),
        ]);
        if (!listResponse.ok) throw new Error(`HTTP ${listResponse.status}`);
        const list = await listResponse.json();
        const commits = commitResponse.ok ? await commitResponse.json() : [];
        const cards = Array.isArray(list)
          ? list.filter((entry) => entry.type === 'file' && String(entry.name).endsWith('.md')).length
          : 0;
        const latest = [];
        for (const commit of commits) {
          const match = /^Add community card (.+)$/.exec(commit.commit?.message ?? '');
          if (!match) continue;
          latest.push({ name: match[1], at: commit.commit?.author?.date ?? null });
          if (latest.length >= 5) break;
        }
        const feed = { cards, latest, fetchedAt: new Date().toISOString() };
        try {
          window.localStorage.setItem(FEED_KEY, JSON.stringify({ at: Date.now(), feed }));
        } catch {
          // localStorage may be disabled; the in-memory feed still works
        }
        return feed;
      } catch {
        return cached ? cached.feed : null;
      }
    }

    function useFeed(refreshTick) {
      const [feed, setFeed] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        fetchFeed({ force: refreshTick > 0 })
          .then((data) => {
            if (alive && data) setFeed(data);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, [refreshTick]);

      React.useEffect(() => {
        const timer = setInterval(() => {
          fetchFeed().then((data) => {
            setFeed((previous) => data ?? previous);
          }).catch(() => {});
        }, 24 * 60 * 60 * 1000);
        return () => clearInterval(timer);
      }, []);

      return feed;
    }

    function FeedPanel() {
      const { refresh } = useStore();
      const feed = useFeed(refresh);
      const latestVersion = useUpdate(refresh);
      const items = feed?.latest ?? [];
      const [index, setIndex] = React.useState(0);
      const hasUpdate = latestVersion ? compareVersions(latestVersion, PLUGIN_VERSION) > 0 : false;
      const [submitBusy, setSubmitBusy] = React.useState(false);
      const [submitUrls, setSubmitUrls] = React.useState([]);
      const [submitNote, setSubmitNote] = React.useState('');
      const [submitError, setSubmitError] = React.useState('');

      const submitCards = async () => {
        const popup = window.open('', '_blank');
        setSubmitBusy(true);
        setSubmitError('');
        setSubmitNote('');
        setSubmitUrls([]);
        try {
          const response = await fetch('/dsh-procedures/contribute/open');
          const data = await response.json();
          if (!response.ok) throw new Error(String(data.error ?? `HTTP ${response.status}`));
          const urls = Array.isArray(data.urls) ? data.urls : [];
          const duplicates = Array.isArray(data.duplicates) ? data.duplicates : [];
          const notes = [];
          if (urls.length > 0) {
            if (popup && !popup.closed) popup.location.href = urls[0];
            else window.open(urls[0], '_blank');
            setSubmitUrls(urls.slice(1));
            notes.push(`已打开第 1 张卡的 GitHub 提交页；登录后点 Create 即完成。${urls.length > 1 ? `剩余 ${urls.length - 1} 个链接在下方。` : ''}`);
          } else if (popup && !popup.closed) {
            popup.close();
          }
          if (duplicates.length > 0) {
            notes.push(`已提交过 ${duplicates.length} 张（等审核）：${duplicates.map((item) => `#${item.number}`).join(', ')}`);
          }
          if (urls.length === 0 && duplicates.length === 0) notes.push('没有可提交的新卡（可能都已在社区库）');
          setSubmitNote(notes.join('；'));
        } catch (cause) {
          if (popup && !popup.closed) popup.close();
          setSubmitError(String(cause));
        } finally {
          setSubmitBusy(false);
        }
      };

      React.useEffect(() => {
        if (items.length <= 1) return undefined;
        const timer = setInterval(() => setIndex((current) => (current + 1) % items.length), 3000);
        return () => clearInterval(timer);
      }, [items.length]);

      const current = items.length > 0 ? items[index % items.length] : null;
      const mono = { fontFamily: 'monospace', fontSize: '12px' };

      return h('div', { style: { padding: '16px', display: 'grid', gap: '10px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          h('h3', { style: { margin: 0 } }, 'Procedures · 社区动态'),
          h('button', { onClick: bumpRefresh, style: { fontSize: '12px', padding: '2px 8px' } }, '刷新')),
        h('div', { style: { fontSize: '12px', opacity: 0.75 } },
          feed
            ? `社区卡库 ${feed.cards} 张卡${feed.fetchedAt ? `（更新于 ${feed.fetchedAt.slice(0, 10)}）` : ''}`
            : '读取中…'),
        h('div', { style: { fontSize: '12px', color: hasUpdate ? '#d29a2a' : 'inherit', opacity: hasUpdate ? 1 : 0.7 } },
          hasUpdate
            ? `插件版本 ${PLUGIN_VERSION} → 有新版 ${latestVersion}；去 设置 → 插件 → 插件市场 更新`
            : `插件版本 ${PLUGIN_VERSION}${latestVersion ? '（已是最新）' : ''}`),
        h('div', { style: { display: 'grid', gap: '6px' } },
          h('button', { onClick: submitCards, disabled: submitBusy },
            submitBusy ? '准备提交链接…' : '一键提交我的卡牌'),
          submitError ? h('p', { style: { color: 'crimson', margin: 0, fontSize: '12px' } }, submitError) : null,
          submitNote ? h('p', { style: { margin: 0, fontSize: '12px', opacity: 0.75 } }, submitNote) : null,
          ...submitUrls.map((url, index) => h('a', {
            key: url,
            href: url,
            target: '_blank',
            rel: 'noreferrer',
            style: { fontSize: '12px' },
          }, `提交 #${index + 2}`))),
        h('div', {
          style: {
            minHeight: '26px',
            overflow: 'hidden',
            border: '1px solid rgba(127,127,127,.35)',
            borderRadius: '8px',
            padding: '3px 8px',
            ...mono,
          },
        },
        current
          ? h('div', { key: `${current.name}-${index}` },
            `● 最近新增：${String(current.name).replace(/\.md$/, '')}`)
          : '暂无社区动态'),
        h('div', { style: { display: 'grid', gap: '2px', ...mono, opacity: 0.7 } },
          ...items.map((item) => h('div', { key: item.name }, `· ${String(item.name).replace(/\.md$/, '')}`))),
        h('div', { style: { fontSize: '12px', opacity: 0.6 } },
          '提交自己的卡：procedures contribute --open（免 token，生成提交链接）'),
      );
    }

    function FooterAction() {
      return h('button', {
        title: 'Procedures community (click to refresh)',
        onClick: () => {
          setStoreOpen(true);
          bumpRefresh();
        },
        style: {
          padding: '4px 8px',
          fontSize: '12px',
          borderRadius: '6px',
          border: '1px solid rgba(127,127,127,.4)',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        },
      }, 'Procedures');
    }

    function Overlay() {
      const { open } = useStore();
      if (!open) return null;
      return h('div', {
        style: {
          position: 'fixed',
          top: '48px',
          right: '24px',
          width: '440px',
          maxHeight: '70vh',
          overflow: 'auto',
          background: 'rgba(28,28,30,0.98)',
          border: '1px solid rgba(127,127,127,.4)',
          borderRadius: '12px',
          zIndex: 9999,
          boxShadow: '0 12px 40px rgba(0,0,0,.45)',
          color: 'inherit',
        },
      },
      h('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(127,127,127,.3)',
        },
      },
      h('strong', null, 'Procedures'),
      h('button', { onClick: () => setStoreOpen(false) }, '关闭')),
      h(FeedPanel));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'procedures',
          order: 51,
          label: 'Procedures',
        }, FeedPanel));
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'procedures',
          order: 60,
          label: 'Procedures',
        }, FooterAction));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'procedures-overlay',
          order: 60,
        }, Overlay));
      },
    };
  },
});
