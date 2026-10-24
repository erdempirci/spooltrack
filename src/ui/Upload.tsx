import { useMemo, useState } from 'react';
import type { Repo } from '../data/repo';
import { friendlyError } from '../data/repo';
import { readSheet, readWorkbook, type ParsedSheet } from '../domain/excel';
import { blockingCount, previewReport, reportCanCommit, type ReportPreview } from '../domain/report';
import {
  BLOCKING_ISSUES,
  canCommit,
  ISSUE_LABEL,
  previewIsometrics,
  previewMaterials,
  previewSpoolMaterials,
  previewSpools,
  locLabel,
  REQUIRED_COLUMNS,
  type ImportKind,
  type ImportPreview,
  type IssueKind,
} from '../domain/importers';
import { STATUS_LABEL, type Isometric, type Material, type Project, type ProjectData, type Spool, type SpoolMaterial } from '../domain/types';
import { Icon } from './icons';
import { fmt } from './util';

interface Props {
  repo: Repo;
  projects: Project[];
  project: Project | null;
  data: ProjectData | null;
  onSelectProject: (id: string) => void;
  notify: (msg: string, error?: boolean) => void;
}

interface StepDef {
  kind: ImportKind;
  no: number;
  title: string;
  help: string;
  template: string;
  needs?: (d: ProjectData) => string | null;
}

const STEPS: StepDef[] = [
  { kind: 'isometric', no: 3, title: 'İzometri listesi', help: 'Her satır bir izometri + revizyon. Aynı izometri ve revizyon tekrar yüklenirse ikinci kayıt oluşmaz.', template: 'IZOMETRI_SABLONU.xlsx' },
  { kind: 'spool', no: 4, title: 'Spool listesi', help: 'Spoollar izometri numarası + revizyon ile eşleştirilir. Kayıtlı spoolların üretim durumu yeniden yüklemede değişmez.', template: 'SPOOL_SABLONU.xlsx', needs: (d) => (d.isometrics.length ? null : 'Önce izometri listesini yükleyin.') },
  { kind: 'material', no: 5, title: 'Toplam malzeme listesi', help: 'Projenin toplam malzeme ihtiyacı ve depo stoğu. Yeniden yüklemede miktar ve stok güncellenir.', template: 'TOPLAM_MALZEME_SABLONU.xlsx' },
  { kind: 'spoolMaterial', no: 6, title: 'Spool malzeme listesi', help: 'Her spoolun malzeme miktarları. Spool, izometri, revizyon ve malzeme kodu doğrulanır.', template: 'SPOOL_MALZEME_SABLONU.xlsx', needs: (d) => (!d.spools.length ? 'Önce spool listesini yükleyin.' : !d.materials.length ? 'Önce toplam malzeme listesini yükleyin.' : null) },
];

type AnyPreview = ImportPreview<Isometric> | ImportPreview<Spool> | ImportPreview<Material> | ImportPreview<SpoolMaterial>;

export function Upload({ repo, projects, project, data, onSelectProject, notify }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setError('');
    setBusy(true);
    try {
      const p = await repo.createProject(name);
      setName('');
      onSelectProject(p.id);
      notify(`"${p.name}" projesi oluşturuldu.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h2>Veri Yükleme</h2>
      <section className="card stack">
        <div className="step-head"><span className="step-no">1</span><div><h3>Proje</h3><p className="small muted">Yeni proje oluşturun veya mevcut projeyi seçin. Yüklemeler seçili projeye yapılır.</p></div></div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input type="text" className="grow" placeholder="Yeni proje adı, örn. YACHT 126" value={name} onChange={(e) => setName(e.target.value)} aria-label="Yeni proje adı" />
          <button className="btn primary" disabled={busy || !name.trim()}>Projeyi oluştur</button>
        </form>
        {error && <div className="alert error">{error}</div>}
        {projects.length > 0 && (
          <label className="field">
            Yükleme yapılacak proje
            <select value={project?.id ?? ''} onChange={(e) => onSelectProject(e.target.value)} data-testid="upload-project">
              <option value="" disabled>— Proje seçin —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {project && data && (
          <p className="small muted" data-testid="project-counts">
            {project.name}: {data.isometrics.length} izometri · {data.spools.length} spool · {data.materials.length} malzeme · {data.spoolMaterials.length} spool malzeme satırı
          </p>
        )}
      </section>

      <ReportStep repo={repo} projects={projects} project={project} data={data} onSelectProject={onSelectProject} notify={notify} />

      <h3 style={{ marginTop: 8 }}>Ayrı şablonlarla yükleme</h3>
      <p className="small muted" style={{ marginTop: -6 }}>Tersane raporu yerine SpoolTrack şablonlarını kullanıyorsanız. Spool bazında malzeme listesi (adım 6) yalnızca bu yolla yüklenir.</p>
      {STEPS.map((s) => (
        <ImportStep key={s.kind} step={s} repo={repo} project={project} data={data} notify={notify} />
      ))}
    </div>
  );
}

function ImportStep({ step, repo, project, data, notify }: { step: StepDef; repo: Repo; project: Project | null; data: ProjectData | null; notify: Props['notify'] }) {
  const [preview, setPreview] = useState<AnyPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const blocked = !project || !data ? 'Önce proje seçin.' : step.needs?.(data) ?? null;

  async function onFile(file: File | undefined) {
    setPreview(null);
    setError('');
    setResult('');
    if (!file || !data) return;
    try {
      const sheet = readSheet(await file.arrayBuffer(), file.name);
      const now = new Date().toISOString();
      const p =
        step.kind === 'isometric' ? previewIsometrics(sheet, data, now)
        : step.kind === 'spool' ? previewSpools(sheet, data, now)
        : step.kind === 'material' ? previewMaterials(sheet, data, now)
        : previewSpoolMaterials(sheet, data);
      setPreview(p);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function commit() {
    if (!preview || !project) return;
    setBusy(true);
    try {
      const n = await repo.commitImport(project.id, step.kind, preview as ImportPreview<{ id: string }>);
      const msg = `${preview.fileName}: ${n} kayıt kaydedildi (${preview.create.length} yeni, ${preview.update.length} güncelleme).`;
      setResult(msg);
      notify(msg);
      setPreview(null);
    } catch (e) {
      setError(`Kaydedilemedi: ${friendlyError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" data-step={step.kind}>
      <div className="step-head">
        <span className="step-no">{step.no}</span>
        <div className="grow">
          <h3>{step.title}</h3>
          <p className="small muted">{step.help}</p>
          <p className="cols">Zorunlu sütunlar: {REQUIRED_COLUMNS[step.kind].join(', ')}</p>
        </div>
      </div>
      <div className="row">
        <a className="btn" href={`${import.meta.env.BASE_URL}templates/${step.template}`} download>
          <Icon.download /> Şablon
        </a>
        <label className={`btn primary filebtn grow${blocked ? ' disabled' : ''}`} aria-disabled={!!blocked} style={blocked ? { opacity: 0.5 } : undefined}>
          <Icon.file /> Excel seç ve önizle
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!!blocked}
            data-testid={`file-${step.kind}`}
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </label>
      </div>
      {blocked && <p className="small muted">{blocked}</p>}
      {error && <div className="alert error">{error}</div>}
      {result && <div className="alert ok" data-testid={`result-${step.kind}`}>{result}</div>}
      {preview && <PreviewView preview={preview} busy={busy} onCommit={commit} onCancel={() => setPreview(null)} />}
    </section>
  );
}

function PreviewView({ preview, busy, onCommit, onCancel }: { preview: AnyPreview; busy: boolean; onCommit: () => void; onCancel: () => void }) {
  const ok = canCommit(preview);
  return (
    <div className="stack" data-testid={`preview-${preview.kind}`}>
      <PreviewBody preview={preview} />
      <div className="row">
        <button className="btn primary grow" disabled={!ok || busy} onClick={onCommit} data-testid="commit">
          {busy ? 'Kaydediliyor…' : ok ? `${preview.create.length + preview.update.length} kaydı aktar` : 'Aktarılacak kayıt yok'}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>Vazgeç</button>
      </div>
    </div>
  );
}

function PreviewBody({ preview, title }: { preview: AnyPreview; title?: string }) {
  const blocking = preview.issues.filter((i) => BLOCKING_ISSUES.includes(i.kind));
  const errors = blocking.filter((i) => i.kind !== 'exists');
  const byKind = (k: IssueKind) => preview.issues.filter((i) => i.kind === k).length;
  const order: IssueKind[] = ['invalid', 'unmatched', 'conflict', 'duplicate', 'skipped', 'warning', 'exists'];
  const issues = [...preview.issues].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.rowNum - b.rowNum);
  return (
    <div className="stack" data-testid={`body-${preview.kind}`}>
      {title ? <h4 style={{ margin: 0 }}>{title}</h4> : null}
      <p className="small"><b>{preview.fileName}</b> · sayfa “{preview.sheetName}” · {preview.totalRows} veri satırı</p>
      {preview.missingColumns.length > 0 && (
        <div className="alert error" data-testid="missing-columns">
          Eksik sütunlar: <b>{preview.missingColumns.join(', ')}</b>. İlk satırdaki başlıkları şablondaki gibi düzenleyip tekrar yükleyin. Hiçbir satır aktarılmadı.
        </div>
      )}
      {preview.unknownColumns.length > 0 && (
        <p className="small muted">Tanınmayan ve yok sayılan sütunlar: {preview.unknownColumns.join(', ')}</p>
      )}
      {preview.missingColumns.length === 0 && (
        <div className="summary" data-testid="preview-summary">
          <div><b data-testid="count-create">{preview.create.length}</b><span>Yeni kayıt</span></div>
          <div><b data-testid="count-update">{preview.update.length}</b><span>Güncellenecek</span></div>
          <div><b data-testid="count-unchanged">{preview.unchanged}</b><span>Zaten kayıtlı</span></div>
          <div><b data-testid="count-errors">{errors.length}</b><span>Alınmayacak satır</span></div>
          <div><b>{byKind('warning')}</b><span>Uyarı</span></div>
        </div>
      )}
      {issues.length > 0 && (
        <details open={errors.length > 0}>
          <summary>Satır kontrolleri ({issues.length})</summary>
          <div className="table-scroll">
            <table className="data" data-testid="issues">
              <thead><tr><th className="num">Satır</th><th>Tür</th><th>Kayıt</th><th>Açıklama</th></tr></thead>
              <tbody>
                {issues.slice(0, 300).map((i, idx) => (
                  <tr key={idx}>
                    <td className="num">{i.rowNum || '—'}</td>
                    <td><span className={`kind kind-${i.kind}`}>{ISSUE_LABEL[i.kind]}</span></td>
                    <td>{i.ref}</td>
                    <td>{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issues.length > 300 && <p className="small muted">İlk 300 satır gösteriliyor.</p>}
        </details>
      )}
      {preview.create.length + preview.update.length > 0 && (
        <details>
          <summary>Aktarılacak kayıtlar ({preview.create.length + preview.update.length})</summary>
          <ItemsTable preview={preview} />
        </details>
      )}
    </div>
  );
}

function ItemsTable({ preview }: { preview: AnyPreview }) {
  const rows = [...preview.create.map((x) => ({ x, tag: 'Yeni' })), ...preview.update.map((x) => ({ x, tag: 'Güncelle' }))].slice(0, 100);
  let head: string[] = [];
  let cells: (x: any) => (string | number)[] = () => [];
  if (preview.kind === 'isometric') {
    head = ['İzometri', 'Rev', 'Sistem', 'Konum'];
    cells = (x: Isometric) => [x.isoNo, x.revision, x.system, locLabel(x)];
  } else if (preview.kind === 'spool') {
    head = ['Spool', 'İzometri', 'Rev', 'Konum', 'Sistem', 'Durum'];
    cells = (x: Spool) => [x.spoolNo, x.isoNo, x.revision, locLabel(x), x.system, STATUS_LABEL[x.status]];
  } else if (preview.kind === 'material') {
    head = ['Kod', 'Açıklama', 'Ölçü', 'Malzeme', 'Birim', 'Toplam', 'Stok'];
    cells = (x: Material) => [x.code, x.description, x.size, x.grade, x.unit, fmt(x.totalQty), fmt(x.stockQty)];
  } else {
    head = ['Spool', 'Malzeme', 'Miktar'];
    cells = (x: SpoolMaterial) => [x.spoolId.split('~S~')[1] ? decodeURIComponent(x.spoolId.split('~S~')[1]) : x.spoolId, x.materialCode, fmt(x.qty)];
  }
  return (
    <div className="table-scroll">
      <table className="data">
        <thead><tr><th></th>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map(({ x, tag }) => (
            <tr key={x.id}><td className="small muted">{tag}</td>{cells(x).map((c, i) => <td key={i}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {preview.create.length + preview.update.length > 100 && <p className="small muted">İlk 100 kayıt gösteriliyor.</p>}
    </div>
  );
}

// ───────────── Shipyard report (GENERAL_REPORTS: Spool List + Material List) ─────────────

function ReportStep({ repo, projects, project, data, onSelectProject, notify }: Props) {
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [now] = useState(() => new Date().toISOString());

  const preview: ReportPreview | null = useMemo(
    () => (sheets && data ? previewReport(sheets, data, now) : null),
    [sheets, data, now],
  );
  const hull = (sheets && (sheets.find((x) => x.meta.hullNo)?.meta.hullNo ?? '')) || '';
  const hullProject = hull ? projects.find((p) => p.name.toLocaleUpperCase('tr') === hull.toLocaleUpperCase('tr')) : undefined;

  async function onFile(file: File | undefined) {
    setSheets(null);
    setError('');
    setResult('');
    if (!file) return;
    try {
      const all = readWorkbook(await file.arrayBuffer(), file.name);
      const found = previewReport(all, { isometrics: [], spools: [], materials: [], spoolMaterials: [] }, now);
      if (!found.spoolSheet && !found.materialSheet) {
        setError(
          `"${file.name}" içinde spool listesi (Pipeline, Spool No, Zone/Block…) veya malzeme özeti (Description, Size, Quantity…) tablosu bulunamadı. ` +
            `Sayfalar: ${all.map((x) => `${x.sheetName} [${x.columns.join(', ') || 'tanınan sütun yok'}]`).join('; ')}. ` +
            'Tek tablo içeren dosyalar için aşağıdaki şablon adımlarını kullanın.',
        );
        return;
      }
      setSheets(all);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function createHullProject() {
    setBusy(true);
    try {
      const p = await repo.createProject(hull);
      onSelectProject(p.id);
      notify(`"${p.name}" projesi oluşturuldu.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || !project) return;
    setBusy(true);
    setError('');
    const parts: string[] = [];
    try {
      for (const [kind, p, label] of [
        ['isometric', preview.isometrics, 'izometri'],
        ['spool', preview.spools, 'spool'],
        ['material', preview.materials, 'malzeme'],
      ] as const) {
        if (!p || p.missingColumns.length || p.create.length + p.update.length === 0) continue;
        await repo.commitImport(project.id, kind, p as ImportPreview<{ id: string }>);
        parts.push(`${p.create.length} yeni / ${p.update.length} güncellenen ${label}`);
      }
      const msg = `${preview.fileName}: ${parts.join(', ')} kaydedildi.`;
      setResult(msg);
      notify(msg);
      setSheets(null);
    } catch (e) {
      setError(`Kaydedilemedi${parts.length ? ` (${parts.join(', ')} yazılmıştı)` : ''}: ${friendlyError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const sections: [string, AnyPreview | null][] = preview
    ? [
        [`İzometriler (pipeline) — ${preview.spoolSheet ?? ''}`, preview.isometrics],
        [`Spoollar — ${preview.spoolSheet ?? ''}`, preview.spools],
        [`Malzemeler — ${preview.materialSheet ?? ''}`, preview.materials],
      ]
    : [];
  const ok = !!preview && reportCanCommit(preview);
  const total = preview ? [preview.isometrics, preview.spools, preview.materials].reduce((n, p) => n + (p ? p.create.length + p.update.length : 0), 0) : 0;

  return (
    <section className="card stack" data-step="report">
      <div className="step-head">
        <span className="step-no">2</span>
        <div className="grow">
          <h3>Tersane raporu (GENERAL_REPORTS)</h3>
          <p className="small muted">
            “Spool List” ve “Material List” sayfaları olan rapor dosyasını olduğu gibi yükleyin. Pipeline izometri olarak alınır;
            her spool kendi Zone, Block, revizyon ve üretim notunu taşır. Yeniden yüklemede sahadaki durumlar korunur.
          </p>
        </div>
      </div>
      <label className="btn primary filebtn">
        <Icon.file /> Rapor Excel'ini seç ve önizle
        <input type="file" accept=".xlsx,.xls" data-testid="file-report" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {error && <div className="alert error" data-testid="report-error">{error}</div>}
      {result && <div className="alert ok" data-testid="result-report">{result}</div>}
      {sheets && (
        <div className="stack" data-testid="preview-report">
          <p className="small">
            {hull && <>HULL NO <b data-testid="report-hull">{hull}</b> · </>}
            {sheets[0]?.meta.revisionNo && <>Rapor revizyonu {sheets[0].meta.revisionNo} · </>}
            {sheets[0]?.meta.date && <>Tarih {sheets[0].meta.date} · </>}
            Sayfalar: {preview?.spoolSheet ?? '—'} (spool), {preview?.materialSheet ?? '—'} (malzeme)
            {preview && preview.ignoredSheets.length > 0 && <> · yok sayılan: {preview.ignoredSheets.join(', ')}</>}
          </p>
          {hull && !hullProject && (
            <div className="alert warn row">
              <span className="grow">Bu rapor <b>{hull}</b> teknesine ait ve bu adda proje yok.</span>
              <button className="btn primary" onClick={createHullProject} disabled={busy} data-testid="create-hull-project">“{hull}” projesini oluştur</button>
            </div>
          )}
          {hull && hullProject && project && hullProject.id !== project.id && (
            <div className="alert warn row">
              <span className="grow">Seçili proje <b>{project.name}</b>, rapor ise <b>{hull}</b> teknesine ait.</span>
              <button className="btn" onClick={() => onSelectProject(hullProject.id)}>{hull} projesine geç</button>
            </div>
          )}
          {!project && !hull && <div className="alert warn">Önce yukarıdan proje oluşturun veya seçin.</div>}
          {preview && sections.map(([title, p]) => p && <PreviewBody key={title} preview={p} title={title} />)}
          {preview && (
            <div className="row">
              <button className="btn primary grow" disabled={!ok || busy} onClick={commit} data-testid="commit-report">
                {busy ? 'Kaydediliyor…' : ok ? `${total} kaydı ${project?.name ?? ''} projesine aktar` : 'Aktarılacak kayıt yok'}
              </button>
              <button className="btn" onClick={() => setSheets(null)} disabled={busy}>Vazgeç</button>
            </div>
          )}
          {preview && <p className="small muted">Alınmayacak satır: {blockingCount(preview.spools) + blockingCount(preview.materials)}</p>}
        </div>
      )}
    </section>
  );
}
