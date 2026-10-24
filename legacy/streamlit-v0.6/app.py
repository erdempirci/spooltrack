from pathlib import Path
from datetime import datetime
import sqlite3
import re

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "spooltrack.db"

STATUS_OPTIONS = ["Başlamadı", "Devam Ediyor", "Bitti"]

st.set_page_config(
    page_title="SpoolTrack",
    page_icon="🔩",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
.block-container {padding-top: 1.1rem; padding-bottom: 2rem;}
[data-testid="stSidebar"] {min-width: 290px; max-width: 290px;}
[data-testid="stMetricValue"] {font-size: 1.55rem;}
div[data-testid="stDataEditor"] {border: 1px solid rgba(120,120,120,.25); border-radius: 8px;}
.section-note {color:#8b949e; font-size:.9rem;}
</style>
""", unsafe_allow_html=True)


def db():
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init_db():
    c = db()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS projects(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS isometrics(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        iso_no TEXT NOT NULL,
        revision TEXT NOT NULL DEFAULT '',
        system_name TEXT NOT NULL DEFAULT '',
        location_type TEXT NOT NULL DEFAULT 'Zone',
        location_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(project_id, iso_no, revision),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS spools(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        isometric_id INTEGER NOT NULL,
        spool_no TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Başlamadı',
        updated_at TEXT NOT NULL,
        UNIQUE(isometric_id, spool_no),
        FOREIGN KEY(isometric_id) REFERENCES isometrics(id) ON DELETE CASCADE
    );
    """)

    # Migration from older prototypes
    cols = [r["name"] for r in c.execute("PRAGMA table_info(isometrics)").fetchall()]
    for col, ddl in [
        ("location_type", "ALTER TABLE isometrics ADD COLUMN location_type TEXT NOT NULL DEFAULT 'Zone'"),
        ("location_name", "ALTER TABLE isometrics ADD COLUMN location_name TEXT NOT NULL DEFAULT ''"),
    ]:
        if col not in cols:
            c.execute(ddl)

    spool_cols = [r["name"] for r in c.execute("PRAGMA table_info(spools)").fetchall()]
    if "updated_at" not in spool_cols:
        c.execute("ALTER TABLE spools ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")

    # Translate old status values
    c.execute("UPDATE spools SET status='Başlamadı' WHERE status IN ('Bekliyor', '', 'Not Started')")
    c.execute("UPDATE spools SET status='Devam Ediyor' WHERE status IN ('Üretimde', 'In Progress')")
    c.execute("UPDATE spools SET status='Bitti' WHERE status IN ('Tamamlandı', 'Completed')")
    c.commit()
    c.close()


def qdf(sql, params=()):
    c = db()
    out = pd.read_sql_query(sql, c, params=params)
    c.close()
    return out


def execute(sql, params=()):
    c = db()
    cur = c.execute(sql, params)
    c.commit()
    row_id = cur.lastrowid
    c.close()
    return row_id


def clean_text(value):
    if pd.isna(value):
        return ""
    return str(value).strip()


def normalize_location(value):
    text = clean_text(value).lower()
    if text in {"block", "blok", "blk"} or "block" in text or "blok" in text:
        return "Block"
    return "Zone"


def normalize_status(value):
    text = clean_text(value).lower()
    text_ascii = (
        text.replace("ş", "s").replace("ı", "i").replace("ğ", "g")
            .replace("ü", "u").replace("ö", "o").replace("ç", "c")
    )
    if text_ascii in {"bitti", "tamamlandi", "completed", "complete", "done"}:
        return "Bitti"
    if text_ascii in {"devam ediyor", "uretimde", "in progress", "started", "basladi"}:
        return "Devam Ediyor"
    return "Başlamadı"


def normalize_columns(df):
    renamed = {}
    aliases = {
        "izometri_no": ["izometri_no", "izometri", "iso_no", "iso", "isometric_no", "drawing_no"],
        "revizyon": ["revizyon", "revision", "rev", "rev_no"],
        "sistem": ["sistem", "system", "system_name"],
        "konum_turu": ["konum_turu", "location_type", "zone_block", "type"],
        "konum_adi": ["konum_adi", "location_name", "zone", "block", "zone_no", "block_no"],
        "spool_no": ["spool_no", "spool", "spool_number"],
        "baslangic_durumu": ["baslangic_durumu", "durum", "status", "initial_status"],
    }

    lowered = {str(c).strip().lower(): c for c in df.columns}
    for target, possible in aliases.items():
        for alias in possible:
            if alias in lowered:
                renamed[lowered[alias]] = target
                break
    return df.rename(columns=renamed)


def project_list():
    return qdf("SELECT id, name FROM projects ORDER BY name")


def filtered_spools(project_id, location_type, location_name, system_name):
    return qdf("""
    SELECT
        s.id,
        s.spool_no AS "Spool No",
        i.iso_no AS "İzometri No",
        i.revision AS "Revizyon",
        s.status AS "Durum"
    FROM spools s
    JOIN isometrics i ON i.id=s.isometric_id
    WHERE i.project_id=?
      AND i.location_type=?
      AND i.location_name=?
      AND i.system_name=?
    ORDER BY i.iso_no, s.spool_no
    """, (project_id, location_type, location_name, system_name))


def filtered_isos(project_id, location_type, location_name, system_name):
    df = qdf("""
    SELECT
        i.id,
        i.iso_no AS "İzometri No",
        i.revision AS "Revizyon",
        COUNT(s.id) AS "Toplam Spool",
        SUM(CASE WHEN s.status='Başlamadı' THEN 1 ELSE 0 END) AS "Başlamadı",
        SUM(CASE WHEN s.status='Devam Ediyor' THEN 1 ELSE 0 END) AS "Devam Ediyor",
        SUM(CASE WHEN s.status='Bitti' THEN 1 ELSE 0 END) AS "Bitti"
    FROM isometrics i
    LEFT JOIN spools s ON s.isometric_id=i.id
    WHERE i.project_id=?
      AND i.location_type=?
      AND i.location_name=?
      AND i.system_name=?
    GROUP BY i.id
    ORDER BY i.iso_no
    """, (project_id, location_type, location_name, system_name))

    if df.empty:
        return df

    df["İlerleme %"] = df.apply(
        lambda r: round((r["Bitti"] / r["Toplam Spool"]) * 100, 1)
        if r["Toplam Spool"] else 0.0,
        axis=1,
    )
    df["Durum"] = df.apply(
        lambda r: "Bitti"
        if r["Toplam Spool"] > 0 and r["Bitti"] == r["Toplam Spool"]
        else ("Devam Ediyor" if r["Bitti"] > 0 or r["Devam Ediyor"] > 0 else "Başlamadı"),
        axis=1,
    )
    return df


init_db()
st.title("🔩 SpoolTrack")

projects = project_list()

with st.sidebar:
    st.subheader("Çalışma alanı")
    mode = st.radio("Ekran", ["Üretim Takibi", "Veri Yükleme"], horizontal=False)

    project_id = None
    project_name = None
    location_type = None
    location_name = None
    system_name = None

    if not projects.empty:
        pmap = dict(zip(projects["name"], projects["id"]))
        project_name = st.selectbox("Proje", list(pmap.keys()))
        project_id = int(pmap[project_name])

        if mode == "Üretim Takibi":
            locations = qdf("""
                SELECT DISTINCT location_type, location_name
                FROM isometrics
                WHERE project_id=?
                ORDER BY location_type, location_name
            """, (project_id,))

            if not locations.empty:
                locations["label"] = locations["location_type"] + " — " + locations["location_name"]
                lmap = {
                    row["label"]: (row["location_type"], row["location_name"])
                    for _, row in locations.iterrows()
                }
                chosen_location = st.selectbox("Zone / Block", list(lmap.keys()))
                location_type, location_name = lmap[chosen_location]

                systems = qdf("""
                    SELECT DISTINCT system_name
                    FROM isometrics
                    WHERE project_id=? AND location_type=? AND location_name=?
                    ORDER BY system_name
                """, (project_id, location_type, location_name))

                if not systems.empty:
                    system_name = st.selectbox("Sistem", systems["system_name"].tolist())

if mode == "Veri Yükleme":
    st.subheader("Veri Yükleme")
    st.caption("Bu bölüm proje yöneticisi tarafından kullanılır. Üretim mühendisi günlük olarak sadece Üretim Takibi ekranını kullanır.")

    tab_project, tab_iso, tab_spool = st.tabs(["1. Proje", "2. İzometri Excel", "3. Spool Excel"])

    with tab_project:
        with st.form("project_form", clear_on_submit=True):
            new_project = st.text_input("Yeni proje adı", placeholder="Örnek: YACHT 126")
            if st.form_submit_button("Projeyi oluştur", use_container_width=True):
                if not new_project.strip():
                    st.error("Proje adı girin.")
                else:
                    try:
                        execute(
                            "INSERT INTO projects(name, created_at) VALUES (?, ?)",
                            (new_project.strip(), datetime.now().isoformat(timespec="seconds")),
                        )
                        st.success("Proje oluşturuldu. Sayfayı yenileyip soldan seçin.")
                    except sqlite3.IntegrityError:
                        st.error("Bu proje zaten mevcut.")

    with tab_iso:
        if project_id is None:
            st.info("Önce proje oluşturun veya soldan proje seçin.")
        else:
            template_path = ROOT / "IZOMETRI_YUKLEME_SABLONU.xlsx"
            st.download_button(
                "İzometri Excel şablonunu indir",
                template_path.read_bytes(),
                file_name=template_path.name,
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True,
            )

            iso_file = st.file_uploader("Doldurulmuş izometri Excel'ini yükle", type=["xlsx", "xls", "csv"], key="iso_upload")
            if iso_file is not None:
                try:
                    raw = pd.read_csv(iso_file) if iso_file.name.lower().endswith(".csv") else pd.read_excel(iso_file)
                    raw = normalize_columns(raw)
                    st.dataframe(raw.head(50), use_container_width=True, hide_index=True)

                    required = {"izometri_no", "revizyon", "sistem", "konum_turu", "konum_adi"}
                    missing = required - set(raw.columns)

                    if missing:
                        st.error("Eksik sütunlar: " + ", ".join(sorted(missing)))
                    elif st.button("Tüm izometrileri projeye aktar", type="primary", use_container_width=True):
                        added, skipped, invalid = 0, 0, 0
                        c = db()
                        for _, row in raw.iterrows():
                            iso_no = clean_text(row.get("izometri_no"))
                            revision = clean_text(row.get("revizyon"))
                            system = clean_text(row.get("sistem"))
                            loc_type = normalize_location(row.get("konum_turu"))
                            loc_name = clean_text(row.get("konum_adi"))

                            if not iso_no or not system or not loc_name:
                                invalid += 1
                                continue

                            try:
                                c.execute("""
                                    INSERT INTO isometrics
                                    (project_id, iso_no, revision, system_name, location_type, location_name, created_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)
                                """, (
                                    project_id, iso_no, revision, system,
                                    loc_type, loc_name,
                                    datetime.now().isoformat(timespec="seconds"),
                                ))
                                added += 1
                            except sqlite3.IntegrityError:
                                skipped += 1

                        c.commit()
                        c.close()
                        st.success(f"{added} izometri eklendi. {skipped} tekrar kayıt atlandı. {invalid} eksik satır alınmadı.")
                except Exception as exc:
                    st.error(f"Excel okunamadı: {exc}")

    with tab_spool:
        if project_id is None:
            st.info("Önce proje oluşturun veya soldan proje seçin.")
        else:
            template_path = ROOT / "SPOOL_YUKLEME_SABLONU.xlsx"
            st.download_button(
                "Spool Excel şablonunu indir",
                template_path.read_bytes(),
                file_name=template_path.name,
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True,
            )

            spool_file = st.file_uploader("Doldurulmuş spool Excel'ini yükle", type=["xlsx", "xls", "csv"], key="spool_upload")
            if spool_file is not None:
                try:
                    raw = pd.read_csv(spool_file) if spool_file.name.lower().endswith(".csv") else pd.read_excel(spool_file)
                    raw = normalize_columns(raw)
                    st.dataframe(raw.head(50), use_container_width=True, hide_index=True)

                    required = {"spool_no", "izometri_no"}
                    missing = required - set(raw.columns)

                    if missing:
                        st.error("Eksik sütunlar: " + ", ".join(sorted(missing)))
                    elif st.button("Tüm spoolları projeye aktar", type="primary", use_container_width=True):
                        added, skipped, unmatched = 0, 0, 0
                        c = db()

                        for _, row in raw.iterrows():
                            spool_no = clean_text(row.get("spool_no"))
                            iso_no = clean_text(row.get("izometri_no"))
                            revision = clean_text(row.get("revizyon"))
                            status = normalize_status(row.get("baslangic_durumu", "Başlamadı"))

                            if not spool_no or not iso_no:
                                unmatched += 1
                                continue

                            if revision:
                                iso = c.execute("""
                                    SELECT id FROM isometrics
                                    WHERE project_id=? AND iso_no=? AND revision=?
                                    LIMIT 1
                                """, (project_id, iso_no, revision)).fetchone()
                            else:
                                iso = c.execute("""
                                    SELECT id FROM isometrics
                                    WHERE project_id=? AND iso_no=?
                                    ORDER BY id DESC LIMIT 1
                                """, (project_id, iso_no)).fetchone()

                            if iso is None:
                                unmatched += 1
                                continue

                            try:
                                c.execute("""
                                    INSERT INTO spools(isometric_id, spool_no, status, updated_at)
                                    VALUES (?, ?, ?, ?)
                                """, (
                                    int(iso["id"]), spool_no, status,
                                    datetime.now().isoformat(timespec="seconds"),
                                ))
                                added += 1
                            except sqlite3.IntegrityError:
                                skipped += 1

                        c.commit()
                        c.close()
                        st.success(f"{added} spool eklendi. {skipped} tekrar kayıt atlandı. {unmatched} spool izometriyle eşleşmedi.")
                except Exception as exc:
                    st.error(f"Excel okunamadı: {exc}")

else:
    if project_id is None:
        st.warning("Henüz proje yok. Soldaki **Veri Yükleme** ekranından proje oluşturun.")
        st.stop()

    if location_name is None or system_name is None:
        st.warning("Bu projede henüz Zone/Block, sistem veya izometri verisi yok. Veri Yükleme ekranından Excel yükleyin.")
        st.stop()

    st.caption(f"{project_name}  ›  {location_type} {location_name}  ›  {system_name}")

    spools = filtered_spools(project_id, location_type, location_name, system_name)
    isos = filtered_isos(project_id, location_type, location_name, system_name)

    total_spools = len(spools)
    finished = int((spools["Durum"] == "Bitti").sum()) if not spools.empty else 0
    ongoing = int((spools["Durum"] == "Devam Ediyor").sum()) if not spools.empty else 0
    progress = round((finished / total_spools) * 100, 1) if total_spools else 0.0

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Toplam spool", total_spools)
    m2.metric("Başlamadı", total_spools - finished - ongoing)
    m3.metric("Devam ediyor", ongoing)
    m4.metric("Bitti / İlerleme", f"{finished} / %{progress}")
    st.progress(progress / 100 if total_spools else 0)

    spool_tab, iso_tab = st.tabs(["SPOOL", "ISO"])

    with spool_tab:
        if spools.empty:
            st.info("Seçilen Zone/Block ve sistem için spool bulunmuyor.")
        else:
            st.write("Durum hücresine tıklayıp **Başlamadı**, **Devam Ediyor** veya **Bitti** seçin.")

            editor_data = spools[["id", "Spool No", "İzometri No", "Revizyon", "Durum"]].copy()

            edited = st.data_editor(
                editor_data,
                use_container_width=True,
                hide_index=True,
                disabled=["id", "Spool No", "İzometri No", "Revizyon"],
                column_config={
                    "id": None,
                    "Spool No": st.column_config.TextColumn("Spool No", width="large"),
                    "İzometri No": st.column_config.TextColumn("İzometri No", width="large"),
                    "Revizyon": st.column_config.TextColumn("Rev.", width="small"),
                    "Durum": st.column_config.SelectboxColumn(
                        "Durum",
                        options=STATUS_OPTIONS,
                        required=True,
                        width="medium",
                    ),
                },
                key=f"spool_editor_{project_id}_{location_type}_{location_name}_{system_name}",
            )

            if st.button("Spool durumlarını kaydet", type="primary", use_container_width=True):
                original = editor_data.set_index("id")
                changed = 0
                c = db()
                for _, row in edited.iterrows():
                    spool_id = int(row["id"])
                    new_status = row["Durum"]
                    old_status = original.loc[spool_id, "Durum"]
                    if new_status != old_status:
                        c.execute(
                            "UPDATE spools SET status=?, updated_at=? WHERE id=?",
                            (new_status, datetime.now().isoformat(timespec="seconds"), spool_id),
                        )
                        changed += 1
                c.commit()
                c.close()
                st.success(f"{changed} spool durumu güncellendi.")
                st.rerun()

    with iso_tab:
        if isos.empty:
            st.info("Seçilen Zone/Block ve sistem için izometri bulunmuyor.")
        else:
            show = isos.drop(columns=["id"])
            st.dataframe(
                show,
                use_container_width=True,
                hide_index=True,
                column_config={
                    "İlerleme %": st.column_config.ProgressColumn(
                        "İlerleme %",
                        min_value=0,
                        max_value=100,
                        format="%.1f%%",
                    )
                },
            )
            st.caption("ISO durumu manuel seçilmez. Bağlı spoolların durumuna göre otomatik güncellenir.")
