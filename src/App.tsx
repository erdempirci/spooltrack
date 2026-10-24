import { useEffect, useRef, useState } from 'react';
import { createRepo } from './data';
import { friendlyError, type AppUser, type Repo } from './data/repo';
import type { Project, ProjectData } from './domain/types';
import { Account, Login, Pending, type Theme } from './ui/Account';
import { Icon } from './ui/icons';
import { Materials } from './ui/Materials';
import { Production } from './ui/Production';
import { Reports } from './ui/Reports';
import { Upload } from './ui/Upload';
import { useStored } from './ui/util';

type Page = 'production' | 'materials' | 'reports' | 'upload' | 'account';

export default function App() {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [fatal, setFatal] = useState('');
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useStored<string>('spooltrack.project', '');
  const [data, setData] = useState<{ id: string; data: ProjectData } | null>(null);
  const [page, setPage] = useStored<Page>('spooltrack.page', 'production');
  const [theme, setTheme] = useStored<Theme>('spooltrack.theme', 'system');
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = (msg: string, error = false) => {
    setToast({ msg, error });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 6000 : 3000);
  };

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    createRepo().then(setRepo).catch((e) => setFatal(friendlyError(e)));
  }, []);

  useEffect(() => (repo ? repo.onAuth(setUser) : undefined), [repo]);

  const member = !!user && user.role !== 'pending';
  useEffect(() => {
    if (!repo || !member) return;
    return repo.subscribeProjects(setProjects, (e) => notify(`Projeler yüklenemedi: ${friendlyError(e)}`, true));
  }, [repo, member]);

  const project = projects?.find((p) => p.id === projectId) ?? null;

  // Pick the only/first project automatically when nothing valid is selected.
  useEffect(() => {
    if (projects && projects.length && !project) setProjectId(projects[0].id);
  }, [projects, project, setProjectId]);

  useEffect(() => {
    if (!repo || !project) return;
    setData(null);
    const id = project.id;
    return repo.subscribeProjectData(
      id,
      (d) => setData({ id, data: d }),
      (e) => notify(`Proje verisi yüklenemedi: ${friendlyError(e)}`, true),
    );
  }, [repo, project?.id]);

  if (fatal) return <div className="app"><div className="alert error" style={{ marginTop: 24 }}>Uygulama başlatılamadı: {fatal}</div></div>;
  if (!repo || user === undefined) return <div className="app"><p className="empty">Yükleniyor…</p></div>;
  if (user === null) return <div className="app"><Header repo={repo} /><Login repo={repo} /></div>;
  if (user.role === 'pending') return <div className="app"><Header repo={repo} /><Pending repo={repo} user={user} /></div>;

  const isAdmin = user.role === 'admin';
  const pages: { id: Page; label: string; icon: () => React.JSX.Element }[] = [
    { id: 'production', label: 'Üretim', icon: Icon.production },
    { id: 'materials', label: 'Malzeme', icon: Icon.material },
    ...(isAdmin
      ? [
          { id: 'reports' as Page, label: 'Raporlar', icon: Icon.report },
          { id: 'upload' as Page, label: 'Veri Yükleme', icon: Icon.upload },
        ]
      : []),
    { id: 'account', label: 'Hesap', icon: Icon.account },
  ];
  const current: Page = pages.some((p) => p.id === page) ? page : 'production';
  const projectData = data && project && data.id === project.id ? data.data : null;
  const needsProject = current === 'production' || current === 'materials' || current === 'reports';

  return (
    <div className="app">
      <Header repo={repo} />
      <main className="stack">
        {needsProject && (
          projects === null ? <p className="empty">Projeler yükleniyor…</p>
          : projects.length === 0 ? (
            <div className="card empty">
              <p>Henüz proje yok.</p>
              {isAdmin ? <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setPage('upload')}>Veri Yükleme'den proje oluştur</button>
                : <p className="small">Yöneticinin proje oluşturması gerekiyor.</p>}
            </div>
          ) : (
            <label className="field">
              Proje
              <select value={project?.id ?? ''} onChange={(e) => setProjectId(e.target.value)} data-testid="sel-project">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )
        )}
        {needsProject && project && !projectData && projects?.length ? <p className="empty">Proje verisi yükleniyor…</p> : null}
        {current === 'production' && project && projectData && (
          <Production key={project.id} repo={repo} user={user} project={project} data={projectData} notify={notify} />
        )}
        {current === 'materials' && project && projectData && <Materials key={project.id} project={project} data={projectData} />}
        {current === 'reports' && isAdmin && project && projectData && <Reports project={project} data={projectData} />}
        {current === 'upload' && isAdmin && (
          <Upload repo={repo} projects={projects ?? []} project={project} data={projectData} onSelectProject={setProjectId} notify={notify} />
        )}
        {current === 'account' && <Account repo={repo} user={user} theme={theme} setTheme={setTheme} notify={notify} />}
      </main>
      <nav className="bottomnav" aria-label="Ana menü">
        {pages.map((p) => (
          <button key={p.id} aria-current={current === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}>
            <p.icon />
            {p.label}
          </button>
        ))}
      </nav>
      {toast && <div className={`toast${toast.error ? ' error' : ''}`} role="status">{toast.msg}</div>}
    </div>
  );
}

function Header({ repo }: { repo: Repo }) {
  return (
    <header className="topbar">
      <span className="brand"><Icon.logo /> SpoolTrack</span>
      <span className="spacer" />
      <span className="mode-pill" title={repo.mode === 'local' ? 'Veriler bu cihazda saklanıyor' : 'Firebase ile senkronize'}>
        {repo.mode === 'local' ? 'Yerel mod' : 'Firebase'}
      </span>
    </header>
  );
}
