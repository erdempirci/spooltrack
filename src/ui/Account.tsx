import { useEffect, useState } from 'react';
import type { AppUser, Repo, UserRole } from '../data/repo';
import { friendlyError } from '../data/repo';

export type Theme = 'system' | 'light' | 'dark';

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', engineer: 'Üretim Mühendisi', pending: 'Onay bekliyor' };

export function Login({ repo }: { repo: Repo }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      if (mode === 'in') await repo.signIn(email, password);
      else await repo.signUp(email, password, name);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack login" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>{mode === 'in' ? 'Giriş yap' : 'Hesap oluştur'}</h2>
      {mode === 'up' && (
        <label className="field">Ad soyad<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      )}
      <label className="field">E-posta<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
      <label className="field">Şifre<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required minLength={6} /></label>
      {error && <div className="alert error">{error}</div>}
      <button className="btn primary block" disabled={busy}>{busy ? 'Bekleyin…' : mode === 'in' ? 'Giriş yap' : 'Hesap oluştur'}</button>
      <button type="button" className="btn block" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(''); }}>
        {mode === 'in' ? 'Hesabım yok, kayıt ol' : 'Hesabım var, giriş yap'}
      </button>
      {mode === 'up' && <p className="small muted">Yeni hesaplar yönetici onayından sonra kullanılabilir.</p>}
    </form>
  );
}

export function Pending({ repo, user }: { repo: Repo; user: AppUser }) {
  return (
    <div className="card stack login">
      <h2>Onay bekleniyor</h2>
      <p><b>{user.email}</b> hesabı oluşturuldu. Bir yönetici rolünüzü (Üretim Mühendisi veya Admin) atadığında uygulama açılacak.</p>
      <button className="btn block" onClick={() => repo.signOut()}>Çıkış yap</button>
    </div>
  );
}

export function Account({ repo, user, theme, setTheme, notify }: { repo: Repo; user: AppUser; theme: Theme; setTheme: (t: Theme) => void; notify: (m: string, e?: boolean) => void }) {
  return (
    <div className="stack">
      <h2>Hesap ve ayarlar</h2>
      <section className="card stack">
        {repo.mode === 'firebase' ? (
          <>
            <p><b>{user.name || user.email}</b><br /><span className="muted small">{user.email} · {ROLE_LABEL[user.role]}</span></p>
            <button className="btn" onClick={() => repo.signOut()}>Çıkış yap</button>
          </>
        ) : (
          <>
            <div className="alert warn">
              <b>Yerel mod.</b> Veriler yalnızca bu cihazın tarayıcısında saklanır (sayfa yenilense de kalır) ama diğer kullanıcılarla paylaşılmaz.
              Çok kullanıcılı kullanım için Firebase ayarlarını yapın (README).
            </div>
            <label className="field">Bu cihazdaki görünüm
              <select value={user.role} onChange={(e) => repo.setLocalRole?.(e.target.value as 'admin' | 'engineer')} data-testid="local-role">
                <option value="admin">Admin (veri yükleme ve raporlar)</option>
                <option value="engineer">Üretim Mühendisi (sade ekran)</option>
              </select>
            </label>
          </>
        )}
      </section>
      <section className="card stack">
        <label className="field">Tema
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="system">Cihaz ayarı</option>
            <option value="light">Açık</option>
            <option value="dark">Koyu</option>
          </select>
        </label>
      </section>
      {user.role === 'admin' && repo.subscribeUsers && <Users repo={repo} me={user} notify={notify} />}
    </div>
  );
}

function Users({ repo, me, notify }: { repo: Repo; me: AppUser; notify: (m: string, e?: boolean) => void }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [error, setError] = useState('');
  useEffect(() => repo.subscribeUsers!(setUsers, (e) => setError(friendlyError(e))), [repo]);

  async function setRole(u: AppUser, role: UserRole) {
    if (u.uid === me.uid && role !== 'admin' && !confirm('Kendi admin yetkinizi kaldırıyorsunuz. Emin misiniz?')) return;
    try {
      await repo.setUserRole!(u.uid, role);
      notify(`${u.email}: ${ROLE_LABEL[role]}`);
    } catch (e) {
      notify(friendlyError(e), true);
    }
  }

  return (
    <section className="card stack">
      <h3>Kullanıcılar</h3>
      {error && <div className="alert error">{error}</div>}
      {users.map((u) => (
        <div key={u.uid} className="row">
          <div className="grow"><b>{u.name || u.email}</b><br /><span className="small muted">{u.email}</span></div>
          <select style={{ width: 'auto' }} value={u.role} onChange={(e) => setRole(u, e.target.value as UserRole)} aria-label={`${u.email} rolü`}>
            <option value="pending">Onay bekliyor (erişim yok)</option>
            <option value="engineer">Üretim Mühendisi</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      ))}
    </section>
  );
}
