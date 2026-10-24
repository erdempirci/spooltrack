import { useMemo } from 'react';
import { buildWorkbook } from '../domain/excel';
import { computeMaterialRows } from '../domain/materials';
import { countSpools, groupProgress, isoProgress, type Counts } from '../domain/progress';
import { STATUS_LABEL, STATUS_ORDER, type Project, type ProjectData, type Spool } from '../domain/types';
import { Icon, StatusBadge } from './icons';
import { materialExportRows } from './Materials';
import { fmt, saveFile, stamp } from './util';

const countCols = (c: Counts) => ({
  'Toplam spool': c.total,
  'Başlamadı': c.baslamadi,
  'Devam Ediyor': c.devam,
  'Bitti': c.bitti,
  'İlerleme %': c.pct,
});

const spoolRow = (s: Spool) => ({
  'Spool no': s.spoolNo,
  'İzometri no': s.isoNo,
  'Revizyon': s.revision,
  'Sistem': s.system,
  'Konum türü': s.locationType,
  'Konum': s.locationName,
  'Durum': STATUS_LABEL[s.status],
  'Son güncelleme': s.updatedAt,
});

function ProgressTable({ title, rows }: { title: string; rows: (Counts & { label: string; key: string })[] }) {
  return (
    <section className="stack">
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="small muted">Kayıt yok.</p> : (
        <table className="data responsive">
          <thead><tr><th></th><th className="num">Toplam</th><th className="num">Başlamadı</th><th className="num">Devam</th><th className="num">Bitti</th><th className="num">İlerleme</th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key}>
                <td className="lead" data-label="">{g.label}</td>
                <td className="num" data-label="Toplam spool">{g.total}</td>
                <td className="num" data-label="Başlamadı">{g.baslamadi}</td>
                <td className="num" data-label="Devam Ediyor">{g.devam}</td>
                <td className="num" data-label="Bitti">{g.bitti}</td>
                <td className="num" data-label="İlerleme">%{g.pct.toLocaleString('tr-TR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function Reports({ project, data }: { project: Project; data: ProjectData }) {
  const total = countSpools(data.spools);
  const byLoc = useMemo(() => groupProgress(data.spools, (s) => `${s.locationType}|${s.locationName}`, (s) => `${s.locationType} ${s.locationName}`), [data.spools]);
  const bySys = useMemo(() => groupProgress(data.spools, (s) => s.system, (s) => s.system), [data.spools]);
  const isos = useMemo(() => isoProgress(data.isometrics, data.spools), [data.isometrics, data.spools]);
  const mats = useMemo(() => computeMaterialRows(data), [data]);
  const shortages = mats.filter((m) => (m.shortage ?? 0) > 0);

  function exportAll() {
    const sheets = [
      { name: 'Proje ilerlemesi', rows: [{ Proje: project.name, ...countCols(total) }] },
      { name: 'Zone-Block ilerlemesi', rows: byLoc.map((g) => ({ 'Zone/Block': g.label, ...countCols(g) })) },
      { name: 'Sistem ilerlemesi', rows: bySys.map((g) => ({ Sistem: g.label, ...countCols(g) })) },
      {
        name: 'ISO ilerlemesi',
        rows: isos.map((i) => ({
          'İzometri no': i.iso.isoNo, Revizyon: i.iso.revision, Sistem: i.iso.system,
          'Konum': `${i.iso.locationType} ${i.iso.locationName}`, ...countCols(i), 'ISO durumu': STATUS_LABEL[i.status],
        })),
      },
      ...STATUS_ORDER.slice().reverse().map((st) => ({
        name: { bitti: 'Biten spoollar', devam: 'Üretimdeki spoollar', baslamadi: 'Başlamayan spoollar' }[st],
        rows: data.spools.filter((s) => s.status === st).map(spoolRow),
      })),
      { name: 'Kalan malzeme ihtiyacı', rows: materialExportRows(mats) },
      { name: 'Eksik satın alma', rows: materialExportRows(shortages) },
    ];
    // Empty sheets still need a header row to be readable.
    for (const s of sheets) if (s.rows.length === 0) (s as { rows: Record<string, unknown>[] }).rows = [{ Bilgi: 'Kayıt yok' }];
    saveFile(buildWorkbook(sheets), `${project.name}-rapor-${stamp()}.xlsx`.replace(/[\\/:*?"<>|\s]+/g, '_'));
  }


  return (
    <div className="stack">
      <div className="row"><h2 className="grow">Raporlar — {project.name}</h2>
        <button className="btn primary" onClick={exportAll} data-testid="export-report"><Icon.download /> Tüm raporlar Excel</button>
      </div>
      <div className="stats">
        <div className="stat"><div className="v">{total.total}</div><div className="l">Toplam spool</div></div>
        <div className="stat"><div className="v">{total.baslamadi}</div><div className="l">Başlamadı</div></div>
        <div className="stat"><div className="v">{total.devam}</div><div className="l">Devam Ediyor</div></div>
        <div className="stat"><div className="v">{total.bitti}</div><div className="l">Bitti</div></div>
        <div className="stat wide"><div className="v">%{total.pct.toLocaleString('tr-TR')}</div><div className="progress"><span style={{ width: `${total.pct}%` }} /></div><div className="l">Proje genel ilerlemesi</div></div>
      </div>
      <ProgressTable title="Zone / Block ilerlemesi" rows={byLoc} />
      <ProgressTable title="Sistem ilerlemesi" rows={bySys} />
      <section className="stack">
        <h3>ISO ilerlemesi ({isos.length})</h3>
        <details>
          <summary>Listeyi göster</summary>
          <table className="data responsive">
            <thead><tr><th>İzometri</th><th>Rev</th><th>Sistem</th><th>Konum</th><th className="num">Spool</th><th className="num">İlerleme</th><th>Durum</th></tr></thead>
            <tbody>
              {isos.map((i) => (
                <tr key={i.iso.id}>
                  <td className="lead" data-label="İzometri">{i.iso.isoNo}</td>
                  <td data-label="Rev">{i.iso.revision}</td>
                  <td data-label="Sistem">{i.iso.system}</td>
                  <td data-label="Konum">{i.iso.locationType} {i.iso.locationName}</td>
                  <td className="num" data-label="Spool">{i.bitti}/{i.total}</td>
                  <td className="num" data-label="İlerleme">{i.total ? `%${i.pct.toLocaleString('tr-TR')}` : '—'}</td>
                  <td data-label="Durum"><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
      <section className="stack">
        <h3>Eksik satın alma listesi ({shortages.length})</h3>
        {shortages.length === 0 ? <p className="small muted">{mats.length ? 'Eksik satın alma ihtiyacı yok.' : 'Malzeme listesi yüklenmemiş.'}</p> : (
          <table className="data responsive">
            <thead><tr><th>Kod</th><th>Açıklama</th><th>Ölçü</th><th className="num">Kalan ihtiyaç</th><th className="num">Stok</th><th className="num">Eksik</th></tr></thead>
            <tbody>
              {shortages.map((r) => (
                <tr key={r.material.id}>
                  <td className="lead" data-label="Kod">{r.material.code}</td>
                  <td data-label="Açıklama">{r.material.description}</td>
                  <td data-label="Ölçü">{r.material.size}</td>
                  <td className="num" data-label="Kalan ihtiyaç">{fmt(r.remainingNeed)} {r.material.unit}</td>
                  <td className="num" data-label="Stok">{fmt(r.stock)}</td>
                  <td className="num" data-label="Eksik"><b>{fmt(r.shortage)} {r.material.unit}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="small muted">Biten, üretimdeki ve başlamayan spool listeleri Excel raporunda ayrı sayfalardadır.</p>
    </div>
  );
}
