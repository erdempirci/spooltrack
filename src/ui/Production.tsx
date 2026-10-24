import { useEffect, useMemo, useState } from 'react';
import type { AppUser, Repo } from '../data/repo';
import { friendlyError } from '../data/repo';
import { countSpools, isosInSelection, locationOptions, matchesSelection, systemOptions, type LocationOption } from '../domain/progress';
import { STATUS_LABEL, STATUS_ORDER, type Project, type ProjectData, type Spool, type SpoolStatus } from '../domain/types';
import { StatusBadge, StatusIcon } from './icons';
import { useStored } from './util';

interface Props {
  repo: Repo;
  user: AppUser;
  project: Project;
  data: ProjectData;
  notify: (msg: string, error?: boolean) => void;
}

type Filter = 'all' | SpoolStatus;

export function Production({ repo, user, project, data, notify }: Props) {
  const [sel, setSel] = useStored<{ loc: string; system: string }>(`spooltrack.sel.${project.id}`, { loc: '', system: '' });
  const [tab, setTab] = useState<'spool' | 'iso'>('spool');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState<Record<string, SpoolStatus>>({});

  const located = useMemo(() => [...data.spools, ...data.isometrics], [data.spools, data.isometrics]);
  const locations = useMemo(() => locationOptions(located), [located]);
  const locKey = (l: LocationOption) => `${l.locationType}|${l.locationName}`;
  const loc = locations.find((l) => locKey(l) === sel.loc) ?? null;
  const systems = useMemo(() => (loc ? systemOptions(located, loc) : []), [located, loc]);
  const system = systems.includes(sel.system) ? sel.system : '';

  // Auto-pick when there is exactly one choice; otherwise the user chooses.
  useEffect(() => {
    if (!loc && locations.length === 1) setSel({ loc: locKey(locations[0]), system: '' });
  }, [loc, locations, setSel]);
  useEffect(() => {
    if (loc && !system && systems.length === 1) setSel((s) => ({ ...s, system: systems[0] }));
  }, [loc, system, systems, setSel]);

  // Server/DB data wins once it arrives; drop optimistic overrides.
  useEffect(() => setOverrides({}), [data.spools]);

  const selection = useMemo(
    () => (loc && system ? { locationType: loc.locationType, locationName: loc.locationName, system } : null),
    [loc, system],
  );
  const allSpools = useMemo(
    () => data.spools.map((s) => (overrides[s.id] ? { ...s, status: overrides[s.id] } : s)),
    [data.spools, overrides],
  );
  const spools: Spool[] = useMemo(
    () =>
      selection
        ? allSpools
            .filter((s) => matchesSelection(s, selection))
            .sort((a, b) => a.isoNo.localeCompare(b.isoNo, 'tr', { numeric: true }) || a.spoolNo.localeCompare(b.spoolNo, 'tr', { numeric: true }))
        : [],
    [allSpools, selection],
  );
  const isos = useMemo(() => (selection ? isosInSelection(data.isometrics, allSpools, selection) : []), [data.isometrics, allSpools, selection]);
  const counts = countSpools(spools);

  const q = search.trim().toLocaleUpperCase('en-US');
  const visibleSpools = spools.filter(
    (s) => (filter === 'all' || s.status === filter) && (!q || s.spoolNo.includes(q) || s.isoNo.includes(q) || `${s.isoNo} ${s.spoolNo}`.includes(q)),
  );
  const visibleIsos = isos.filter((i) => !q || i.iso.isoNo.includes(q));

  async function change(spool: Spool, status: SpoolStatus) {
    if (spool.status === status) return;
    setOverrides((o) => ({ ...o, [spool.id]: status }));
    try {
      await repo.setSpoolStatus(project.id, spool.id, status, user);
    } catch (e) {
      setOverrides((o) => {
        const n = { ...o };
        delete n[spool.id];
        return n;
      });
      notify(`${spoolTitle(spool)} kaydedilemedi: ${friendlyError(e)}`, true);
    }
  }

  if (data.isometrics.length === 0) {
    return (
      <div className="card empty">
        <p><b>{project.name}</b> projesinde henüz izometri yok.</p>
        <p className="small">{user.role === 'admin' ? 'Veri Yükleme ekranından izometri ve spool Excel dosyalarını yükleyin.' : 'Yöneticinin izometri ve spool listelerini yüklemesi gerekiyor.'}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="selectors">
        <label className="field">
          Zone / Block
          <select
            value={loc ? locKey(loc) : ''}
            onChange={(e) => setSel({ loc: e.target.value, system: '' })}
            data-testid="sel-location"
          >
            <option value="">— Zone / Block seçin —</option>
            {(['Zone', 'Block'] as const).map((t) => {
              const opts = locations.filter((l) => l.locationType === t);
              return opts.length ? (
                <optgroup key={t} label={t}>
                  {opts.map((l) => (
                    <option key={locKey(l)} value={locKey(l)}>{`${l.locationType} ${l.locationName}`}</option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <label className="field">
          Sistem
          <select value={system} disabled={!loc} onChange={(e) => setSel((s) => ({ ...s, system: e.target.value }))} data-testid="sel-system">
            <option value="">{loc ? '— Sistem seçin —' : 'Önce Zone / Block seçin'}</option>
            {systems.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field full">
          Ara
          <input type="search" placeholder="Spool veya izometri no" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {!loc || !system ? (
        <div className="card empty">Spoolları görmek için {loc ? 'sistem' : 'Zone / Block ve sistem'} seçin.</div>
      ) : (
        <>
          <div className="stats" data-testid="stats">
            <div className="stat"><div className="v">{counts.total}</div><div className="l">Toplam spool</div></div>
            <div className="stat"><div className="v">{counts.baslamadi}</div><div className="l"><StatusIcon status="baslamadi" />Başlamadı</div></div>
            <div className="stat"><div className="v">{counts.devam}</div><div className="l"><StatusIcon status="devam" />Devam Ediyor</div></div>
            <div className="stat"><div className="v">{counts.bitti}</div><div className="l"><StatusIcon status="bitti" />Bitti</div></div>
            <div className="stat wide">
              <div className="v" data-testid="overall-pct">%{counts.pct.toLocaleString('tr-TR')}</div>
              <div className="progress" role="progressbar" aria-valuenow={counts.pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${counts.pct}%` }} /></div>
              <div className="l">Genel ilerleme</div>
            </div>
          </div>

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'spool'} onClick={() => setTab('spool')}>SPOOL ({counts.total})</button>
            <button role="tab" aria-selected={tab === 'iso'} onClick={() => setTab('iso')}>ISO ({isos.length})</button>
          </div>

          {tab === 'spool' ? (
            <>
              <div className="chips" role="group" aria-label="Durum filtresi">
                {(['all', ...STATUS_ORDER] as Filter[]).map((f) => (
                  <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {f !== 'all' && <StatusIcon status={f} />}
                    {f === 'all' ? 'Tümü' : STATUS_LABEL[f]}
                    <span className="n">{f === 'all' ? counts.total : counts[f]}</span>
                  </button>
                ))}
              </div>
              {visibleSpools.length === 0 ? (
                <div className="card empty">{spools.length === 0 ? 'Bu sistemde tanımlı spool yok.' : 'Filtreye uyan spool yok.'}</div>
              ) : (
                <div className="list spools" data-testid="spool-list">
                  {visibleSpools.map((s) => (
                    <div className="item" key={s.id} data-spool={spoolTitle(s)}>
                      <div className="head">
                        <div className="title">{spoolTitle(s)}</div>
                        <div className="meta">
                          İzometri {s.isoNo} · Rev {s.revision}
                          {loc?.locationType === 'Zone' && s.block ? ` · Block ${s.block}` : ''}
                          {loc?.locationType === 'Block' && s.zone ? ` · Zone ${s.zone}` : ''}
                        </div>
                        {s.note && <div className="note" role="note">⚠ {s.note}</div>}
                      </div>
                      <div className="statusbtns" role="group" aria-label={`${spoolTitle(s)} durumu`}>
                        {STATUS_ORDER.map((st) => (
                          <button key={st} className={`s-${st}`} aria-pressed={s.status === st} onClick={() => change(s, st)}>
                            <StatusIcon status={st} />
                            {STATUS_LABEL[st]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="table-scroll">
              <table className="data responsive" data-testid="iso-table">
                <thead>
                  <tr>
                    <th>İzometri</th><th>Rev</th><th className="num">Toplam</th><th className="num">Başlamadı</th>
                    <th className="num">Devam</th><th className="num">Bitti</th><th>İlerleme</th><th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIsos.map((i) => (
                    <tr key={i.iso.id} data-iso={i.iso.isoNo}>
                      <td className="lead" data-label="İzometri">{i.iso.isoNo}</td>
                      <td data-label="Revizyon">{i.iso.revision}</td>
                      <td className="num" data-label="Toplam spool">{i.total}</td>
                      <td className="num" data-label="Başlamadı">{i.baslamadi}</td>
                      <td className="num" data-label="Devam Ediyor">{i.devam}</td>
                      <td className="num" data-label="Bitti">{i.bitti}</td>
                      <td data-label="İlerleme">
                        {i.total ? (
                          <span className="row" style={{ flexWrap: 'nowrap' }}>
                            <span className="progress" style={{ width: 70 }}><span style={{ width: `${i.pct}%` }} /></span>
                            <span className="iso-pct">%{i.pct.toLocaleString('tr-TR')}</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td data-label="Durum"><StatusBadge status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted" style={{ marginTop: 8 }}>ISO durumu elle değiştirilmez; spool durumlarından otomatik hesaplanır.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Report spool numbers are short (S01) and only unique within a pipeline; templates repeat the iso no. */
export function spoolTitle(s: Spool): string {
  return s.spoolNo.startsWith(s.isoNo) ? s.spoolNo : `${s.isoNo} ${s.spoolNo}`;
}
