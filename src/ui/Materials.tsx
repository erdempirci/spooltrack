import { useMemo } from 'react';
import { buildWorkbook } from '../domain/excel';
import { computeMaterialRows, filterMaterialRows, isScoped, type MaterialRow } from '../domain/materials';
import { locationOptions } from '../domain/progress';
import type { LocationType, Project, ProjectData } from '../domain/types';
import { Icon } from './icons';
import { fmt, saveFile, stamp, useStored } from './util';

export function materialExportRows(rows: MaterialRow[]) {
  return rows.map((r) => ({
    'Malzeme kodu': r.material.code,
    'Açıklama': r.material.description,
    'Çap/ölçü': r.material.size,
    'Malzeme kalitesi': r.material.grade,
    'Birim': r.material.unit,
    'Toplam ihtiyaç': r.totalNeed,
    'Biten spoollarda kullanılan': r.usedDone,
    'Devam eden spoollara ayrılan': r.reservedInProgress,
    'Başlamayan spool ihtiyacı': r.notStartedNeed,
    'Kalan üretim ihtiyacı': r.remainingNeed,
    'Depo stoğu': r.stock ?? '',
    'Eksik satın alma': r.shortage ?? '',
  }));
}

export function Materials({ project, data }: { project: Project; data: ProjectData }) {
  const [f, setF] = useStored(`spooltrack.matfilter.${project.id}`, { system: '', loc: '', size: '', text: '' });
  const locations = useMemo(() => locationOptions(data.isometrics), [data.isometrics]);
  const systems = useMemo(() => [...new Set(data.isometrics.map((i) => i.system))].sort((a, b) => a.localeCompare(b, 'tr')), [data.isometrics]);
  const sizes = useMemo(() => [...new Set(data.materials.map((m) => m.size).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true })), [data.materials]);

  const [locType, locName] = f.loc ? (f.loc.split('|') as [LocationType, string]) : [null, null];
  const scope = { system: f.system || null, locationType: locType, locationName: locName };
  const scoped = isScoped(scope);
  const rows = useMemo(
    () => filterMaterialRows(computeMaterialRows(data, scope), { size: f.size, text: f.text }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, f],
  );
  const shortCount = rows.filter((r) => (r.shortage ?? 0) > 0).length;

  if (data.materials.length === 0) {
    return <div className="card empty">Bu projede malzeme listesi yüklenmemiş.</div>;
  }

  function exportXlsx() {
    const scopeText = [f.system, f.loc.replace('|', ' '), f.size, f.text].filter(Boolean).join('-');
    saveFile(
      buildWorkbook([{ name: 'Malzeme Durumu', rows: materialExportRows(rows) }]),
      `${project.name}-malzeme${scopeText ? '-' + scopeText : ''}-${stamp()}.xlsx`.replace(/[\\/:*?"<>|\s]+/g, '_'),
    );
  }

  return (
    <div className="stack">
      <div className="row"><h2 className="grow">Malzeme Durumu</h2>
        <button className="btn" onClick={exportXlsx} data-testid="export-materials"><Icon.download /> Excel</button>
      </div>
      <div className="selectors" style={{ gridTemplateColumns: undefined }}>
        <label className="field">Sistem
          <select value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })} data-testid="mat-system">
            <option value="">Tüm sistemler</option>
            {systems.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">Zone / Block
          <select value={f.loc} onChange={(e) => setF({ ...f, loc: e.target.value })}>
            <option value="">Tüm konumlar</option>
            {locations.map((l) => <option key={`${l.locationType}|${l.locationName}`} value={`${l.locationType}|${l.locationName}`}>{`${l.locationType} ${l.locationName}`}</option>)}
          </select>
        </label>
        <label className="field">Çap / ölçü
          <select value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>
            <option value="">Tüm ölçüler</option>
            {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field full">Açıklama / kod
          <input type="search" value={f.text} placeholder="örn. dirsek" onChange={(e) => setF({ ...f, text: e.target.value })} />
        </label>
      </div>
      {scoped ? (
        <div className="alert">Sistem/konum filtresi açık: <b>toplam ihtiyaç</b> bu kapsamdaki spool malzeme listelerinden hesaplanır. Depo stoğu proje geneli olduğu için stok ve eksik satın alma yalnızca filtre kapalıyken gösterilir.</div>
      ) : (
        shortCount > 0 && <div className="alert warn" data-testid="shortage-alert"><b>{shortCount}</b> malzemede eksik satın alma ihtiyacı var.</div>
      )}
      {rows.length === 0 ? (
        <div className="card empty">Filtreye uyan malzeme yok.</div>
      ) : (
        <div className="table-scroll">
          <table className="data responsive" data-testid="material-table">
            <thead>
              <tr>
                <th>Kod</th><th>Açıklama</th><th>Ölçü</th><th>Kalite</th><th>Birim</th>
                <th className="num">Toplam ihtiyaç</th><th className="num">Bitende kullanılan</th><th className="num">Devam edene ayrılan</th>
                <th className="num">Kalan ihtiyaç</th>{!scoped && <><th className="num">Depo stoğu</th><th className="num">Eksik satın alma</th></>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.material.id} className={(r.shortage ?? 0) > 0 ? 'hl' : ''} data-material={r.material.code}>
                  <td className="lead" data-label="Kod">{r.material.code}</td>
                  <td data-label="Açıklama">{r.material.description}</td>
                  <td data-label="Çap/ölçü">{r.material.size}</td>
                  <td data-label="Kalite">{r.material.grade}</td>
                  <td data-label="Birim">{r.material.unit}</td>
                  <td className="num" data-label="Toplam ihtiyaç">{fmt(r.totalNeed)}{r.bomExceedsTotal && <span title="Spool listeleri toplam ihtiyaçtan fazla"> ⚠</span>}</td>
                  <td className="num" data-label="Biten spoollarda kullanılan" data-col="used">{fmt(r.usedDone)}</td>
                  <td className="num" data-label="Devam edenlere ayrılan" data-col="reserved">{fmt(r.reservedInProgress)}</td>
                  <td className="num" data-label="Kalan üretim ihtiyacı" data-col="remaining">{fmt(r.remainingNeed)}</td>
                  {!scoped && <>
                    <td className="num" data-label="Depo stoğu">{fmt(r.stock)}</td>
                    <td className="num" data-label="Eksik satın alma" data-col="shortage"><b>{fmt(r.shortage)}</b></td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.some((r) => r.bomExceedsTotal) && <p className="small muted" style={{ marginTop: 8 }}>⚠ Spool malzeme listelerindeki toplam, toplam malzeme listesindeki ihtiyaçtan fazla. Toplam listeyi kontrol edin.</p>}
        </div>
      )}
    </div>
  );
}
